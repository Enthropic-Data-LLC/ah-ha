import type { Caller, Core, Doc } from '../core/index.js'

/**
 * Restock: learns how often things get bought — Ah! Cart trips and items checked off
 * the shop list — and puts one back on the list when it's about due ("you buy this
 * about every 9 days; last time 8 days ago"). It only adds ordinary list items
 * (source "ah-restock" + a reason), so they show in Ah! Cart's To get, on the web list
 * and at the store like anything else.
 *
 * Holds back: needs a purchase on at least MIN_DAYS different days; never adds what is
 * already on the list; at most PER_DAY a day; and a suggestion you delete keeps that
 * item quiet for two of its intervals.
 */
export const ID = 'ah-restock'
const MIN_DAYS = 3
const PER_DAY = 3
const DUE_AT = 0.85            // suggest once 85% of the usual gap has passed
const LOOKBACK_DAYS = 180
const DAY = 86_400_000
const SHOP_LISTS = ['shop', 'shopping']

export interface Purchase { key: string; title: string; at: Date; contexts?: unknown[] }
export interface Suggestion { key: string; title: string; reason: string; intervalDays: number; sinceDays: number; contexts?: unknown[] }

/** "Chicken leg quarters 10 lb bag x2 (plain)" and "Extra: chicken leg quarters" are the same thing. */
export function normalize(title: string): string {
  return title.toLowerCase()
    .replace(/^\s*extra\s*:\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(lbs?|oz|ounces?|ct|count|g|kg|ml|l|pack|pk|bags?|cans?|jars?)\b/g, ' ')
    .replace(/\bx\s*\d+\b|\b\d+\s*x\b/g, ' ')
    .replace(/\b(bag|pack)\b/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * What to put back, most overdue first. [open] = keys already on the list; [declined] =
 * key → when a Restock suggestion for it was deleted.
 */
export function suggest(purchases: Purchase[], open: Set<string>, declined: Map<string, Date>, now: Date, limit = PER_DAY): Suggestion[] {
  const byKey = new Map<string, Purchase[]>()
  for (const p of purchases) if (p.key) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p])
  const out: Array<Suggestion & { ratio: number }> = []
  for (const [key, ps] of byKey) {
    if (open.has(key)) continue
    const days = [...new Set(ps.map(p => Math.floor(p.at.getTime() / DAY)))].sort((a, b) => a - b)
    if (days.length < MIN_DAYS) continue
    const gaps = days.slice(1).map((d, i) => d - days[i]!)
    const interval = Math.max(2, Math.round(median(gaps)))
    const since = Math.floor(now.getTime() / DAY) - days.at(-1)!
    const no = declined.get(key)
    if (no && now.getTime() - no.getTime() < 2 * interval * DAY) continue
    if (since < DUE_AT * interval) continue
    const latest = ps.reduce((a, b) => (b.at > a.at ? b : a))
    out.push({
      key, title: latest.title, intervalDays: interval, sinceDays: since, ratio: since / interval,
      reason: `You buy this about every ${interval} days; last time ${since} day${since === 1 ? '' : 's'} ago`,
      ...(latest.contexts?.length ? { contexts: latest.contexts } : {}),
    })
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, limit).map(({ ratio: _r, ...s }) => s)
}

/** Shop-list items checked off = purchases; the rest says what's open and what was turned down. */
export function readList(items: Doc[]) {
  const purchases: Purchase[] = [], open = new Set<string>(), declined = new Map<string, Date>()
  for (const i of items) {
    const title = String(i['title'] ?? ''), key = normalize(title)
    if (!key) continue
    const done = i['done_at'] as Date | null | undefined, deleted = i['deleted_at'] as Date | undefined
    if (done && i['done']) purchases.push({ key, title, at: done, contexts: (i['contexts'] as unknown[] | undefined) ?? [] })
    if (!i['done'] && !deleted) open.add(key)
    if (deleted && !i['done'] && i['source'] === ID) declined.set(key, deleted)
  }
  return { purchases, open, declined }
}

/** Lines of Ah! Cart trips (ah-cart/trip@1). */
export function readTrips(trips: Array<{ meta: Record<string, unknown>; ts: Date }>): Purchase[] {
  return trips.flatMap(t => {
    const at = new Date(String(t.meta['shopped_at'] ?? t.ts))
    const lines = (t.meta['items'] as Array<{ name?: string }> | undefined) ?? []
    return lines.map(l => ({ key: normalize(l.name ?? ''), title: (l.name ?? '').trim(), at: isNaN(at.getTime()) ? t.ts : at }))
  }).filter(p => p.key)
}

export async function run(c: Core, caller: Caller, now = new Date()) {
  let slug: string | null = null, space: Doc | null = null
  for (const s of SHOP_LISTS) { space = await c.lists.space(caller, s); if (space) { slug = s; break } }
  if (!space || !slug) return { added: [], note: 'no shop list' }
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY)
  const [items, trips] = await Promise.all([
    c.lists.history(caller, space._id, since),
    c.trail.ofType(caller, ['ah-cart/trip@1'], since).catch(() => []),
  ])
  const { purchases, open, declined } = readList(items)
  const picks = suggest([...purchases, ...readTrips(trips)], open, declined, now)
  const added: string[] = []
  for (const s of picks) {
    await c.lists.add(caller, slug, { title: s.title, source: ID, reason: s.reason, ...(s.contexts ? { contexts: s.contexts } : {}) })
    added.push(s.title)
  }
  return { added }
}
