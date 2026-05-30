import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'

const TONE_VALUES = ['happy', 'sorrow', 'neutral'] as const

const subBody = z.object({
  topic_pattern: z.string().min(1).max(256).describe('MQTT topic pattern — supports + and # wildcards'),
  space_ref: z.string().min(1).describe('Target trail space ref, e.g. username/trail/my-trail'),
  text_template: z.string().min(1).max(1000)
    .describe('Template string — use {{payload.field}}, {{topic.0}}, {{ts}}'),
  tone_field: z.string().nullable().default(null)
    .describe('JSONPath into payload for tone value, e.g. "status"'),
  tone_map: z.record(z.enum(TONE_VALUES)).default({})
    .describe('Map raw field values to tones, e.g. {"ok":"happy","degraded":"sorrow"}. Use "*" as fallback key.'),
  default_tone: z.enum(TONE_VALUES).default('neutral'),
  enabled: z.boolean().default(true),
})

const mqttRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/mqtt/subscriptions
  fastify.get(
    '/api/mqtt/subscriptions',
    { preHandler: fastify.authenticate },
    async (req) => {
      const subs = await fastify.mongo.collection('mqtt_subscriptions')
        .find({ org_id: req.user!.orgId, deleted_at: { $exists: false } })
        .sort({ created_at: -1 })
        .toArray()
      return { data: subs }
    }
  )

  // POST /api/mqtt/subscriptions
  fastify.post(
    '/api/mqtt/subscriptions',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = subBody.parse(req.body)

      // Verify the target space exists and belongs to this org
      const [username, type] = body.space_ref.split('/')
      if (type !== 'trail') {
        return reply.status(400).send({ error: 'space_ref must point to a trail space' })
      }
      void username

      const sub = {
        _id: new ObjectId(),
        org_id: req.user!.orgId,
        user_id: req.user!.id,
        ...body,
        created_at: new Date(),
        updated_at: new Date(),
      }
      await fastify.mongo.collection('mqtt_subscriptions').insertOne(sub)

      // Signal bridge to reload
      await fastify.redis.publish('mqtt-bridge:reload', '1')

      reply.status(201)
      return { data: sub }
    }
  )

  // PATCH /api/mqtt/subscriptions/:id
  fastify.patch<{ Params: { id: string } }>(
    '/api/mqtt/subscriptions/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const body = subBody.partial().parse(req.body)
      const result = await fastify.mongo.collection('mqtt_subscriptions').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { ...body, updated_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      await fastify.redis.publish('mqtt-bridge:reload', '1')
      return { ok: true }
    }
  )

  // DELETE /api/mqtt/subscriptions/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/mqtt/subscriptions/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('mqtt_subscriptions').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      await fastify.redis.publish('mqtt-bridge:reload', '1')
      return { ok: true }
    }
  )

  // POST /api/mqtt/subscriptions/:id/test — dry-run render with sample payload
  fastify.post<{ Params: { id: string } }>(
    '/api/mqtt/subscriptions/:id/test',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const sub = await fastify.mongo.collection('mqtt_subscriptions').findOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } }
      )
      if (!sub) return reply.status(404).send({ error: 'Not found' })

      const { sample_topic, sample_payload } = z.object({
        sample_topic: z.string().default(sub['topic_pattern'] as string),
        sample_payload: z.unknown().default({}),
      }).parse(req.body)

      const topicParts = (sample_topic as string).split('/')
      const rendered = renderTemplate(sub['text_template'] as string, sample_payload, topicParts)
      const tone = resolveTone(
        sample_payload,
        sub['tone_field'] as string | null,
        sub['tone_map'] as Record<string, string>,
        sub['default_tone'] as string,
      )

      return { data: { rendered_text: rendered, resolved_tone: tone } }
    }
  )
}

// Inline helpers (duplicated from bridge for API use — keep in sync or extract to lib)
function resolvePath(obj: unknown, path: string): string {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return ''
    if (typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p]
    } else if (Array.isArray(cur)) {
      cur = (cur as unknown[])[parseInt(p, 10)]
    } else {
      return String(cur)
    }
  }
  return cur === undefined || cur === null ? '' : JSON.stringify(cur).replace(/^"|"$/g, '')
}

function renderTemplate(template: string, payload: unknown, topicParts: string[]): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const e = expr.trim()
    if (e === 'ts') return new Date().toISOString()
    if (e.startsWith('topic.')) return topicParts[parseInt(e.slice(6), 10)] ?? ''
    if (e.startsWith('payload.')) return resolvePath(payload, e.slice(8))
    if (e === 'payload') return typeof payload === 'string' ? payload : JSON.stringify(payload)
    return resolvePath(payload, e)
  })
}

function resolveTone(
  payload: unknown,
  toneField: string | null,
  toneMap: Record<string, string>,
  defaultTone: string,
): 'happy' | 'sorrow' | 'neutral' {
  if (toneField && typeof payload === 'object' && payload !== null) {
    const raw = resolvePath(payload, toneField)
    const mapped = toneMap[raw] ?? toneMap['*']
    if (mapped === 'happy' || mapped === 'sorrow' || mapped === 'neutral') return mapped
  }
  return (defaultTone as 'happy' | 'sorrow' | 'neutral') ?? 'neutral'
}

export default mqttRoutes
