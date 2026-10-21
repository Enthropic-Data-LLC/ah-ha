// Plan usage as three meters (KB #2160): spaces, storage, AI this month. Counts only.

export interface Usage {
  plan: string
  mode: 'off' | 'warn' | 'enforce'
  limits: { spaces: number | null; storage_mb: number | null; ai_calls: number | null }
  grants: { spaces?: number; storage_mb?: number; ai_calls?: number }
  used: { spaces: number; storage_bytes: number; storage_measured_at: string; ai_calls: number; own_key_ai_calls: number }
  over: { spaces: boolean; storage: boolean; ai_calls: boolean }
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function Meter({ label, used, limit, shown, over, warn }: { label: string; used: number; limit: number | null; shown: string; over: boolean; warn: boolean }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const tone = warn && over ? 'bg-amber-500' : 'bg-indigo-500'
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">{shown}</span>
      </div>
      {limit !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"
             role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function UsageMeters({ u, admin = false }: { u: Usage; admin?: boolean }) {
  const warn = u.mode !== 'off'
  const of = (limit: number | null, unit = '') => limit === null ? ' · unlimited' : ` of ${limit.toLocaleString()}${unit}`
  const mb = u.used.storage_bytes / (1024 * 1024)
  return (
    <div className="space-y-3">
      <Meter label="Spaces" used={u.used.spaces} limit={u.limits.spaces} over={u.over.spaces} warn={warn}
             shown={`${u.used.spaces}${of(u.limits.spaces)}`} />
      <Meter label="Storage" used={mb} limit={u.limits.storage_mb} over={u.over.storage} warn={warn}
             shown={`${fmtBytes(u.used.storage_bytes)}${u.limits.storage_mb === null ? ' · unlimited' : ` of ${fmtBytes(u.limits.storage_mb * 1024 * 1024)}`}`} />
      <Meter label="AI this month" used={u.used.ai_calls} limit={u.limits.ai_calls} over={u.over.ai_calls} warn={warn}
             shown={`${u.used.ai_calls}${of(u.limits.ai_calls)}`} />
      {u.used.own_key_ai_calls > 0 && (
        <p className="text-xs text-slate-400">Plus {u.used.own_key_ai_calls} on {admin ? 'their' : 'your'} own AI key, which doesn’t count toward the plan.</p>
      )}
    </div>
  )
}
