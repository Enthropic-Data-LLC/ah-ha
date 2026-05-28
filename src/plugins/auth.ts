import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { verifyJWT } from '../lib/jwt.js'
import { validateApiKey } from '../lib/api-key.js'

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate request with requireAuth helper
  fastify.decorateRequest('user', null)
  fastify.decorateRequest('apiKeyId', null)

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
