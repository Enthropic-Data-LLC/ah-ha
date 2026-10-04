import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { CATALOGUE, FLOW_TYPE, flow as flowSchema } from '../link/blocks.js'
import { getFlow, loadFlows, parseFlow, saveFlow } from '../link/flows.js'
import type { Engine } from '../link/engine.js'

/**
 * Ah! Link API. Flows are workflow-format Note spaces (see link/flows.ts); these routes
 * list, validate, save, dry-run and run them.
 */
const linkRoutes: FastifyPluginAsync<{ engine: () => Engine | null }> = async (fastify, opts) => {
  // GET /api/link/blocks — the palette: every trigger, condition and step, in words.
  fastify.get('/api/link/blocks', { preHandler: fastify.authenticate }, async () => ({ data: { type: FLOW_TYPE, ...CATALOGUE } }))

  // GET /api/link/flows — every flow note, valid or not (invalid ones say why).
  fastify.get('/api/link/flows', { preHandler: fastify.authenticate }, async (req) => {
    const flows = await loadFlows(fastify, req.user!.orgId)
    return { data: flows.map(f => ({ id: f.id, slug: f.slug, name: f.flow?.name ?? f.slug, on: f.flow?.on ?? false, trigger: f.flow?.trigger ?? null, flow: f.flow, error: f.error })) }
  })

  // POST /api/link/validate {flow} — check a flow without saving it.
  fastify.post('/api/link/validate', { preHandler: fastify.authenticate }, async (req) => {
    const { flow } = z.object({ flow: z.unknown() }).parse(req.body)
    const r = parseFlow(JSON.stringify(flow))
    return { data: { valid: !!r.flow, error: r.error } }
  })

  // PUT /api/link/flows/:id {flow} — save the flow (the note's body).
  fastify.put<{ Params: { id: string } }>('/api/link/flows/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({ flow: flowSchema }).safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? 'Invalid flow' })
    const sf = await getFlow(fastify, req.user!.orgId, req.params.id)
    if (!sf) return reply.status(404).send({ error: 'No such flow' })
    await saveFlow(fastify, req.user!.orgId, sf.id, body.data.flow)
    return { ok: true }
  })

  // POST /api/link/flows {flow} — a new workflow note (slug link-<name>).
  fastify.post('/api/link/flows', { preHandler: fastify.authenticate }, async (req, reply) => {
    const body = z.object({ flow: flowSchema }).safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? 'Invalid flow' })
    const f = body.data.flow
    const slug = ('link-' + f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 60)
    // Create the note space through the spaces route so its ref and ownership are standard.
    const res = await fastify.inject({
      method: 'POST', url: '/api/spaces',
      headers: { ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}), ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
      payload: { type: 'note', name: `🔗 ${f.name}`, slug },
    })
    if (res.statusCode >= 300) return reply.status(res.statusCode).send({ error: `Could not create the note: ${res.body.slice(0, 120)}` })
    const space = (res.json() as { data: { _id: string } }).data
    await saveFlow(fastify, req.user!.orgId, String(space._id), f)
    reply.status(201)
    return { data: { id: String(space._id), slug } }
  })

  // POST /api/link/flows/:id/run {dry_run} — run now; a dry run evaluates conditions but changes nothing.
  fastify.post<{ Params: { id: string } }>('/api/link/flows/:id/run', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { dry_run } = z.object({ dry_run: z.boolean().default(true) }).parse(req.body ?? {})
    const engine = opts.engine()
    if (!engine) return reply.status(503).send({ error: 'Engine not running' })
    const sf = await getFlow(fastify, req.user!.orgId, req.params.id)
    if (!sf) return reply.status(404).send({ error: 'No such flow' })
    return { data: await engine.runNow(sf, dry_run) }
  })
}

export default linkRoutes
