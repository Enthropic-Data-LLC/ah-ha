import fp from 'fastify-plugin'
import { createHash } from 'crypto'
import { ObjectId } from 'mongodb'
import type { FastifyPluginAsync } from 'fastify'
import type { ObjectId as ObjId } from 'mongodb'

declare module 'fastify' {
  interface FastifyInstance {
    audit: (opts: {
      actor_id: ObjId
      actor_type: 'user' | 'apikey' | 'mcp'
      action: string
      resource_ref: string
      org_id: ObjId
      ip: string
    }) => void  // fire-and-forget — never awaited on the hot path
  }
}

const auditPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('audit', function auditWrite(opts: {
    actor_id: ObjId
    actor_type: 'user' | 'apikey' | 'mcp'
    action: string
    resource_ref: string
    org_id: ObjId
    ip: string
  }) {
    const db = fastify.mongo

    // Async, non-blocking — failures are silently swallowed to never block API responses
    ;(async () => {
      try {
        const counter = await db.collection('counters').findOneAndUpdate(
          { _id: 'audit_log' as unknown as ObjId },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: 'after' },
        )
        const seq: number = (counter as unknown as Record<string, unknown>)?.['seq'] as number ?? 1

        const ts = new Date()
        const prev = await db.collection('audit_log')
          .findOne({}, { sort: { seq: -1 }, projection: { hash: 1 } })
        const prevHash = (prev?.['hash'] as string) ?? hashGenesis()

        const payload = `${seq}|${ts.toISOString()}|${opts.actor_id}|${opts.action}|${opts.resource_ref}`
        const hash = createHash('sha256').update(`${prevHash}|${payload}`).digest('hex')

        await db.collection('audit_log').insertOne({
          _id: new ObjectId(),
          seq,
          ts,
          actor_id: opts.actor_id,
          actor_type: opts.actor_type,
          action: opts.action,
          resource_ref: opts.resource_ref,
          org_id: opts.org_id,
          ip: opts.ip,
          prev_hash: prevHash,
          hash,
        })
      } catch {
        // Never throw — audit failures must not break the API
      }
    })()
  })
}

function hashGenesis(): string {
  return createHash('sha256').update('ah-ha-audit-genesis').digest('hex')
}

export default fp(auditPlugin, { name: 'audit', dependencies: ['db'] })
