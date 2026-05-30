import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash } from 'crypto'
import { getPool } from '../lib/timescale.js'

const VALID_SOURCES = new Set(['manual', 'mqtt', 'mcp', 'api', 'n8n', 'presence', 'nfc'])

const appendBody = z.object({
  text: z.string().min(1).max(10000),
  tone: z.enum(['happy', 'sorrow', 'neutral']).default('neutral'),
  source: z.string().max(100).optional(),
  tags: z.array(z.string()).default([]),
  meta: z.record(z.unknown()).default({}),
})

const queryParams = z.object({
  tone: z.enum(['happy', 'sorrow', 'neutral']).optional(),
  source: z.string().optional(),
  tags: z.string().optional(),        // comma-separated
  since: z.string().optional(),       // "24h" | "7d" | "30d" | ISO
  until: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),      // ISO timestamp for pagination
})

function hashEntry(id: string, ts: Date, text: string): string {
  return createHash('sha256').update(`${id}|${ts.toISOString()}|${text}`).digest('hex')
}

const trailRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/trail/:slug/append
  fastify.post<{ Params: { slug: string } }>(
    '/api/trail/:slug/append',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = appendBody.parse(req.body)
      const xSource = req.headers['x-aha-source']
      const source = body.source
        ?? (typeof xSource === 'string' && VALID_SOURCES.has(xSource) ? xSource : 'manual')

      const space = await getTrailSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Trail not found' })

      const db = getPool()

      // Fetch the most recent entry to build the hash chain
      const prev = await db.query<{ id: string; ts: Date; text: string }>(
        `SELECT id, ts, text FROM trail_entries WHERE space_ref = $1 ORDER BY ts DESC LIMIT 1`,
        [space['ref']]
      )
      const prevRow = prev.rows[0]
      const prevHash = prevRow
        ? hashEntry(prevRow.id, prevRow.ts, prevRow.text)
        : hashEntry('genesis', new Date(0), space['ref'] as string)

      const result = await db.query<{ id: string; ts: Date }>(
        `INSERT INTO trail_entries (space_ref, org_id, text, tone, source, tags, meta, created_by, prev_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, ts`,
        [
          space['ref'],
          req.user!.orgId.toString(),
          body.text,
          body.tone,
          source,
          body.tags,
          JSON.stringify(body.meta),
          req.apiKeyId ? null : req.user!.id.toString(),
          prevHash,
        ]
      )

      const entry = result.rows[0]!
      reply.status(201)
      return {
        data: {
          id: entry.id,
          ref: `${space['ref']}#entry_${entry.id}`,
          ts: entry.ts,
          text: body.text,
          tone: body.tone,
          source,
          tags: body.tags,
          meta: body.meta,
          prev_hash: prevHash,
        },
      }
    }
  )

  // GET /api/trail/:slug/entries
  fastify.get<{ Params: { slug: string }; Querystring: z.infer<typeof queryParams> }>(
    '/api/trail/:slug/entries',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const params = queryParams.parse(req.query)
      const space = await getTrailSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Trail not found' })

      const conditions: string[] = ['space_ref = $1', 'org_id = $2']
      const values: unknown[] = [space['ref'], req.user!.orgId.toString()]
      let idx = 3

      if (params.tone) { conditions.push(`tone = $${idx++}`); values.push(params.tone) }
      if (params.source) { conditions.push(`source = $${idx++}`); values.push(params.source) }
      if (params.tags) {
        const tagList = params.tags.split(',').map(t => t.trim())
        conditions.push(`tags @> $${idx++}`)
        values.push(tagList)
      }
      if (params.since) {
        conditions.push(`ts >= $${idx++}`)
        values.push(parseSince(params.since))
      }
      if (params.until) {
        conditions.push(`ts <= $${idx++}`)
        values.push(new Date(params.until))
      }
      if (params.cursor) {
        conditions.push(`ts < $${idx++}`)
        values.push(new Date(params.cursor))
      }
      if (params.search) {
        conditions.push(`text ILIKE $${idx++}`)
        values.push(`%${params.search}%`)
      }

      const where = conditions.join(' AND ')
      values.push(params.limit + 1)
      const limitIdx = idx

      const db = getPool()
      const result = await db.query(
        `SELECT id, ts, text, tone, source, tags, meta, created_by, prev_hash
         FROM trail_entries
         WHERE ${where}
         ORDER BY ts DESC
         LIMIT $${limitIdx}`,
        values
      )

      const rows = result.rows
      const has_more = rows.length > params.limit
      if (has_more) rows.pop()

      const spaceRef: string = space['ref'] as string
      return {
        data: rows.map(r => ({
          ...r,
          ref: `${spaceRef}#entry_${r.id as string}`,
        })),
        meta: {
          has_more,
          cursor: has_more && rows.length > 0 ? (rows[rows.length - 1]! as { ts: Date }).ts.toISOString() : null,
        },
      }
    }
  )

  // GET /api/trail/:slug/summary — structured data for AI (aha_trail_summarize)
  fastify.get<{ Params: { slug: string }; Querystring: { since?: string } }>(
    '/api/trail/:slug/summary',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const space = await getTrailSpace(fastify, req.params.slug, req.user!.orgId)
      if (!space) return reply.status(404).send({ error: 'Trail not found' })

      const since = parseSince(req.query.since ?? '24h')
      const db = getPool()

      const [counts, recent, streakData] = await Promise.all([
        db.query(
          `SELECT tone, count(*) AS n FROM trail_entries
           WHERE space_ref=$1 AND org_id=$2 AND ts >= $3
           GROUP BY tone`,
          [space['ref'], req.user!.orgId.toString(), since]
        ),
        db.query(
          `SELECT id, ts, text, tone, source FROM trail_entries
           WHERE space_ref=$1 AND org_id=$2 AND ts >= $3
           ORDER BY ts DESC LIMIT 20`,
          [space['ref'], req.user!.orgId.toString(), since]
        ),
        db.query(
          `SELECT tone, ts FROM trail_entries
           WHERE space_ref=$1 AND org_id=$2
           ORDER BY ts DESC LIMIT 50`,
          [space['ref'], req.user!.orgId.toString()]
        ),
      ])

      const toneMap: Record<string, number> = { happy: 0, sorrow: 0, neutral: 0 }
      for (const row of counts.rows) toneMap[row['tone'] as string] = parseInt(row['n'] as string, 10)

      return {
        data: {
          total: Object.values(toneMap).reduce((a, b) => a + b, 0),
          happy: toneMap['happy'],
          sorrow: toneMap['sorrow'],
          neutral: toneMap['neutral'],
          streaks: detectStreaks(streakData.rows as Array<{ tone: string; ts: Date }>),
          entries: recent.rows,
        },
      }
    }
  )
}

function getTrailSpace(fastify: { mongo: import('mongodb').Db }, slug: string, orgId: import('mongodb').ObjectId) {
  return fastify.mongo.collection('spaces').findOne({
    slug, type: 'trail', org_id: orgId, deleted_at: { $exists: false },
  })
}

function parseSince(since: string): Date {
  if (since === '24h') return new Date(Date.now() - 86400_000)
  if (since === '7d')  return new Date(Date.now() - 7 * 86400_000)
  if (since === '30d') return new Date(Date.now() - 30 * 86400_000)
  return new Date(since)
}

function detectStreaks(entries: Array<{ tone: string; ts: Date }>) {
  if (entries.length === 0) return { current_tone: null, current_length: 0, sorrows_since_last_happy: 0 }
  const currentTone = entries[0]!.tone
  let currentLength = 0
  for (const e of entries) {
    if (e.tone === currentTone) currentLength++
    else break
  }
  let sorrowsSinceHappy = 0
  for (const e of entries) {
    if (e.tone === 'happy') break
    if (e.tone === 'sorrow') sorrowsSinceHappy++
  }
  return { current_tone: currentTone, current_length: currentLength, sorrows_since_last_happy: sorrowsSinceHappy }
}

export default trailRoutes
