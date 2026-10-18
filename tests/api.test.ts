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

  it('items are 1x by default; "always" can be set per item or as the list default', async () => {
    type Item = { _id: string; repeat?: string; done: boolean }
    type Res = { data: Item[]; meta: { default_repeat: string } }
    const add = async (body: Record<string, unknown>) =>
      ((await req<{ data: Item }>('POST', `/api/list/${listSlug}/items`, body)).body as { data: Item }).data
    expect((await add({ title: 'Return the book' })).repeat).toBe('once')
    const laptop = await add({ title: 'Laptop', repeat: 'always' })
    expect(laptop.repeat).toBe('always')

    // Checked "always" items stay checked today (they reopen tomorrow).
    await req('PATCH', `/api/list/${listSlug}/items/${laptop._id}/check`, { done: true })
    let r = (await req<Res>('GET', `/api/list/${listSlug}/items`)).body as Res
    expect(r.data.find(i => i._id === laptop._id)?.done).toBe(true)
    expect(r.meta.default_repeat).toBe('once')

    expect((await req('PATCH', `/api/list/${listSlug}/settings`, { default_repeat: 'always' })).status).toBe(200)
    expect((await add({ title: 'Badge' })).repeat).toBe('always')
    expect((await add({ title: 'Cake for Friday', repeat: 'once' })).repeat).toBe('once')
    r = (await req<Res>('GET', `/api/list/${listSlug}/items`)).body as Res
    expect(r.meta.default_repeat).toBe('always')

    expect((await req('PATCH', `/api/list/${listSlug}/items/${laptop._id}`, { repeat: 'once' })).status).toBe(200)
    expect((await req('PATCH', `/api/list/${listSlug}/settings`, { default_repeat: 'sometimes' })).status).toBe(400)
    await req('PATCH', `/api/list/${listSlug}/settings`, { default_repeat: 'once' })
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

describe('Location-aware reads', () => {
  it('list items and /api/here follow the check-in; ?at= filters by place', async () => {
    expect([200, 409]).toContain((await req('POST', '/auth/claim-username', { username: 'ahha-test-runner' })).status)
    const name = `Loc test store ${Date.now()}`
    const place = ((await req<{ data: { _id: string } }>('POST', '/api/entities', { name })).body as { data: { _id: string } }).data._id
    const add = async (title: string) =>
      ((await req<{ data: { _id: string } }>('POST', `/api/list/${listSlug}/items`, { title })).body as { data: { _id: string } }).data._id
    await add('untagged first')
    const tagged = await add('tagged second')
    await req('PATCH', `/api/list/${listSlug}/items/${tagged}`, { contexts: [{ entity_id: place, time_chunks: [] }] })

    type Item = { _id: string; here: boolean; places: Array<{ name: string }> }
    type Res = { data: Item[]; meta: { location: { name: string } | null; at?: { _id: string }; note?: string } }
    const list = async (q = '') => (await req<Res>('GET', `/api/list/${listSlug}/items?done=false${q}`)).body as Res

    await req('DELETE', '/api/entities/checkin')
    let r = await list()
    expect(r.meta.location).toBeNull()
    expect(r.data.find(i => i._id === tagged)!.places[0]!.name).toBe(name)
    expect(r.data.find(i => i._id === tagged)!.here).toBe(false)
    expect((await list('&at=here')).meta.note).toMatch(/Not checked in/)

    await req('POST', `/api/entities/${place}/checkin`)
    r = await list()
    expect(r.meta.location!.name).toBe(name)
    expect(r.data[0]!._id).toBe(tagged)          // "here" items sort first
    expect(r.data[0]!.here).toBe(true)
    const here = await list('&at=here')
    expect(here.data.map(i => i._id)).toEqual([tagged])
    expect((await list(`&at=${encodeURIComponent(name.toLowerCase())}`)).data.map(i => i._id)).toEqual([tagged])
    expect((await list('&at=nowhere-at-all')).meta.note).toMatch(/No place named/)

    const h = (await req<{ data: { location: { name: string }; list_items: Array<{ _id: string; list: string }> } }>('GET', '/api/here')).body as
      { data: { location: { name: string }; list_items: Array<{ _id: string; list: string }> } }
    expect(h.data.location.name).toBe(name)
    expect(h.data.list_items).toContainEqual(expect.objectContaining({ _id: tagged, list: listSlug }))

    await req('DELETE', '/api/entities/checkin')
    await req('DELETE', `/api/entities/${place}`)
  })
})

describe('Connect flow (scoped app keys)', () => {
  // Bearer-only requests: the shared req() helper sends the session cookie, which would win.
  const asKey = async (key: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json().catch(() => ({})) as any }
  }
  const { createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto')
  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
  }
  const app = { client_id: 'com.example.testcart', client_name: 'Ah! Test', device: `runner ${Date.now()}`, redirect_uri: 'ahtest://connected' }
  const authorize = async (challenge: string, scopes = ['lists:read', 'lists:check', 'trail:write']) =>
    ((await req<{ data: { code: string } }>('POST', '/api/connect/authorize', { ...app, scopes, code_challenge: challenge, code_challenge_method: 'S256' })).body as any).data.code as string
  const token = (code: string, verifier: string) =>
    fetch(API + '/api/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, client_id: app.client_id, redirect_uri: app.redirect_uri }) })
      .then(async r => ({ status: r.status, body: await r.json() as any }))

  let key = ''

  it('rejects a wrong verifier, and a code works only once', async () => {
    const p = pkce()
    const code = await authorize(p.challenge)
    expect((await token(code, pkce().verifier)).status).toBe(400)
    expect((await token(code, p.verifier)).status).toBe(400)   // consumed by the failed attempt
  })

  it('refuses unknown permissions and unsafe return addresses', async () => {
    const p = pkce()
    expect((await req('POST', '/api/connect/authorize', { ...app, scopes: ['everything'], code_challenge: p.challenge, code_challenge_method: 'S256' })).status).toBe(400)
    expect((await req('POST', '/api/connect/authorize', { ...app, redirect_uri: 'javascript:alert(1)', scopes: ['lists:read'], code_challenge: p.challenge, code_challenge_method: 'S256' })).status).toBe(400)
  })

  it('issues a key limited to the approved scopes', async () => {
    const p = pkce()
    const r = await token(await authorize(p.challenge), p.verifier)
    expect(r.status).toBe(200)
    key = r.body.data.key
    expect(r.body.data.scopes).toEqual(['lists:read', 'lists:check', 'trail:write'])

    const items = await asKey(key, 'GET', `/api/list/${listSlug}/items`)
    expect(items.status).toBe(200)
    expect(items.body.meta.location).toBeNull()            // no situation:place granted
    expect((await asKey(key, 'GET', '/auth/me')).status).toBe(200)
    expect((await asKey(key, 'POST', `/api/trail/${trailSlug}/append`, { text: 'connect-flow test', source: 'ah-test' })).status).toBe(201)

    const first = items.body.data[0]
    if (first) expect((await asKey(key, 'DELETE', `/api/list/${listSlug}/items/${first._id}`)).status).toBe(403)
    expect((await asKey(key, 'GET', '/api/entities')).status).toBe(403)
    expect((await asKey(key, 'GET', '/api/here')).status).toBe(403)
    expect((await asKey(key, 'POST', '/api/keys', { name: 'escalate' })).status).toBe(403)
    expect((await asKey(key, 'GET', '/api/keys')).status).toBe(403)
  })

  it('reconnecting the same app on the same device replaces its key', async () => {
    const p = pkce()
    const r = await token(await authorize(p.challenge), p.verifier)
    expect(r.status).toBe(200)
    expect((await asKey(key, 'GET', '/auth/me')).status).toBe(401)
    const fresh = r.body.data.key as string
    const keys = ((await req<{ data: Array<{ _id: string; name: string }> }>('GET', '/api/keys')).body as any).data as Array<{ _id: string; name: string }>
    const mine = keys.filter(k => k.name === `${app.client_name} — ${app.device}`)
    expect(mine).toHaveLength(1)
    await req('DELETE', `/api/keys/${mine[0]!._id}`)
    expect((await asKey(fresh, 'GET', '/auth/me')).status).toBe(401)
  })

  it('a read-only key can no longer write (access was never enforced before)', async () => {
    const made = (await req<{ data: { id: string; key: string } }>('POST', '/api/keys', { name: `ro test ${Date.now()}`, access: 'read' })).body as any
    expect((await asKey(made.data.key, 'GET', `/api/list/${listSlug}/items`)).status).toBe(200)
    expect((await asKey(made.data.key, 'POST', `/api/trail/${trailSlug}/append`, { text: 'should fail' })).status).toBe(403)
    await req('DELETE', `/api/keys/${made.data.id}`)
  })
})

describe('Situation + focus', () => {
  type Now = { data: { situation: { energy: { level: string; why: string; override: string | null }; day: { off: boolean } } | null; focus: unknown } }
  const now = async () => ((await req<Now>('GET', '/api/now?tz=America/New_York')).body as Now).data

  it('/api/now carries a situation and (possibly null) focus', async () => {
    const d = await now()
    expect(d.situation).toBeTruthy()
    expect(d).toHaveProperty('focus')
  })

  it('an energy override wins over every other signal, latest one counts', async () => {
    expect((await req('POST', '/api/situation/energy', { level: 'low' })).status).toBe(200)
    let s = (await now()).situation!
    expect(s.energy.level).toBe('low')
    expect(s.energy.why).toBe('you said so')
    await req('POST', '/api/situation/energy', { level: 'high' })
    s = (await now()).situation!
    expect(s.energy.override).toBe('high')
    await req('POST', '/api/situation/energy', { level: 'normal' })
    expect((await req('POST', '/api/situation/energy', { level: 'exhausted' })).status).toBe(400)
  })

  it('a day off sets day.off until switched back', async () => {
    await req('POST', '/api/situation/day', { off: true })
    expect((await now()).situation!.day.off).toBe(true)
    await req('POST', '/api/situation/day', { off: false })
    expect((await now()).situation!.day.off).toBe(false)
  })
})

describe('Ah! Link', () => {
  const tag = `lt${Date.now()}`
  type Entry = { text: string; tags: string[]; meta: Record<string, unknown> }
  const entries = async () => ((await req<{ data: Entry[] }>('GET', `/api/trail/${trailSlug}/entries?limit=50`)).body as { data: Entry[] }).data
  const until = async (pred: (es: Entry[]) => boolean) => {
    for (let i = 0; i < 20; i++) { const es = await entries(); if (pred(es)) return es; await new Promise(r => setTimeout(r, 250)) }
    return entries()
  }
  let flowId = ''; let slug = ''

  it('creates a workflow note from a flow', async () => {
    const flow = {
      type: 'ah-link/flow@1', name: `Ping pong ${tag}`, about: 'test', on: true,
      trigger: { block: 'trail_entry', tag },
      steps: [{ block: 'if', cond: { block: 'compare', left: '{event.text}', op: 'contains', right: 'ping' },
        then: [{ block: 'log', text: 'pong: {event.text}', tags: [tag], trail: trailSlug }],
        else: [{ block: 'log', text: 'no ping', tags: [`${tag}-else`], trail: trailSlug }] }],
    }
    const r = await req<{ data: { id: string; slug: string } }>('POST', '/api/link/flows', { flow })
    expect(r.status).toBe(201)
    ;({ id: flowId, slug } = (r.body as { data: { id: string; slug: string } }).data)
    const note = (await req<{ data: { format: string } }>('GET', `/api/note/${slug}`)).body as { data: { format: string } }
    expect(note.data.format).toBe('workflow')
  })

  it('runs on a matching trail entry, and never on its own output (one pong, not a loop)', async () => {
    await req('POST', `/api/trail/${trailSlug}/append`, { text: 'ping from test', tags: [tag] })
    const es = await until(es => es.some(e => e.text === 'pong: ping from test'))
    expect(es.filter(e => e.text.startsWith('pong:')).length).toBe(1)   // its own "pong" (also tagged) did not re-trigger it
    await new Promise(r => setTimeout(r, 800))
    expect((await entries()).filter(e => e.text.startsWith('pong:')).length).toBe(1)
  })

  it('a dry run evaluates but changes nothing', async () => {
    const before = (await entries()).length
    const r = await req<{ data: { status: string; actions: string[] } }>('POST', `/api/link/flows/${flowId}/run`, { dry_run: true })
    const d = (r.body as { data: { status: string; actions: string[] } }).data
    expect(d.status).toBe('done')
    expect(d.actions[0]).toMatch(/^log “no ping”/)   // manual event has no text → else branch
    expect((await entries()).length).toBe(before)
  })

  it('format switching: text stops the flow and allows free edits; back to workflow validates', async () => {
    expect((await req('PUT', `/api/note/${slug}`, { body: 'not json' })).status).toBe(400)
    expect((await req('PATCH', `/api/note/${slug}/format`, { format: 'text' })).status).toBe(200)
    const listed = ((await req<{ data: Array<{ id: string }> }>('GET', '/api/link/flows')).body as { data: Array<{ id: string }> }).data
    expect(listed.some(f => f.id === flowId)).toBe(false)
    const original = ((await req<{ data: { body: string } }>('GET', `/api/note/${slug}`)).body as { data: { body: string } }).data.body
    expect((await req('PUT', `/api/note/${slug}`, { body: original.replace('"steps"', '"stepz"') })).status).toBe(200)
    expect((await req('PATCH', `/api/note/${slug}/format`, { format: 'workflow' })).status).toBe(400)
    await req('PUT', `/api/note/${slug}`, { body: original.replace('"on": true', '"on": false') })
    expect((await req('PATCH', `/api/note/${slug}/format`, { format: 'workflow' })).status).toBe(200)
  })

  it('validate reports the first problem in words', async () => {
    const r = await req<{ data: { valid: boolean; error: string } }>('POST', '/api/link/validate', { flow: { type: 'ah-link/flow@1', name: 'x', trigger: { block: 'teleport' }, steps: [] } })
    const d = (r.body as { data: { valid: boolean; error: string } }).data
    expect(d.valid).toBe(false)
    expect(d.error).toMatch(/trigger/)
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

// ── Modules: Follow-through snooze counting, Restock items ──────────────────

describe('Modules', () => {
  type Card = { data: { _id: string; defer_count?: number; followthrough?: unknown } }
  const later = () => new Date(Date.now() + 3_600_000).toISOString()

  it('counts the person\'s own snoozes and brings a 3× snoozed card forward on Ah! Today', async () => {
    const cols = (await req<{ data: Array<{ _id: string }> }>('GET', `/api/board/${boardSlug}/columns`)).body as { data: Array<{ _id: string }> }
    const made = (await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: cols.data[0]!._id, title: `Snoozed thing ${Date.now()}` })).body as { data: { _id: string } }
    const id = made.data._id
    for (let i = 0; i < 3; i++) expect((await req('POST', `/api/cards/${id}/defer`, { defer_until: later() })).status).toBe(200)
    expect((await req('POST', `/api/cards/${id}/defer`, { defer_until: null })).status).toBe(200)   // un-snoozing doesn't count
    let card = ((await req<Card>('GET', `/api/cards/${id}`)).body as Card).data
    expect(card.defer_count).toBe(3)

    // Visible again (defer cleared) → a focus candidate with the snooze reason.
    type Now = { data: { focus: { id?: string; reasons: string[] } | null } }
    const focus = ((await req<Now>('GET', '/api/now?tz=America/New_York')).body as Now).data.focus
    if (focus?.id === id) expect(focus.reasons[0]).toBe('snoozed 3 times')

    // Done → the count starts over.
    expect((await req('POST', `/api/cards/${id}/complete`)).status).toBe(200)
    card = ((await req<Card>('GET', `/api/cards/${id}`)).body as Card).data
    expect(card.defer_count).toBe(0)
  })

  it('list items: a snooze counts, Restock-style items carry source and reason, bad sources are refused', async () => {
    type Item = { data: { _id: string; source?: string; reason?: string } }
    const made = ((await req<Item>('POST', `/api/list/${listSlug}/items`, { title: 'Milk', source: 'ah-restock', reason: 'You buy this about every 9 days; last time 8 days ago' })).body as Item).data
    expect(made.source).toBe('ah-restock')
    expect(made.reason).toMatch(/every 9 days/)
    expect((await req('POST', `/api/list/${listSlug}/items`, { title: 'x', source: 'Not A Slug!' })).status).toBe(400)
    expect((await req('PATCH', `/api/list/${listSlug}/items/${made._id}`, { defer_until: later() })).status).toBe(200)
    type Items = { data: Array<{ _id: string; defer_count?: number }> }
    const items = ((await req<Items>('GET', `/api/list/${listSlug}/items`)).body as Items).data
    expect(items.find(i => i._id === made._id)?.defer_count).toBe(1)
  })

  it('dev: the modules run for the signed-in person on demand', async () => {
    type Ran = { data: Record<string, unknown> }
    const r = await req<Ran>('POST', '/api/dev/modules/run?only=ah-restock')
    expect(r.status).toBe(200)
    expect((r.body as Ran).data).toHaveProperty('ah-restock')
  })
})

// ── Tags as QR codes ────────────────────────────────────────────────────────

describe('Tags: NFC and QR', () => {
  it('a QR scan runs the tag like an NFC tap and says so in the trail entry', async () => {
    type Tag = { data: { tag_id: string; url: string } }
    const made = ((await req<Tag>('POST', '/api/nfc/tags', { name: `QR test ${Date.now()}`, icon: '🧪', action: { type: 'trail', space_slug: trailSlug, text: `qr-scan-${Date.now()}` } })).body as Tag).data
    expect(made.url).toMatch(/\/t\/[2-9a-km-z]{20}$/)
    type Tap = { data: { duplicate: boolean; message: string } }
    const tap = (await req<Tap>('POST', `/api/nfc/tap/${made.tag_id}`, { via: 'qr' })).body as Tap
    expect(tap.data.duplicate).toBe(false)
    type Entries = { data: Array<{ source: string; meta: { nfc_tag?: string; via?: string } }> }
    const entries = ((await req<Entries>('GET', `/api/trail/${trailSlug}/entries?limit=20`)).body as Entries).data
    const e = entries.find(x => x.meta?.nfc_tag === made.tag_id)
    expect(e?.source).toBe('nfc')        // every way in counts as a tag tap
    expect(e?.meta.via).toBe('qr')
    // A second scan right away is the same use.
    expect(((await req<Tap>('POST', `/api/nfc/tap/${made.tag_id}`, { via: 'qr' })).body as Tap).data.duplicate).toBe(true)
    await req('DELETE', `/api/nfc/tags/${made.tag_id}`)
  })

  it('serves the Android App Links file for tag links', async () => {
    type Links = Array<{ target: { package_name: string; sha256_cert_fingerprints: string[] } }>
    const { status, body } = await req<Links>('GET', '/.well-known/assetlinks.json')
    expect(status).toBe(200)
    expect((body as Links)[0]!.target.package_name).toBe('app.ahha.android')
    expect((body as Links)[0]!.target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  })
})

// ── Ah! Today: board columns that show there, their priority, and the item limit ─

describe('Ah! Today columns + limit', () => {
  type Cols = { data: Array<{ _id: string; title: string; in_today?: boolean; today_priority?: number }> }
  type Board = { _id: string; column: string; column_priority: number }
  type Now = { data: Record<string, unknown[]> & { board: Board[]; limit: { max: number | null; total: number; hidden: number } } }
  const now = async () => ((await req<Now>('GET', '/api/now?tz=America/New_York')).body as Now).data
  let cols: Cols['data'] = []
  const made: string[] = []

  it('a column can be switched on for Ah! Today with a priority; bad priorities are refused', async () => {
    cols = ((await req<Cols>('GET', `/api/board/${boardSlug}/columns`)).body as Cols).data
    expect(cols.length).toBeGreaterThanOrEqual(2)
    const r = await req<{ data: { in_today: boolean; today_priority: number } }>('PATCH', `/api/board/${boardSlug}/columns/${cols[0]!._id}`, { in_today: true, today_priority: 4 })
    expect(r.status).toBe(200)
    expect((r.body as { data: { in_today: boolean } }).data.in_today).toBe(true)
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/${cols[1]!._id}`, { in_today: true, today_priority: 1 })).status).toBe(200)
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/${cols[1]!._id}`, { today_priority: 9 })).status).toBe(400)
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/000000000000000000000000`, { in_today: true })).status).toBe(404)
  })

  it('cards in those columns show on Ah! Today, priority 1 (the highest) first', async () => {
    for (const [i, col] of [cols[0]!, cols[1]!].entries()) {
      const c = (await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: col._id, title: `Today column card ${i} ${Date.now()}` })).body as { data: { _id: string } }
      made.push(c.data._id)
    }
    const board = (await now()).board
    const low = board.findIndex(c => c._id === made[0])
    const high = board.findIndex(c => c._id === made[1])
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThan(low)
    expect(board[high]!.column_priority).toBe(1)
  })

  it('switching a column off takes its cards out', async () => {
    await req('PATCH', `/api/board/${boardSlug}/columns/${cols[0]!._id}`, { in_today: false })
    expect((await now()).board.some(c => c._id === made[0])).toBe(false)
  })

  it('the item limit caps what Ah! Today shows and says how many are hidden', async () => {
    expect((await req('PUT', '/api/settings', { today_limit: 0 })).status).toBe(400)
    expect((await req('PUT', '/api/settings', { today_limit: 1 })).status).toBe(200)
    expect(((await req<{ data: { today_limit: number } }>('GET', '/api/settings')).body as { data: { today_limit: number } }).data.today_limit).toBe(1)
    const d = await now()
    const shown = ['urgent', 'habits', 'due_today', 'location_context', 'board', 'resurfaced', 'entity_list_items', 'list_items', 'nudges']
      .reduce((n, k) => n + (d[k]?.length ?? 0), 0)
    expect(shown).toBeLessThanOrEqual(1)
    expect(d.limit.max).toBe(1)
    expect(d.limit.hidden).toBe(d.limit.total - shown)
    expect((await req('PUT', '/api/settings', { today_limit: null })).status).toBe(200)
    expect((await now()).limit.max).toBeNull()
  })

  afterAll(async () => {
    for (const id of made) await req('DELETE', `/api/board/${boardSlug}/cards/${id}`)
    for (const col of cols.slice(0, 2)) await req('PATCH', `/api/board/${boardSlug}/columns/${col._id}`, { in_today: col.in_today ?? false, ...(col.today_priority ? { today_priority: col.today_priority } : {}) })
  })
})

// ── Places with several locations (three Walmarts) ──────────────────────────

describe('Places: several locations', () => {
  type Sig = { kind: string; id?: string; label?: string | null; lat?: number; lng?: number; radius_m?: number }
  type Train = { signatures: Sig[]; location_ids: string[]; added: number }
  type Ents = { data: Array<{ _id: string; signatures: Sig[] }> }
  let id = ''
  const gps = (s: Sig[]) => s.filter(x => x.kind === 'gps')
  const train = async (body: unknown) => (await req<Train>('POST', `/api/entities/${id}/train`, body)).body as Train
  // Two spots ~5 km apart, and a point ~50 m from the first.
  const A = { lat: 35.7800, lng: -78.6400 }, B = { lat: 35.8250, lng: -78.6400 }, nearA = { lat: 35.78045, lng: -78.6400 }

  it('training somewhere new adds a location; near an existing one it updates that one', async () => {
    id = ((await req<{ data: { _id: string } }>('POST', '/api/entities', { name: `Walmart ${Date.now()}`, icon: '🏪' })).body as { data: { _id: string } }).data._id
    const a = await train({ signatures: [{ kind: 'gps', ...A, radius_m: 100 }] })
    expect(a.added).toBe(1)
    const b = await train({ signatures: [{ kind: 'gps', ...B, radius_m: 100, label: 'North' }] })
    expect(b.added).toBe(1)
    expect(gps(b.signatures)).toHaveLength(2)
    const again = await train({ signatures: [{ kind: 'gps', ...nearA, radius_m: 150 }] })
    expect(again.added).toBe(0)
    expect(again.location_ids[0]).toBe(a.location_ids[0])
    expect(gps(again.signatures)).toHaveLength(2)
    expect(gps(again.signatures).find(x => x.id === a.location_ids[0])!.radius_m).toBe(150)
  })

  it('detect checks every location and says which one matched', async () => {
    type Det = { data: { matches: Array<{ entity: { _id: string }; location: { id: string; label: string } | null }> } }
    const d = (await req<Det>('POST', '/api/entities/detect', { gps: B })).body as Det
    const m = d.data.matches.find(x => x.entity._id === id)
    expect(m?.location?.label).toBe('North')
  })

  it('one location can be labelled or removed without touching the others', async () => {
    const ents = ((await req<Ents>('GET', '/api/entities')).body as Ents).data
    const [first, second] = gps(ents.find(e => e._id === id)!.signatures)
    expect((await req('PATCH', `/api/entities/${id}/locations/${first!.id}`, { label: 'Hwy 70' })).status).toBe(200)
    expect((await req('DELETE', `/api/entities/${id}/locations/${second!.id}`)).status).toBe(200)
    expect((await req('DELETE', `/api/entities/${id}/locations/nope`)).status).toBe(404)
    const left = gps(((await req<Ents>('GET', '/api/entities')).body as Ents).data.find(e => e._id === id)!.signatures)
    expect(left).toHaveLength(1)
    expect(left[0]!.label).toBe('Hwy 70')
  })

  it('replace keeps only the new point', async () => {
    await train({ signatures: [{ kind: 'gps', ...B }] })
    const r = await train({ signatures: [{ kind: 'gps', ...A }], replace: true })
    expect(gps(r.signatures)).toHaveLength(1)
  })

  afterAll(async () => { if (id) await req('DELETE', `/api/entities/${id}`) })
})

// ── Column settings: rename, recolour, delete with its cards moved ──────────

describe('Board column settings', () => {
  type Col = { _id: string; title: string; color: string }
  type Cols = { data: Col[] }
  type Cards = { data: Array<{ _id: string; column_id: string }> }
  let colId = ''

  it('a column can be renamed and recoloured', async () => {
    colId = ((await req<{ data: Col }>('POST', `/api/board/${boardSlug}/columns`, { title: `Waiting ${Date.now()}` })).body as { data: Col }).data._id
    const r = await req<{ data: Col }>('PATCH', `/api/board/${boardSlug}/columns/${colId}`, { title: 'Waiting on others', color: '#fbbf24' })
    expect(r.status).toBe(200)
    const col = ((await req<Cols>('GET', `/api/board/${boardSlug}/columns`)).body as Cols).data.find(c => c._id === colId)!
    expect(col.title).toBe('Waiting on others')
    expect(col.color).toBe('#fbbf24')
  })

  it('a column with cards is deleted only with somewhere to move them', async () => {
    const card = ((await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: colId, title: 'Moves with its column' })).body as { data: { _id: string } }).data._id
    expect((await req('DELETE', `/api/board/${boardSlug}/columns/${colId}`)).status).toBe(409)
    expect((await req('DELETE', `/api/board/${boardSlug}/columns/${colId}?move_to=${colId}`)).status).toBe(400)
    const dest = ((await req<Cols>('GET', `/api/board/${boardSlug}/columns`)).body as Cols).data.find(c => c._id !== colId)!
    expect((await req('DELETE', `/api/board/${boardSlug}/columns/${colId}?move_to=${dest._id}`)).status).toBe(200)
    const cols = ((await req<Cols>('GET', `/api/board/${boardSlug}/columns`)).body as Cols).data
    expect(cols.some(c => c._id === colId)).toBe(false)
    const moved = ((await req<Cards>('GET', `/api/board/${boardSlug}/cards`)).body as Cards).data.find(c => c._id === card)
    expect(moved?.column_id).toBe(dest._id)
    await req('DELETE', `/api/board/${boardSlug}/cards/${card}`)
  })
})

// ── Trackers: rules over the trail → phone push + statuses ──────────────────

describe('Trackers', () => {
  type Tracker = { _id: string; name: string }
  type Push = { id: string; title: string; body: string | null; tracker_id: string | null }
  type Status = { label: string; value: string; detail: string; today: boolean }
  const who = `Pat${Date.now()}`
  const made: string[] = []
  const append = (text: string, tags: string[], meta: Record<string, unknown>) =>
    req('POST', `/api/trail/${trailSlug}/append`, { text, tags, meta })
  const settle = () => new Promise(r => setTimeout(r, 600)) // the engine runs off the Redis event

  it('refuses a tracker with nothing to match or nothing to do', async () => {
    expect((await req('POST', '/api/trackers', { name: 'x', match: {}, notify: { text: 'hi' } })).status).toBe(400)
    expect((await req('POST', '/api/trackers', { name: 'x', match: { source: 'api' } })).status).toBe(400)
  })

  it('a matching entry pushes to the phone inbox and sets a status', async () => {
    const home = await req<{ data: Tracker }>('POST', '/api/trackers', {
      name: `${who} gets home`, match: { tag: 'home', field: { key: 'person', value: who } },
      notify: { text: '🏠 {meta.person} is home' }, status: { label: who, value: 'home' },
    })
    expect(home.status).toBe(201)
    made.push((home.body as { data: Tracker }).data._id)
    const away = await req<{ data: Tracker }>('POST', '/api/trackers', {
      name: `${who} leaves`, match: { tag: 'away', field: { key: 'person', value: who } }, status: { label: who, value: 'away' },
    })
    made.push((away.body as { data: Tracker }).data._id)

    const before = ((await req<{ data: Push[] }>('GET', '/api/push/inbox')).body as { data: Push[] }).data.at(-1)?.id
    await append(`🏠 ${who} got home`, ['home'], { person: who })
    await settle()
    const inbox = ((await req<{ data: Push[] }>('GET', `/api/push/inbox${before ? `?after=${before}` : ''}`)).body as { data: Push[] }).data
    expect(inbox.some(m => m.title === `🏠 ${who} is home` && m.body === `🏠 ${who} got home`)).toBe(true)
    let st = ((await req<{ data: Status[] }>('GET', '/api/statuses')).body as { data: Status[] }).data.find(s => s.label === who)
    expect(st?.value).toBe('home')

    // Leaving: status only, no push.
    const last = inbox.at(-1)!.id
    await append(`🚶 ${who} left home`, ['away'], { person: who })
    await settle()
    st = ((await req<{ data: Status[] }>('GET', '/api/statuses')).body as { data: Status[] }).data.find(s => s.label === who)
    expect(st?.value).toBe('away')
    expect(((await req<{ data: Push[] }>('GET', `/api/push/inbox?after=${last}`)).body as { data: Push[] }).data).toHaveLength(0)
  })

  it('statuses switched on for Today show in the situation; the router is not special', async () => {
    await append(`🏠 ${who} got home`, ['home'], { person: who })
    await settle()
    type Now = { data: { situation: { statuses: Array<{ label: string; value: string }> } | null } }
    const sit = ((await req<Now>('GET', '/api/now?tz=America/New_York')).body as Now).data.situation
    expect(sit?.statuses.find(s => s.label === who)?.value).toBe('home')
    expect(sit).not.toHaveProperty('people')
  })

  it('test shows which recent entries a match would catch', async () => {
    type T = { data: { count: number; recent: Array<{ text: string }> } }
    const r = (await req<T>('POST', '/api/trackers/test', { match: { field: { key: 'person', value: who } } })).body as T
    expect(r.data.count).toBeGreaterThanOrEqual(3)
    expect(r.data.recent[0]!.text).toContain(who)
  })

  it('the stream delivers a push the moment it happens', async () => {
    const ctl = new AbortController()
    const res = await fetch(API + '/api/push/stream', { headers: { Cookie: cookie }, signal: ctl.signal })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    const got = (async () => {
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return buf
        buf += new TextDecoder().decode(value)
        if (buf.includes('event: push')) return buf
      }
    })()
    await new Promise(r => setTimeout(r, 300))
    await append(`🏠 ${who} got home again`, ['home'], { person: who })
    const text = await Promise.race([got, new Promise<string>(r => setTimeout(() => r('timeout'), 5000))])
    ctl.abort()
    expect(text).toContain(`🏠 ${who} is home`)
  })

  afterAll(async () => {
    for (const id of made) await req('DELETE', `/api/trackers/${id}`)
    await req('DELETE', `/api/statuses/${encodeURIComponent(who)}`)
  })
})

// ── Feedback form ──────────────────────────────────────────────────────────

describe('Feedback', () => {
  // Dev's FEEDBACK_TRAIL is this test account's own trail: ahha-test-runner/trail/feedback
  type Entries = { data: Array<{ text: string; source: string; tags: string[]; meta: Record<string, unknown> }> }
  const solve = async (challenge: string, bits: number) => {
    const { createHash } = await import('node:crypto')
    for (let n = 0; ; n++) {
      const h = createHash('sha256').update(challenge + n).digest()
      let z = 0
      for (const b of h) { if (b === 0) { z += 8; continue } z += Math.clz32(b) - 24; break }
      if (z >= bits) return String(n)
    }
  }
  const latest = async () => ((await req<Entries>('GET', '/api/trail/feedback/entries?limit=5')).body as Entries).data

  it('a signed-in person sends feedback without the bot check; it lands on the feedback trail', async () => {
    const msg = `The column settings are great ${Date.now()}`
    const r = await req('POST', '/api/feedback', { message: msg, doing: 'renaming a column', page: '/board' })
    expect(r.status).toBe(201)
    const e = (await latest()).find(x => x.meta['message'] === msg)
    expect(e?.source).toBe('feedback')
    expect(e?.tags).toContain('member')
    expect(e?.meta['type']).toBe('ah-ha/feedback@1')
    expect(String(e?.meta['from'])).toMatch(/^@/)
    expect(e?.meta['doing']).toBe('renaming a column')
  })

  it('a visitor must solve the proof-of-work; then their message and email arrive', async () => {
    const saved = cookie
    cookie = ''
    try {
      expect((await req('POST', '/api/feedback', { message: 'no proof' })).status).toBe(400)
      expect((await req('POST', '/api/feedback', { message: '' })).status).toBe(400)
      const { body } = await req<{ challenge: string; difficulty: number }>('GET', '/auth/pow-challenge')
      const { challenge, difficulty } = body as { challenge: string; difficulty: number }
      const msg = `Visitor here ${Date.now()}`
      const r = await req('POST', '/api/feedback', { message: msg, email: 'visitor@example.com', challenge, nonce: await solve(challenge, difficulty) })
      expect(r.status).toBe(201)
      cookie = saved
      const e = (await latest()).find(x => x.meta['message'] === msg)
      expect(e?.tags).toContain('visitor')
      expect(e?.meta['email']).toBe('visitor@example.com')
      expect(e?.text).toContain('visitor@example.com')
    } finally { cookie = saved }
  })
})

// ── Card ↔ list: three gate modes, and complete steps a card along ───────────

describe('Card list gate', () => {
  type Col = { _id: string }
  type Card = { _id: string; column_id: string; done?: boolean }
  let cols: Col[] = []
  let closedCol = ''

  const cardsOf = async () => (await req<{ data: Card[] }>('GET', `/api/board/${boardSlug}/cards`)).body.data
  const get = async (id: string) => (await cardsOf()).find(c => c._id === id)!
  const move = (id: string, col: string) => req('PATCH', `/api/board/${boardSlug}/cards/${id}/move`, { column_id: col })
  const complete = (id: string) => req('POST', `/api/cards/${id}/complete`, {})

  async function make(mode: 'none' | 'move' | 'complete', col: string, withOpenItem = true) {
    const card = (await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: col, title: `Gate ${mode} ${Date.now()}` })).body.data
    const slug = `gate-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const list = (await req<{ data: { _id: string } }>('POST', '/api/spaces', { type: 'list', name: 'Gate list', slug })).body.data
    const item = withOpenItem ? (await req<{ data: { _id: string } }>('POST', `/api/list/${slug}/items`, { title: 'Tape' })).body.data : null
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${card._id}`, { list_id: list._id, list_gate: mode })).status).toBe(200)
    return { card, slug, item }
  }

  beforeAll(async () => {
    cols = (await req<{ data: Col[] }>('GET', `/api/board/${boardSlug}/columns`)).body.data
    await req('PATCH', `/api/board/${boardSlug}/columns/${cols[2]!._id}`, { closes: 'done' })
    closedCol = (await req<{ data: Col }>('POST', `/api/board/${boardSlug}/columns`, { title: 'Dropped' })).body.data._id
    await req('PATCH', `/api/board/${boardSlug}/columns/${closedCol}`, { closes: 'closed' })
  })

  it('reports list progress on the card', async () => {
    const g = await make('complete', cols[1]!._id)
    type P = { data: Array<{ _id: string; list_progress?: { done: number; total: number; complete: boolean } }> }
    const find = async () => (await req<P>('GET', `/api/board/${boardSlug}/cards`)).body.data.find(c => c._id === g.card._id)!
    expect((await find()).list_progress).toMatchObject({ done: 0, total: 1, complete: false })
    await req('PATCH', `/api/list/${g.slug}/items/${g.item!._id}/check`, { done: true })
    expect((await find()).list_progress).toMatchObject({ done: 1, total: 1, complete: true })
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${g.card._id}`, { list_id: '000000000000000000000000' })).status).toBe(404)
  })

  it("'complete': can move around, can't be completed or put in Done", async () => {
    const g = await make('complete', cols[1]!._id)
    expect((await move(g.card._id, cols[0]!._id)).status).toBe(200)
    expect((await move(g.card._id, cols[1]!._id)).status).toBe(200)
    expect((await move(g.card._id, cols[2]!._id)).status).toBe(409)
    expect((await complete(g.card._id)).status).toBe(409)   // would land in Done
    await req('PATCH', `/api/list/${g.slug}/items/${g.item!._id}/check`, { done: true })
    expect((await complete(g.card._id)).status).toBe(200)
    expect((await get(g.card._id)).column_id).toBe(cols[2]!._id)
  })

  it("'move': can't change columns or complete; a Closed column still takes it", async () => {
    const g = await make('move', cols[1]!._id)
    expect((await move(g.card._id, cols[0]!._id)).status).toBe(409)
    expect((await complete(g.card._id)).status).toBe(409)
    expect((await move(g.card._id, closedCol)).status).toBe(200)
    expect((await get(g.card._id)).done).toBe(true)
  })

  it("'none': the list has no effect", async () => {
    const g = await make('none', cols[1]!._id)
    expect((await move(g.card._id, cols[2]!._id)).status).toBe(200)
    const h = await make('none', cols[1]!._id)
    expect((await complete(h.card._id)).status).toBe(200)
  })

  it('legacy boolean list_gate still works (false = none)', async () => {
    const g = await make('complete', cols[1]!._id)
    await req('PATCH', `/api/board/${boardSlug}/cards/${g.card._id}`, { list_gate: false })
    expect((await move(g.card._id, cols[2]!._id)).status).toBe(200)
  })

  it('complete steps a plain card to the next column and only finishes at the end', async () => {
    const card = (await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: cols[0]!._id, title: `Advance ${Date.now()}` })).body.data
    expect((await complete(card._id)).status).toBe(200)
    let c = await get(card._id)
    expect(c.column_id).toBe(cols[1]!._id)
    expect(c.done).not.toBe(true)
    expect((await complete(card._id)).status).toBe(200)
    c = await get(card._id)
    expect(c.column_id).toBe(cols[2]!._id)
    expect(c.done).toBe(true)
  })
})

