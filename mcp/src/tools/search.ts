import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get } from '../client.js'

export function registerSearchTools(server: McpServer) {
  server.tool(
    'aha_search',
    'Full-text search across all spaces (board cards + trail entries). Returns ranked results with type, ref, title, and space.',
    {
      q: z.string().min(1).max(200).describe('Search query'),
      type: z.enum(['board', 'trail']).optional().describe('Restrict to a specific space type'),
      space: z.string().optional().describe('Restrict to a specific space slug or partial ref'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
    },
    async (params) => {
      const query: Record<string, string | number | undefined> = { q: params.q }
      if (params.type) query['type'] = params.type
      if (params.space) query['space'] = params.space
      if (params.limit) query['limit'] = params.limit
      const data = await get('/api/search', query)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
