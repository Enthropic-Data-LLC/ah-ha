import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'

const noteRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/note/:slug — read note body
  fastify.get<{ Params: { slug: string } }>(
    '/api/note/:slug',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Note not found' })

      const content = await fastify.mongo.collection('note_content').findOne({
        space_id: space._id,
        org_id: req.user!.orgId,
      })

      return {
        data: {
          space_ref: space['ref'],
          body: content?.['body'] ?? '',
          updated_at: content?.['updated_at'] ?? null,
        },
      }
    }
  )

  // PUT /api/note/:slug — replace full body
  fastify.put<{ Params: { slug: string } }>(
    '/api/note/:slug',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { body } = z.object({ body: z.string().max(500_000) }).parse(req.body)
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Note not found' })

      await fastify.mongo.collection('note_content').updateOne(
        { space_id: space._id, org_id: req.user!.orgId },
        { $set: { body, updated_at: new Date() }, $setOnInsert: { _id: new ObjectId(), space_id: space._id, org_id: req.user!.orgId } },
        { upsert: true }
      )
      return { ok: true }
    }
  )

  // POST /api/note/:slug/append — append a line (useful for MCP)
  fastify.post<{ Params: { slug: string } }>(
    '/api/note/:slug/append',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { content: appendText } = z.object({ content: z.string().min(1).max(50_000) }).parse(req.body)
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Note not found' })

      const existing = await fastify.mongo.collection('note_content').findOne({
        space_id: space._id, org_id: req.user!.orgId,
      })
      const newBody = existing ? `${existing['body'] as string}\n\n${appendText}` : appendText

      await fastify.mongo.collection('note_content').updateOne(
        { space_id: space._id, org_id: req.user!.orgId },
        { $set: { body: newBody, updated_at: new Date() }, $setOnInsert: { _id: new ObjectId(), space_id: space._id, org_id: req.user!.orgId } },
        { upsert: true }
      )
      return { ok: true }
    }
  )
}

function getSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug, type: 'note', org_id: orgId, deleted_at: { $exists: false },
  })
}

export default noteRoutes
