import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

export interface ListProgress {
  list_id: string
  slug: string
  name: string
  done: number
  total: number
  /** Nothing left open. An empty list is complete — it asks nothing of the card. */
  complete: boolean
}

/** Running done/total for each list a set of cards points at (one query for all of them). */
export async function listProgressFor(
  fastify: FastifyInstance,
  orgId: ObjectId,
  listIds: ObjectId[],
): Promise<Map<string, ListProgress>> {
  const out = new Map<string, ListProgress>()
  if (listIds.length === 0) return out

  const [spaces, counts] = await Promise.all([
    fastify.mongo.collection('spaces')
      .find({ _id: { $in: listIds }, type: 'list', org_id: orgId, deleted_at: { $exists: false } })
      .toArray(),
    fastify.mongo.collection('list_items').aggregate([
      { $match: { space_id: { $in: listIds }, org_id: orgId, deleted_at: { $exists: false } } },
      { $group: { _id: '$space_id', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$done', true] }, 1, 0] } } } },
    ]).toArray(),
  ])
  const byList = new Map(counts.map(c => [String(c['_id']), c]))
  for (const s of spaces) {
    const c = byList.get(String(s._id))
    const total = (c?.['total'] as number | undefined) ?? 0
    const done = (c?.['done'] as number | undefined) ?? 0
    out.set(String(s._id), {
      list_id: String(s._id),
      slug: s['slug'] as string,
      name: s['name'] as string,
      done,
      total,
      complete: done >= total,
    })
  }
  return out
}

/** Attach `list_progress` to every card that has a list. */
export async function withListProgress<T extends Record<string, unknown>>(
  fastify: FastifyInstance,
  orgId: ObjectId,
  cards: T[],
): Promise<Array<T & { list_progress?: ListProgress }>> {
  const ids = [...new Set(cards.map(c => c['list_id']).filter((v): v is ObjectId => v instanceof ObjectId).map(String))]
    .map(s => new ObjectId(s))
  const progress = await listProgressFor(fastify, orgId, ids)
  return cards.map(c => {
    const p = c['list_id'] ? progress.get(String(c['list_id'])) : undefined
    return p ? { ...c, list_progress: p } : c
  })
}
