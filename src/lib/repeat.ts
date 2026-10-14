import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

/**
 * List items are "once" (the default: checked = done, it stays done) or "always"
 * (checked = had it / did it this time; it comes back open the next day — "always take
 * my laptop to work"). The reopen keeps done_at, so streaks and summaries still count
 * the day it was checked.
 */
export const REPEATS = ['once', 'always'] as const
export type Repeat = typeof REPEATS[number]

/** The user's time zone from their briefing settings (as the Link engine reads it). */
export async function userTz(fastify: FastifyInstance, userId: ObjectId): Promise<string> {
  const prefs = await fastify.mongo.collection('notification_prefs').findOne({ user_id: userId })
  return (prefs?.['daily_briefing'] as { timezone?: string } | undefined)?.timezone ?? 'America/New_York'
}

/** Local midnight today in [tz], as an instant. */
export function startOfDay(tz: string, now = new Date()): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now).map(x => [x.type, Number(x.value)]),
  ) as Record<string, number>
  return new Date(now.getTime() - (((p['hour']! * 60 + p['minute']!) * 60 + p['second']!) * 1000 + now.getMilliseconds()))
}

/**
 * Reopen "always" items checked before today. Called before reads (lazy, so no cron);
 * a bad tz falls back to the user's own, then to leaving things as they are.
 */
export async function reopenAlways(fastify: FastifyInstance, orgId: ObjectId, userId: ObjectId, tz?: string): Promise<void> {
  let since: Date
  try { since = startOfDay(tz ?? await userTz(fastify, userId)) }
  catch { try { since = startOfDay(await userTz(fastify, userId)) } catch { return } }
  await fastify.mongo.collection('list_items').updateMany(
    { org_id: orgId, repeat: 'always', done: true, done_at: { $lt: since }, deleted_at: { $exists: false } },
    { $set: { done: false } },
  )
}
