import { useState } from 'react'
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useBoardColumns, useBoardCards, useBoardActions } from '../hooks/useBoard'
import BoardCardItem from '../components/BoardCard'
import CardModal from '../components/CardModal'
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
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)

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

    const destCards = cardsByColumn[destination.droppableId] ?? []
    const beforeCard = destCards[destination.index - 1] ?? null
    const afterCard = destCards[destination.index] ?? null

    // Skip the card being moved when calculating neighbors
    const filteredDest = destCards.filter(c => c._id !== draggableId)
    const before = filteredDest[destination.index - 1] ?? null
    const after = filteredDest[destination.index] ?? null

    await actions.moveCard(draggableId, {
      column_id: destination.droppableId,
      before_id: before?._id ?? null,
      after_id: after?._id ?? null,
    })
    void beforeCard; void afterCard
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

  async function addColumn() {
    const title = prompt('Column name:')
    if (!title?.trim()) return
    await actions.createColumn({ title: title.trim() })
    await mutateColumns()
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
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
        <h1 className="font-semibold capitalize">{slug}</h1>
        <button
          onClick={addColumn}
          className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
        >
          + Column
        </button>
      </div>

      {/* Columns */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-4 h-full items-start min-w-max">
            {columns.map(col => (
              <div key={col._id} className="w-72 flex-shrink-0">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                  <h2 className="text-sm font-semibold flex-1 truncate">{col.title}</h2>
                  <span className="text-xs text-slate-600">{(cardsByColumn[col._id] ?? []).length}</span>
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
                      {(cardsByColumn[col._id] ?? []).map((card, index) => (
                        <BoardCardItem
                          key={card._id}
                          card={card}
                          index={index}
                          onClick={setActiveCard}
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
                No columns yet — click "+ Column" to get started.
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
    </div>
  )
}
