import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { currentPlace } from '../lib/places.js'
import { reopenAlways } from '../lib/repeat.js'
import { emit } from '../link/engine.js'

const signatureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('gps'), lat: z.number(), lng: z.number(), radius_m: z.number().default(100),
    // A place can have several GPS locations (three Walmarts); id and label tell them apart.
    id: z.string().max(40).optional(), label: z.string().max(60).optional(),
  }),
  z.object({ kind: z.literal('network'), external_ip: z.string() }),
  z.object({ kind: z.literal('bluetooth_le'), local_name: z.string(), uuid: z.string().optional() }),
])

/** Open list items and cards tagged to a place — what to do or get there. */
async function taggedOpen(fastify: FastifyInstance, orgId: ObjectId, userId: ObjectId, entityIdStr: string) {
  await reopenAlways(fastify, orgId, userId)
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

type Sig = Record<string, unknown> & { kind: string }

/** GPS signatures written before places had several locations have no id; give them one. */
function withLocationIds(sigs: Sig[]): { sigs: Sig[]; changed: boolean } {
  let changed = false
  const out = sigs.map(sg => {
    if (sg.kind !== 'gps' || sg['id']) return sg
    changed = true
    return { ...sg, id: new ObjectId().toHexString() }
  })
  return { sigs: out, changed }
}

/**
 * Training merges GPS by place, not by kind: a point that overlaps one of the place's
 * locations (or names its id) updates that location — a re-train or a new radius — and
 * a point anywhere else adds another location. `replace` keeps only the new points.
 * Other kinds (network, bluetooth) are still replaced by kind.
 */
function mergeSignatures(existing: Sig[], incoming: Sig[], replace: boolean): { sigs: Sig[]; touched: string[]; added: number } {
  const kinds = new Set(incoming.filter(sg => sg.kind !== 'gps').map(sg => sg.kind))
  let sigs = existing.filter(sg => !kinds.has(sg.kind) && !(replace && sg.kind === 'gps'))
  const touched: string[] = []
  let added = 0
  for (const sg of incoming) {
    if (sg.kind !== 'gps') { sigs.push(sg); continue }
    const lat = sg['lat'] as number, lng = sg['lng'] as number, r = (sg['radius_m'] as number) ?? 100
    const gps = sigs.filter(x => x.kind === 'gps')
    const same: Sig | undefined = (sg['id'] ? gps.find(x => x['id'] === sg['id']) : undefined) ??
      gps.map(x => ({ x, d: haversineM(lat, lng, x['lat'] as number, x['lng'] as number) }))
        .filter(({ x, d }) => d <= Math.max(r, (x['radius_m'] as number) ?? 100, 100))
        .sort((a, b) => a.d - b.d)[0]?.x
    if (same) {
      const next: Sig = { ...same, lat, lng, radius_m: r, ...(sg['label'] !== undefined ? { label: sg['label'] } : {}) }
      sigs = sigs.map(x => x === same ? next : x)
      touched.push(String(same['id']))
    } else {
      const id = (sg['id'] as string | undefined) ?? new ObjectId().toHexString()
      sigs.push({ ...sg, id })
      touched.push(id); added++
    }
  }
  return { sigs, touched, added }
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
    // Older places: give each GPS location an id once, so it can be renamed or removed on its own.
    for (const e of entities) {
      const { sigs, changed } = withLocationIds((e['signatures'] as Sig[] | undefined) ?? [])
      if (!changed) continue
      e['signatures'] = sigs
      await fastify.mongo.collection('entities').updateOne({ _id: e._id }, { $set: { signatures: sigs } })
    }
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
        replace: z.boolean().default(false),
      }).parse(req.body)

      const entity = await fastify.mongo.collection('entities').findOne({ _id: id, org_id: req.user!.orgId })
      if (!entity) return reply.status(404).send({ error: 'Not found' })

      const existing = withLocationIds((entity['signatures'] as Sig[] | undefined) ?? []).sigs
      const { sigs, touched, added } = mergeSignatures(existing, body.signatures as Sig[], body.replace)

      await fastify.mongo.collection('entities').updateOne(
        { _id: id },
        { $set: { signatures: sigs, updated_at: new Date() } }
      )
      return { ok: true, signatures: sigs, location_ids: touched, added }
    }
  )

  // PATCH /api/entities/:id/locations/:locId — rename one GPS location or change its radius
  fastify.patch<{ Params: { id: string; locId: string } }>(
    '/api/entities/:id/locations/:locId', { preHandler: fastify.authenticate }, async (req, reply) => {
      const body = z.object({
        label: z.string().max(60).nullable().optional(),
        radius_m: z.number().min(25).max(5000).optional(),
      }).parse(req.body)
      if (!ObjectId.isValid(req.params.id)) return reply.status(404).send({ error: 'Not found' })
      const set: Record<string, unknown> = { updated_at: new Date() }
      if (body.label !== undefined) set['signatures.$[loc].label'] = body.label || null
      if (body.radius_m !== undefined) set['signatures.$[loc].radius_m'] = body.radius_m
      const r = await fastify.mongo.collection('entities').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, signatures: { $elemMatch: { kind: 'gps', id: req.params.locId } } },
        { $set: set },
        { arrayFilters: [{ 'loc.kind': 'gps', 'loc.id': req.params.locId }] }
      )
      if (r.matchedCount === 0) return reply.status(404).send({ error: 'Location not found' })
      return { ok: true }
    }
  )

  // DELETE /api/entities/:id/locations/:locId — forget one GPS location; the others stay
  fastify.delete<{ Params: { id: string; locId: string } }>(
    '/api/entities/:id/locations/:locId', { preHandler: fastify.authenticate }, async (req, reply) => {
      if (!ObjectId.isValid(req.params.id)) return reply.status(404).send({ error: 'Not found' })
      const r = await fastify.mongo.collection('entities').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, signatures: { $elemMatch: { kind: 'gps', id: req.params.locId } } },
        { $pull: { signatures: { kind: 'gps', id: req.params.locId } }, $set: { updated_at: new Date() } } as Record<string, unknown>
      )
      if (r.matchedCount === 0) return reply.status(404).send({ error: 'Location not found' })
      return { ok: true }
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
        let location: { id: unknown; label: unknown } | null = null

        for (const sig of sigs) {
          if (sig['kind'] === 'gps' && body.gps) {
            const dist = haversineM(body.gps.lat, body.gps.lng, sig['lat'] as number, sig['lng'] as number)
            // Several locations can't all be in range; count GPS once, at the first that is.
            if (!location && dist <= ((sig['radius_m'] as number) ?? 100)) {
              score += 2; matchedKinds.push('gps')
              location = { id: sig['id'] ?? null, label: sig['label'] ?? null }
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
        return { entity: e, score, matchedKinds, location }
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
            location:        r.location,
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
    const { listItems, cards } = await taggedOpen(fastify, orgId, req.user!.id, place._id)
    const spaces = await fastify.mongo.collection('spaces')
      .find({ _id: { $in: [...new Set(listItems.map(i => String(i['space_id'])))].map(id => new ObjectId(id)) } })
      .project({ slug: 1, name: 1 }).toArray()
    const listOf = new Map(spaces.map(s => [String(s['_id']), s['slug'] as string]))
    return {
      data: {
        location: place,
        list_items: listItems.map(i => ({ _id: String(i['_id']), title: i['title'], list: listOf.get(String(i['space_id'])) ?? null, repeat: i['repeat'] ?? 'once' })),
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
        list_items: Array<{ _id: string; title: string; repeat: string }>
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

        const { listItems, cards } = await taggedOpen(fastify, orgId, req.user!.id, idStr)

        sections.push({
          entity: { _id: entity['_id'].toString(), name: entity['name'] as string, icon: entity['icon'] as string },
          list_items: listItems.map(i => ({ _id: i['_id'].toString(), title: i['title'] as string, repeat: (i['repeat'] as string | undefined) ?? 'once' })),
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

      const { listItems, cards } = await taggedOpen(fastify, orgId, req.user!.id, entityIdStr)

      return {
        data: {
          entity: { _id: entity['_id'], name: entity['name'] as string, icon: entity['icon'] as string },
          list_items: listItems.map(i => ({ _id: i['_id'].toString(), title: i['title'], space_id: i['space_id']?.toString(), repeat: i['repeat'] ?? 'once' })),
          cards: cards.map(c => ({ _id: c['_id'].toString(), title: c['title'], ref: c['ref'] })),
          total: listItems.length + cards.length,
        }
      }
    }
  )
}

export default entityRoutes
