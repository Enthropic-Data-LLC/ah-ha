import type { FastifyPluginAsync } from 'fastify'
import { usageFor } from '../lib/usage.js'

/** GET /api/usage — the signed-in account's plan, its limits and how much of them it uses (KB #2160). */
const usageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/usage', { preHandler: fastify.authenticate }, async (req) => ({ data: await usageFor(fastify, req.user!.orgId) }))
}

export default usageRoutes
