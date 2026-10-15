import type { FastifyInstance } from 'fastify'
import type { Caller } from './index.js'

export function settingsCore(fastify: FastifyInstance) {
  return {
    /** The user's own Anthropic key if they set one, else the server's. */
    anthropicKey: async (c: Caller): Promise<string | undefined> => {
      const s = await fastify.mongo.collection('user_settings').findOne({ user_id: c.userId })
      return (s?.['anthropic_api_key'] as string | null) ?? process.env['ANTHROPIC_API_KEY']
    },

    /** How many items Ah! Today shows at most; null = no limit. */
    todayLimit: async (c: Caller): Promise<number | null> => {
      const s = await fastify.mongo.collection('user_settings').findOne({ user_id: c.userId })
      const n = s?.['today_limit']
      return typeof n === 'number' && n > 0 ? n : null
    },
  }
}
