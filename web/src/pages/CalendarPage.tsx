import useSWR from 'swr'
import { useState } from 'react'
import { fetcher, api, ApiError } from '../lib/api'

interface CalendarSource {
  _id: string
  name: string
  ical_url: string
  color: string
  created_at: string
}

const COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
]

export default function CalendarPage() {
  const { data, mutate } = useSWR<{ data: CalendarSource[] }>('/api/calendar/sources', fetcher)
  const sources = data?.data ?? []

  const [name, setName]       = useState('')
  const [url, setUrl]         = useState('')
  const [color, setColor]     = useState(COLORS[0]!)
  const [adding, setAdding]   = useState(false)
  const [error, setError]     = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function addSource(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    setAdding(true)
    setError('')
    try {
      await api.post('/api/calendar/sources', { name: name.trim(), ical_url: url.trim(), color })
      setName(''); setUrl('')
      await mutate()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add calendar')
    } finally {
      setAdding(false)
    }
  }

  async function deleteSource(id: string) {
    setDeleting(id)
    try {
      await api.delete(`/api/calendar/sources/${id}`)
      await mutate()
    } finally {
      setDeleting(null) }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold mb-2">Calendar Sources</h1>
      <p className="text-sm text-slate-500 mb-8">
        Link iCal feeds so Ah-Ha and Claude can see your schedule.
      </p>

      {/* Existing sources */}
      {sources.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800 mb-6">
          {sources.map(s => (
            <div key={s._id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs text-slate-500 font-mono">{s.ical_url}</p>
              </div>
              <button
                onClick={() => deleteSource(s._id)}
                disabled={deleting === s._id}
                className="text-slate-600 hover:text-red-400 text-xs transition disabled:opacity-40 flex-shrink-0"
              >
                {deleting === s._id ? '…' : 'Remove'}
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Add form */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <p className="text-sm font-medium">Add a calendar</p>

        <form onSubmit={addSource} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Work, Personal, Family…"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">iCal URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-600">
              Google Calendar: Settings → your calendar → <em>Secret address in iCal format</em>
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={adding || !name.trim() || !url.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition"
          >
            {adding ? 'Adding…' : 'Add Calendar'}
          </button>
        </form>
      </section>

      <p className="text-xs text-slate-600 mt-4">
        Events are fetched fresh on each request (cached 5 min). No data is stored — only the URL.
      </p>
    </div>
  )
}
