import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { get, post, del } from '../client.js'

export function registerWebhooksTools(server: McpServer) {
  server.tool(
    'aha_webhooks_list',
    'List all inbound webhook endpoints registered in Ah-Ha',
    {},
    async () => {
      const data = await get('/api/webhooks')
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_webhooks_create',
    'Register a new inbound webhook endpoint. Returns the receive URL for external systems to POST to.',
    {
      name: z.string().min(1).max(100).describe('Human-readable name for this webhook'),
      target_space_ref: z.string().describe('Space ref to send data to, e.g. username/trail/my-trail'),
      events: z.array(z.enum(['trail.append', 'board.card'])).default(['trail.append'])
        .describe('Event types this webhook handles'),
      secret: z.string().min(8).max(256).optional()
        .describe('Optional HMAC secret — external system must send X-Ah-Ha-Signature header'),
    },
    async ({ name, target_space_ref, events, secret }) => {
      const body: Record<string, unknown> = { name, target_space_ref, events }
      if (secret) body.secret = secret
      const data = await post('/api/webhooks', body)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )

  server.tool(
    'aha_webhooks_delete',
    'Delete (soft-revoke) a webhook endpoint by its ID',
    {
      id: z.string().describe('Webhook ID (from aha_webhooks_list or aha_webhooks_create)'),
    },
    async ({ id }) => {
      const data = await del(`/api/webhooks/${id}`)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    },
  )
}
