import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'
import { getPool } from '../lib/timescale.js'

const EXPIRY_OPTIONS = {
  '24h':  24 * 3600 * 1000,
  '7d':   7  * 24 * 3600 * 1000,
  '30d':  30 * 24 * 3600 * 1000,
  'never': null,
} as const

const shareRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /api/spaces/:ref/share — create share token
  fastify.post<{ Params: { ref: string } }>(
    '/api/spaces/:ref/share',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const ref = decodeURIComponent(req.params.ref)
      const { expires } = z.object({
        expires: z.enum(['24h', '7d', '30d', 'never']).default('7d'),
      }).parse(req.body ?? {})

      const space = await fastify.mongo.collection('spaces').findOne({
        ref, org_id: req.user!.orgId, deleted_at: { $exists: false },
      })
      if (!space) return reply.status(404).send({ error: 'Not found' })

      const token     = nanoid(24)
      const ms        = EXPIRY_OPTIONS[expires]
      const expiresAt = ms ? new Date(Date.now() + ms) : null

      await fastify.mongo.collection('share_tokens').insertOne({
        _id: new ObjectId(),
        token,
        space_ref: ref,
        space_type: space['type'],
        org_id: req.user!.orgId,
        created_by: req.user!.id,
        expires_at: expiresAt,
        created_at: new Date(),
      })

      return { data: { token, url: `/s/${token}`, expires_at: expiresAt } }
    }
  )

  // GET /api/share/:token — public read-only space data
  fastify.get<{ Params: { token: string } }>(
    '/api/share/:token',
    async (req, reply) => {
      const share = await fastify.mongo.collection('share_tokens').findOne({
        token: req.params.token,
      })
      if (!share) return reply.status(404).send({ error: 'Not found' })
      if (share['expires_at'] && new Date(share['expires_at'] as string) < new Date()) {
        return reply.status(410).send({ error: 'Share link expired' })
      }

      const spaceRef  = share['space_ref'] as string
      const spaceType = share['space_type'] as string

      const space = await fastify.mongo.collection('spaces').findOne({
        ref: spaceRef, deleted_at: { $exists: false },
      })
      if (!space) return reply.status(404).send({ error: 'Space not found' })

      let content: unknown = null

      if (spaceType === 'trail') {
        const pool = getPool()
        const res = await pool.query(
          `SELECT id, ts, text, tone, source, tags FROM trail_entries
           WHERE space_ref = $1 ORDER BY ts DESC LIMIT 50`,
          [spaceRef]
        )
        content = res.rows
      } else if (spaceType === 'note') {
        const note = await fastify.mongo.collection('notes').findOne({ space_ref: spaceRef })
        content = note ? { body: note['body'], updated_at: note['updated_at'] } : { body: '', updated_at: null }
      } else if (spaceType === 'board') {
        const cols = await fastify.mongo.collection('board_columns')
          .find({ space_id: space._id }).sort({ position: 1 }).toArray()
        const cards = await fastify.mongo.collection('board_cards')
          .find({ space_id: space._id, deleted_at: { $exists: false } }).sort({ position: 1 }).toArray()
        content = { columns: cols, cards }
      } else if (spaceType === 'list') {
        const items = await fastify.mongo.collection('list_items')
          .find({ space_id: space._id, deleted_at: { $exists: false } })
          .sort({ done: 1, position: 1 }).toArray()
        content = items
      } else if (spaceType === 'table') {
        const rows = await fastify.mongo.collection('table_rows')
          .find({ space_id: space._id, deleted_at: { $exists: false } })
          .sort({ created_at: 1 }).toArray()
        const schema = await fastify.mongo.collection('table_schemas').findOne({ space_id: space._id })
        content = { schema: schema?.['columns'] ?? [], rows }
      }

      return {
        data: {
          space: { name: space['name'], type: spaceType, ref: spaceRef },
          content,
          expires_at: share['expires_at'],
        },
      }
    }
  )
}

export default shareRoutes
