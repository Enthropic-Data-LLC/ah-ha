import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post } from '../client.js'

export function registerTrailTools(server: McpServer) {
  server.tool(
    'aha_trail_append',
    'Append a new entry to a Trail space — great for logging events, observations, moods, or anything time-stamped',
    {
      slug: z.string().describe('Trail slug'),
      text: z.string().min(1).max(5000).describe('Entry text'),
      tone: z.enum(['happy', 'sorrow', 'neutral']).optional().describe('Emotional tone of the entry'),
      tags: z.array(z.string()).optional().describe('Tags to categorize this entry'),
    },
    async ({ slug, ...body }) => {
      const data = await post(`/api/trail/${slug}/append`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_trail_query',
    'Query Trail entries with optional filters. Returns paginated results ordered by time descending.',
    {
      slug: z.string().describe('Trail slug'),
      since: z.string().optional().describe('Start of time range — ISO 8601 or shorthand: 24h, 7d, 30d'),
      until: z.string().optional().describe('End of time range — ISO 8601'),
      tone: z.enum(['happy', 'sorrow', 'neutral']).optional().describe('Filter by tone'),
      tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
      search: z.string().optional().describe('Full-text search within entries'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of entries to return (default 20)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
    async ({ slug, tags, ...query }) => {
      const q: Record<string, string | number | undefined> = { ...query }
      if (tags?.length) q['tags'] = tags.join(',')
      const data = await get(`/api/trail/${slug}/entries`, q)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_trail_summarize',
    'Get a streak and tone summary for a Trail space. Returns counts by tone and streak data — use this to craft a narrative about recent patterns.',
    {
      slug: z.string().describe('Trail slug'),
      since: z.string().optional().describe('Time window — ISO 8601 or shorthand: 24h, 7d, 30d (default 24h)'),
    },
    async ({ slug, since }) => {
      const q = since ? { since } : undefined
      const data = await get(`/api/trail/${slug}/summary`, q)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
