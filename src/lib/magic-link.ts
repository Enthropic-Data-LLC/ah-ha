import { nanoid } from 'nanoid'
import type { Redis } from 'ioredis'

const TTL = parseInt(process.env['MAGIC_LINK_TTL'] ?? '900', 10)
const RATE_LIMIT = 3

export async function createMagicToken(redis: Redis, email: string, skipRateLimit = false): Promise<string> {
  if (!skipRateLimit) {
    const rateLimitKey = `ml:rate:${email}`
    const count = await redis.incr(rateLimitKey)
    if (count === 1) await redis.expire(rateLimitKey, 3600)
    if (count > RATE_LIMIT) {
      throw new Error('Too many magic links requested. Try again in an hour.')
    }
  }

  const token = nanoid(32)
  await redis.setex(`ml:token:${token}`, TTL, email)
  return token
}

export async function consumeMagicToken(redis: Redis, token: string): Promise<string | null> {
  const key = `ml:token:${token}`
  const email = await redis.get(key)
  if (!email) return null
  await redis.del(key)
  return email
}
