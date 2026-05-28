import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { generateRawKey, hashKey } from '../lib/api-key.js'

const keysRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/keys — generate API key (plaintext returned once)
  fastify.post('/api/keys', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1).max(100),
      scope: z.string().default('all'),
      access: z.enum(['read', 'write']).default('write'),
      expires_in_days: z.number().int().positive().nullable().default(null),
    }).parse(req.body)

    const raw = generateRawKey()
    const { hash, prefix } = await hashKey(raw)

    const key = {
      _id: new ObjectId(),
      name: body.name,
      hash,
      prefix,
      org_id: req.user!.orgId,
      user_id: req.user!.id,
      scope: body.scope,
      access: body.access,
      expires_at: body.expires_in_days
        ? new Date(Date.now() + body.expires_in_days * 86400_000)
        : null,
      last_used: null,
      created_at: new Date(),
    }

    await fastify.mongo.collection('api_keys').insertOne(key)

    reply.status(201)
    return {
      data: {
        id: key._id,
        name: key.name,
        prefix: key.prefix,
        scope: key.scope,
        access: key.access,
        expires_at: key.expires_at,
        created_at: key.created_at,
        key: raw,  // shown exactly once
      }
    }
  })

  // GET /api/keys — list keys (no hashes, no plaintext)
  fastify.get('/api/keys', { preHandler: fastify.authenticate }, async (req) => {
    const keys = await fastify.mongo.collection('api_keys')
      .find({ user_id: req.user!.id, revoked_at: { $exists: false } })
      .project({ hash: 0 })
      .sort({ created_at: -1 })
      .toArray()
    return { data: keys }
  })

  // DELETE /api/keys/:id — revoke
  fastify.delete<{ Params: { id: string } }>(
    '/api/keys/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('api_keys').updateOne(
        { _id: new ObjectId(req.params.id), user_id: req.user!.id, revoked_at: { $exists: false } },
        { $set: { revoked_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )
}

export default keysRoutes
