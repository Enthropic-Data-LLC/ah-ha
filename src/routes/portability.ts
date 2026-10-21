import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { BSON, ObjectId, type Document } from 'mongodb'
import { nanoid } from 'nanoid'
import { getPool } from '../lib/timescale.js'
import { hashEntry } from './trail.js'
import { EXPORT_FORMAT, EXPORT_VERSION, seal, verifySeal, remap } from '../lib/portable.js'

const { EJSON } = BSON

/**
 * GET /api/export  — everything an account holds, as one sealed file (src/lib/portable.ts).
 * POST /api/import — the same file back into the signed-in account, as new copies.
 *
 * Both are session-only (auth.ts) and IP-limited (api.ts). Export is a read, so a disabled
 * account can still take its data with it; import is a write, so it can't.
 *
 * Left out of the file: API keys, share links, the audit log, phone inbox messages and the
 * account's own AI key. Secrets that would let the file act as the account are dropped too
 * (webhook secrets, entity presence tokens) and made fresh on import.
 */

/** Collections exported, in import order (spaces first: everything else hangs off them). */
const COLLECTIONS = [
  'spaces', 'board_columns', 'board_cards', 'list_items', 'note_content', 'table_columns', 'table_rows',
  'entities', 'links', 'nfc_tags', 'trackers', 'statuses', 'mqtt_subscriptions', 'webhooks',
  'calendar_sources', 'notification_prefs',
] as const
type Coll = typeof COLLECTIONS[number]
const BY_USER: ReadonlySet<Coll> = new Set(['calendar_sources', 'notification_prefs'])
const IN_SPACE: ReadonlySet<Coll> = new Set(['board_columns', 'board_cards', 'list_items', 'note_content', 'table_columns', 'table_rows'])
const REDACT: Partial<Record<Coll, string[]>> = { entities: ['presence_token'], webhooks: ['secret'] }
const SLUG_MAX = 64

interface TrailRow { id: string; space_ref: string; ts: Date; text: string; tone: string; source: string; tags: string[]; meta: unknown; created_by: string | null }

