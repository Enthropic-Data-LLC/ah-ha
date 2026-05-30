import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import type { SpaceType } from '../types.js'
import { initial } from '../lib/lexorank.js'

const RESERVED_USERNAMES = new Set(['api', 'auth', 'app', 'settings', 'admin', 'www', 'status', 'docs', 'blog', 'onboarding'])
const SLUG_RE = /^[a-z0-9-]{3,64}$/

const DEFAULT_BOARD_COLUMNS = [
  { title: 'To Do',       color: '#94a3b8' },
  { title: 'In Progress', color: '#818cf8' },
  { title: 'Done',        color: '#34d399' },
]

const createSpaceBody = z.object({
  type: z.enum(['board', 'note', 'list', 'trail', 'table']),
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG_RE),
})

const spacesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/:username/:type/:slug — get space + metadata
  fastify.get<{ Params: { username: string; type: SpaceType; slug: string } }>(
    '/api/:username/:type/:slug',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { username, type, slug } = req.params
      const ref = `${username}/${type}/${slug}`

      const space = await fastify.mongo.collection('spaces').findOne({ ref })
      if (!space || space['deleted_at']) return reply.status(404).send({ error: 'Not found' })

      return { data: space }
    }
  )

  // POST /api/spaces — create space
  fastify.post('/api/spaces', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = createSpaceBody.parse(req.body)
    const user = req.user!

    if (RESERVED_USERNAMES.has(user.username)) {
      return reply.status(400).send({ error: 'Reserved username' })
    }

    const ref = `${user.username}/${body.type}/${body.slug}`

    const existing = await fastify.mongo.collection('spaces').findOne({ ref })
    if (existing) return reply.status(409).send({ error: 'Space already exists' })

    const now = new Date()
    const spaceId = new ObjectId()
    const space = {
      _id: spaceId,
      ref,
      slug: body.slug,
      type: body.type,
      name: body.name,
      owner_id: user.id,
      org_id: user.orgId,
      settings: {},
      pinned: false,
      created_at: now,
      updated_at: now,
    }

    await fastify.mongo.collection('spaces').insertOne(space)

    // Auto-create default columns for new board spaces
    if (body.type === 'board') {
      const base = initial()
      const cols = DEFAULT_BOARD_COLUMNS.map((col, i) => ({
        _id: new ObjectId(),
        space_id: spaceId,
        org_id: user.orgId,
        title: col.title,
        color: col.color,
        position: base + i,
        created_at: now,
      }))
      await fastify.mongo.collection('board_columns').insertMany(cols)
    }

    reply.status(201)
    return { data: space }
  })

  // PATCH /api/spaces/:ref — update space
  fastify.patch<{ Params: { ref: string } }>(
    '/api/spaces/:ref',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const ref = decodeURIComponent(req.params.ref)
      const body = z.object({
        name: z.string().min(1).max(100).optional(),
        pinned: z.boolean().optional(),
        settings: z.record(z.unknown()).optional(),
      }).parse(req.body)

      const space = await fastify.mongo.collection('spaces').findOne({ ref, org_id: req.user!.orgId })
      if (!space || space['deleted_at']) return reply.status(404).send({ error: 'Not found' })

      await fastify.mongo.collection('spaces').updateOne(
        { ref, org_id: req.user!.orgId },
        { $set: { ...body, updated_at: new Date() } }
      )

      return { ok: true }
    }
  )

  // DELETE /api/spaces/:ref — soft delete
  fastify.delete<{ Params: { ref: string } }>(
    '/api/spaces/:ref',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const ref = decodeURIComponent(req.params.ref)
      const result = await fastify.mongo.collection('spaces').updateOne(
        { ref, org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // GET /api/spaces — list my spaces
  fastify.get('/api/spaces', { preHandler: fastify.authenticate }, async (req) => {
    const spaces = await fastify.mongo.collection('spaces')
      .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
      .sort({ pinned: -1, updated_at: -1 })
      .toArray()
    return { data: spaces }
  })
}

export default spacesRoutes
