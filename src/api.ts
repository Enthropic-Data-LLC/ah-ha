import 'dotenv/config'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'

import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import authPlugin from './plugins/auth.js'

import authRoutes from './routes/auth.js'
import spacesRoutes from './routes/spaces.js'
import boardRoutes from './routes/board.js'
import keysRoutes from './routes/keys.js'

const isProd = process.env['NODE_ENV'] === 'production'

const fastify = Fastify({
  logger: {
    level: isProd ? 'info' : 'debug',
    ...(isProd ? {} : { transport: { target: 'pino-pretty' } }),
  },
  trustProxy: true,
})

await fastify.register(cookie)
await fastify.register(cors, {
  origin: isProd ? ['https://ah-ha.app'] : true,
  credentials: true,
})
await fastify.register(sensible)

// Infrastructure plugins
await fastify.register(dbPlugin)
await fastify.register(redisPlugin)
await fastify.register(authPlugin)

// Routes
await fastify.register(authRoutes)
await fastify.register(spacesRoutes)
await fastify.register(boardRoutes)
await fastify.register(keysRoutes)

// Health check
fastify.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

const port = parseInt(process.env['PORT'] ?? '3000', 10)
await fastify.listen({ port, host: '0.0.0.0' })

fastify.log.info(`API server listening on :${port}`)
