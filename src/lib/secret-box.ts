import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto'

/**
 * Encrypt BYO third-party secrets (user Anthropic API keys) at rest — CWE-312.
 *
 * AES-256-GCM with a key derived from JWT_SECRET via HKDF-SHA256 under a
 * dedicated info label, so there is no new secret to manage and the encryption
 * key is domain-separated from JWT signing. Resolved lazily (the bundler runs
 * module init before dotenv — see incident_ahha_dotenv_bundler_hoisting).
 *
 * Stored form: `encv1:` + base64(iv[12] ‖ tag[16] ‖ ciphertext).
 * Legacy plaintext (no prefix) is returned as-is by openSecret and gets
 * migrated to ciphertext the next time the value is written.
 */
const PREFIX = 'encv1:'
let keyCache: Buffer | null = null

function encKey(): Buffer {
  if (keyCache) return keyCache
  const base = process.env['JWT_SECRET']
  if (!base || base.length < 32) throw new Error('JWT_SECRET required for secret-box')
  keyCache = Buffer.from(hkdfSync('sha256', Buffer.from(base, 'utf8'), Buffer.alloc(0), Buffer.from('aha-user-apikey-v1'), 32))
  return keyCache
}

/** Encrypt a plaintext secret for storage. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypt a stored secret; legacy plaintext (no prefix) passes through; bad input → null. */
export function openSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null
  if (!stored.startsWith(PREFIX)) return stored
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const d = createDecipheriv('aes-256-gcm', encKey(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
