import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import type { Redis } from 'ioredis'
import { signJWT } from '../lib/jwt.js'
import { postToNodeRed } from '../lib/nodered.js'
import { situation as buildSituation, type Situation } from '../lib/situation.js'
import { currentPlace, orgPlaces } from '../lib/places.js'
import type { Cond, Flow, Step, Trigger } from './blocks.js'
import { loadFlows, type StoredFlow } from './flows.js'

/**
 * The Ah! Link engine, inside the API process.
 *
 * Events arrive on Redis channel `aha:events` (published by the trail append, the
 * webhook receiver and check-ins); a minute tick runs schedule triggers and resumes
 * waits. Actions go through the real API routes (fastify.inject as the flow's owner),
 * so validation, the trail hash chain and permissions all apply. Every run is
 * recorded as a trail entry (meta.type ah-link/run@1).
 *
 * Guardrails: a flow never triggers on its own output; flow-caused events stop
 * after LINK_DEPTH hops; RUNS_PER_HOUR per flow; MAX_STEPS per run.
 */

export const EVENTS = 'aha:events'
const WAITS = 'aha:link:waits'
const LINK_DEPTH = 2
const RUNS_PER_HOUR = 30
const MAX_STEPS = 200

export type AhEvent =
  | { kind: 'trail'; org_id: string; entry: { id: string; text: string; tone: string; source: string; tags: string[]; meta: Record<string, unknown>; ts: string } }
  | { kind: 'place'; org_id: string; from: string | null; to: string | null }

/** Publishes an event for Ah! Link. Fire-and-forget: a failure must never break the caller. */
export function emit(redis: Redis, ev: AhEvent) {
  redis.publish(EVENTS, JSON.stringify(ev)).catch(() => {})
}

interface Ctx {
  event: Record<string, unknown>
  vars: Record<string, string | number>
  /** Hops of flow-caused events behind this run. */
  depth: number
}

/** Where a run is in its stack of stacks: a path into the flow JSON + the next index. */
interface Frame { path: (string | number)[]; index: number; repeatLeft?: number }

export interface RunResult { status: 'done' | 'waiting' | 'stopped' | 'error' | 'skipped'; actions: string[]; error?: string }

