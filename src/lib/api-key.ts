import argon2 from 'argon2'
import { nanoid } from 'nanoid'
import type { Db, ObjectId } from 'mongodb'

const PREFIX_LEN = 18

export function generateRawKey(): string {
  return `aha_live_${nanoid(32)}`
}

export async function hashKey(raw: string): Promise<{ hash: string; prefix: string }> {
  const hash = await argon2.hash(raw)
  const prefix = raw.slice(0, PREFIX_LEN) + '...'
  return { hash, prefix }
}

export async function validateApiKey(db: Db, incoming: string) {
  const prefix = incoming.slice(0, PREFIX_LEN) + '...'
  const key = await db.collection('api_keys').findOne({
    prefix,
    revoked_at: { $exists: false },
  })
  if (!key) return null
  const valid = await argon2.verify(key['hash'] as string, incoming)
  if (!valid) return null
  return key as {
    _id: ObjectId
    user_id: ObjectId
    org_id: ObjectId
    plan: string
    username: string
    scope: string
    access: string
  }
}
