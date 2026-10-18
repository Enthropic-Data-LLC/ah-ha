/**
 * One build, two faces. now.<domain> is Ah! Today; the bare domain (ah-ha.app) is the data layer
 * (spaces, boards, lists, notes, keys) and has no Today page. Both talk to the same API and share
 * one sign-in. On a host that isn't ah-ha.app (dev), `?surface=today|data` picks the face.
 */
export type Surface = 'today' | 'data'

const KEY = 'aha_surface'
const host = window.location.hostname
const productionHost = /(^|\.)ah-ha\.app$/.test(host)

function fromDevOverride(): Surface | null {
  if (productionHost) return null
  try {
    const q = new URLSearchParams(window.location.search).get('surface')
    if (q === 'today' || q === 'data') { localStorage.setItem(KEY, q); return q }
    const v = localStorage.getItem(KEY)
    return v === 'today' || v === 'data' ? v : null
  } catch { return null }
}

export const surface: Surface =
  host.startsWith('now.') ? 'today' : fromDevOverride() ?? 'data'

export const isToday = surface === 'today'

/**
 * Transition: the data host still carries Today too, so nothing existing moves. Flip to false to make
 * ah-ha.app the pure data layer (its /now then sends people to now.*; the server manifest follows via TODAY_ON_DATA).
 */
export const todayOnData = true

/** Whether this host shows Today in its nav. */
export const hasToday = isToday || todayOnData

/** Where signed-in people land. */
export const homePath = hasToday ? '/now' : '/spaces'

/** Absolute URL of `path` on the other face. Without separate hosts (dev) it stays here and switches face. */
export function otherFace(path: string): string {
  const to: Surface = isToday ? 'data' : 'today'
  if (host.startsWith('now.')) return `${window.location.protocol}//${host.slice(4)}${window.location.port ? ':' + window.location.port : ''}${path}`
  if (productionHost) return `${window.location.protocol}//now.${host}${path}`
  return `${path}${path.includes('?') ? '&' : '?'}surface=${to}`
}

/** Pages Ah! Today carries itself; everything else lives on the data host. */
export const TODAY_PATHS = [
  /^\/$/, /^\/now$/, /^\/auth(\/|$)/, /^\/connect$/, /^\/onboarding$/, /^\/t\//, /^\/s\//,
  /^\/settings$/, /^\/calendar$/, /^\/[^/]+\/entities$/,
  /^\/(privacy|terms|accessibility|android|feedback|help)(\/|$)/,
]
