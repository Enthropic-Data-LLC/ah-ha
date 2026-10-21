import useSWR from 'swr'
import { useState } from 'react'
import { api, fetcher } from '../lib/api'
import UsageMeters, { fmtBytes, type Usage } from '../components/UsageMeters'

// Operator view across all accounts (KB #1302). Shows accounts and usage, never content.

const PLANS = ['free', 'pro', 'team', 'iot', 'enterprise'] as const

interface Overview {
  users: { total: number; new_7d: number; new_30d: number; signed_in_7d: number }
  plans: Record<string, number>
  spaces: Record<string, number>
  trail_entries: { last_7d: number | null; last_30d: number | null }
  ai_calls_month: { server_key: number; own_key: number }
  limit_mode: 'off' | 'warn' | 'enforce'
}

interface UserRow {
  id: string
  email: string
  username: string | null
  plan: string
  created_at: string | null
  last_seen: string | null
  onboarded: boolean
  admin: boolean
  disabled_at: string | null
  spaces: number
  trail_30d: number
  ai_calls_month: number
  storage_bytes: number | null
  limits: Usage['limits']
}

interface UserDetail extends Omit<UserRow, 'spaces' | 'trail_30d' | 'ai_calls_month' | 'storage_bytes' | 'limits'> {
  usage: Usage
  timezone: string | null
  own_ai_key: boolean
  counts: { cards: number; list_items: number }
  spaces: { ref: string; name: string; type: string; created_at: string }[]
  keys: { name: string; prefix: string; access: string; created_at: string; last_used: string | null; expires_at: string | null; revoked: boolean }[]
  recent_actions: { action: string; resource_ref: string; via: string; ts: string }[]
  trail_by_day: { day: string; n: number }[] | null
}

