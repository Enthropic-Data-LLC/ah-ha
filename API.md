# Ah-Ha API guide

Ah-Ha is one API behind two web faces: **ah-ha.app** (the data layer) and **now.ah-ha.app** (Ah! Today). Both hosts reach the same API, so a request works the same on either. Everything under `/api` is JSON.

- [Authentication](#authentication)
- [Conventions](#conventions)
- [Spaces](#spaces)
- [Boards](#boards)
- [Lists](#lists)
- [Notes](#notes)
- [Tables](#tables)
- [Trail](#trail)
- [Places and people (entities)](#places-and-people-entities)
- [Ah! Today](#ah-today)
- [Search, links, sharing](#search-links-sharing)
- [Automation: webhooks, MQTT, trackers, Link](#automation)
- [Connecting an app (scoped keys)](#connecting-an-app)
- [Reference: every route](#reference-every-route)

---

## Authentication

There are two ways in.

| Method | For | How |
|---|---|---|
| **API key** | scripts, the MCP server, devices | `Authorization: Bearer aha_live_…` |
| **Session cookie** | the web app | `aha_session`, set after a magic-link sign-in |

Create a key on the **API Keys** page, or `POST /api/keys`. A key has an `access` of `read` or `write` (default `write`) and an optional expiry (`expires_in_days`). A read key can only make `GET` and `HEAD` requests; anything else returns `403 This key is read-only`.

```bash
curl https://ah-ha.app/auth/me -H "Authorization: Bearer $AHA_API_KEY"
```

**Never available to API keys:** `/api/keys` and `/api/connect/authorize`. A key can't mint another key or approve an app's connection.

### Signing in (browser flow)

1. `GET /auth/pow-challenge` returns a small proof-of-work puzzle.
2. `POST /auth/magic-link` with `{ email, challenge, nonce }` (the solved puzzle). The link is emailed. It always answers 200, so it never reveals whether an address has an account. The link points at the host the request came from (`ah-ha.app` or `now.ah-ha.app`).
3. The page at `/auth/verify?token=…` asks for a click, then `POST /api/auth/verify` with `{ token }` sets the session cookie.
4. New accounts claim a name with `POST /auth/claim-username` (`3–32` chars, `a–z 0–9 -`). Your username is part of every space's address.

`GET /auth/me` tells you who the credential belongs to. `POST /auth/logout` ends a browser session.

## Conventions

- **Envelope.** Successful reads return `{ "data": … }`. Errors return `{ "error": … }` (a message string, or `{ code, message }` on some routes). Treat the HTTP status as the truth: `400` bad input, `401` not signed in, `403` not allowed, `404` not found, `409` the request conflicts with the item's state, `429` slow down.
- **Spaces are addressed two ways:** by `slug` inside a type (`/api/board/:slug/…`), and by `ref` = `username/type/slug` (webhook targets, links, sharing).
- **Dates** are ISO 8601 (`2026-10-18T14:00:00Z`).
- **Ordering** of cards, columns and list items uses `before_id` / `after_id` on a move call, not numeric positions.
- **Rate limits.** 200 requests a minute per account for normal routes. Sign-in, feedback and a few public routes are limited to 10 a minute per IP.
- **Org scoping.** Everything you read or write is scoped to your account. There is no way to name another account's data.

## Spaces

A space is a container. Types: `board`, `note`, `list`, `trail`, `table`.

| | |
|---|---|
| `GET /api/spaces` | your spaces (`?type=list` to filter) |
| `POST /api/spaces` | `{ type, name, slug?, description? }` creates one. The slug is made from the name if you omit it |
| `PATCH /api/spaces/:ref` | `{ name?, description?, pinned?, settings? }` |
| `DELETE /api/spaces/:ref` | removes it |
| `GET /api/:username/:type/:slug` | one space's record |

A new board comes with default columns, including a **Done** column that closes cards.

## Boards

A board holds **columns**, and columns hold **cards**.

```bash
# columns
curl -H "Authorization: Bearer $K" https://ah-ha.app/api/board/tasks/columns
# add a card
curl -X POST https://ah-ha.app/api/board/tasks/cards \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"column_id":"<id>","title":"Change oil","priority":"high","due_date":"2026-10-25T17:00:00Z"}'
```

**Cards**

| | |
|---|---|
| `GET /api/board/:slug/cards` | cards, each with `list_progress` when a list is attached |
| `POST /api/board/:slug/cards` | `column_id`, `title` (≤500), `notes`, `priority` (`none/low/medium/high`), `tags[]`, `color`, `due_date`, `start_date`, `defer_until`, `recurrence` |
| `PATCH /api/board/:slug/cards/:id` | any of the above, plus `contexts`, `list_id`, `list_gate`, `in_today` |
| `PATCH /api/board/:slug/cards/:id/move` | `{ column_id, before_id?, after_id? }` |
| `DELETE /api/board/:slug/cards/:id` | |
| `POST /api/board/:slug/cards/capture` | turn a sentence into a card (AI-assisted parsing of title, dates and recurrence) |

**Columns:** `GET/POST /api/board/:slug/columns`, `PATCH …/columns/:id` (`title`, `color`, `in_today`, `today_priority` 1–5, `closes`), `PATCH …/columns/:id/move`, `DELETE …/columns/:id`.

### Where and who: `contexts`

A card can be tagged with places and people (see [entities](#places-and-people-entities)):

```json
{ "contexts": [{ "entity_id": "<place or person id>", "time_chunks": ["morning", "weekend"] }] }
```

An empty `time_chunks` means any time. Chunks: `wakeup`, `morning`, `midday`, `evening`, `night`, `bedtime`, `weekend`, `monday_evening`.

### A list a card needs: `list_id` and `list_gate`

Attach a list space (supplies, or a checklist of subtasks) with `list_id`. The card shows `list_progress` (`done`, `total`, `complete`). `list_gate` says what an unfinished list blocks:

| `list_gate` | Effect |
|---|---|
| `none` | nothing; the list is a reminder |
| `move` | the card can't change columns or be completed |
| `complete` | the card moves freely but can't be completed or put in a *done* column (default when unset) |

A blocked move or completion returns **409** with a message. A *closed* column always accepts the card.

### Closer columns and archiving

Set `closes` on a column to `"done"` (finished; waits on the list) or `"closed"` (no longer working; skips the list), or `null` for an ordinary column.

A card that lands in a closer column is **archived**: it gets `done` or `closed_as`, a timestamp, and becomes read-only (`PATCH` and `complete` return **409**). Moving it back out of the column restores it.

### Completing, deferring, upcoming

| | |
|---|---|
| `POST /api/cards/:id/complete` | what ✓, the phone swipe and NFC all call. A recurring card advances its recurrence. A plain card moves to the **next column** (and is archived if that column is a closer, or there is none). Returns 409 if the list gate blocks it |
| `POST /api/cards/:id/defer` | `{ defer_until }` hides it until then; a past or missing date clears the deferral |
| `GET /api/cards/:id` | one card |
| `GET /api/cards/upcoming` | cards coming due |

## Lists

```bash
curl -X POST https://ah-ha.app/api/list/groceries/items \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"title":"Oat milk","repeat":"always"}'
```

| | |
|---|---|
| `GET /api/list/:slug/items` | items (open items for the place you are at sort first) |
| `POST /api/list/:slug/items` | `title` (≤500), `due_at`, `contexts[]`, `repeat` (`once` / `always`), `source` + `reason` (which module added it and why) |
| `PATCH /api/list/:slug/items/:id` | `title`, `due_at`, `defer_until`, `contexts`, `repeat` |
| `PATCH /api/list/:slug/items/:id/check` | `{ done: true|false }` |
| `PATCH /api/list/:slug/items/:id/move` | `{ before_id?, after_id? }` |
| `DELETE /api/list/:slug/items/:id` | |
| `PATCH /api/list/:slug/settings` | list defaults, e.g. `default_repeat` |

An `always` item reopens by itself the next day (in your time zone). A `once` item stays done.

## Notes

| | |
|---|---|
| `GET /api/note/:slug` | the note |
| `PUT /api/note/:slug` | `{ body }` (up to 500 000 chars) replaces the text |
| `POST /api/note/:slug/append` | `{ content }` adds to the end |
| `PATCH /api/note/:slug/format` | `{ format: "text" | "workflow" }`. A `workflow` note is an [Ah! Link](#automation) flow; switching back to `text` stops it |

## Tables

Column types: `text`, `number`, `date`, `checkbox`, `select`, `multiselect`.

| | |
|---|---|
| `GET /api/table/:slug` | schema and rows |
| `POST /api/table/:slug/columns` | `{ name, type?, options? }` |
| `PATCH` / `DELETE /api/table/:slug/columns/:id` | |
| `POST /api/table/:slug/rows` | add a row |
| `PATCH` / `DELETE /api/table/:slug/rows/:id` | |
| `GET` / `PUT` / `DELETE /api/table/:slug/rows/:row_id/cells/:col_id` | read, set or clear one cell |

## Trail

An append-only, hash-chained log: sensor readings, journal entries, anything that happened.

```bash
curl -X POST https://ah-ha.app/api/trail/home/append \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"text":"Garage door opened","tone":"neutral","source":"mqtt","tags":["garage"],"meta":{"state":"open"}}'
```

| | |
|---|---|
| `POST /api/trail/:slug/append` | `text` (≤10 000), `tone` (`happy/sorrow/neutral`), `source` (≤100), `tags[]`, `meta{}` |
| `GET /api/trail/:slug/entries` | filters: `tone`, `source`, `tags` (comma list), `since` (`24h`, `7d`, `30d` or ISO), `until`, `search`, `limit` (1–200, default 50), `cursor` (an ISO timestamp, for the next page) |
| `GET /api/trail/:slug/summary` | streaks and arcs |

Entries can't be edited or deleted; each links to the one before it.

## Places and people (entities)

Entities are the places you go and the people you're with. Cards and list items point at them with `contexts`.

| | |
|---|---|
| `GET /api/entities` | all of yours |
| `POST /api/entities` | `{ name, icon?, entity_type: "place"|"person", color? }` |
| `GET /api/here` | where you are right now (from your latest check-in), and the open items for it |
| `DELETE /api/entities/checkin` | clear your check-in |

A place can be recognised by GPS (`gps: {lat, lng}` with a radius), a network address, or Bluetooth devices. Entities also have routes for editing their signatures and locations; the web app's Entities page uses them.

## Ah! Today

The Today layer reads your data and works out what deserves attention. It is served by the same API.

| | |
|---|---|
| `GET /api/now` | the Today view: `context`, your sections (overdue, due today, habits, …), `calendar_events`, `trail_pulse`, `briefing`, `streak`, `situation` and one `focus`. Query: `tz`, `presence`, `fresh=1`. The briefing is AI-generated and cached, so poll gently (the apps poll about once a minute) |
| `GET /api/day-summary` | what got done today (the evening wrap-up) |
| `POST /api/situation/energy` | `{ level }` tells Today how much energy you have |
| `POST /api/situation/day` | `{ day: "off" | "normal" }` |

`/api/now` is for signed-in people. A connected app's key can't call it.

## Search, links, sharing

- `GET /api/search?q=…` searches notes, cards, list items and trail across your spaces. Options: `type`, `space`, `limit` (1–50, default 20).
- **Links** connect any two things: `POST /api/links { from, to, type }`, `GET /api/links`, `GET /api/links/traverse`, `DELETE /api/links/:id`.
- **Sharing:** `POST /api/spaces/:ref/share` makes a public read-only link (`/s/<token>`). `GET /api/share/:token` reads it without signing in; `DELETE /api/share/:token` withdraws it.

## Automation

- **Inbound webhooks.** `POST /api/webhooks { name, target_space_ref, events, secret? }` creates an endpoint. Anything that can POST JSON to `POST /api/webhooks/receive/:id` then writes into the target (`trail.append` or `board.card`). If you set a `secret`, send `X-Ah-Ha-Signature: sha256=<hmac of the body>`. Also `GET /api/webhooks`, `DELETE /api/webhooks/:id`.
- **MQTT.** `GET/POST /api/mqtt/subscriptions` (and `PATCH`, `DELETE`, `POST …/:id/test`) map topics straight into Trail spaces.
- **Trackers.** `GET/POST/PUT/DELETE /api/trackers` are rules over the trail that send a phone push and set a status; `GET /api/statuses` lists them; `GET /api/push/inbox` and `GET /api/push/stream` deliver the pushes.
- **Ah! Link flows.** Flows are notes in `workflow` format. `GET /api/link/blocks` lists the blocks, `POST /api/link/validate` checks one, `GET/POST /api/link/flows`, `PUT /api/link/flows/:id`, and `POST /api/link/flows/:id/run` (a dry run unless you say otherwise). Runs are limited so a flow can't loop.
- **NFC tags.** `GET/POST /api/nfc/tags`, `GET/PATCH/DELETE /api/nfc/tags/:tagId`, `POST /api/nfc/tap/:tagId`. A tag stores `https://ah-ha.app/t/<id>`.
- **Calendar.** `GET/POST /api/calendar/sources` (iCal feeds), `DELETE …/:id`, `GET /api/calendar/events`, `GET /api/calendar/upcoming`.
- **Notifications.** `GET/PUT /api/notifications/prefs`, `POST /api/notifications/test`. Presence events: `POST /api/presence/event`.

## Connecting an app

Third-party apps don't ask you to paste a key. They use a consent flow that ends with a key limited to what you approved (OAuth-style code exchange with PKCE):

1. `GET /api/connect/scopes` lists the permissions an app can ask for.
2. The app sends you to `/connect` in the web app. You approve, and your session calls `POST /api/connect/authorize { client_id, client_name, device?, scopes[], redirect_uri, code_challenge, code_challenge_method: "S256" }`, which returns a short-lived code.
3. The app exchanges it with `POST /api/connect/token { code, code_verifier, client_id, redirect_uri }` and receives a scoped key.

A scoped key can call **only** the routes its scopes name. Anything not listed is refused.

| Scope | Lets the app |
|---|---|
| `spaces:read` | see the names of your spaces |
| `lists:read` | read your lists |
| `lists:check` | check items off |
| `lists:add` | add items |
| `lists:write` | add, change, check, move and delete items |
| `trail:read` | read your trail |
| `trail:write` | add trail entries |
| `places:read` | see your saved places |
| `situation:place` | know which place you're checked in at |

Every scoped key can also call `GET /auth/me`. Keys you make by hand on the Keys page have no scope limit, only their read/write access.

## MCP

The same data is available to AI assistants through the MCP server `@enthropicdata/ah-ha-mcp-server` (tools are named `aha_…`, e.g. `aha_board_list_cards`, `aha_list_add`, `aha_trail_append`). Set `AHA_API_KEY` to a key.

```json
{ "mcpServers": { "ah-ha": { "command": "npx", "args": ["-y", "@enthropicdata/ah-ha-mcp-server"], "env": { "AHA_API_KEY": "aha_live_…" } } } }
```

The MCP card tools don't yet expose `list_id` and `list_gate`.

---

## Reference: every route

Auth: all routes need a session or key except where marked *public*.

**Auth** — `GET /auth/pow-challenge` *public* · `POST /auth/magic-link` *public* · `POST /api/auth/verify` *public* · `POST /auth/claim-username` · `POST /auth/logout` · `GET /auth/me`

**Spaces** — `GET,POST /api/spaces` · `PATCH,DELETE /api/spaces/:ref` · `GET /api/:username/:type/:slug` · `POST /api/spaces/:ref/share` · `GET,DELETE /api/share/:token` *(GET public)*

**Board** — `GET,POST /api/board/:slug/cards` · `POST …/cards/capture` · `PATCH,DELETE …/cards/:id` · `PATCH …/cards/:id/move` · `GET,POST …/columns` · `PATCH,DELETE …/columns/:id` · `PATCH …/columns/:id/move` · `GET /api/cards/:id` · `GET /api/cards/upcoming` · `POST /api/cards/:id/complete` · `POST /api/cards/:id/defer`

**List** — `GET,POST /api/list/:slug/items` · `PATCH,DELETE …/items/:id` · `PATCH …/items/:id/check` · `PATCH …/items/:id/move` · `PATCH /api/list/:slug/settings`

**Note** — `GET,PUT /api/note/:slug` · `POST …/append` · `PATCH …/format`

**Table** — `GET /api/table/:slug` · `POST …/columns` · `PATCH,DELETE …/columns/:id` · `POST …/rows` · `PATCH,DELETE …/rows/:id` · `GET,PUT,DELETE …/rows/:row_id/cells/:col_id`

**Trail** — `POST /api/trail/:slug/append` · `GET …/entries` · `GET …/summary`

**Places** — `GET,POST /api/entities` · `GET /api/here` · `DELETE /api/entities/checkin` · `GET /api/my-ip`

**Today** — `GET /api/now` · `GET /api/day-summary` · `POST /api/situation/energy` · `POST /api/situation/day`

**Search & links** — `GET /api/search` · `GET,POST /api/links` · `GET /api/links/traverse` · `DELETE /api/links/:id`

**Automation** — `GET,POST /api/webhooks` · `DELETE /api/webhooks/:id` · `POST /api/webhooks/receive/:id` *(signed)* · `GET,POST /api/mqtt/subscriptions` · `PATCH,DELETE …/:id` · `POST …/:id/test` · `GET,POST /api/trackers` · `PUT,DELETE /api/trackers/:id` · `POST /api/trackers/test` · `GET /api/statuses` · `DELETE /api/statuses/:label` · `GET /api/push/inbox` · `GET /api/push/stream` · `GET /api/link/blocks` · `GET,POST /api/link/flows` · `PUT /api/link/flows/:id` · `POST /api/link/validate` · `POST /api/link/flows/:id/run`

**Devices & calendar** — `GET,POST /api/nfc/tags` · `GET,PATCH,DELETE /api/nfc/tags/:tagId` · `POST /api/nfc/tap/:tagId` · `GET,POST /api/calendar/sources` · `DELETE …/:id` · `GET /api/calendar/events` · `GET /api/calendar/upcoming`

**Account** — `GET,POST /api/keys` · `DELETE /api/keys/:id` *(session only)* · `GET,PUT /api/settings` (your own Anthropic key for AI features, shown masked) · `POST /api/settings/test-key` · `GET,PUT /api/notifications/prefs` · `POST /api/notifications/test` · `GET /api/audit` · `POST /api/feedback` *(public)*

**Connect** — `GET /api/connect/scopes` · `POST /api/connect/authorize` *(session only)* · `POST /api/connect/token`

**Service** — `GET /healthz` *(public)* · `GET /manifest.webmanifest` *(public)*
