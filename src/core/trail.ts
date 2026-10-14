import type { FastifyInstance } from 'fastify'
import type { Caller, Doc } from './index.js'
import { getPool } from '../lib/timescale.js'

export interface TrailRow { text: string; tone: string; source: string; meta: Record<string, unknown>; ts: Date }

export function trailCore(fastify: FastifyInstance) {
  const defaultTrail = (c: Caller) =>
    fastify.mongo.collection<Doc>('spaces').findOne({ org_id: c.orgId, type: 'trail', deleted_at: { $exists: false } })
  return {
    /** The user's first trail (where overrides and taps are recorded). */
    defaultTrail,

    /** Entries per tone in one trail since [since]. */
    toneCounts: async (_c: Caller, spaceRef: string, since: Date): Promise<Record<string, number>> => {
      const res = await getPool().query<{ tone: string; cnt: string }>(
        `SELECT tone, count(*) as cnt FROM trail_entries WHERE space_ref = $1 AND ts >= $2 GROUP BY tone`, [spaceRef, since])
      return res.rows.reduce<Record<string, number>>((a, r) => { a[r.tone] = parseInt(r.cnt); return a }, {})
    },

    /** Every entry across the user's trails since [since], oldest first. */
    entriesSince: (c: Caller, since: Date) =>
      getPool().query<TrailRow>(
        `SELECT text, tone, source, meta, ts FROM trail_entries WHERE org_id = $1 AND ts >= $2 ORDER BY ts`,
        [c.orgId.toString(), since],
      ).then(r => r.rows),

    /** Entries of these meta types ("ah-cart/trip@1"…) since [since], oldest first. */
    ofType: (c: Caller, types: string[], since: Date) =>
      getPool().query<TrailRow>(
        `SELECT text, tone, source, meta, ts FROM trail_entries WHERE org_id = $1 AND ts >= $2 AND meta->>'type' = ANY($3) ORDER BY ts`,
        [c.orgId.toString(), since, types],
      ).then(r => r.rows),

    /** Local days (YYYY-MM-DD in [tz]) with an entry since [since], leaving out [skipSources]. */
    activeDays: (c: Caller, since: Date, tz: string, skipSources: string[]) =>
      getPool().query<{ day: string }>(
        `SELECT DISTINCT to_char(ts AT TIME ZONE $3, 'YYYY-MM-DD') AS day
           FROM trail_entries
          WHERE org_id = $1 AND ts >= $2 AND NOT (source = ANY($4))`,
        [c.orgId.toString(), since, tz, skipSources],
      ).then(r => r.rows.map(x => x.day)),

    /**
     * Append to the user's default trail through the public trail route, as the caller,
     * so it joins the hash chain and is checked like any other write.
     */
    append: async (c: Caller, entry: { text: string; tone: string; source: string; tags?: string[]; meta?: Record<string, unknown> }) => {
      const trail = await defaultTrail(c)
      if (!trail) throw fastify.httpErrors.badRequest('No trail to record it on')
      const res = await fastify.inject({
        method: 'POST',
        url: `/api/trail/${encodeURIComponent(trail['slug'] as string)}/append`,
        headers: c.auth,
        payload: entry,
      })
      if (res.statusCode >= 300) throw fastify.httpErrors.createError(res.statusCode, 'Could not record it')
    },
  }
}
