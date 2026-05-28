import { useState } from 'react'
import type { BoardCard, BoardColumn } from '../lib/types'

interface Props {
  card: BoardCard
  columns: BoardColumn[]
  onClose: () => void
  onSave: (id: string, updates: Partial<BoardCard>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function CardModal({ card, columns, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(card.title)
  const [notes, setNotes] = useState(card.notes)
  const [priority, setPriority] = useState(card.priority)
  const [tags, setTags] = useState(card.tags.join(', '))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    await onSave(card._id, {
      title,
      notes,
      priority,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    setSaving(false)
    onClose()
  }

  async function remove() {
    if (!confirm('Delete this card?')) return
    await onDelete(card._id)
    onClose()
  }

  const col = columns.find(c => c._id === card.column_id)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500">{col?.title}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <textarea
            value={title}
            onChange={e => setTitle(e.target.value)}
            rows={2}
            className="w-full bg-transparent text-base font-medium resize-none focus:outline-none"
          />

          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={5}
              placeholder="Add notes…"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as BoardCard['priority'])}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="tag1, tag2"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between">
          <button onClick={remove} className="text-sm text-red-500 hover:text-red-400 transition">
            Delete
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