function fmt(ts: string | null | undefined, withTime = false) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' })
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Activity({ days }: { days: { day: string; n: number }[] }) {
  // Last 30 days, one bar per day, zero days included.
  const byDay = new Map(days.map(d => [d.day, d.n]))
  const bars: { day: string; n: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    bars.push({ day, n: byDay.get(day) ?? 0 })
  }
  const max = Math.max(1, ...bars.map(b => b.n))
  const total = bars.reduce((a, b) => a + b.n, 0)
  return (
    <div>
      <div className="flex items-end gap-0.5 h-16" role="img" aria-label={`${total} trail ${total === 1 ? 'entry' : 'entries'} in the last 30 days`}>
        {bars.map(b => (
          <div key={b.day} title={`${b.day}: ${b.n}`} className="flex-1 bg-indigo-500/70 rounded-sm min-h-px" style={{ height: `${(b.n / max) * 100}%` }} />
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-1">{total} trail {total === 1 ? 'entry' : 'entries'} in the last 30 days</p>
    </div>
  )
}

function UserPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, mutate } = useSWR<{ data: UserDetail }>(`/api/admin/users/${id}`, fetcher)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [grants, setGrants] = useState<Record<string, string> | null>(null)
  const u = data?.data

  async function change(body: { plan?: string; disabled?: boolean; grants?: Record<string, number> }) {
    setSaving(true); setError(''); setConfirmDisable(false)
    try {
      await api.patch(`/api/admin/users/${id}`, body)
      await mutate()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-5" aria-label="Account detail">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{u ? (u.username ? `@${u.username}` : '(no username yet)') : 'Loading…'}</h2>
          {u && <p className="text-sm text-slate-400 truncate">{u.email}{u.admin && ' · admin'}{u.disabled_at && <span className="text-amber-300"> · disabled {fmt(u.disabled_at)}</span>}</p>}
        </div>
        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 transition">Close</button>
      </div>

      {u && (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-xs text-slate-400">Joined</dt><dd>{fmt(u.created_at)}</dd></div>
            <div><dt className="text-xs text-slate-400">Last sign-in</dt><dd>{fmt(u.last_seen, true)}</dd></div>
            <div><dt className="text-xs text-slate-400">Time zone</dt><dd>{u.timezone ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Own AI key</dt><dd>{u.own_ai_key ? 'Yes' : 'No'}</dd></div>
            <div><dt className="text-xs text-slate-400">Spaces</dt><dd>{u.spaces.length}</dd></div>
            <div><dt className="text-xs text-slate-400">Cards</dt><dd>{u.counts.cards}</dd></div>
            <div><dt className="text-xs text-slate-400">List items</dt><dd>{u.counts.list_items}</dd></div>
            <div><dt className="text-xs text-slate-400">Onboarded</dt><dd>{u.onboarded ? 'Yes' : 'No'}</dd></div>
          </dl>

          <div className="flex items-center gap-3">
            <label htmlFor="plan" className="text-sm text-slate-300">Plan</label>
            <select
              id="plan"
              value={u.plan}
              disabled={saving}
              onChange={e => change({ plan: e.target.value })}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {!u.admin && (u.disabled_at ? (
              <button disabled={saving} onClick={() => change({ disabled: false })}
                      className="ml-auto px-3 py-1 rounded-lg text-sm border border-slate-700 hover:bg-slate-800 transition">Enable account</button>
            ) : confirmDisable ? (
              <span className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-amber-200">Read-only, keys and automations off?</span>
                <button disabled={saving} onClick={() => change({ disabled: true })}
                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition">Disable</button>
                <button onClick={() => setConfirmDisable(false)} className="px-2 py-1 text-slate-400 hover:text-slate-200 transition">Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmDisable(true)}
                      className="ml-auto px-3 py-1 rounded-lg text-sm border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition">Disable account</button>
            ))}
            {saving && <span className="text-xs text-slate-400">Saving…</span>}
            {error && <span className="text-xs text-red-400" role="alert">{error}</span>}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Plan usage{u.usage.mode !== 'off' && <span className="ml-2 text-xs text-slate-400">limits: {u.usage.mode}</span>}</h3>
            <UsageMeters u={u.usage} admin />
            {grants === null ? (
              <button onClick={() => setGrants({ spaces: String(u.usage.grants.spaces ?? 0), storage_mb: String(u.usage.grants.storage_mb ?? 0), ai_calls: String(u.usage.grants.ai_calls ?? 0) })}
                      className="text-sm text-indigo-300 hover:text-indigo-200 transition">
                Extra allowance{Object.keys(u.usage.grants).length ? `: ${Object.entries(u.usage.grants).map(([k, v]) => `+${v} ${k === 'storage_mb' ? 'MB' : k === 'ai_calls' ? 'AI/mo' : 'spaces'}`).join(', ')}` : '…'}
              </button>
            ) : (
              <form className="flex flex-wrap items-end gap-3 text-sm"
                    onSubmit={e => { e.preventDefault(); change({ grants: Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, Math.max(0, parseInt(v, 10) || 0)])) }); setGrants(null) }}>
                {([['spaces', 'Extra spaces'], ['storage_mb', 'Extra MB'], ['ai_calls', 'Extra AI / month']] as const).map(([k, label]) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">{label}</span>
                    <input type="number" min={0} value={grants[k]} onChange={e => setGrants({ ...grants, [k]: e.target.value })}
                           className="w-28 px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </label>
                ))}
                <button className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition">Save</button>
                <button type="button" onClick={() => setGrants(null)} className="px-2 py-1 text-slate-400 hover:text-slate-200 transition">Cancel</button>
              </form>
            )}
          </div>

          {u.trail_by_day && <Activity days={u.trail_by_day} />}

          <div>
            <h3 className="text-sm font-medium mb-2">Spaces</h3>
            {u.spaces.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
              <ul className="text-sm divide-y divide-slate-800/60">
                {u.spaces.map(s => (
                  <li key={s.ref} className="py-1.5 flex gap-3">
                    <span className="w-12 text-xs text-slate-400 pt-0.5">{s.type}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{fmt(s.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">API keys</h3>
            {u.keys.length === 0 ? <p className="text-sm text-slate-400">None.</p> : (
              <ul className="text-sm divide-y divide-slate-800/60">
                {u.keys.map(k => (
                  <li key={k.prefix + k.created_at} className={`py-1.5 flex gap-3 ${k.revoked ? 'text-slate-500 line-through' : ''}`}>
                    <span className="flex-1 truncate">{k.name}</span>
                    <span className="font-mono text-xs">{k.prefix}…</span>
                    <span className="text-xs text-slate-400">{k.access}</span>
                    <span className="text-xs text-slate-400 tabular-nums w-32 text-right">used {fmt(k.last_used, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Recent actions</h3>
            {u.recent_actions.length === 0 ? <p className="text-sm text-slate-400">None recorded.</p> : (
              <ul className="text-sm divide-y divide-slate-800/60">
                {u.recent_actions.map((a, i) => (
                  <li key={i} className="py-1.5 flex gap-3">
                    <span className="text-xs text-slate-400 tabular-nums w-32">{fmt(a.ts, true)}</span>
                    <span className="w-36 truncate">{a.action}</span>
                    <span className="flex-1 font-mono text-xs text-slate-400 truncate" title={a.resource_ref}>{a.resource_ref}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default function AdminPage() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const overview = useSWR<{ data: Overview }>('/api/admin/overview', fetcher, { shouldRetryOnError: false })
  const list = useSWR<{ data: UserRow[]; meta: { has_more: boolean } }>(
    `/api/admin/users?limit=100${query ? `&q=${encodeURIComponent(query)}` : ''}`, fetcher, { shouldRetryOnError: false },
  )

  if ((overview.error as { status?: number } | undefined)?.status === 404) {
    return <div className="max-w-4xl mx-auto px-4 py-10 text-sm text-slate-400">404 — <a href="/" className="underline hover:text-slate-200">Go home</a></div>
  }

  const o = overview.data?.data
  const rows = list.data?.data ?? []

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-10 space-y-6 overflow-y-auto">
      <h1 className="text-xl font-bold">Admin</h1>

      {o && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Accounts" value={o.users.total} sub={`${o.users.new_7d} new this week · ${o.users.new_30d} in 30 days`} />
          <Tile label="Signed in, last 7 days" value={o.users.signed_in_7d}
                sub={`AI this month: ${o.ai_calls_month.server_key} on our key · ${o.ai_calls_month.own_key} own`} />
          <Tile label="Trail entries, 7 days" value={o.trail_entries.last_7d ?? '—'} sub={o.trail_entries.last_30d != null ? `${o.trail_entries.last_30d} in 30 days` : undefined} />
          <Tile label="Spaces" value={Object.values(o.spaces).reduce((a, b) => a + b, 0)}
                sub={Object.entries(o.spaces).map(([t, n]) => `${n} ${t}`).join(' · ')} />
        </div>
      )}
      {o && (
        <p className="text-xs text-slate-400">
          Plans: {Object.entries(o.plans).map(([p, n]) => `${n} ${p}`).join(' · ')}
        </p>
      )}

      {selected && <UserPanel id={selected} onClose={() => setSelected(null)} onChanged={() => { list.mutate(); overview.mutate() }} />}

      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(q.trim()) }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search email or username…"
          aria-label="Search accounts"
          className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm transition">Search</button>
      </form>

      <div className="rounded-xl border border-slate-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50 text-left text-xs font-medium text-slate-400">
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Plan</th>
              <th className="px-4 py-2.5">Joined</th>
              <th className="px-4 py-2.5">Last sign-in</th>
              <th className="px-4 py-2.5 text-right">Spaces</th>
              <th className="px-4 py-2.5 text-right">Trail 30d</th>
              <th className="px-4 py-2.5 text-right">AI mo</th>
              <th className="px-4 py-2.5 text-right">Storage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {list.isLoading && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>}
            {!list.isLoading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No accounts found.</td></tr>}
            {rows.map(u => (
              <tr key={u.id} className={`hover:bg-slate-900/40 transition-colors ${selected === u.id ? 'bg-slate-900/60' : ''}`}>
                <td className="px-4 py-2.5">
                  <button onClick={() => setSelected(u.id)} className="text-left hover:text-indigo-300 transition">
                    <span className="block">{u.username ? `@${u.username}` : <span className="text-slate-400">(no username)</span>}{u.admin && <span className="ml-2 text-xs text-indigo-400">admin</span>}{u.disabled_at && <span className="ml-2 text-xs text-amber-300">disabled</span>}</span>
                    <span className="block text-xs text-slate-400">{u.email}</span>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-xs">{u.plan}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400 tabular-nums whitespace-nowrap">{fmt(u.created_at)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400 tabular-nums whitespace-nowrap">{fmt(u.last_seen, true)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.spaces}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.trail_30d}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${u.limits.ai_calls !== null && u.ai_calls_month >= u.limits.ai_calls ? 'text-amber-300' : ''}`}>{u.ai_calls_month}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-400">{fmtBytes(u.storage_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data?.meta.has_more && <p className="text-xs text-slate-400">Showing the newest 100. Search to narrow it down.</p>}
    </div>
  )
}
