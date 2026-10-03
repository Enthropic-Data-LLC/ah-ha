import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import { getPool } from './timescale.js'
import type { Place } from './places.js'

/**
 * The user's situation right now, built only from data Ah-Ha already keeps: the
 * check-in, calendar feeds, trail entries (router presence, Ah! Meds doses and PHN
 * scores, the evening wrap-up, manual overrides), completions, and Open-Meteo for
 * weather. Today ranks with it; every field is optional and degrades to null.
 *
 * Overrides are ordinary trail entries, so nothing new is stored:
 *   meta.type "situation/energy@1"  { level: low | normal | high }   (today only)
 *   meta.type "situation/day@1"     { day: off | normal }            (today only)
 */

export type Energy = 'low' | 'normal' | 'high'

export interface Situation {
  place: Place | null
  day: { tod: string; weekend: boolean; off: boolean }
  next: { title: string; start: string; minutes: number; location: string | null } | null
  weather: { temp_f: number; code: number; rain_chance_6h: number; rain_at: string | null; sunset: string | null; daylight_min: number | null } | null
  people: Array<{ name: string; home: boolean; since: string }>
  energy: { level: Energy; why: string; phn: number | null; mood: string | null; override: Energy | null }
  meds: { last_dose_at: string | null; minutes_since: number | null }
  momentum: { last_done: string | null; minutes_since: number | null }
}

interface CalEvent { title: string; start: string; all_day: boolean; location?: string }

const WEATHER_TTL_S = 30 * 60

const minutesSince = (d: Date | string | null | undefined, now: Date) =>
  d ? Math.round((now.getTime() - new Date(d).getTime()) / 60_000) : null

/** Start of the user's local day, as a Date (for "today" trail queries). */
function localDayStart(now: Date, tz: string): Date {
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const offset = local.getTime() - now.getTime()
  local.setHours(0, 0, 0, 0)
  return new Date(local.getTime() - offset)
}

/** Weather for a spot, cached per ~1 km so the minute-by-minute /api/now poll costs nothing. */
async function weather(fastify: FastifyInstance, lat: number, lng: number, now: Date): Promise<Situation['weather']> {
  const key = `aha:weather:${lat.toFixed(2)}:${lng.toFixed(2)}`
  let raw = await fastify.redis.get(key).catch(() => null)
  if (!raw) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
      '&current=temperature_2m,weather_code&hourly=precipitation_probability&daily=sunset' +
      '&temperature_unit=fahrenheit&timezone=UTC&forecast_days=2'
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    raw = await res.text()
    await fastify.redis.setex(key, WEATHER_TTL_S, raw).catch(() => {})
  }
  const w = JSON.parse(raw) as {
    current: { temperature_2m: number; weather_code: number }
    hourly: { time: string[]; precipitation_probability: number[] }
    daily: { sunset: string[] }
  }
  // Open-Meteo returns UTC times without a zone suffix when timezone=UTC.
  const utc = (s: string) => new Date(s.endsWith('Z') ? s : `${s}Z`)
  const ahead = w.hourly.time.map((t, i) => ({ t: utc(t), p: w.hourly.precipitation_probability[i] ?? 0 }))
    .filter(h => h.t.getTime() > now.getTime() - 3_600_000 && h.t.getTime() <= now.getTime() + 6 * 3_600_000)
  const firstWet = ahead.find(h => h.p >= 50)
  const sunset = w.daily.sunset.map(utc).find(s => s.getTime() > now.getTime()) ?? null
  return {
    temp_f: Math.round(w.current.temperature_2m),
    code: w.current.weather_code,
    rain_chance_6h: Math.max(0, ...ahead.map(h => h.p)),
    rain_at: firstWet ? firstWet.t.toISOString() : null,
    sunset: sunset ? sunset.toISOString() : null,
    daylight_min: sunset ? Math.round((sunset.getTime() - now.getTime()) / 60_000) : null,
  }
}

