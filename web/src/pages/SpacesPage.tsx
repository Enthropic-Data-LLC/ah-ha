import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import type { Space } from '../lib/types'
import { useState } from 'react'

const TYPE_ICONS: Record<string, string> = {
  board: '🗂️',
  trail: '📍',
  note: '📝',
  list: '✅',
}

const TYPE_LABELS: Record<string, string> = {
  board: 'Board',
  trail: 'Trail',
  note: 'Note',
  list: 'List',
}

export default function SpacesPage() {
  const { data, mutate } = useSWR<{ data: Space[] }>('/api/spaces', fetcher)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<Space['type']>('board')

  async function createSpace(e: React.FormEvent) {
    e.preventDefault()
    await api.post('/api/spaces', { name, type })
    setName('')
    setCreating(false)
    await mutate()
  }

  const spaces = data?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Spaces</h1>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          + New space
        </button>
      </div>

      {creating && (
        <form onSubmit={createSpace} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">New space</h2>
          <input
            autoFocus
            required
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Space name"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="grid grid-cols-4 gap-2">
            {(['board', 'trail', 'note', 'list'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`py-2 rounded-lg text-sm font-medium transition border ${
                  type === t
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                    : 'border-slate-700 hover:border-slate-500 text-slate-400'
                }`}
              >
                {TYPE_ICONS[t]} {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition">
              Create
            </button>
          </div>
        </form>
      )}

      {spaces.length === 0 && !creating ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-slate-500 text-sm">No spaces yet.</p>
          <button onClick={() => setCreating(true)} className="text-sm text-indigo-400 hover:text-indigo-300 underline">
            Create your first space
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {spaces.map(space => (
            <a
              key={space._id}
              href={`/spaces/${space.type}/${space.slug}`}
              className="flex items-center gap-3 px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition group"
            >
              <span className="text-xl">{TYPE_ICONS[space.type]}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{space.name}</p>
                {space.description && (
                  <p className="text-xs text-slate-500 truncate">{space.description}</p>
                )}
              </div>
              <span className="text-xs text-slate-600 group-hover:text-slate-400 transition">{TYPE_LABELS[space.type]}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
