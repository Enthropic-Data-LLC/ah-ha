import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post } from '../client.js'

export function registerNoteTools(server: McpServer) {
  server.tool(
    'aha_note_read',
    'Read the full markdown content of a Note space',
    { slug: z.string().describe('Note slug') },
    async ({ slug }) => {
      const data = await get(`/api/note/${slug}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_note_append',
    'Append text to the end of a Note (adds double newline separator)',
    {
      slug: z.string().describe('Note slug'),
      text: z.string().min(1).describe('Markdown text to append'),
    },
    async ({ slug, text }) => {
      const data = await post(`/api/note/${slug}/append`, { text })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_note_replace',
    'Replace the entire content of a Note',
    {
      slug: z.string().describe('Note slug'),
      body: z.string().describe('New full markdown content'),
    },
    async ({ slug, body }) => {
      const data = await post(`/api/note/${slug}`, { body })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
