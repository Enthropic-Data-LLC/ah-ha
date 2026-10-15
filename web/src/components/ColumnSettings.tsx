import { useState } from 'react'
import type { BoardColumn } from '../lib/types'

const COLORS = ['#94a3b8', '#e2e8f0', '#818cf8', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185']

export interface ColumnChanges {
  title?: string
  color?: string
  in_today?: boolean
  today_priority?: number
}

interface Props {
  column: BoardColumn
  columns: BoardColumn[]
  /** Cards in this column, including snoozed and filtered-out ones. */
  cardCount: number
  onSave: (changes: ColumnChanges) => Promise<void>
  onMove: (direction: 'left' | 'right') => Promise<void>
  /** [moveTo]: another column to put this column's cards in first. */
  onDelete: (moveTo: string | null) => Promise<void>
  onClose: () => void
}

/** Everything about one board column: name, colour, Ah! Today, position, delete. */
export default function ColumnSettings({ column, columns, cardCount, onSave, onMove, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(column.title)
  const [color, setColor] = useState(column.color)
  const [inToday, setInToday] = useState(!!column.in_today)
  const [priority, setPriority] = useState(column.today_priority ?? 1)
  const others = columns.filter(c => c._id !== column._id)
  const [moveTo, setMoveTo] = useState(others[0]?._id ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idx = columns.findIndex(c => c._id === column._id)

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true); setError(null)
    try { await fn(); if (close) onClose() }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong') }
    finally { setBusy(false) }
  }

  function save() {
    const changes: ColumnChanges = {}
    if (title.trim() && title.trim() !== column.title) changes.title = title.trim()
    if (color !== column.color) changes.color = color
    if (inToday !== !!column.in_today) changes.in_today = inToday
    if (inToday && priority !== (column.today_priority ?? 1)) changes.today_priority = priority
    if (inToday && !column.in_today) changes.today_priority = priority
    if (Object.keys(changes).length === 0) { onClose(); return }
    run(() => onSave(changes))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Column settings: ${column.title}`}
        onClick={e => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-xl p-5 w-full sm:max-w-sm space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Column settings</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-200" aria-label="Close">✕</button>
        </div>

        {/* Name + colour */}
        <div className="space-y-2">
          <label className="text-xs text-slate-500 block" htmlFor="col-title">Name</label>
          <input
            id="col-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
          <div className="flex gap-2 pt-1" role="radiogroup" aria-label="Colour">
            {COLORS.map(c => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-slate-300' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Ah! Today */}
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>
              <span className="text-sm block">Show in Ah! Today</span>
              <span className="text-xs text-slate-500">Open cards in this column show on Ah! Today</span>
            </span>
            <input type="checkbox" checked={inToday} onChange={e => setInToday(e.target.checked)} className="w-5 h-5 accent-indigo-500" />
          </label>
          <div className={inToday ? '' : 'opacity-40 pointer-events-none'}>
            <span className="text-xs text-slate-500 block mb-1.5">Priority — higher shows first (e.g. In Progress 5, To Do 2)</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Priority in Ah! Today">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={priority === n}
                  disabled={!inToday}
                  onClick={() => setPriority(n)}
                  className={`flex-1 py-1.5 rounded-lg text-sm border transition ${
                    priority === n ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >{n}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Position */}
        <div className="flex items-center justify-between">
          <span className="text-sm">Position</span>
          <div className="flex gap-2">
            <button
              onClick={() => run(() => onMove('left'), false)}
              disabled={busy || idx <= 0}
              className="px-3 py-1.5 text-sm border border-slate-700 rounded-lg text-slate-300 hover:border-slate-500 disabled:opacity-30"
            >‹ Left</button>
            <button
              onClick={() => run(() => onMove('right'), false)}
              disabled={busy || idx === columns.length - 1}
              className="px-3 py-1.5 text-sm border border-slate-700 rounded-lg text-slate-300 hover:border-slate-500 disabled:opacity-30"
            >Right ›</button>
          </div>
        </div>

        {/* Delete */}
        <div className="border-t border-slate-800 pt-4 space-y-2">
          {cardCount > 0 && (
            others.length > 0 ? (
              <label className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                Move its {cardCount} card{cardCount === 1 ? '' : 's'} to
                <select
                  value={moveTo}
                  onChange={e => setMoveTo(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
                >
                  {others.map(c => <option key={c._id} value={c._id}>{c.title}</option>)}
                </select>
              </label>
            ) : (
              <p className="text-xs text-slate-500">This is the only column — delete or move its cards before deleting it.</p>
            )
          )}
          <button
            onClick={() => confirming ? run(() => onDelete(cardCount > 0 ? moveTo : null)) : setConfirming(true)}
            disabled={busy || (cardCount > 0 && others.length === 0)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition disabled:opacity-30 ${
              confirming ? 'bg-red-600 hover:bg-red-500 text-white' : 'border border-red-900/60 text-red-400 hover:bg-red-950/40'
            }`}
          >
            {confirming
              ? (cardCount > 0 ? `Confirm — move ${cardCount} card${cardCount === 1 ? '' : 's'} and delete` : 'Confirm delete')
              : 'Delete column'}
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button
            onClick={save}
            disabled={busy || !title.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition"
          >{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
