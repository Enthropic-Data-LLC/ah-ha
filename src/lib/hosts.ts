/**
 * One deployment, two faces: the data host (BASE_URL, e.g. ah-ha.app) and the Ah! Today host
 * (TODAY_ORIGIN, e.g. now.ah-ha.app). Both reach this API; the web app picks its shell by hostname.
 * COOKIE_DOMAIN (e.g. .ah-ha.app) lets one sign-in cover both.
 */
import type { CookieSerializeOptions } from '@fastify/cookie'

const trim = (s: string) => s.replace(/\/+$/, '')

export function dataOrigin(): string {
  return trim(process.env['BASE_URL'] ?? 'https://ah-ha.app')
}

export function todayOrigin(): string | null {
  const t = process.env['TODAY_ORIGIN']
  return t ? trim(t) : null
}

export function allowedOrigins(): string[] {
  const t = todayOrigin()
  return t ? [dataOrigin(), t] : [dataOrigin()]
}

/** The origin a sign-in link should point at: the face the person asked from, else the data host. */
export function webBaseFor(requestOrigin: string | undefined): string {
  const o = requestOrigin ? trim(requestOrigin) : ''
  return allowedOrigins().includes(o) ? o : dataOrigin()
}

export function sessionCookieOptions(): CookieSerializeOptions {
  const domain = process.env['COOKIE_DOMAIN']
  return {
    httpOnly: true,
    secure: (process.env['BASE_URL'] ?? '').startsWith('https') || process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    ...(domain ? { domain } : {}),
  }
}
