import type { Caller, Core, Doc } from '../core/index.js'

/**
 * Weekly patterns: on Sunday evening, one trail entry about the week — what was kept up,
 * what kept getting skipped or put off, and when the most got done. Built only from what
 * is already recorded (Ah! Rhythm's trail entries, completions, snoozes, overdue cards).
 * Ah! Today's briefing reads the latest one early in the next week.
 */
export const ID = 'ah-patterns'
export const TYPE = 'ah-patterns/week@1'
const DAY = 86_400_000

export interface WeekInput {
  /** Ah! Rhythm doses and do-items: what, taken/skipped, when. */
  doses: Array<{ name: string; status: string; at: Date }>
  /** Things finished: cards and list items, with when. */
  done: Array<{ title: string; at: Date }>
  /** How much got done in each of the previous three weeks. */
  previousWeeks: number[]
  /** Open cards snoozed this week, with their total snooze count. */
  snoozed: Array<{ title: string; count: number }>
  /** Open cards overdue by more than a week. */
  overdue: string[]
}

export interface WeekSummary {
  kept: string[]; skipped: string[]; putOff: string[]
  bestTime: string | null; bestDay: string | null
  done: number; previousAvg: number | null
}

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const local = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return { day: `${p['year']}-${p['month']}-${p['day']}`, hour: Number(p['hour']), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p['weekday']!) }
}

export function summarize(w: WeekInput, tz: string): WeekSummary {
  // Rhythm: taken on 5+ different days = kept up; skipped 2+ times = kept skipping.
  const byName = new Map<string, { taken: Set<string>; skipped: number }>()
  for (const d of w.doses) {
    const e = byName.get(d.name) ?? { taken: new Set<string>(), skipped: 0 }
    if (d.status === 'taken') e.taken.add(local(d.at, tz).day); else if (d.status === 'skipped') e.skipped++
    byName.set(d.name, e)
  }
  const kept = [...byName].filter(([, e]) => e.taken.size >= 5).sort((a, b) => b[1].taken.size - a[1].taken.size)
    .map(([n, e]) => `${n} ${e.taken.size}/7`)
  const skipped = [...byName].filter(([, e]) => e.skipped >= 2).sort((a, b) => b[1].skipped - a[1].skipped)
    .map(([n, e]) => `${n} skipped ${e.skipped}×`)
  const putOff = [
    ...w.snoozed.filter(s => s.count >= 2).sort((a, b) => b.count - a.count).map(s => `${s.title} (snoozed ${s.count}×)`),
    ...w.overdue.map(t => `${t} (overdue over a week)`),
  ].slice(0, 4)

  // When things get done: part of the day and weekday with the most finished (doses taken count too).
  const moments = [...w.done.map(d => d.at), ...w.doses.filter(d => d.status === 'taken').map(d => d.at)].map(d => local(d, tz))
  const part = (h: number) => (h < 12 ? 'mornings' : h < 17 ? 'afternoons' : 'evenings')
  const top = <T,>(xs: T[]) => {
    const n = new Map<T, number>(); for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
    const s = [...n].sort((a, b) => b[1] - a[1])
    return s.length && (s.length === 1 || s[0]![1] > s[1]![1]) ? s[0]![0] : null   // no clear winner → say nothing
  }
  const bestTime = moments.length >= 5 ? top(moments.map(m => part(m.hour))) : null
  const dow = moments.length >= 7 ? top(moments.map(m => m.dow)) : null
  const prev = w.previousWeeks.filter(n => n > 0)
  return {
    kept, skipped, putOff, bestTime, bestDay: dow === null ? null : DAYS[dow]!,
    done: w.done.length, previousAvg: prev.length ? Math.round(prev.reduce((a, b) => a + b, 0) / prev.length) : null,
  }
}

/** One line for the trail: "📈 Your week: Kept up: … · Kept skipping: … · Most done: mornings, Tuesdays · 23 things done". */
export function text(s: WeekSummary): string | null {
  const parts = [
    s.kept.length ? `Kept up: ${s.kept.slice(0, 3).join(', ')}` : '',
    s.skipped.length ? `Kept skipping: ${s.skipped.slice(0, 3).join(', ')}` : '',
    s.putOff.length ? `Put off: ${s.putOff.slice(0, 3).join(', ')}` : '',
    s.bestTime || s.bestDay ? `Most done: ${[s.bestTime, s.bestDay].filter(Boolean).join(', ')}` : '',
    s.done ? `${s.done} thing${s.done === 1 ? '' : 's'} done` + (s.previousAvg !== null ? ` (usually ${s.previousAvg})` : '') : '',
  ].filter(Boolean)
  return parts.length ? `📈 Your week: ${parts.join(' · ')}` : null
}

export async function run(c: Core, caller: Caller, tz: string, now = new Date()) {
  const weekStart = new Date(now.getTime() - 7 * DAY), monthStart = new Date(now.getTime() - 28 * DAY)
  const [doseRows, cards, items, snoozed, overdue, rhythm] = await Promise.all([
    c.trail.ofType(caller, ['ah-meds/dose@1', 'ah-rhythm/did@1'], weekStart).catch(() => []),
    c.cards.completedSince(caller, monthStart),
    c.lists.doneSince(caller, monthStart),
    c.cards.snoozedSince(caller, weekStart),
    c.cards.overdue(caller, weekStart, now, 5),
    c.lists.space(caller, 'rhythm'),
  ])
  const finished = [
    ...cards.map(d => ({ title: String(d['title']), at: (d['completed_at'] ?? (d['recurrence'] as { last_completed_at?: Date } | null)?.last_completed_at) as Date })),
    // Ah! Rhythm's mirror list is already counted through its doses.
    ...items.filter(d => !rhythm || String(d['space_id']) !== String(rhythm._id)).map(d => ({ title: String(d['title']), at: d['done_at'] as Date })),
  ].filter(d => d.at)
  const inWeek = (at: Date) => at >= weekStart
  const previousWeeks = [1, 2, 3].map(k => finished.filter(d => d.at >= new Date(weekStart.getTime() - k * 7 * DAY) && d.at < new Date(weekStart.getTime() - (k - 1) * 7 * DAY)).length)
  const summary = summarize({
    doses: doseRows.map(r => ({ name: String(r.meta['med'] ?? r.text), status: String(r.meta['status'] ?? 'taken'), at: new Date(String(r.meta['at'] ?? r.ts)) })),
    done: finished.filter(d => inWeek(d.at)),
    previousWeeks,
    snoozed: snoozed.map((d: Doc) => ({ title: String(d['title']), count: Number(d['defer_count'] ?? 1) })),
    overdue: overdue.map(d => String(d['title'])),
  }, tz)
  const line = text(summary)
  if (!line) return { wrote: null }
  await c.trail.append(caller, {
    text: line, tone: 'neutral', source: ID, tags: ['patterns'],
    meta: { type: TYPE, week_start: weekStart.toISOString(), week_end: now.toISOString(), ...summary },
  })
  return { wrote: line }
}
