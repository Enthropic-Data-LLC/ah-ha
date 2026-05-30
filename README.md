# Ah-Ha

Personal knowledge and automation platform. Organize everything through **Spaces** — structured containers for notes, boards, lists, tables, and time-series trails — then connect it all to AI agents via a native MCP server.

**Hosted:** [ah-ha.app](https://ah-ha.app) | **MCP Server:** [`@enthropicdata/ah-ha-mcp-server`](https://www.npmjs.com/package/@enthropicdata/ah-ha-mcp-server)

---

## Space Types

| Type | Description |
|------|-------------|
| **Board** | Kanban-style cards with LexoRank ordering |
| **Note** | Rich text documents |
| **List** | Checklist / task lists |
| **Table** | Structured rows and columns |
| **Trail** | Append-only, hash-chained time-series log — IoT sensor data, journal entries, audit events |

## MCP Integration

Ah-Ha exposes all Spaces as MCP tools, making it a native data layer for Claude and other AI assistants.

**Claude Desktop / Claude Code setup:**

```json
{
  "mcpServers": {
    "ah-ha": {
      "command": "npx",
      "args": ["-y", "@enthropicdata/ah-ha-mcp-server"],
      "env": { "AHA_API_KEY": "aha_live_..." }
    }
  }
}
```

Generate an API key from your Ah-Ha account settings at https://ah-ha.app.

## Stack

- **API:** Fastify + TypeScript
- **Database:** MongoDB (Spaces), TimescaleDB (Trail)
- **Cache:** Redis
- **Auth:** Magic-link email + JWT
- **Webhooks:** HMAC-signed inbound webhooks per Space

## Self-Hosting

```bash
git clone https://github.com/Enthropic-Data-LLC/ah-ha.git
cd ah-ha
cp .env.example .env
# Edit .env: MONGODB_URI, TIMESCALE_URI, REDIS_URL, JWT_SECRET, RESEND_API_KEY
npm install
npm run build
npm start
```

**Requirements:** MongoDB 6+, TimescaleDB (PostgreSQL 15+ with extension), Redis 7+, Node.js 22+

The hosted version at ah-ha.app runs the same code with managed infrastructure.

## Development

```bash
npm install
cp .env.example .env
npm run dev   # API on :3100
```

## Contributing

Pull requests welcome. For significant changes, open an issue first to discuss.

## License

MIT — see LICENSE

Built by Enthropic Data LLC (https://enthropicdata.com)
