import type { Situation } from './situation.js'

/**
 * Picks the one thing for right now from Today's candidates, scoring every signal
 * at once instead of filtering by place and time separately, and says why in plain
 * words. The reasons are the point: a visible "because" turns a wrong guess into a
 * quick correction instead of lost trust.
 */

export interface Candidate {
  kind: 'card' | 'list_item'
  id: string
  title: string
  tags?: string[]
  due?: Date | null
  /** Points and words from the section it came from (urgent, here, a habit for now…). */
  base: number
  reasons: string[]
}

export interface Focus {
  kind: 'card' | 'list_item' | 'prepare'
  id: string | null
  title: string
  reasons: string[]
}

const OUTDOOR = /\b(mow|lawn|yard|garden|weed|rake|gutter|hedge|outside|outdoor|walk|run|bike|hike|wash (the )?car|grill|deck|fence|plant)\b/i

const clock = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })

export function pickFocus(cands: Candidate[], s: Situation, tz: string): Focus | null {
  // About to leave: getting ready beats everything.
  if (s.next && s.next.minutes <= 15 && s.next.minutes >= 0) {
    return {
      kind: 'prepare', id: null, title: `Get ready: ${s.next.title}`,
      reasons: [`starts in ${s.next.minutes} min`, ...(s.next.location ? [s.next.location] : [])],
    }
  }
  if (cands.length === 0) return null

  const scored = cands.map(c => {
    let score = c.base
    const why = [...c.reasons]
    const outdoor = (c.tags ?? []).some(t => t.toLowerCase() === 'outdoor') || OUTDOOR.test(c.title)

    if (outdoor && s.weather) {
      const w = s.weather
      const rainSoon = w.rain_at ? (Date.parse(w.rain_at) - Date.now()) / 60_000 : null
      if (rainSoon != null && rainSoon <= 45) { score -= 4; why.push('rain coming now') }
      else if (rainSoon != null && rainSoon <= 240) { score += 3; why.push(`dry until ${clock(w.rain_at!, tz)}`) }
      if (w.daylight_min != null && w.daylight_min <= 0) { score -= 4; why.push('after dark') }
      else if (w.daylight_min != null && w.daylight_min <= 90) { score += 2; why.push(`sunset ${clock(w.sunset!, tz)}`) }
    }
    if (s.energy.level === 'low' && (c.kind === 'list_item' || c.base <= 2)) { score += 1; why.push('small win for a low-energy day') }
    if (s.energy.level === 'high' && c.base >= 3) { score += 1; why.push('good energy — tackle it') }
    if (s.next && s.next.minutes <= 45 && c.kind === 'list_item') { score += 1; why.push(`quick — ${s.next.title} in ${s.next.minutes} min`) }
    return { c, score, why }
  })

  scored.sort((a, b) => b.score - a.score ||
    (a.c.due?.getTime() ?? Infinity) - (b.c.due?.getTime() ?? Infinity))
  const top = scored[0]!
  if (top.score <= 0) return null
  return { kind: top.c.kind, id: top.c.id, title: top.c.title, reasons: [...new Set(top.why)].slice(0, 3) }
}
