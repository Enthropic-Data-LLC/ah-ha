import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getPool } from '../lib/timescale.js'

const searchRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/search?q=&type=&space=
  fastify.get<{ Querystring: { q: string; type?: string; space?: string; limit?: string } }>(
    '/api/search',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const params = z.object({
        q: z.string().min(1).max(200),
        type: z.string().optional(),
        space: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(req.query)

      const orgId = req.user!.orgId
      const results: unknown[] = []

      // Case-insensitive regex — works without a text index in dev;
      // production Atlas Search is wired at the reverse-proxy layer.
      const qRegex = { $regex: params.q, $options: 'i' }
      const mongoFilter: Record<string, unknown> = {
        org_id: orgId,
        deleted_at: { $exists: false },
        $or: [{ title: qRegex }, { notes: qRegex }],
      }
      if (params.space) mongoFilter['space_ref'] = { $regex: params.space }

      // Search board cards + trail entries in parallel
      const [cards, trailResults] = await Promise.all([
        // Board cards (title + notes)
        (!params.type || params.type === 'board')
          ? fastify.mongo.collection('board_cards')
              .find(mongoFilter)
              .sort({ updated_at: -1 })
              .limit(params.limit)
              .toArray()
              .catch(() => [])
          : Promise.resolve([]),

        // Trail entries (TimescaleDB ILIKE — Atlas Search in prod)
        (!params.type || params.type === 'trail')
          ? getPool().query(
              `SELECT id, space_ref, ts, text, tone, source
               FROM trail_entries
               WHERE org_id=$1 AND text ILIKE $2
               ${params.space ? 'AND space_ref LIKE $3' : ''}
               ORDER BY ts DESC LIMIT $${params.space ? 4 : 3}`,
              params.space
                ? [orgId.toString(), `%${params.q}%`, `%${params.space}%`, params.limit]
                : [orgId.toString(), `%${params.q}%`, params.limit]
            ).then(r => r.rows).catch(() => [])
          : Promise.resolve([]),
      ])

      for (const c of cards) {
        results.push({ type: 'board', ref: c['ref'], title: c['title'], space_ref: c['space_ref'], updated_at: c['updated_at'] })
      }
      for (const t of trailResults) {
        results.push({ type: 'trail', ref: `${t['space_ref'] as string}#entry_${t['id'] as string}`, title: (t['text'] as string).slice(0, 100), space_ref: t['space_ref'], ts: t['ts'] })
      }

      return { data: results, meta: { query: params.q, total: results.length } }
    }
  )
}

export default searchRoutes
