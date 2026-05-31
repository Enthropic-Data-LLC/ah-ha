import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'

const TIME_ANCHOR_HOURS: Record<string, number> = {
  morning: 7,
  midday:  12,
  evening: 18,
  night:   21,
}

function nextHabitDue(timeAnchor: string): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(TIME_ANCHOR_HOURS[timeAnchor] ?? 8, 0, 0, 0)
  return d
}

function nextScheduleDue(dayOfWeek: number | null, dayOfMonth: number | null): Date {
  const now = new Date()
  const d   = new Date(now)
  if (dayOfWeek !== null) {
    const diff = (dayOfWeek - d.getDay() + 7) % 7 || 7
    d.setDate(d.getDate() + diff)
    d.setHours(8, 0, 0, 0)
    return d
  }
  if (dayOfMonth !== null) {
    d.setDate(dayOfMonth)
    d.setHours(8, 0, 0, 0)
    if (d <= now) d.setMonth(d.getMonth() + 1)
    return d
  }
  d.setDate(d.getDate() + 7)
  d.setHours(8, 0, 0, 0)
  return d
}

function nextIntervalDue(intervalDays: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + intervalDays)
  d.setHours(8, 0, 0, 0)
  return d
}

type RecDoc = {
  archetype: 'habit' | 'schedule' | 'interval' | 'seasonal'
  time_anchor?: string
  streak_count?: number
  streak_best?: number
  day_of_week?: number | null
  day_of_month?: number | null
  interval_days?: number
  last_completed_at?: Date | null
  completions?: number
}

const recurrenceRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /api/cards/:id/complete
  fastify.post<{ Params: { id: string } }>(
    '/api/cards/:id/complete',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const cardId = new ObjectId(req.params.id)

      const card = await fastify.mongo.collection('board_cards').findOne({
        _id: cardId,
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      })
      if (!card) return reply.status(404).send({ error: 'Card not found' })

      const rec = card['recurrence'] as RecDoc | null | undefined
      const now = new Date()

      const updates: Record<string, unknown> = {
        updated_at:  now,
        defer_until: null,  // clear any active snooze on completion
      }

      if (!rec) {
        // Non-recurring: mark done
        updates['done'] = true
      } else {
        const completions = (rec.completions ?? 0) + 1

        switch (rec.archetype) {
          case 'habit': {
            const newStreak = (rec.streak_count ?? 0) + 1
            updates['recurrence'] = {
              ...rec,
              streak_count:       newStreak,
              streak_best:        Math.max(rec.streak_best ?? 0, newStreak),
              last_completed_at:  now,
              completions,
            }
            updates['due_date'] = nextHabitDue(rec.time_anchor ?? 'morning')
            break
          }
          case 'schedule': {
            updates['recurrence'] = { ...rec, last_completed_at: now, completions }
            updates['due_date'] = nextScheduleDue(
              rec.day_of_week   ?? null,
              rec.day_of_month  ?? null
            )
            break
          }
          case 'interval':
          case 'seasonal': {
            updates['recurrence'] = { ...rec, last_completed_at: now, completions }
            updates['due_date'] = nextIntervalDue(rec.interval_days ?? 7)
            updates['interval_notified'] = false  // allow next nudge notification
            break
          }
        }
      }

      await fastify.mongo.collection('board_cards').updateOne(
        { _id: cardId },
        { $set: updates }
      )

      // WebSocket broadcast so all open board views refresh
      const spaceRef = ((card['ref'] as string) ?? '').split('#')[0]!
      fastify.redis.publish(`ws:${spaceRef}`, JSON.stringify({
        op:           'card.completed',
        ref:          card['ref'],
        archetype:    rec?.archetype ?? 'none',
        streak_count: rec?.archetype === 'habit' ? ((rec.streak_count ?? 0) + 1) : undefined,
      })).catch(() => {})

      const updated = await fastify.mongo.collection('board_cards').findOne({ _id: cardId })
      return { data: updated }
    }
  )

  // POST /api/cards/:id/defer — quick defer from Now page (no board slug needed)
  fastify.post<{ Params: { id: string } }>(
    '/api/cards/:id/defer',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const cardId = new ObjectId(req.params.id)
      const { defer_until } = (req.body as { defer_until?: string }) ?? {}

      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: cardId, org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { defer_until: defer_until ? new Date(defer_until) : null, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Card not found' })
      return { ok: true }
    }
  )
}

export default recurrenceRoutes
