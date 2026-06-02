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

const CACHE_TTL_SEC  = 900   // 15 min — how long before re-fetching from Google
const ROLLING_DAYS   = 30    // parse this many days ahead and cache the result

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
        const startIcal = ICAL.Time.fromJSDate(start, true)
        const endIcal   = ICAL.Time.fromJSDate(end, true)

        // If the rule has an explicit UNTIL before our window, the entire series
        // ended in the past — skip without iterating.
        const rrule = vevent.getFirstPropertyValue('rrule') as ICAL.Recur | null
        if (rrule?.until && rrule.until.compare(startIcal) < 0) continue

        // IMPORTANT: always start from DTSTART, never pass startIcal here.
        // Passing a custom dtstart resets the recurrence base, causing COUNT-
        // bounded series (e.g. COUNT=4 from 2013) to regenerate occurrences
        // starting from today instead of their original dates.
        const iter = ev.iterator()

        // Fast-forward cheaply: call next() without getOccurrenceDetails
        // until we reach the window start.
        let next: ICAL.Time | null = iter.next()
        let skips = 0
        while (next && next.compare(startIcal) < 0 && skips++ < 5000) {
          next = iter.next()
        }

        // Process occurrences within the window
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
        // Include any event that overlaps the window, including multi-day events
        // that started before the window start but are still ongoing.
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
      // Cache key includes today's date so the window rolls forward each day
      // and yesterday's stale events don't linger indefinitely.
      const today = new Date().toISOString().slice(0, 10)
      const eventsKey = `cal:${source._id.toString()}:events:${today}`

      let windowEvents: CalendarEvent[] | null = null
      const cached = await redis.get(eventsKey)
      if (cached) {
        try { windowEvents = JSON.parse(cached) } catch { /* corrupt — refetch */ }
      }

      if (!windowEvents) {
        // Parse a full 30-day rolling window and cache the result.
        // Any sub-window query (16h Now, 7d Calendar page) then just filters
        // this array — no re-fetch and no re-parse until the TTL expires.
        const icalText = await fetchIcalText(source.ical_url)
        const windowStart = new Date(); windowStart.setHours(0, 0, 0, 0)
        const windowEnd   = new Date(windowStart.getTime() + ROLLING_DAYS * 86_400_000)
        windowEvents = parseSource(icalText, windowStart, windowEnd, source)
        await redis.set(eventsKey, JSON.stringify(windowEvents), 'EX', CACHE_TTL_SEC)
      }

      // Filter cached events to the caller's requested window (overlap check).
      const filtered = windowEvents.filter(ev => {
        const evEnd   = new Date(ev.end)
        const evStart = new Date(ev.start)
        return evEnd > start && evStart < end
      })
      all.push(...filtered)
    } catch (err) {
      console.error(`[calendar] failed to load "${source.name}":`, (err as Error).message)
    }
  }))

  return all.sort((a, b) => a.start.localeCompare(b.start))
}
