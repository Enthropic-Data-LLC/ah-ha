import type { FastifyInstance } from 'fastify'
import type { Caller, Doc } from './index.js'
import { reopenAlways } from '../lib/repeat.js'

const visibleAt = (now: Date) => ({ $or: [{ defer_until: null }, { defer_until: { $lte: now } }] })

export function listsCore(fastify: FastifyInstance) {
  const items = () => fastify.mongo.collection<Doc>('list_items')
  const open = (c: Caller) => ({ org_id: c.orgId, done: false, deleted_at: { $exists: false } })
  return {
    /** A list space by slug (null if the user has none). */
    space: (c: Caller, slug: string) =>
      fastify.mongo.collection<Doc>('spaces').findOne({ org_id: c.orgId, type: 'list', slug, deleted_at: { $exists: false } }),

    /** Every item a list has had since [since], done and deleted ones included (for learning from it). */
    history: (c: Caller, spaceId: Doc['_id'], since: Date) =>
      items().find({ org_id: c.orgId, space_id: spaceId, $or: [{ created_at: { $gte: since } }, { done_at: { $gte: since } }] }).toArray(),

    /**
     * Add an item through the public list route, as the caller, so it is checked and
     * positioned like any other. [source] + [reason] say which module added it and why.
     */
    add: async (c: Caller, slug: string, item: { title: string; source?: string; reason?: string; contexts?: unknown[] }) => {
      const res = await fastify.inject({ method: 'POST', url: `/api/list/${encodeURIComponent(slug)}/items`, headers: c.auth, payload: item })
      if (res.statusCode >= 300) throw new Error(`add to ${slug} → ${res.statusCode} ${res.body.slice(0, 120)}`)
      return (res.json() as { data: Doc }).data
    },

    /** Open list items the person has snoozed at least [min] times, most snoozed first. */
    snoozedOften: (c: Caller, min: number, limit: number, now?: Date) =>
      items().find({ ...open(c), defer_count: { $gte: min }, ...(now ? visibleAt(now) : {}) }).sort({ defer_count: -1 }).limit(limit).toArray(),

    /** What Follow-through worked out for a list item. */
    setFollowThrough: (c: Caller, id: Doc['_id'], ft: Record<string, unknown>) =>
      items().updateOne({ _id: id, org_id: c.orgId }, { $set: { followthrough: ft } }),

    /** Bring "always" items checked before today back (lib/repeat). [tz] defaults to the user's own. */
    reopenAlways: (c: Caller, tz?: string) => reopenAlways(fastify, c.orgId, c.userId, tz),

    /** Open, visible list items due by [end], soonest first. */
    /** Open items due after [after] and up to [until] (null = no end), soonest first. */
    dueAfter: (c: Caller, after: Date, until: Date | null, now: Date, limit: number) =>
      items().find({ ...open(c), due_at: { $gt: after, ...(until ? { $lte: until } : {}) }, ...visibleAt(now) }).sort({ due_at: 1 }).limit(limit).toArray(),

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
