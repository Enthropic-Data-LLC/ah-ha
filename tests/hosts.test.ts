import { describe, it, expect, afterEach } from 'vitest'
import { allowedOrigins, sessionCookieOptions, webBaseFor } from '../src/lib/hosts.js'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

describe('Two faces: ah-ha.app (data) and now.ah-ha.app (Ah! Today)', () => {
  it('sign-in links go back to the face the person asked from', () => {
    process.env['BASE_URL'] = 'https://ah-ha.app'
    process.env['TODAY_ORIGIN'] = 'https://now.ah-ha.app/'
    expect(webBaseFor('https://now.ah-ha.app')).toBe('https://now.ah-ha.app')
    expect(webBaseFor('https://ah-ha.app')).toBe('https://ah-ha.app')
  })

  it('never builds a link from an origin we do not own', () => {
    process.env['BASE_URL'] = 'https://ah-ha.app'
    process.env['TODAY_ORIGIN'] = 'https://now.ah-ha.app'
    expect(webBaseFor('https://evil.example')).toBe('https://ah-ha.app')
    expect(webBaseFor(undefined)).toBe('https://ah-ha.app')
  })

  it('without a Today host, only the data host is allowed', () => {
    process.env['BASE_URL'] = 'https://ah-ha.app'
    delete process.env['TODAY_ORIGIN']
    expect(allowedOrigins()).toEqual(['https://ah-ha.app'])
    expect(webBaseFor('https://now.ah-ha.app')).toBe('https://ah-ha.app')
  })

  it('the session cookie is shared across hosts only when COOKIE_DOMAIN is set', () => {
    delete process.env['COOKIE_DOMAIN']
    expect(sessionCookieOptions().domain).toBeUndefined()
    process.env['COOKIE_DOMAIN'] = '.ah-ha.app'
    expect(sessionCookieOptions()).toMatchObject({ domain: '.ah-ha.app', httpOnly: true, sameSite: 'lax' })
  })
})
