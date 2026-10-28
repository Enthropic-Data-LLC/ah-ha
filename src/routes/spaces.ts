import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import type { SpaceType } from '../types.js'
import { initial } from '../lib/lexorank.js'
import { blockedBy } from '../lib/usage.js'

const RESERVED_USERNAMES = new Set(['api', 'auth', 'app', 'settings', 'admin', 'www', 'status', 'docs', 'blog', 'onboarding'])
const SLUG_RE = /^[a-z0-9-]{3,64}$/

export const DEFAULT_BOARD_COLUMNS = [
  { title: 'To Do',       color: '#94a3b8' },
  { title: 'In Progress', color: '#818cf8', in_today: true, today_priority: 1 },
  { title: 'Done',        color: '#34d399', closes: 'done' },
]

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const createSpaceBody = z.object({
  type: z.enum(['board', 'note', 'list', 'trail', 'table']),
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG_RE).optional(),
  description: z.string().max(500).optional(),
})

const spacesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/:username/:type/:slug — get space + metadata
  fastify.get<{ Params: { username: string; type: SpaceType; slug: string } }>(
    '/api/:username/:type/:slug',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { username, type, slug } = req.params
      const ref = `${username}/${type}/${slug}`

      const space = await fastify.mongo.collection('spaces').findOne({ ref, org_id: req.user!.orgId })
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
    const limit = await blockedBy(fastify, user.orgId, 'space')
    if (limit) return reply.status(403).send({ error: `${limit}. Delete one or upgrade to add more.`, code: 'PLAN_LIMIT' })

    const slug = body.slug ?? slugify(body.name)
    if (!SLUG_RE.test(slug)) {
      return reply.status(400).send({ error: 'Could not generate valid slug from name — provide one explicitly' })
    }

    const ref = `${user.username}/${body.type}/${slug}`

    const existing = await fastify.mongo.collection('spaces').findOne({ ref })
    if (existing) return reply.status(409).send({ error: 'Space already exists' })

    const now = new Date()
    const spaceId = new ObjectId()
    const space = {
      _id: spaceId,
      ref,
      slug,
      type: body.type,
      name: body.name,
      description: body.description ?? '',
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
        ...('closes' in col ? { closes: col.closes } : {}),
        ...('in_today' in col ? { in_today: col.in_today, today_priority: col.today_priority } : {}),
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
        description: z.string().max(500).optional(),
        pinned: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
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

  // GET /api/examples — how many starter examples (spaces + places) are still there
  fastify.get('/api/examples', { preHandler: fastify.authenticate }, async (req) => {
    const live = { org_id: req.user!.orgId, example: true, deleted_at: { $exists: false } }
    const [spaces, places] = await Promise.all([
      fastify.mongo.collection('spaces').countDocuments(live),
      fastify.mongo.collection('entities').countDocuments(live),
    ])
    return { data: { spaces, places } }
  })

  // POST /api/examples/clear — remove the starter examples the user hasn't taken over.
  // Example items and cards go. A space goes only if nothing of the user's own is left in it
  // (a note: if it was never saved); a place only if it was never changed and none of the
  // user's own list items is tagged to it. Soft deletes, like every other delete. What stays
  // is the user's now, so it stops counting as an example.
  fastify.post('/api/examples/clear', { preHandler: fastify.authenticate }, async (req) => {
    const db = fastify.mongo
    const orgId = req.user!.orgId
    const now = new Date()
    const live = { org_id: orgId, deleted_at: { $exists: false } }
    const gone = { $set: { deleted_at: now } }
    const keep = { $unset: { example: '' } }

    const items = await db.collection('list_items').updateMany({ ...live, example: true }, gone)
    const cards = await db.collection('board_cards').updateMany({ ...live, example: true }, gone)

    let spaces = 0
    for (const sp of await db.collection('spaces').find({ ...live, example: true }).toArray()) {
      const id = sp._id
      const kept = sp['type'] === 'list' ? await db.collection('list_items').countDocuments({ ...live, space_id: id })
        : sp['type'] === 'board' ? await db.collection('board_cards').countDocuments({ ...live, space_id: id })
        : sp['type'] === 'note' ? await db.collection('note_content').countDocuments(
          { org_id: orgId, space_id: id, $or: [{ example: { $ne: true } }, { updated_at: { $gt: sp['created_at'] } }] })
        : 1
      await db.collection('spaces').updateOne({ _id: id }, kept ? keep : gone)
      if (kept) continue
      spaces++
    }

    let places = 0
    for (const e of await db.collection('entities').find({ ...live, example: true }).toArray()) {
      const kept = (e['updated_at'] as Date).getTime() !== (e['created_at'] as Date).getTime()
        || await db.collection('list_items').countDocuments({ ...live, 'contexts.entity_id': String(e._id) }) > 0
      await db.collection('entities').updateOne({ _id: e._id }, kept ? keep : gone)
      if (kept) continue
      places++
    }

    return { data: { items: items.modifiedCount, cards: cards.modifiedCount, spaces, places } }
  })

  // GET /api/spaces — list my spaces, optional ?type= filter
  fastify.get<{ Querystring: { type?: string } }>(
    '/api/spaces',
    { preHandler: fastify.authenticate },
    async (req) => {
      const filter: Record<string, unknown> = {
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      }
      if (req.query.type) filter['type'] = req.query.type

      const spaces = await fastify.mongo.collection('spaces')
        .find(filter)
        .sort({ pinned: -1, updated_at: -1 })
        .toArray()
      return { data: spaces }
    }
  )
}

export default spacesRoutes
