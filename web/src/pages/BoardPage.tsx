import { useState, useRef } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useBoardColumns, useBoardCards, useBoardActions } from '../hooks/useBoard'
import { useMe } from '../hooks/useMe'
import useSWR from 'swr'
import { api, fetcher } from '../lib/api'
import { DUE_WINDOWS, dueWindowLabel, type DueWindow } from '../lib/dueWindow'
import BoardCardItem from '../components/BoardCard'
import CardModal from '../components/CardModal'
import TagSheet from '../components/TagSheet'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import ColumnSettings, { type ColumnChanges } from '../components/ColumnSettings'
import type { BoardCard, BoardColumn } from '../lib/types'
import { useSpaceName } from '../hooks/useSpaceName'

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
  const spaceName = useSpaceName('board', slug)
  const { data: colData, mutate: mutateColumns } = useBoardColumns(slug)
  const { data: cardData, mutate: mutateCards } = useBoardCards(slug)
  const actions = useBoardActions(slug)
  const { user } = useMe()
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [taggingId, setTaggingId] = useState<string | null>(null)
  const archKey = `aha:board:${slug}:show-archived`
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(archKey) ?? '{}') } catch { return {} }
  })
  function toggleArchived(colId: string) {
    setShowArchived(prev => {
      const next = { ...prev, [colId]: !prev[colId] }
      try { localStorage.setItem(archKey, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }
  const [showDelete, setShowDelete] = useState(false)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
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

    try {
      await actions.moveCard(draggableId, {
        column_id: destination.droppableId,
        before_id: before?._id ?? null,
        after_id: after?._id ?? null,
      })
      const destCol = columns.find(c => c._id === destination.droppableId)
      if (destCol?.closes) toast(`Archived in ${destCol.title}${showArchived[destCol._id] ? '' : ' — use "show archived" to see it'}`)
    } catch (e) {
      // 409: heading into a Done column with its list unfinished
      toast(e instanceof Error ? e.message : 'Could not move')
    }
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

  // Put an archived card back at the end of the first ordinary column.
  async function restoreCard(card: BoardCard) {
    const dest = columns.find(c => !c.closes)
    if (!dest) { toast('Add a column that is not Done/Closed first'); return }
    const last = (cardsByColumn[dest._id] ?? []).at(-1)
    try {
      await actions.moveCard(card._id, { column_id: dest._id, before_id: last?._id ?? null, after_id: null })
      toast(`Restored to ${dest.title}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not restore')
    }
    await mutateCards()
  }

  async function deleteCard(id: string) {
    await actions.deleteCard(id)
    await mutateCards()
  }

  function toast(msg: string) {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 4000)
  }

  async function completeCard(cardId: string) {
    try {
      await api.post(`/api/cards/${cardId}/complete`, {})
    } catch (e) {
      // 409: the card's list still has open items
      toast(e instanceof Error ? e.message : 'Could not complete')
    }
    await mutateCards()
  }

  async function deferCard(card: BoardCard, until: Date | null, label: string) {
    await saveCard(card._id, { defer_until: until?.toISOString() ?? null })
    toast(label === 'Someday' ? 'Moved to someday' : `Snoozed — ${label.toLowerCase()}`)
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

  async function updateColumn(colId: string, updates: ColumnChanges) {
    await mutateColumns(
      d => d && { ...d, data: d.data.map(c => c._id === colId ? { ...c, ...updates } : c) },
      { revalidate: false },
    )
    await api.patch(`/api/board/${slug}/columns/${colId}`, updates)
    await mutateColumns()
  }

  async function deleteColumn(colId: string, moveTo: string | null) {
    await api.delete(`/api/board/${slug}/columns/${colId}${moveTo ? `?move_to=${moveTo}` : ''}`)
    await mutateColumns()
    await mutateCards()
  }

  // Date range filter
  // One setting per account (lib/dueWindow), saved as the slider moves; never set = All here.
  const { data: settings } = useSWR<{ data: { due_window: DueWindow | null } }>('/api/settings', fetcher)
  const [localWindow, setLocalWindow] = useState<DueWindow | null>(null)
  const dueWindow: DueWindow = localWindow ?? settings?.data?.due_window ?? 'all'
  const sliderStep = DUE_WINDOWS.indexOf(dueWindow)
  const saveWindow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function setSliderStep(step: number) {
    const w = DUE_WINDOWS[step]!
    setLocalWindow(w)
    clearTimeout(saveWindow.current)
    saveWindow.current = setTimeout(() => { api.put('/api/settings', { due_window: w }).catch(() => {}) }, 400)
  }
  const [showUndated, setShowUndated] = useState(true)


  function cardVisible(card: BoardCard): boolean {
    const now = new Date()
    const isDeferred = card.defer_until && new Date(card.defer_until) > now
    const hasDueDate = !!card.due_date && !isDeferred
    if (!hasDueDate) return showUndated
    if (dueWindow === 'all') return true
    // Today counts as day 1, so "3 days" is today, tomorrow and the day after.
    const cutoff = new Date(now)
    cutoff.setHours(23, 59, 59, 999)
    cutoff.setDate(cutoff.getDate() + dueWindow - 1)
    return new Date(card.due_date!) <= cutoff
  }

  function haptic(ms = 8) {
    navigator.vibrate?.(ms)
  }

  const visibleCardsByColumn = columns.reduce<Record<string, BoardCard[]>>((acc, col) => {
    acc[col._id] = col.closes
      ? (showArchived[col._id] ? (cardsByColumn[col._id] ?? []) : [])
      : (cardsByColumn[col._id] ?? []).filter(c => cardVisible(c))
    return acc
  }, {})

  const [captureText, setCaptureText] = useState('')
  const [capturing, setCapturing] = useState(false)
  type ParsedCard = { title: string; due_date?: string | null; start_date?: string | null; recurrence?: string | null; parsed?: boolean }
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
          <h1 className="font-semibold">{spaceName}</h1>
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
            className={`w-4 h-4 flex-shrink-0 ${dueWindow !== 'all' ? 'text-indigo-400' : 'text-slate-600'}`}>
            <rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/>
            <line x1="5" y1="1" x2="5" y2="4"/>
            <line x1="11" y1="1" x2="11" y2="4"/>
            <line x1="1.5" y1="6" x2="14.5" y2="6"/>
            <polyline points="5.5 10 7 11.5 10.5 8.5"/>
          </svg>
          <input
            type="range"
            min={0}
            max={DUE_WINDOWS.length - 1}
            step={1}
            value={sliderStep}
            onChange={e => {
              haptic(6)
              setSliderStep(Number(e.target.value))
            }}
            className="flex-1 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className={`text-xs w-12 text-right flex-shrink-0 tabular-nums ${dueWindow !== 'all' ? 'text-indigo-400' : 'text-slate-600'}`}>
            {dueWindowLabel(dueWindow)}
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
                  <button
                    onClick={() => setSettingsFor(col._id)}
                    className="text-sm font-semibold flex-1 truncate text-left hover:text-indigo-300 transition"
                    title="Column settings"
                  >{col.title}</button>
                  {col.in_today && (
                    <button
                      onClick={() => setSettingsFor(col._id)}
                      title={`Shown in Ah! Today, priority ${col.today_priority ?? 3} (1 is the highest)`}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-indigo-500 bg-indigo-500/15 text-indigo-300 flex-shrink-0"
                    >Today · P{col.today_priority ?? 3}</button>
                  )}
                  {col.closes && (
                    <button
                      onClick={() => toggleArchived(col._id)}
                      aria-pressed={!!showArchived[col._id]}
                      title={showArchived[col._id] ? 'Hide archived cards' : 'Show archived cards'}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0 transition ${
                        showArchived[col._id] ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300' : 'border-slate-700 text-slate-500 hover:text-slate-300'
                      }`}
                    >{showArchived[col._id] ? 'Hide' : 'Show'} archived</button>
                  )}
                  {col.closes && (
                    <span
                      title={col.closes === 'done' ? 'Done column — needs the card\'s list complete' : 'Closed column — drops the card, list or not'}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-600 text-slate-400 flex-shrink-0"
                    >{col.closes === 'done' ? '✓ done' : '✕ closed'}</span>
                  )}
                  <span className="text-xs text-slate-600">
                    {(visibleCardsByColumn[col._id] ?? []).length}
                    {(visibleCardsByColumn[col._id] ?? []).length !== (cardsByColumn[col._id] ?? []).length && (
                      <span className="text-slate-700">/{(cardsByColumn[col._id] ?? []).length}</span>
                    )}
                  </span>
                  <button
                    onClick={() => setSettingsFor(col._id)}
                    aria-label={`${col.title}: column settings`}
                    title="Column settings — name, colour, Ah! Today, priority, move, delete"
                    className="px-1.5 py-0.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded transition flex-shrink-0"
                  >⋯</button>
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
                          onTag={c => setTaggingId(c._id)}
                          columnCloses={col.closes ?? null}
                          onRestore={restoreCard}
                        />
                      ))}
                      {provided.placeholder}
                      {col.closes && !showArchived[col._id] && (cardsByColumn[col._id] ?? []).length > 0 && (
                        <p className="px-2 py-3 text-xs text-slate-600 text-center">
                          {(cardsByColumn[col._id] ?? []).length} archived
                        </p>
                      )}
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

      {(() => {
        const tagging = cards.find(c => c._id === taggingId)
        return tagging && (
          <TagSheet key={tagging._id} card={tagging} onSave={saveCard} onClose={() => { setTaggingId(null); void mutateCards() }} />
        )
      })()}

      {(() => {
        const col = columns.find(c => c._id === settingsFor)
        return col && (
          <ColumnSettings
            key={col._id}
            column={col}
            columns={columns}
            cardCount={(cardsByColumn[col._id] ?? []).length}
            onSave={changes => updateColumn(col._id, changes)}
            onMove={direction => moveColumn(col._id, direction)}
            onDelete={moveTo => deleteColumn(col._id, moveTo)}
            onClose={() => setSettingsFor(null)}
          />
        )
      })()}

      {showDelete && (
        <ConfirmDeleteModal
          name={spaceName || slug}
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
