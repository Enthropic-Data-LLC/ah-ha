import useSWR from 'swr'
import { fetcher } from '../lib/api'
import { useState } from 'react'

interface AuditEntry {
  _id: string
  seq: number
  action: string
  resource_ref: string
  actor_id: string
  actor_type: 'user' | 'apikey'
  ip: string
  ts?: string
  created_at?: string
}

interface AuditResponse {
  data: AuditEntry[]
  meta: { has_more: boolean; cursor: number | null }
}

const ACTION_LABELS: Record<string, string> = {
  'trail.append': 'Trail append',
  'board.card.create': 'Card created',
  'board.card.update': 'Card updated',
  'board.card.delete': 'Card deleted',
  'note.update': 'Note updated',
  'list.item.create': 'List item added',
  'list.item.update': 'List item updated',
  'list.item.delete': 'List item deleted',
  'space.create': 'Space created',
  'space.delete': 'Space deleted',
  'key.create': 'API key created',
  'key.revoke': 'API key revoked',
}

function actionColor(action: string) {
  if (action.includes('delete') || action.includes('revoke')) return 'text-red-400 bg-red-500/10'
  if (action.includes('create') || action.includes('append')) return 'text-emerald-400 bg-emerald-500/10'
  return 'text-slate-400 bg-slate-800'
}

function fmt(ts: string | undefined) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export default function AuditPage() {
  const [refFilter, setRefFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const [allEntries, setAllEntries] = useState<AuditEntry[]>([])
  const [initialLoaded, setInitialLoaded] = useState(false)

  const params = new URLSearchParams()
  if (refFilter) params.set('resource_ref', refFilter)
  if (actionFilter) params.set('action', actionFilter)
  if (cursor !== undefined) params.set('cursor', String(cursor))

  const { data, isLoading } = useSWR<AuditResponse>(
    `/api/audit?${params.toString()}`,
    fetcher,
    {
      onSuccess(res) {
        if (cursor === undefined) {
          setAllEntries(res.data)
        } else {
          setAllEntries(prev => [...prev, ...res.data])
        }
        setInitialLoaded(true)
      },
    }
  )

  function applyFilter() {
    setCursor(undefined)
    setAllEntries([])
    setInitialLoaded(false)
  }

  function loadMore() {
    if (data?.meta.cursor) setCursor(data.meta.cursor)
  }

  const entries = initialLoaded ? allEntries : (data?.data ?? [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-xl font-bold">Audit Log</h1>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={refFilter}
          onChange={e => setRefFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilter()}
          placeholder="Filter by resource ref…"
          className="flex-1 min-w-48 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm
                     placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilter()}
          placeholder="Filter by action…"
          className="w-52 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm
                     placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={applyFilter}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm transition"
        >
          Filter
        </button>
        {(refFilter || actionFilter) && (
          <button
            onClick={() => { setRefFilter(''); setActionFilter(''); setCursor(undefined); setAllEntries([]); setInitialLoaded(false) }}
            className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-300 transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-36">Time</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-40">Action</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Resource</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-24">Via</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-600 text-sm">Loading…</td>
              </tr>
            )}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-600 text-sm">No audit entries found.</td>
              </tr>
            )}
            {entries.map(entry => (
              <tr key={entry._id} className="hover:bg-slate-900/40 transition-colors">
                <td className="px-4 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                  {fmt(entry.ts ?? entry.created_at)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${actionColor(entry.action)}`}>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400 truncate max-w-xs" title={entry.resource_ref}>
                  {entry.resource_ref}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {entry.actor_type === 'apikey' ? 'API key' : 'browser'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.meta.has_more && (
        <div className="text-center">
          <button
            onClick={loadMore}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm transition"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
