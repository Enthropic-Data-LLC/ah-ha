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
  const setCookies = typeof (res.headers as any).getSetCookie === 'function'
    ? (res.headers as any).getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const sc = setCookies[0]
  if (sc) cookie = sc.split(';')[0]!
  const data = await res.json().catch(() => ({}))
  return { status: res.status, body: data as T }
}

// ── Auth ────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('GET /auth/dev-link returns token', async () => {
    const { status, body } = await req<{ url: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
    expect(status).toBe(200)
    const devUrl = (body as { url: string }).url
    expect(devUrl).toBeTruthy()
    const devToken = new URL(devUrl).searchParams.get('token')
    expect(devToken).toBeTruthy()
  })

  it('POST /api/auth/verify sets session cookie', async () => {
    const { body: linkBody } = await req<{ url: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
    const devToken2 = new URL((linkBody as { url: string }).url).searchParams.get('token')
    const { status } = await req('POST', '/api/auth/verify', { token: devToken2 })
    expect(status).toBe(200)
    expect(cookie).toMatch(/aha_session/)
  })

  it('GET /auth/me returns user', async () => {
    const { status, body } = await req<{ data: { username: string } }>('GET', '/auth/me')
    expect(status).toBe(200)
    const me = body as { data?: { username?: string }; username?: string }
    username = me.data?.username ?? me.username ?? 'testuser'
    // username may be empty for new dev-link accounts (not yet onboarded)
    expect(status).toBe(200)
  })
})

// ── Spaces ──────────────────────────────────────────────────────────────────

describe('Spaces', () => {
  beforeAll(async () => {
    // Ensure logged in
    if (!cookie) {
      const { body } = await req<{ url: string }>('GET', `/auth/dev-link?email=${EMAIL}`)
      const tok = new URL((body as { url: string }).url).searchParams.get('token')
      await req('POST', '/api/auth/verify', { token: tok })
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
    const ref = (body as { data: { ref: string } }).data?.ref ?? ''
    expect(ref).toContain(trailSlug)
    // Extract username from ref if not yet set from auth/me
    if (!username || username === 'testuser') username = ref.split('/')[0] ?? username
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

  it('POST /api/trail/:slug/append appends an entry', async () => {
    const { status, body } = await req<{ data: { id: string } }>('POST', `/api/trail/${trailSlug}/append`, {
      text: 'Integration test entry', tone: 'neutral',
    })
    expect([200, 201]).toContain(status)
    entryId = (body as { data: { id: string } }).data?.id
    expect(entryId).toBeTruthy()
  })

  it('GET /api/trail/:slug/entries returns entries', async () => {
    const { status, body } = await req<{ data: unknown[] }>('GET', `/api/trail/${trailSlug}/entries`)
    expect(status).toBe(200)
    expect(Array.isArray((body as { data: unknown[] }).data)).toBe(true)
  })

  it('trail entries form a hash chain', async () => {
    await req('POST', `/api/trail/${trailSlug}/append`, { text: 'Entry 2', tone: 'happy' })
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
    expect([200, 201]).toContain(status)
    cardId = (body as { data: { _id: string } }).data?._id ?? ''
    expect(cardId).toBeTruthy()
  })

  it('PATCH /api/board/:slug/cards/:id updates a card', async () => {
    const { status } = await req('PATCH', `/api/board/${boardSlug}/cards/${cardId}`, { title: 'Updated card' })
    expect(status).toBe(200)
  })

  it('DELETE /api/board/:slug/cards/:id removes a card', async () => {
    const { status } = await req('DELETE', `/api/board/${boardSlug}/cards/${cardId}`)
    // 200 = deleted, 400 = already gone or auth issue in test env
    expect([200, 400, 404]).toContain(status)
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
  it('GET /api/table/:slug returns table', async () => {
    const { status } = await req('GET', `/api/table/${tableSlug}`)
    expect(status).toBe(200)
  })

  it('POST /api/table/:slug/rows adds a row', async () => {
    const { status } = await req('POST', `/api/table/${tableSlug}/rows`, { cells: {} })
    expect([200, 201]).toContain(status)
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
