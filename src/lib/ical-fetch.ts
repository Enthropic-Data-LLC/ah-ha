import ICAL from 'ical.js'
import type { Redis } from 'ioredis'
import type { ObjectId } from 'mongodb'

export interface CalendarSource {
  _id: ObjectId
  user_id: ObjectId
  name: string
  ical_url: string
  color: string
  created_at: Date
}

export interface CalendarEvent {
  uid: string
  title: string
  start: string
  end: string
  all_day: boolean
  location?: string
  description?: string
  calendar: string
  color: string
}

const CACHE_TTL_SEC = 900

async function fetchIcalText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  } finally {
    clearTimeout(timeout)
  }
}

function icalTimeToDate(t: ICAL.Time): Date {
  return t.toJSDate()
}

function parseSource(icalText: string, start: Date, end: Date, source: CalendarSource): CalendarEvent[] {
  const jcal = ICAL.parse(icalText)
  const comp  = new ICAL.Component(jcal)
  const events: CalendarEvent[] = []

  const vevents = comp.getAllSubcomponents('vevent')
  for (const vevent of vevents) {
    try {
      const ev    = new ICAL.Event(vevent)
      const uid   = ev.uid ?? ''
      const title = ev.summary ?? '(no title)'
      const loc   = ev.location ?? undefined
      const rawDesc = vevent.getFirstPropertyValue('description')
      const desc = typeof rawDesc === 'string' ? rawDesc : undefined

      if (ev.isRecurring()) {
        // Use UTC so ICAL.js can fast-forward through the recurrence rule
        // without stepping through every past occurrence one-by-one.
        const startIcal = ICAL.Time.fromJSDate(start, true)
        const endIcal   = ICAL.Time.fromJSDate(end, true)
        const iter = ev.iterator(startIcal)
        let next: ICAL.Time | null = iter.next()
        let safety = 0
        while (next && safety++ < 500) {
          if (next.compare(endIcal) >= 0) break
          const details = ev.getOccurrenceDetails(next)
          const occStart = icalTimeToDate(details.startDate)
          const occEnd   = icalTimeToDate(details.endDate)
          if (occEnd > start) {
            events.push({
              uid: `${uid}_${occStart.toISOString()}`,
              title,
              start: occStart.toISOString(),
              end: occEnd.toISOString(),
              all_day: details.startDate.isDate,
              ...(loc  ? { location: loc }     : {}),
              ...(desc ? { description: desc }  : {}),
              calendar: source.name,
              color: source.color,
            })
          }
          next = iter.next()
        }
      } else {
        const evStart = icalTimeToDate(ev.startDate)
        const evEnd   = icalTimeToDate(ev.endDate ?? ev.startDate)
        if (evStart >= end || evEnd <= start) continue
        events.push({
          uid,
          title,
          start: evStart.toISOString(),
          end: evEnd.toISOString(),
          all_day: ev.startDate.isDate,
          ...(loc  ? { location: loc }     : {}),
          ...(desc ? { description: desc }  : {}),
          calendar: source.name,
          color: source.color,
        })
      }
    } catch {
      // skip malformed events
    }
  }

  return events
}

export async function fetchCalendarEvents(
  sources: CalendarSource[],
  start: Date,
  end: Date,
  redis: Redis,
): Promise<CalendarEvent[]> {
  const all: CalendarEvent[] = []

  await Promise.all(sources.map(async (source) => {
    try {
      const key = `cal:${source._id.toString()}:raw`
      let icalText = await redis.get(key)
      if (!icalText) {
        icalText = await fetchIcalText(source.ical_url)
        await redis.set(key, icalText, 'EX', CACHE_TTL_SEC)
      }
      all.push(...parseSource(icalText, start, end, source))
    } catch (err) {
      console.error(`[calendar] failed to load "${source.name}":`, (err as Error).message)
    }
  }))

  return all.sort((a, b) => a.start.localeCompare(b.start))
}
