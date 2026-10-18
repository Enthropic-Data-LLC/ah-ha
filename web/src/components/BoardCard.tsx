import { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { gateModeOf, type BoardCard } from '../lib/types'
import DeferMenu from './DeferMenu'
import { useEntities } from './ContextPicker'

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
    return days === 1 ? 'since yesterday' : `${days}d past due`
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
  onComplete?: (cardId: string) => Promise<void>
  onTag?: (card: BoardCard) => void
  /** The column's closer kind — a card in a closer column counts as closed even if it was put there before the flag existed. */
  columnCloses?: 'done' | 'closed' | null
  /** Put an archived card back on the board. */
  onRestore?: (card: BoardCard) => void
}

export default function BoardCardItem({ card, index, onClick, onDefer, onPickDate, onComplete, onTag, columnCloses, onRestore }: Props) {
  const { data: entityData } = useEntities()
  const [showDefer, setShowDefer] = useState(false)
  const [completing, setCompleting] = useState(false)
  const isRecurring = !!card.recurrence
  const closedAs = columnCloses ?? card.closed_as ?? null
  const timing = closedAs ? 'none' : getTimingState(card)
  const t = TIMING_STYLES[timing]
  const dueLabel = formatDueLabel(card, timing)
  const isDeferred = timing === 'deferred'
  const ctxChips = (card.contexts ?? []).map(c => {
    const e = entityData?.data.find(x => x._id === c.entity_id)
    return e ? { id: e._id, label: `${e.icon} ${e.name}`, times: c.time_chunks.length } : null
  }).filter((x): x is { id: string; label: string; times: number } => !!x)
  const lp = card.list_progress
  const gateMode = gateModeOf(card)
  const gated = !!lp && gateMode !== 'none' && !lp.complete
  const streak = (card.recurrence?.archetype === 'habit' && (card.recurrence.streak_count ?? 0) > 2)
    ? card.recurrence.streak_count
    : null

  return (
    <Draggable draggableId={card._id} index={index} isDragDisabled={!!closedAs}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => { if (!closedAs && !showDefer) onClick(card) }}
          className={`
            relative group px-3 py-2.5 rounded-lg bg-slate-800 border select-none space-y-1.5 transition ${closedAs ? 'cursor-default' : 'cursor-pointer'}
            ${t.border} ${t.bg}
            ${isDeferred || closedAs ? 'opacity-50' : ''}
            ${snapshot.isDragging
              ? `border-indigo-500 shadow-xl shadow-indigo-900/30 rotate-1`
              : `border-slate-700 hover:border-slate-600 ${t.glow ? 'shadow-sm ' + t.glow : ''}`
            }
          `}
          style={provided.draggableProps.style}
        >
          {/* Title row */}
          <div className="flex items-start justify-between gap-1">
            <p className={`text-sm leading-snug flex-1 ${isDeferred ? 'text-slate-400' : ''} ${closedAs === 'done' ? 'line-through text-slate-500' : closedAs === 'closed' ? 'text-slate-500 italic' : ''}`}>
              {closedAs && <span className={`mr-1.5 not-italic no-underline inline-block ${closedAs === 'done' ? 'text-emerald-500' : 'text-slate-500'}`}>{closedAs === 'done' ? '✓' : '✕'}</span>}{card.title}
            </p>
            <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
              {streak && (
                <span className="text-xs text-orange-400">🔥{streak}</span>
              )}
              {onTag && !closedAs && (
                <button
                  onClick={e => { e.stopPropagation(); onTag(card) }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 text-slate-600 hover:text-indigo-300 rounded transition leading-none"
                  title="Tag with a place, person, time or list"
                  aria-label="Tag card"
                >
                  ◈
                </button>
              )}
              {onComplete && !closedAs && (isRecurring || !!lp) && (
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    setCompleting(true)
                    await onComplete(card._id)
                    setCompleting(false)
                  }}
                  disabled={completing}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 text-slate-600 hover:text-emerald-400 rounded transition leading-none disabled:opacity-30"
                  title={gated ? `Finish the list first — ${lp!.total - lp!.done} still open` : isRecurring ? 'Done — advance recurrence' : 'Done'}
                  aria-label="Mark done"
                >
                  {completing ? '…' : '✓'}
                </button>
              )}
              {onDefer && !closedAs && (
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

          {closedAs && onRestore && (
            <button
              onClick={e => { e.stopPropagation(); onRestore(card) }}
              className="text-xs text-slate-500 hover:text-indigo-300 transition"
            >↩ Restore to board</button>
          )}

          {/* Timing banner — only when there's a date signal */}
          {dueLabel && (
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${t.label}`}>{dueLabel}</span>
              {timing === 'overdue' && <span className="text-amber-600 text-xs">●</span>}
            </div>
          )}

          {/* Where / who / when, and the list it needs */}
          {(ctxChips.length > 0 || lp) && (
            <div className="flex flex-wrap items-center gap-1">
              {ctxChips.map(c => (
                <span key={c.id} className="text-xs px-1.5 py-0.5 rounded bg-indigo-950/40 text-indigo-300 border border-indigo-900/60">
                  {c.label}{c.times > 0 && <span className="text-indigo-500"> · {c.times} time{c.times > 1 ? 's' : ''}</span>}
                </span>
              ))}
              {lp && (
                <span
                  className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${
                    lp.complete ? 'border-emerald-800 text-emerald-400 bg-emerald-950/30' : 'border-slate-700 text-slate-400'
                  }`}
                  title={`${lp.name}${gated ? (gateMode === 'move' ? ' — card is locked in place' : ' — card can\'t be completed yet') : ''}`}
                >
                  {lp.complete ? '✓' : gated ? '🔒' : '☰'} {lp.done}/{lp.total}
                </span>
              )}
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
