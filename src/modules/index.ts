import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import { core, type Caller, type Core } from '../core/index.js'
import * as restock from './restock.js'
import * as followthrough from './followthrough.js'
import * as patterns from './patterns.js'

/**
 * Intelligence modules: headless helpers that mine what is already recorded and write
 * back ordinary list items, card fields and trail entries (each tagged with its module
 * id and a reason). They never notify; they reach the person through their lists and
 * Ah! Today. Like Ah! Today they go through src/core/ only (tests/boundary.test.ts).
 *
 * One hourly tick, per user, in that user's time zone:
 *   Restock         once a day, from 8 AM
 *   Follow-through  every tick (cheap; marks each item once)
 *   Weekly patterns once a week, Sunday from 6 PM (or Monday morning if Sunday was missed)
 * AHA_MODULES=off turns them all off.
 */
const HOUR = 3_600_000

interface Module {
  id: string
  /** The run's period ("2026-10-14"), or null when it shouldn't run now. One run per period. */
  period: (local: Local) => string | null
  run: (c: Core, caller: Caller, ctx: { tz: string; now: Date; local: Local }) => Promise<unknown>
}

interface Local { day: string; hour: number; dow: number; hourKey: string }

function localOf(now: Date, tz: string): Local {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]))
  const day = `${p['year']}-${p['month']}-${p['day']}`
  return { day, hour: Number(p['hour']), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p['weekday']!), hourKey: `${day}T${p['hour']}` }
}

/** The Sunday a week's patterns are about: today on Sunday, yesterday on Monday. */
const weekOf = (l: Local) => {
  const d = new Date(`${l.day}T12:00:00Z`); if (l.dow === 1) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export const MODULES: Module[] = [
  { id: restock.ID, period: l => (l.hour >= 8 ? l.day : null), run: (c, caller, { now }) => restock.run(c, caller, now) },
  { id: followthrough.ID, period: l => l.hourKey, run: (c, caller, { local }) => followthrough.run(c, caller, local.day) },
  {
    id: patterns.ID,
    period: l => ((l.dow === 0 && l.hour >= 18) || (l.dow === 1 && l.hour < 12) ? weekOf(l) : null),
    run: (c, caller, { tz, now }) => patterns.run(c, caller, tz, now),
  },
]

export function startModules(fastify: FastifyInstance) {
  if (process.env['AHA_MODULES'] === 'off') return { stop() {}, runFor: async () => ({}) }
  const c = core(fastify)
  const state = c.kv('modules')
  const log = fastify.log.child({ component: 'modules' })

  /** Run what's due for one user. [force] runs every module now, ignoring periods (dev/testing). */
  async function runFor(userId: ObjectId, opts: { force?: boolean; only?: string } = {}) {
    const now = new Date()
    const tz = await c.users.tz(userId)
    const local = localOf(now, tz)
    const caller = await c.users.callerFor(userId)
    const results: Record<string, unknown> = {}
    for (const m of MODULES) {
      if (opts.only && m.id !== opts.only) continue
      const period = opts.force ? `force-${now.getTime()}` : m.period(local)
      if (!period) continue
      const key = `ran:${m.id}:${userId}:${period}`
      if (!opts.force && await state.get(key)) continue
      await state.set(key, '1', 9 * 24 * 3600)    // claimed before running: a failure waits for the next period
      try {
        results[m.id] = await m.run(c, caller, { tz, now, local })
        log.info({ module: m.id, user: String(userId), period, result: results[m.id] }, 'module ran')
      } catch (err) {
        results[m.id] = { error: (err as Error).message }
        log.warn({ err, module: m.id, user: String(userId) }, 'module failed')
      }
    }
    return results
  }

  async function tick() {
    for (const u of await c.users.all()) await runFor(u._id).catch(err => log.warn({ err }, 'module tick failed'))
  }

  const first = setTimeout(() => { tick().catch(() => {}) }, 2 * 60_000)
  const timer = setInterval(() => { tick().catch(() => {}) }, HOUR)
  return { stop() { clearTimeout(first); clearInterval(timer) }, runFor }
}
