import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'
import { signJWT, verifyJWT } from '../lib/jwt.js'
import { validateApiKey } from '../lib/api-key.js'
import { verifyPow } from '../lib/pow.js'

/**
 * POST /api/feedback — from anyone. Each message becomes an entry on the site owner's
 * feedback trail (env FEEDBACK_TRAIL, "username/trail/slug"), written through the real
 * append route, so the hash chain holds and trackers see it ("💬 New feedback" → phone).
 * Signed-in people are known by their session or key; everyone else solves the same
 * proof-of-work as sign-in. Rate-limited per IP in api.ts.
 */
export const FEEDBACK_TYPE = 'ah-ha/feedback@1'

const body = z.object({
  message: z.string().trim().min(1, 'Write a message').max(4000),
  doing: z.string().trim().max(1000).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  page: z.string().max(300).optional(),
  challenge: z.string().max(64).optional(),
  nonce: z.string().max(64).optional(),
})

/** Who's sending, if anyone is signed in. Never fails: feedback works signed out too. */
async function sender(req: FastifyRequest): Promise<{ username: string } | null> {
  const cookie = req.cookies?.['aha_session']
  if (cookie) {
    const u = await verifyJWT(cookie).catch(() => null)
    if (u) return { username: u.username || String(u.id) }
  }
  const bearer = req.headers['authorization']?.replace('Bearer ', '')
  if (bearer?.startsWith('aha_live_')) {
    const k = await validateApiKey(req.server.mongo, bearer).catch(() => null)
    if (k) return { username: k.username || String(k.user_id) }
  }
  return null
}

const feedbackRoutes: FastifyPluginAsync = async (fastify) => {
  /** Signs in as the trail's owner and calls a route, like Ah! Link does. */
  async function asOwner(owner: Record<string, unknown>, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
    const token = await signJWT({ id: owner['_id'] as ObjectId, orgId: owner['_id'] as ObjectId, plan: (owner['plan'] as never) ?? 'free', username: String(owner['username'] ?? '') })
    return fastify.inject({ method, url, headers: { cookie: `aha_session=${token}` }, ...(payload ? { payload } : {}) })
  }

  fastify.post('/api/feedback', async (req, reply) => {
    const ref = process.env['FEEDBACK_TRAIL'] ?? ''
    const [username, kind, slug] = ref.split('/')
    if (!username || kind !== 'trail' || !slug) return reply.status(503).send({ error: 'Feedback isn’t set up yet — please email us instead' })

    const b = body.parse(req.body)
    const who = await sender(req)
    if (!who && !(await verifyPow(fastify.redis, b.challenge ?? '', b.nonce ?? ''))) {
      return reply.status(400).send({ error: 'Verification failed, please try again' })
    }

    const owner = await fastify.mongo.collection('users').findOne({ username })
    if (!owner) return reply.status(503).send({ error: 'Feedback isn’t set up yet — please email us instead' })
    // The trail is made the first time anyone sends feedback.
    if (!(await fastify.mongo.collection('spaces').findOne({ ref, deleted_at: { $exists: false } }))) {
      const made = await asOwner(owner, 'POST', '/api/spaces', { type: 'trail', name: 'Feedback', slug, description: 'Messages from the feedback form (ah-ha.app/feedback)' })
      if (made.statusCode >= 300) { req.log.error({ status: made.statusCode, body: made.body.slice(0, 200) }, 'feedback trail not created'); return reply.status(503).send({ error: 'Could not save that — please try again' }) }
    }

    const from = who ? `@${who.username}` : (b.email || 'a visitor')
    const first = b.message.replace(/\s+/g, ' ').slice(0, 140)
    const res = await asOwner(owner, 'POST', `/api/trail/${encodeURIComponent(slug)}/append`, {
      text: `💬 ${first}${b.message.length > 140 ? '…' : ''} — ${from}`,
      tone: 'neutral',
      source: 'feedback',
      tags: ['feedback', who ? 'member' : 'visitor'],
      meta: {
        type: FEEDBACK_TYPE, from, message: b.message,
        ...(b.doing ? { doing: b.doing } : {}),
        ...(!who && b.email ? { email: b.email } : {}),
        ...(b.page ? { page: b.page } : {}),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      },
    })
    if (res.statusCode >= 300) { req.log.error({ status: res.statusCode, body: res.body.slice(0, 200) }, 'feedback not saved'); return reply.status(503).send({ error: 'Could not save that — please try again' }) }
    reply.status(201)
    return { ok: true }
  })
}

export default feedbackRoutes
