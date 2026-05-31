import useSWR from 'swr'
import { fetcher, api, ApiError } from '../lib/api'
import { useState } from 'react'

interface Webhook {
  _id: string
  id: string
  name: string
  target_space_ref: string
  events: string[]
  enabled: boolean
  receive_url: string
  last_received_at: string | null
  receive_count: number
  created_at: string
}

const BASE = window.location.hostname === 'ah-ha.app' ? 'https://ah-ha.app' : window.location.origin

export default function WebhooksPage() {
  const { data, mutate } = useSWR<{ data: Webhook[] }>('/api/webhooks', fetcher)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', target_space_ref: '', events: ['trail.append'] as string[], secret: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const webhooks = data?.data ?? []

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const body: Record<string, unknown> = { name: form.name, target_space_ref: form.target_space_ref, events: form.events }
      if (form.secret) body.secret = form.secret
      await api.post('/api/webhooks', body)
      setCreating(false)
      setForm({ name: '', target_space_ref: '', events: ['trail.append'], secret: '' })
      await mutate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create webhook')
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    await api.delete(`/api/webhooks/${id}`)
    await mutate()
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(BASE + url)
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  function toggleEvent(ev: string) {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev]
    }))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Webhooks</h1>
          <p className="text-sm text-slate-500 mt-0.5">Receive data from external systems via HTTP POST</p>
        </div>
        <button
          onClick={() => { setCreating(true); setError('') }}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          + New webhook
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">New webhook</h2>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Name</label>
            <input
              required autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Home Assistant alerts"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Target space ref</label>
            <input
              required
              value={form.target_space_ref}
              onChange={e => setForm(f => ({ ...f, target_space_ref: e.target.value }))}
              placeholder="username/trail/my-trail"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Events</label>
            <div className="flex gap-2">
              {(['trail.append', 'board.card'] as const).map(ev => (
                <button key={ev} type="button"
                  onClick={() => toggleEvent(ev)}
                  className={`px-3 py-1 rounded-lg text-xs border transition ${form.events.includes(ev) ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 text-slate-400'}`}
                >{ev}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Secret <span className="text-slate-600">(optional — enables HMAC signature verification)</span></label>
            <input
              value={form.secret}
              onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
              placeholder="min 8 characters"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button type="submit" disabled={submitting || form.events.length === 0}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {webhooks.length === 0 && !creating && (
          <p className="text-slate-500 text-sm text-center py-8">No webhooks yet.</p>
        )}
        {webhooks.map(wh => (
          <div key={wh._id} className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2 group">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-medium">{wh.name}</p>
                <p className="text-xs text-slate-500 font-mono truncate">→ {wh.target_space_ref}</p>
              </div>
              <button onClick={() => remove(wh.id ?? wh._id)}
                className="text-xs text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                Delete
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {wh.events.map(ev => (
                <span key={ev} className="text-xs px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-slate-400">{ev}</span>
              ))}
              <span className="text-xs text-slate-600">
                {wh.receive_count > 0
                  ? `${wh.receive_count} received · last ${new Date(wh.last_received_at!).toLocaleDateString()}`
                  : 'never triggered'}
              </span>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/50 px-2 py-1.5 rounded-lg">
              <code className="flex-1 text-xs font-mono text-slate-400 truncate">{BASE}{wh.receive_url}</code>
              <button
                onClick={() => copyUrl(wh.receive_url)}
                className="text-xs text-slate-500 hover:text-slate-300 flex-shrink-0 transition"
              >
                {copied === wh.receive_url ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
