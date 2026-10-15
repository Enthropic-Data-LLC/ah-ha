import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

/**
 * Push to a person's devices without a third party: a message is stored (so a phone
 * that was offline catches up) and published on Redis `aha:push:<userId>`, which every
 * open /api/push/stream for that person relays at once.
 */
export interface PushMessage { title: string; body?: string; tracker_id?: string; entry_id?: string }

export const pushChannel = (userId: string) => `aha:push:${userId}`

export async function pushTo(fastify: FastifyInstance, userId: ObjectId, orgId: ObjectId, msg: PushMessage) {
  const doc = { _id: new ObjectId(), user_id: userId, org_id: orgId, ...msg, created_at: new Date() }
  await fastify.mongo.collection('push_messages').insertOne(doc)
  await fastify.redis.publish(pushChannel(userId.toString()), JSON.stringify(wire(doc)))
}

/** What a device receives. */
export function wire(d: Record<string, unknown>) {
  return { id: String(d['_id']), title: d['title'], body: d['body'] ?? null, tracker_id: d['tracker_id'] ?? null, at: (d['created_at'] as Date).toISOString() }
}
