/**
 * Account export/import (KB #2159): a sealed export goes back in as new copies; anything
 * that isn't an unmodified export from this server is refused without writing anything.
 *
 * Runs against a live dev API — same contract as tests/api.test.ts (API_URL,
 * NODE_ENV=development, ALLOW_DEV_LINK=1, loopback/LAN caller). A disabled account's export
 * (allowed) and import (refused) are checked in tests/admin.test.ts, which already makes one;
 * sign-in is limited to 10 a minute per IP, shared by every test file.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createHash } from 'node:crypto'

const API = process.env['API_URL'] ?? 'http://localhost:3100'
const STAMP = Date.now()

async function raw<T = any>(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const setCookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T, setCookie, headers: res.headers }
}

async function login(email: string): Promise<string> {
  const link = await raw<{ url: string }>('', 'GET', `/auth/dev-link?email=${encodeURIComponent(email)}`)
  const token = new URL(link.body.url).searchParams.get('token')
  const verify = await raw('', 'POST', '/api/auth/verify', { token })
  expect(verify.setCookie).toMatch(/aha_session/)
  return verify.setCookie
}

async function claim(cookie: string, username: string): Promise<string> {
  const r = await raw(cookie, 'POST', '/auth/claim-username', { username })
  expect(r.status).toBe(200)
  return r.setCookie || cookie
}

const hash = (id: string, ts: string, text: string) => createHash('sha256').update(`${id}|${new Date(ts).toISOString()}|${text}`).digest('hex')

let a = '', b = ''
let userA = '', userB = ''
let file: Record<string, any> = {}
const trailSlug = `pt-trail-${STAMP}`
const listSlug = `pt-list-${STAMP}`
const boardSlug = `pt-board-${STAMP}`

beforeAll(async () => {
  userA = `pta${STAMP}`.slice(0, 30)
  userB = `ptb${STAMP}`.slice(0, 30)
  a = await claim(await login(`port-a-${STAMP}@ah-ha.local`), userA)
  b = await claim(await login(`port-b-${STAMP}@ah-ha.local`), userB)

  for (const [type, slug] of [['trail', trailSlug], ['list', listSlug], ['board', boardSlug]]) {
    expect((await raw(a, 'POST', '/api/spaces', { type, name: `Port ${type}`, slug })).status).toBe(201)
  }
  for (const text of ['first', 'second', 'third']) {
    expect((await raw(a, 'POST', `/api/trail/${trailSlug}/append`, { text, tone: 'neutral', tags: ['port'] })).status).toBe(201)
  }
  expect((await raw(a, 'POST', `/api/list/${listSlug}/items`, { title: 'carry me' })).status).toBe(201)
  const cols = (await raw(a, 'GET', `/api/board/${boardSlug}/columns`)).body.data
  const list = (await raw(a, 'GET', '/api/spaces?type=list')).body.data.find((s: any) => s.slug === listSlug)
  const card = await raw(a, 'POST', `/api/board/${boardSlug}/cards`, { column_id: cols[0]._id, title: 'card with a checklist' })
  expect(card.status).toBe(201)
  expect((await raw(a, 'PATCH', `/api/board/${boardSlug}/cards/${card.body.data._id}`, { list_id: list._id })).status).toBe(200)
})

describe('export', () => {
  it('is a sealed download of the account', async () => {
    const r = await raw(a, 'GET', '/api/export')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="ah-ha-pta/)
    file = r.body
    expect(file.format).toBe('ah-ha-export')
    expect(file.signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/)
    expect(file.data.trail_entries.map((t: any) => t.text)).toEqual(['first', 'second', 'third'])
    expect(file.data.spaces.some((s: any) => s.slug === boardSlug)).toBe(true)
  })

  it('leaves out keys and secrets', async () => {
    const s = JSON.stringify(file)
    expect(s).not.toMatch(/"presence_token"|"secret"|api_key|"hash"/)
  })

  // /api/import is limited to 10 a minute per IP (api.ts), so this file makes 9 import calls in all.
  it('is session only: an API key cannot export (import is behind the same SESSION_ONLY check)', async () => {
    const key = (await raw(a, 'POST', '/api/keys', { name: `port-${STAMP}` })).body.data
    const auth = { Authorization: `Bearer ${key.key}` }
    expect((await raw('', 'GET', '/api/export', undefined, auth)).status).toBe(403)
    await raw(a, 'DELETE', `/api/keys/${key.id}`)
  })
})

describe('import refuses anything that is not an unmodified export', () => {
  const spaceCount = async () => (await raw(b, 'GET', '/api/spaces')).body.data.length

  it.each([
    ['an edited entry', (f: any) => { f.data.trail_entries[0].text = 'forged' }],
    ['an added space', (f: any) => { f.data.spaces.push({ ...f.data.spaces[0], name: 'smuggled' }) }],
    ['no signature', (f: any) => { delete f.signature }],
    ['a made-up signature', (f: any) => { f.signature = 'hmac-sha256:' + '0'.repeat(64) }],
  ])('%s → 400, nothing written', async (_name, tamper) => {
    const before = await spaceCount()
    const f = structuredClone(file)
    tamper(f)
    const r = await raw(b, 'POST', '/api/import', f)
    expect(r.status).toBe(400)
    expect(await spaceCount()).toBe(before)
  })

  it('re-formatting the file is harmless (the seal is over content, not bytes)', async () => {
    // Checked by importing a pretty-printed copy below.
    expect(JSON.stringify(file, null, 2)).not.toBe(JSON.stringify(file))
  })
})

describe('import', () => {
  let result: any

  it('brings everything into another account as new copies', async () => {
    const r = await raw(b, 'POST', '/api/import', JSON.stringify(file, null, 2))
    expect(r.status).toBe(200)
    result = r.body.data
    expect(result.counts.trail_entries).toBe(3)
    expect(result.counts.board_cards).toBeGreaterThanOrEqual(1)
    const spaces = (await raw(b, 'GET', '/api/spaces')).body.data
    for (const slug of [trailSlug, listSlug, boardSlug]) expect(spaces.some((s: any) => s.ref === `${userB}/${s.type}/${slug}` && s.slug === slug)).toBe(true)
  })

  it('rebuilds the trail hash chain under the new owner', async () => {
    const entries = (await raw(b, 'GET', `/api/trail/${trailSlug}/entries?limit=10`)).body.data.slice().reverse()
    expect(entries.map((e: any) => e.text)).toEqual(['first', 'second', 'third'])
    expect(entries[0].prev_hash).toBe(createHash('sha256').update(`genesis|${new Date(0).toISOString()}|${userB}/trail/${trailSlug}`).digest('hex'))
    for (let i = 1; i < entries.length; i++) expect(entries[i].prev_hash).toBe(hash(entries[i - 1].id, entries[i - 1].ts, entries[i - 1].text))
    expect(entries.map((e: any) => e.id)).not.toContain(file.data.trail_entries[0].id)
  })

  it('points the card at the imported checklist, not the original', async () => {
    const cards = (await raw(b, 'GET', `/api/board/${boardSlug}/cards`)).body.data
    const card = cards.find((c: any) => c.title === 'card with a checklist')
    const list = (await raw(b, 'GET', '/api/spaces?type=list')).body.data.find((s: any) => s.slug === listSlug)
    expect(card.list_id).toBe(list._id)
    expect(card.ref).toMatch(new RegExp(`^${userB}/board/${boardSlug}#card_${card._id}$`))
  })

  it('the same export cannot be imported twice into one account', async () => {
    expect((await raw(b, 'POST', '/api/import', file)).status).toBe(409)
  })

  it('into the account it came from, clashing spaces get a new slug', async () => {
    const r = await raw(a, 'POST', '/api/import', file)
    expect(r.status).toBe(200)
    expect(r.body.data.renamed).toContain(`${userA}/trail/${trailSlug}-2`)
    // The original is untouched.
    expect((await raw(a, 'GET', `/api/trail/${trailSlug}/entries?limit=10`)).body.data).toHaveLength(3)
  })

  it('is refused without a username', async () => {
    const fresh = await login(`port-c-${STAMP}@ah-ha.local`)
    const r = await raw(fresh, 'POST', '/api/import', file)
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('NO_USERNAME')
  })
})