export function startEngine(fastify: FastifyInstance) {
  const log = fastify.log.child({ mod: 'ah-link' })
  const sub = fastify.redis.duplicate()

  // ---- helpers ------------------------------------------------------------------

  const at = (obj: unknown, path: (string | number)[]): unknown =>
    path.reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]), obj)

  /** {a.b.c} placeholders, from the run's context. Unknown paths render empty. */
  const render = (tpl: string | number, scope: Record<string, unknown>): string =>
    typeof tpl === 'number' ? String(tpl)
      : tpl.replace(/\{([\w.]+)\}/g, (_, p: string) => {
        const v = at(scope, p.split('.'))
        return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      })

  async function sessionFor(owner: ObjectId) {
    const user = await fastify.mongo.collection('users').findOne({ _id: owner })
    if (!user) throw new Error('flow owner not found')
    // Same shape auth.ts issues at sign-in: a user's org id is their own id.
    const token = await signJWT({ id: user['_id'] as ObjectId, orgId: user['_id'] as ObjectId, plan: (user['plan'] as never) ?? 'free', username: (user['username'] as string) ?? '' })
    return { cookie: `aha_session=${token}`, user }
  }

  async function api(cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
    const res = await fastify.inject({ method, url, headers: { cookie }, ...(payload ? { payload: payload as Record<string, unknown> } : {}) })
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body.slice(0, 120)}`)
    return res.json() as { data?: unknown }
  }

  /** The owner's time zone (from their briefing settings), for schedules and {now.time}. */
  async function ownerTz(owner: ObjectId): Promise<string> {
    const prefs = await fastify.mongo.collection('notification_prefs').findOne({ user_id: owner })
    return (prefs?.['daily_briefing'] as { timezone?: string } | undefined)?.timezone ?? 'America/New_York'
  }

  async function defaultTrail(orgId: ObjectId): Promise<string | null> {
    const t = await fastify.mongo.collection('spaces').findOne({ org_id: orgId, type: 'trail', deleted_at: { $exists: false } })
    return (t?.['slug'] as string) ?? null
  }

  // ---- conditions -----------------------------------------------------------------

  async function check(c: Cond, scope: Record<string, unknown>, sf: StoredFlow, sit: () => Promise<Situation | null>): Promise<boolean> {
    const s = async () => await sit()
    switch (c.block) {
      case 'and': { for (const x of c.all) if (!(await check(x, scope, sf, sit))) return false; return true }
      case 'or': { for (const x of c.all) if (await check(x, scope, sf, sit)) return true; return false }
      case 'not': return !(await check(c.cond, scope, sf, sit))
      case 'compare': {
        const l = render(c.left, scope), r = render(c.right, scope)
        const ln = Number(l), rn = Number(r), num = l !== '' && r !== '' && !isNaN(ln) && !isNaN(rn)
        switch (c.op) {
          case '==': return num ? ln === rn : l.toLowerCase() === r.toLowerCase()
          case '!=': return num ? ln !== rn : l.toLowerCase() !== r.toLowerCase()
          case 'contains': return l.toLowerCase().includes(r.toLowerCase())
          case '>': return num && ln > rn
          case '>=': return num && ln >= rn
          case '<': return num && ln < rn
          case '<=': return num && ln <= rn
        }
        return false
      }
      case 'energy_is': return (await s())?.energy.level === c.level
      case 'at_place': return (await s())?.place?.name.toLowerCase() === c.place.toLowerCase()
      case 'person_home': return !!(await s())?.people.find(p => p.home && p.name.toLowerCase() === c.person.toLowerCase())
      case 'rain_within': {
        const w = (await s())?.weather
        return !!w?.rain_at && Date.parse(w.rain_at) - Date.now() <= c.hours * 3_600_000
      }
      case 'weekend': return !!(await s())?.day.weekend
      case 'time_between': {
        const t = String(scope['now'] && (scope['now'] as Record<string, unknown>)['time'])
        return c.from <= c.to ? t >= c.from && t < c.to : t >= c.from || t < c.to
      }
      case 'list_has_items': {
        const { cookie } = await sessionFor(sf.ownerId)
        const q = c.at ? `?done=false&at=${encodeURIComponent(c.at)}` : '?done=false'
        const r = await api(cookie, 'GET', `/api/list/${encodeURIComponent(c.list)}/items${q}`)
        return Array.isArray(r.data) && r.data.length > 0
      }
    }
  }

  // ---- actions ----------------------------------------------------------------------

  async function act(stp: Step, scope: Record<string, unknown>, sf: StoredFlow, ctx: Ctx, dry: boolean): Promise<string> {
    const linkMeta = { link: { flow_id: sf.id, depth: ctx.depth + 1 } }
    const r = (s: string | number) => render(s, scope)
    switch (stp.block) {
      case 'set': ctx.vars[stp.var] = typeof stp.value === 'number' ? stp.value : r(stp.value); return `set ${stp.var} = ${ctx.vars[stp.var]}`
      case 'log': {
        const text = r(stp.text)
        if (!dry) {
          const { cookie } = await sessionFor(sf.ownerId)
          const trail = stp.trail ?? await defaultTrail(sf.orgId); if (!trail) throw new Error('no trail space')
          await api(cookie, 'POST', `/api/trail/${encodeURIComponent(trail)}/append`, { text, tone: stp.tone ?? 'neutral', source: 'ah-link', tags: stp.tags ?? [], meta: linkMeta })
        }
        return `log “${text}”`
      }
      case 'list_add': {
        const title = r(stp.title)
        if (!dry) {
          const { cookie } = await sessionFor(sf.ownerId)
          const res = await api(cookie, 'POST', `/api/list/${encodeURIComponent(stp.list)}/items`, { title }) as { data?: { _id?: string } }
          if (stp.place && res.data?._id) {
            const place = [...(await orgPlaces(fastify, sf.orgId)).values()].find(p => p.name.toLowerCase() === r(stp.place!).toLowerCase())
            if (place) await api(cookie, 'PATCH', `/api/list/${encodeURIComponent(stp.list)}/items/${res.data._id}`, { contexts: [{ entity_id: place._id, time_chunks: [] }] })
          }
        }
        return `add “${title}” to ${stp.list}` + (stp.place ? ` (at ${r(stp.place)})` : '')
      }
      case 'card_add': {
        const title = r(stp.title)
        if (!dry) {
          const { cookie } = await sessionFor(sf.ownerId)
          const cols = (await api(cookie, 'GET', `/api/board/${encodeURIComponent(stp.board)}/columns`)).data as Array<{ _id: string }>
          if (!cols?.length) throw new Error(`board ${stp.board} has no columns`)
          await api(cookie, 'POST', `/api/board/${encodeURIComponent(stp.board)}/cards`, { column_id: cols[0]!._id, title })
        }
        return `card “${title}” on ${stp.board}`
      }
      case 'notify': {
        const text = r(stp.text)
        if (!dry) {
          const { user } = await sessionFor(sf.ownerId)
          const pref = await fastify.mongo.collection('notification_prefs').findOne({ user_id: user['_id'] })
          const ch = (pref?.['channels'] as { telegram_chat_id?: string } | undefined) ?? {}
          await postToNodeRed('link', user['username'] as string, { message: `🔗 ${text}`, telegram_chat_id: ch.telegram_chat_id }, m => log.info(m))
        }
        return `notify “${text}”`
      }
      case 'set_energy': {
        if (!dry) { const { cookie } = await sessionFor(sf.ownerId); await api(cookie, 'POST', '/api/situation/energy', { level: stp.level }) }
        return `energy → ${stp.level}`
      }
      case 'webhook': {
        const url = r(stp.url)
        if (!url.startsWith('https://')) throw new Error('webhook URL must be https')
        if (!dry) {
          const res = await fetch(url, {
            method: stp.method ?? 'POST', signal: AbortSignal.timeout(10_000),
            ...(stp.method !== 'GET' && stp.body ? { headers: { 'Content-Type': 'application/json' }, body: r(stp.body) } : {}),
          })
          if (!res.ok) throw new Error(`webhook → ${res.status}`)
        }
        return `${stp.method ?? 'POST'} ${new URL(url).host}`
      }
      default: return ''
    }
  }

  // ---- the interpreter ------------------------------------------------------------

  /** Runs (or resumes) a flow. With [dry], conditions are evaluated but nothing is changed. */
  async function execute(sf: StoredFlow, ctx: Ctx, frames: Frame[], dry: boolean): Promise<RunResult> {
    const flow = sf.flow!
    const actions: string[] = []
    const tz = await ownerTz(sf.ownerId)
    let sitCache: Promise<Situation | null> | null = null
    const sit = () => (sitCache ??= (async () => {
      const h = Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }))
      const tod = h >= 5 && h < 10 ? 'morning' : h < 17 ? 'active' : h < 21 ? 'evening' : 'night'
      const place = await currentPlace(fastify, sf.ownerId, sf.orgId)
      return buildSituation(fastify, { orgId: sf.orgId, tz, tod, place, calendar: [] }).catch(() => null)
    })())
    const nowScope = () => {
      const d = new Date()
      return { time: d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }), date: d.toLocaleDateString('en-CA', { timeZone: tz }) }
    }
    let steps = 0
    try {
      while (frames.length) {
        const f = frames[frames.length - 1]!
        const list = (at(flow, f.path) as Step[] | undefined) ?? []
        if (f.index >= list.length) {
          if (f.repeatLeft && f.repeatLeft > 0) { f.repeatLeft--; f.index = 0; continue }
          frames.pop(); continue
        }
        if (++steps > MAX_STEPS) throw new Error(`more than ${MAX_STEPS} steps — stopped`)
        const stp = list[f.index]!
        const here = [...f.path, f.index]
        f.index++
        // The situation is built only when this block reads it ({situation.…} in its text).
        const needsSit = JSON.stringify(stp).includes('{situation.')
        const scope = { event: ctx.event, vars: ctx.vars, situation: needsSit ? await sit() : undefined, now: nowScope() }
        switch (stp.block) {
          case 'if': {
            const ok = await check(stp.cond, scope, sf, sit)
            frames.push({ path: [...here, ok ? 'then' : 'else'], index: 0 })
            break
          }
          case 'repeat': frames.push({ path: [...here, 'do'], index: 0, repeatLeft: stp.times - 1 }); break
          case 'stop': return { status: 'stopped', actions }
          case 'wait': {
            actions.push(`wait ${stp.minutes} min`)
            if (dry) break
            const due = Date.now() + stp.minutes * 60_000
            await fastify.redis.zadd(WAITS, due, JSON.stringify({ flow: sf.id, org: String(sf.orgId), hash: sf.hash, frames, ctx, id: new ObjectId().toHexString() }))
            return { status: 'waiting', actions }
          }
          default: actions.push(await act(stp, scope, sf, ctx, dry))
        }
      }
      return { status: 'done', actions }
    } catch (e) {
      return { status: 'error', actions, error: (e as Error).message }
    }
  }

  /** Records a run on the trail (never for dry runs). These entries never trigger flows. */
  async function record(sf: StoredFlow, trigger: string, res: RunResult) {
    try {
      const { cookie } = await sessionFor(sf.ownerId)
      const trail = await defaultTrail(sf.orgId); if (!trail) return
      const icon = res.status === 'error' ? '⚠️' : res.status === 'waiting' ? '⏳' : '🔗'
      const text = `${icon} ${sf.flow!.name}` + (res.actions.length ? `: ${res.actions.join('; ')}` : '') + (res.error ? ` — ${res.error}` : '')
      await api(cookie, 'POST', `/api/trail/${trail}/append`, {
        text: text.slice(0, 500), tone: 'neutral', source: 'ah-link', tags: ['ah-link'],
        meta: { type: 'ah-link/run@1', flow_id: sf.id, trigger, status: res.status, actions: res.actions, ...(res.error ? { error: res.error } : {}) },
      })
    } catch (e) { log.warn({ err: e }, 'could not record run') }
  }

  async function overLimit(flowId: string): Promise<boolean> {
    const key = `aha:link:runs:${flowId}:${new Date().toISOString().slice(0, 13)}`
    const n = await fastify.redis.incr(key)
    if (n === 1) await fastify.redis.expire(key, 3700)
    return n > RUNS_PER_HOUR
  }

  async function run(sf: StoredFlow, triggerName: string, event: Record<string, unknown>, depth: number) {
    if (!sf.flow?.on) return
    if (await overLimit(sf.id)) { log.warn({ flow: sf.id }, 'run limit reached'); return }
    const res = await execute(sf, { event, vars: {}, depth }, [{ path: ['steps'], index: 0 }], false)
    await record(sf, triggerName, res)
  }

  // ---- trigger matching ---------------------------------------------------------------

  function matches(t: Trigger, ev: AhEvent, places: Map<string, { name: string }>): boolean {
    if (ev.kind === 'place') {
      const name = (id: string | null) => (id ? places.get(id)?.name.toLowerCase() : undefined)
      if (t.block === 'arrived') return name(ev.to) === t.place.toLowerCase() && ev.from !== ev.to
      if (t.block === 'left') return name(ev.from) === t.place.toLowerCase() && ev.from !== ev.to
      return false
    }
    const e = ev.entry
    const person = String(e.meta['person'] ?? '').toLowerCase()
    switch (t.block) {
      case 'trail_entry':
        return (!t.source || e.source === t.source) && (!t.tag || e.tags.includes(t.tag)) &&
          (!t.type || e.meta['type'] === t.type) && (!t.text || e.text.toLowerCase().includes(t.text.toLowerCase()))
      case 'person_home': return e.source === 'presence' && e.tags.includes('home') && person === t.person.toLowerCase()
      case 'person_left': return e.source === 'presence' && e.tags.includes('away') && person === t.person.toLowerCase()
      default: return false
    }
  }

  async function onEvent(ev: AhEvent) {
    const orgId = new ObjectId(ev.org_id)
    let depth = 0
    if (ev.kind === 'trail') {
      const m = ev.entry.meta
      if (typeof m['type'] === 'string' && m['type'].startsWith('ah-link/')) return   // run records never trigger
      depth = Number((m['link'] as { depth?: number } | undefined)?.depth ?? 0)
      if (depth >= LINK_DEPTH) return
    }
    const flows = (await loadFlows(fastify, orgId)).filter(f => f.flow?.on)
    if (!flows.length) return
    const places = new Map([...(await orgPlaces(fastify, orgId)).entries()].map(([id, p]) => [id, { name: p.name }]))
    for (const sf of flows) {
      if (ev.kind === 'trail' && (ev.entry.meta['link'] as { flow_id?: string } | undefined)?.flow_id === sf.id) continue // never on its own output
      if (!matches(sf.flow!.trigger, ev, places)) continue
      const event = ev.kind === 'trail' ? { ...ev.entry } : { place_from: ev.from && places.get(ev.from)?.name, place: ev.to && places.get(ev.to)?.name }
      run(sf, sf.flow!.trigger.block, event, depth).catch(e => log.error({ err: e }, 'run failed'))
    }
  }

  // ---- the minute tick: schedules + waits ----------------------------------------------

  async function tick() {
    const now = Date.now()
    // Waits that are due.
    const due = await fastify.redis.zrangebyscore(WAITS, 0, now)
    for (const raw of due) {
      if (!(await fastify.redis.zrem(WAITS, raw))) continue // someone else took it
      const w = JSON.parse(raw) as { flow: string; org: string; hash: string; frames: Frame[]; ctx: Ctx }
      const sf = (await loadFlows(fastify, new ObjectId(w.org))).find(f => f.id === w.flow)
      if (!sf?.flow?.on || sf.hash !== w.hash) continue // turned off or edited while waiting
      const res = await execute(sf, w.ctx, w.frames, false)
      await record(sf, 'resume', res)
    }
    // Schedules, in each owner's time zone.
    const all = (await loadFlows(fastify)).filter(f => f.flow?.on && f.flow.trigger.block === 'schedule')
    for (const sf of all) {
      const t = sf.flow!.trigger as Extract<Trigger, { block: 'schedule' }>
      const tz = await ownerTz(sf.ownerId)
      const d = new Date(now)
      const hm = d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
      const dow = new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay()
      if (hm !== t.at || (t.days && !t.days.includes(dow))) continue
      // Once per minute, even if the tick runs twice.
      const once = await fastify.redis.set(`aha:link:sched:${sf.id}:${d.toISOString().slice(0, 16)}`, '1', 'EX', 120, 'NX')
      if (once) run(sf, 'schedule', { at: t.at }, 0).catch(e => log.error({ err: e }, 'scheduled run failed'))
    }
  }

  sub.subscribe(EVENTS).catch(e => log.error({ err: e }, 'subscribe failed'))
  sub.on('message', (_ch, msg) => {
    let ev: AhEvent
    try { ev = JSON.parse(msg) as AhEvent } catch { return }
    onEvent(ev).catch(e => log.error({ err: e }, 'event failed'))
  })
  const timer = setInterval(() => { tick().catch(e => log.error({ err: e }, 'tick failed')) }, 60_000)
  fastify.addHook('onClose', async () => { clearInterval(timer); await sub.quit().catch(() => {}) })
  log.info('Ah! Link engine started')

  return {
    /** Manual run or a dry-run test from the API. */
    async runNow(sf: StoredFlow, dry: boolean): Promise<RunResult> {
      if (!sf.flow) return { status: 'error', actions: [], error: sf.error ?? 'invalid flow' }
      const res = await execute(sf, { event: { manual: true }, vars: {}, depth: 0 }, [{ path: ['steps'], index: 0 }], dry)
      if (!dry) await record(sf, 'manual', res)
      return res
    },
  }
}

export type Engine = ReturnType<typeof startEngine>
