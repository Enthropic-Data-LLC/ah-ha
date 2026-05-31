import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, put } from '../client.js'

export function registerNotificationsTools(server: McpServer) {
  server.tool(
    'aha_notifications_get_prefs',
    'Get the current user\'s notification preferences (daily briefing schedule, presence alerts, delivery channels)',
    {},
    async () => {
      const data = await get('/api/notifications/prefs')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_notifications_update_prefs',
    'Update notification preferences. Controls daily briefings, presence alerts, and Telegram/email delivery.',
    {
      daily_briefing_enabled: z.boolean().optional().describe('Enable/disable daily briefing'),
      daily_briefing_time: z.string().regex(/^\d{2}:\d{2}$/).optional()
        .describe('Time to send briefing, HH:MM format (e.g. "08:00")'),
      daily_briefing_timezone: z.string().optional()
        .describe('IANA timezone for briefing time (e.g. "America/New_York")'),
      presence_enabled: z.boolean().optional().describe('Enable/disable presence change notifications'),
      telegram_chat_id: z.string().optional()
        .describe('Telegram chat ID to send notifications to'),
      email: z.string().email().optional()
        .describe('Email address for notification delivery'),
    },
    async ({ daily_briefing_enabled, daily_briefing_time, daily_briefing_timezone,
             presence_enabled, telegram_chat_id, email }) => {
      // Fetch current prefs first so we do a safe partial update
      const current = await get<{ data: Record<string, unknown> }>('/api/notifications/prefs')
      const prefs = (current as { data: Record<string, unknown> }).data ?? {}

      const daily = (prefs['daily_briefing'] as Record<string, unknown>) ?? {}
      const presence = (prefs['presence'] as Record<string, unknown>) ?? {}
      const channels = (prefs['channels'] as Record<string, unknown>) ?? {}

      if (daily_briefing_enabled !== undefined) daily['enabled'] = daily_briefing_enabled
      if (daily_briefing_time)     daily['time']     = daily_briefing_time
      if (daily_briefing_timezone) daily['timezone'] = daily_briefing_timezone
      if (presence_enabled !== undefined) presence['enabled'] = presence_enabled
      if (telegram_chat_id !== undefined) channels['telegram_chat_id'] = telegram_chat_id
      if (email !== undefined)            channels['email'] = email

      const data = await put('/api/notifications/prefs', {
        daily_briefing: daily,
        presence,
        channels,
      })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
