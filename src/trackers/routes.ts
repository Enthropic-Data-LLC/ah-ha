import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { matches, matchSchema, trackerSchema } from './match.js'
import { ownerTz, recentEntries, setStatus, type StoredTracker } from './engine.js'

/**
 * Trackers (rules over the trail) and the statuses they keep. Not in any app scope:
 * connected apps can't read or change them, only the person and full-access keys.
 */
const trackerRoutes: FastifyPluginAsync = async (fastify) => {
  const trackers = () => fastify.mongo.collection<StoredTracker>('trackers')
  const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null)

  /** A new or changed tracker sets its status from the newest matching entry of the last 2 weeks. */
  async function backfill(t: StoredTracker) {
    if (!t.status || !t.on) return
    const hit = (await recentEntries(t.org_id)).find(e => matches(t.match, e))
    if (hit) await setStatus(fastify, t, hit, await ownerTz(fastify, t.owner_id))
  }

  fastify.get('/api/trackers', { preHandler: fastify.authenticate }, async (req) => {
    const list = await trackers().find({ org_id: req.user!.orgId }).sort({ created_at: 1 }).toArray()
    return { data: list }
  })

  fastify.post('/api/trackers', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = trackerSchema.parse(req.body)
    const now = new Date()
    const t = { _id: new ObjectId(), ...body, org_id: req.user!.orgId, owner_id: req.user!.id, fired: 0, created_at: now, updated_at: now }
    await trackers().insertOne(t as StoredTracker)
    await backfill(t as StoredTracker).catch(err => req.log.warn({ err }, 'status backfill failed'))
    reply.status(201)
    return { data: t }
  })

  fastify.put<{ Params: { id: string } }>('/api/trackers/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const id = oid(req.params.id)
    if (!id) return reply.status(404).send({ error: 'Not found' })
    const body = trackerSchema.parse(req.body)
    const t = await trackers().findOneAndUpdate(
      { _id: id, org_id: req.user!.orgId },
      { $set: { ...body, updated_at: new Date() } },
      { returnDocument: 'after' },
    )
    if (!t) return reply.status(404).send({ error: 'Not found' })
    await backfill(t).catch(err => req.log.warn({ err }, 'status backfill failed'))
    return { data: t }
  })

  fastify.delete<{ Params: { id: string } }>('/api/trackers/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const id = oid(req.params.id)
    const r = id ? await trackers().deleteOne({ _id: id, org_id: req.user!.orgId }) : { deletedCount: 0 }
    if (!r.deletedCount) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })

  // POST /api/trackers/test — which recent entries (2 weeks) a match would have caught, newest first.
  fastify.post('/api/trackers/test', { preHandler: fastify.authenticate }, async (req) => {
    const match = matchSchema.parse((req.body as { match?: unknown } | undefined)?.match)
    const hits = (await recentEntries(req.user!.orgId)).filter(e => matches(match, e))
    return { data: { count: hits.length, recent: hits.slice(0, 5).map(e => ({ text: e.text, source: e.source, tags: e.tags, ts: e.ts })) } }
  })

  // Statuses kept by trackers ("Lauri: home since 5:42 PM").
  fastify.get('/api/statuses', { preHandler: fastify.authenticate }, async (req) => {
    const list = await fastify.mongo.collection('statuses').find({ org_id: req.user!.orgId }).sort({ label: 1 }).toArray()
    return { data: list.map(s => ({ label: s['label'], value: s['value'], detail: s['detail'], since: s['since'], last_at: s['last_at'], today: s['today'] })) }
  })

  fastify.delete<{ Params: { label: string } }>('/api/statuses/:label', { preHandler: fastify.authenticate }, async (req, reply) => {
    const r = await fastify.mongo.collection('statuses').deleteOne({ org_id: req.user!.orgId, key: req.params.label.trim().toLowerCase() })
    if (!r.deletedCount) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })
}

export default trackerRoutes
