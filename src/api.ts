import 'dotenv/config'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import Fastify from 'fastify'
import staticFiles from '@fastify/static'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'

import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import authPlugin from './plugins/auth.js'

import authRoutes from './routes/auth.js'
import spacesRoutes from './routes/spaces.js'
import boardRoutes from './routes/board.js'
import trailRoutes from './routes/trail.js'
import noteRoutes from './routes/note.js'
import listRoutes from './routes/list.js'
import linksRoutes from './routes/links.js'
import searchRoutes from './routes/search.js'
import keysRoutes from './routes/keys.js'
import tableRoutes from './routes/table.js'
import mqttRoutes from './routes/mqtt.js'
import notificationsRoutes from './routes/notifications.js'
import { setupTrailSchema, closePool } from './lib/timescale.js'

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

await fastify.register(dbPlugin)
await fastify.register(redisPlugin)
await fastify.register(authPlugin)

// ── Rate limiting ──────────────────────────────────────────────────────────
// Key: org_id for authenticated routes, IP for public routes
// redis store shared across instances

await fastify.register(rateLimit, {
  global: false,   // opt-in per route/group
  redis: fastify.redis,
  keyGenerator: (req) => {
    // Use org_id if authenticated, else IP
    return req.user?.orgId?.toString() ?? req.ip
  },
  errorResponseBuilder: (_req, context) => ({
    error: 'Too many requests',
    retryAfter: context.after,
  }),
})

// Auth endpoints — tight: 10/min by IP
await fastify.register(async (sub) => {
  sub.addHook('onRoute', (route) => {
    route.config = {
      ...route.config,
      rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.ip },
    }
  })
  await sub.register(authRoutes)
})

// Reads — 200/min by org_id
await fastify.register(async (sub) => {
  sub.addHook('onRoute', (route) => {
    if (['GET', 'HEAD'].includes(route.method as string)) {
      route.config = { ...route.config, rateLimit: { max: 200, timeWindow: '1 minute' } }
    }
  })
  await sub.register(spacesRoutes)
  await sub.register(boardRoutes)
  await sub.register(trailRoutes)
  await sub.register(noteRoutes)
  await sub.register(listRoutes)
  await sub.register(linksRoutes)
  await sub.register(searchRoutes)
  await sub.register(keysRoutes)
  await sub.register(tableRoutes)
  await sub.register(mqttRoutes)
  await sub.register(notificationsRoutes)
})

fastify.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

// Serve built frontend — SPA fallback sends index.html for any unmatched GET
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
await fastify.register(staticFiles, { root: webDist, wildcard: false })
fastify.setNotFoundHandler(async (_req, reply) => {
  reply.sendFile('index.html')
})

fastify.addHook('onClose', async () => {
  await closePool()
})

// Set up TimescaleDB schema (non-fatal if TimescaleDB not yet available)
if (process.env['TIMESCALE_URI']) {
  await setupTrailSchema().catch(err => {
    fastify.log.warn({ err }, 'TimescaleDB setup failed — trail routes will error until available')
  })
}

const port = parseInt(process.env['PORT'] ?? '3100', 10)
await fastify.listen({ port, host: '0.0.0.0' })

fastify.log.info(`API server listening on :${port}`)
