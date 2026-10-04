import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { parseFlow } from '../link/flows.js'

/**
 * A note's `format` decides how it's shown and used: 'text' (the default — free
 * markdown) or 'workflow' (the body is an Ah! Link flow; the page shows the flow
 * editor and the engine runs it). Switching to text is how a workflow is edited by
 * hand; switching back checks the JSON first.
 */
const FORMATS = ['text', 'workflow'] as const

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
          format: (content?.['format'] as string | undefined) ?? 'text',
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

      // A workflow's body must stay a valid flow (the engine runs it); edit freely as text instead.
      const current = await fastify.mongo.collection('note_content').findOne({ space_id: space._id, org_id: req.user!.orgId })
      if (current?.['format'] === 'workflow') {
        const r = parseFlow(body)
        if (!r.flow) return reply.status(400).send({ error: `Not a valid workflow (${r.error}). Switch the note to text to edit it freely.` })
      }

      await fastify.mongo.collection('note_content').updateOne(
        { space_id: space._id, org_id: req.user!.orgId },
        { $set: { body, updated_at: new Date() }, $setOnInsert: { _id: new ObjectId(), space_id: space._id, org_id: req.user!.orgId } },
        { upsert: true }
      )
      return { ok: true }
    }
  )

  // PATCH /api/note/:slug/format {format} — text ↔ workflow. To workflow only if the body is a valid flow.
  fastify.patch<{ Params: { slug: string } }>(
    '/api/note/:slug/format',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { format } = z.object({ format: z.enum(FORMATS) }).parse(req.body)
      const space = await getSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Note not found' })
      const current = await fastify.mongo.collection('note_content').findOne({ space_id: space._id, org_id: req.user!.orgId })
      if (format === 'workflow') {
        const r = parseFlow((current?.['body'] as string | undefined) ?? '')
        if (!r.flow) return reply.status(400).send({ error: `Can't make this a workflow yet: ${r.error}` })
      }
      await fastify.mongo.collection('note_content').updateOne(
        { space_id: space._id, org_id: req.user!.orgId },
        { $set: { format, updated_at: new Date() }, $setOnInsert: { _id: new ObjectId(), space_id: space._id, org_id: req.user!.orgId, body: '' } },
        { upsert: true }
      )
      return { ok: true, format }
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
      if (existing?.['format'] === 'workflow') return reply.status(400).send({ error: 'This note is a workflow — appending text would break it' })
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
