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

      const now = new Date()
      const view = (req.query as Record<string, string>).view
      if (view === 'today') {
        const eod = new Date(now); eod.setHours(23, 59, 59, 999)
        filter['due_date'] = { $lte: eod }
      } else if (view === 'week') {
        const eow = new Date(now); eow.setDate(eow.getDate() + 7)
        filter['due_date'] = { $lte: eow, $gte: now }
      } else if (view === 'upcoming') {
        filter['start_date'] = { $gt: now }
      } else if (view === 'someday') {
        filter['due_date'] = { $exists: false }
      }
      if (view && view !== 'all') {
        filter['$and'] = [{ $or: [{ start_date: null }, { start_date: { $lte: now } }] }, { $or: [{ defer_until: null }, { defer_until: { $lte: now } }] }]
      }

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
        due_date: z.string().datetime().nullable().optional(),
        start_date: z.string().datetime().nullable().optional(),
        defer_until: z.string().datetime().nullable().optional(),
        recurrence: z.unknown().optional(),
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
        due_date: body.due_date ? new Date(body.due_date) : null,
        start_date: body.start_date ? new Date(body.start_date) : null,
        defer_until: body.defer_until ? new Date(body.defer_until) : null,
        recurrence: body.recurrence ?? null,
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
        due_date: z.string().datetime().nullable().optional(),
        start_date: z.string().datetime().nullable().optional(),
        defer_until: z.string().datetime().nullable().optional(),
        recurrence:   z.unknown().optional(),
        contexts: z.array(z.object({
          entity_id:   z.string(),
          time_chunks: z.array(z.string()).default([]),
        })).optional(),
      }).parse(req.body)

      const update: Record<string, unknown> = { updated_at: new Date() }
      if (body.title !== undefined) update['title'] = body.title
      if (body.notes !== undefined) update['notes'] = body.notes
      if (body.priority !== undefined) update['priority'] = body.priority
      if (body.tags !== undefined) update['tags'] = body.tags
      if (body.color !== undefined) update['color'] = body.color
      if (body.due_date !== undefined) update['due_date'] = body.due_date ? new Date(body.due_date) : null
      if (body.start_date !== undefined) update['start_date'] = body.start_date ? new Date(body.start_date) : null
      if (body.defer_until !== undefined) update['defer_until'] = body.defer_until ? new Date(body.defer_until) : null
      if (body.recurrence !== undefined) update['recurrence'] = body.recurrence
      if (body.contexts !== undefined) update['contexts'] = body.contexts

      const result = await fastify.mongo.collection('board_cards').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: update }
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

  // DELETE /api/board/:slug/columns/:id — only allowed if column has no cards
  fastify.delete<{ Params: { slug: string; id: string } }>(
    '/api/board/:slug/columns/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Board not found' })

      const colId = new ObjectId(req.params.id)
      const col = await fastify.mongo.collection('board_columns').findOne({
        _id: colId, space_id: space._id, org_id: req.user!.orgId,
      })
      if (!col) return reply.status(404).send({ error: 'Column not found' })

      const cardCount = await fastify.mongo.collection('board_cards').countDocuments({
        column_id: colId, space_id: space._id, deleted_at: { $exists: false },
      })
      if (cardCount > 0) {
        return reply.status(409).send({ error: 'Column has cards — move or delete them first' })
      }

      await fastify.mongo.collection('board_columns').deleteOne({ _id: colId })
      publish(fastify, `${req.user!.username}/board/${req.params.slug}`, { op: 'column_deleted', id: req.params.id })
      return { ok: true }
    }
  )

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
}

async function getSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug,
    type: 'board',
    org_id: orgId,
    deleted_at: { $exists: false },
  })
}

export default boardRoutes
