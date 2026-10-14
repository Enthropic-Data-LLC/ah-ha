import type { FastifyInstance } from 'fastify'
import type { Caller } from './index.js'
import type { Place } from '../lib/places.js'
import { situation } from '../lib/situation.js'

type CalEvent = Parameters<typeof situation>[1]['calendar'][number]

export function contextCore(fastify: FastifyInstance) {
  return {
    /** Facts about this moment: place, calendar, weather, who's home, overrides (lib/situation). */
    situation: (c: Caller, opts: { tz: string; tod: string; place: Place | null; calendar: CalEvent[] }) =>
      situation(fastify, { orgId: c.orgId, ...opts }),
  }
}
