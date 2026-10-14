import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { core, callerOf } from '../../core/index.js'

/**
 * Overrides for the situation ("your word beats the sensors"). Each is an ordinary
 * trail entry, appended through core (the public trail route) so it joins the hash
 * chain and shows on the trail like anything else. lib/situation.ts reads today's latest one.
 */
const situationRoutes: FastifyPluginAsync = async (fastify) => {
  const c = core(fastify)
  const log = (caller: ReturnType<typeof callerOf>, text: string, meta: Record<string, unknown>) =>
    c.trail.append(caller, { text, tone: 'neutral', source: 'manual', tags: ['situation'], meta })

  // POST /api/situation/energy {level} — "low energy today" (or normal/high), for today only.
  fastify.post('/api/situation/energy', { preHandler: fastify.authenticate }, async (req) => {
    const { level } = z.object({ level: z.enum(['low', 'normal', 'high']) }).parse(req.body)
    const words = { low: '🪫 Low energy today', normal: '🔋 Energy back to normal', high: '⚡ Good energy today' }
    await log(callerOf(req), words[level], { type: 'situation/energy@1', level })
    return { ok: true }
  })

  // POST /api/situation/day {off} — a sick day / day off (true), or back to a normal day (false).
  fastify.post('/api/situation/day', { preHandler: fastify.authenticate }, async (req) => {
    const { off } = z.object({ off: z.boolean() }).parse(req.body)
    await log(callerOf(req), off ? '🛌 Taking today off' : '📅 Back to a normal day', { type: 'situation/day@1', day: off ? 'off' : 'normal' })
    return { ok: true }
  })
}

export default situationRoutes
