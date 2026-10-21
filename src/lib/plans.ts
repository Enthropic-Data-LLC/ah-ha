import type { Plan } from '../types.js'

/**
 * What each plan includes (KB #2160). null = no limit.
 *
 * `ai_calls` counts only AI that runs on the server's Anthropic key; a user's own key is
 * never limited. Admins can add an allowance on top of a plan (users.grants), which is
 * what "granting credits" means here: extra every month until it is changed.
 *
 * PLAN_LIMITS decides what a limit does:
 *   off     (default) measured and shown, nothing else — the paywall is on hold
 *   warn    the same, and the user is told when they are over
 *   enforce over a limit, new spaces / writes / server-key AI are refused
 * Read on each call, never at module load (bundled module init runs before dotenv).
 */
export interface Limits { spaces: number | null; storage_mb: number | null; ai_calls: number | null }
export type Grants = Partial<Limits>
export type LimitMode = 'off' | 'warn' | 'enforce'

const PRO: Limits = { spaces: null, storage_mb: 5 * 1024, ai_calls: 1000 }

export const PLAN_LIMITS: Record<Plan, Limits> = {
  free: { spaces: 10, storage_mb: 100, ai_calls: 50 },
  pro: PRO,
  team: PRO,
  iot: PRO,
  enterprise: { spaces: null, storage_mb: null, ai_calls: null },
}

export function limitMode(): LimitMode {
  const m = process.env['PLAN_LIMITS']
  return m === 'warn' || m === 'enforce' ? m : 'off'
}

/** A plan's limits plus anything an admin granted on top. */
export function limitsFor(plan: string | undefined, grants?: Grants | null): Limits {
  const base = PLAN_LIMITS[(plan ?? 'free') as Plan] ?? PLAN_LIMITS.free
  const add = (k: keyof Limits) => base[k] === null ? null : base[k]! + Math.max(0, grants?.[k] ?? 0)
  return { spaces: add('spaces'), storage_mb: add('storage_mb'), ai_calls: add('ai_calls') }
}

export const over = (used: number, limit: number | null) => limit !== null && used >= limit