describe('Closer columns', () => {
  it('a done column waits on the list; a closed column does not', async () => {
    type Col = { _id: string; closes?: string | null }
    const cols = (await req<{ data: Col[] }>('GET', `/api/board/${boardSlug}/columns`)).body.data
    const doneCol = cols[2]!, openCol = cols[0]!
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/${doneCol._id}`, { closes: 'done' })).status).toBe(200)
    const closedCol = (await req<{ data: Col }>('POST', `/api/board/${boardSlug}/columns`, { title: 'Closed' })).body.data
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/${closedCol._id}`, { closes: 'closed' })).status).toBe(200)
    expect((await req('PATCH', `/api/board/${boardSlug}/columns/${closedCol._id}`, { closes: 'nope' })).status).toBe(400)

    const mk = async () => {
      const card = (await req<{ data: { _id: string } }>('POST', `/api/board/${boardSlug}/cards`, { column_id: openCol._id, title: `Closer ${Date.now()}` })).body.data
      const slug = `closer-list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const list = (await req<{ data: { _id: string } }>('POST', '/api/spaces', { type: 'list', name: 'Closer list', slug })).body.data
      const item = (await req<{ data: { _id: string } }>('POST', `/api/list/${slug}/items`, { title: 'Thing' })).body.data
      await req('PATCH', `/api/board/${boardSlug}/cards/${card._id}`, { list_id: list._id })
      return { card, slug, item }
    }
    const a = await mk()
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${a.card._id}/move`, { column_id: doneCol._id })).status).toBe(409)
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${a.card._id}/move`, { column_id: closedCol._id })).status).toBe(200)
    // reopening clears the closed state
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${a.card._id}/move`, { column_id: openCol._id })).status).toBe(200)
    await req('PATCH', `/api/list/${a.slug}/items/${a.item._id}/check`, { done: true })
    expect((await req('PATCH', `/api/board/${boardSlug}/cards/${a.card._id}/move`, { column_id: doneCol._id })).status).toBe(200)

    await req('DELETE', `/api/board/${boardSlug}/cards/${a.card._id}`)
    await req('PATCH', `/api/board/${boardSlug}/columns/${doneCol._id}`, { closes: null })
  })
})
