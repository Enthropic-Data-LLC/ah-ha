import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/settings
  fastify.get(
    '/api/settings',
    { preHandler: fastify.authenticate },
    async (req) => {
      const settings = await fastify.mongo.collection('user_settings')
        .findOne({ user_id: req.user!.id })
      return {
        data: {
          anthropic_api_key: settings?.['anthropic_api_key'] ? '••••' + (settings['anthropic_api_key'] as string).slice(-4) : null,
          has_anthropic_key: !!(settings?.['anthropic_api_key']),
        }
      }
    }
  )

  // PUT /api/settings
  fastify.put(
    '/api/settings',
    { preHandler: fastify.authenticate },
    async (req) => {
      const body = z.object({
        anthropic_api_key: z.string().min(1).optional().nullable(),
      }).parse(req.body)

      const update: Record<string, unknown> = { user_id: req.user!.id, updated_at: new Date() }
      if (body.anthropic_api_key !== undefined) {
        update['anthropic_api_key'] = body.anthropic_api_key ?? null
      }

      await fastify.mongo.collection('user_settings').updateOne(
        { user_id: req.user!.id },
        { $set: update },
        { upsert: true }
      )
      return { ok: true }
    }
  )

  // GET /api/settings/ai-key — internal: return actual key for AI calls
  // Used by capture endpoint — never exposed to client
  fastify.get(
    '/api/settings/ai-key',
    { preHandler: fastify.authenticate },
    async (req) => {
      const settings = await fastify.mongo.collection('user_settings')
        .findOne({ user_id: req.user!.id })
      const userKey = settings?.['anthropic_api_key'] as string | null
      const serverKey = process.env['ANTHROPIC_API_KEY'] ?? null
      return { key: userKey ?? serverKey }
    }
  )
}

export default settingsRoutes
