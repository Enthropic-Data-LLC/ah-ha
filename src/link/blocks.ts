import { z } from 'zod'

/**
 * Ah! Link flows — one JSON shape for plain rules and Scratch-style programs.
 *
 *   { "type": "ah-link/flow@1", "name": "…", "on": true,
 *     "trigger": { "block": "arrived", "place": "Walmart" },
 *     "steps": [ { "block": "if", "cond": {…}, "then": [ … ], "else": [ … ] }, … ] }
 *
 * A plain rule is a trigger plus a short stack; a "flowchart" is the same thing with
 * control blocks (if / repeat / wait). C-blocks hold their own stacks, as in Scratch.
 * Text fields are templates: {event.text}, {event.meta.store}, {vars.x},
 * {situation.weather.temp_f}, {now.time}.
 *
 * Flows live in Note spaces whose `format` is 'workflow'; the note body is the flow JSON.
 */

export const FLOW_TYPE = 'ah-link/flow@1'
export const MAX_REPEAT = 20
export const MAX_WAIT_MIN = 7 * 24 * 60

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm, 24-hour')
const val = z.union([z.string().max(2000), z.number()])

export const trigger = z.discriminatedUnion('block', [
  z.object({ block: z.literal('trail_entry'), source: z.string().optional(), tag: z.string().optional(), type: z.string().optional(), text: z.string().optional() }),
  z.object({ block: z.literal('arrived'), place: z.string() }),
  z.object({ block: z.literal('left'), place: z.string() }),
  z.object({ block: z.literal('person_home'), person: z.string() }),
  z.object({ block: z.literal('person_left'), person: z.string() }),
  z.object({ block: z.literal('schedule'), at: hhmm, days: z.array(z.number().int().min(0).max(6)).optional() }),
  z.object({ block: z.literal('manual') }),
])
export type Trigger = z.infer<typeof trigger>

export type Cond =
  | { block: 'compare'; left: string | number; op: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains'; right: string | number }
  | { block: 'and' | 'or'; all: Cond[] }
  | { block: 'not'; cond: Cond }
  | { block: 'energy_is'; level: 'low' | 'normal' | 'high' }
  | { block: 'at_place'; place: string }
  | { block: 'person_home'; person: string }
  | { block: 'rain_within'; hours: number }
  | { block: 'time_between'; from: string; to: string }
  | { block: 'weekend' }
  | { block: 'list_has_items'; list: string; at?: string }

export const cond: z.ZodType<Cond> = z.lazy(() => z.discriminatedUnion('block', [
  z.object({ block: z.literal('compare'), left: val, op: z.enum(['==', '!=', '>', '>=', '<', '<=', 'contains']), right: val }),
  z.object({ block: z.literal('and'), all: z.array(cond).min(1) }),
  z.object({ block: z.literal('or'), all: z.array(cond).min(1) }),
  z.object({ block: z.literal('not'), cond }),
  z.object({ block: z.literal('energy_is'), level: z.enum(['low', 'normal', 'high']) }),
  z.object({ block: z.literal('at_place'), place: z.string() }),
  z.object({ block: z.literal('person_home'), person: z.string() }),
  z.object({ block: z.literal('rain_within'), hours: z.number().min(0.25).max(48) }),
  z.object({ block: z.literal('time_between'), from: hhmm, to: hhmm }),
  z.object({ block: z.literal('weekend') }),
  z.object({ block: z.literal('list_has_items'), list: z.string(), at: z.string().optional() }),
]) as z.ZodType<Cond>)

export type Step =
  | { block: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  | { block: 'repeat'; times: number; do: Step[] }
  | { block: 'wait'; minutes: number }
  | { block: 'stop' }
  | { block: 'set'; var: string; value: string | number }
  | { block: 'log'; text: string; tone?: 'happy' | 'neutral' | 'sorrow'; tags?: string[]; trail?: string }
  | { block: 'list_add'; list: string; title: string; place?: string }
  | { block: 'card_add'; board: string; title: string }
  | { block: 'notify'; text: string }
  | { block: 'set_energy'; level: 'low' | 'normal' | 'high' }
  | { block: 'webhook'; url: string; method?: 'POST' | 'GET' | 'PUT'; body?: string }

export const step: z.ZodType<Step> = z.lazy(() => z.discriminatedUnion('block', [
  z.object({ block: z.literal('if'), cond, then: z.array(step), else: z.array(step).optional() }),
  z.object({ block: z.literal('repeat'), times: z.number().int().min(1).max(MAX_REPEAT), do: z.array(step) }),
  z.object({ block: z.literal('wait'), minutes: z.number().min(1).max(MAX_WAIT_MIN) }),
  z.object({ block: z.literal('stop') }),
  z.object({ block: z.literal('set'), var: z.string().regex(/^\w{1,40}$/), value: val }),
  z.object({ block: z.literal('log'), text: z.string().min(1).max(500), tone: z.enum(['happy', 'neutral', 'sorrow']).optional(), tags: z.array(z.string()).max(10).optional(), trail: z.string().optional() }),
  z.object({ block: z.literal('list_add'), list: z.string(), title: z.string().min(1).max(500), place: z.string().optional() }),
  z.object({ block: z.literal('card_add'), board: z.string(), title: z.string().min(1).max(500) }),
  z.object({ block: z.literal('notify'), text: z.string().min(1).max(500) }),
  z.object({ block: z.literal('set_energy'), level: z.enum(['low', 'normal', 'high']) }),
  z.object({ block: z.literal('webhook'), url: z.string().url().startsWith('https://'), method: z.enum(['POST', 'GET', 'PUT']).optional(), body: z.string().max(5000).optional() }),
]) as z.ZodType<Step>)

export const flow = z.object({
  type: z.literal(FLOW_TYPE),
  name: z.string().min(1).max(100),
  /** What it's for, in words (shown above the blocks). */
  about: z.string().max(2000).optional(),
  on: z.boolean().default(true),
  trigger,
  steps: z.array(step).max(100),
})
export type Flow = z.infer<typeof flow>

/** What each block is, for the editor's palette and for people reading a flow. */
export const CATALOGUE = {
  triggers: {
    trail_entry: 'A trail entry arrives (filter by source, tag, meta.type or text)',
    arrived: 'You arrive at a place',
    left: 'You leave a place',
    person_home: 'Someone gets home (router)',
    person_left: 'Someone leaves home (router)',
    schedule: 'At a time of day, optionally on certain weekdays',
    manual: 'Only when run by hand (or an NFC tag)',
  },
  conditions: {
    compare: 'Compare two values (templates allowed)',
    and: 'All of these', or: 'Any of these', not: 'Not this',
    energy_is: 'Energy is low / normal / high',
    at_place: 'You are checked in at a place',
    person_home: 'Someone is home',
    rain_within: 'Rain is forecast within N hours',
    time_between: 'The time is between two times',
    weekend: "It's the weekend",
    list_has_items: 'A list has open items (optionally tagged to a place)',
  },
  steps: {
    if: 'If … then … else …', repeat: 'Repeat N times', wait: 'Wait N minutes (survives restarts)', stop: 'Stop the flow',
    set: 'Remember a value as {vars.name}',
    log: 'Write a trail entry', list_add: 'Add an item to a list', card_add: 'Add a card to a board',
    notify: 'Send a notification (Telegram)', set_energy: "Set today's energy", webhook: 'Call an https URL',
  },
} as const
