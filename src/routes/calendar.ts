import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { fetchCalendarEvents } from '../lib/ical-fetch.js'
import type { CalendarSource } from '../lib/ical-fetch.js'

function parseDate(input: string | undefined, fallbackMs: number): Date {
  if (!input) return new Date(Date.now() + fallbackMs)
  if (input === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }
  if (input === 'tomorrow') {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d
  }
  const rel = input.match(/^\+(\d+)d$/)
  if (rel) return new Date(Date.now() + parseInt(rel[1]!) * 86_400_000)
  return new Date(input)
}

const sourceBody = z.object({
  name: z.string().min(1).max(100),
  ical_url: z.string().url(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
})

function maskUrl(url: string): string {
  return '••••' + url.slice(-8)
}

const calendarRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/calendar/sources
  fastify.get('/api/calendar/sources', { preHandler: fastify.authenticate }, async (req) => {
    const sources = await fastify.mongo.collection('calendar_sources')
      .find({ user_id: req.user!.id })
      .sort({ created_at: 1 })
      .toArray()
    return {
      data: sources.map(s => ({
        _id: s['_id'],
        name: s['name'],
        color: s['color'],
        ical_url: maskUrl(s['ical_url'] as string),
        created_at: s['created_at'],
      })),
    }
  })

  // POST /api/calendar/sources
  fastify.post('/api/calendar/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = sourceBody.parse(req.body)
    const doc = {
      _id: new ObjectId(),
      user_id: req.user!.id,
      ...body,
      created_at: new Date(),
    }
    await fastify.mongo.collection('calendar_sources').insertOne(doc)
    reply.status(201)
    return { data: { ...doc, ical_url: maskUrl(body.ical_url) } }
  })

  // DELETE /api/calendar/sources/:id
  fastify.delete('/api/calendar/sources/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!ObjectId.isValid(id)) return reply.badRequest('Invalid id')
    // Evict Redis cache for this source
    await fastify.redis.del(`cal:${id}:raw`).catch(() => null)
    const result = await fastify.mongo.collection('calendar_sources').deleteOne({
      _id: new ObjectId(id),
      user_id: req.user!.id,
    })
    if (result.deletedCount === 0) return reply.notFound()
    return { ok: true }
  })

  // GET /api/calendar/events?start=...&end=...&limit=...
  fastify.get('/api/calendar/events', { preHandler: fastify.authenticate }, async (req) => {
    const q = req.query as Record<string, string>
    const start = parseDate(q['start'], 0)
    const end   = parseDate(q['end'],   7 * 86_400_000)
    const limit = Math.min(parseInt(q['limit'] ?? '100'), 500)

    const sources = await fastify.mongo.collection<CalendarSource>('calendar_sources')
      .find({ user_id: req.user!.id }).toArray()
    if (sources.length === 0) return { data: [] }

    const events = await fetchCalendarEvents(sources, start, end, fastify.redis)
    return { data: events.slice(0, limit) }
  })

  // GET /api/calendar/upcoming?hours=24
  fastify.get('/api/calendar/upcoming', { preHandler: fastify.authenticate }, async (req) => {
    const q = req.query as Record<string, string>
    const hours = Math.min(parseInt(q['hours'] ?? '24'), 336)
    const start = new Date()
    const end   = new Date(Date.now() + hours * 3_600_000)

    const sources = await fastify.mongo.collection<CalendarSource>('calendar_sources')
      .find({ user_id: req.user!.id }).toArray()
    if (sources.length === 0) return { data: [] }

    const events = await fetchCalendarEvents(sources, start, end, fastify.redis)
    return { data: events }
  })
}

export default calendarRoutes
