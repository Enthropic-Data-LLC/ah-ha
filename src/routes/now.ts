import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { getPool } from '../lib/timescale.js'
import { fetchCalendarEvents } from '../lib/ical-fetch.js'
import type { CalendarSource } from '../lib/ical-fetch.js'
import { placeFromPresence, presenceRaw as readPresence } from '../lib/places.js'
import { streak } from '../lib/streak.js'

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
  fastify.get<{ Querystring: { presence?: string; tz?: string; fresh?: string } }>(
    '/api/now',
    { preHandler: fastify.authenticate },
    async (req) => {
      const now = new Date()
      const tz = req.query.tz ?? 'UTC'
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)
      )
      const localDow = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay()
      const tod = TIME_OF_DAY(localHour)

      // Presence: query param override > Redis
      const presenceRaw = req.query.presence || await readPresence(fastify, req.user!.id)

      // Resolve entity if presence looks like an ObjectId
      const presencePlace = await placeFromPresence(fastify, req.user!.orgId, presenceRaw)
      const presenceEntity = presencePlace ? { ...presencePlace, time_chunks: [] as string[] } : null

      const orgId = req.user!.orgId
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
      const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)

      // Overdue cards (max 3, sorted by most overdue first)
      const urgent = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        due_date: { $lt: todayStart },
        $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
      }).sort({ due_date: 1 }).limit(3).toArray()

      // Due today
      const dueToday = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        due_date: { $gte: todayStart, $lte: todayEnd },
        $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
      }).sort({ priority: -1 }).limit(5).toArray()

      // Habit cards for this time of day
      const habits = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        'recurrence.archetype': 'habit',
        'recurrence.time_anchor': tod === 'morning' ? 'morning'
          : tod === 'active' ? 'midday'
          : tod === 'evening' ? 'evening' : 'night',
      }).limit(3).toArray()

      // Recently resurfaced (defer expired in last hour)
      const oneHourAgo = new Date(now.getTime() - 3600_000)
      const resurfaced = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        defer_until: { $gte: oneHourAgo, $lte: now },
      }).limit(3).toArray()

      // Interval nudges (at 80% of interval) — filter in Node, not $where (no JS eval in prod)
      const allIntervalCards = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        'recurrence.archetype': { $in: ['interval', 'seasonal'] },
        $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
      }).toArray()

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
      const listItems = await fastify.mongo.collection('list_items').find({
        org_id: orgId,
        done: false,
        deleted_at: { $exists: false },
        due_at: { $lte: todayEnd },
        $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
      }).limit(5).toArray()

      // Entity-tagged list items — surface when checked in, regardless of due date
      let entityListItems: Array<{ _id: string; title: string; space_ref?: string; contexts: unknown }> = []
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        const raw = await fastify.mongo.collection('list_items').find({
          org_id: orgId,
          done: false,
          deleted_at: { $exists: false },
          'contexts.entity_id': presenceRaw,
          $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
        }).limit(20).toArray()

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
        }))
      }

      // Location-context cards — cards tagged for the current entity+time pairing
      // contexts is now Array<{ entity_id, time_chunks[] }>
      // A card matches if: its contexts array has an entry for the current entity
      //   AND that entry's time_chunks is empty (any time) OR matches current time
      let locationCards: Array<{ _id: string; title: string; ref?: string }> = []
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        // Fetch all cards that have a context entry for this entity
        const raw = await fastify.mongo.collection('board_cards').find({
          org_id: orgId,
          done: { $ne: true },
          deleted_at: { $exists: false },
          'contexts.entity_id': presenceRaw,
          $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
        }).limit(20).toArray()

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
        const pool = getPool()
        const trailSpace = await fastify.mongo.collection('spaces').findOne({
          org_id: orgId, type: 'trail', deleted_at: { $exists: false }
        })
        if (trailSpace) {
          const res = await pool.query(
            `SELECT tone, count(*) as cnt FROM trail_entries WHERE space_ref = $1 AND ts >= $2 GROUP BY tone`,
            [trailSpace['ref'], todayStart]
          )
          const totals = res.rows.reduce<Record<string, number>>((a, r) => { a[r.tone] = parseInt(r.cnt); return a }, {})
          const total = Object.values(totals).reduce((s, n) => s + n, 0)
          const topTone = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral'
          trailPulse = { recent_tone: topTone, total_today: total }
        }
      } catch { /* trail unavailable */ }

      // Upcoming calendar events — next 8 hours
      let calendarEvents: Array<{ uid: string; title: string; start: string; end: string; all_day: boolean; location?: string; calendar: string; color: string }> = []
      try {
        const calSources = await fastify.mongo.collection<CalendarSource>('calendar_sources')
          .find({ user_id: req.user!.id }).toArray()
        if (calSources.length > 0) {
          const calEnd = new Date(now.getTime() + 16 * 3_600_000)
          calendarEvents = await fetchCalendarEvents(calSources, now, calEnd, fastify.redis)
        }
      } catch { /* calendar unavailable */ }

      // AI briefing — see BRIEFING_* above for when it is regenerated
      const cacheKey = `aha:briefing:${req.user!.orgId}`
      const cached = await fastify.redis.get(cacheKey)
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
      const settings = reason && hasWork
        ? await fastify.mongo.collection('user_settings').findOne({ user_id: req.user!.id })
        : null
      const apiKey = (settings?.['anthropic_api_key'] as string | null) ?? process.env['ANTHROPIC_API_KEY']
      const countKey = `aha:briefing:calls:${req.user!.orgId}:${now.toISOString().slice(0, 10)}`
      const callsToday = reason && hasWork ? Number(await fastify.redis.get(countKey) ?? 0) : 0

      if (reason && hasWork && callsToday >= BRIEFING_DAILY_CAP) {
        req.log.warn({ reason, callsToday }, 'briefing: daily cap reached, reusing cached text')
      } else if (reason && hasWork && apiKey) {
        try {
          const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
          const calLines = calendarEvents.slice(0, 5).map(ev =>
            ev.all_day ? ev.title : `${ev.title} at ${fmtTime(ev.start)}`
          )

          const context = [
            urgent.length > 0 ? `${urgent.length} overdue tasks: ${urgent.map(c => c['title']).join(', ')}` : '',
            dueToday.length > 0 ? `${dueToday.length} due today: ${dueToday.map(c => c['title']).join(', ')}` : '',
            habits.length > 0 ? `habits now: ${habits.map(c => `${c['title']} (streak: ${(c['recurrence'] as Record<string, unknown>)?.['streak_count'] ?? 0})`).join(', ')}` : '',
            calLines.length > 0 ? `upcoming appointments (next 16h): ${calLines.join(', ')}` : '',
            presenceEntity ? `currently at: ${presenceEntity.name}` : '',
          ].filter(Boolean).join('. ')

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
              await fastify.redis.set(cacheKey, JSON.stringify(entry), 'EX', 24 * 3600)
              const calls = await fastify.redis.incr(countKey)
              if (calls === 1) await fastify.redis.expire(countKey, 8 * 24 * 3600)
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
      const streakInfo = await streak(fastify, orgId, tz).catch(() => null)

      return {
        data: {
          context: {
            time_of_day:    tod,
            presence:       presenceRaw ?? 'unknown',
            presence_entity: presenceEntity,
            generated_at:   now.toISOString(),
          },
          // Sort each section: time-chunk-matched cards float first
          urgent:    sortByTimeChunk(urgent,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], column_id: c['column_id'], ref: c['ref'] })),
          due_today: sortByTimeChunk(dueToday,  localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], priority: c['priority'], column_id: c['column_id'], ref: c['ref'] })),
          habits:    sortByTimeChunk(habits,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], recurrence: c['recurrence'], ref: c['ref'] })),
          resurfaced: sortByTimeChunk(resurfaced, localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'] })),
          nudges:     nudges.map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'], recurrence: c['recurrence'], created_at: c['created_at'] })),
          list_items: listItems.map(i => ({ _id: i['_id'], title: i['title'], due_at: i['due_at'] })),
          entity_list_items: entityListItems,
          location_context: locationCards,
          trail_pulse: trailPulse,
          calendar_events: calendarEvents,
          briefing,
          streak: streakInfo,
        }
      }
    }
  )
}

export default nowRoutes
