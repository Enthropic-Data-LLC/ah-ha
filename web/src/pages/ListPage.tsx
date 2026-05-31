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

  const { data, mutate } = useSWR<{ data: ListItem[] }>(`/api/list/${slug}/items`, fetcher)
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
              <span className="flex-1 text-sm">{item.title}</span>
              {/* Entity context chips — show active ones */}
              {(item.contexts ?? []).map(c => {
                const ent = entities.find(e => e._id === c.entity_id)
                return ent ? (
                  <span key={c.entity_id} className="text-xs bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded flex-shrink-0">
                    {ent.icon}
                  </span>
                ) : null
              })}
              {item.due_at && <span className="text-xs text-slate-500 flex-shrink-0">{new Date(item.due_at).toLocaleDateString()}</span>}
              {/* Entity tag button — only show if entities exist */}
              {entities.length > 0 && (
                <button
                  onClick={() => setExpandedItem(expandedItem === item._id ? null : item._id)}
                  className="text-slate-700 hover:text-indigo-400 opacity-0 group-hover:opacity-100 text-xs transition flex-shrink-0"
                  title="Tag to a place"
                >
                  📍
                </button>
              )}
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
