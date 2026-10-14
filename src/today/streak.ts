import type { Caller, Core } from '../core/index.js'

/**
 * The streak: consecutive days (in the user's time zone) with at least one thing
 * done — a trail entry the user made, a list item checked off, or a card completed.
 * Built from data already kept; nothing extra is recorded.
 *
 * Automatic trail entries don't count, or the streak would keep itself alive:
 * router presence ("got home"), MQTT and n8n. NFC taps and app entries (Ah! Cart
 * trips) are deliberate actions and do count.
 *
 * A day with nothing yet doesn't break the streak until it's over: `current`
 * counts back from yesterday, and `today` says whether today has counted yet.
 */

const AUTOMATIC_SOURCES = ['presence', 'mqtt', 'n8n']
const LOOKBACK_DAYS = 400

export interface Streak { current: number; best: number; today: boolean }

const localDay = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export async function streak(c: Core, caller: Caller, tz: string): Promise<Streak> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
  const days = new Set<string>()

  const [trail, items, cards] = await Promise.all([
    c.trail.activeDays(caller, since, tz, AUTOMATIC_SOURCES).catch(() => [] as string[]),   // trail store down: still count the rest
    c.lists.doneTimes(caller, since),
    c.cards.completionTimes(caller, since),
  ])
  for (const d of trail) days.add(d)
  for (const i of items) days.add(localDay(i.done_at, tz))
  for (const k of cards) days.add(localDay(k.completed_at, tz))

  const dayBefore = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1)
    return t.toISOString().slice(0, 10)
  }
  const todayStr = localDay(new Date(), tz)
  const today = days.has(todayStr)
  let current = 0
  for (let d = today ? todayStr : dayBefore(todayStr); days.has(d); d = dayBefore(d)) current++

  // Longest run in the lookback window.
  let best = 0
  for (const d of days) {
    if (days.has(dayBefore(d))) continue      // not the start of a run
    let run = 0
    for (let x = d; days.has(x); ) { run++; const t = new Date(`${x}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); x = t.toISOString().slice(0, 10) }
    best = Math.max(best, run)
  }
  return { current, best, today }
}
