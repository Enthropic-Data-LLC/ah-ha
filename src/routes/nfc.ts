import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { customAlphabet } from 'nanoid'

/**
 * NFC tags. A physical tag stores only `${BASE_URL}/t/<tag_id>` (plus an Android
 * app record); what a tap *does* lives here, so a tag can be re-pointed without
 * rewriting it. Taps reuse the existing trail / check-in / complete routes via
 * inject, under the caller's own credentials, so there is one copy of that logic.
 */

// No 0/o/1/l — tag ids get read aloud and typed. 32^20 ≈ 100 bits.
const newTagId = customAlphabet('23456789abcdefghijkmnpqrstuvwxyz', 20)
const TAG_ID = /^[2-9a-km-z]{20}$/
const OID = /^[0-9a-f]{24}$/

// A held phone or a double tap reads the tag several times; only the first counts.
const DEBOUNCE_MS = 30_000

const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('trail'),
    space_slug: z.string().min(1),
    text: z.string().min(1).max(500),
    tone: z.enum(['happy', 'sorrow', 'neutral']).default('neutral'),
  }),
  z.object({ type: z.literal('checkin'), entity_id: z.string().regex(OID) }),
  z.object({ type: z.literal('complete_card'), card_id: z.string().regex(OID) }),
  // No server-side effect — tells the app which screen to open (e.g. the leaving checklist by the door).
  z.object({ type: z.literal('open'), view: z.enum(['leave', 'now']) }),
])
type TagAction = z.infer<typeof actionSchema>

const createBody = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().max(8).default('🏷️'),
  action: actionSchema,
})
const patchBody = createBody.partial()

const tagUrl = (tagId: string) => `${process.env['BASE_URL'] ?? 'https://ah-ha.app'}/t/${tagId}`

function view(tag: Record<string, unknown>) {
  return {
    tag_id: tag['tag_id'],
    name: tag['name'],
    icon: tag['icon'],
    action: tag['action'],
    url: tagUrl(tag['tag_id'] as string),
    tap_count: tag['tap_count'] ?? 0,
    last_tapped_at: tag['last_tapped_at'] ?? null,
    created_at: tag['created_at'],
    updated_at: tag['updated_at'],
  }
}

class TapError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const nfcRoutes: FastifyPluginAsync = async (fastify) => {
  const tags = () => fastify.mongo.collection('nfc_tags')

  /** Rejects an action that points at something this org doesn't have. */
  async function checkTarget(action: TagAction, orgId: ObjectId): Promise<string | null> {
    const db = fastify.mongo
    const base = { org_id: orgId, deleted_at: { $exists: false } }
    switch (action.type) {
      case 'trail':
        return await db.collection('spaces').findOne({ ...base, type: 'trail', slug: action.space_slug })
          ? null : `No trail called "${action.space_slug}"`
      case 'checkin':
        return await db.collection('entities').findOne({ ...base, _id: new ObjectId(action.entity_id) })
          ? null : 'Place not found'
      case 'complete_card':
        return await db.collection('board_cards').findOne({ ...base, _id: new ObjectId(action.card_id) })
          ? null : 'Card not found'
      case 'open':
        return null
    }
  }

  /** Calls an existing route as the same caller (API key or session cookie). */
  async function forward(req: FastifyRequest, method: 'POST', url: string, payload: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (req.headers.authorization) headers['authorization'] = req.headers.authorization
    if (req.headers.cookie) headers['cookie'] = req.headers.cookie
    const res = await fastify.inject({ method, url, headers, payload: JSON.stringify(payload) })
    const body = res.json() as { data?: Record<string, unknown>; error?: string | { message?: string } }
    if (res.statusCode >= 400) {
      const msg = typeof body.error === 'string' ? body.error : body.error?.message
      throw new TapError(res.statusCode, msg ?? `Action failed (${res.statusCode})`)
    }
    return body.data ?? {}
  }

  async function run(req: FastifyRequest, tag: Record<string, unknown>): Promise<string> {
    const action = tag['action'] as TagAction
    switch (action.type) {
      case 'trail':
        await forward(req, 'POST', `/api/trail/${encodeURIComponent(action.space_slug)}/append`, {
          text: action.text,
          tone: action.tone,
          source: 'nfc',
          tags: ['nfc'],
          meta: { nfc_tag: tag['tag_id'], nfc_name: tag['name'] },
        })
        return `Logged: ${action.text}`
      case 'checkin': {
        await forward(req, 'POST', `/api/entities/${action.entity_id}/checkin`, {})
        const place = await fastify.mongo.collection('entities').findOne({ _id: new ObjectId(action.entity_id) })
        return `Checked in at ${place?.['icon'] ?? ''} ${place?.['name'] ?? 'place'}`.replace(/\s+/g, ' ')
      }
      case 'complete_card': {
        const card = await forward(req, 'POST', `/api/cards/${action.card_id}/complete`, {})
        return `Done: ${card['title'] ?? 'card'}`
      }
      case 'open':
        return action.view === 'leave' ? 'Heading out' : 'Today'
    }
  }

