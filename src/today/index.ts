import type { FastifyPluginAsync } from 'fastify'
import nowRoutes from './routes/now.js'
import summaryRoutes from './routes/summary.js'
import situationRoutes from './routes/situation.js'

/**
 * Today: the attention layer on top of core (docs: "Ah-Ha: Today as a layer on core").
 * What deserves attention now — focus, briefing, streak, day summary, overrides.
 * Reads and writes only through src/core/ (tests/boundary.test.ts).
 */
const today: FastifyPluginAsync = async (fastify) => {
  await fastify.register(nowRoutes)
  await fastify.register(summaryRoutes)
  await fastify.register(situationRoutes)
}

export default today
