import type { FastifyInstance } from 'fastify'
import type { Caller } from './index.js'
import { openSecret } from '../lib/secret-box.js'
import { recordAi, blockedBy } from '../lib/usage.js'

/** The stops on the date-range slider, in days from today (1 = today only), plus 'all'. */
export const DUE_WINDOWS = [1, 2, 3, 5, 8] as const
export type DueWindow = typeof DUE_WINDOWS[number] | 'all'

export function settingsCore(fastify: FastifyInstance) {
  return {
    /**
     * The key an AI call should use: the user's own if they set one, else the server's —
     * unless their plan's server-key AI is used up and limits are enforced (lib/plans).
     * Call `used()` once per request sent; it's what the plan's AI count is made of.
     */
    aiKey: async (c: Caller): Promise<{ key: string; own: boolean; used: () => void } | null> => {
      const s = await fastify.mongo.collection('user_settings').findOne({ user_id: c.userId })
      const own = openSecret(s?.['anthropic_api_key'] as string | null)
      if (own) return { key: own, own: true, used: () => recordAi(fastify, c.orgId, true) }
      const server = process.env['ANTHROPIC_API_KEY']
      if (!server || await blockedBy(fastify, c.orgId, 'server_ai')) return null
      return { key: server, own: false, used: () => recordAi(fastify, c.orgId, false) }
    },

    /** How many items Ah! Today shows at most; null = no limit. */
    todayLimit: async (c: Caller): Promise<number | null> => {
      const s = await fastify.mongo.collection('user_settings').findOne({ user_id: c.userId })
      const n = s?.['today_limit']
      return typeof n === 'number' && n > 0 ? n : null
    },

    /** How far ahead the person looks (the board slider, synced): days, 'all', or null if never set. */
    dueWindow: async (c: Caller): Promise<DueWindow | null> => {
      const s = await fastify.mongo.collection('user_settings').findOne({ user_id: c.userId })
      const w = s?.['due_window']
      return w === 'all' || DUE_WINDOWS.includes(w as never) ? w as DueWindow : null
    },
  }
}
