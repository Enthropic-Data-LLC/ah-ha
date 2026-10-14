import type { FastifyInstance } from 'fastify'
import type { Caller, Doc } from './index.js'

export function entitiesCore(fastify: FastifyInstance) {
  return {
    /** People the user has added as entities (for "X is home"). */
    people: (c: Caller) =>
      fastify.mongo.collection<Doc>('entities').find({ org_id: c.orgId, entity_type: 'person', deleted_at: { $exists: false } }).toArray(),
  }
}
