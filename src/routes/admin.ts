import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { getPool } from '../lib/timescale.js'
import { isAdminEmail } from '../lib/admin.js'
import { limitMode, limitsFor } from '../lib/plans.js'
import { monthKey, usageFor } from '../lib/usage.js'

/**
 * /api/admin/* — the operator's view across every account (KB #1302).
 *
 * Who is an admin is the ADMIN_EMAILS env allowlist, checked against the user's current email
 * on every request: nothing a user can write to their own record makes them one, and taking
 * an address out of the list takes effect at once (the JWT is not trusted for this).
 * Session only — an API key, whoever owns it, never reaches these routes. Anyone else gets
 * the same 404 as a route that does not exist.
 *
 * It shows accounts and how much they use the app, never what they wrote: space names and
 * counts yes, card/note/trail text no. Plan usage (lib/usage) is counts and bytes only.
 */
const PLANS = ['free', 'pro', 'team', 'iot', 'enterprise'] as const
const DAY = 86400_000

async function trailCounts(sinceDays: number, orgIds?: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!process.env['TIMESCALE_URI']) return out
  const args: unknown[] = [new Date(Date.now() - sinceDays * DAY)]
  let where = 'ts >= $1'
  if (orgIds) { args.push(orgIds); where += ' AND org_id = ANY($2)' }
  const { rows } = await getPool().query<{ org_id: string; n: string }>(
    `SELECT org_id, count(*) AS n FROM trail_entries WHERE ${where} GROUP BY org_id`, args,
  )
  for (const r of rows) out.set(r.org_id, Number(r.n))
  return out
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    await fastify.authenticate(req, reply)
    if (reply.sent) return
    const notFound = () => reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Not found' } })
    if (req.apiKeyId) return notFound()
    const me = await fastify.mongo.collection('users').findOne({ _id: req.user!.id }, { projection: { email: 1 } })
    if (!isAdminEmail(me?.['email'] as string | undefined)) return notFound()
  }

  const users = () => fastify.mongo.collection('users')
  const live = { deleted_at: { $exists: false } }

  // GET /api/admin/overview — totals for the dashboard tiles
  fastify.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    const now = Date.now()
    const [total, new7, new30, signedIn7, plans, spaces, trail7, trail30, ai] = await Promise.all([
      users().countDocuments(),
      users().countDocuments({ created_at: { $gte: new Date(now - 7 * DAY) } }),
      users().countDocuments({ created_at: { $gte: new Date(now - 30 * DAY) } }),
      users().countDocuments({ last_seen: { $gte: new Date(now - 7 * DAY) } }),
      users().aggregate<{ _id: string | null; n: number }>([{ $group: { _id: '$plan', n: { $sum: 1 } } }]).toArray(),
      fastify.mongo.collection('spaces').aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$type', n: { $sum: 1 } } }]).toArray(),
      trailCounts(7).catch(() => null),
      trailCounts(30).catch(() => null),
      fastify.mongo.collection('ai_usage').aggregate<{ server_key: number; own_key: number }>([
        { $match: { month: monthKey() } }, { $group: { _id: null, server_key: { $sum: '$server_key' }, own_key: { $sum: '$own_key' } } },
      ]).toArray(),
    ])
    const sum = (m: Map<string, number> | null) => m ? [...m.values()].reduce((a, b) => a + b, 0) : null
    return { data: {
      users: { total, new_7d: new7, new_30d: new30, signed_in_7d: signedIn7 },
      plans: Object.fromEntries(plans.map(p => [p._id ?? 'free', p.n])),
      spaces: Object.fromEntries(spaces.map(s => [s._id, s.n])),
      trail_entries: { last_7d: sum(trail7), last_30d: sum(trail30) },
      ai_calls_month: { server_key: ai[0]?.server_key ?? 0, own_key: ai[0]?.own_key ?? 0 },
      limit_mode: limitMode(),
    } }
  })

  // GET /api/admin/users?q=&limit=&before= — newest first; q matches email or username
  fastify.get('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const p = z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      before: z.string().regex(/^[0-9a-f]{24}$/).optional(),
    }).parse(req.query)

    const filter: Record<string, unknown> = {}
    if (p.q) {
      // Literal substring, never a user-supplied regex.
      const esc = p.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter['$or'] = [{ email: { $regex: esc, $options: 'i' } }, { username: { $regex: esc, $options: 'i' } }]
    }
    if (p.before) filter['_id'] = { $lt: new ObjectId(p.before) }

    const rows = await users()
      .find(filter, { projection: { email: 1, username: 1, plan: 1, created_at: 1, last_seen: 1, onboarding_completed: 1, disabled_at: 1, grants: 1 } })
      .sort({ _id: -1 })
      .limit(p.limit + 1)
      .toArray()
    const has_more = rows.length > p.limit
    if (has_more) rows.pop()

    const ids = rows.map(u => u._id)
    const [spaceCounts, trail30, ai, stored] = await Promise.all([
      fastify.mongo.collection('spaces').aggregate<{ _id: ObjectId; n: number }>([
        { $match: { org_id: { $in: ids }, ...live } }, { $group: { _id: '$org_id', n: { $sum: 1 } } },
      ]).toArray(),
      trailCounts(30, ids.map(String)).catch(() => new Map<string, number>()),
      fastify.mongo.collection('ai_usage').find({ org_id: { $in: ids }, month: monthKey() }).toArray(),
      // Last measured size only: measuring is a scan, done when someone looks at an account.
      fastify.mongo.collection('usage').find({ _id: { $in: ids } }).toArray(),
    ])
    const spacesBy = new Map(spaceCounts.map(s => [String(s._id), s.n]))
    const aiBy = new Map(ai.map(a => [String(a['org_id']), (a['server_key'] as number) ?? 0]))
    const storedBy = new Map(stored.map(s => [String(s._id), s['storage_bytes'] as number]))

    return {
      data: rows.map(u => ({
        id: u._id,
        email: u['email'],
        username: u['username'] ?? null,
        plan: u['plan'] ?? 'free',
        created_at: u['created_at'] ?? null,
        last_seen: u['last_seen'] ?? null,
        onboarded: !!u['onboarding_completed'],
        admin: isAdminEmail(u['email'] as string | undefined),
        disabled_at: u['disabled_at'] ?? null,
        spaces: spacesBy.get(String(u._id)) ?? 0,
        trail_30d: trail30.get(String(u._id)) ?? 0,
        ai_calls_month: aiBy.get(String(u._id)) ?? 0,
        storage_bytes: storedBy.get(String(u._id)) ?? null,
        limits: limitsFor(u['plan'] as string | undefined, u['grants'] as never),
      })),
      meta: { has_more, before: has_more ? String(rows[rows.length - 1]!._id) : null },
    }
  })

  // GET /api/admin/users/:id — one account: its spaces, keys, recent actions, 30 days of activity
  fastify.get<{ Params: { id: string } }>('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = new ObjectId(req.params.id) // malformed → 400 via the central error handler
    const u = await users().findOne({ _id: id }, { projection: { email: 1, username: 1, plan: 1, created_at: 1, last_seen: 1, onboarding_completed: 1, disabled_at: 1, 'settings.timezone': 1, 'llm.provider': 1 } })
    if (!u) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'No such user' } })

    const db = fastify.mongo
    const [spaces, keys, actions, cards, items, usage] = await Promise.all([
      db.collection('spaces').find({ org_id: id, ...live }, { projection: { ref: 1, name: 1, type: 1, created_at: 1 } }).sort({ created_at: -1 }).toArray(),
      db.collection('api_keys').find({ user_id: id }, { projection: { name: 1, prefix: 1, access: 1, last_used: 1, created_at: 1, expires_at: 1, revoked_at: 1 } }).sort({ created_at: -1 }).toArray(),
      db.collection('audit_log').find({ org_id: id }, { projection: { action: 1, resource_ref: 1, actor_type: 1, ts: 1 } }).sort({ seq: -1 }).limit(25).toArray(),
      db.collection('board_cards').countDocuments({ created_by: id }),
      db.collection('list_items').countDocuments({ created_by: id }),
      usageFor(fastify, id, { fresh: true }),
    ])

    // Entries per day, not the entries: how much they use it, not what they wrote.
    let activity: { day: string; n: number }[] | null = null
    if (process.env['TIMESCALE_URI']) {
      activity = await getPool().query<{ day: string; n: string }>(
        `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day, count(*) AS n
           FROM trail_entries WHERE org_id = $1 AND ts >= $2 GROUP BY 1 ORDER BY 1`,
        [String(id), new Date(Date.now() - 30 * DAY)],
      ).then(r => r.rows.map(x => ({ day: x.day, n: Number(x.n) }))).catch(() => null)
    }

    return { data: {
      id: u._id,
      email: u['email'],
      username: u['username'] ?? null,
      plan: u['plan'] ?? 'free',
      created_at: u['created_at'] ?? null,
      last_seen: u['last_seen'] ?? null,
      onboarded: !!u['onboarding_completed'],
      admin: isAdminEmail(u['email'] as string | undefined),
      disabled_at: u['disabled_at'] ?? null,
      timezone: (u['settings'] as { timezone?: string } | undefined)?.timezone ?? null,
      own_ai_key: !!(u['llm'] as { provider?: string } | undefined)?.provider,
      counts: { cards, list_items: items },
      usage,
      spaces: spaces.map(s => ({ ref: s['ref'], name: s['name'], type: s['type'], created_at: s['created_at'] })),
      keys: keys.map(k => ({ name: k['name'], prefix: k['prefix'], access: k['access'] ?? 'full', created_at: k['created_at'], last_used: k['last_used'], expires_at: k['expires_at'], revoked: !!k['revoked_at'] })),
      recent_actions: actions.map(a => ({ action: a['action'], resource_ref: a['resource_ref'], via: a['actor_type'], ts: a['ts'] })),
      trail_by_day: activity,
    } }
  })

  // PATCH /api/admin/users/:id { plan?, disabled? } — change an account's plan, or disable it
  // (read-only: it can sign in, look and export, and nothing runs for it) and enable it again.
  // A new plan reaches an existing session token when that token is next issued; disabling
  // takes effect on the next request (auth.ts reads the flag every time).
  fastify.patch<{ Params: { id: string } }>('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = new ObjectId(req.params.id)
    const extra = z.number().int().min(0).max(1_000_000)
    const body = z.object({
      plan: z.enum(PLANS).optional(),
      disabled: z.boolean().optional(),
      // Extra allowance on top of the plan (lib/plans): monthly for AI, standing for the rest. 0 removes it.
      grants: z.object({ spaces: extra.optional(), storage_mb: extra.optional(), ai_calls: extra.optional() }).strict().optional(),
    })
      .strict()
      .refine(b => b.plan !== undefined || b.disabled !== undefined || b.grants !== undefined, 'Nothing to change')
      .parse(req.body)
    const before = await users().findOne({ _id: id }, { projection: { plan: 1, email: 1, disabled_at: 1, grants: 1 } })
    if (!before) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'No such user' } })
    // Admins come from ADMIN_EMAILS; locking one out (yourself included) is done there, not here.
    if (body.disabled && isAdminEmail(before['email'] as string | undefined)) {
      return reply.status(400).send({ data: null, error: { code: 'ADMIN', message: 'An admin can’t be disabled here — take the address out of ADMIN_EMAILS instead' } })
    }

    const set: Record<string, unknown> = {}
    const unset: Record<string, ''> = {}
    if (body.plan !== undefined) set['plan'] = body.plan
    if (body.disabled === true && !before['disabled_at']) { set['disabled_at'] = new Date(); set['disabled_by'] = req.user!.id }
    if (body.disabled === false) { unset['disabled_at'] = ''; unset['disabled_by'] = '' }
    for (const [k, v] of Object.entries(body.grants ?? {})) {
      if (v) set[`grants.${k}`] = v
      else unset[`grants.${k}`] = ''
    }
    await users().updateOne({ _id: id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) })

    // Same hash-chained log as everything else, filed under the admin's org with the target in the ref.
    const audit = (action: string, ref: string) => fastify.audit({
      actor_id: req.user!.id, actor_type: 'user', action, resource_ref: ref, org_id: req.user!.orgId, ip: req.ip,
    })
    if (body.plan !== undefined && body.plan !== before['plan']) audit('admin.user.plan', `user:${id}:${(before['plan'] as string) ?? 'free'}->${body.plan}`)
    if (body.disabled === true && !before['disabled_at']) audit('admin.user.disable', `user:${id}`)
    if (body.disabled === false && before['disabled_at']) audit('admin.user.enable', `user:${id}`)
    if (body.grants) audit('admin.user.grants', `user:${id}:${Object.entries(body.grants).map(([k, v]) => `${k}=${v}`).join(',')}`)

    const after = await users().findOne({ _id: id }, { projection: { plan: 1, disabled_at: 1, grants: 1 } })
    return { data: { id, plan: after?.['plan'] ?? 'free', disabled_at: after?.['disabled_at'] ?? null, grants: after?.['grants'] ?? {} } }
  })
}

export default adminRoutes
