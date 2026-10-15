import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import type { Caller, Doc } from './index.js'

/** Hidden by "Not now" / snooze until defer_until has passed. */
const visibleAt = (now: Date) => ({ $or: [{ defer_until: null }, { defer_until: { $lte: now } }] })

const CARD_PRIORITY: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** Column priority in Ah! Today is ordinal: 1 is the highest, 5 the lowest. */
export const DEFAULT_TODAY_PRIORITY = 3

/** A board column that feeds Ah! Today (board_columns.in_today), as Today sees it. */
export interface TodayColumn { _id: string; title: string; priority: number }

export function cardsCore(fastify: FastifyInstance) {
  const cards = () => fastify.mongo.collection<Doc>('board_cards')
  const columns = () => fastify.mongo.collection<Doc>('board_columns')
  const spaces = () => fastify.mongo.collection<Doc>('spaces')
  const open = (c: Caller) => ({ org_id: c.orgId, done: { $ne: true }, deleted_at: { $exists: false } })
  return {
    /** Open cards due before [before], most overdue first. */
    overdue: (c: Caller, before: Date, now: Date, limit: number) =>
      cards().find({ ...open(c), due_date: { $lt: before }, ...visibleAt(now) }).sort({ due_date: 1 }).limit(limit).toArray(),

    /** Open cards due in [start, end], highest priority first. */
    dueBetween: (c: Caller, start: Date, end: Date, now: Date, limit: number) =>
      cards().find({ ...open(c), due_date: { $gte: start, $lte: end }, ...visibleAt(now) }).sort({ priority: -1 }).limit(limit).toArray(),

    /**
     * Open, visible cards in columns switched on for Ah! Today, each with its column.
     * Column priority is ordinal: 1 first (In Progress before To Do), then card priority,
     * then board order. Columns of deleted boards are left out.
     */
    inTodayColumns: async (c: Caller, now: Date, limit: number): Promise<Array<Doc & { column: TodayColumn }>> => {
      const cols = await columns().find({ org_id: c.orgId, in_today: true, deleted_at: { $exists: false } }).toArray()
      if (!cols.length) return []
      const live = new Set((await spaces()
        .find({ _id: { $in: cols.map(x => x['space_id'] as ObjectId) }, deleted_at: { $exists: false } }, { projection: { _id: 1 } })
        .toArray()).map(s => String(s._id)))
      const byId = new Map(cols.filter(x => live.has(String(x['space_id']))).map(x => [String(x._id), {
        _id: String(x._id), title: x['title'] as string, priority: Number(x['today_priority'] ?? DEFAULT_TODAY_PRIORITY), position: Number(x['position'] ?? 0),
      }]))
      if (!byId.size) return []
      const found = await cards().find({ ...open(c), column_id: { $in: cols.filter(x => byId.has(String(x._id))).map(x => x._id) }, ...visibleAt(now) }).toArray()
      const col = (d: Doc) => byId.get(String(d['column_id']))!
      return found
        .sort((a, b) => col(a).priority - col(b).priority || col(a).position - col(b).position ||
          (CARD_PRIORITY[String(b['priority'])] ?? 0) - (CARD_PRIORITY[String(a['priority'])] ?? 0) ||
          Number(a['position'] ?? 0) - Number(b['position'] ?? 0))
        .slice(0, limit)
        .map(d => { const { position: _, ...column } = col(d); return { ...d, column } })
    },

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

    /** Open cards the person has snoozed at least [min] times (lib: defer_count), most snoozed first. */
    snoozedOften: (c: Caller, min: number, limit: number, now?: Date) =>
      cards().find({ ...open(c), defer_count: { $gte: min }, ...(now ? visibleAt(now) : {}) }).sort({ defer_count: -1 }).limit(limit).toArray(),

    /** Open cards snoozed at least once since [since]. */
    snoozedSince: (c: Caller, since: Date) =>
      cards().find({ ...open(c), last_deferred_at: { $gte: since } }).toArray(),

    /** What Follow-through worked out for a card (first step etc.). */
    setFollowThrough: (c: Caller, id: Doc['_id'], ft: Record<string, unknown>) =>
      cards().updateOne({ _id: id, org_id: c.orgId }, { $set: { followthrough: ft } }),

    /** Habit cards on a streak of at least [min], longest first. */
    habitStreaks: (c: Caller, min: number, limit: number) =>
      cards().find({ org_id: c.orgId, deleted_at: { $exists: false }, 'recurrence.archetype': 'habit', 'recurrence.streak_count': { $gte: min } })
        .sort({ 'recurrence.streak_count': -1 }).limit(limit).toArray(),
  }
}
