#!/usr/bin/env node
/**
 * @ah-ha/mcp-server
 * Exposes Ah-Ha Spaces as MCP tools for Claude Desktop and the Claude API.
 *
 * Config via environment:
 *   AHA_API_KEY   — required, an aha_live_* API key
 *   AHA_BASE_URL  — optional, defaults to https://api.ah-ha.app
 *
 * Claude Desktop claude_desktop_config.json example:
 * {
 *   "mcpServers": {
 *     "ah-ha": {
 *       "command": "npx",
 *       "args": ["-y", "@ah-ha/mcp-server"],
 *       "env": { "AHA_API_KEY": "aha_live_..." }
 *     }
 *   }
 * }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerBoardTools } from './tools/board.js'
import { registerTrailTools } from './tools/trail.js'
import { registerNoteTools } from './tools/note.js'
import { registerListTools } from './tools/list.js'
import { registerLinksTools } from './tools/links.js'
import { registerSearchTools } from './tools/search.js'
import { registerSpacesTools } from './tools/spaces.js'

if (!process.env['AHA_API_KEY']) {
  process.stderr.write('AHA_API_KEY is required\n')
  process.exit(1)
}

const server = new McpServer({
  name: 'ah-ha',
  version: '0.1.0',
})

registerSpacesTools(server)
registerBoardTools(server)
registerTrailTools(server)
registerNoteTools(server)
registerListTools(server)
registerLinksTools(server)
registerSearchTools(server)

const transport = new StdioServerTransport()
await server.connect(transport)
