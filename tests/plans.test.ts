/**
 * Plan limits and usage metering (KB #2160).
 *
 * The limits table is checked directly; /api/usage runs against a live dev API — same
 * contract as tests/api.test.ts. Dev runs with PLAN_LIMITS unset (measure only), which is
 * also what production runs while the paywall is on hold.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { limitsFor, over, PLAN_LIMITS } from '../src/lib/plans.js'

const API = process.env['API_URL'] ?? 'http://localhost:3100'
const STAMP = Date.now()

describe('limitsFor', () => {
  it('free: 10 spaces, 100 MB, 50 AI a month', () => {
    expect(limitsFor('free')).toEqual({ spaces: 10, storage_mb: 100, ai_calls: 50 })
    expect(limitsFor(undefined)).toEqual(PLAN_LIMITS.free)
    expect(limitsFor('no-such-plan')).toEqual(PLAN_LIMITS.free)
  })

  it('pro: unlimited spaces, 5 GB, 1,000 AI a month', () => {
    expect(limitsFor('pro')).toEqual({ spaces: null, storage_mb: 5120, ai_calls: 1000 })
  })

  it('grants add on top; unlimited stays unlimited; negatives are ignored', () => {
    expect(limitsFor('free', { ai_calls: 25, spaces: 5 })).toEqual({ spaces: 15, storage_mb: 100, ai_calls: 75 })
    expect(limitsFor('pro', { spaces: 99 }).spaces).toBeNull()
    expect(limitsFor('free', { ai_calls: -40 }).ai_calls).toBe(50)
  })

  it('at the limit counts as over (the next one is refused), unlimited never is', () => {
    expect(over(9, 10)).toBe(false)
    expect(over(10, 10)).toBe(true)
    expect(over(1e9, null)).toBe(false)
  })
})

async function raw<T = any>(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T, setCookie }
}

describe('/api/usage', () => {
  let cookie = ''

  beforeAll(async () => {
    const link = await raw<{ url: string }>('', 'GET', `/auth/dev-link?email=${encodeURIComponent(`plans-${STAMP}@ah-ha.local`)}`)
    const verify = await raw('', 'POST', '/api/auth/verify', { token: new URL(link.body.url).searchParams.get('token') })
    const claimed = await raw(verify.setCookie, 'POST', '/auth/claim-username', { username: `pl${STAMP}`.slice(0, 30) })
    cookie = claimed.setCookie || verify.setCookie
  })

  it('needs a session', async () => {
    expect((await raw('', 'GET', '/api/usage')).status).toBe(401)
  })

  it('shows the free plan, its limits and what is used', async () => {
    const r = await raw(cookie, 'GET', '/api/usage')
    expect(r.status).toBe(200)
    const u = r.body.data
    expect(u.plan).toBe('free')
    expect(u.mode).toBe('off')
    expect(u.limits).toEqual({ spaces: 10, storage_mb: 100, ai_calls: 50 })
    expect(u.used.spaces).toBeGreaterThan(0) // the starter spaces
    expect(u.used.storage_bytes).toBeGreaterThan(0)
    expect(u.used.ai_calls).toBe(0)
  })

  it('with limits off, an 11th space is still allowed', async () => {
    const have = (await raw(cookie, 'GET', '/api/usage')).body.data.used.spaces
    for (let i = have; i < 11; i++) expect((await raw(cookie, 'POST', '/api/spaces', { type: 'list', name: `fill ${i}` })).status).toBe(201)
    // Storage is cached for an hour; spaces are counted live.
    const u = (await raw(cookie, 'GET', '/api/usage')).body.data
    expect(u.used.spaces).toBe(11)
    expect(u.over.spaces).toBe(true)
  })

  it('AI on the user’s own key is counted apart and never against the plan', async () => {
    expect((await raw(cookie, 'PUT', '/api/settings', { anthropic_api_key: 'sk-ant-not-a-real-key' })).status).toBe(200)
    const board = await raw(cookie, 'POST', '/api/spaces', { type: 'board', name: 'capture board', slug: `pl-board-${STAMP}` })
    const r = await raw(cookie, 'POST', `/api/board/${board.body.data.slug}/cards/capture`, { text: 'call the dentist tomorrow' })
    expect(r.status).toBe(200) // Anthropic refuses the fake key; capture falls back to the raw text
    // The count is written fire-and-forget; give it a moment.
    let u: any
    for (let i = 0; i < 10; i++) {
      u = (await raw(cookie, 'GET', '/api/usage')).body.data
      if (u.used.own_key_ai_calls) break
      await new Promise(r => setTimeout(r, 100))
    }
    expect(u.used.own_key_ai_calls).toBe(1)
    expect(u.used.ai_calls).toBe(0)
  })
})
