import 'dotenv/config'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { STATUS_CODES } from 'node:http'
import { ZodError } from 'zod'
import Fastify, { type FastifyError } from 'fastify'
import staticFiles from '@fastify/static'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'

import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'
import authPlugin from './plugins/auth.js'
import auditPlugin from './plugins/audit.js'

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
import auditRoutes from './routes/audit.js'
import webhooksRoutes from './routes/webhooks.js'
import shareRoutes from './routes/share.js'
import settingsRoutes from './routes/settings.js'
import { captureRoute } from './routes/capture.js'
import nowRoutes from './routes/now.js'
import entityRoutes from './routes/entities.js'
import recurrenceRoutes from './routes/recurrence.js'
import calendarRoutes from './routes/calendar.js'
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
await fastify.register(auditPlugin)

// Rate-limit tiers are assigned HERE, before @fastify/rate-limit is
// registered, and this ordering is load-bearing.
//
// These tiers used to be set by an onRoute hook inside each sub-plugin below.
// That silently did nothing: with global:false the plugin decides per route at
// registration time, using its own onRoute hook, and a hook added to the
// parent runs before one added later in a child scope. The plugin therefore
// inspected every route before the child hook attached config.rateLimit, found
// none, and skipped it. No route in the app was rate limited — the "tight:
// 10/min" auth limiter included. Verified against fastify 5 / rate-limit 10:
// child-hook = never 429, this ordering = 429 on the 11th request.
//
// Keep this hook above the register() call.
const TIGHT_AUTH = new Set([
  '/auth/pow-challenge',
  '/auth/magic-link',
  '/auth/claim-username',
  '/auth/dev-link',
  '/api/auth/verify',
])

fastify.addHook('onRoute', (route) => {
  const methods = Array.isArray(route.method) ? route.method : [route.method]

  if (TIGHT_AUTH.has(route.url)) {
    // Endpoints that send mail or mint work, keyed by IP. Deliberately does
    // NOT include /auth/me or /auth/logout: the frontend calls /auth/me on
    // every page load, and 10/min per IP would break normal use behind a
    // shared NAT the moment this limiter actually started working.
    route.config = {
      ...route.config,
      rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => req.ip },
    }
  } else if (route.url.startsWith('/api/') && methods.some((m) => m === 'GET' || m === 'HEAD')) {
    // Read traffic, keyed by org via the plugin's default keyGenerator.
    // Scoped to /api/ so the static assets and SPA fallback served from the
    // root are not throttled.
    route.config = { ...route.config, rateLimit: { max: 200, timeWindow: '1 minute' } }
  }
})

await fastify.register(rateLimit, {
  global: false,
  redis: fastify.redis,
  keyGenerator: (req) => req.user?.orgId?.toString() ?? req.ip,
  // statusCode must be on this object: @fastify/rate-limit throws the value
  // returned here as the error, so it reaches setErrorHandler. Without it the
  // handler cannot tell a 429 from an unhandled crash and answers 500.
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too many requests',
    retryAfter: context.after,
  }),
})

// Zod validation failures are thrown, not returned, so Fastify's default
// handler treated them as unhandled 500s and serialised the whole ZodError
// into the response body — the wrong status, and it published the request
// schema of every endpoint that calls .parse() (about twenty of them).
// Everything that is not a ZodError keeps Fastify's default shape and status
// so no existing client sees a different response than it did before.
fastify.setErrorHandler((err: FastifyError, req, reply) => {
  if (err instanceof ZodError) {
    req.log.warn({ url: req.url, issues: err.issues }, 'request validation failed')
    return reply.status(400).send({
      error: 'Invalid request',
      // Field names only — enough for a client to correct the call, without
      // handing back the expected types and constraints.
      fields: [...new Set(err.issues.map((i) => i.path.join('.')).filter(Boolean))],
    })
  }

  const status = err.statusCode ?? 500

  // Rate-limit rejections arrive here as the errorResponseBuilder payload
  // rather than as an Error; pass it through intact so clients keep retryAfter.
  if (status === 429) {
    return reply.status(429).send({
      error: 'Too many requests',
      retryAfter: (err as unknown as { retryAfter?: number }).retryAfter,
    })
  }

  if (status >= 500) req.log.error(err)
  return reply.status(status).send({
    statusCode: status,
    error: STATUS_CODES[status] ?? 'Error',
    message: err.message,
  })
})

// Auth endpoints — rate-limit tier assigned by the onRoute hook above.
await fastify.register(async (sub) => {
  await sub.register(authRoutes)
})

// All other routes — rate-limit tier assigned by the onRoute hook above.
await fastify.register(async (sub) => {
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
  await sub.register(auditRoutes)
  await sub.register(webhooksRoutes)
  await sub.register(shareRoutes)
  await sub.register(settingsRoutes)
  await sub.register(captureRoute)
  await sub.register(nowRoutes)
  await sub.register(entityRoutes)
  await sub.register(recurrenceRoutes)
  await sub.register(calendarRoutes)
})

fastify.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist')
await fastify.register(staticFiles, { root: webDist })
fastify.setNotFoundHandler(async (_req, reply) => {
  return reply.sendFile('index.html')
})

fastify.addHook('onClose', async () => {
  await closePool()
})

if (process.env['TIMESCALE_URI']) {
  await setupTrailSchema().catch(err => {
    fastify.log.warn({ err }, 'TimescaleDB setup failed — trail routes will error until available')
  })
}

const port = parseInt(process.env['PORT'] ?? '3100', 10)
await fastify.listen({ port, host: '0.0.0.0' })

fastify.log.info(`API server listening on :${port}`)
