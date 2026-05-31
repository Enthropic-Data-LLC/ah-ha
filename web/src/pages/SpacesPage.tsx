import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useMe } from '../hooks/useMe'
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

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

export default function SpacesPage() {
  const { data, mutate } = useSWR<{ data: Space[] }>('/api/spaces', fetcher)
  const { user } = useMe()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<Space['type']>('board')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function createSpace(e: React.FormEvent) {
    e.preventDefault()
    const slug = toSlug(name)
    if (slug.length < 3) { setError('Name too short (needs 3+ URL-safe characters)'); return }
    setError('')
    setSubmitting(true)
    try {
      await api.post('/api/spaces', { name, type, slug })
      setName('')
      setCreating(false)
      await mutate()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create space')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteSpace(ref: string) {
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(ref)}`)
      setDeleteConfirm(null)
      await mutate()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete space')
      setDeleteConfirm(null)
    } finally {
      setDeleting(false)
    }
  }

  const spaces = data?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Spaces</h1>
        <button
          onClick={() => { setCreating(true); setError('') }}
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
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="Space name"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {name && (
            <p className="text-xs text-slate-500">slug: <span className="text-slate-400">{toSlug(name)}</span></p>
          )}
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
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {error && !creating && (
        <p className="text-sm text-red-400">{error}</p>
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
            <div key={space._id}>
              {deleteConfirm === space.ref ? (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-950 border border-red-800 rounded-xl">
                  <span className="text-xl">{TYPE_ICONS[space.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-300">Delete "{space.name}"?</p>
                    <p className="text-xs text-red-500/80">This cannot be undone.</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteSpace(space.ref)}
                      disabled={deleting}
                      className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-sm font-medium rounded-lg transition"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition group">
                  <a
                    href={`/${user?.username ?? space.ref.split('/')[0]}/spaces/${space.type}/${space.slug}`}
                    className="flex items-center gap-3 flex-1 min-w-0 px-4 py-3"
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
                  <button
                    onClick={() => { setError(''); setDeleteConfirm(space.ref) }}
                    className="opacity-0 group-hover:opacity-100 mr-2 p-1.5 text-slate-600 hover:text-red-400 transition rounded shrink-0"
                    title="Delete space"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
