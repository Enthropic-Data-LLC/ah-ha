import type { FastifyInstance } from 'fastify'
import type { Caller, Doc } from './index.js'
import { reopenAlways } from '../lib/repeat.js'

const visibleAt = (now: Date) => ({ $or: [{ defer_until: null }, { defer_until: { $lte: now } }] })

export function listsCore(fastify: FastifyInstance) {
  const items = () => fastify.mongo.collection<Doc>('list_items')
  const open = (c: Caller) => ({ org_id: c.orgId, done: false, deleted_at: { $exists: false } })
  return {
    /** Bring "always" items checked before today back (lib/repeat). [tz] defaults to the user's own. */
    reopenAlways: (c: Caller, tz?: string) => reopenAlways(fastify, c.orgId, c.userId, tz),

    /** Open, visible list items due by [end], soonest first. */
    dueBy: (c: Caller, end: Date, now: Date, limit: number) =>
      items().find({ ...open(c), due_at: { $lte: end }, ...visibleAt(now) }).sort({ due_at: 1 }).limit(limit).toArray(),

    /** Open list items tagged to a place or person; with [now], snoozed ones are left out. */
    taggedTo: (c: Caller, entityId: string, limit: number, now?: Date) =>
      items().find({ ...open(c), 'contexts.entity_id': entityId, ...(now ? visibleAt(now) : {}) }).limit(limit).toArray(),

    /** When items were checked since [since], deleted ones included (for counting active days). */
    doneTimes: (c: Caller, since: Date) =>
      items().find({ org_id: c.orgId, done_at: { $gte: since } }).project<{ done_at: Date }>({ done_at: 1 }).toArray(),

    /** Items checked since [since] — by done_at, so a reopened "always" item still counts its day. */
    doneSince: (c: Caller, since: Date) =>
      items().find({ org_id: c.orgId, deleted_at: { $exists: false }, done_at: { $gte: since } }).toArray(),
  }
}
