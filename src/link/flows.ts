import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { flow as flowSchema, FLOW_TYPE, type Flow } from './blocks.js'

/**
 * Flows live in Note spaces with `format: 'workflow'`; the body is the flow JSON. The
 * engine only reads workflow notes, so a flow switched to text for hand editing never
 * runs half-finished. (A ```json block inside a longer body is also accepted, for
 * notes written by hand before switching.)
 */

export interface StoredFlow {
  /** The note space id: the flow's id. */
  id: string
  slug: string
  ownerId: ObjectId
  orgId: ObjectId
  flow: Flow | null
  /** Why the JSON didn't validate, if it didn't. */
  error: string | null
  /** Hash of the flow JSON, so a paused run can tell the flow was edited meanwhile. */
  hash: string
  body: string
}

const BLOCK = /```json\s*\n([\s\S]*?)\n```/g

/** The first ```json block in [body] that is an Ah! Link flow, with where it sits. */
export function findFlowBlock(body: string): { json: string; start: number; end: number } | null {
  const t = body.trim()
  if (t.startsWith('{') && t.includes(FLOW_TYPE)) return { json: t, start: 0, end: body.length }
  for (const m of body.matchAll(BLOCK)) {
    if (m[1]!.includes(FLOW_TYPE)) return { json: m[1]!, start: m.index!, end: m.index! + m[0].length }
  }
  return null
}

export function parseFlow(text: string): { flow: Flow | null; error: string | null } {
  const json = findFlowBlock(text)?.json ?? text
  let raw: unknown
  try { raw = JSON.parse(json) } catch (e) { return { flow: null, error: `Not valid JSON: ${(e as Error).message}` } }
  const r = flowSchema.safeParse(raw)
  if (r.success) return { flow: r.data, error: null }
  const first = r.error.issues[0]
  return { flow: null, error: first ? `${first.path.join('.') || 'flow'}: ${first.message}` : 'Invalid flow' }
}

const hashOf = (json: string) => createHash('sha256').update(json).digest('hex').slice(0, 16)

/** Every flow note in an org (or all orgs, for the engine's schedule tick). */
export async function loadFlows(fastify: FastifyInstance, orgId?: ObjectId): Promise<StoredFlow[]> {
  const notes = await fastify.mongo.collection('note_content')
    .find({ ...(orgId ? { org_id: orgId } : {}), format: 'workflow' }).toArray()
  if (!notes.length) return []
  const spaces = await fastify.mongo.collection('spaces')
    .find({ _id: { $in: notes.map(n => n['space_id'] as ObjectId) }, type: 'note', deleted_at: { $exists: false } }).toArray()
  const byId = new Map(spaces.map(s => [String(s['_id']), s]))
  const out: StoredFlow[] = []
  for (const n of notes) {
    const space = byId.get(String(n['space_id']))
    const block = space && findFlowBlock(n['body'] as string)
    if (!space || !block) continue
    const { flow, error } = parseFlow(block.json)
    out.push({
      id: String(space['_id']), slug: space['slug'] as string,
      ownerId: space['owner_id'] as ObjectId, orgId: space['org_id'] as ObjectId,
      flow, error, hash: hashOf(block.json), body: n['body'] as string,
    })
  }
  return out
}

export async function getFlow(fastify: FastifyInstance, orgId: ObjectId, id: string): Promise<StoredFlow | null> {
  if (!ObjectId.isValid(id)) return null
  return (await loadFlows(fastify, orgId)).find(f => f.id === id) ?? null
}

/** Saves a flow as its note's body and marks the note a workflow. */
export async function saveFlow(fastify: FastifyInstance, orgId: ObjectId, spaceId: string, f: Flow) {
  await fastify.mongo.collection('note_content').updateOne(
    { space_id: new ObjectId(spaceId), org_id: orgId },
    { $set: { body: JSON.stringify(f, null, 2) + '\n', format: 'workflow', updated_at: new Date() }, $setOnInsert: { _id: new ObjectId(), space_id: new ObjectId(spaceId), org_id: orgId } },
    { upsert: true },
  )
}
