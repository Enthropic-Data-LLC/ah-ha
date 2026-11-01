import type { FastifyInstance } from 'fastify'
import type { Document, ObjectId } from 'mongodb'

/**
 * Heading out (the phone's leaving checklist) puts everything on a heading-out list
 * under "Take", every time. A list says so in settings.heading_out. Unset, only the
 * list with slug always-take is one, which is how it worked before the setting.
 *
 * Items on other lists that are tagged to a place are things to do or buy there
 * (milk at the store), so going-to lists them as there_items, not as things to take.
 */
export const DEFAULT_HEADING_OUT_SLUG = 'always-take'

export function isHeadingOut(space: Document): boolean {
  const v = (space['settings'] as { heading_out?: unknown } | undefined)?.heading_out
  return typeof v === 'boolean' ? v : space['slug'] === DEFAULT_HEADING_OUT_SLUG
}

/** The org's heading-out lists, oldest first. */
export async function headingOutLists(fastify: FastifyInstance, orgId: ObjectId): Promise<Document[]> {
  const lists = await fastify.mongo.collection('spaces')
    .find({ org_id: orgId, type: 'list', deleted_at: { $exists: false } })
    .project({ slug: 1, name: 1, settings: 1 })
    .sort({ created_at: 1 })
    .toArray()
  return lists.filter(isHeadingOut)
}
