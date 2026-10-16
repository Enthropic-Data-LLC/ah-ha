import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getPool } from '../lib/timescale.js'

/**
 * GET /api/day-summary?since=<ISO> — what got done, for the evening wrap-up.
 * `since` is the client's local midnight (the server doesn't know the user's day).
 * Built from completions and the trail only — deliberately no AI call.
 */
const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { since?: string } }>(
    '/api/day-summary',
    { preHandler: fastify.authenticate },
    async (req) => {
      const { since: sinceRaw } = z.object({ since: z.string().datetime({ offset: true }).optional() }).parse(req.query)
      const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 3_600_000)
      const orgId = req.user!.orgId

      const [cards, listDone, habits, trail] = await Promise.all([
        fastify.mongo.collection('board_cards').find({
          org_id: orgId,
          deleted_at: { $exists: false },
          $or: [{ completed_at: { $gte: since } }, { 'recurrence.last_completed_at': { $gte: since } }],
        }).toArray(),
        fastify.mongo.collection('list_items').find({
          org_id: orgId, deleted_at: { $exists: false }, done: true, done_at: { $gte: since },
        }).toArray(),
        fastify.mongo.collection('board_cards').find({
          org_id: orgId, deleted_at: { $exists: false },
          'recurrence.archetype': 'habit', 'recurrence.streak_count': { $gte: 2 },
        }).sort({ 'recurrence.streak_count': -1 }).limit(3).toArray(),
        getPool().query<{ text: string; tone: string; source: string; meta: Record<string, unknown>; ts: Date }>(
          `SELECT text, tone, source, meta, ts FROM trail_entries WHERE org_id = $1 AND ts >= $2 ORDER BY ts`,
          [orgId.toString(), since],
        ).then(r => r.rows),
      ])

      const tones = { happy: 0, neutral: 0, sorrow: 0 } as Record<string, number>
      for (const e of trail) tones[e.tone] = (tones[e.tone] ?? 0) + 1

      return {
        data: {
          since: since.toISOString(),
          completed: cards.map(c => ({
            title: c['title'] as string,
            archetype: (c['recurrence'] as { archetype?: string } | null)?.archetype ?? null,
          })),
          list_done: listDone.map(i => ({ title: i['title'] as string })),
          trail: {
            total: trail.length,
            tones,
            notes: trail.filter(e => e.source === 'manual').slice(-5).map(e => ({ text: e.text, tone: e.tone, ts: e.ts })),
            taps: trail.filter(e => e.source === 'nfc').map(e => ({ name: (e.meta?.['nfc_name'] as string) ?? e.text, ts: e.ts })),
            presence: trail.filter(e => e.source === 'presence').map(e => ({ text: e.text, ts: e.ts })),
          },
          streaks: habits.map(h => ({
            title: h['title'] as string,
            streak: (h['recurrence'] as { streak_count?: number }).streak_count ?? 0,
          })),
        },
      }
    }
  )
}

export default summaryRoutes
