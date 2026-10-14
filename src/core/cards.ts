import type { FastifyInstance } from 'fastify'
import type { Caller, Doc } from './index.js'

/** Hidden by "Not now" / snooze until defer_until has passed. */
const visibleAt = (now: Date) => ({ $or: [{ defer_until: null }, { defer_until: { $lte: now } }] })

export function cardsCore(fastify: FastifyInstance) {
  const cards = () => fastify.mongo.collection<Doc>('board_cards')
  const open = (c: Caller) => ({ org_id: c.orgId, done: { $ne: true }, deleted_at: { $exists: false } })
  return {
    /** Open cards due before [before], most overdue first. */
    overdue: (c: Caller, before: Date, now: Date, limit: number) =>
      cards().find({ ...open(c), due_date: { $lt: before }, ...visibleAt(now) }).sort({ due_date: 1 }).limit(limit).toArray(),

    /** Open cards due in [start, end], highest priority first. */
    dueBetween: (c: Caller, start: Date, end: Date, now: Date, limit: number) =>
      cards().find({ ...open(c), due_date: { $gte: start, $lte: end }, ...visibleAt(now) }).sort({ priority: -1 }).limit(limit).toArray(),

    /** Open habit cards anchored to this part of the day (morning | midday | evening | night). */
    habitsAt: (c: Caller, anchor: string, limit: number) =>
      cards().find({ ...open(c), 'recurrence.archetype': 'habit', 'recurrence.time_anchor': anchor }).limit(limit).toArray(),

    /** Open cards whose snooze ended within [since, now]. */
    resurfaced: (c: Caller, since: Date, now: Date, limit: number) =>
      cards().find({ ...open(c), defer_until: { $gte: since, $lte: now } }).limit(limit).toArray(),

    /** Open, visible recurring cards of these archetypes (interval, seasonal…). */
    recurring: (c: Caller, archetypes: string[], now: Date) =>
      cards().find({ ...open(c), 'recurrence.archetype': { $in: archetypes }, ...visibleAt(now) }).toArray(),

    /** Open cards tagged to a place or person; with [now], snoozed ones are left out. */
    taggedTo: (c: Caller, entityId: string, limit: number, now?: Date) =>
      cards().find({ ...open(c), 'contexts.entity_id': entityId, ...(now ? visibleAt(now) : {}) }).limit(limit).toArray(),

    /** Cards finished since [since]: one-off completions and recurring check-offs. */
    completedSince: (c: Caller, since: Date) =>
      cards().find({
        org_id: c.orgId, deleted_at: { $exists: false },
        $or: [{ completed_at: { $gte: since } }, { 'recurrence.last_completed_at': { $gte: since } }],
      }).toArray(),

    /** When cards were completed since [since] (for counting active days). */
    completionTimes: (c: Caller, since: Date) =>
      cards().find({ org_id: c.orgId, completed_at: { $gte: since } }).project<{ completed_at: Date }>({ completed_at: 1 }).toArray(),

    /** Habit cards on a streak of at least [min], longest first. */
    habitStreaks: (c: Caller, min: number, limit: number) =>
      cards().find({ org_id: c.orgId, deleted_at: { $exists: false }, 'recurrence.archetype': 'habit', 'recurrence.streak_count': { $gte: min } })
        .sort({ 'recurrence.streak_count': -1 }).limit(limit).toArray(),
  }
}
