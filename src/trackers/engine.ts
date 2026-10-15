import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import { EVENTS, emit, type AhEvent } from '../link/engine.js'
import { getPool } from '../lib/timescale.js'
import { pushTo } from '../push/hub.js'
import { matches, render, type Entry, type TrackerBody } from './match.js'

/** Notifications per tracker per hour, so a chatty source can't flood the phone. */
const NOTIFY_PER_HOUR = 30

export type StoredTracker = TrackerBody & { _id: ObjectId; org_id: ObjectId; owner_id: ObjectId }

export async function ownerTz(fastify: FastifyInstance, userId: ObjectId): Promise<string> {
  const p = await fastify.mongo.collection('notification_prefs').findOne({ user_id: userId })
  return ((p?.['daily_briefing'] as { timezone?: string } | undefined)?.timezone) || 'America/New_York'
}

/**
 * Sets a status from a matching entry. A newer entry with the same value keeps the
 * original `since` ("home since 5:42"); an entry older than the status is ignored, so
 * back-filling and out-of-order arrivals can't roll it back. Returns the previous value
 * when the value changed, undefined otherwise.
 */
export async function setStatus(fastify: FastifyInstance, t: StoredTracker, e: Entry, tz: string): Promise<{ prev: string | null } | undefined> {
  if (!t.status) return
  const col = fastify.mongo.collection('statuses')
  const key = t.status.label.trim().toLowerCase()
  const value = render(t.status.value, e, tz) || t.status.value
  const at = new Date(e.ts)
  const cur = await col.findOne({ org_id: t.org_id, key })
  if (cur && (cur['last_at'] as Date) > at) return
  const same = cur && String(cur['value']).toLowerCase() === value.toLowerCase()
  await col.updateOne({ org_id: t.org_id, key }, {
    $set: {
      label: t.status.label.trim(), value, detail: e.text, last_at: at, today: t.status.today,
      tracker_id: t._id, entry_id: e.id, ...(same ? {} : { since: at, prev: cur ? cur['value'] : null }),
    },
    $setOnInsert: { org_id: t.org_id, key, created_at: new Date() },
  }, { upsert: true })
  return same ? undefined : { prev: cur ? String(cur['value']) : null }
}

/** Recent trail entries for an org (newest first), for back-filling a status and for "test". */
export async function recentEntries(orgId: ObjectId, days = 14, limit = 1000): Promise<Entry[]> {
  const r = await getPool().query<{ id: string; text: string; source: string; tags: string[]; meta: Record<string, unknown>; ts: Date; space_ref: string }>(
    `SELECT id, text, source, tags, meta, ts, space_ref FROM trail_entries
      WHERE org_id = $1 AND ts > now() - ($2 || ' days')::interval ORDER BY ts DESC LIMIT $3`,
    [orgId.toString(), String(days), limit])
  return r.rows.map(x => ({ id: String(x.id), text: x.text, source: x.source, tags: x.tags ?? [], meta: x.meta ?? {}, ts: new Date(x.ts).toISOString(), space_ref: x.space_ref }))
}

/** Watches `aha:events` for trail entries and runs every matching tracker. */
export function startTrackers(fastify: FastifyInstance) {
  const log = fastify.log.child({ mod: 'trackers' })
  const sub = fastify.redis.duplicate()

  async function fire(t: StoredTracker, e: Entry) {
    const tz = await ownerTz(fastify, t.owner_id)
    const changed = await setStatus(fastify, t, e, tz)
    if (changed && t.status) {
      const s = await fastify.mongo.collection('statuses').findOne({ org_id: t.org_id, key: t.status.label.trim().toLowerCase() })
      emit(fastify.redis, { kind: 'status', org_id: t.org_id.toString(), label: t.status.label.trim(), value: String(s?.['value'] ?? ''), prev: changed.prev })
    }
    if (t.notify) {
      const hour = new Date().toISOString().slice(0, 13)
      const k = `aha:trackers:rate:${t._id}:${hour}`
      const n = await fastify.redis.incr(k)
      if (n === 1) await fastify.redis.expire(k, 3700)
      if (n <= NOTIFY_PER_HOUR) {
        await pushTo(fastify, t.owner_id, t.org_id, {
          title: render(t.notify.text, e, tz) || t.name,
          body: e.text,
          tracker_id: t._id.toString(), entry_id: e.id,
        })
      } else log.warn({ tracker: String(t._id) }, 'notify limit reached')
    }
    await fastify.mongo.collection('trackers').updateOne({ _id: t._id }, { $set: { last_fired_at: new Date() }, $inc: { fired: 1 } })
  }

  async function onEvent(ev: AhEvent) {
    if (ev.kind !== 'trail') return
    const m = ev.entry.meta ?? {}
    if (typeof m['type'] === 'string' && m['type'].startsWith('ah-link/')) return // Link's run records
    const list = await fastify.mongo.collection<StoredTracker>('trackers').find({ org_id: new ObjectId(ev.org_id), on: true }).toArray()
    for (const t of list) {
      if (!matches(t.match, ev.entry)) continue
      fire(t, ev.entry).catch(err => log.error({ err, tracker: String(t._id) }, 'tracker failed'))
    }
  }

  sub.subscribe(EVENTS).catch(err => log.error({ err }, 'subscribe failed'))
  sub.on('message', (_ch, msg) => {
    let ev: AhEvent
    try { ev = JSON.parse(msg) as AhEvent } catch { return }
    onEvent(ev).catch(err => log.error({ err }, 'event failed'))
  })
  fastify.addHook('onClose', async () => { await sub.quit().catch(() => {}) })
  log.info('trackers started')
}
