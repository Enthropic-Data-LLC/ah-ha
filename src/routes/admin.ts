import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { getPool } from '../lib/timescale.js'
import { isAdminEmail } from '../lib/admin.js'

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
 * counts yes, card/note/trail text no.
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
    const [total, new7, new30, signedIn7, plans, spaces, trail7, trail30] = await Promise.all([
      users().countDocuments(),
      users().countDocuments({ created_at: { $gte: new Date(now - 7 * DAY) } }),
      users().countDocuments({ created_at: { $gte: new Date(now - 30 * DAY) } }),
      users().countDocuments({ last_seen: { $gte: new Date(now - 7 * DAY) } }),
      users().aggregate<{ _id: string | null; n: number }>([{ $group: { _id: '$plan', n: { $sum: 1 } } }]).toArray(),
      fastify.mongo.collection('spaces').aggregate<{ _id: string; n: number }>([{ $match: live }, { $group: { _id: '$type', n: { $sum: 1 } } }]).toArray(),
      trailCounts(7).catch(() => null),
      trailCounts(30).catch(() => null),
    ])
    const sum = (m: Map<string, number> | null) => m ? [...m.values()].reduce((a, b) => a + b, 0) : null
    return { data: {
      users: { total, new_7d: new7, new_30d: new30, signed_in_7d: signedIn7 },
      plans: Object.fromEntries(plans.map(p => [p._id ?? 'free', p.n])),
      spaces: Object.fromEntries(spaces.map(s => [s._id, s.n])),
      trail_entries: { last_7d: sum(trail7), last_30d: sum(trail30) },
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
      .find(filter, { projection: { email: 1, username: 1, plan: 1, created_at: 1, last_seen: 1, onboarding_completed: 1 } })
      .sort({ _id: -1 })
      .limit(p.limit + 1)
      .toArray()
    const has_more = rows.length > p.limit
    if (has_more) rows.pop()

    const ids = rows.map(u => u._id)
    const [spaceCounts, trail30] = await Promise.all([
      fastify.mongo.collection('spaces').aggregate<{ _id: ObjectId; n: number }>([
        { $match: { org_id: { $in: ids }, ...live } }, { $group: { _id: '$org_id', n: { $sum: 1 } } },
      ]).toArray(),
      trailCounts(30, ids.map(String)).catch(() => new Map<string, number>()),
    ])
    const spacesBy = new Map(spaceCounts.map(s => [String(s._id), s.n]))

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
        spaces: spacesBy.get(String(u._id)) ?? 0,
        trail_30d: trail30.get(String(u._id)) ?? 0,
      })),
      meta: { has_more, before: has_more ? String(rows[rows.length - 1]!._id) : null },
    }
  })

  // GET /api/admin/users/:id — one account: its spaces, keys, recent actions, 30 days of activity
  fastify.get<{ Params: { id: string } }>('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = new ObjectId(req.params.id) // malformed → 400 via the central error handler
    const u = await users().findOne({ _id: id }, { projection: { email: 1, username: 1, plan: 1, created_at: 1, last_seen: 1, onboarding_completed: 1, 'settings.timezone': 1, 'llm.provider': 1 } })
    if (!u) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'No such user' } })

    const db = fastify.mongo
    const [spaces, keys, actions, cards, items] = await Promise.all([
      db.collection('spaces').find({ org_id: id, ...live }, { projection: { ref: 1, name: 1, type: 1, created_at: 1 } }).sort({ created_at: -1 }).toArray(),
      db.collection('api_keys').find({ user_id: id }, { projection: { name: 1, prefix: 1, access: 1, last_used: 1, created_at: 1, expires_at: 1, revoked_at: 1 } }).sort({ created_at: -1 }).toArray(),
      db.collection('audit_log').find({ org_id: id }, { projection: { action: 1, resource_ref: 1, actor_type: 1, ts: 1 } }).sort({ seq: -1 }).limit(25).toArray(),
      db.collection('board_cards').countDocuments({ created_by: id }),
      db.collection('list_items').countDocuments({ created_by: id }),
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
      timezone: (u['settings'] as { timezone?: string } | undefined)?.timezone ?? null,
      own_ai_key: !!(u['llm'] as { provider?: string } | undefined)?.provider,
      counts: { cards, list_items: items },
      spaces: spaces.map(s => ({ ref: s['ref'], name: s['name'], type: s['type'], created_at: s['created_at'] })),
      keys: keys.map(k => ({ name: k['name'], prefix: k['prefix'], access: k['access'] ?? 'full', created_at: k['created_at'], last_used: k['last_used'], expires_at: k['expires_at'], revoked: !!k['revoked_at'] })),
      recent_actions: actions.map(a => ({ action: a['action'], resource_ref: a['resource_ref'], via: a['actor_type'], ts: a['ts'] })),
      trail_by_day: activity,
    } }
  })

  // PATCH /api/admin/users/:id { plan } — change an account's plan. The plan in an existing
  // session token updates when that token is next issued (sign-in or username claim).
  fastify.patch<{ Params: { id: string } }>('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = new ObjectId(req.params.id)
    const body = z.object({ plan: z.enum(PLANS) }).strict().parse(req.body)
    const before = await users().findOneAndUpdate({ _id: id }, { $set: { plan: body.plan } }, { projection: { plan: 1 } })
    if (!before) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'No such user' } })
    // Same hash-chained log as everything else, filed under the admin's org with the target in the ref.
    fastify.audit({
      actor_id: req.user!.id,
      actor_type: 'user',
      action: 'admin.user.plan',
      resource_ref: `user:${id}:${(before['plan'] as string) ?? 'free'}->${body.plan}`,
      org_id: req.user!.orgId,
      ip: req.ip,
    })
    return { data: { id, plan: body.plan } }
  })
}

export default adminRoutes
