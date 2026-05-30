import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, patch, del } from '../client.js'

export function registerListTools(server: McpServer) {
  server.tool(
    'aha_list_items',
    'List items in a List space. Open items appear first, then completed items.',
    {
      slug: z.string().describe('List slug'),
      include_done: z.boolean().optional().describe('Include completed items (default true)'),
    },
    async ({ slug, include_done }) => {
      const query = include_done === false ? { done: 'false' } : undefined
      const data = await get(`/api/list/${slug}/items`, query)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_list_add',
    'Add a new item to a List space',
    {
      slug: z.string().describe('List slug'),
      text: z.string().min(1).max(500).describe('Item text'),
    },
    // Backend expects { title } — map from user-friendly param name `text`
    async ({ slug, text }) => {
      const data = await post(`/api/list/${slug}/items`, { title: text })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_list_check',
    'Mark a list item as done or undone',
    {
      slug: z.string().describe('List slug'),
      id: z.string().describe('Item ID'),
      done: z.boolean().describe('true to check off, false to uncheck'),
    },
    async ({ slug, id, done }) => {
      const data = await patch(`/api/list/${slug}/items/${id}/check`, { done })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_list_update',
    'Update a list item title',
    {
      slug: z.string().describe('List slug'),
      id: z.string().describe('Item ID'),
      text: z.string().min(1).max(500).describe('New item text'),
    },
    // Backend expects { title } — map from `text`
    async ({ slug, id, text }) => {
      const data = await patch(`/api/list/${slug}/items/${id}`, { title: text })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_list_delete',
    'Soft-delete a list item',
    {
      slug: z.string().describe('List slug'),
      id: z.string().describe('Item ID'),
    },
    async ({ slug, id }) => {
      const data = await del(`/api/list/${slug}/items/${id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
