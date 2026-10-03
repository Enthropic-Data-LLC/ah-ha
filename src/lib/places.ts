import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

/**
 * Location awareness shared by every read that returns tasks or list items.
 *
 * "Where the user is" is the check-in in Redis (`aha:presence:state:{username}`),
 * set by the phone's GPS geofences, NFC tags, or a manual check-in. Items and cards
 * carry `contexts: [{ entity_id, time_chunks }]` linking them to places. These
 * helpers resolve both so an API/MCP caller gets "you're at Walmart, these 23 are
 * for here" instead of bare entity ids.
 */

export interface Place { _id: string; name: string; icon: string }

const OID_RE = /^[0-9a-f]{24}$/i

const toPlace = (e: Record<string, unknown>): Place =>
  ({ _id: String(e['_id']), name: e['name'] as string, icon: (e['icon'] as string) ?? '📍' })

/** The raw presence value: an entity id, a legacy word ("home"/"away"), or "unknown". */
export async function presenceRaw(fastify: FastifyInstance, userId: ObjectId): Promise<string> {
  const user = await fastify.mongo.collection('users').findOne({ _id: userId })
  const username = user?.['username'] as string | undefined
  if (!username) return 'unknown'
  return (await fastify.redis.get(`aha:presence:state:${username}`)) ?? 'unknown'
}

/** Resolves a presence value to a place in this org, or null. */
export async function placeFromPresence(fastify: FastifyInstance, orgId: ObjectId, raw: string): Promise<Place | null> {
  if (!OID_RE.test(raw)) return null
  const ent = await fastify.mongo.collection('entities')
    .findOne({ _id: new ObjectId(raw), org_id: orgId, deleted_at: { $exists: false } })
  return ent ? toPlace(ent) : null
}

/** Where the user is checked in right now, or null. */
export async function currentPlace(fastify: FastifyInstance, userId: ObjectId, orgId: ObjectId): Promise<Place | null> {
  return placeFromPresence(fastify, orgId, await presenceRaw(fastify, userId))
}

/** All of the org's places, by id. */
export async function orgPlaces(fastify: FastifyInstance, orgId: ObjectId): Promise<Map<string, Place>> {
  const ents = await fastify.mongo.collection('entities')
    .find({ org_id: orgId, deleted_at: { $exists: false } }).toArray()
  return new Map(ents.map(e => [String(e['_id']), toPlace(e)]))
}

/**
 * Resolves an `?at=` value: "here" → the current place; a 24-hex id; otherwise a
 * place name, case-insensitive ("walmart"). Returns undefined when nothing matches,
 * null when `at=here` but the user isn't checked in anywhere.
 */
export function resolveAt(at: string, places: Map<string, Place>, here: Place | null): Place | null | undefined {
  if (at.toLowerCase() === 'here') return here
  if (places.has(at)) return places.get(at)
  const want = at.trim().toLowerCase()
  return [...places.values()].find(p => p.name.toLowerCase() === want)
}

type Ctx = { entity_id: string }

/** Adds `places` (resolved names) and `here` (tagged to the current place) to each doc. */
export function annotate<T extends Record<string, unknown>>(docs: T[], places: Map<string, Place>, here: Place | null) {
  return docs.map(d => {
    const ids = ((d['contexts'] as Ctx[] | undefined) ?? []).map(c => c.entity_id)
    return {
      ...d,
      places: ids.map(id => places.get(id)).filter((p): p is Place => !!p),
      here: !!here && ids.includes(here._id),
    }
  })
}

/** Mongo filter fragment: docs tagged to this place. */
export const taggedTo = (place: Place) => ({ 'contexts.entity_id': place._id })
