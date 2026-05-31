import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get } from '../client.js'

export function registerCalendarTools(server: McpServer) {
  server.tool(
    'aha_calendar_list_events',
    "Query the user's calendar events within a date range. Use this to check their schedule, see what's on for a day, or know when they're busy.",
    {
      start: z.string().optional().describe("Start of range — ISO 8601, or shorthand: today, tomorrow, +Nd (e.g. +3d). Defaults to now."),
      end: z.string().optional().describe('End of range — ISO 8601 or +Nd shorthand. Defaults to +7d.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max events to return (default 100)'),
    },
    async ({ start, end, limit }) => {
      const q: Record<string, string | number> = {}
      if (start) q['start'] = start
      if (end)   q['end']   = end
      if (limit) q['limit'] = limit
      const data = await get('/api/calendar/events', q)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_calendar_get_upcoming',
    "Get upcoming calendar events starting from right now. Use hours to look as far ahead as needed — e.g. 24 for today, 72 for 3 days, 168 for a week.",
    {
      hours: z.number().int().min(1).max(336).optional().describe('How many hours ahead to look (default 24, max 336 = 2 weeks)'),
    },
    async ({ hours }) => {
      const q = hours ? { hours } : undefined
      const data = await get('/api/calendar/upcoming', q)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
