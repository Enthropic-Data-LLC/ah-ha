import type { FastifyPluginAsync } from 'fastify'
import { core, callerOf } from '../../core/index.js'
import { streak } from '../streak.js'
import { pickFocus, type Candidate, type Focus } from '../focus.js'

const TIME_CHUNKS: Record<string, (h: number, dow: number) => boolean> = {
  wakeup:          (h)     => h >= 5  && h < 8,
  morning:         (h)     => h >= 6  && h < 10,
  midday:          (h)     => h >= 10 && h < 17,
  evening:         (h)     => h >= 17 && h < 21,
  night:           (h)     => h >= 21 || h < 2,
  bedtime:         (h)     => h >= 21 || h < 1,
  weekend:         (_, d)  => d === 0 || d === 6,
  monday_evening:  (h, d)  => d === 1 && h >= 17 && h < 21,
}

function matchesTimeChunks(chunks: string[], hour: number, dow: number): boolean {
  if (!chunks.length) return true   // no restriction — always active
  return chunks.some(c => (TIME_CHUNKS[c] ?? (() => true))(hour, dow))
}

function sortByTimeChunk(cards: Array<Record<string, unknown>>, hour: number, dow: number) {
  type CtxEntry = { entity_id: string; time_chunks: string[] }
  return [...cards].sort((a, b) => {
    const ctxsA = (a['contexts'] as CtxEntry[] | undefined) ?? []
    const ctxsB = (b['contexts'] as CtxEntry[] | undefined) ?? []
    // A card "matches" if any of its context entries have non-empty time_chunks that match now
    const aMatch = ctxsA.some(c => c.time_chunks.length > 0 && matchesTimeChunks(c.time_chunks, hour, dow)) ? 1 : 0
    const bMatch = ctxsB.some(c => c.time_chunks.length > 0 && matchesTimeChunks(c.time_chunks, hour, dow)) ? 1 : 0
    return bMatch - aMatch
  })
}

