import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

/**
 * Overrides for the situation ("your word beats the sensors"). Each is an ordinary
 * trail entry, appended through the trail route so it joins the hash chain and shows
 * on the trail like anything else. lib/situation.ts reads today's latest one.
 */
const situationRoutes: FastifyPluginAsync = async (fastify) => {
  async function log(req: FastifyRequest, text: string, meta: Record<string, unknown>) {
    const trail = await fastify.mongo.collection('spaces')
      .findOne({ org_id: req.user!.orgId, type: 'trail', deleted_at: { $exists: false } })
    if (!trail) throw fastify.httpErrors.badRequest('No trail to record it on')
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/trail/${encodeURIComponent(trail['slug'] as string)}/append`,
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
      },
      payload: { text, tone: 'neutral', source: 'manual', tags: ['situation'], meta },
    })
    if (res.statusCode >= 300) throw fastify.httpErrors.createError(res.statusCode, 'Could not record it')
  }

  // POST /api/situation/energy {level} — "low energy today" (or normal/high), for today only.
  fastify.post('/api/situation/energy', { preHandler: fastify.authenticate }, async (req) => {
    const { level } = z.object({ level: z.enum(['low', 'normal', 'high']) }).parse(req.body)
    const words = { low: '🪫 Low energy today', normal: '🔋 Energy back to normal', high: '⚡ Good energy today' }
    await log(req, words[level], { type: 'situation/energy@1', level })
    return { ok: true }
  })

  // POST /api/situation/day {off} — a sick day / day off (true), or back to a normal day (false).
  fastify.post('/api/situation/day', { preHandler: fastify.authenticate }, async (req) => {
    const { off } = z.object({ off: z.boolean() }).parse(req.body)
    await log(req, off ? '🛌 Taking today off' : '📅 Back to a normal day', { type: 'situation/day@1', day: off ? 'off' : 'normal' })
    return { ok: true }
  })
}

export default situationRoutes
