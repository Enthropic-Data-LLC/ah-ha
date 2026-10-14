import { describe, it, expect } from 'vitest'
import { startOfDay } from '../src/lib/repeat.js'

describe('startOfDay', () => {
  it('is local midnight in the given zone', () => {
    // 2026-10-14 03:30 UTC is 23:30 on the 13th in New York (EDT, UTC−4).
    const at = new Date('2026-10-14T03:30:00Z')
    expect(startOfDay('America/New_York', at).toISOString()).toBe('2026-10-13T04:00:00.000Z')
    expect(startOfDay('UTC', at).toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(startOfDay('Asia/Tokyo', at).toISOString()).toBe('2026-10-13T15:00:00.000Z')
  })
  it('throws on a bad zone (callers fall back)', () => {
    expect(() => startOfDay('Not/AZone')).toThrow()
  })
})