  async function findTag(req: FastifyRequest, tagId: string) {
    if (!TAG_ID.test(tagId)) return null
    return tags().findOne({ tag_id: tagId, org_id: req.user!.orgId, deleted_at: { $exists: false } })
  }

  // GET /api/nfc/tags
  fastify.get('/api/nfc/tags', { preHandler: fastify.authenticate }, async (req) => {
    const list = await tags()
      .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
      .sort({ updated_at: -1 })
      .toArray()
    return { data: list.map(view) }
  })

  // GET /api/nfc/tags/:tagId
  fastify.get<{ Params: { tagId: string } }>(
    '/api/nfc/tags/:tagId', { preHandler: fastify.authenticate }, async (req, reply) => {
      const tag = await findTag(req, req.params.tagId)
      if (!tag) return reply.status(404).send({ error: 'Unknown tag' })
      return { data: view(tag) }
    }
  )

  // POST /api/nfc/tags — register a tag; the client then writes `url` onto it
  fastify.post('/api/nfc/tags', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const problem = await checkTarget(body.action, req.user!.orgId)
    if (problem) return reply.status(400).send({ error: problem })

    const now = new Date()
    const tag = {
      _id: new ObjectId(),
      tag_id: newTagId(),
      ...body,
      org_id: req.user!.orgId,
      owner_id: req.user!.id,
      tap_count: 0,
      last_tapped_at: null,
      created_at: now,
      updated_at: now,
    }
    await tags().insertOne(tag)
    reply.status(201)
    return { data: view(tag) }
  })

  // PATCH /api/nfc/tags/:tagId — rename or re-point; the physical tag is unchanged
  fastify.patch<{ Params: { tagId: string } }>(
    '/api/nfc/tags/:tagId', { preHandler: fastify.authenticate }, async (req, reply) => {
      const body = patchBody.parse(req.body)
      const tag = await findTag(req, req.params.tagId)
      if (!tag) return reply.status(404).send({ error: 'Unknown tag' })
      if (body.action) {
        const problem = await checkTarget(body.action, req.user!.orgId)
        if (problem) return reply.status(400).send({ error: problem })
      }
      await tags().updateOne({ _id: tag['_id'] }, { $set: { ...body, updated_at: new Date() } })
      return { data: view({ ...tag, ...body }) }
    }
  )

  // DELETE /api/nfc/tags/:tagId
  fastify.delete<{ Params: { tagId: string } }>(
    '/api/nfc/tags/:tagId', { preHandler: fastify.authenticate }, async (req, reply) => {
      const tag = await findTag(req, req.params.tagId)
      if (!tag) return reply.status(404).send({ error: 'Unknown tag' })
      await tags().updateOne({ _id: tag['_id'] }, { $set: { deleted_at: new Date() } })
      return { ok: true }
    }
  )

  // POST /api/nfc/tap/:tagId — run the tag's action
  fastify.post<{ Params: { tagId: string } }>(
    '/api/nfc/tap/:tagId', { preHandler: fastify.authenticate }, async (req, reply) => {
      const tag = await findTag(req, req.params.tagId)
      if (!tag) return reply.status(404).send({ error: 'Unknown tag' })
      const action = tag['action'] as TagAction
      // `open` is returned on duplicates too — a second tap should still open the screen.
      const summary = {
        tag_id: tag['tag_id'], name: tag['name'], icon: tag['icon'],
        open: action.type === 'open' ? action.view : null,
      }

      // Claim the tap atomically so concurrent reads can't both run the action.
      const now = new Date()
      const claim = await tags().updateOne(
        {
          _id: tag['_id'],
          $or: [{ last_tapped_at: null }, { last_tapped_at: { $lt: new Date(now.getTime() - DEBOUNCE_MS) } }],
        },
        { $set: { last_tapped_at: now }, $inc: { tap_count: 1 } },
      )
      if (claim.modifiedCount === 0) {
        return { data: { ...summary, duplicate: true, message: `${tag['name']} — already done just now` } }
      }

      try {
        const message = await run(req, tag)
        fastify.audit({
          actor_id: req.user!.id,
          actor_type: req.apiKeyId ? 'apikey' : 'user',
          action: 'nfc.tap',
          resource_ref: `nfc:${tag['tag_id']}`,
          org_id: req.user!.orgId,
          ip: req.ip,
        })
        return { data: { ...summary, duplicate: false, message } }
      } catch (err) {
        // Release the claim so the next tap retries instead of being swallowed as a duplicate.
        await tags().updateOne(
          { _id: tag['_id'] },
          { $set: { last_tapped_at: tag['last_tapped_at'] ?? null }, $inc: { tap_count: -1 } },
        )
        if (err instanceof TapError) return reply.status(err.status).send({ error: err.message })
        throw err
      }
    }
  )
}

export default nfcRoutes
