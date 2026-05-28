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
import trailRoutes from './routes/trail.js'
import noteRoutes from './routes/note.js'
import listRoutes from './routes/list.js'
import linksRoutes from './routes/links.js'
import searchRoutes from './routes/search.js'
import keysRoutes from './routes/keys.js'
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

await fastify.register(authRoutes)
await fastify.register(spacesRoutes)
await fastify.register(boardRoutes)
await fastify.register(trailRoutes)
await fastify.register(noteRoutes)
await fastify.register(listRoutes)
await fastify.register(linksRoutes)
await fastify.register(searchRoutes)
await fastify.register(keysRoutes)

fastify.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }))

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
