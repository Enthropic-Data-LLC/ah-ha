/**
 * Admin panel API (KB #1302): /api/admin/* is for ADMIN_EMAILS only, by session only.
 *
 * Runs against a live dev API — same contract as tests/api.test.ts (API_URL,
 * NODE_ENV=development, ALLOW_DEV_LINK=1, loopback/LAN caller). The admin-side tests
 * need ADMIN_TEST_EMAIL set to an address in the API's ADMIN_EMAILS; without it only
 * the refusals are checked.
 */
import { describe, it, expect, beforeAll } from 'vitest'

const API = process.env['API_URL'] ?? 'http://localhost:3100'
const ADMIN_EMAIL = process.env['ADMIN_TEST_EMAIL'] ?? ''
const STAMP = Date.now()

async function raw<T = any>(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T, setCookie }
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

let userCookie = ''
let userId = ''
const ID = '0123456789abcdef01234567'
const ROUTES: [string, string, unknown?][] = [
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/users'],
  ['GET', `/api/admin/users/${ID}`],
  ['PATCH', `/api/admin/users/${ID}`, { plan: 'pro' }],
]

beforeAll(async () => {
  userCookie = await claim(await login(`admin-u-${STAMP}@ah-ha.local`), `admu${STAMP}`.slice(0, 30))
  const me = await raw<{ data: { id: string; is_admin: boolean } }>(userCookie, 'GET', '/auth/me')
  userId = me.body.data.id
  expect(me.body.data.is_admin).toBe(false)
})

describe('admin routes refuse everyone else', () => {
  it.each(ROUTES)('%s %s → 401 signed out', async (method, path, body) => {
    expect((await raw('', method, path, body)).status).toBe(401)
  })

  it.each(ROUTES)('%s %s → 404 for a non-admin', async (method, path, body) => {
    expect((await raw(userCookie, method, path, body)).status).toBe(404)
  })

  it('a non-admin cannot change their own plan', async () => {
    expect((await raw(userCookie, 'PATCH', `/api/admin/users/${userId}`, { plan: 'enterprise' })).status).toBe(404)
    const me = await raw<{ data: { plan: string } }>(userCookie, 'GET', '/auth/me')
    expect(me.body.data.plan).toBe('free')
  })
})

describe.skipIf(!ADMIN_EMAIL)('admin', () => {
  let adminCookie = ''

  beforeAll(async () => {
    adminCookie = await login(ADMIN_EMAIL)
    const me = await raw(adminCookie, 'GET', '/auth/me')
    if (!me.body.data.username) adminCookie = await claim(adminCookie, `admin${STAMP}`.slice(0, 30))
  })

  it('/auth/me says so', async () => {
    const me = await raw<{ data: { is_admin: boolean } }>(adminCookie, 'GET', '/auth/me')
    expect(me.body.data.is_admin).toBe(true)
  })

  it('overview has totals', async () => {
    const r = await raw(adminCookie, 'GET', '/api/admin/overview')
    expect(r.status).toBe(200)
    expect(r.body.data.users.total).toBeGreaterThanOrEqual(2)
    expect(typeof r.body.data.spaces).toBe('object')
  })

  it('lists and searches users, without content', async () => {
    const r = await raw(adminCookie, 'GET', `/api/admin/users?q=${encodeURIComponent(`admin-u-${STAMP}`)}`)
    expect(r.status).toBe(200)
    expect(r.body.data).toHaveLength(1)
    expect(r.body.data[0].id).toBe(userId)
    expect(r.body.data[0].spaces).toBeGreaterThan(0) // the starter spaces
  })

  it('a regex in q is a literal, not a pattern', async () => {
    const r = await raw(adminCookie, 'GET', '/api/admin/users?q=.*')
    expect(r.status).toBe(200)
    expect(r.body.data).toHaveLength(0)
  })

  it('shows one user', async () => {
    const r = await raw(adminCookie, 'GET', `/api/admin/users/${userId}`)
    expect(r.status).toBe(200)
    expect(r.body.data.email).toBe(`admin-u-${STAMP}@ah-ha.local`)
    expect(Array.isArray(r.body.data.spaces)).toBe(true)
    expect(JSON.stringify(r.body)).not.toMatch(/"hash"|api_key_enc/)
  })

  it('unknown id → 404, malformed id → 400', async () => {
    expect((await raw(adminCookie, 'GET', `/api/admin/users/${ID}`)).status).toBe(404)
    expect((await raw(adminCookie, 'GET', '/api/admin/users/nope')).status).toBe(400)
  })

  it('changes a plan, rejects anything else in the body', async () => {
    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${userId}`, { plan: 'gold' })).status).toBe(400)
    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${userId}`, { plan: 'pro', email: 'x@y.z' })).status).toBe(400)
    const r = await raw(adminCookie, 'PATCH', `/api/admin/users/${userId}`, { plan: 'pro' })
    expect(r.status).toBe(200)
    const after = await raw(adminCookie, 'GET', `/api/admin/users/${userId}`)
    expect(after.body.data.plan).toBe('pro')
  })

  it('disabling makes an account read-only and stops its keys; enabling undoes it', async () => {
    const cookie = await claim(await login(`admin-d-${STAMP}@ah-ha.local`), `admd${STAMP}`.slice(0, 30))
    const me = await raw<{ data: { id: string } }>(cookie, 'GET', '/auth/me')
    const id = me.body.data.id
    const key = (await raw<{ data: { key: string } }>(cookie, 'POST', '/api/keys', { name: 'before-disable' })).body.data.key
    const bearer = { Authorization: `Bearer ${key}` }

    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${id}`, { disabled: true })).status).toBe(200)

    const after = await raw<{ data: { disabled: boolean } }>(cookie, 'GET', '/auth/me')
    expect(after.body.data.disabled).toBe(true)
    expect((await raw(cookie, 'GET', '/api/spaces')).status).toBe(200) // can still look
    const write = await raw(cookie, 'POST', '/api/spaces', { type: 'list', name: 'blocked' })
    expect(write.status).toBe(403)
    expect(write.body.code).toBe('ACCOUNT_DISABLED')
    expect((await raw('', 'GET', '/api/spaces', undefined, bearer)).status).toBe(403) // keys stop entirely
    expect((await raw(adminCookie, 'GET', `/api/admin/users/${id}`)).body.data.disabled_at).toBeTruthy()

    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${id}`, { disabled: false })).status).toBe(200)
    expect((await raw(cookie, 'POST', '/api/spaces', { type: 'list', name: 'allowed again' })).status).toBe(201)
    expect((await raw('', 'GET', '/api/spaces', undefined, bearer)).status).toBe(200)
  })

  it('an admin cannot be disabled from the panel, themselves included', async () => {
    const me = await raw<{ data: { id: string } }>(adminCookie, 'GET', '/auth/me')
    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${me.body.data.id}`, { disabled: true })).status).toBe(400)
    expect((await raw(adminCookie, 'PATCH', `/api/admin/users/${me.body.data.id}`, {})).status).toBe(400)
  })

  it("an admin's API key does not reach admin routes", async () => {
    const k = await raw<{ data: { id: string; key: string } }>(adminCookie, 'POST', '/api/keys', { name: `admin-test-${STAMP}` })
    expect(k.status).toBe(201)
    const r = await raw('', 'GET', '/api/admin/overview', undefined, { Authorization: `Bearer ${k.body.data.key}` })
    await raw(adminCookie, 'DELETE', `/api/keys/${k.body.data.id}`)
    expect(r.status).toBe(404)
  })
})
