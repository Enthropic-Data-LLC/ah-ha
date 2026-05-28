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
      ts: z.string().optional().describe('ISO 8601 timestamp override (defaults to now)'),
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
      from: z.string().optional().describe('Start of time range (ISO 8601)'),
      to: z.string().optional().describe('End of time range (ISO 8601)'),
      tone: z.enum(['happy', 'sorrow', 'neutral']).optional().describe('Filter by tone'),
      tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
      q: z.string().optional().describe('Full-text search within entries'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of entries to return (default 20)'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
    async ({ slug, ...query }) => {
      const q: Record<string, string | number | undefined> = {}
      if (query.from) q['from'] = query.from
      if (query.to) q['to'] = query.to
      if (query.tone) q['tone'] = query.tone
      if (query.q) q['q'] = query.q
      if (query.limit) q['limit'] = query.limit
      if (query.cursor) q['cursor'] = query.cursor
      if (query.tags) q['tags'] = query.tags.join(',')
      const data = await get(`/api/trail/${slug}/entries`, q)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_trail_summarize',
    'Get a streak and tone summary for a Trail space. Returns counts by tone and streak data — use this to craft a narrative about recent patterns.',
    {
      slug: z.string().describe('Trail slug'),
    },
    async ({ slug }) => {
      const data = await get(`/api/trail/${slug}/summary`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
