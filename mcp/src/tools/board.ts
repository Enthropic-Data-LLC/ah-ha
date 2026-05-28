import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, patch, del } from '../client.js'

export function registerBoardTools(server: McpServer) {
  server.tool(
    'aha_board_list_columns',
    'List columns in a board space',
    { slug: z.string().describe('Board slug') },
    async ({ slug }) => {
      const data = await get(`/api/board/${slug}/columns`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_board_list_cards',
    'List cards in a board space, optionally filtered by column',
    {
      slug: z.string().describe('Board slug'),
      column_id: z.string().optional().describe('Filter by column ID'),
    },
    async ({ slug, column_id }) => {
      const data = await get(`/api/board/${slug}/cards`, column_id ? { column_id } : undefined)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_board_create_card',
    'Create a new card in a board column',
    {
      slug: z.string().describe('Board slug'),
      column_id: z.string().describe('Target column ID'),
      title: z.string().min(1).max(500).describe('Card title'),
      notes: z.string().optional().describe('Card body / notes (markdown)'),
      priority: z.enum(['none', 'low', 'medium', 'high']).optional().describe('Card priority'),
      tags: z.array(z.string()).optional().describe('Tags to attach'),
      color: z.string().optional().describe('Hex color for card accent'),
    },
    async ({ slug, ...body }) => {
      const data = await post(`/api/board/${slug}/cards`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_board_update_card',
    'Update card title, notes, priority, tags, or color',
    {
      slug: z.string().describe('Board slug'),
      id: z.string().describe('Card ID'),
      title: z.string().min(1).max(500).optional(),
      notes: z.string().optional(),
      priority: z.enum(['none', 'low', 'medium', 'high']).optional(),
      tags: z.array(z.string()).optional(),
      color: z.string().optional(),
    },
    async ({ slug, id, ...body }) => {
      const data = await patch(`/api/board/${slug}/cards/${id}`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_board_move_card',
    'Move a card to a different column or reorder within a column',
    {
      slug: z.string().describe('Board slug'),
      id: z.string().describe('Card ID'),
      column_id: z.string().describe('Destination column ID'),
      before_id: z.string().nullable().optional().describe('Card ID to place this card before (null = end)'),
      after_id: z.string().nullable().optional().describe('Card ID to place this card after (null = start)'),
    },
    async ({ slug, id, ...body }) => {
      const data = await patch(`/api/board/${slug}/cards/${id}/move`, body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_board_delete_card',
    'Soft-delete a board card',
    {
      slug: z.string().describe('Board slug'),
      id: z.string().describe('Card ID'),
    },
    async ({ slug, id }) => {
      const data = await del(`/api/board/${slug}/cards/${id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
