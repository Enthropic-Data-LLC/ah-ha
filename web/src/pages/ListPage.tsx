import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'
import { useMe } from '../hooks/useMe'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import type { Entity, ListItem } from '../lib/types'

export default function ListPage({ slug }: { slug: string }) {
  const { user } = useMe()
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  const { data, mutate } = useSWR<{ data: ListItem[]; meta?: { default_repeat?: 'once' | 'always' } }>(`/api/list/${slug}/items`, fetcher)
  const { data: entityData } = useSWR<{ data: Entity[] }>('/api/entities', fetcher)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    try {
      await api.post(`/api/list/${slug}/items`, { title: title.trim() })
      setTitle('')
      await mutate()
    } finally {
      setAdding(false) }
  }

  async function toggleDone(item: ListItem) {
    await api.patch(`/api/list/${slug}/items/${item._id}/check`, { done: !item.done })
    await mutate()
  }

  async function toggleRepeat(item: ListItem) {
    await api.patch(`/api/list/${slug}/items/${item._id}`, { repeat: item.repeat === 'always' ? 'once' : 'always' })
    await mutate()
  }

  async function setDefaultRepeat(repeat: 'once' | 'always') {
    await api.patch(`/api/list/${slug}/settings`, { default_repeat: repeat })
    await mutate()
  }

  async function deleteItem(id: string) {
    await api.delete(`/api/list/${slug}/items/${id}`)
    await mutate()
  }

  async function toggleEntityContext(item: ListItem, entityId: string) {
    const current = item.contexts ?? []
    const exists = current.find(c => c.entity_id === entityId)
    const next = exists
      ? current.filter(c => c.entity_id !== entityId)
      : [...current, { entity_id: entityId, time_chunks: [] }]
    await api.patch(`/api/list/${slug}/items/${item._id}`, { contexts: next })
    await mutate()
  }

  async function deleteSpace() {
    if (!user?.username) return
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(`${user.username}/list/${slug}`)}`)
      window.location.href = `/${user.username}/spaces`
    } catch { setDeleting(false) }
  }

  const items = data?.data ?? []
  const defaultRepeat = data?.meta?.default_repeat ?? 'once'
  const entities = entityData?.data ?? []
  const open = items.filter(i => !i.done)
  const done = items.filter(i => i.done)

  return (
    <>
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold capitalize">{slug}</h1>
        <button onClick={() => setShowDelete(true)} className="text-slate-700 hover:text-red-400 text-xs transition" title="Delete list">✕</button>
      </div>

      <form onSubmit={addItem} className="flex gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Add an item…"
          className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" disabled={adding || !title.trim()} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
          Add
        </button>
      </form>
      <div className="flex items-center gap-2 -mt-3 text-xs text-slate-500">
        <span>New items:</span>
        {(['once', 'always'] as const).map(r => (
          <button
            key={r}
            onClick={() => setDefaultRepeat(r)}
            className={`px-2 py-0.5 rounded border transition ${defaultRepeat === r ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 hover:border-slate-500'}`}
          >
            {r === 'once' ? '1x' : '↻ Always'}
          </button>
        ))}
        <span className="text-slate-600">{defaultRepeat === 'always' ? 'checked items come back tomorrow' : 'checked items stay done'}</span>
      </div>

      <div className="space-y-1">
        {open.length === 0 && done.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">No items yet.</p>
        )}
        {open.length === 0 && done.length > 0 && (
          <div className="text-center py-4 text-emerald-400 text-sm font-medium">
            All done ✓
          </div>
        )}
        {open.map(item => (
          <div key={item._id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 group">
              <button onClick={() => toggleDone(item)} className="w-5 h-5 rounded border-2 border-slate-600 hover:border-indigo-400 flex-shrink-0 transition" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm">{item.title}</span>
                {item.reason && (
                  <span className="block text-xs text-slate-500" title={item.source === 'ah-restock' ? 'Added by Restock' : undefined}>
                    {item.source === 'ah-restock' ? '↺ ' : ''}{item.reason}
                  </span>
                )}
              </span>
              <button
                onClick={() => toggleRepeat(item)}
                className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition ${item.repeat === 'always' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-600 border border-slate-800 hover:text-slate-400'}`}
                title={item.repeat === 'always' ? 'Always: comes back tomorrow after you check it. Tap for 1x' : '1x: done for good once checked. Tap for Always'}
              >
                {item.repeat === 'always' ? '↻ Always' : '1x'}
              </button>
              {item.due_at && <span className="text-xs text-slate-500 flex-shrink-0">{new Date(item.due_at).toLocaleDateString()}</span>}
              {/* Place: tagged → chips (tap to change); untagged → a visible button. Never hover-only:
                  phones have no hover, so a hover-revealed button is invisible there. */}
              {entities.length > 0 && (() => {
                const tagged = (item.contexts ?? [])
                  .map(c => entities.find(e => e._id === c.entity_id))
                  .filter((e): e is Entity => !!e)
                return (
                  <button
                    onClick={() => setExpandedItem(expandedItem === item._id ? null : item._id)}
                    className="flex items-center gap-1 flex-shrink-0"
                    title={tagged.length ? 'Change place' : 'Tag to a place'}
                  >
                    {tagged.length > 0
                      ? tagged.map(e => (
                          <span key={e._id} className="text-xs bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">
                            {e.icon} {e.name}
                          </span>
                        ))
                      : <span className="text-xs text-slate-500 hover:text-indigo-400 border border-dashed border-slate-700 px-1.5 py-0.5 rounded transition">📍 Where?</span>}
                  </button>
                )
              })()}
              <button onClick={() => deleteItem(item._id)} className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition flex-shrink-0">✕</button>
            </div>
            {/* Inline entity picker */}
            {expandedItem === item._id && entities.length > 0 && (
              <div className="px-4 pb-3 border-t border-slate-800 pt-2 flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-600 w-full mb-0.5">Do this at…</span>
                {entities.map(e => {
                  const active = (item.contexts ?? []).some(c => c.entity_id === e._id)
                  return (
                    <button
                      key={e._id}
                      onClick={() => toggleEntityContext(item, e._id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${
                        active ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      {e.icon} {e.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {done.length > 0 && (
          <>
            <p className="text-xs text-slate-600 pt-3 pb-1">Completed</p>
            {done.map(item => (
              <div key={item._id} className="flex items-center gap-3 px-4 py-2.5 bg-slate-900/50 border border-slate-800/50 rounded-xl group opacity-50">
                <button onClick={() => toggleDone(item)} className="w-5 h-5 rounded border-2 border-indigo-600 bg-indigo-600 flex-shrink-0 flex items-center justify-center transition">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </button>
                <span className="flex-1 text-sm line-through text-slate-500">{item.title}</span>
                {item.repeat === 'always' && <span className="text-xs text-emerald-500 flex-shrink-0">↻ back tomorrow</span>}
                <button onClick={() => deleteItem(item._id)} className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition">✕</button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>

    {showDelete && (
      <ConfirmDeleteModal
        name={slug}
        type="list"
        onConfirm={deleteSpace}
        onCancel={() => setShowDelete(false)}
        deleting={deleting}
      />
    )}
    </>
  )
}
