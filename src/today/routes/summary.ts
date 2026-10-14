import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { core, callerOf } from '../../core/index.js'

/**
 * GET /api/day-summary?since=<ISO> — what got done, for the evening wrap-up.
 * `since` is the client's local midnight (the server doesn't know the user's day).
 * Built from completions and the trail only — deliberately no AI call.
 */
const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  const c = core(fastify)
  fastify.get<{ Querystring: { since?: string } }>(
    '/api/day-summary',
    { preHandler: fastify.authenticate },
    async (req) => {
      const { since: sinceRaw } = z.object({ since: z.string().datetime({ offset: true }).optional() }).parse(req.query)
      const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 3_600_000)
      const caller = callerOf(req)

      const [cards, listDone, habits, trail] = await Promise.all([
        c.cards.completedSince(caller, since),
        c.lists.doneSince(caller, since),
        c.cards.habitStreaks(caller, 2, 3),
        c.trail.entriesSince(caller, since),
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
