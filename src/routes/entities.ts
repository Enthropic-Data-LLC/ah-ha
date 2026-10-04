import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { currentPlace } from '../lib/places.js'
import { emit } from '../link/engine.js'

const signatureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gps'), lat: z.number(), lng: z.number(), radius_m: z.number().default(100) }),
  z.object({ kind: z.literal('network'), external_ip: z.string() }),
  z.object({ kind: z.literal('bluetooth_le'), local_name: z.string(), uuid: z.string().optional() }),
])

/** Open list items and cards tagged to a place — what to do or get there. */
async function taggedOpen(fastify: FastifyInstance, orgId: ObjectId, entityIdStr: string) {
  const [listItems, cards] = await Promise.all([
    fastify.mongo.collection('list_items').find({
      org_id: orgId, done: false, deleted_at: { $exists: false }, 'contexts.entity_id': entityIdStr,
    }).sort({ position: 1 }).toArray(),
    fastify.mongo.collection('board_cards').find({
      org_id: orgId, done: { $ne: true }, deleted_at: { $exists: false }, 'contexts.entity_id': entityIdStr,
    }).toArray(),
  ])
  return { listItems, cards }
}

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
          const key = `aha:presence:state:${user['username']}`
          const prev = await fastify.redis.get(key)
          await fastify.redis.setex(key, 4 * 3600, best.entity['_id'].toString())
          if (prev !== best.entity['_id'].toString()) emit(fastify.redis, { kind: 'place', org_id: req.user!.orgId.toString(), from: prev, to: best.entity['_id'].toString() })
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

      // Manual check-ins last 4h; the phone asks for longer on a GPS arrival and clears it on exit.
      const { ttl_hours } = z.object({ ttl_hours: z.number().min(0.25).max(24).optional() }).parse(req.body ?? {})
      const ttl = Math.round((ttl_hours ?? 4) * 3600)
      const key = `aha:presence:state:${user['username']}`
      const prev = await fastify.redis.get(key)
      await fastify.redis.setex(key, ttl, id.toString())
      // A renewal (same place) is not an arrival.
      if (prev !== id.toString()) emit(fastify.redis, { kind: 'place', org_id: req.user!.orgId.toString(), from: prev, to: id.toString() })
      return { ok: true, entity_id: id.toString(), expires_in: ttl }
    }
  )

  // DELETE /api/entities/checkin — check out
  fastify.delete('/api/entities/checkin', { preHandler: fastify.authenticate }, async (req) => {
    const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
    if (user?.['username']) {
      const key = `aha:presence:state:${user['username']}`
      const prev = await fastify.redis.get(key)
      await fastify.redis.del(key)
      if (prev) emit(fastify.redis, { kind: 'place', org_id: req.user!.orgId.toString(), from: prev, to: null })
    }
    return { ok: true }
  })

  // GET /api/my-ip — returns the detected client IP (for training)
  fastify.get('/api/my-ip', { preHandler: fastify.authenticate }, async (req) => {
    return { ip: req.ip }
  })

  // GET /api/here — where the user is checked in and what's tagged there.
  // Lets an API/MCP caller answer "what do I need here?" in one call.
  fastify.get('/api/here', { preHandler: fastify.authenticate }, async (req) => {
    const orgId = req.user!.orgId
    const place = await currentPlace(fastify, req.user!.id, orgId)
    if (!place) return { data: { location: null, list_items: [], cards: [], total: 0 } }
    const { listItems, cards } = await taggedOpen(fastify, orgId, place._id)
    const spaces = await fastify.mongo.collection('spaces')
      .find({ _id: { $in: [...new Set(listItems.map(i => String(i['space_id'])))].map(id => new ObjectId(id)) } })
      .project({ slug: 1, name: 1 }).toArray()
    const listOf = new Map(spaces.map(s => [String(s['_id']), s['slug'] as string]))
    return {
      data: {
        location: place,
        list_items: listItems.map(i => ({ _id: String(i['_id']), title: i['title'], list: listOf.get(String(i['space_id'])) ?? null })),
        cards: cards.map(c => ({ _id: String(c['_id']), title: c['title'], ref: c['ref'], due_date: c['due_date'] ?? null })),
        total: listItems.length + cards.length,
      },
    }
  })

  // GET /api/entities/going-to?ids=id1,id2 — merged checklist for multiple destinations
  fastify.get<{ Querystring: { ids?: string } }>(
    '/api/entities/going-to',
    { preHandler: fastify.authenticate },
    async (req) => {
      const ids = (req.query.ids ?? '').split(',').map(s => s.trim()).filter(Boolean)
      if (!ids.length) return { data: [] }

      const orgId = req.user!.orgId
      const sections: Array<{
        entity: { _id: string; name: string; icon: string }
        list_items: Array<{ _id: string; title: string }>
        cards: Array<{ _id: string; title: string; ref: string }>
        total: number
      }> = []

      for (const idStr of ids) {
        let entityId: ObjectId
        try { entityId = new ObjectId(idStr) } catch { continue }

        const entity = await fastify.mongo.collection('entities').findOne({
          _id: entityId, org_id: orgId, deleted_at: { $exists: false },
        })
        if (!entity) continue

        const { listItems, cards } = await taggedOpen(fastify, orgId, idStr)

        sections.push({
          entity: { _id: entity['_id'].toString(), name: entity['name'] as string, icon: entity['icon'] as string },
          list_items: listItems.map(i => ({ _id: i['_id'].toString(), title: i['title'] as string })),
          cards: cards.map(c => ({ _id: c['_id'].toString(), title: c['title'] as string, ref: c['ref'] as string })),
          total: listItems.length + cards.length,
        })
      }

      return { data: sections }
    }
  )

  // GET /api/entities/:id/going-to — items + cards tagged to this entity (pre-departure checklist)
  fastify.get<{ Params: { id: string } }>(
    '/api/entities/:id/going-to',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const entityId = new ObjectId(req.params.id)
      const entity = await fastify.mongo.collection('entities').findOne({
        _id: entityId, org_id: req.user!.orgId, deleted_at: { $exists: false },
      })
      if (!entity) return reply.status(404).send({ error: 'Not found' })

      const entityIdStr = entityId.toString()
      const orgId = req.user!.orgId

      const { listItems, cards } = await taggedOpen(fastify, orgId, entityIdStr)

      return {
        data: {
          entity: { _id: entity['_id'], name: entity['name'] as string, icon: entity['icon'] as string },
          list_items: listItems.map(i => ({ _id: i['_id'].toString(), title: i['title'], space_id: i['space_id']?.toString() })),
          cards: cards.map(c => ({ _id: c['_id'].toString(), title: c['title'], ref: c['ref'] })),
          total: listItems.length + cards.length,
        }
      }
    }
  )
}

export default entityRoutes
