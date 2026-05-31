import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { between, initial } from '../lib/lexorank.js'

function publish(fastify: { redis: import('ioredis').Redis }, spaceRef: string, op: Record<string, unknown>) {
  fastify.redis.publish(`ws:${spaceRef}`, JSON.stringify(op)).catch(() => {})
}

const boardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/board/:slug/columns
  fastify.get<{ Params: { slug: string } }>(
    '/api/board/:slug/columns',
    { preHandler: fastify.authenticate },
    async (req) => {
      const space = await fastify.mongo.collection('spaces').findOne({
        'slug': req.params.slug,
        'type': 'board',
        'org_id': req.user!.orgId,
        'deleted_at': { $exists: false },
      })
      if (!space) return { data: [] }

      const cols = await fastify.mongo.collection('board_columns')
        .find({ space_id: space._id, org_id: req.user!.orgId, deleted_at: { $exists: false } })
        .sort({ position: 1 })
        .toArray()
      return { data: cols }
    }
  )

  // POST /api/board/:slug/columns
  fastify.post<{ Params: { slug: string } }>(
    '/api/board/:slug/columns',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({ title: z.string().min(1), color: z.string().default('#e2e8f0') }).parse(req.body)
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Board not found' })

      const last = await fastify.mongo.collection('board_columns')
        .findOne({ space_id: space._id }, { sort: { position: -1 } })

      const col = {
        _id: new ObjectId(),
        space_id: space._id,
        org_id: req.user!.orgId,
        title: body.title,
        color: body.color,
        position: last ? (last['position'] as number) + 1.0 : initial(),
        created_at: new Date(),
      }
      await fastify.mongo.collection('board_columns').insertOne(col)
      reply.status(201)
      return { data: col }
    }
  )

  // GET /api/board/:slug/cards
  fastify.get<{ Params: { slug: string }; Querystring: { column_id?: string } }>(
    '/api/board/:slug/cards',
    { preHandler: fastify.authenticate },
    async (req) => {
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return { data: [] }

      const filter: Record<string, unknown> = {
        space_id: space._id,
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      }
      if (req.query.column_id) filter['column_id'] = new ObjectId(req.query.column_id)

      const cards = await fastify.mongo.collection('board_cards')
        .find(filter)
        .sort({ column_id: 1, position: 1 })
        .toArray()
      return { data: cards }
    }
  )

  // POST /api/board/:slug/cards
  fastify.post<{ Params: { slug: string } }>(
    '/api/board/:slug/cards',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        column_id: z.string(),
        title: z.string().min(1).max(500),
        notes: z.string().default(''),
        priority: z.enum(['none', 'low', 'medium', 'high']).default('none'),
        tags: z.array(z.string()).default([]),
        color: z.string().default(''),
      }).parse(req.body)

      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Board not found' })

      const last = await fastify.mongo.collection('board_cards').findOne(
        { column_id: new ObjectId(body.column_id), deleted_at: { $exists: false } },
        { sort: { position: -1 } }
      )

      const id = new ObjectId()
      const ref = `${space['ref']}#card_${id.toString()}`

      const card = {
        _id: id,
        ref,
        space_id: space._id,
        org_id: req.user!.orgId,
        column_id: new ObjectId(body.column_id),
        title: body.title,
        notes: body.notes,
        priority: body.priority,
        tags: body.tags,
        color: body.color,
        position: last ? (last['position'] as number) + 1.0 : initial(),
        created_by: req.user!.id,
        updated_at: new Date(),
        links: [],
      }
      await fastify.mongo.collection('board_cards').insertOne(card)
      reply.status(201)
      return { data: card }
    }
  )

  // PATCH /api/board/:slug/cards/:id
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/board/:slug/cards/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        title: z.string().min(1).max(500).optional(),
        notes: z.string().optional(),
        priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
        tags: z.array(z.string()).optional(),
        color: z.string().optional(),
      }).parse(req.body)

      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { ...body, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // PATCH /api/board/:slug/cards/:id/move
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/board/:slug/cards/:id/move',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        column_id: z.string(),
        before_id: z.string().nullable().default(null),
        after_id: z.string().nullable().default(null),
      }).parse(req.body)

      const beforeCard = body.before_id
        ? await fastify.mongo.collection('board_cards').findOne({ _id: new ObjectId(body.before_id) })
        : null
      const afterCard = body.after_id
        ? await fastify.mongo.collection('board_cards').findOne({ _id: new ObjectId(body.after_id) })
        : null

      const position = between(
        beforeCard ? (beforeCard['position'] as number) : null,
        afterCard ? (afterCard['position'] as number) : null,
      )

      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId },
        { $set: { column_id: new ObjectId(body.column_id), position, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true, position }
    }
  )

  // DELETE /api/board/:slug/cards/:id
  fastify.delete<{ Params: { slug: string; id: string } }>(
    '/api/board/:slug/cards/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )
}

  // PATCH /api/board/:slug/columns/:id/move — shift column left or right
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/board/:slug/columns/:id/move',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { direction } = z.object({ direction: z.enum(['left', 'right']) }).parse(req.body)
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Board not found' })

      const cols = await fastify.mongo.collection('board_columns')
        .find({ space_id: space._id, org_id: req.user!.orgId })
        .sort({ position: 1 })
        .toArray()

      const idx = cols.findIndex(c => c['_id'].toHexString() === req.params.id)
      if (idx === -1) return reply.status(404).send({ error: 'Column not found' })

      const swapIdx = direction === 'left' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= cols.length) return { ok: true } // already at edge

      const a = cols[idx]!
      const b = cols[swapIdx]!
      const posA = a['position'] as number
      const posB = b['position'] as number

      await fastify.mongo.collection('board_columns').bulkWrite([
        { updateOne: { filter: { _id: a['_id'] }, update: { $set: { position: posB } } } },
        { updateOne: { filter: { _id: b['_id'] }, update: { $set: { position: posA } } } },
      ])

      publish(fastify, `${req.user!.username}/board/${req.params.slug}`, { op: 'columns_reordered' })
      return { ok: true }
    }
  )


async function getSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug,
    type: 'board',
    org_id: orgId,
    deleted_at: { $exists: false },
  })
}

export default boardRoutes
