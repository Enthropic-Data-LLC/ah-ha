import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import type { LinkType } from '../types.js'

const LINK_TYPES: LinkType[] = [
  'caused-by', 'resolved-by', 'documented-in', 'depends-on',
  'triggered', 'references', 'related-to',
]

const linksRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/links
  fastify.post('/api/links', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      type: z.enum(LINK_TYPES as [LinkType, ...LinkType[]]),
    }).parse(req.body)

    const link = {
      _id: new ObjectId(),
      from_ref: body.from,
      to_ref: body.to,
      type: body.type,
      creator_type: req.apiKeyId ? 'mcp' : 'user' as const,  // mcp if via API key
      created_by: req.user!.id,
      org_id: req.user!.orgId,
      created_at: new Date(),
    }

    await fastify.mongo.collection('links').insertOne(link)
    reply.status(201)
    return { data: link }
  })

  // GET /api/links?ref= — all links involving a ref
  fastify.get<{ Querystring: { ref: string } }>(
    '/api/links',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      if (!req.query.ref) return reply.status(400).send({ error: 'ref required' })

      const links = await fastify.mongo.collection('links').find({
        $or: [{ from_ref: req.query.ref }, { to_ref: req.query.ref }],
        org_id: req.user!.orgId,
        deleted_at: { $exists: false },
      }).sort({ created_at: -1 }).toArray()

      return { data: links }
    }
  )

  // GET /api/links/traverse?ref=&depth= — BFS traversal (MongoDB, no Neo4j Phase 1)
  fastify.get<{ Querystring: { ref: string; depth?: string } }>(
    '/api/links/traverse',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      if (!req.query.ref) return reply.status(400).send({ error: 'ref required' })
      const maxDepth = Math.min(parseInt(req.query.depth ?? '2', 10), 3)

      const visitedNodes = new Set<string>([req.query.ref])
      const seenEdges = new Set<string>()
      const frontier = [req.query.ref]
      const allLinks: unknown[] = []

      for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
        const links = await fastify.mongo.collection('links').find({
          $or: [{ from_ref: { $in: frontier } }, { to_ref: { $in: frontier } }],
          org_id: req.user!.orgId,
          deleted_at: { $exists: false },
        }).toArray()

        const nextFrontier: string[] = []
        for (const link of links) {
          const edgeId = (link['_id'] as ObjectId).toString()
          if (!seenEdges.has(edgeId)) {
            seenEdges.add(edgeId)
            allLinks.push(link)
          }
          for (const refKey of ['from_ref', 'to_ref'] as const) {
            const ref = link[refKey] as string
            if (!visitedNodes.has(ref)) {
              visitedNodes.add(ref)
              nextFrontier.push(ref)
            }
          }
        }
        frontier.length = 0
        frontier.push(...nextFrontier)
      }

      return { data: allLinks, meta: { nodes: [...visitedNodes], depth: maxDepth } }
    }
  )

  // DELETE /api/links/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/links/:id',
    { preHandler: fastify.authenticate },
    async (req, reply) => {
      const result = await fastify.mongo.collection('links').updateOne(
        { _id: new ObjectId(req.params.id), org_id: req.user!.orgId, deleted_at: { $exists: false } },
        { $set: { deleted_at: new Date() } }
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Not found' })
      return { ok: true }
    }
  )
}

export default linksRoutes
