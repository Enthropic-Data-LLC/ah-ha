import { z } from 'zod'

/**
 * Trackers: plain rules that watch the trail. The trail is the open door for incoming
 * information — the router, Ah! Rhythm, NFC taps, webhooks, anything with a key — and
 * a tracker says which entries matter: "when an entry like this arrives, tell me, and/or
 * keep a status". Nothing downstream (Ah! Today, Link) knows where an entry came from.
 */

/** '' from a form means "not set". */
const opt = (max: number) => z.string().max(max).optional().transform(v => v?.trim() || undefined)

export const matchSchema = z.object({
  /** A trail's slug; unset = any trail. */
  trail: opt(100),
  source: opt(40),
  tag: opt(40),
  /** meta.type, e.g. ah-rhythm/hold@1 */
  type: opt(80),
  /** The text contains this (any case). */
  text: opt(200),
  /** meta.<key> equals this value (any case). */
  field: z.object({ key: z.string().regex(/^[\w.]{1,60}$/, 'letters, digits, _ and .'), value: z.string().min(1).max(200) }).optional(),
}).refine(m => Object.values(m).some(v => v !== undefined), 'Match on at least one thing')

export const trackerSchema = z.object({
  name: z.string().min(1).max(100),
  on: z.boolean().default(true),
  match: matchSchema,
  /** Push to the owner's phone. Text is a template: {text}, {source}, {tags}, {time}, {meta.person}… */
  notify: z.object({ text: z.string().min(1).max(300) }).nullable().default(null),
  /** Keep a named status ("Lauri" → "home"); `today` shows it on Ah! Today. */
  status: z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(100), today: z.boolean().default(true) }).nullable().default(null),
}).refine(t => t.notify || t.status, 'A tracker needs to notify, keep a status, or both')

export type Match = z.infer<typeof matchSchema>
export type TrackerBody = z.infer<typeof trackerSchema>

/** A trail entry as trackers see it (the Link event's entry, plus which trail). */
export interface Entry {
  id: string
  text: string
  source: string
  tags: string[]
  meta: Record<string, unknown>
  ts: string
  space_ref?: string
}

const lc = (v: unknown) => String(v ?? '').toLowerCase()

/** meta.a.b → value, for field matches and {meta.a.b} placeholders. */
export function metaAt(meta: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), meta)
}

export function matches(m: Match, e: Entry): boolean {
  if (m.trail && !(e.space_ref ?? '').toLowerCase().endsWith(`/trail/${m.trail.toLowerCase()}`)) return false
  if (m.source && lc(e.source) !== lc(m.source)) return false
  if (m.tag && !e.tags.some(t => lc(t) === lc(m.tag))) return false
  if (m.type && lc(e.meta['type']) !== lc(m.type)) return false
  if (m.text && !lc(e.text).includes(lc(m.text))) return false
  if (m.field && lc(metaAt(e.meta, m.field.key)) !== lc(m.field.value)) return false
  return true
}

/** {text} {source} {tags} {time} {meta.x} — unknown placeholders render empty. */
export function render(tpl: string, e: Entry, tz: string): string {
  return tpl.replace(/\{([\w.]+)\}/g, (_, k: string) => {
    if (k === 'text') return e.text
    if (k === 'source') return e.source
    if (k === 'tags') return e.tags.join(', ')
    if (k === 'time') {
      try { return new Date(e.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) }
      catch { return new Date(e.ts).toISOString().slice(11, 16) }
    }
    if (k.startsWith('meta.')) { const v = metaAt(e.meta, k.slice(5)); return v == null ? '' : String(v) }
    return ''
  }).trim()
}
