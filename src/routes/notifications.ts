import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const TIMEZONES = Intl.supportedValuesOf?.('timeZone') ?? ['UTC']

const prefsBody = z.object({
  daily_briefing: z.object({
    enabled: z.boolean().default(false),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM').default('08:00'),
    timezone: z.string().refine(
      tz => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true } catch { return false } },
      'Invalid timezone'
    ).default('UTC'),
  }).default({}),
  presence: z.object({
    enabled: z.boolean().default(false),
    notify_on: z.array(z.enum(['home', 'away'])).default(['home', 'away']),
  }).default({}),
  channels: z.object({
    telegram_chat_id: z.string().optional(),
    email: z.string().email().optional(),
  }).default({}),
})

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/notifications/prefs
  fastify.get(
    '/api/notifications/prefs',
    { preHandler: fastify.authenticate },
    async (req) => {
      const prefs = await fastify.mongo.collection('notification_prefs')
        .findOne({ user_id: req.user!.id })
      return { data: prefs ?? { daily_briefing: { enabled: false }, presence: { enabled: false }, channels: {} } }
    }
  )

  // PUT /api/notifications/prefs
  fastify.put(
    '/api/notifications/prefs',
    { preHandler: fastify.authenticate },
    async (req) => {
      const body = prefsBody.parse(req.body)
      await fastify.mongo.collection('notification_prefs').updateOne(
        { user_id: req.user!.id },
        { $set: { ...body, user_id: req.user!.id, org_id: req.user!.orgId, updated_at: new Date() } },
        { upsert: true }
      )
      return { ok: true }
    }
  )

  // POST /api/notifications/test — send a test message immediately
  fastify.post(
    '/api/notifications/test',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const { type } = z.object({
        type: z.enum(['daily_briefing', 'presence_home', 'presence_away']).default('daily_briefing'),
      }).parse(req.body)

      const prefs = await fastify.mongo.collection('notification_prefs')
        .findOne({ user_id: req.user!.id })
      if (!prefs) return reply.status(400).send({ error: 'No notification prefs configured' })

      const channels = prefs['channels'] as { telegram_chat_id?: string; email?: string }
      if (!channels.telegram_chat_id && !channels.email) {
        return reply.status(400).send({ error: 'No channels configured in notification prefs' })
      }

      // Publish test event to notifier via Redis
      const payload = JSON.stringify({ type, test: true, channels })
      await fastify.redis.publish(`aha:notify:test:${req.user!.id}`, payload)

      return { ok: true, message: 'Test notification queued' }
    }
  )

  // POST /api/presence/event — HTTP trigger for presence (complement to MQTT)
  fastify.post(
    '/api/presence/event',
    { preHandler: fastify.authenticate },
    async (req) => {
      const { state, location } = z.object({
        state: z.enum(['home', 'away']),
        location: z.string().optional(),
      }).parse(req.body)

      const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
      if (!user) return { ok: false }

      await fastify.redis.publish(
        `aha:presence:${user['username'] as string}`,
        JSON.stringify({ state, location, ts: new Date().toISOString() })
      )

      return { ok: true, state }
    }
  )
}

void TIMEZONES  // suppress unused warning

  // GET /api/presence/:username — read current presence state
  fastify.get<{ Params: { username: string } }>(
    '/api/presence/:username',
    async (req, reply) => {
      const state = await fastify.redis.get(`aha:presence:last:${req.params.username}`)
      const raw   = await fastify.redis.get(`aha:presence:state:${req.params.username}`)
      if (!state && !raw) return reply.status(404).send({ error: 'No presence data' })
      return { data: { username: req.params.username, state: raw ?? 'unknown', last_seen: state } }
    }
  )

export default notificationsRoutes
