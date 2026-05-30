# ah-ha-mcp-server

MCP server for [Ah-Ha](https://ah-ha.app) — exposes your Spaces as AI tools for Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

Every space you create in Ah-Ha (Board, Trail, Note, List) is immediately queryable and writable by your AI assistant.

## Install

```bash
npx @enthropicdata/ah-ha-mcp-server
```

## Claude Desktop setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ah-ha": {
      "command": "npx",
      "args": ["-y", "@enthropicdata/ah-ha-mcp-server"],
      "env": {
        "AHA_API_KEY": "aha_live_..."
      }
    }
  }
}
```

Get your API key from **Ah-Ha → Settings → API Keys**.

Self-hosted / local:

```json
{
  "env": {
    "AHA_API_KEY": "aha_live_...",
    "AHA_BASE_URL": "http://localhost:3100"
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `aha_spaces_list` | List all your spaces |
| `aha_spaces_create` | Create a new space |
| `aha_board_list_cards` | List cards in a board |
| `aha_board_create_card` | Create a card |
| `aha_board_move_card` | Move a card between columns |
| `aha_board_update_card` | Update card title, notes, priority |
| `aha_trail_append` | Log an entry to a Trail |
| `aha_trail_query` | Query trail entries by tone, tags, time |
| `aha_trail_summarize` | Get tone counts and streak data |
| `aha_note_read` | Read a Note's markdown content |
| `aha_note_append` | Append to a Note |
| `aha_note_replace` | Replace a Note's content |
| `aha_list_items` | List items (open + done) |
| `aha_list_add` | Add an item |
| `aha_list_check` | Check or uncheck an item |
| `aha_links_get` | Get links for a ref |
| `aha_links_create` | Link two records |
| `aha_links_traverse` | Traverse the link graph |
| `aha_search` | Full-text search across all spaces |

## Example conversation

```
You: What went wrong with the deploy yesterday?

Claude → aha_trail_query("deploy-log", {tone: "sorrow", since: "24h"})
       ← 2 sorrow entries: build timeout at 14:32, rollback at 15:10

Claude: Your deploy failed at 14:32 with a build timeout. A rollback
        completed at 15:10. Want me to create a card to investigate?

You: Yes, high priority

Claude → aha_board_create_card("sprint-1", {title: "Investigate build timeout", priority: "high"})
       → aha_links_create({from: "card_ref", to: "trail_entry_ref", type: "caused-by"})
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AHA_API_KEY` | Yes | — | API key from Ah-Ha settings |
| `AHA_BASE_URL` | No | `https://api.ah-ha.app` | Override for self-hosted instances |

## License

MIT
