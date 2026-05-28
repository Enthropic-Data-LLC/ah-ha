import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, del } from '../client.js'

const LINK_TYPES = ['caused-by', 'resolved-by', 'documented-in', 'depends-on', 'triggered', 'references', 'related-to'] as const

export function registerLinksTools(server: McpServer) {
  server.tool(
    'aha_links_get',
    'Get all links involving a specific ref (space ref, card ref, etc.)',
    {
      ref: z.string().describe('Fully-qualified ref, e.g. username/board/my-board#card_abc123'),
    },
    async ({ ref }) => {
      const data = await get('/api/links', { ref })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_links_create',
    'Create a typed link between two refs',
    {
      from: z.string().describe('Source ref'),
      to: z.string().describe('Target ref'),
      type: z.enum(LINK_TYPES).describe('Relationship type'),
    },
    async (body) => {
      const data = await post('/api/links', body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_links_traverse',
    'BFS-traverse the link graph from a starting ref up to a given depth. Returns all links and discovered node refs.',
    {
      ref: z.string().describe('Starting ref'),
      depth: z.number().int().min(1).max(3).optional().describe('Traversal depth (default 2, max 3)'),
    },
    async ({ ref, depth }) => {
      const data = await get('/api/links/traverse', { ref, depth })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_links_delete',
    'Delete a link by ID',
    {
      id: z.string().describe('Link document ID'),
    },
    async ({ id }) => {
      const data = await del(`/api/links/${id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
