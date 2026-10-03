import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { createHash, randomBytes } from 'node:crypto'
import { generateRawKey, hashKey } from '../lib/api-key.js'
import { SCOPES, isScope, scopesWrite } from '../lib/scopes.js'

/**
 * Connecting an app (an Ah! module) without pasting a key — OAuth 2.0 authorization
 * code + PKCE (RFC 7636), pared down:
 *
 *   1. The app opens https://ah-ha.app/connect?client_id=…&client_name=…&scope=a b
 *        &redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256
 *   2. The signed-in user approves on that page → POST /api/connect/authorize
 *      (session only, never an API key) → a one-time code, valid 10 minutes.
 *   3. The page sends the browser to redirect_uri?code=…&state=…
 *   4. The app → POST /api/connect/token with the code + its code_verifier → a key
 *      limited to the approved scopes. The key never travels in a URL.
 *
 * Anyone can register a URL scheme, so a stolen code is useless without the
 * verifier, which never leaves the app.
 */

const CODE_TTL_S = 600
const codeKey = (code: string) => `aha:connect:code:${code}`

const clientId = z.string().regex(/^[a-z0-9][a-z0-9.-]{2,99}$/i, 'reverse-domain id, e.g. com.example.app')
// A custom app scheme (ahcart://…) or https. Never http, javascript:, data: or file:.
const redirectUri = z.string().max(500).refine(u => {
  try {
    const p = new URL(u).protocol.replace(/:$/, '')
    return p === 'https' || (/^[a-z][a-z0-9+.-]*$/.test(p) && !['http', 'javascript', 'data', 'file', 'blob', 'vbscript'].includes(p))
  } catch { return false }
}, 'redirect_uri must be https or an app scheme')

interface PendingCode {
  user_id: string; org_id: string
  client_id: string; client_name: string; device: string
  scopes: string[]; redirect_uri: string; challenge: string
}

const b64url = (buf: Buffer) => buf.toString('base64url')

const connectRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/connect/scopes — what each permission means, for the consent screen.
  fastify.get('/api/connect/scopes', async () => ({
    data: Object.fromEntries(Object.entries(SCOPES).map(([k, v]) => [k, v.label])),
  }))

  // POST /api/connect/authorize — the user approved; mint a one-time code.
  fastify.post('/api/connect/authorize', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({
      client_id: clientId,
      client_name: z.string().trim().min(1).max(60),
      device: z.string().trim().max(60).default(''),
      scopes: z.array(z.string()).min(1).max(20),
      redirect_uri: redirectUri,
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'S256 challenge, base64url of 32 bytes'),
      code_challenge_method: z.literal('S256'),
    }).parse(req.body)

    const unknown = body.scopes.filter(s => !isScope(s))
    if (unknown.length) return reply.status(400).send({ error: `Unknown permission: ${unknown.join(', ')}` })

    const code = b64url(randomBytes(24))
    const pending: PendingCode = {
      user_id: req.user!.id.toString(), org_id: req.user!.orgId.toString(),
      client_id: body.client_id, client_name: body.client_name, device: body.device,
      scopes: [...new Set(body.scopes)], redirect_uri: body.redirect_uri, challenge: body.code_challenge,
    }
    await fastify.redis.setex(codeKey(code), CODE_TTL_S, JSON.stringify(pending))
    return { data: { code } }
  })

  // POST /api/connect/token — the app trades the code + verifier for its key.
  fastify.post('/api/connect/token', async (req, reply) => {
    const body = z.object({
      code: z.string().min(16).max(100),
      code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      client_id: clientId,
      redirect_uri: z.string().max(500),
    }).parse(req.body)

    // GETDEL: a code works once, even if the app retries or someone races it.
    const raw = await fastify.redis.getdel(codeKey(body.code))
    if (!raw) return reply.status(400).send({ error: 'invalid_grant', message: 'Code is unknown, used or expired' })
    const p = JSON.parse(raw) as PendingCode

    const challenge = b64url(createHash('sha256').update(body.code_verifier).digest())
    if (p.client_id !== body.client_id || p.redirect_uri !== body.redirect_uri || p.challenge !== challenge) {
      return reply.status(400).send({ error: 'invalid_grant', message: 'Code does not match this app' })
    }

    const name = p.device ? `${p.client_name} — ${p.device}` : p.client_name
    const userId = new ObjectId(p.user_id)
    // Reconnecting the same app on the same device replaces its key instead of piling them up.
    await fastify.mongo.collection('api_keys').updateMany(
      { user_id: userId, app_id: p.client_id, name, revoked_at: { $exists: false } },
      { $set: { revoked_at: new Date() } },
    )

    const key = generateRawKey()
    const { hash, prefix } = await hashKey(key)
    const now = new Date()
    await fastify.mongo.collection('api_keys').insertOne({
      _id: new ObjectId(), name, hash, prefix,
      org_id: new ObjectId(p.org_id), user_id: userId,
      app_id: p.client_id, scopes: p.scopes,
      scope: 'all', access: scopesWrite(p.scopes) ? 'write' : 'read',
      expires_at: null, last_used: null, created_at: now,
    })

    return { data: { key, name, scopes: p.scopes } }
  })
}

export default connectRoutes
