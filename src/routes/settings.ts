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
          today_limit: (settings?.['today_limit'] as number | null | undefined) ?? null,
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
        // Ah! Today shows at most this many items; null = no limit.
        today_limit: z.number().int().min(1).max(100).nullable().optional(),
      }).parse(req.body)

      const update: Record<string, unknown> = { user_id: req.user!.id, updated_at: new Date() }
      if (body.anthropic_api_key !== undefined) {
        update['anthropic_api_key'] = body.anthropic_api_key ?? null
      }
      if (body.today_limit !== undefined) update['today_limit'] = body.today_limit

      await fastify.mongo.collection('user_settings').updateOne(
        { user_id: req.user!.id },
        { $set: update },
        { upsert: true }
      )
      return { ok: true }
    }
  )

  // POST /api/settings/test-key — verify the saved Anthropic key works
  fastify.post(
    '/api/settings/test-key',
    { preHandler: fastify.authenticate },
    async (req) => {
      const settings = await fastify.mongo.collection('user_settings')
        .findOne({ user_id: req.user!.id })
      const apiKey = (settings?.['anthropic_api_key'] as string | null) ?? process.env['ANTHROPIC_API_KEY']
      if (!apiKey) return { ok: false, error: 'No key configured' }

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        })
        return { ok: res.ok }
      } catch {
        return { ok: false }
      }
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
