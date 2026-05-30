import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/audit — paginated audit log for the current org
  fastify.get<{ Querystring: { resource_ref?: string; action?: string; since?: string; limit?: string; cursor?: string } }>(
    '/api/audit',
    { preHandler: fastify.authenticate },
    async (req) => {
      const params = z.object({
        resource_ref: z.string().optional(),
        action: z.string().optional(),
        since: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.coerce.number().int().optional(),
      }).parse(req.query)

      const filter: Record<string, unknown> = { org_id: req.user!.orgId }
      if (params.resource_ref) filter['resource_ref'] = { $regex: params.resource_ref, $options: 'i' }
      if (params.action) filter['action'] = params.action
      if (params.since) filter['ts'] = { $gte: new Date(params.since) }
      if (params.cursor !== undefined) filter['seq'] = { $lt: params.cursor }

      const entries = await fastify.mongo.collection('audit_log')
        .find(filter)
        .sort({ seq: -1 })
        .limit(params.limit + 1)
        .toArray()

      const has_more = entries.length > params.limit
      if (has_more) entries.pop()

      return {
        data: entries,
        meta: {
          has_more,
          cursor: has_more && entries.length > 0
            ? (entries[entries.length - 1]!['seq'] as number)
            : null,
        },
      }
    }
  )
}

export default auditRoutes
