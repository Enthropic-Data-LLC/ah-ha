import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { verifyJWT } from '../lib/jwt.js'
import { validateApiKey } from '../lib/api-key.js'
import { scopesAllow } from '../lib/scopes.js'

// Never reachable with an API key, whatever its scopes or access: otherwise a limited
// key could mint itself a full one, or approve another app's connection.
const SESSION_ONLY = ['/api/keys', '/api/connect/authorize']

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', undefined)
  fastify.decorateRequest('apiKeyId', undefined)
  fastify.decorateRequest('apiKeyScopes', undefined)

  fastify.decorate('authenticate', authenticate)
}

async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  // 1. Session cookie (browser)
  const cookie = req.cookies?.['aha_session']
  if (cookie) {
    const user = await verifyJWT(cookie).catch(() => null)
    if (user) {
      req.user = user
      return
    }
  }

  // 2. Bearer token (API keys + MCP)
  const bearer = req.headers['authorization']?.replace('Bearer ', '')
  if (bearer?.startsWith('aha_live_')) {
    const key = await validateApiKey(req.server.mongo, bearer)
    if (!key) {
      return reply.status(401).send({ error: 'Invalid API key' })
    }
    const route = req.routeOptions.url
    if (route && SESSION_ONLY.some(p => route === p || route.startsWith(p + '/'))) {
      return reply.status(403).send({ error: 'Not available to API keys' })
    }
    // `access: read` was stored but never enforced until 2026-10-03.
    if (key.access === 'read' && req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.status(403).send({ error: 'This key is read-only' })
    }
    if (key.scopes && !scopesAllow(key.scopes, req.method, route)) {
      return reply.status(403).send({ error: 'This app was not given permission for that' })
    }
    req.apiKeyScopes = key.scopes
    req.user = { id: key.user_id, orgId: key.org_id, plan: key.plan as import('../types.js').Plan, username: key.username }
    req.apiKeyId = key._id
    // Update last_used async — fire and forget
    req.server.mongo.collection('api_keys')
      .updateOne({ _id: key._id }, { $set: { last_used: new Date() } })
      .catch(() => {})
    return
  }

  return reply.status(401).send({ error: 'Authentication required' })
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db', 'redis'] })
