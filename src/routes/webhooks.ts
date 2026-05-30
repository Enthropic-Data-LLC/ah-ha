/**
 * Inbound Webhooks — HTTP equivalent of the MQTT canonical topic.
 *
 * Register an endpoint:
 *   POST /api/webhooks  →  { target_space_ref, name, secret?, events: ["trail.append"|"board.card"] }
 *
 * Receive data from external systems:
 *   POST /api/webhooks/receive/:id
 *   Headers: X-Ah-Ha-Signature: sha256=<hmac>  (optional if no secret set)
 *   Body: { text, tone?, tags?, meta? }   — for trail
 *         { title, column_id?, priority? } — for board
 *         raw string                       — treated as trail entry text
 */
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { createHmac, timingSafeEqual } from 'crypto'
import { nanoid } from 'nanoid'

const EVENTS = ['trail.append', 'board.card'] as const

const webhookBody = z.object({
  name: z.string().min(1).max(100),
  target_space_ref: z.string().min(1).describe('e.g. username/trail/my-trail'),
  secret: z.string().min(8).max(256).optional().describe('Used to verify X-Ah-Ha-Signature'),
  events: z.array(z.enum(EVENTS)).default(['trail.append']),
  enabled: z.boolean().default(true),
})

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/webhooks — create webhook endpoint
  fastify.post(
    '/api/webhooks',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = webhookBody.parse(req.body)
      const id = nanoid(24)

      const wh = {
        _id: new ObjectId(),
        id,
        org_id: req.user!.orgId,
        user_id: req.user!.id,
        ...body,
        created_at: new Date(),
        last_received_at: null,
        receive_count: 0,
      }
      await fastify.mongo.collection('webhooks').insertOne(wh)
      reply.status(201)
      return {
        data: {
          ...wh,
          receive_url: `/api/webhooks/receive/${id}`,
        },
      }
    }
  )

  // GET /api/webhooks — list
  fastify.get(
    '/api/webhooks',
    { preHandler: fastify.authenticate },
    async (req) => {
      const whs = await fastify.mongo.collection('webhooks')
        .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
        .sort({ created_at: -1 })
        .toArray()
      return { data: whs.map(w => ({ ...w, receive_url: `/api/webhooks/receive/${w['id'] as string}` })) }
    }
  )

  // DELETE /api/webhooks/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/webhooks/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('webhooks').updateOne(
        { id: req.params.id, org_id: req.user!.orgId },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )

  // POST /api/webhooks/receive/:id — public inbound endpoint (no auth cookie needed)
  fastify.post<{ Params: { id: string } }>(
    '/api/webhooks/receive/:id',
    async (req, reply) => {
      const wh = await fastify.mongo.collection('webhooks').findOne({
        id: req.params.id,
        enabled: true,
        deleted_at: { $exists: false },
      })

      if (!wh) return reply.status(404).send({ error: 'Webhook not found' })

      // Verify HMAC signature if a secret is set
      if (wh['secret']) {
        const sig = req.headers['x-ah-ha-signature'] as string | undefined
        if (!sig) return reply.status(401).send({ error: 'Signature required' })

        const expected = 'sha256=' + createHmac('sha256', wh['secret'] as string)
          .update(JSON.stringify(req.body))
          .digest('hex')

        try {
          const match = timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
          if (!match) return reply.status(401).send({ error: 'Invalid signature' })
        } catch {
          return reply.status(401).send({ error: 'Invalid signature' })
        }
      }

      const spaceRef = wh['target_space_ref'] as string
      const [, type, slug] = spaceRef.split('/')

      let result: unknown = { ok: false, error: 'Unsupported event type' }

      if (type === 'trail') {
        const raw = req.body
        let text: string, tone = 'neutral', tags: string[] = [], meta: Record<string, unknown> = {}

        if (typeof raw === 'string') {
          text = raw
        } else if (typeof raw === 'object' && raw !== null) {
          const b = raw as Record<string, unknown>
          text = (b['text'] as string) ?? JSON.stringify(raw)
          tone = (b['tone'] as string) ?? 'neutral'
          tags = (b['tags'] as string[]) ?? []
          meta = (b['meta'] as Record<string, unknown>) ?? {}
        } else {
          text = String(raw)
        }

        const space = await fastify.mongo.collection('spaces').findOne({
          slug, type: 'trail', org_id: wh['org_id'], deleted_at: { $exists: false },
        })
        if (!space) return reply.status(404).send({ error: 'Trail space not found' })

        // Delegate to trail append via internal API call using the webhook's org context
        const { getPool } = await import('../lib/timescale.js')
        const { createHash } = await import('crypto')
        const db = fastify.mongo
        const pool = getPool()

        const prev = await pool.query<{ id: string; ts: Date; text: string }>(
          `SELECT id, ts, text FROM trail_entries WHERE space_ref = $1 ORDER BY ts DESC LIMIT 1`,
          [spaceRef]
        )
        const prevRow = prev.rows[0]
        const prevHash = prevRow
          ? createHash('sha256').update(`${prevRow.id}|${prevRow.ts.toISOString()}|${prevRow.text}`).digest('hex')
          : createHash('sha256').update(`genesis|${new Date(0).toISOString()}|${spaceRef}`).digest('hex')

        const inserted = await pool.query<{ id: string; ts: Date }>(
          `INSERT INTO trail_entries (space_ref, org_id, text, tone, source, tags, meta, created_by, prev_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, ts`,
          [spaceRef, String(wh['org_id']), text, tone, 'webhook', tags, JSON.stringify(meta), null, prevHash]
        )
        const entry = inserted.rows[0]!
        result = { ok: true, ref: `${spaceRef}#entry_${entry.id}`, ts: entry.ts }

        // Audit
        fastify.audit({
          actor_id: wh['user_id'] as ObjectId,
          actor_type: 'apikey',
          action: 'trail.append',
          resource_ref: `${spaceRef}#entry_${entry.id}`,
          org_id: wh['org_id'] as ObjectId,
          ip: req.ip,
        })

        void db  // suppress unused warning

      } else if (type === 'board') {
        const b = req.body as Record<string, unknown>
        const title = (b['title'] as string) ?? String(req.body)

        const space = await fastify.mongo.collection('spaces').findOne({
          slug, type: 'board', org_id: wh['org_id'], deleted_at: { $exists: false },
        })
        if (!space) return reply.status(404).send({ error: 'Board space not found' })

        const col = b['column_id']
          ? await fastify.mongo.collection('board_columns').findOne({ _id: new ObjectId(b['column_id'] as string) })
          : await fastify.mongo.collection('board_columns').findOne({ space_id: space._id }, { sort: { position: 1 } })

        if (!col) return reply.status(404).send({ error: 'No columns in board' })

        const last = await fastify.mongo.collection('board_cards').findOne(
          { space_id: space._id, column_id: col._id, deleted_at: { $exists: false } },
          { sort: { position: -1 } }
        )

        const { initial } = await import('../lib/lexorank.js')
        const cardId = new ObjectId()
        const ref = `${spaceRef}#card_${cardId.toHexString()}`

        const card = {
          _id: cardId,
          ref,
          space_id: space._id,
          org_id: wh['org_id'],
          column_id: col._id,
          title,
          notes: (b['notes'] as string) ?? '',
          priority: (b['priority'] as string) ?? 'none',
          tags: (b['tags'] as string[]) ?? [],
          color: '',
          position: last ? (last['position'] as number) + 1.0 : initial(),
          created_by: wh['user_id'],
          updated_at: new Date(),
        }
        await fastify.mongo.collection('board_cards').insertOne(card)
        result = { ok: true, ref, card_id: cardId.toHexString() }

        fastify.audit({
          actor_id: wh['user_id'] as ObjectId,
          actor_type: 'apikey',
          action: 'board.card.create',
          resource_ref: ref,
          org_id: wh['org_id'] as ObjectId,
          ip: req.ip,
        })
      }

      // Update receive stats (fire and forget)
      fastify.mongo.collection('webhooks').updateOne(
        { id: req.params.id },
        { $set: { last_received_at: new Date() }, $inc: { receive_count: 1 } }
      ).catch(() => {})

      return result
    }
  )
}

export default webhooksRoutes
