import { describe, it, expect } from 'vitest'
import { matches, render, trackerSchema, type Entry } from '../src/trackers/match.js'

const lauriHome: Entry = {
  id: '1', text: '🏠 Lauri got home', source: 'presence', tags: ['home', 'presence'],
  meta: { person: 'Lauri', device: { mac: 'f8:ef' } }, ts: '2026-10-15T21:42:00Z', space_ref: 'dbrown/trail/log',
}

describe('tracker matching', () => {
  it('matches on any mix of trail, source, tag, type, text and a meta field, ignoring case', () => {
    expect(matches({ source: 'presence', tag: 'HOME', field: { key: 'person', value: 'lauri' } }, lauriHome)).toBe(true)
    expect(matches({ trail: 'log', text: 'got home' }, lauriHome)).toBe(true)
    expect(matches({ field: { key: 'device.mac', value: 'F8:EF' } }, lauriHome)).toBe(true)
    expect(matches({ tag: 'away' }, lauriHome)).toBe(false)
    expect(matches({ trail: 'work' }, lauriHome)).toBe(false)
    expect(matches({ field: { key: 'person', value: 'David' } }, lauriHome)).toBe(false)
    expect(matches({ type: 'ah-rhythm/hold@1' }, lauriHome)).toBe(false)
  })

  it('renders templates; unknown placeholders are empty', () => {
    expect(render('{meta.person} is home ({time})', lauriHome, 'America/New_York')).toBe('Lauri is home (5:42 PM)')
    expect(render('{text} · {nope}', lauriHome, 'UTC')).toBe('🏠 Lauri got home ·')
  })

  it('needs something to match on and something to do; blank form fields count as unset', () => {
    expect(() => trackerSchema.parse({ name: 'x', match: { source: ' ' }, notify: { text: 'hi' } })).toThrow()
    expect(() => trackerSchema.parse({ name: 'x', match: { source: 'presence' } })).toThrow()
    const t = trackerSchema.parse({ name: 'x', match: { source: 'presence', tag: '' }, status: { label: 'Lauri', value: 'home' } })
    expect(t.match.tag).toBeUndefined()
    expect(t.status?.today).toBe(true)
  })
})
