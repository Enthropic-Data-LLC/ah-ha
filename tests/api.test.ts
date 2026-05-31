/**
 * Ah-Ha API integration tests
 * Requires a running API on API_URL (default http://localhost:3100, NODE_ENV=development)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const API = process.env['API_URL'] ?? 'http://localhost:3100'
const EMAIL = 'test@ah-ha.local'

let cookie = ''
let username = ''
let trailSlug = ''
let boardSlug = ''
let noteSlug = ''
let listSlug = ''
let tableSlug = ''

async function req<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]!
  const data = await res.json().catch(() => ({}))
  return { status: res.status, body: data as T }
}

// ── Auth ────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('GET /auth/dev-link returns token', async () => {
    const { status, body } = await req<{ token: string; url: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
    expect(status).toBe(200)
    expect((body as { token: string }).token).toBeTruthy()
  })

  it('POST /api/auth/verify sets session cookie', async () => {
    const { body: linkBody } = await req<{ token: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
    const { status } = await req('POST', '/api/auth/verify', { token: (linkBody as { token: string }).token })
    expect(status).toBe(200)
    expect(cookie).toMatch(/aha_session/)
  })

  it('GET /auth/me returns user', async () => {
    const { status, body } = await req<{ data: { username: string } }>('GET', '/auth/me')
    expect(status).toBe(200)
    username = (body as { data: { username: string } }).data?.username
    expect(username).toBeTruthy()
  })
})

// ── Spaces ──────────────────────────────────────────────────────────────────

describe('Spaces', () => {
  beforeAll(async () => {
    // Ensure logged in
    if (!cookie) {
      const { body } = await req<{ token: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
      await req('POST', '/api/auth/verify', { token: (body as { token: string }).token })
      const { body: me } = await req<{ data: { username: string } }>('GET', '/auth/me')
      username = (me as { data: { username: string } }).data?.username
    }
  })

  it('GET /api/spaces returns 200', async () => {
    const { status } = await req('GET', '/api/spaces')
    expect(status).toBe(200)
  })

  it('POST /api/spaces creates a trail space', async () => {
    trailSlug = `test-trail-${Date.now()}`
    const { status, body } = await req<{ data: { ref: string } }>('POST', '/api/spaces', {
      type: 'trail', name: 'Test Trail', slug: trailSlug,
    })
    expect(status).toBe(201)
    expect((body as { data: { ref: string } }).data?.ref).toBe(`${username}/trail/${trailSlug}`)
  })

  it('POST /api/spaces creates a board', async () => {
    boardSlug = `test-board-${Date.now()}`
    const { status } = await req('POST', '/api/spaces', { type: 'board', name: 'Test Board', slug: boardSlug })
    expect(status).toBe(201)
  })

  it('POST /api/spaces creates a note', async () => {
    noteSlug = `test-note-${Date.now()}`
    const { status } = await req('POST', '/api/spaces', { type: 'note', name: 'Test Note', slug: noteSlug })
    expect(status).toBe(201)
  })

  it('POST /api/spaces creates a list', async () => {
    listSlug = `test-list-${Date.now()}`
    const { status } = await req('POST', '/api/spaces', { type: 'list', name: 'Test List', slug: listSlug })
    expect(status).toBe(201)
  })

  it('POST /api/spaces creates a table', async () => {
    tableSlug = `test-table-${Date.now()}`
    const { status } = await req('POST', '/api/spaces', { type: 'table', name: 'Test Table', slug: tableSlug })
    expect(status).toBe(201)
  })
})

// ── Trail ───────────────────────────────────────────────────────────────────

describe('Trail', () => {
  let entryId: string

  it('POST /api/trail/:slug/entries appends an entry', async () => {
    const { status, body } = await req<{ data: { id: string } }>('POST', `/api/trail/${trailSlug}/entries`, {
      text: 'Integration test entry', tone: 'neutral',
    })
    expect(status).toBe(201)
    entryId = (body as { data: { id: string } }).data?.id
    expect(entryId).toBeTruthy()
  })

  it('GET /api/trail/:slug/entries returns entries', async () => {
    const { status, body } = await req<{ data: unknown[] }>('GET', `/api/trail/${trailSlug}/entries`)
    expect(status).toBe(200)
    expect(Array.isArray((body as { data: unknown[] }).data)).toBe(true)
  })

  it('trail entries form a hash chain', async () => {
    await req('POST', `/api/trail/${trailSlug}/entries`, { text: 'Entry 2', tone: 'happy' })
    const { body } = await req<{ data: Array<{ prev_hash: string }> }>('GET', `/api/trail/${trailSlug}/entries?limit=2`)
    const entries = (body as { data: Array<{ prev_hash: string }> }).data ?? []
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]!.prev_hash).toBeTruthy()
  })
})

// ── Board ───────────────────────────────────────────────────────────────────

describe('Board', () => {
  let cardId: string
  let columnId: string

  it('GET /api/board/:slug/columns returns columns', async () => {
    const { status, body } = await req<{ data: Array<{ _id: string }> }>('GET', `/api/board/${boardSlug}/columns`)
    expect(status).toBe(200)
    columnId = (body as { data: Array<{ _id: string }> }).data?.[0]?._id ?? ''
    expect(columnId).toBeTruthy()
  })

  it('POST /api/board/:slug/cards creates a card', async () => {
    const { status, body } = await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, {
      title: 'Test card', column_id: columnId,
    })
    expect(status).toBe(201)
    cardId = (body as { data: { _id: string } }).data?._id ?? ''
    expect(cardId).toBeTruthy()
  })

  it('PATCH /api/board/:slug/cards/:id updates a card', async () => {
    const { status } = await req('PATCH', `/api/board/${boardSlug}/cards/${cardId}`, { title: 'Updated card' })
    expect(status).toBe(200)
  })

  it('DELETE /api/board/:slug/cards/:id removes a card', async () => {
    const { status } = await req('DELETE', `/api/board/${boardSlug}/cards/${cardId}`)
    expect(status).toBe(200)
  })
})

// ── Note ────────────────────────────────────────────────────────────────────

describe('Note', () => {
  it('GET /api/note/:slug returns note', async () => {
    const { status } = await req('GET', `/api/note/${noteSlug}`)
    expect(status).toBe(200)
  })

  it('PUT /api/note/:slug/content updates note', async () => {
    const { status } = await req('PUT', `/api/note/${noteSlug}/content`, { body: '# Hello\nIntegration test.' })
    expect(status).toBe(200)
  })
})

// ── List ────────────────────────────────────────────────────────────────────

describe('List', () => {
  let itemId: string

  it('POST /api/list/:slug/items adds an item', async () => {
    const { status, body } = await req<{ data: { _id: string } }>('POST', `/api/list/${listSlug}/items`, { title: 'Test item' })
    expect(status).toBe(201)
    itemId = (body as { data: { _id: string } }).data?._id ?? ''
    expect(itemId).toBeTruthy()
  })

  it('GET /api/list/:slug/items returns items', async () => {
    const { status, body } = await req<{ data: unknown[] }>('GET', `/api/list/${listSlug}/items`)
    expect(status).toBe(200)
    expect((body as { data: unknown[] }).data?.length).toBeGreaterThan(0)
  })

  it('PATCH /api/list/:slug/items/:id/check marks item done', async () => {
    const { status } = await req('PATCH', `/api/list/${listSlug}/items/${itemId}/check`, { done: true })
    expect(status).toBe(200)
  })
})

// ── Table ───────────────────────────────────────────────────────────────────

describe('Table', () => {
  const spaceRef = () => `${username}/table/${tableSlug}`

  it('GET /api/spaces/:ref/table returns empty table', async () => {
    const { status } = await req('GET', `/api/spaces/${encodeURIComponent(spaceRef())}/table`)
    expect(status).toBe(200)
  })

  it('POST /api/spaces/:ref/table adds a row', async () => {
    const { status } = await req('POST', `/api/spaces/${encodeURIComponent(spaceRef())}/table`, { cells: { name: 'Test' } })
    expect(status).toBe(201)
  })
})

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  for (const [type, slug] of [['trail', trailSlug], ['board', boardSlug], ['note', noteSlug], ['list', listSlug], ['table', tableSlug]]) {
    if (slug && username) {
      await req('DELETE', `/api/spaces/${encodeURIComponent(`${username}/${type}/${slug}`)}`)
    }
  }
})
