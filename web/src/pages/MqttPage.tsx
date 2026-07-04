import useSWR from 'swr'
import { fetcher, api, ApiError } from '../lib/api'
import { useState } from 'react'

interface MqttSub {
  _id: string
  topic_pattern: string
  space_ref: string
  text_template: string
  default_tone: 'happy' | 'sorrow' | 'neutral'
  enabled: boolean
  created_at: string
}

const TONES = ['neutral', 'happy', 'sorrow'] as const

export default function MqttPage() {
  const { data, mutate } = useSWR<{ data: MqttSub[] }>('/api/mqtt/subscriptions', fetcher)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<{ topic_pattern: string; space_ref: string; text_template: string; default_tone: 'happy' | 'sorrow' | 'neutral' }>({ topic_pattern: '', space_ref: '', text_template: '{{payload}}', default_tone: 'neutral' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const subs = data?.data ?? []

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api.post('/api/mqtt/subscriptions', form)
      setCreating(false)
      setForm({ topic_pattern: '', space_ref: '', text_template: '{{payload}}', default_tone: 'neutral' })
      await mutate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create subscription')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggle(sub: MqttSub) {
    await api.patch(`/api/mqtt/subscriptions/${sub._id}`, { enabled: !sub.enabled })
    await mutate()
  }

  async function remove(id: string) {
    await api.delete(`/api/mqtt/subscriptions/${id}`)
    await mutate()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">MQTT Subscriptions</h1>
          <p className="text-sm text-slate-500 mt-0.5">Route MQTT messages into trail spaces</p>
        </div>
        <button
          onClick={() => { setCreating(true); setError('') }}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          + New subscription
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">New MQTT subscription</h2>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Topic pattern</label>
            <input
              required autoFocus
              value={form.topic_pattern}
              onChange={e => setForm(f => ({ ...f, topic_pattern: e.target.value }))}
              placeholder="home/sensors/+/temperature"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-600">Supports <code>+</code> (single level) and <code>#</code> (multi-level) wildcards</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Target trail space ref</label>
            <input
              required
              value={form.space_ref}
              onChange={e => setForm(f => ({ ...f, space_ref: e.target.value }))}
              placeholder="username/trail/my-trail"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Text template</label>
            <input
              required
              value={form.text_template}
              onChange={e => setForm(f => ({ ...f, text_template: e.target.value }))}
              placeholder="{{payload}} via {{topic.0}}"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-600">Available: <code>{'{{payload}}'}</code>, <code>{'{{payload.field}}'}</code>, <code>{'{{topic.0}}'}</code>, <code>{'{{ts}}'}</code></p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Default tone</label>
            <div className="flex gap-2">
              {TONES.map(t => (
                <button key={t} type="button"
                  onClick={() => setForm(f => ({ ...f, default_tone: t }))}
                  className={`px-3 py-1 rounded-lg text-xs border transition capitalize ${form.default_tone === t ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 text-slate-400'}`}
                >{t}</button>
              ))}
            </div>
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
        {subs.length === 0 && !creating && (
          <p className="text-slate-500 text-sm text-center py-8">No subscriptions yet.</p>
        )}
        {subs.map(sub => (
          <div key={sub._id} className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2 group">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-mono font-medium truncate">{sub.topic_pattern}</p>
                <p className="text-xs text-slate-500 font-mono truncate">→ {sub.space_ref}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${sub.enabled ? 'border-emerald-700 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>
                  {sub.enabled ? 'on' : 'off'}
                </span>
                <button onClick={() => toggle(sub)} className="text-xs text-slate-600 hover:text-slate-300 transition">
                  {sub.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => remove(sub._id)} className="text-xs text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">
                  Delete
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 font-mono bg-slate-800/50 px-2 py-1 rounded">{sub.text_template}</p>
            <div className="flex gap-2 text-xs text-slate-600">
              <span>tone: {sub.default_tone}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
