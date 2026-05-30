import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, patch, del } from '../client.js'

const SPACE_TYPES = ['board', 'trail', 'note', 'list', 'table'] as const

export function registerSpacesTools(server: McpServer) {
  server.tool(
    'aha_spaces_list',
    'List all spaces accessible to the current user, optionally filtered by type',
    {
      type: z.enum(SPACE_TYPES).optional().describe('Filter by space type'),
    },
    async ({ type }) => {
      const data = await get('/api/spaces', type ? { type } : undefined)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_spaces_create',
    'Create a new space (board, trail, note, list, or table)',
    {
      type: z.enum(SPACE_TYPES).describe('Space type'),
      name: z.string().min(1).max(100).describe('Display name'),
      slug: z.string().min(1).max(60).optional().describe('URL-safe slug (auto-generated from name if omitted)'),
      description: z.string().optional().describe('Short description'),
    },
    async (body) => {
      const data = await post('/api/spaces', body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_spaces_update',
    'Update a space name or description',
    {
      ref: z.string().describe('Space ref, e.g. username/board/my-board'),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
    },
    async ({ ref, ...body }) => {
      const data = await patch(`/api/spaces/${encodeURIComponent(ref)}`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_spaces_delete',
    'Soft-delete a space',
    {
      ref: z.string().describe('Space ref'),
    },
    async ({ ref }) => {
      const data = await del(`/api/spaces/${encodeURIComponent(ref)}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
