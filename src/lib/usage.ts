import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import { getPool } from './timescale.js'
import { limitMode, limitsFor, over, type Grants, type Limits } from './plans.js'

/**
 * How much of their plan an account uses (KB #2160): spaces, storage, AI calls this month.
 * Counts and sizes only — nothing here reads what anyone wrote.
 *
 * AI calls are counted per calendar month (UTC) in `ai_usage`, split by whose key paid.
 * Storage is the BSON size of the account's documents plus its trail rows, measured at most
 * hourly and cached in `usage` (it's a scan, too slow to run on every request).
 */
const STORAGE_TTL_MS = 3600_000
const STORAGE_COLLECTIONS = [
  'spaces', 'board_columns', 'board_cards', 'list_items', 'note_content', 'table_columns', 'table_rows',
  'entities', 'links', 'nfc_tags', 'trackers', 'statuses', 'mqtt_subscriptions', 'webhooks', 'push_messages',
]

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7)

/** Counts one AI call. Fire-and-forget: metering must never break the feature. */
export function recordAi(fastify: FastifyInstance, orgId: ObjectId, own: boolean): void {
  fastify.mongo.collection('ai_usage').updateOne(
    { org_id: orgId, month: monthKey() },
    { $inc: { [own ? 'own_key' : 'server_key']: 1 }, $set: { updated_at: new Date() } },
    { upsert: true },
  ).catch(err => fastify.log.warn({ err }, 'ai usage not recorded'))
}

/** Bytes the account takes up; re-measured when the cached figure is over an hour old. */
export async function storageBytes(fastify: FastifyInstance, orgId: ObjectId, opts: { fresh?: boolean } = {}): Promise<{ bytes: number; measured_at: Date }> {
  const cache = fastify.mongo.collection('usage')
  const hit = await cache.findOne({ _id: orgId })
  if (hit && !opts.fresh && Date.now() - (hit['measured_at'] as Date).getTime() < STORAGE_TTL_MS) {
    return { bytes: hit['storage_bytes'] as number, measured_at: hit['measured_at'] as Date }
  }
  let bytes = 0
  for (const c of STORAGE_COLLECTIONS) {
    const [r] = await fastify.mongo.collection(c).aggregate<{ n: number }>([
      { $match: { org_id: orgId } }, { $group: { _id: null, n: { $sum: { $bsonSize: '$$ROOT' } } } },
    ]).toArray()
    bytes += r?.n ?? 0
  }
  if (process.env['TIMESCALE_URI']) {
    const { rows } = await getPool().query<{ n: string | null }>('SELECT sum(pg_column_size(t.*)) AS n FROM trail_entries t WHERE org_id = $1', [orgId.toString()])
    bytes += Number(rows[0]?.n ?? 0)
  }
  const measured_at = new Date()
  await cache.updateOne({ _id: orgId }, { $set: { storage_bytes: bytes, measured_at } }, { upsert: true })
  return { bytes, measured_at }
}

export interface Usage {
  plan: string
  mode: ReturnType<typeof limitMode>
  limits: Limits
  grants: Grants
  used: { spaces: number; storage_bytes: number; storage_measured_at: Date; ai_calls: number; own_key_ai_calls: number }
  over: { spaces: boolean; storage: boolean; ai_calls: boolean }
}

export async function usageFor(fastify: FastifyInstance, orgId: ObjectId, opts: { fresh?: boolean } = {}): Promise<Usage> {
  const [user, spaces, ai, storage] = await Promise.all([
    fastify.mongo.collection('users').findOne({ _id: orgId }, { projection: { plan: 1, grants: 1 } }),
    fastify.mongo.collection('spaces').countDocuments({ org_id: orgId, deleted_at: { $exists: false } }),
    fastify.mongo.collection('ai_usage').findOne({ org_id: orgId, month: monthKey() }),
    storageBytes(fastify, orgId, opts),
  ])
  const plan = (user?.['plan'] as string) ?? 'free'
  const grants = (user?.['grants'] as Grants) ?? {}
  const limits = limitsFor(plan, grants)
  const aiCalls = (ai?.['server_key'] as number) ?? 0
  const mb = storage.bytes / (1024 * 1024)
  return {
    plan, mode: limitMode(), limits, grants,
    used: { spaces, storage_bytes: storage.bytes, storage_measured_at: storage.measured_at, ai_calls: aiCalls, own_key_ai_calls: (ai?.['own_key'] as number) ?? 0 },
    over: { spaces: over(spaces, limits.spaces), storage: over(mb, limits.storage_mb), ai_calls: over(aiCalls, limits.ai_calls) },
  }
}

/** Under `PLAN_LIMITS=enforce`, the reason this account can't do [what], if it can't. */
export async function blockedBy(fastify: FastifyInstance, orgId: ObjectId, what: 'space' | 'write' | 'server_ai'): Promise<string | null> {
  if (limitMode() !== 'enforce') return null
  const u = await usageFor(fastify, orgId)
  if (what === 'space' && u.over.spaces) return `Your plan includes ${u.limits.spaces} spaces`
  if ((what === 'space' || what === 'write') && u.over.storage) return `Your plan includes ${u.limits.storage_mb} MB of storage`
  if (what === 'server_ai' && u.over.ai_calls) return `Your plan includes ${u.limits.ai_calls} AI uses a month`
  return null
}
