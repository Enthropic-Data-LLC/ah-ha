import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { getPool } from '../lib/timescale.js'

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
  return [...cards].sort((a, b) => {
    const aMatch = matchesTimeChunks((a['time_chunks'] as string[] | undefined) ?? [], hour, dow) && (a['time_chunks'] as string[] | undefined)?.length ? 1 : 0
    const bMatch = matchesTimeChunks((b['time_chunks'] as string[] | undefined) ?? [], hour, dow) && (b['time_chunks'] as string[] | undefined)?.length ? 1 : 0
    return bMatch - aMatch  // matched cards (1) sort before unmatched (0)
  })
}

const TIME_OF_DAY = (h: number) => {
  if (h >= 5  && h < 10) return 'morning'
  if (h >= 10 && h < 17) return 'active'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

const OID_RE = /^[0-9a-f]{24}$/i

const nowRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { presence?: string; tz?: string } }>(
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
      let presenceRaw = req.query.presence as string | undefined
      if (!presenceRaw) {
        const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
        const username = user?.['username'] as string | undefined
        if (username) {
          const raw = await fastify.redis.get(`aha:presence:state:${username}`)
          presenceRaw = raw ?? 'unknown'
        }
      }

      // Resolve entity if presence looks like an ObjectId
      let presenceEntity: { _id: string; name: string; icon: string; time_chunks: string[] } | null = null
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        try {
          const ent = await fastify.mongo.collection('entities').findOne({ _id: new ObjectId(presenceRaw) })
          if (ent) presenceEntity = { _id: ent['_id'].toString(), name: ent['name'] as string, icon: ent['icon'] as string, time_chunks: (ent['time_chunks'] as string[] | undefined) ?? [] }
        } catch { /* entity not found */ }
      }

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

      // Location-context cards — only when checked in to an entity
      // If entity has time_chunks, only surface cards during matching windows
      let locationCards: Array<{ _id: string; title: string; ref?: string }> = []
      let presenceTimeChunks: string[] = []
      if (presenceRaw && OID_RE.test(presenceRaw) && presenceEntity) {
        presenceTimeChunks = (presenceEntity as unknown as { time_chunks?: string[] }).time_chunks ?? []
        if (matchesTimeChunks(presenceTimeChunks, localHour, localDow)) {
          const raw = await fastify.mongo.collection('board_cards').find({
            org_id: orgId,
            done: { $ne: true },
            deleted_at: { $exists: false },
            contexts: presenceRaw,
            $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
          }).limit(8).toArray()
          locationCards = raw.map(c => ({ _id: c['_id'].toString(), title: c['title'] as string, ref: c['ref'] as string | undefined }))
        }
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

      // AI briefing
      let briefing: string | null = null
      const settings = await fastify.mongo.collection('user_settings').findOne({ user_id: req.user!.id })
      const apiKey = (settings?.['anthropic_api_key'] as string | null) ?? process.env['ANTHROPIC_API_KEY']

      if (apiKey && (urgent.length + dueToday.length + habits.length) > 0) {
        try {
          const context = [
            urgent.length > 0 ? `${urgent.length} overdue: ${urgent.map(c => c['title']).join(', ')}` : '',
            dueToday.length > 0 ? `${dueToday.length} due today: ${dueToday.map(c => c['title']).join(', ')}` : '',
            habits.length > 0 ? `habits now: ${habits.map(c => `${c['title']} (streak: ${(c['recurrence'] as Record<string, unknown>)?.['streak_count'] ?? 0})`).join(', ')}` : '',
            presenceEntity ? `currently at: ${presenceEntity.name}` : '',
          ].filter(Boolean).join('. ')

          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 100,
              messages: [{
                role: 'user',
                content: `Write one plain, supportive sentence (no fluff, no "Hey!", no alarming language) that helps the person focus on what matters right now: ${context}. Time of day: ${tod}. Tone: calm, encouraging, never shame-y or urgent.`
              }]
            })
          })
          if (res.ok) {
            const d = await res.json() as { content: Array<{ type: string; text: string }> }
            briefing = d.content[0]?.text?.trim() ?? null
          }
        } catch { /* briefing unavailable */ }
      }

      return {
        data: {
          context: {
            time_of_day:    tod,
            presence:       presenceRaw ?? 'unknown',
            presence_entity: presenceEntity,
            generated_at:   now.toISOString(),
          },
          // Sort each section: time-chunk-matched cards float first
          urgent:    sortByTimeChunk(urgent,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], column_id: c['column_id'], ref: c['ref'], time_chunks: c['time_chunks'] })),
          due_today: sortByTimeChunk(dueToday,  localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], priority: c['priority'], column_id: c['column_id'], ref: c['ref'], time_chunks: c['time_chunks'] })),
          habits:    sortByTimeChunk(habits,    localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], recurrence: c['recurrence'], ref: c['ref'], time_chunks: c['time_chunks'] })),
          resurfaced: sortByTimeChunk(resurfaced, localHour, localDow).map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'], time_chunks: c['time_chunks'] })),
          nudges:     nudges.map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'], recurrence: c['recurrence'], created_at: c['created_at'], time_chunks: c['time_chunks'] })),
          list_items: listItems.map(i => ({ _id: i['_id'], title: i['title'], due_at: i['due_at'] })),
          location_context: locationCards,
          trail_pulse: trailPulse,
          briefing,
        }
      }
    }
  )
}

export default nowRoutes
