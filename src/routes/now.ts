import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { getPool } from '../lib/timescale.js'

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
      let presenceEntity: { _id: string; name: string; icon: string } | null = null
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        try {
          const ent = await fastify.mongo.collection('entities').findOne({ _id: new ObjectId(presenceRaw) })
          if (ent) presenceEntity = { _id: ent['_id'].toString(), name: ent['name'] as string, icon: ent['icon'] as string }
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

      // Interval nudges (at 80% of interval)
      const nudges = await fastify.mongo.collection('board_cards').find({
        org_id: orgId,
        done: { $ne: true },
        deleted_at: { $exists: false },
        'recurrence.archetype': 'interval',
        $where: function(this: Record<string, unknown>) {
          const rec = this['recurrence'] as { interval_days?: number; last_completed_at?: Date } | undefined
          if (!rec?.interval_days || !rec?.last_completed_at) return false
          const threshold = rec.interval_days * 0.8 * 86400000
          return Date.now() - new Date(rec.last_completed_at).getTime() >= threshold
        },
      }).limit(3).toArray()

      // List items due today
      const listItems = await fastify.mongo.collection('list_items').find({
        org_id: orgId,
        done: false,
        deleted_at: { $exists: false },
        due_at: { $lte: todayEnd },
        $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
      }).limit(5).toArray()

      // Location-context cards — only when checked in to an entity
      let locationCards: Array<{ _id: string; title: string; ref?: string }> = []
      if (presenceRaw && OID_RE.test(presenceRaw)) {
        const raw = await fastify.mongo.collection('board_cards').find({
          org_id: orgId,
          done: { $ne: true },
          deleted_at: { $exists: false },
          contexts: presenceRaw,
          $or: [{ defer_until: null }, { defer_until: { $lte: now } }],
        }).limit(8).toArray()
        locationCards = raw.map(c => ({ _id: c['_id'].toString(), title: c['title'] as string, ref: c['ref'] as string | undefined }))
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
                content: `Write one plain, direct sentence (no fluff, no "Hey!") summarizing what matters right now: ${context}. Time of day: ${tod}.`
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
          urgent:    urgent.map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], column_id: c['column_id'], ref: c['ref'] })),
          due_today: dueToday.map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], priority: c['priority'], column_id: c['column_id'], ref: c['ref'] })),
          habits:    habits.map(c => ({ _id: c['_id'], title: c['title'], recurrence: c['recurrence'], ref: c['ref'] })),
          resurfaced: resurfaced.map(c => ({ _id: c['_id'], title: c['title'], ref: c['ref'] })),
          nudges:     nudges.map(c => ({ _id: c['_id'], title: c['title'], recurrence: c['recurrence'], ref: c['ref'] })),
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
