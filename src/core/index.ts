import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'
import { cardsCore } from './cards.js'
import { listsCore } from './lists.js'
import { entitiesCore } from './entities.js'
import { trailCore } from './trail.js'
import { calendarCore } from './calendar.js'
import { placesCore } from './places.js'
import { contextCore } from './context.js'
import { settingsCore } from './settings.js'
import { kvCore } from './kv.js'

/**
 * Core, as layers above it see it (docs: "Ah-Ha: Today as a layer on core").
 *
 * Layers such as Today (src/today/) read and write through these functions and never
 * touch MongoDB, TimescaleDB or Redis themselves (tests/boundary.test.ts). Each takes
 * the caller it acts for; org scoping happens here, once. When a layer moves out of
 * process, each function becomes an HTTP call of the same shape.
 */
export interface Caller {
  orgId: ObjectId
  userId: ObjectId
  /** A connected app's scopes; null for a session or a full-access key (see lib/scopes). */
  scopes: readonly string[] | null
  /** The request's own credentials, for writes that go through a public route (trail append). */
  auth: { authorization?: string; cookie?: string }
}

export function callerOf(req: FastifyRequest): Caller {
  return {
    orgId: req.user!.orgId,
    userId: req.user!.id,
    scopes: req.apiKeyScopes ?? null,
    auth: {
      ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
    },
  }
}

export function core(fastify: FastifyInstance) {
  return {
    cards: cardsCore(fastify),
    lists: listsCore(fastify),
    entities: entitiesCore(fastify),
    trail: trailCore(fastify),
    calendar: calendarCore(fastify),
    places: placesCore(fastify),
    context: contextCore(fastify),
    settings: settingsCore(fastify),
    kv: kvCore(fastify),
  }
}

export type Core = ReturnType<typeof core>
/** A raw stored document, as core returns it (layers shape their own responses). */
export type Doc = Record<string, unknown> & { _id: ObjectId }
