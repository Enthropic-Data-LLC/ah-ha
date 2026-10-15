import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { wire } from './hub.js'

type Listener = (data: string, id: string) => void

/**
 * GET /api/push/stream — Server-Sent Events: one long request per device, a message the
 * moment a tracker fires. `Last-Event-ID` (or ?after=) replays what a device missed in
 * the last day. GET /api/push/inbox?after=<id> is the same catch-up as a plain request.
 */
const pushRoutes: FastifyPluginAsync = async (fastify) => {
  const listeners = new Map<string, Set<Listener>>()
  const sub = fastify.redis.duplicate()
  await sub.psubscribe('aha:push:*')
  sub.on('pmessage', (_p, channel, msg) => {
    const set = listeners.get(channel.slice('aha:push:'.length))
    if (!set) return
    let id = ''
    try { id = (JSON.parse(msg) as { id: string }).id } catch { return }
    for (const l of set) l(msg, id)
  })
  fastify.addHook('onClose', async () => { await sub.quit().catch(() => {}) })

  const missed = (userId: ObjectId, after: string | undefined, limit: number) => {
    const day = new Date(Date.now() - 86_400_000)
    const q: Record<string, unknown> = { user_id: userId, created_at: { $gte: day } }
    if (after && ObjectId.isValid(after)) q['_id'] = { $gt: new ObjectId(after) }
    return fastify.mongo.collection('push_messages').find(q).sort({ _id: after ? 1 : -1 }).limit(limit).toArray()
      .then(rows => (after ? rows : rows.reverse()).map(wire))
  }

  fastify.get<{ Querystring: { after?: string } }>('/api/push/inbox', { preHandler: fastify.authenticate }, async (req) => {
    return { data: await missed(req.user!.id, req.query.after, 50) }
  })

  fastify.get<{ Querystring: { after?: string } }>('/api/push/stream', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user!.id.toString()
    const after = (req.headers['last-event-id'] as string | undefined) ?? req.query.after
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send: Listener = (data, id) => { raw.write(`id: ${id}\nevent: push\ndata: ${data}\n\n`) }
    raw.write('retry: 10000\n\n')
    if (after) for (const m of await missed(req.user!.id, after, 50)) send(JSON.stringify(m), m.id)

    const set = listeners.get(userId) ?? new Set<Listener>()
    set.add(send)
    listeners.set(userId, set)
    // A comment every 25 s keeps proxies and phone NATs from dropping an idle stream.
    const ping = setInterval(() => raw.write(': ping\n\n'), 25_000)
    req.raw.on('close', () => {
      clearInterval(ping)
      set.delete(send)
      if (!set.size) listeners.delete(userId)
    })
  })
}

export default pushRoutes
