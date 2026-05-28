import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { between, initial } from '../lib/lexorank.js'

const listRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/list/:slug/items
  fastify.get<{ Params: { slug: string }; Querystring: { done?: string } }>(
    '/api/list/:slug/items',
    { preHandler: fastify.authenticate },
    async (req) => {
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return { data: [] }

      const filter: Record<string, unknown> = {
        space_id: space._id,
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      }
      if (req.query.done === 'true') filter['done'] = true
      if (req.query.done === 'false') filter['done'] = false

      const items = await fastify.mongo.collection('list_items')
        .find(filter)
        .sort({ done: 1, position: 1 })
        .toArray()
      return { data: items }
    }
  )

  // POST /api/list/:slug/items
  fastify.post<{ Params: { slug: string } }>(
    '/api/list/:slug/items',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        title: z.string().min(1).max(500),
        due_at: z.string().datetime().optional(),
      }).parse(req.body)

      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'List not found' })

      const last = await fastify.mongo.collection('list_items').findOne(
        { space_id: space._id, done: false, deleted_at: { $exists: false } },
        { sort: { position: -1 } }
      )

      const item = {
        _id: new ObjectId(),
        space_id: space._id,
        org_id: req.user!.orgId,
        title: body.title,
        done: false,
        done_at: null,
        due_at: body.due_at ? new Date(body.due_at) : null,
        position: last ? (last['position'] as number) + 1.0 : initial(),
        created_by: req.user!.id,
        created_at: new Date(),
      }
      await fastify.mongo.collection('list_items').insertOne(item)
      reply.status(201)
      return { data: item }
    }
  )

  // PATCH /api/list/:slug/items/:id — update title, due_at
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/list/:slug/items/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        title: z.string().min(1).max(500).optional(),
        due_at: z.string().datetime().nullable().optional(),
      }).parse(req.body)

      const update: Record<string, unknown> = {}
      if (body.title !== undefined) update['title'] = body.title
      if (body.due_at !== undefined) update['due_at'] = body.due_at ? new Date(body.due_at) : null

      const result = await fastify.mongo.collection('list_items').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: update }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // PATCH /api/list/:slug/items/:id/check — toggle done
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/list/:slug/items/:id/check',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { done } = z.object({ done: z.boolean() }).parse(req.body)

      const result = await fastify.mongo.collection('list_items').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { done, done_at: done ? new Date() : null } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // PATCH /api/list/:slug/items/:id/move — reorder
  fastify.patch<{ Params: { slug: string; id: string } }>(
    '/api/list/:slug/items/:id/move',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = z.object({
        before_id: z.string().nullable().default(null),
        after_id: z.string().nullable().default(null),
      }).parse(req.body)

      const before = body.before_id
        ? await fastify.mongo.collection('list_items').findOne({ _id: new ObjectId(body.before_id) })
        : null
      const after = body.after_id
        ? await fastify.mongo.collection('list_items').findOne({ _id: new ObjectId(body.after_id) })
        : null

      const position = between(
        before ? (before['position'] as number) : null,
        after ? (after['position'] as number) : null,
      )

      const result = await fastify.mongo.collection('list_items').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId },
        { $set: { position } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true, position }
    }
  )

  // DELETE /api/list/:slug/items/:id — soft delete
  fastify.delete<{ Params: { slug: string; id: string } }>(
    '/api/list/:slug/items/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('list_items').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )
}

function getSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug, type: 'list', org_id: orgId, deleted_at: { $exists: false },
  })
}

export default listRoutes
