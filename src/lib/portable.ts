import { createHmac, hkdfSync, timingSafeEqual } from 'crypto'
import { ObjectId } from 'mongodb'

/**
 * Account export/import (KB #2159): the file format and its seal.
 *
 * An export is EJSON (ObjectIds and dates survive the round trip) sealed with an
 * HMAC-SHA256 over its canonical form. Only this server holds the key, so import
 * accepts exactly what an export produced: a file that was edited, assembled by hand or
 * taken from somewhere else fails the check and nothing is written. The canonical form
 * sorts keys and drops whitespace, so pretty-printing or re-saving the file is harmless.
 *
 * Key: HKDF(JWT_SECRET) under its own label, like secret-box — no new secret to manage,
 * domain-separated from JWT signing. Rotating JWT_SECRET retires every earlier export.
 * Resolved lazily (bundled module init runs before dotenv).
 */
export const EXPORT_FORMAT = 'ah-ha-export'
export const EXPORT_VERSION = 1
const SIG_PREFIX = 'hmac-sha256:'

let keyCache: Buffer | null = null
function sealKey(): Buffer {
  if (keyCache) return keyCache
  const base = process.env['JWT_SECRET']
  if (!base || base.length < 32) throw new Error('JWT_SECRET required to seal exports')
  keyCache = Buffer.from(hkdfSync('sha256', Buffer.from(base, 'utf8'), Buffer.alloc(0), Buffer.from('aha-export-seal-v1'), 32))
  return keyCache
}

/** JSON with keys sorted at every level and no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

function mac(body: Record<string, unknown>): string {
  return createHmac('sha256', sealKey()).update(canonical(body)).digest('hex')
}

/** Adds the seal. `body` is the plain (already EJSON-serialized) export without a signature. */
export function seal(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, signature: SIG_PREFIX + mac(body) }
}

/** True when `file` (parsed JSON) carries a valid seal over everything else in it. */
export function verifySeal(file: Record<string, unknown>): boolean {
  const sig = file['signature']
  if (typeof sig !== 'string' || !sig.startsWith(SIG_PREFIX)) return false
  const { signature: _drop, ...body } = file
  const got = Buffer.from(sig.slice(SIG_PREFIX.length), 'utf8')
  const want = Buffer.from(mac(body), 'utf8')
  return got.length === want.length && timingSafeEqual(got, want)
}

/**
 * Rewrites one imported document for its new home. Every id the export defined (the
 * exporter's own user id included) is in `ids` as hex → replacement, and every space ref
 * in `refs`. ObjectIds and id-shaped strings are swapped wherever they appear — owner,
 * org, space_id, column_id, list_id, contexts[].entity_id, table cell keys — and refs
 * (`user/type/slug`, `…#card_<id>`, `…#entry_<uuid>`) get the new space and item ids.
 */
export function remap(v: unknown, ids: Map<string, string>, refs: Map<string, string>): unknown {
  if (v instanceof ObjectId) {
    const to = ids.get(v.toHexString())
    return to ? new ObjectId(to) : v
  }
  if (v instanceof Date || v === null || typeof v !== 'object') {
    return typeof v === 'string' ? remapString(v, ids, refs) : v
  }
  if (Array.isArray(v)) return v.map(x => remap(x, ids, refs))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[ids.get(k) ?? k] = remap(x, ids, refs)
  return out
}

function remapString(s: string, ids: Map<string, string>, refs: Map<string, string>): string {
  const id = ids.get(s)
  if (id) return id
  const hash = s.indexOf('#')
  const base = hash === -1 ? s : s.slice(0, hash)
  const ref = refs.get(base)
  if (!ref) return s
  if (hash === -1) return ref
  const m = /^(card|entry)_(.+)$/.exec(s.slice(hash + 1))
  return m ? `${ref}#${m[1]}_${ids.get(m[2]!) ?? m[2]}` : `${ref}${s.slice(hash)}`
}