const portabilityRoutes: FastifyPluginAsync = async (fastify) => {
  const db = () => fastify.mongo

  fastify.get('/api/export', { preHandler: fastify.authenticate }, async (req, reply) => {
    const me = req.user!
    const user = await db().collection('users').findOne({ _id: me.id }, { projection: { email: 1, username: 1, plan: 1, created_at: 1, settings: 1 } })
    const live = { deleted_at: { $exists: false } }

    const data: Record<string, Document[]> = {}
    for (const c of COLLECTIONS) {
      data[c] = await db().collection(c).find(BY_USER.has(c) ? { user_id: me.id } : { org_id: me.orgId, ...live }).toArray()
    }
    // Content of a space that was deleted goes with it.
    const spaceIds = new Set(data['spaces']!.map(s => String(s['_id'])))
    for (const c of IN_SPACE) data[c] = data[c]!.filter(d => spaceIds.has(String(d['space_id'])))
    for (const [c, fields] of Object.entries(REDACT)) for (const d of data[c]!) for (const f of fields) delete d[f]

    const trailRefs = data['spaces']!.filter(s => s['type'] === 'trail').map(s => s['ref'] as string)
    const trail = trailRefs.length && process.env['TIMESCALE_URI']
      ? (await getPool().query<TrailRow>(
          `SELECT id::text, space_ref, ts, text, tone, source, tags, meta, created_by
             FROM trail_entries WHERE org_id = $1 AND space_ref = ANY($2) ORDER BY ts`,
          [me.orgId.toString(), trailRefs],
        )).rows
      : []

    const body = EJSON.serialize({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      export_id: randomUUID(),
      exported_at: new Date(),
      account: { id: me.id, username: user?.['username'] ?? null, email: user?.['email'] ?? null, plan: user?.['plan'] ?? 'free', created_at: user?.['created_at'] ?? null, settings: user?.['settings'] ?? {} },
      data: { ...data, trail_entries: trail },
    }, { relaxed: true }) as Record<string, unknown>

    fastify.audit({ actor_id: me.id, actor_type: 'user', action: 'account.export', resource_ref: `export:${body['export_id'] as string}`, org_id: me.orgId, ip: req.ip })
    const day = new Date().toISOString().slice(0, 10)
    reply.header('content-disposition', `attachment; filename="ah-ha-${user?.['username'] ?? 'export'}-${day}.json"`)
    reply.header('cache-control', 'no-store')
    return seal(body)
  })

  fastify.post('/api/import', { preHandler: fastify.authenticate, bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    const me = req.user!
    const bad = (message: string, code = 'BAD_EXPORT') => reply.status(400).send({ data: null, error: { code, message } })

    const file = req.body as Record<string, unknown> | null
    if (!file || typeof file !== 'object' || file['format'] !== EXPORT_FORMAT) return bad('That isn’t an Ah-Ha export file')
    if (file['version'] !== EXPORT_VERSION) return bad('This export is from a version this server can’t read')
    if (!verifySeal(file)) return bad('This file isn’t an unmodified Ah-Ha export from this server, so it can’t be imported')
    if (!me.username) return bad('Pick a username before importing', 'NO_USERNAME')

    // Claimed before anything is written (unique index in db.ts), so the same file can't land twice.
    const exportId = String(file['export_id'])
    const imports = db().collection('imports')
    const claim = await imports.insertOne({ org_id: me.orgId, user_id: me.id, export_id: exportId, exported_at: file['exported_at'], started_at: new Date() })
      .catch((err: { code?: number }) => { if (err.code === 11000) return null; throw err })
    if (!claim) return reply.status(409).send({ data: null, error: { code: 'ALREADY_IMPORTED', message: 'This export has already been imported into this account' } })

    const parsed = EJSON.deserialize(file) as { account: { id: ObjectId }; data: Record<string, Document[]> & { trail_entries: TrailRow[] } }
    const data = parsed.data
    const docs = (c: Coll) => data[c] ?? []

    // Every id the export defined gets a fresh one; the exporter becomes the importer.
    const ids = new Map<string, string>([[parsed.account.id.toHexString(), me.id.toHexString()]])
    for (const c of COLLECTIONS) for (const d of docs(c)) ids.set(String(d['_id']), new ObjectId().toHexString())
    for (const t of data.trail_entries ?? []) ids.set(t.id, randomUUID())

    // Spaces keep their slug unless this account already has one; then slug-2, slug-3, ….
    const refs = new Map<string, string>()
    const slugs = new Map<string, string>() // "type/oldSlug" → new slug
    for (const s of docs('spaces')) {
      const type = s['type'] as string
      const want = String(s['slug'])
      let slug = want
      for (let n = 2; await db().collection('spaces').findOne({ ref: `${me.username}/${type}/${slug}` }); n++) {
        slug = `${want.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`
      }
      refs.set(s['ref'] as string, `${me.username}/${type}/${slug}`)
      slugs.set(`${type}/${want}`, slug)
      s['slug'] = slug
    }

    const mark = { export_id: exportId, at: new Date() }
    const prepared = new Map<Coll, Document[]>()
    const skipped: string[] = []
    for (const c of COLLECTIONS) {
      let list: Document[] = docs(c).map(d => ({ ...(remap(d, ids, refs) as Document), imported: mark }))
      if (c === 'entities') list = list.map(e => ({ ...e, presence_token: new ObjectId().toHexString() }))
      if (c === 'webhooks') list = list.map(w => ({ ...w, id: nanoid(24), secret: nanoid(32), last_received_at: null, receive_count: 0 }))
      if (c === 'trackers') list = list.map(t => {
        const trail = (t['match'] as { trail?: string } | undefined)?.trail
        return trail ? { ...t, match: { ...(t['match'] as object), trail: slugs.get(`trail/${trail}`) ?? trail } } : t
      })
      if (c === 'nfc_tags') {
        // A tag id is printed on a physical tag and belongs to one account at a time.
        const taken = new Set((await db().collection('nfc_tags').find({ tag_id: { $in: list.map(t => t['tag_id']) }, deleted_at: { $exists: false } }).project({ tag_id: 1 }).toArray()).map(t => t['tag_id'] as string))
        for (const t of list) if (taken.has(t['tag_id'] as string)) skipped.push(`NFC tag “${t['name'] as string}” (already in use)`)
        list = list.filter(t => !taken.has(t['tag_id'] as string)).map(t => {
          const a = t['action'] as { type?: string; space_slug?: string } | undefined
          return a?.type === 'trail' && a.space_slug ? { ...t, action: { ...a, space_slug: slugs.get(`trail/${a.space_slug}`) ?? a.space_slug } } : t
        })
      }
      if (c === 'statuses') {
        const have = new Set((await db().collection('statuses').find({ org_id: me.orgId }).project({ key: 1 }).toArray()).map(s => s['key'] as string))
        list = list.filter(s => !have.has(s['key'] as string))
      }
      if (c === 'notification_prefs' && await db().collection('notification_prefs').findOne({ user_id: me.id })) {
        if (list.length) skipped.push('notification settings (this account already has its own)')
        list = []
      }
      prepared.set(c, list)
    }

    // Trail entries: new ids, original times, and each trail's hash chain rebuilt for its new ref.
    const byRef = new Map<string, TrailRow[]>()
    for (const t of data.trail_entries ?? []) {
      const ref = refs.get(t.space_ref)
      if (!ref) continue
      const row = { ...t, id: ids.get(t.id)!, space_ref: ref, created_by: t.created_by ? (ids.get(t.created_by) ?? t.created_by) : null, meta: remap(t.meta, ids, refs) }
      byRef.set(ref, [...(byRef.get(ref) ?? []), row])
    }

    const insertedTrail: string[] = []
    try {
      for (const c of COLLECTIONS) {
        const list = prepared.get(c)!
        if (list.length) await db().collection(c).insertMany(list, { ordered: true })
      }
      if (byRef.size) {
        const pool = getPool()
        for (const [ref, rows] of byRef) {
          rows.sort((a, b) => +new Date(a.ts) - +new Date(b.ts))
          let prev = hashEntry('genesis', new Date(0), ref)
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500)
            const vals: unknown[] = []
            const tuples = chunk.map(r => {
              const ts = new Date(r.ts)
              vals.push(r.id, ref, me.orgId.toString(), ts, r.text, r.tone, r.source, r.tags ?? [], JSON.stringify(r.meta ?? {}), r.created_by, prev)
              prev = hashEntry(r.id, ts, r.text)
              const b = vals.length - 11
              return `($${b + 1}::uuid,$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::jsonb,$${b + 10},$${b + 11})`
            })
            await pool.query(`INSERT INTO trail_entries (id, space_ref, org_id, ts, text, tone, source, tags, meta, created_by, prev_hash) VALUES ${tuples.join(',')}`, vals)
            insertedTrail.push(...chunk.map(r => r.id))
          }
        }
      }
    } catch (err) {
      // All or nothing: take back whatever this import already wrote.
      req.log.error({ err, exportId }, 'import failed, rolling back')
      for (const c of COLLECTIONS) await db().collection(c).deleteMany({ 'imported.export_id': exportId, ...(BY_USER.has(c) ? { user_id: me.id } : { org_id: me.orgId }) }).catch(() => {})
      if (insertedTrail.length) await getPool().query('DELETE FROM trail_entries WHERE id = ANY($1::uuid[])', [insertedTrail]).catch(() => {})
      await imports.deleteOne({ _id: claim.insertedId }).catch(() => {})
      return reply.status(500).send({ data: null, error: { code: 'IMPORT_FAILED', message: 'The import failed and nothing was kept. Please try again.' } })
    }

    await imports.updateOne({ _id: claim.insertedId }, { $set: { imported_at: new Date() } })
    fastify.audit({ actor_id: me.id, actor_type: 'user', action: 'account.import', resource_ref: `export:${exportId}`, org_id: me.orgId, ip: req.ip })

    const counts = Object.fromEntries([...prepared].map(([c, l]) => [c, l.length]).filter(([, n]) => n))
    const renamed = [...refs].filter(([from, to]) => from.split('/').slice(1).join('/') !== to.split('/').slice(1).join('/')).map(([, to]) => to)
    return { data: { counts: { ...counts, trail_entries: insertedTrail.length }, renamed, skipped, webhooks_reissued: prepared.get('webhooks')!.length } }
  })
}

export default portabilityRoutes
