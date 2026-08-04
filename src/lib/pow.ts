import { randomBytes, createHash } from 'node:crypto'
import type { Redis } from 'ioredis'

// 16 bits averages ~1-2s to solve client-side via Web Crypto (~50k hash/s) —
// enough to make bulk abuse costly without making real users wait.
const DIFFICULTY_BITS = parseInt(process.env['POW_DIFFICULTY_BITS'] ?? '16', 10)
const TTL = 120 // seconds a challenge stays valid

function leadingZeroBits(buf: Buffer): number {
  let bits = 0
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue }
    let b = byte
    while ((b & 0x80) === 0) { bits++; b = (b << 1) & 0xff }
    break
  }
  return bits
}

export async function issueChallenge(redis: Redis): Promise<{ challenge: string; difficulty: number }> {
  const challenge = randomBytes(16).toString('hex')
  await redis.setex(`pow:${challenge}`, TTL, '1')
  return { challenge, difficulty: DIFFICULTY_BITS }
}

// Single-use: the challenge is deleted on first verification attempt, valid or not,
// so a rejected solve can't be retried and a valid one can't be replayed.
export async function verifyPow(redis: Redis, challenge: string, nonce: string): Promise<boolean> {
  if (!challenge || !nonce) return false
  const key = `pow:${challenge}`
  const exists = await redis.get(key)
  await redis.del(key)
  if (!exists) return false

  const hash = createHash('sha256').update(challenge + nonce).digest()
  return leadingZeroBits(hash) >= DIFFICULTY_BITS
}
