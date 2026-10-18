import { useEffect, useState } from 'react'
import { gateModeOf, type BoardCard, type GateMode } from '../lib/types'
import ContextPicker, { type CardContext } from './ContextPicker'
import ListAttach from './ListAttach'

/** Quick tagging straight from the board: where/who/when and the list a card needs. Saves as you go. */
export default function TagSheet({ card, onSave, onClose }: {
  card: BoardCard
  onSave: (id: string, updates: Partial<BoardCard>) => Promise<void>
  onClose: () => void
}) {
  const [contexts, setContexts] = useState<CardContext[]>(card.contexts ?? [])
  const [listId, setListId] = useState<string | null>(card.list_id ?? null)
  const [gate, setGate] = useState<GateMode>(gateModeOf(card))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <p className="text-sm font-medium truncate">{card.title}</p>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
        </div>
        <div className="p-4 space-y-5">
          <ContextPicker
            contexts={contexts}
            onChange={next => { setContexts(next); void onSave(card._id, { contexts: next }) }}
          />
          <ListAttach
            cardTitle={card.title}
            listId={listId}
            gate={gate}
            onChange={async next => {
              setListId(next.list_id); setGate(next.list_gate)
              await onSave(card._id, { list_id: next.list_id, list_gate: next.list_gate })
            }}
          />
        </div>
        <div className="p-4 border-t border-slate-800 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition">Done</button>
        </div>
      </div>
    </div>
  )
}
