import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { ObjectId } from 'mongodb'
import { createMagicToken, consumeMagicToken } from '../lib/magic-link.js'
import { sendMagicLink } from '../lib/email.js'
import { signJWT } from '../lib/jwt.js'
import { seedStarterContent } from '../lib/seed-starter.js'
import { issueChallenge, verifyPow } from '../lib/pow.js'
import { sessionCookieOptions, webBaseFor } from '../lib/hosts.js'

const magicLinkBody = z.object({
  email: z.string().email().toLowerCase(),
  challenge: z.string(),
  nonce: z.string(),
})

// Top-level paths the web app owns; a user with one of these names would be unreachable at /:username.
const RESERVED_USERNAMES = new Set([
  'accessibility', 'android', 'api', 'assets', 'audit', 'auth', 'calendar', 'connect', 'download',
  'healthz', 'help', 'icons', 'keys', 'mqtt', 'now', 'onboarding', 'privacy', 'search', 'settings', 'spaces',
  'tags', 'terms', 'webhooks', 'feedback', 'trackers',
])

function devLinkAllowed(addr: string | undefined): boolean {
  if (process.env['ALLOW_DEV_LINK'] !== '1') return false
  if (process.env['NODE_ENV'] === 'production') return false
  const a = (addr ?? '').replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a.startsWith('192.168.10.')
}

/** Set the session. With COOKIE_DOMAIN the cookie covers both hosts, so drop any older host-only copy that would shadow it. */
function setSession(reply: FastifyReply, jwt: string) {
  if (process.env['COOKIE_DOMAIN']) reply.clearCookie('aha_session', { path: '/' })
  reply.setCookie('aha_session', jwt, sessionCookieOptions())
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /auth/pow-challenge — issue a proof-of-work puzzle the client must solve
  // before /auth/magic-link will accept a request (raises the cost of bulk abuse
  // without a third-party CAPTCHA dependency).
  fastify.get('/auth/pow-challenge', async () => {
    return issueChallenge(fastify.redis)
  })

  // POST /auth/magic-link — request a sign-in link
  fastify.post('/auth/magic-link', async (req, reply) => {
    const { email, challenge, nonce } = magicLinkBody.parse(req.body)

    const powOk = await verifyPow(fastify.redis, challenge, nonce)
    if (!powOk) return reply.status(400).send({ error: 'Verification failed, please try again' })

    const token = await createMagicToken(fastify.redis, email).catch((err: Error) => {
      reply.status(429).send({ error: err.message })
      return null
    })
    if (!token) return

    // Fire email async — never block the response on email delivery
    sendMagicLink(email, token, webBaseFor(req.headers.origin)).catch(err =>
      fastify.log.error({ err }, 'sendMagicLink failed')
    )

    // Always return 200 regardless of whether email exists (no user enumeration)
    return { ok: true }
  })

  // POST /api/auth/verify — consume magic link, create session, return JSON
  fastify.post<{ Body: { token: string } }>('/api/auth/verify', async (req, reply) => {
    const { token } = req.body ?? {}
    if (!token) return reply.status(400).send({ error: 'Missing token' })

    const email = await consumeMagicToken(fastify.redis, token)
    if (!email) return reply.status(400).send({ error: 'Invalid or expired link' })

    // Upsert user
    const db = fastify.mongo
    let user = await db.collection('users').findOne({ email })

    if (!user) {
      const id = new ObjectId()
      await db.collection('users').insertOne({
        _id: id,
        email,
        plan: 'free',
        created_at: new Date(),
        last_seen: new Date(),
        onboarding_completed: false,
        settings: { timezone: 'UTC', notifications: {} },
      })
      user = await db.collection('users').findOne({ _id: id })
    } else {
      await db.collection('users').updateOne({ _id: user._id }, { $set: { last_seen: new Date() } })
    }

    const jwt = await signJWT({
      id: user!._id as ObjectId,
      orgId: user!._id as ObjectId,
      plan: user!['plan'] as 'free',
      username: user!['username'] as string ?? '',
    })

    setSession(reply, jwt)

    return {
      ok: true,
      username: (user!['username'] as string) ?? null,
    }
  })

  // POST /auth/claim-username
  fastify.post('/auth/claim-username', {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const body = z.object({ username: z.string().min(3).max(32).regex(/^[a-z0-9-]+$/) }).parse(req.body)
    if (RESERVED_USERNAMES.has(body.username)) return reply.status(409).send({ error: 'Username taken' })

    const existing = await fastify.mongo.collection('users').findOne({ username: body.username })
    if (existing) return reply.status(409).send({ error: 'Username taken' })

    const prior = await fastify.mongo.collection('users').findOne(
      { _id: req.user!.id }, { projection: { onboarding_completed: 1 } }
    )
    const firstOnboarding = !prior?.['onboarding_completed']

    try {
      await fastify.mongo.collection('users').updateOne(
        { _id: req.user!.id },
        { $set: { username: body.username, onboarding_completed: true } }
      )
    } catch (e) {
      // The username_unique_when_set partial index is the source of truth;
      // a concurrent claim surfaces as duplicate-key 11000, not a TOCTOU win.
      if ((e as { code?: number }).code === 11000) return reply.status(409).send({ error: 'Username taken' })
      throw e
    }

    // Seed a starter workspace so a new user never lands on an empty app.
    // First onboarding only; best-effort — must never block or fail sign-up.
    if (firstOnboarding) {
      try {
        await seedStarterContent(fastify, { userId: req.user!.id, orgId: req.user!.orgId, username: body.username })
      } catch (e) {
        req.log.error({ err: e }, 'starter content seed failed')
      }
    }

    // Re-issue JWT with username
    const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
    const jwt = await signJWT({
      id: user!._id as ObjectId,
      orgId: user!._id as ObjectId,
      plan: user!['plan'] as 'free',
      username: body.username,
    })

    setSession(reply, jwt)

    return { ok: true, username: body.username }
  })

  // GET /auth/dev-link?email= — returns the verify URL directly. It signs in as anyone,
  // so it fails closed: it needs ALLOW_DEV_LINK=1, NODE_ENV other than production, and a
  // caller on loopback or the LAN. The socket address is checked, not req.ip, because
  // trustProxy makes req.ip spoofable; requests via the Linode edge (dev.ah-ha.app)
  // arrive from 10.9.0.x and are refused. Live ran NODE_ENV=development until
  // 2026-10-07, which left this open on ah-ha.app.
  fastify.get<{ Querystring: { email: string } }>('/auth/dev-link', async (req, reply) => {
    if (!devLinkAllowed(req.socket.remoteAddress)) return reply.status(404).send()
    const { email } = req.query
    if (!email) return reply.status(400).send({ error: 'email required' })
    const token = await createMagicToken(fastify.redis, email, true).catch(() => null)
    if (!token) return reply.status(429).send({ error: 'Rate limited' })
    const base = process.env['BASE_URL'] ?? 'http://localhost:3100'
    return { url: `${base}/auth/verify?token=${token}` }
  })

  // POST /auth/logout
  fastify.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie('aha_session', { path: '/' })
    const domain = process.env['COOKIE_DOMAIN']
    if (domain) reply.clearCookie('aha_session', { path: '/', domain })
    return { ok: true }
  })

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: fastify.authenticate }, async (req) => {
    const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
    if (!user) return { error: 'Not found' }
    return { data: {
      id: user._id,
      username: user['username'],
      email: user['email'],
      plan: user['plan'],
      onboarding_completed: user['onboarding_completed'],
    }}
  })
}

export default authRoutes

void nanoid  // suppress unused import warning
