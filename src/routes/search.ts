import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getPool } from '../lib/timescale.js'

const searchRoutes: FastifyPluginAsync = async (fastify) => {
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
      const q = params.q

      // Use $text search if text indexes exist, fall back to regex
      async function mongoSearch(
        collection: string,
        textFields: string[],
        projection: Record<string, 1>,
        transform: (doc: Record<string, unknown>) => unknown,
        extraFilter: Record<string, unknown> = {},
      ) {
        const base: Record<string, unknown> = { org_id: orgId, deleted_at: { $exists: false }, ...extraFilter }
        try {
          // Try $text first
          const docs = await fastify.mongo.collection(collection)
            .find({ ...base, $text: { $search: q } }, { projection: { ...projection, score: { $meta: 'textScore' } } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(params.limit)
            .toArray()
          return docs.map(d => transform(d as Record<string, unknown>))
        } catch {
          // Fall back to regex (no text index yet)
          const qRegex = { $regex: q, $options: 'i' }
          const orClause = textFields.map(f => ({ [f]: qRegex }))
          const docs = await fastify.mongo.collection(collection)
            .find({ ...base, $or: orClause })
            .sort({ updated_at: -1 })
            .limit(params.limit)
            .toArray()
          return docs.map(d => transform(d as Record<string, unknown>))
        }
      }

      const [cards, notes, listItems, trailResults] = await Promise.all([
        (!params.type || params.type === 'board')
          ? mongoSearch(
              'board_cards',
              ['title', 'notes'],
              { ref: 1, title: 1, space_id: 1, updated_at: 1 },
              d => ({ type: 'board', ref: d['ref'], title: d['title'], space_ref: d['space_id'], updated_at: d['updated_at'] }),
              params.space ? { 'space_ref': { $regex: params.space } } : {},
            )
          : Promise.resolve([]),

        (!params.type || params.type === 'note')
          ? mongoSearch(
              'note_content',
              ['body'],
              { space_id: 1, body: 1, updated_at: 1 },
              d => {
                const snippet = (d['body'] as string ?? '').slice(0, 120)
                return { type: 'note', ref: String(d['space_id']), title: snippet, space_ref: d['space_id'], updated_at: d['updated_at'] }
              },
            )
          : Promise.resolve([]),

        (!params.type || params.type === 'list')
          ? mongoSearch(
              'list_items',
              ['title'],
              { title: 1, space_id: 1, done: 1, updated_at: 1 },
              d => ({ type: 'list', ref: String(d['space_id']), title: d['title'], space_ref: d['space_id'], updated_at: d['updated_at'] }),
            )
          : Promise.resolve([]),

        (!params.type || params.type === 'trail')
          ? getPool().query(
              `SELECT id, space_ref, ts, text, tone, source
               FROM trail_entries
               WHERE org_id=$1 AND text ILIKE $2
               ${params.space ? 'AND space_ref LIKE $3' : ''}
               ORDER BY ts DESC LIMIT $${params.space ? 4 : 3}`,
              params.space
                ? [orgId.toString(), `%${q}%`, `%${params.space}%`, params.limit]
                : [orgId.toString(), `%${q}%`, params.limit]
            ).then(r => r.rows).catch(() => [])
          : Promise.resolve([]),
      ])

      // Resolve note_content space refs to actual space refs
      const noteSpaceIds = notes.map(n => (n as Record<string, unknown>)['space_ref'])
      let spaceRefMap: Record<string, string> = {}
      if (noteSpaceIds.length > 0) {
        const { ObjectId } = await import('mongodb')
        const spaces = await fastify.mongo.collection('spaces')
          .find({ _id: { $in: noteSpaceIds.map(id => { try { return new ObjectId(String(id)) } catch { return id } }) } })
          .project({ _id: 1, ref: 1, slug: 1 })
          .toArray()
        spaceRefMap = Object.fromEntries(spaces.map(s => [s['_id'].toString(), s['ref'] as string]))
      }

      for (const c of cards) results.push(c)

      for (const n of notes as Record<string, unknown>[]) {
        const spaceRef = spaceRefMap[String(n['space_ref'])] ?? String(n['space_ref'])
        results.push({ type: 'note', ref: spaceRef, title: n['title'], space_ref: spaceRef, updated_at: n['updated_at'] })
      }

      for (const item of listItems) results.push(item)

      for (const t of trailResults as Record<string, unknown>[]) {
        results.push({
          type: 'trail',
          ref: `${t['space_ref'] as string}#entry_${t['id'] as string}`,
          title: (t['text'] as string).slice(0, 100),
          space_ref: t['space_ref'],
          ts: t['ts'],
        })
      }

      return { data: results, meta: { query: q, total: results.length } }
    }
  )
}

export default searchRoutes
