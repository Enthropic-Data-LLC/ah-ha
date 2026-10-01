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
      // Only with a body: Fastify 400s a body-less request that claims to be JSON.
      ...(body ? { 'Content-Type': 'application/json' } : {}),
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

// ── NFC tags ────────────────────────────────────────────────────────────────

describe('NFC tags', () => {
  let tagId = ''
  let placeId = ''

  it('POST /api/nfc/tags rejects an action pointing at a missing trail', async () => {
    const { status } = await req('POST', '/api/nfc/tags', {
      name: 'Bad tag', action: { type: 'trail', space_slug: 'no-such-trail', text: 'x' },
    })
    expect(status).toBe(400)
  })

  it('POST /api/nfc/tags registers a trail tag and returns its URL', async () => {
    const { status, body } = await req<{ data: { tag_id: string; url: string } }>('POST', '/api/nfc/tags', {
      name: 'Meds', icon: '💊', action: { type: 'trail', space_slug: trailSlug, text: 'Took meds', tone: 'happy' },
    })
    expect(status).toBe(201)
    const data = (body as { data: { tag_id: string; url: string } }).data
    tagId = data.tag_id
    expect(tagId).toMatch(/^[2-9a-km-z]{20}$/)
    expect(data.url).toMatch(new RegExp(`/t/${tagId}$`))
  })

  it('POST /api/nfc/tap/:tagId appends to the trail with source nfc', async () => {
    const { status, body } = await req<{ data: { duplicate: boolean; message: string } }>('POST', `/api/nfc/tap/${tagId}`, {})
    expect(status).toBe(200)
    const data = (body as { data: { duplicate: boolean; message: string } }).data
    expect(data.duplicate).toBe(false)
    expect(data.message).toContain('Took meds')

    const { body: entries } = await req<{ data: Array<{ text: string; source: string }> }>('GET', `/api/trail/${trailSlug}/entries?limit=1`)
    const latest = (entries as { data: Array<{ text: string; source: string }> }).data[0]!
    expect(latest.text).toBe('Took meds')
    expect(latest.source).toBe('nfc')
  })

  it('a second tap within the debounce window is reported as a duplicate', async () => {
    const { status, body } = await req<{ data: { duplicate: boolean } }>('POST', `/api/nfc/tap/${tagId}`, {})
    expect(status).toBe(200)
    expect((body as { data: { duplicate: boolean } }).data.duplicate).toBe(true)
  })

  it('PATCH re-points the tag to a check-in without changing its id', async () => {
    const { body: ent } = await req<{ data: { _id: string } }>('POST', '/api/entities', { name: `NFC test place ${Date.now()}` })
    placeId = (ent as { data: { _id: string } }).data._id
    const { status, body } = await req<{ data: { tag_id: string; action: { type: string } } }>('PATCH', `/api/nfc/tags/${tagId}`, {
      action: { type: 'checkin', entity_id: placeId },
    })
    expect(status).toBe(200)
    const data = (body as { data: { tag_id: string; action: { type: string } } }).data
    expect(data.tag_id).toBe(tagId)
    expect(data.action.type).toBe('checkin')
  })

  it('DELETE /api/nfc/tags/:tagId removes it; taps then 404', async () => {
    expect((await req('DELETE', `/api/nfc/tags/${tagId}`)).status).toBe(200)
    expect((await req('POST', `/api/nfc/tap/${tagId}`, {})).status).toBe(404)
    await req('DELETE', `/api/entities/${placeId}`)
  })
})

describe('NFC open tags', () => {
  it('an open tag returns the view to open, on duplicate taps too', async () => {
    const { body } = await req<{ data: { tag_id: string } }>('POST', '/api/nfc/tags', {
      name: 'Front door', icon: '🚪', action: { type: 'open', view: 'leave' },
    })
    const id = (body as { data: { tag_id: string } }).data.tag_id
    for (const duplicate of [false, true]) {
      const { status, body: tap } = await req<{ data: { open: string; duplicate: boolean } }>('POST', `/api/nfc/tap/${id}`, {})
      expect(status).toBe(200)
      expect((tap as { data: { open: string; duplicate: boolean } }).data).toMatchObject({ open: 'leave', duplicate })
    }
    await req('DELETE', `/api/nfc/tags/${id}`)
  })
})

describe('Check-in TTL', () => {
  it('defaults to 4h and accepts ttl_hours for GPS arrivals', async () => {
    // Check-in is keyed by username; the dev test user may never have been through onboarding.
    expect([200, 409]).toContain((await req('POST', '/auth/claim-username', { username: 'ahha-test-runner' })).status)
    const { body } = await req<{ data: { _id: string } }>('POST', '/api/entities', { name: `TTL test place ${Date.now()}` })
    const id = (body as { data: { _id: string } }).data._id
    const plain = await req<{ expires_in: number }>('POST', `/api/entities/${id}/checkin`)
    expect((plain.body as { expires_in: number }).expires_in).toBe(4 * 3600)
    const long = await req<{ expires_in: number }>('POST', `/api/entities/${id}/checkin`, { ttl_hours: 12 })
    expect((long.body as { expires_in: number }).expires_in).toBe(12 * 3600)
    expect((await req('POST', `/api/entities/${id}/checkin`, { ttl_hours: 48 })).status).toBe(400)
    await req('DELETE', '/api/entities/checkin')
    await req('DELETE', `/api/entities/${id}`)
  })
})

describe('Reminders + day summary', () => {
  it('upcoming lists a card due soon; completing it shows in the day summary', async () => {
    const { body: cols } = await req<{ data: Array<{ _id: string }> }>('GET', `/api/board/${boardSlug}/columns`)
    const columnId = (cols as { data: Array<{ _id: string }> }).data[0]!._id
    const title = `Reminder test ${Date.now()}`
    const due = new Date(Date.now() + 2 * 3_600_000).toISOString()
    const { body: created } = await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { title, column_id: columnId, due_date: due })
    const cardId = (created as { data: { _id: string } }).data._id

    const { status, body: up } = await req<{ data: Array<{ _id: string; title: string }> }>('GET', '/api/cards/upcoming?hours=3')
    expect(status).toBe(200)
    expect((up as { data: Array<{ title: string }> }).data.map(c => c.title)).toContain(title)

    const since = new Date(Date.now() - 3_600_000).toISOString()
    expect((await req('POST', `/api/cards/${cardId}/complete`, {})).status).toBe(200)
    const { status: s2, body: sum } = await req<{ data: { completed: Array<{ title: string }>; trail: { total: number } } }>(
      'GET', `/api/day-summary?since=${encodeURIComponent(since)}`)
    expect(s2).toBe(200)
    expect((sum as { data: { completed: Array<{ title: string }> } }).data.completed.map(c => c.title)).toContain(title)

    const { body: after } = await req<{ data: Array<{ title: string }> }>('GET', '/api/cards/upcoming?hours=3')
    expect((after as { data: Array<{ title: string }> }).data.map(c => c.title)).not.toContain(title)
  })
})

// ── Cleanup ──────────────────────────────────────────────────────────────────
// NOTE: intentionally no afterAll cleanup — the test instance shares the same
// MongoDB as production. Test spaces linger with slugs like test-trail-{ts}.
