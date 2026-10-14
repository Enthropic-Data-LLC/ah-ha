import { describe, it, expect } from 'vitest'
import { normalize, suggest, readList, readTrips, type Purchase } from '../src/modules/restock.js'
import { cleanStep } from '../src/modules/followthrough.js'
import { summarize, text } from '../src/modules/patterns.js'

const DAY = 86_400_000
const now = new Date('2026-10-14T16:00:00Z')
const ago = (d: number) => new Date(now.getTime() - d * DAY)

describe('Restock', () => {
  it('treats the same thing written differently as one item', () => {
    expect(normalize('Chicken leg quarters 10 lb bag x2 (plain, no broth/solution)')).toBe('chicken leg quarters')
    expect(normalize('Extra: Red cabbage #2')).toBe('red cabbage')
    expect(normalize('Red cabbage x1')).toBe('red cabbage')
    expect(normalize('Hemp hearts 12 oz')).toBe('hemp hearts')
    expect(normalize('Canned diced tomatoes x5 (plain)')).toBe('canned diced tomatoes')
  })

  const buys = (key: string, days: number[]): Purchase[] => days.map(d => ({ key, title: key, at: ago(d) }))

  it('suggests an item once most of its usual gap has passed', () => {
    const s = suggest(buys('milk', [27, 18, 9]), new Set(), new Map(), now)   // every 9 days, last 9 days ago
    expect(s.map(x => x.key)).toEqual(['milk'])
    expect(s[0]!.reason).toBe('You buy this about every 9 days; last time 9 days ago')
  })

  it('waits for three purchase days, and until it is nearly due', () => {
    expect(suggest(buys('milk', [18, 9]), new Set(), new Map(), now)).toEqual([])          // only two days
    expect(suggest(buys('milk', [22, 13, 4]), new Set(), new Map(), now)).toEqual([])      // 4 of 9 days
    expect(suggest(buys('milk', [9, 9, 9]), new Set(), new Map(), now)).toEqual([])        // one day, three times
  })

  it('never duplicates an open item, and backs off after a deleted suggestion', () => {
    const p = buys('milk', [27, 18, 9])
    expect(suggest(p, new Set(['milk']), new Map(), now)).toEqual([])
    expect(suggest(p, new Set(), new Map([['milk', ago(5)]]), now)).toEqual([])     // declined 5 days ago, interval 9
    expect(suggest(p, new Set(), new Map([['milk', ago(30)]]), now)).toHaveLength(1)
  })

  it('caps how many it adds and puts the most overdue first', () => {
    const p = [...buys('eggs', [21, 14, 7]), ...buys('milk', [36, 27, 18]), ...buys('bread', [13, 9, 5]), ...buys('rice', [90, 60, 30])]
    expect(suggest(p, new Set(), new Map(), now, 2).map(s => s.key)).toEqual(['milk', 'bread'])
  })

  it('reads purchases, open items and declines from the list, and lines from Ah! Cart trips', () => {
    const r = readList([
      { _id: 1 as never, title: 'Milk', done: true, done_at: ago(9) },
      { _id: 2 as never, title: 'Eggs x12', done: false },
      { _id: 3 as never, title: 'Bread', done: false, deleted_at: ago(2), source: 'ah-restock' },
      { _id: 4 as never, title: 'Rice', done: false, deleted_at: ago(2) },
    ])
    expect(r.purchases.map(p => p.key)).toEqual(['milk'])
    expect([...r.open]).toEqual(['eggs'])
    expect([...r.declined.keys()]).toEqual(['bread'])
    const t = readTrips([{ ts: ago(3), meta: { shopped_at: ago(3).toISOString(), items: [{ name: 'Bananas' }, { name: '' }] } }])
    expect(t.map(p => p.key)).toEqual(['bananas'])
  })
})

describe('Follow-through', () => {
  it('keeps the first step to one plain line', () => {
    expect(cleanStep('"Open the invoice email and star it."')).toBe('Open the invoice email and star it.')
    expect(cleanStep('First step: put the form on the table\nThen…')).toBe('put the form on the table')
    expect(cleanStep('   ')).toBeNull()
    expect(cleanStep('x'.repeat(200))!.length).toBeLessThanOrEqual(90)
  })
})

describe('Weekly patterns', () => {
  const tz = 'America/New_York'
  const at = (d: number, h: number) => new Date(Date.parse(`2026-10-${String(8 + d).padStart(2, '0')}T${String(h + 4).padStart(2, '0')}:00:00Z`))  // h = local hour (EDT)

  it('finds what was kept up, skipped and put off, and when most got done', () => {
    const doses = [
      ...[0, 1, 2, 3, 4, 5, 6].map(d => ({ name: 'Fish oil', status: 'taken', at: at(d, 8) })),
      ...[0, 2, 4].map(d => ({ name: 'Evening walk', status: 'skipped', at: at(d, 18) })),
    ]
    const s = summarize({
      doses, done: [at(1, 9), at(1, 10), at(3, 15)].map(a => ({ title: 'x', at: a })),
      previousWeeks: [2, 4, 0], snoozed: [{ title: 'Call the plumber', count: 3 }, { title: 'Once', count: 1 }], overdue: ['Taxes'],
    }, tz)
    expect(s.kept).toEqual(['Fish oil 7/7'])
    expect(s.skipped).toEqual(['Evening walk skipped 3×'])
    expect(s.putOff).toEqual(['Call the plumber (snoozed 3×)', 'Taxes (overdue over a week)'])
    expect(s.bestTime).toBe('mornings')
    expect(s.previousAvg).toBe(3)
    expect(text(s)).toBe('📈 Your week: Kept up: Fish oil 7/7 · Kept skipping: Evening walk skipped 3× · Put off: Call the plumber (snoozed 3×), Taxes (overdue over a week) · Most done: mornings, Fridays · 3 things done (usually 3)')
  })

  it('says nothing when there is nothing to say', () => {
    expect(text(summarize({ doses: [], done: [], previousWeeks: [], snoozed: [], overdue: [] }, tz))).toBeNull()
  })
})
