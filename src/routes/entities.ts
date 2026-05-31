import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'

const signatureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gps'), lat: z.number(), lng: z.number(), radius_m: z.number().default(100) }),
  z.object({ kind: z.literal('network'), external_ip: z.string() }),
  z.object({ kind: z.literal('bluetooth_le'), local_name: z.string(), uuid: z.string().optional() }),
])

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const entityRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/entities
  fastify.get('/api/entities', { preHandler: fastify.authenticate }, async (req) => {
    const entities = await fastify.mongo.collection('entities')
      .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
      .sort({ updated_at: -1 })
      .toArray()
    return { data: entities }
  })

  // POST /api/entities
  fastify.post('/api/entities', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({
      name:        z.string().min(1).max(100),
      icon:        z.string().default('📍'),
      entity_type: z.enum(['place', 'person']).default('place'),
      color:       z.string().default('#818cf8'),
    }).parse(req.body)

    const now = new Date()
    const entity = {
      _id: new ObjectId(),
      ...body,
      owner_id:       req.user!.id,
      org_id:         req.user!.orgId,
      signatures:     [],
      presence_token: new ObjectId().toHexString(),
      created_at:     now,
      updated_at:     now,
    }
    await fastify.mongo.collection('entities').insertOne(entity)
    reply.status(201)
    return { data: entity }
  })

  // PATCH /api/entities/:id
  fastify.patch<{ Params: { id: string } }>(
    '/api/entities/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
      const id = new ObjectId(req.params.id)
      const body = z.object({
        name:  z.string().min(1).max(100).optional(),
        icon:  z.string().optional(),
        color: z.string().optional(),
      }).parse(req.body)

      const result = await fastify.mongo.collection('entities').updateOne(
        { _id: id, org_id: req.user!.orgId },
        { $set: { ...body, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // DELETE /api/entities/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/entities/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
      const id = new ObjectId(req.params.id)
      const result = await fastify.mongo.collection('entities').updateOne(
        { _id: id, org_id: req.user!.orgId },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // POST /api/entities/:id/train — record location fingerprint
  fastify.post<{ Params: { id: string } }>(
    '/api/entities/:id/train', { preHandler: fastify.authenticate }, async (req, reply) => {
      const id = new ObjectId(req.params.id)
      const body = z.object({
        signatures: z.array(signatureSchema),
      }).parse(req.body)

      const entity = await fastify.mongo.collection('entities').findOne({ _id: id, org_id: req.user!.orgId })
      if (!entity) return reply.status(404).send({ error: 'Not found' })

      // Merge: replace by kind so re-training updates GPS without wiping network
      type SigKind = 'gps' | 'network' | 'bluetooth_le'
      const existing = (entity['signatures'] as Array<{ kind: SigKind }>) ?? []
      const incomingKinds = new Set<SigKind>(body.signatures.map(s => s.kind))
      const merged = [...existing.filter(s => !incomingKinds.has(s.kind)), ...body.signatures]

      await fastify.mongo.collection('entities').updateOne(
        { _id: id },
        { $set: { signatures: merged, updated_at: new Date() } }
      )
      return { ok: true, signatures: merged }
    }
  )

  // POST /api/entities/detect — score entities against provided signals
  fastify.post(
    '/api/entities/detect', { preHandler: fastify.authenticate }, async (req) => {
      const body = z.object({
        gps:       z.object({ lat: z.number(), lng: z.number() }).optional(),
        network:   z.object({ ip: z.string() }).optional(),
        bluetooth: z.array(z.object({ local_name: z.string(), uuid: z.string().optional() })).optional(),
      }).parse(req.body)

      const entities = await fastify.mongo.collection('entities')
        .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
        .toArray()

      const scored = entities.map(e => {
        const sigs = (e['signatures'] as Array<Record<string, unknown>>) ?? []
        let score = 0
        const matchedKinds: string[] = []

        for (const sig of sigs) {
          if (sig['kind'] === 'gps' && body.gps) {
            const dist = haversineM(body.gps.lat, body.gps.lng, sig['lat'] as number, sig['lng'] as number)
            if (dist <= ((sig['radius_m'] as number) ?? 100)) {
              score += 2; matchedKinds.push('gps')
            }
          }
          if (sig['kind'] === 'network' && body.network) {
            if (sig['external_ip'] === body.network.ip) {
              score += 1; matchedKinds.push('network')
            }
          }
          if (sig['kind'] === 'bluetooth_le' && body.bluetooth?.length) {
            const hit = body.bluetooth.find(b =>
              b.local_name === sig['local_name'] || (sig['uuid'] && b.uuid === sig['uuid'])
            )
            if (hit) { score += 1; matchedKinds.push('bluetooth_le') }
          }
        }
        return { entity: e, score, matchedKinds }
      }).filter(r => r.score > 0).sort((a, b) => b.score - a.score)

      const best = scored[0] ?? null

      // Auto check-in when GPS confirms (score >= 2)
      if (best && best.score >= 2) {
        const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
        if (user?.['username']) {
          await fastify.redis.setex(
            `aha:presence:state:${user['username']}`,
            4 * 3600,
            best.entity['_id'].toString()
          )
        }
      }

      return {
        data: {
          matches: scored.slice(0, 3).map(r => ({
            entity:          r.entity,
            score:           r.score,
            matched_kinds:   r.matchedKinds,
            auto_checked_in: r === scored[0] && r.score >= 2,
          })),
          best: best
            ? { _id: best.entity['_id'], name: best.entity['name'], icon: best.entity['icon'], score: best.score }
            : null,
        }
      }
    }
  )

  // POST /api/entities/:id/checkin — manual check-in (4hr TTL)
  fastify.post<{ Params: { id: string } }>(
    '/api/entities/:id/checkin', { preHandler: fastify.authenticate }, async (req, reply) => {
      const id = new ObjectId(req.params.id)
      const entity = await fastify.mongo.collection('entities').findOne({ _id: id, org_id: req.user!.orgId })
      if (!entity) return reply.status(404).send({ error: 'Not found' })

      const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
      if (!user?.['username']) return reply.status(400).send({ error: 'No username' })

      const ttl = 4 * 3600
      await fastify.redis.setex(`aha:presence:state:${user['username']}`, ttl, id.toString())
      return { ok: true, entity_id: id.toString(), expires_in: ttl }
    }
  )

  // DELETE /api/entities/checkin — check out
  fastify.delete('/api/entities/checkin', { preHandler: fastify.authenticate }, async (req) => {
    const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
    if (user?.['username']) {
      await fastify.redis.del(`aha:presence:state:${user['username']}`)
    }
    return { ok: true }
  })

  // GET /api/my-ip — returns the detected client IP (for training)
  fastify.get('/api/my-ip', { preHandler: fastify.authenticate }, async (req) => {
    return { ip: req.ip }
  })
}

export default entityRoutes
