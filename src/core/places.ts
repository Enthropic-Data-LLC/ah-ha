import type { FastifyInstance } from 'fastify'
import type { Caller } from './index.js'
import { placeFromPresence, presenceRaw } from '../lib/places.js'

export function placesCore(fastify: FastifyInstance) {
  return {
    /** The raw presence value (a place id, or a word such as "home"), "" when none. */
    presence: (c: Caller) => presenceRaw(fastify, c.userId),
    /** The place a presence value names, if it is one of the user's places. */
    fromPresence: (c: Caller, raw: string) => placeFromPresence(fastify, c.orgId, raw),
  }
}
