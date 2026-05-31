import { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import type { BoardCard } from '../lib/types'
import DeferMenu from './DeferMenu'

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low:    'bg-sky-500/20 text-sky-400 border-sky-500/30',
  none:   '',
}

function getTimingState(card: BoardCard): 'overdue' | 'today' | 'week' | 'deferred' | 'future' | 'none' {
  const now = new Date()

  // Deferred — intentionally snoozed, don't alarm
  if (card.defer_until && new Date(card.defer_until) > now) return 'deferred'

  if (!card.due_date) return 'none'
  const due = new Date(card.due_date)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7)

  if (due < now && due < todayEnd) {
    // Past midnight — overdue
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
    if (due < startOfToday) return 'overdue'
  }
  if (due <= todayEnd) return 'today'
  if (due <= weekEnd) return 'week'
  return 'future'
}

function formatDueLabel(card: BoardCard, state: string): string | null {
  if (state === 'deferred' && card.defer_until) {
    const d = new Date(card.defer_until)
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow'
    return 'snoozed ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (!card.due_date) return null
  const due = new Date(card.due_date)
  const now = new Date()
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)

  if (state === 'overdue') {
    const days = Math.floor((startOfToday.getTime() - due.getTime()) / 86400000)
    return days === 1 ? 'yesterday' : `${days}d overdue`
  }
  if (state === 'today') return 'today'
  if (state === 'week') return due.toLocaleDateString(undefined, { weekday: 'short' })
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const TIMING_STYLES: Record<string, { border: string; bg: string; label: string; glow?: string }> = {
  overdue:  { border: 'border-l-[3px] border-l-red-500',   bg: 'bg-red-950/30',    label: 'text-red-400',    glow: 'shadow-red-900/20' },
  today:    { border: 'border-l-[3px] border-l-amber-400', bg: 'bg-amber-950/20',  label: 'text-amber-400',  glow: 'shadow-amber-900/10' },
  week:     { border: 'border-l-[3px] border-l-indigo-500',bg: '',                 label: 'text-indigo-400', glow: '' },
  deferred: { border: 'border-l border-l-slate-700',       bg: '',                 label: 'text-slate-600',  glow: '' },
  future:   { border: 'border-l border-l-slate-700',       bg: '',                 label: 'text-slate-500',  glow: '' },
  none:     { border: '',                                   bg: '',                 label: '',                glow: '' },
}

interface Props {
  card: BoardCard
  index: number
  onClick: (card: BoardCard) => void
  onDefer?: (until: Date | null, label: string) => Promise<void>
  onPickDate?: (card: BoardCard) => void
}

export default function BoardCardItem({ card, index, onClick, onDefer, onPickDate }: Props) {
  const [showDefer, setShowDefer] = useState(false)
  const timing = getTimingState(card)
  const t = TIMING_STYLES[timing]
  const dueLabel = formatDueLabel(card, timing)
  const isDeferred = timing === 'deferred'
  const streak = (card.recurrence?.archetype === 'habit' && (card.recurrence.streak_count ?? 0) > 2)
    ? card.recurrence.streak_count
    : null

  return (
    <Draggable draggableId={card._id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => { if (!showDefer) onClick(card) }}
          className={`
            relative group px-3 py-2.5 rounded-lg bg-slate-800 border cursor-pointer select-none space-y-1.5 transition
            ${t.border} ${t.bg}
            ${isDeferred ? 'opacity-50' : ''}
            ${snapshot.isDragging
              ? `border-indigo-500 shadow-xl shadow-indigo-900/30 rotate-1`
              : `border-slate-700 hover:border-slate-600 ${t.glow ? 'shadow-sm ' + t.glow : ''}`
            }
          `}
          style={provided.draggableProps.style}
        >
          {/* Title row */}
          <div className="flex items-start justify-between gap-1">
            <p className={`text-sm leading-snug flex-1 ${isDeferred ? 'text-slate-400' : ''}`}>
              {card.title}
            </p>
            <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
              {streak && (
                <span className="text-xs text-orange-400">🔥{streak}</span>
              )}
              {onDefer && (
                <button
                  onClick={e => { e.stopPropagation(); setShowDefer(v => !v) }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 text-slate-600 hover:text-slate-300 rounded transition leading-none"
                  title="Snooze"
                  aria-label="Snooze card"
                >
                  ⋯
                </button>
              )}
            </div>
          </div>

          {/* Timing banner — only when there's a date signal */}
          {dueLabel && (
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${t.label}`}>{dueLabel}</span>
              {timing === 'overdue' && <span className="text-red-600 text-xs">●</span>}
            </div>
          )}

          {/* Priority + tags */}
          {(card.priority !== 'none' || card.tags.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {card.priority !== 'none' && (
                <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${PRIORITY_BADGE[card.priority]}`}>
                  {card.priority}
                </span>
              )}
              {card.tags.slice(0, 2).map(tag => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {card.notes && (
            <p className="text-xs text-slate-500 line-clamp-1">{card.notes}</p>
          )}

          {/* Defer dropdown */}
          {showDefer && onDefer && (
            <>
              {/* transparent click-outside layer */}
              <div
                className="fixed inset-0 z-40"
                onClick={e => { e.stopPropagation(); setShowDefer(false) }}
              />
              <div onClick={e => e.stopPropagation()} className="relative z-50">
                <DeferMenu
                  onDefer={async (until, label) => {
                    await onDefer(until, label)
                    setShowDefer(false)
                  }}
                  onClose={() => setShowDefer(false)}
                  onPickDate={onPickDate ? () => { setShowDefer(false); onPickDate(card) } : undefined}
                />
              </div>
            </>
          )}
        </div>
      )}
    </Draggable>
  )
}
