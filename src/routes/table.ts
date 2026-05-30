import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { initial } from '../lib/lexorank.js'

const COL_TYPES = ['text', 'number', 'date', 'checkbox', 'select', 'multiselect'] as const

const tableRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/table/:slug — columns + rows
  fastify.get<{ Params: { slug: string } }>(
    '/api/table/:slug',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Not found' })

      const [columns, rows] = await Promise.all([
        fastify.mongo.collection('table_columns')
          .find({ space_id: space._id, deleted_at: { $exists: false } })
          .sort({ position: 1 })
          .toArray(),
        fastify.mongo.collection('table_rows')
          .find({ space_id: space._id, org_id: req.user!.orgId, deleted_at: { $exists: false } })
          .sort({ position: 1 })
          .toArray(),
      ])

      return { data: { columns, rows } }
    }
  )

  // POST /api/table/:slug/columns
  fastify.post<{ Params: { slug: string } }>(
    '/api/table/:slug/columns',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        name: z.string().min(1).max(100),
        type: z.enum(COL_TYPES).default('text'),
        options: z.array(z.string().min(1).max(100)).optional().default([]),
      }).parse(req.body)

      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Not found' })

      const last = await fastify.mongo.collection('table_columns').findOne(
        { space_id: space._id, deleted_at: { $exists: false } },
        { sort: { position: -1 } }
      )

      const col = {
        _id: new ObjectId(),
        space_id: space._id,
        org_id: req.user!.orgId,
        name: body.name,
        type: body.type,
        options: body.options,
        position: last ? (last['position'] as number) + 1.0 : initial(),
        created_at: new Date(),
      }
      await fastify.mongo.collection('table_columns').insertOne(col)
      reply.status(201)
      return { data: col }
    }
  )

  // PATCH /api/table/:slug/columns/:id — rename, change options
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/table/:slug/columns/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        name: z.string().min(1).max(100).optional(),
        options: z.array(z.string()).optional(),
      }).parse(req.body)

      const update: Record<string, unknown> = {}
      if (body.name !== undefined) update['name'] = body.name
      if (body.options !== undefined) update['options'] = body.options

      const result = await fastify.mongo.collection('table_columns').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: update }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // DELETE /api/table/:slug/columns/:id
  fastify.delete<{ Params: { slug: string; id: string } }>(
    '/api/table/:slug/columns/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('table_columns').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // POST /api/table/:slug/rows
  fastify.post<{ Params: { slug: string } }>(
    '/api/table/:slug/rows',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { cells } = z.object({
        cells: z.record(z.unknown()).default({}),
      }).parse(req.body)

      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Not found' })

      const last = await fastify.mongo.collection('table_rows').findOne(
        { space_id: space._id, deleted_at: { $exists: false } },
        { sort: { position: -1 } }
      )

      const row = {
        _id: new ObjectId(),
        space_id: space._id,
        org_id: req.user!.orgId,
        cells,
        position: last ? (last['position'] as number) + 1.0 : initial(),
        created_at: new Date(),
        updated_at: new Date(),
      }
      await fastify.mongo.collection('table_rows').insertOne(row)
      reply.status(201)
      return { data: row }
    }
  )

  // PATCH /api/table/:slug/rows/:id — merge-update cells
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/table/:slug/rows/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { cells } = z.object({
        cells: z.record(z.unknown()),
      }).parse(req.body)

      // Use dot-notation $set so we merge rather than overwrite the whole cells map
      const $set: Record<string, unknown> = { updated_at: new Date() }
      for (const [k, v] of Object.entries(cells)) {
        $set[`cells.${k}`] = v
      }

      const result = await fastify.mongo.collection('table_rows').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // DELETE /api/table/:slug/rows/:id
  fastify.delete<{ Params: { slug: string; id: string } }>(
    '/api/table/:slug/rows/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('table_rows').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // GET /api/table/:slug/rows/:row_id/cells/:col_id — read one cell
  fastify.get<{ Params: { slug: string; row_id: string; col_id: string } }>(
    '/api/table/:slug/rows/:row_id/cells/:col_id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const row = await fastify.mongo.collection('table_rows').findOne(
        { _id: new ObjectId(req.params.row_id), org_id: req.user!.orgId, deleted_at: { $exists: false } }
      )
      if (!row) return reply.status(404).send({ error: 'Not found' })
      const cells = row['cells'] as Record<string, unknown>
      return { data: { row_id: req.params.row_id, col_id: req.params.col_id, value: cells[req.params.col_id] ?? null } }
    }
  )

  // PUT /api/table/:slug/rows/:row_id/cells/:col_id — set one cell
  fastify.put<{ Params: { slug: string; row_id: string; col_id: string } }>(
    '/api/table/:slug/rows/:row_id/cells/:col_id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { value } = z.object({ value: z.unknown() }).parse(req.body)
      const result = await fastify.mongo.collection('table_rows').updateOne(
        { _id: new ObjectId(req.params.row_id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { [`cells.${req.params.col_id}`]: value, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // DELETE /api/table/:slug/rows/:row_id/cells/:col_id — clear one cell
  fastify.delete<{ Params: { slug: string; row_id: string; col_id: string } }>(
    '/api/table/:slug/rows/:row_id/cells/:col_id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('table_rows').updateOne(
        { _id: new ObjectId(req.params.row_id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $unset: { [`cells.${req.params.col_id}`]: '' }, $set: { updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )
}

function getSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug, type: 'table', org_id: orgId, deleted_at: { $exists: false },
  })
}

export default tableRoutes
