import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'

/**
 * SSRF-hardened HTTPS client (KB #2131).
 *
 * User-supplied URLs (iCal calendar sources, Ah! Link webhook steps) are fetched
 * by the server, so they must never be able to reach loopback, link-local,
 * private, CGNAT, or cloud-metadata addresses. Protections:
 *   - https only (webcal:// is upgraded to https://); no embedded credentials
 *   - every connected IP is validated via a custom dns lookup, so DNS rebinding
 *     and redirect-to-internal are blocked at connect time (each redirect hop is
 *     a fresh connection and is re-validated)
 *   - redirects are followed manually and capped; each hop is re-normalised
 *   - request timeout and a response-size cap (CWE-770)
 */

function blockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true
  const a = p[0]!, b = p[1]!
  if (a === 0 || a === 10 || a === 127) return true          // this-host / private / loopback
  if (a === 169 && b === 254) return true                     // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true            // private
  if (a === 192 && b === 168) return true                     // private
  if (a === 100 && b >= 64 && b <= 127) return true           // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true         // benchmarking
  if (a >= 224) return true                                    // multicast / reserved
  return false
}

/** True if an IP literal is one we refuse to connect to. Unknown/invalid → blocked. */
export function isBlockedIp(ipRaw: string): boolean {
  const ip = ipRaw.replace(/%.*$/, '') // strip IPv6 zone id
  const v = net.isIP(ip)
  if (v === 4) return blockedV4(ip)
  if (v === 6) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped && mapped[1]) return blockedV4(mapped[1])
    const head = parseInt(low.split(':')[0] || '0', 16)
    if ((head & 0xfe00) === 0xfc00) return true               // fc00::/7 unique-local
    if ((head & 0xffc0) === 0xfe80) return true               // fe80::/10 link-local
    return false
  }
  return true
}

// Custom dns.lookup that rejects the whole resolution if any address is blocked.
const guardedLookup = ((hostname: string, options: unknown, cb?: unknown) => {
  const callback = (typeof options === 'function' ? options : cb) as (
    err: NodeJS.ErrnoException | null, address?: unknown, family?: number,
  ) => void
  const opts = (typeof options === 'function' ? {} : options) as dns.LookupOptions
  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as dns.LookupAddress[]
    for (const a of list) {
      if (isBlockedIp(a.address)) {
        return callback(Object.assign(new Error(`SSRF blocked: ${a.address} for ${hostname}`), { code: 'ESSRFBLOCKED' }))
      }
    }
    if (opts && opts.all) return callback(null, list as unknown)
    const first = list[0]!
    callback(null, first.address, first.family)
  })
}) as unknown as typeof dns.lookup

/** Validate scheme/credentials and upgrade webcal→https. Throws on anything else. */
export function normalizeHttpsUrl(raw: string): URL {
  // webcal:// is a non-special scheme, so the URL protocol setter refuses to
  // rewrite it to https — swap the prefix as a string before parsing.
  const swapped = raw.trim().replace(/^webcal:\/\//i, 'https://')
  let u: URL
  try { u = new URL(swapped) } catch { throw new Error('invalid URL') }
  if (u.protocol !== 'https:') throw new Error('only https:// URLs are allowed')
  if (u.username || u.password) throw new Error('credentials in URL are not allowed')
  return u
}

/** Cheap sync check for schema validation at save time. */
export function isSafeHttpsUrl(raw: string): boolean {
  try { normalizeHttpsUrl(raw); return true } catch { return false }
}

export interface SafeRequestOpts {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}
export interface SafeResponse { status: number; body: string; url: string }

function once(
  u: URL, method: string, headers: Record<string, string>, body: string | undefined,
  timeoutMs: number, maxBytes: number,
): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      u, { method, headers, lookup: guardedLookup, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location) { res.resume(); resolve({ status, body: '', location }); return }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > maxBytes) { req.destroy(new Error('response exceeds size limit')); return }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** SSRF-safe HTTPS request with manual, re-validated redirects. */
export async function safeRequest(raw: string, opts: SafeRequestOpts = {}): Promise<SafeResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024, maxRedirects = 3 } = opts
  let u = normalizeHttpsUrl(raw)
  for (let hop = 0; ; hop++) {
    const res = await once(u, method, headers, body, timeoutMs, maxBytes)
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= maxRedirects) throw new Error('too many redirects')
      u = normalizeHttpsUrl(new URL(res.location, u).toString())
      continue
    }
    return { status: res.status, body: res.body, url: u.toString() }
  }
}
