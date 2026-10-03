/**
 * Permissions an app can ask for when it connects (/connect). A connected app's key
 * carries a `scopes` list and may call ONLY the routes those scopes name: anything
 * not listed here is refused (default deny), so a new route is closed to apps until
 * someone decides which scope it belongs to.
 *
 * Keys made by hand on the Keys page have no `scopes` and keep full access (bounded
 * by their read/write `access`), so the MCP server, router and phone keep working.
 */

type Route = readonly [method: string, url: string]

interface Scope {
  /** What the consent screen says, completing "This app wants to…". */
  label: string
  routes: readonly Route[]
}

export const SCOPES = {
  'spaces:read':     { label: 'see the names of your spaces',           routes: [['GET', '/api/spaces']] },
  'lists:read':      { label: 'read your lists',                         routes: [['GET', '/api/list/:slug/items']] },
  'lists:check':     { label: 'check items off your lists',              routes: [['PATCH', '/api/list/:slug/items/:id/check']] },
  'lists:write':     { label: 'add, change and remove list items',       routes: [
    ['POST', '/api/list/:slug/items'], ['PATCH', '/api/list/:slug/items/:id'],
    ['PATCH', '/api/list/:slug/items/:id/check'], ['PATCH', '/api/list/:slug/items/:id/move'],
    ['DELETE', '/api/list/:slug/items/:id'],
  ] },
  'trail:read':      { label: 'read your trail',                         routes: [['GET', '/api/trail/:slug/entries'], ['GET', '/api/trail/:slug/summary']] },
  'trail:write':     { label: 'add entries to your trail',               routes: [['POST', '/api/trail/:slug/append']] },
  'places:read':     { label: 'see your saved places',                   routes: [['GET', '/api/entities']] },
  'situation:place': { label: 'know which place you are checked in at', routes: [['GET', '/api/here']] },
} as const satisfies Record<string, Scope>

export type ScopeName = keyof typeof SCOPES

export const isScope = (s: string): s is ScopeName => Object.hasOwn(SCOPES, s)

/** Open to every connected app: who the key belongs to. */
const ALWAYS: readonly Route[] = [['GET', '/auth/me']]

/** True when a key with these scopes may call this route (method + Fastify route pattern). */
export function scopesAllow(scopes: readonly string[], method: string, url: string | undefined): boolean {
  if (!url) return false
  const m = method === 'HEAD' ? 'GET' : method
  const hit = (r: Route) => r[0] === m && r[1] === url
  if (ALWAYS.some(hit)) return true
  return scopes.some(s => isScope(s) && SCOPES[s].routes.some(hit))
}

/** A scope list writes anything at all (sets the key's `access`). */
export const scopesWrite = (scopes: readonly string[]) =>
  scopes.some(s => isScope(s) && SCOPES[s].routes.some(r => r[0] !== 'GET'))

/**
 * For data a route returns beyond its main job (the current place in list/board
 * reads): session users and full-access keys see it; a connected app only with the scope.
 */
export function canSee(req: { apiKeyScopes?: readonly string[] | null }, scope: ScopeName): boolean {
  return !req.apiKeyScopes || req.apiKeyScopes.includes(scope)
}
