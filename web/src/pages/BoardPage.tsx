import { useState, useRef } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useBoardColumns, useBoardCards, useBoardActions } from '../hooks/useBoard'
import { useMe } from '../hooks/useMe'
import { api } from '../lib/api'
import BoardCardItem from '../components/BoardCard'
import CardModal from '../components/CardModal'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import type { BoardCard, BoardColumn } from '../lib/types'

interface Props {
  slug: string
}

function AddCardForm({ columnId, onAdd }: { columnId: string; onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await onAdd(title.trim())
    setTitle('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:text-slate-400 hover:bg-slate-800/50 rounded-lg transition"
      >
        + Add card
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
        placeholder="Card title"
        rows={2}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-300">
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function BoardPage({ slug }: Props) {
  const { data: colData, mutate: mutateColumns } = useBoardColumns(slug)
  const { data: cardData, mutate: mutateCards } = useBoardCards(slug)
  const actions = useBoardActions(slug)
  const { user } = useMe()
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const columns: BoardColumn[] = colData?.data ?? []
  const cards: BoardCard[] = cardData?.data ?? []

  const cardsByColumn = columns.reduce<Record<string, BoardCard[]>>((acc, col) => {
    acc[col._id] = cards
      .filter(c => c.column_id === col._id)
      .sort((a, b) => a.position - b.position)
    return acc
  }, {})

  async function onDragEnd(result: DropResult) {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const filteredDest = (cardsByColumn[destination.droppableId] ?? []).filter(c => c._id !== draggableId)
    const before = filteredDest[destination.index - 1] ?? null
    const after = filteredDest[destination.index] ?? null

    await actions.moveCard(draggableId, {
      column_id: destination.droppableId,
      before_id: before?._id ?? null,
      after_id: after?._id ?? null,
    })
    await mutateCards()
  }

  async function addCard(columnId: string, title: string) {
    await actions.createCard({ column_id: columnId, title })
    await mutateCards()
  }

  async function saveCard(id: string, updates: Partial<BoardCard>) {
    await actions.updateCard(id, updates)
    await mutateCards()
  }

  async function deleteCard(id: string) {
    await actions.deleteCard(id)
    await mutateCards()
  }

  async function completeCard(cardId: string) {
    await api.post(`/api/cards/${cardId}/complete`, {})
    await mutateCards()
  }

  async function deferCard(card: BoardCard, until: Date | null, label: string) {
    await saveCard(card._id, { defer_until: until?.toISOString() ?? null })
    const msg = label === 'Someday' ? 'Moved to someday' : `Snoozed — ${label.toLowerCase()}`
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 2500)
  }

  async function addColumn() {
    const title = prompt('Column name:')
    if (!title?.trim()) return
    await actions.createColumn({ title: title.trim() })
    await mutateColumns()
  }

  async function moveColumn(colId: string, direction: 'left' | 'right') {
    await api.patch(`/api/board/${slug}/columns/${colId}/move`, { direction })
    await mutateColumns()
  }

  async function deleteColumn(colId: string) {
    await api.delete(`/api/board/${slug}/columns/${colId}`)
    await mutateColumns()
    await mutateCards()
  }

  // Date range filter
  const SLIDER_STEPS = [1, 3, 7, 14, 30, Infinity]
  const SLIDER_LABELS = ['Today', '3 days', '1 week', '2 weeks', '30 days', 'All']
  const [sliderStep, setSliderStep] = useState(5) // default: All
  const [showUndated, setShowUndated] = useState(true)

  const dueDays = SLIDER_STEPS[sliderStep]

  function cardVisible(card: BoardCard): boolean {
    const now = new Date()
    const isDeferred = card.defer_until && new Date(card.defer_until) > now
    const hasDueDate = !!card.due_date && !isDeferred
    if (!hasDueDate) return showUndated
    if (dueDays === Infinity) return true
    const cutoff = new Date(now.getTime() + dueDays * 86400000)
    cutoff.setHours(23, 59, 59, 999)
    return new Date(card.due_date!) <= cutoff
  }

  function haptic(ms = 8) {
    navigator.vibrate?.(ms)
  }

  const visibleCardsByColumn = columns.reduce<Record<string, BoardCard[]>>((acc, col) => {
    acc[col._id] = (cardsByColumn[col._id] ?? []).filter(c => cardVisible(c))
    return acc
  }, {})

  const [captureText, setCaptureText] = useState('')
  const [capturing, setCapturing] = useState(false)
  type ParsedCard = { title: string; due_date?: string | null; start_date?: string | null; recurrence?: unknown; parsed?: boolean }
  const [parsedCard, setParsedCard] = useState<null | ParsedCard>(null)

  async function captureCard(e: React.FormEvent) {
    e.preventDefault()
    if (!captureText.trim()) return
    setCapturing(true)
    try {
      const res = await api.post<{ data: ParsedCard }>(`/api/board/${slug}/cards/capture`, { text: captureText })
      setParsedCard((res as { data: ParsedCard }).data)
    } finally { setCapturing(false) }
  }

  async function confirmCapture() {
    if (!parsedCard || !columns[0]) return
    await actions.createCard({ column_id: columns[0]._id, title: parsedCard.title, due_date: parsedCard.due_date ?? undefined, start_date: parsedCard.start_date ?? undefined, recurrence: parsedCard.recurrence ?? undefined } as Parameters<typeof actions.createCard>[0])
    await mutateCards()
    setCaptureText('')
    setParsedCard(null)
  }

  async function deleteSpace() {
    if (!user?.username) return
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(`${user.username}/board/${slug}`)}`)
      window.location.href = `/${user.username}/spaces`
    } catch {
      setDeleting(false)
    }
  }

  if (!colData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Board header */}
      <div className="flex flex-col border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center justify-between px-6 py-3">
          <h1 className="font-semibold capitalize">{slug}</h1>
          <div className="flex items-center gap-2">
          <button
            onClick={addColumn}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            + Column
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="px-2 py-1.5 text-sm text-slate-600 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
            title="Delete board"
          >
            ✕
          </button>
        </div>
        </div>
        {/* Quick capture */}
        <form onSubmit={captureCard} className="px-4 pb-3 flex gap-2">
          <input value={captureText} onChange={e => setCaptureText(e.target.value)}
            placeholder="Quick add… (AI parses dates & recurrence)"
            className="flex-1 px-3 py-1.5 bg-slate-800/60 border border-slate-800 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600"
          />
          <button type="submit" disabled={capturing || !captureText.trim()}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm rounded-lg transition">
            {capturing ? '…' : '+'}
          </button>
        </form>
        {parsedCard && (
          <div className="mx-4 mb-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-between gap-3">
            <div className="text-xs text-slate-300 flex-1 min-w-0">
              <span className="font-medium truncate block">{parsedCard.title}</span>
              <div className="flex gap-2 mt-0.5 flex-wrap">
                {parsedCard.due_date && <span className="text-indigo-400">due {new Date(parsedCard.due_date).toLocaleDateString()}</span>}
                {parsedCard.start_date && <span className="text-slate-400">starts {new Date(parsedCard.start_date).toLocaleDateString()}</span>}
                {parsedCard.recurrence && <span className="text-emerald-400">repeats</span>}
                {!parsedCard.parsed && <span className="text-slate-600">no AI key — add one in Settings</span>}
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={confirmCapture} className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-xs rounded transition">Add</button>
              <button onClick={() => { setCaptureText(''); setParsedCard(null) }} className="px-2 py-1 text-slate-500 hover:text-slate-300 text-xs rounded transition">✕</button>
            </div>
          </div>
        )}

        {/* Date range filter */}
        <div className="px-4 pb-3 flex items-center gap-2">
          {/* Calendar-check icon — dated filter label */}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`w-4 h-4 flex-shrink-0 ${sliderStep < 5 ? 'text-indigo-400' : 'text-slate-600'}`}>
            <rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/>
            <line x1="5" y1="1" x2="5" y2="4"/>
            <line x1="11" y1="1" x2="11" y2="4"/>
            <line x1="1.5" y1="6" x2="14.5" y2="6"/>
            <polyline points="5.5 10 7 11.5 10.5 8.5"/>
          </svg>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={sliderStep}
            onChange={e => {
              haptic(6)
              setSliderStep(Number(e.target.value))
            }}
            className="flex-1 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className={`text-xs w-12 text-right flex-shrink-0 tabular-nums ${sliderStep < 5 ? 'text-indigo-400' : 'text-slate-600'}`}>
            {SLIDER_LABELS[sliderStep]}
          </span>
          {/* Calendar-no icon — undated toggle */}
          <button
            type="button"
            onClick={() => { haptic(10); setShowUndated(v => !v) }}
            className={`p-1 rounded-lg transition flex-shrink-0 ${showUndated ? 'text-slate-500' : 'text-slate-700'}`}
            title={showUndated ? 'Hide undated' : 'Show undated'}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/>
              <line x1="5" y1="1" x2="5" y2="4"/>
              <line x1="11" y1="1" x2="11" y2="4"/>
              <line x1="1.5" y1="6" x2="14.5" y2="6"/>
              <circle cx="8" cy="10" r="3.5"/>
              <line x1="5.5" y1="7.5" x2="10.5" y2="12.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Columns — mobile: snap scroll; desktop: free scroll */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div
          className="flex-1 overflow-x-auto"
          style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="flex gap-3 p-4 h-full items-start min-w-max">
            {columns.map((col, colIdx) => (
              <div
                key={col._id}
                className="w-72 flex-shrink-0"
                style={{ scrollSnapAlign: 'start' }}
              >
                {/* Column header */}
                <div className="flex items-center gap-1.5 mb-3 px-1 group">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                  <h2 className="text-sm font-semibold flex-1 truncate">{col.title}</h2>
                  <span className="text-xs text-slate-600">
                    {(visibleCardsByColumn[col._id] ?? []).length}
                    {(visibleCardsByColumn[col._id] ?? []).length !== (cardsByColumn[col._id] ?? []).length && (
                      <span className="text-slate-700">/{(cardsByColumn[col._id] ?? []).length}</span>
                    )}
                  </span>
                  {/* Move buttons — visible on hover (desktop) or always (mobile) */}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-0">
                    <button
                      onClick={() => moveColumn(col._id, 'left')}
                      disabled={colIdx === 0}
                      className="p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition rounded"
                      title="Move left"
                    >‹</button>
                    <button
                      onClick={() => moveColumn(col._id, 'right')}
                      disabled={colIdx === columns.length - 1}
                      className="p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition rounded"
                      title="Move right"
                    >›</button>
                  </div>
                </div>

                <Droppable droppableId={col._id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-2 min-h-[4px] rounded-xl p-1 transition-colors ${
                        snapshot.isDraggingOver ? 'bg-slate-800/60' : ''
                      }`}
                    >
                      {(visibleCardsByColumn[col._id] ?? []).map((card, index) => (
                        <BoardCardItem
                          key={card._id}
                          card={card}
                          index={index}
                          onClick={setActiveCard}
                          onDefer={(until, label) => deferCard(card, until, label)}
                          onPickDate={setActiveCard}
                          onComplete={completeCard}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                <div className="mt-2 px-1">
                  <AddCardForm
                    columnId={col._id}
                    onAdd={title => addCard(col._id, title)}
                  />
                </div>
              </div>
            ))}

            {columns.length === 0 && (
              <div className="flex items-center justify-center w-full h-64 text-slate-600 text-sm">
                No columns yet — click &quot;+ Column&quot; to get started.
              </div>
            )}
          </div>
        </div>
      </DragDropContext>

      {activeCard && (
        <CardModal
          card={activeCard}
          columns={columns}
          onClose={() => setActiveCard(null)}
          onSave={saveCard}
          onDelete={deleteCard}
        />
      )}

      {showDelete && (
        <ConfirmDeleteModal
          name={slug}
          type="board"
          onConfirm={deleteSpace}
          onCancel={() => setShowDelete(false)}
          deleting={deleting}
        />
      )}

      {/* Snooze toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 shadow-xl pointer-events-none whitespace-nowrap">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
