import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'

interface ApiKey {
  _id: string
  name: string
  prefix: string
  scope: string
  access: string
  expires_at: string | null
  last_used: string | null
  created_at: string
}

export default function KeysPage() {
  const { data, mutate } = useSWR<{ data: ApiKey[] }>('/api/keys', fetcher)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<'write' | 'read'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await api.post<{ data: ApiKey & { key: string } }>('/api/keys', { name, access })
      setNewKey((res as any).data.key)
      setName('')
      setCreating(false)
      await mutate()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create key')
    } finally {
      setSubmitting(false)
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? It cannot be undone.')) return
    await api.delete(`/api/keys/${id}`)
    await mutate()
  }

  async function copyKey() {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const keys = data?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">API Keys</h1>
        <button
          onClick={() => { setCreating(true); setError('') }}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          + New key
        </button>
      </div>

      {newKey && (
        <div className="bg-emerald-950 border border-emerald-700 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-emerald-400">Key created — copy it now. It won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-slate-900 px-3 py-2 rounded-lg break-all">{newKey}</code>
            <button
              onClick={copyKey}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-xs font-medium rounded-lg transition flex-shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-slate-500 hover:text-slate-300">Dismiss</button>
        </div>
      )}

      {creating && (
        <form onSubmit={createKey} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">New API key</h2>
          <input
            autoFocus
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Key name (e.g. MCP server)"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            {(['write', 'read'] as const).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setAccess(a)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${access === a ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 text-slate-400'}`}
              >
                {a === 'write' ? 'Read + Write' : 'Read only'}
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button type="submit" disabled={submitting} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {keys.length === 0 && !creating && (
          <p className="text-slate-500 text-sm text-center py-8">No API keys yet.</p>
        )}
        {keys.map(key => (
          <div key={key._id} className="flex items-center gap-3 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl group">
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{key.name}</p>
              <p className="text-xs text-slate-500 font-mono">{key.prefix}…</p>
            </div>
            <div className="text-right space-y-0.5 flex-shrink-0">
              <p className="text-xs text-slate-500">{key.access}</p>
              {key.last_used
                ? <p className="text-xs text-slate-600">used {new Date(key.last_used).toLocaleDateString()}</p>
                : <p className="text-xs text-slate-700">never used</p>
              }
            </div>
            <button
              onClick={() => revokeKey(key._id)}
              className="text-slate-700 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition ml-2"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
