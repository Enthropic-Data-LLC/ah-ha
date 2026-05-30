import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { ObjectId } from 'mongodb'
import { createMagicToken, consumeMagicToken } from '../lib/magic-link.js'
import { sendMagicLink } from '../lib/email.js'
import { signJWT } from '../lib/jwt.js'

const magicLinkBody = z.object({
  email: z.string().email().toLowerCase(),
})

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/magic-link — request a sign-in link
  fastify.post('/auth/magic-link', async (req, reply) => {
    const { email } = magicLinkBody.parse(req.body)

    const token = await createMagicToken(fastify.redis, email).catch((err: Error) => {
      reply.status(429).send({ error: err.message })
      return null
    })
    if (!token) return

    // Fire email async — never block the response on email delivery
    sendMagicLink(email, token).catch(err =>
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

    reply.setCookie('aha_session', jwt, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })

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

    const existing = await fastify.mongo.collection('users').findOne({ username: body.username })
    if (existing) return reply.status(409).send({ error: 'Username taken' })

    await fastify.mongo.collection('users').updateOne(
      { _id: req.user!.id },
      { $set: { username: body.username, onboarding_completed: true } }
    )

    // Re-issue JWT with username
    const user = await fastify.mongo.collection('users').findOne({ _id: req.user!.id })
    const jwt = await signJWT({
      id: user!._id as ObjectId,
      orgId: user!._id as ObjectId,
      plan: user!['plan'] as 'free',
      username: body.username,
    })

    reply.setCookie('aha_session', jwt, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })

    return { ok: true, username: body.username }
  })

  // GET /auth/dev-link?email= — returns the verify URL directly (non-production only)
  fastify.get<{ Querystring: { email: string } }>('/auth/dev-link', async (req, reply) => {
    if (process.env['NODE_ENV'] === 'production') return reply.status(404).send()
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
