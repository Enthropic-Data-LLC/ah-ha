import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'

interface ListItem {
  _id: string
  title: string
  done: boolean
  done_at: string | null
  due_at: string | null
}

export default function ListPage({ slug }: { slug: string }) {
  const { data, mutate } = useSWR<{ data: ListItem[] }>(`/api/list/${slug}/items`, fetcher)
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
      setAdding(false)
    }
  }

  async function toggleDone(item: ListItem) {
    await api.patch(`/api/list/${slug}/items/${item._id}`, { done: !item.done })
    await mutate()
  }

  async function deleteItem(id: string) {
    await api.delete(`/api/list/${slug}/items/${id}`)
    await mutate()
  }

  const items = data?.data ?? []
  const open = items.filter(i => !i.done)
  const done = items.filter(i => i.done)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-xl font-bold capitalize">{slug}</h1>

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
        {open.map(item => (
          <div key={item._id} className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl group">
            <button onClick={() => toggleDone(item)} className="w-5 h-5 rounded border-2 border-slate-600 hover:border-indigo-400 flex-shrink-0 transition" />
            <span className="flex-1 text-sm">{item.title}</span>
            {item.due_at && <span className="text-xs text-slate-500">{new Date(item.due_at).toLocaleDateString()}</span>}
            <button onClick={() => deleteItem(item._id)} className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition">✕</button>
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
  )
}
