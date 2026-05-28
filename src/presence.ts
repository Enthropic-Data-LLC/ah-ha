/**
 * Presence service — Phase 1 Week 5-6
 * Receives events from native companion (BLE, GPS, WiFi SSID)
 * Evaluates place rules and triggers AI sweeps
 */
import 'dotenv/config'
import Fastify from 'fastify'

const fastify = Fastify({ logger: true })
const port = parseInt(process.env['PRESENCE_PORT'] ?? '3002', 10)

fastify.get('/healthz', async () => ({ ok: true, service: 'presence' }))

// Stub — full implementation in Phase 1 Week 5-6
fastify.post('/api/presence/event', async (req) => {
  fastify.log.info({ body: req.body }, 'presence event received')
  return { ok: true }
})

await fastify.listen({ port, host: '0.0.0.0' })
fastify.log.info(`Presence service listening on :${port}`)
