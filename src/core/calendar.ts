import type { FastifyInstance } from 'fastify'
import type { Caller } from './index.js'
import { fetchCalendarEvents, type CalendarSource } from '../lib/ical-fetch.js'

export function calendarCore(fastify: FastifyInstance) {
  return {
    /** Events from the user's connected calendars between [from] and [to] (cached in Redis by ical-fetch). */
    events: async (c: Caller, from: Date, to: Date) => {
      const sources = await fastify.mongo.collection<CalendarSource>('calendar_sources').find({ user_id: c.userId }).toArray()
      return sources.length ? fetchCalendarEvents(sources, from, to, fastify.redis) : []
    },
  }
}