export async function situation(
  fastify: FastifyInstance,
  opts: { orgId: ObjectId; tz: string; tod: string; place: Place | null; calendar: CalEvent[]; now?: Date },
): Promise<Situation> {
  const now = opts.now ?? new Date()
  const org = opts.orgId.toString()
  const dayStart = localDayStart(now, opts.tz)
  const pool = getPool()
  const q = <T>(sql: string, params: unknown[]) =>
    pool.query(sql, params).then(r => r.rows as T[]).catch(() => [] as T[])

  // Trail-backed signals, all in parallel.
  const [presence, scores, overrides, wrapups, doses] = await Promise.all([
    // Latest router presence entry per person in the last 2 weeks.
    q<{ person: string; tags: string[]; ts: Date }>(
      `SELECT DISTINCT ON (meta->>'person') meta->>'person' AS person, tags, ts
         FROM trail_entries WHERE org_id = $1 AND source = 'presence' AND meta ? 'person' AND ts > now() - interval '14 days'
        ORDER BY meta->>'person', ts DESC`, [org]),
    q<{ value: number; ts: Date }>(
      `SELECT (meta->>'value')::int AS value, ts FROM trail_entries
        WHERE org_id = $1 AND meta->>'type' = 'ah-meds/score@1' AND meta->>'kind' = 'phn' AND ts >= $2
        ORDER BY ts DESC LIMIT 1`, [org, dayStart]),
    q<{ type: string; meta: Record<string, unknown> }>(
      `SELECT meta->>'type' AS type, meta FROM trail_entries
        WHERE org_id = $1 AND meta->>'type' IN ('situation/energy@1', 'situation/day@1') AND ts >= $2
        ORDER BY ts DESC`, [org, dayStart]),
    // Last evening wrap-up (yesterday evening or today).
    q<{ tone: string; ts: Date }>(
      `SELECT tone, ts FROM trail_entries WHERE org_id = $1 AND text LIKE '🌙 How today felt%' AND ts > $2
        ORDER BY ts DESC LIMIT 1`, [org, new Date(dayStart.getTime() - 86_400_000)]),
    q<{ ts: Date }>(
      `SELECT ts FROM trail_entries WHERE org_id = $1 AND ts >= $2 AND (
          (meta->>'type' = 'ah-meds/dose@1' AND meta->>'status' = 'taken') OR
          (source = 'nfc' AND text ~* '(\\mmeds?\\M|\\mpills?\\M|medication|💊)'))
        ORDER BY ts DESC LIMIT 1`, [org, dayStart]),
  ])

  // Momentum: the latest thing finished today.
  const [card] = await fastify.mongo.collection('board_cards')
    .find({ org_id: opts.orgId, completed_at: { $gte: dayStart } }).sort({ completed_at: -1 }).limit(1).toArray()
  const [item] = await fastify.mongo.collection('list_items')
    .find({ org_id: opts.orgId, done: true, done_at: { $gte: dayStart } }).sort({ done_at: -1 }).limit(1).toArray()
  const lastDone = [card && { t: card['completed_at'] as Date, title: card['title'] as string }, item && { t: item['done_at'] as Date, title: item['title'] as string }]
    .filter((x): x is { t: Date; title: string } => !!x).sort((a, b) => b.t.getTime() - a.t.getTime())[0] ?? null

  // Weather: at the checked-in place if it has a location, otherwise home.
  let w: Situation['weather'] = null
  try {
    const ents = await fastify.mongo.collection('entities')
      .find({ org_id: opts.orgId, deleted_at: { $exists: false }, 'signatures.kind': 'gps' }).toArray()
    const spot = ents.find(e => opts.place && String(e['_id']) === opts.place._id) ??
      ents.find(e => String(e['name']).toLowerCase() === 'home')
    const gps = (spot?.['signatures'] as Array<{ kind: string; lat: number; lng: number }> | undefined)?.find(s => s.kind === 'gps')
    if (gps) w = await weather(fastify, gps.lat, gps.lng, now)
  } catch { /* weather is a nice-to-have */ }

  // Next commitment: the first timed calendar event still ahead.
  const nextEv = opts.calendar.filter(e => !e.all_day && new Date(e.start).getTime() > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]

  const energyOverride = overrides.find(o => o.type === 'situation/energy@1')?.meta['level'] as Energy | undefined
  // Latest of each kind today wins (rows come newest first).
  const off = overrides.find(o => o.type === 'situation/day@1')?.meta['day'] === 'off'
  const phn = scores[0]?.value ?? null
  const mood = wrapups[0]?.tone ?? null
  // Your word first; then pain; then how yesterday felt.
  const [level, why]: [Energy, string] =
    energyOverride ? [energyOverride, 'you said so'] :
    off ? ['low', 'day off'] :
    phn != null && phn >= 7 ? ['low', `PHN ${phn}/10`] :
    phn != null && phn <= 3 && mood !== 'sorrow' ? ['high', `PHN ${phn}/10`] :
    mood === 'sorrow' ? ['low', 'rough evening yesterday'] :
    ['normal', phn != null ? `PHN ${phn}/10` : 'no signal']

  const localDow = new Date(now.toLocaleString('en-US', { timeZone: opts.tz })).getDay()
  return {
    place: opts.place,
    day: { tod: opts.tod, weekend: localDow === 0 || localDow === 6, off },
    next: nextEv ? {
      title: nextEv.title, start: nextEv.start, location: nextEv.location ?? null,
      minutes: Math.round((Date.parse(nextEv.start) - now.getTime()) / 60_000),
    } : null,
    weather: w,
    people: presence.map(p => ({ name: p.person, home: (p.tags ?? []).includes('home'), since: new Date(p.ts).toISOString() })),
    energy: { level, why, phn, mood, override: energyOverride ?? null },
    meds: { last_dose_at: doses[0] ? new Date(doses[0].ts).toISOString() : null, minutes_since: minutesSince(doses[0]?.ts, now) },
    momentum: { last_done: lastDone?.title ?? null, minutes_since: minutesSince(lastDone?.t, now) },
  }
}
