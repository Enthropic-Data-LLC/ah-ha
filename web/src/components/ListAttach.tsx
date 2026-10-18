import { useState } from 'react'
import useSWR from 'swr'
import { api, fetcher } from '../lib/api'
import type { Space } from '../lib/types'

interface Item { _id: string; title: string; done: boolean }

export interface ListChoice { list_id: string | null; list_gate: boolean }

/**
 * Tie a card to a list: a supply list that must be gathered, or a checklist of subtasks.
 * Completeness is counted from the list's items; with the gate on, the card can't be
 * finished until nothing is left open (the server enforces it).
 */
export default function ListAttach({ cardTitle, listId, gate, onChange }: {
  cardTitle: string
  listId: string | null
  gate: boolean
  onChange: (next: ListChoice) => void | Promise<void>
}) {
  const { data: spaces, mutate: mutateSpaces } = useSWR<{ data: Space[] }>('/api/spaces?type=list', fetcher)
  const lists = spaces?.data ?? []
  const current = lists.find(l => l._id === listId)
  const { data: itemData, mutate: mutateItems } = useSWR<{ data: Item[] }>(
    current ? `/api/list/${current.slug}/items` : null, fetcher)
  const items = itemData?.data ?? []
  const done = items.filter(i => i.done).length
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }

  const createChecklist = () => run(async () => {
    const name = (cardTitle.trim() || 'Checklist').slice(0, 90)
    // Slug is derived from the name; add a short suffix so two cards with the same title don't collide.
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'checklist'}-${Math.random().toString(36).slice(2, 6)}`
    const res = await api.post<{ data: Space }>('/api/spaces', { type: 'list', name, slug })
    await mutateSpaces()
    await onChange({ list_id: res.data._id, list_gate: true })
  })

  const addItem = () => run(async () => {
    if (!current || !newItem.trim()) return
    await api.post(`/api/list/${current.slug}/items`, { title: newItem.trim() })
    setNewItem('')
    await mutateItems()
  })

  const toggle = (item: Item) => run(async () => {
    if (!current) return
    await api.patch(`/api/list/${current.slug}/items/${item._id}/check`, { done: !item.done })
    await mutateItems()
  })

  return (
    <div className="space-y-2">
      <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">List</label>
      <div className="flex gap-2">
        <select
          value={listId ?? ''}
          onChange={e => onChange({ list_id: e.target.value || null, list_gate: gate })}
          className="flex-1 min-w-0 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">No list</option>
          {lists.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
        </select>
        <button
          type="button"
          onClick={createChecklist}
          disabled={busy}
          className="px-3 py-2 text-xs text-indigo-300 border border-indigo-800 hover:bg-indigo-950/40 rounded-lg disabled:opacity-40 whitespace-nowrap"
        >
          + New checklist
        </button>
      </div>

      {current && (
        <div className="rounded-xl border border-slate-800 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${items.length > 0 && done === items.length ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: items.length ? `${(done / items.length) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-400">{done}/{items.length}</span>
          </div>

          <ul className="space-y-1">
            {items.map(i => (
              <li key={i._id}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={i.done} onChange={() => toggle(i)} disabled={busy} className="accent-indigo-500" />
                  <span className={i.done ? 'line-through text-slate-600' : 'text-slate-300'}>{i.title}</span>
                </label>
              </li>
            ))}
          </ul>

          <form onSubmit={e => { e.preventDefault(); void addItem() }} className="flex gap-2">
            <input
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              placeholder="Add an item…"
              className="flex-1 min-w-0 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button type="submit" disabled={busy || !newItem.trim()} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40">Add</button>
          </form>

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer pt-1">
            <input type="checkbox" checked={gate} onChange={e => onChange({ list_id: listId, list_gate: e.target.checked })} className="accent-indigo-500" />
            Can't finish this task until the list is complete
          </label>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