const TIME_OF_DAY = (h: number) => {
  if (h >= 5  && h < 10) return 'morning'
  if (h >= 10 && h < 17) return 'active'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

const OID_RE = /^[0-9a-f]{24}$/i

/** Snoozed this many times → Follow-through (modules/followthrough) brings it forward. */
const SNOOZED_OFTEN = 3

/** Cards taken from columns switched on for Ah! Today, before the person's own limit. */
const BOARD_MAX = 20

/**
 * The person's "show up to N items" (user_settings.today_limit). Sections are filled
 * in this order until N is reached, so what is overdue or due now is never the part
 * cut off. The focus card and calendar are not counted.
 */
const LIMIT_ORDER = ['urgent', 'habits', 'due_today', 'location_context', 'board', 'resurfaced',
  'entity_list_items', 'list_items', 'nudges', 'upcoming'] as const

/** Ah! Today's "Coming up": at most this many, soonest first. */
const UPCOMING_MAX = 5

function applyLimit<T extends Record<(typeof LIMIT_ORDER)[number], unknown[]>>(sections: T, max: number | null) {
  const total = LIMIT_ORDER.reduce((n, k) => n + sections[k].length, 0)
  if (max == null || total <= max) return { sections, limit: { max, total, hidden: 0 } }
  let left = max
  const out = { ...sections }
  for (const k of LIMIT_ORDER) {
    const keep = Math.min(left, sections[k].length)
    out[k] = sections[k].slice(0, keep) as T[typeof k]
    left -= keep
  }
  return { sections: out, limit: { max, total, hidden: total - max } }
}

// The briefing is an AI call (cost + ~2s), and /api/now is polled every minute by the
// web page, the phone app and its widget. So it is regenerated only when what it
// describes changes — place or time of day — or when someone opens the app/page
// (`?fresh=1`, honoured at most every BRIEFING_OPEN_MS). Everything else reuses the
// cached text. BRIEFING_DAILY_CAP is the backstop if a client misbehaves.
const BRIEFING_OPEN_MS = 10 * 60_000
const BRIEFING_MAX_AGE_MS = 6 * 3_600_000
const BRIEFING_DAILY_CAP = 30
interface CachedBriefing { text: string; presence: string; tod: string; ts: string }

const nowRoutes: FastifyPluginAsync = async (fastify) => {
  const c = core(fastify)
  const briefings = c.kv('briefing')
  fastify.get<{ Querystring: { presence?: string; tz?: string; fresh?: string } }>(
    '/api/now',
    { preHandler: fastify.authenticate },
    async (req) => {
      const now = new Date()
      const tz = req.query.tz ?? 'UTC'
      const caller = callerOf(req)
      await c.lists.reopenAlways(caller, req.query.tz)
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)
      )
      const localDow = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay()
      const tod = TIME_OF_DAY(localHour)

      // Presence: query param override > Redis
      const presenceRaw = req.query.presence || await c.places.presence(caller)

      // Resolve entity if presence looks like an ObjectId
      const presencePlace = await c.places.fromPresence(caller, presenceRaw)
      const presenceEntity = presencePlace ? { ...presencePlace, time_chunks: [] as string[] } : null

      const orgId = req.user!.orgId
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
      const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)

      // Overdue cards (max 3, sorted by most overdue first)
      const urgent = await c.cards.overdue(caller, todayStart, now, 3)

      // Due today
      const dueToday = await c.cards.dueBetween(caller, todayStart, todayEnd, now, 5)

      // Habit cards for this time of day
      const habits = await c.cards.habitsAt(caller,
        tod === 'morning' ? 'morning' : tod === 'active' ? 'midday' : tod === 'evening' ? 'evening' : 'night', 3)

      // Recently resurfaced (defer expired in last hour)
      const oneHourAgo = new Date(now.getTime() - 3600_000)
      const resurfaced = await c.cards.resurfaced(caller, oneHourAgo, now, 3)

      // Cards in board columns switched on for Ah! Today, priority 1 columns first.
      // A card already in another section stays there instead.
      const shownIds = new Set([...urgent, ...dueToday, ...habits, ...resurfaced].map(d => String(d['_id'])))
      const boardCards = (await c.cards.inTodayColumns(caller, now, BOARD_MAX)).filter(d => !shownIds.has(String(d['_id'])))

      // Interval nudges (at 80% of interval) — filter in Node, not $where (no JS eval in prod)
      const allIntervalCards = await c.cards.recurring(caller, ['interval', 'seasonal'], now)

      type IntervalRec = { interval_days?: number; last_completed_at?: Date | string | null }
      const nudges = allIntervalCards.filter(c => {
        const rec = c['recurrence'] as IntervalRec | undefined
        if (!rec?.interval_days) return false
        const base = rec.last_completed_at
          ? new Date(rec.last_completed_at)
          : new Date(c['created_at'] as Date)
        return now.getTime() - base.getTime() >= rec.interval_days * 0.8 * 86400000
      }).slice(0, 5)

      // List items due today
      const listItems = await c.lists.dueBy(caller, todayEnd, now, 10)

      // Coming up: what's due after today, as far ahead as the person's slider reaches.
      // Never set, or set to Today, adds nothing; 'all' takes the soonest few, however far.
      const dueWindow = await c.settings.dueWindow(caller).catch(() => null)
      let upcoming: Array<{ _id: unknown; title: unknown; due: unknown; kind: 'card' | 'item'; ref?: unknown }> = []
      if (dueWindow != null && dueWindow !== 1) {
        const until = dueWindow === 'all' ? null : new Date(todayEnd.getTime() + (dueWindow - 1) * 86400000)
        const [cardsAhead, itemsAhead] = await Promise.all([
          c.cards.dueAfter(caller, todayEnd, until, now, UPCOMING_MAX),
          c.lists.dueAfter(caller, todayEnd, until, now, UPCOMING_MAX),
        ])
        upcoming = [
          ...cardsAhead.map(d => ({ _id: d['_id'], title: d['title'], due: d['due_date'], kind: 'card' as const, ref: d['ref'] })),
          ...itemsAhead.map(i => ({ _id: i['_id'], title: i['title'], due: i['due_at'], kind: 'item' as const })),
        ].sort((a, b) => new Date(a.due as Date).getTime() - new Date(b.due as Date).getTime()).slice(0, UPCOMING_MAX)
      }

      // Entity-tagged list items — surface when checked in, regardless of due date
      let entityListItems: Array<{ _id: string; title: string; space_ref?: string; contexts: unknown; repeat: string }> = []
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        const raw = await c.lists.taggedTo(caller, presenceRaw, 20, now)

        // Filter by time_chunks on the context entry (same logic as card contexts)
        entityListItems = raw.filter(item => {
          const ctxs = item['contexts'] as Array<{ entity_id: string; time_chunks: string[] }> | undefined
          const entry = ctxs?.find(x => x.entity_id === presenceRaw)
          if (!entry) return false
          return matchesTimeChunks(entry.time_chunks, localHour, localDow)
        }).slice(0, 15).map(item => ({
          _id: item['_id'].toString(),
          title: item['title'] as string,
          space_ref: item['space_id']?.toString(),
          contexts: item['contexts'],
          repeat: (item['repeat'] as string | undefined) ?? 'once',
        }))
      }

      // Location-context cards — cards tagged for the current entity+time pairing
      // contexts is now Array<{ entity_id, time_chunks[] }>
      // A card matches if: its contexts array has an entry for the current entity
      //   AND that entry's time_chunks is empty (any time) OR matches current time
      let locationCards: Array<{ _id: string; title: string; ref?: string }> = []
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        // Fetch all cards that have a context entry for this entity
        const raw = await c.cards.taggedTo(caller, presenceRaw, 20, now)

        // Filter by time_chunks on the specific context entry
        const filtered = raw.filter(c => {
          const ctxs = c['contexts'] as Array<{ entity_id: string; time_chunks: string[] }> | undefined
          const entry = ctxs?.find(x => x.entity_id === presenceRaw)
          if (!entry) return false
          return matchesTimeChunks(entry.time_chunks, localHour, localDow)
        })

        locationCards = filtered.slice(0, 8).map(c => ({
          _id: c['_id'].toString(),
          title: c['title'] as string,
          ref: c['ref'] as string | undefined,
        }))
      }

      // Trail pulse — last entry tone
      let trailPulse: { recent_tone: string; total_today: number } | null = null
      try {
        const trailSpace = await c.trail.defaultTrail(caller)
        if (trailSpace) {
          const totals = await c.trail.toneCounts(caller, trailSpace['ref'] as string, todayStart)
          const total = Object.values(totals).reduce((s, n) => s + n, 0)
          const topTone = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral'
          trailPulse = { recent_tone: topTone, total_today: total }
        }
      } catch { /* trail unavailable */ }

      // Upcoming calendar events — next 8 hours
      let calendarEvents: Array<{ uid: string; title: string; start: string; end: string; all_day: boolean; location?: string; calendar: string; color: string }> = []
      try {
        calendarEvents = await c.calendar.events(caller, now, new Date(now.getTime() + 16 * 3_600_000))
      } catch { /* calendar unavailable */ }

      // Situation + focus: the one thing for right now, with reasons (lib/situation.ts, lib/focus.ts).
      const sit = await c.context.situation(caller, { tz, tod, place: presencePlace, calendar: calendarEvents })
        .catch(err => { req.log.warn({ err }, 'situation unavailable'); return null })
      let focus: Focus | null = null
      if (sit) {
        const cardC = (c: Record<string, unknown>, base: number, why: string): Candidate => ({
          kind: 'card', id: String(c['_id']), title: c['title'] as string,
          tags: (c['tags'] as string[] | undefined) ?? [], due: (c['due_date'] as Date | null) ?? null, base, reasons: [why],
        })
        const itemC = (i: { _id: unknown; title: unknown }, base: number, why: string): Candidate => ({
          kind: 'list_item', id: String(i._id), title: i.title as string, base, reasons: [why],
        })
        // Items tagged to a person whose status (kept by a tracker) is "home".
        const homeNames = sit.statuses.filter(s => s.value.toLowerCase() === 'home').map(s => s.label.toLowerCase())
        const personC: Candidate[] = []
        if (homeNames.length) {
          const persons = await c.entities.people(caller)
          for (const p of persons.filter(p => homeNames.includes(String(p['name']).toLowerCase()))) {
            const pid = String(p['_id']); const who = `${p['name'] as string} is home`
            const [cs, is] = await Promise.all([c.cards.taggedTo(caller, pid, 5), c.lists.taggedTo(caller, pid, 5)])
            personC.push(...cs.map(c => cardC(c, 3, who)), ...is.map(i => itemC(i as { _id: unknown; title: unknown }, 3, who)))
          }
        }
        // Follow-through: things put off SNOOZED_OFTEN+ times, with the first step it worked out.
        const [stuckCards, stuckItems] = await Promise.all([
          c.cards.snoozedOften(caller, SNOOZED_OFTEN, 3, now),
          c.lists.snoozedOften(caller, SNOOZED_OFTEN, 3, now),
        ])
        const stuckWhy = (d: Record<string, unknown>) => {
          const step = (d['followthrough'] as { first_step?: string | null } | null | undefined)?.first_step
          return [`snoozed ${Number(d['defer_count'])} times`, step ? `first step: ${step}` : 'a 5-minute start, a new date, or let it go']
        }
        const stuck: Candidate[] = [
          ...stuckCards.map(d => ({ ...cardC(d, 3, ''), reasons: stuckWhy(d) })),
          ...stuckItems.map(d => ({ ...itemC(d as { _id: unknown; title: unknown }, 3, ''), reasons: stuckWhy(d) })),
        ]
        const here = presencePlace?.name ?? 'here'
        const all: Candidate[] = [
          ...urgent.map(c => cardC(c, 5, 'overdue')),
          ...dueToday.map(c => cardC(c, 3, 'due today')),
          ...habits.map(c => cardC(c, 2, 'a habit for this time of day')),
          // Column priority is ordinal (1 = highest), so 1 scores 5 and 5 scores 1.
          ...boardCards.map(c => cardC(c, 6 - c.column.priority, `in ${c.column.title}`)),
          ...locationCards.map(c => itemC(c, 3, `tagged to ${here}`)).map(c => ({ ...c, kind: 'card' as const })),
          ...entityListItems.map(i => itemC(i, 2, `pick up at ${here}`)),
          // Timed list items (Ah! Rhythm's, or any with a due time) rank higher once their time has come.
          ...listItems.map(i => {
            const due = i['due_at'] as Date | null | undefined
            const now_ = due && due.getTime() <= now.getTime()
            return itemC(i as { _id: unknown; title: unknown }, now_ ? 3 : 2,
              now_ ? `due ${due!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}` : 'due today')
          }),
          ...personC,
          ...stuck,
        ]
        // The same item from several sections: keep the strongest, merge the reasons.
        const byId = new Map<string, Candidate>()
        for (const c of all) {
          const prev = byId.get(c.id)
          byId.set(c.id, prev ? { ...prev, base: Math.max(prev.base, c.base) + 1, reasons: [...prev.reasons, ...c.reasons] } : c)
        }
        focus = pickFocus([...byId.values()], sit, tz)
      }

      // AI briefing — see BRIEFING_* above for when it is regenerated
      const cacheKey = String(orgId)
      const cached = await briefings.get(cacheKey)
        .then(raw => (raw ? JSON.parse(raw) as CachedBriefing : null)).catch(() => null)
      const age = cached ? now.getTime() - Date.parse(cached.ts) : Infinity
      const place = presenceRaw ?? 'unknown'
      const reason =
        !cached ? 'first'
        : cached.presence !== place ? 'location'
        : cached.tod !== tod ? 'time_of_day'
        : req.query.fresh === '1' && age >= BRIEFING_OPEN_MS ? 'open'
        : age >= BRIEFING_MAX_AGE_MS ? 'stale'
        : null

      let briefing: string | null = cached?.text ?? null
      const hasWork = (urgent.length + dueToday.length + habits.length + calendarEvents.length) > 0
      const ai = reason && hasWork ? await c.settings.aiKey(caller) : null
      const apiKey = ai?.key
      const countKey = `calls:${orgId}:${now.toISOString().slice(0, 10)}`
      const callsToday = reason && hasWork ? Number(await briefings.get(countKey) ?? 0) : 0

      if (reason && hasWork && callsToday >= BRIEFING_DAILY_CAP) {
        req.log.warn({ reason, callsToday }, 'briefing: daily cap reached, reusing cached text')
      } else if (reason && hasWork && apiKey) {
        try {
          const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
          const calLines = calendarEvents.slice(0, 5).map(ev =>
            ev.all_day ? ev.title : `${ev.title} at ${fmtTime(ev.start)}`
          )

          // Early in the week, last week's patterns (modules/patterns) give the briefing more to go on.
          const week = await c.trail.ofType(caller, ['ah-patterns/week@1'], new Date(now.getTime() - 3 * 86_400_000)).catch(() => [])
          const context = [
            urgent.length > 0 ? `${urgent.length} overdue tasks: ${urgent.map(c => c['title']).join(', ')}` : '',
            dueToday.length > 0 ? `${dueToday.length} due today: ${dueToday.map(c => c['title']).join(', ')}` : '',
            habits.length > 0 ? `habits now: ${habits.map(c => `${c['title']} (streak: ${(c['recurrence'] as Record<string, unknown>)?.['streak_count'] ?? 0})`).join(', ')}` : '',
            calLines.length > 0 ? `upcoming appointments (next 16h): ${calLines.join(', ')}` : '',
            presenceEntity ? `currently at: ${presenceEntity.name}` : '',
            week.length ? `last week: ${week.at(-1)!.text.replace(/^📈\s*/, '')}` : '',
          ].filter(Boolean).join('. ')

          ai!.used()
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 150,
              messages: [{
                role: 'user',
                content: `You are helping someone with ADHD stay on track. Write 1-2 plain sentences. Be calm, warm, and specific — never alarming. Look at the next 16 hours: if something is needed in the morning (a meeting, appointment, or deadline), suggest preparing tonight before bed so morning-you has less to scramble. If something is due later today, explain why now is a natural window to make progress. Give a concrete reason that makes starting feel easy, not pressured. Context: ${context}. Time of day: ${tod}. No fluff, no "Hey!", no exclamation marks, no shame.`
              }]
            })
          })
          if (res.ok) {
            const d = await res.json() as { content: Array<{ type: string; text: string }> }
            const text = d.content[0]?.text?.trim()
            if (text) {
              briefing = text
              const entry: CachedBriefing = { text, presence: place, tod, ts: now.toISOString() }
              await briefings.set(cacheKey, JSON.stringify(entry), 24 * 3600)
              const calls = await briefings.incr(countKey)
              if (calls === 1) await briefings.expire(countKey, 8 * 24 * 3600)
              req.log.info({ reason, callsToday: calls }, 'briefing generated')
            }
          } else {
            req.log.warn({ status: res.status, reason }, 'briefing: AI call failed, reusing cached text')
          }
        } catch (err) {
          req.log.warn({ err, reason }, 'briefing unavailable, reusing cached text')
        }
      }
      if (!hasWork) briefing = null

      // A bad tz or a down trail store leaves the streak out rather than failing Today.
      const streakInfo = await streak(c, caller, tz).catch(() => null)

      // Sort each section: time-chunk-matched cards float first. Then the person's limit.
      const { sections, limit } = applyLimit({
        urgent:    sortByTimeChunk(urgent,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], column_id: c['column_id'], ref: c['ref'] })),
        habits:    sortByTimeChunk(habits,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], recurrence: c['recurrence'], ref: c['ref'] })),
        due_today: sortByTimeChunk(dueToday,  localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], priority: c['priority'], column_id: c['column_id'], ref: c['ref'] })),
        location_context: locationCards,
        board:     boardCards.map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'] ?? null, column_id: c['column_id'], ref: c['ref'], column: c.column.title, column_priority: c.column.priority })),
        resurfaced: sortByTimeChunk(resurfaced, localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'] })),
        entity_list_items: entityListItems,
        list_items: listItems.map(i => ({ _id: i['_id'], title: i['title'], due_at: i['due_at'], repeat: i['repeat'] ?? 'once' })),
        nudges:     nudges.map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'], recurrence: c['recurrence'], created_at: c['created_at'] })),
        upcoming,
      }, await c.settings.todayLimit(caller).catch(() => null))

      return {
        data: {
          context: {
            time_of_day:    tod,
            presence:       presenceRaw ?? 'unknown',
            presence_entity: presenceEntity,
            generated_at:   now.toISOString(),
          },
          ...sections,
          limit,
          due_window: dueWindow,
          trail_pulse: trailPulse,
          calendar_events: calendarEvents,
          briefing,
          streak: streakInfo,
          situation: sit,
          focus,
        }
      }
    }
  )
}

export default nowRoutes
