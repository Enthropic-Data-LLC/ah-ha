import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { gateMode, openList } from '../lib/list-progress.js'
import { between } from '../lib/lexorank.js'

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

      // An unfinished list stops a card being completed in either of its gated modes
      // ("move" is the stricter one: it also stops any column change, see the move route).
      // A plain card is only held back where completing would close it — handled below.
      const mode = gateMode(card)
      const open = await openList(fastify, req.user!.orgId, card)
      const refuse = () => reply.status(409).send({
        error: `Finish the list first — ${open!.total - open!.done} of ${open!.total} still open on "${open!.name}"`,
        list_progress: open,
      })

      const rec = card['recurrence'] as RecDoc | null | undefined
      const now = new Date()

      const updates: Record<string, unknown> = {
        updated_at:   now,
        completed_at: now,   // when it was last finished — the evening wrap-up counts these
        defer_until:  null,  // clear any active snooze on completion
        defer_count:  0,     // Follow-through starts over once it's done
        followthrough: null,
      }

      if (!rec) {
        // Non-recurring: completing steps the card to the next column of its board. It only
        // finishes (done) when it lands in a closer column or there is nothing further on.
        const cols = await fastify.mongo.collection('board_columns')
          .find({ space_id: card['space_id'], org_id: req.user!.orgId, deleted_at: { $exists: false } })
          .sort({ position: 1 }).toArray()
        const idx = cols.findIndex(c => String(c._id) === String(card['column_id']))
        const here = cols[idx]
        const next = idx >= 0 && !here?.['closes'] ? cols[idx + 1] : undefined
        const closes = next?.['closes'] as 'done' | 'closed' | null | undefined
        const finishing = !next || !!closes

        if (open && (mode === 'move' ? closes !== 'closed' : finishing && closes !== 'closed')) return refuse()

        if (next) {
          const last = await fastify.mongo.collection('board_cards')
            .findOne({ column_id: next._id, deleted_at: { $exists: false } }, { sort: { position: -1 } })
          updates['column_id'] = next._id
          updates['position'] = between(last ? (last['position'] as number) : null, null)
          updates['done'] = !!closes
          updates['closed_as'] = closes ?? null
          if (closes) updates['done_at'] = now
          // completed_at stays: ticking it off counts for the wrap-up and streak even when it only steps along
        } else {
          updates['done'] = true
          updates['done_at'] = now
        }
      } else {
        if (open) return refuse()
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
      const until = defer_until ? new Date(defer_until) : null
      const now = new Date()

      // A snooze into the future counts toward Follow-through (modules/followthrough).
      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: cardId, org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { defer_until: until, updated_at: now, ...(until && until > now ? { last_deferred_at: now } : {}) },
          ...(until && until > now ? { $inc: { defer_count: 1 } } : {}) }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Card not found' })
      return { ok: true }
    }
  )

  // GET /api/cards/upcoming?hours=24 — open cards due in the next N hours, for phone reminders.
  // Snoozed cards are left out unless the snooze ends before they're due.
  fastify.get<{ Querystring: { hours?: string } }>(
    '/api/cards/upcoming',
    { preHandler: fastify.authenticate },
    async (req) => {
      const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 72)
      const now = new Date()
      const until = new Date(now.getTime() + hours * 3_600_000)
      const cards = await fastify.mongo.collection('board_cards').find({
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
        done: { $ne: true },
        due_date: { $gt: now, $lte: until },
      }).sort({ due_date: 1 }).limit(100).toArray()
      return {
        data: cards
          .filter(c => !c['defer_until'] || new Date(c['defer_until'] as Date) <= new Date(c['due_date'] as Date))
          .map(c => ({ _id: c['_id'], title: c['title'], due_date: c['due_date'], ref: c['ref'], recurrence: c['recurrence'] ?? null })),
      }
    }
  )

  // GET /api/cards/:id — fetch a single card by ID (no board slug needed)
  fastify.get<{ Params: { id: string } }>(
    '/api/cards/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const cardId = new ObjectId(req.params.id)
      const card = await fastify.mongo.collection('board_cards').findOne({
        _id: cardId,
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      })
      if (!card) return reply.status(404).send({ error: 'Not found' })
      return { data: card }
    }
  )
}

export default recurrenceRoutes
