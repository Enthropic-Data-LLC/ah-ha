import { useState, useEffect } from 'react'
import useSWR from 'swr'
import type { BoardCard, BoardColumn, Recurrence, RecurrenceArchetype } from '../lib/types'
import DeferMenu from './DeferMenu'
import { fetcher } from '../lib/api'

interface EntityOption { _id: string; name: string; icon: string }

interface Props {
  card: BoardCard
  columns: BoardColumn[]
  onClose: () => void
  onSave: (id: string, updates: Partial<BoardCard>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const PRIORITY_OPTS = ['none', 'low', 'medium', 'high'] as const

const TIME_CHUNK_OPTS = [
  { value: 'wakeup',         label: 'Wake up',    sub: '5–8am' },
  { value: 'morning',        label: 'Morning',    sub: '6–10am' },
  { value: 'midday',         label: 'Midday',     sub: '10am–5pm' },
  { value: 'evening',        label: 'Evening',    sub: '5–9pm' },
  { value: 'night',          label: 'Night',      sub: '9pm–2am' },
  { value: 'bedtime',        label: 'Bedtime',    sub: '9pm–1am' },
  { value: 'weekend',        label: 'Weekend',    sub: 'Sat+Sun' },
  { value: 'monday_evening', label: 'Mon evening',sub: 'Mon 5–9pm' },
]

const ARCHETYPE_LABELS: Record<RecurrenceArchetype, string> = {
  habit:    'Every day at the same time',
  schedule: 'On a specific day of the week',
  interval: 'Every N days from when I last did it',
  seasonal: 'Every few months',
}

const TIME_ANCHORS = [
  { value: 'morning', label: 'Morning' },
  { value: 'midday',  label: 'Midday' },
  { value: 'evening', label: 'Evening' },
  { value: 'night',   label: 'Night' },
] as const

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function fromDateInput(val: string): string | null {
  return val ? new Date(val + 'T00:00:00').toISOString() : null
}

export default function CardModal({ card, columns, onClose, onSave, onDelete }: Props) {
  const [title, setTitle]         = useState(card.title)
  const [notes, setNotes]         = useState(card.notes)
  const [priority, setPriority]   = useState(card.priority)
  const [tags, setTags]           = useState(card.tags.join(', '))
  const [dueDate, setDueDate]     = useState(toDateInput(card.due_date))
  const [startDate, setStartDate] = useState(toDateInput(card.start_date))
  const [deferUntil, setDeferUntil] = useState(toDateInput(card.defer_until))
  const [recurring, setRecurring] = useState<boolean>(!!card.recurrence)
  const [archetype, setArchetype] = useState<RecurrenceArchetype>(card.recurrence?.archetype ?? 'habit')
  const [timeAnchor, setTimeAnchor] = useState(card.recurrence?.time_anchor ?? 'morning')
  const [dayOfWeek, setDayOfWeek] = useState(card.recurrence?.day_of_week ?? 1)
  const [intervalDays, setIntervalDays] = useState(card.recurrence?.interval_days ?? 7)
  const [contexts, setContexts]   = useState<string[]>(card.contexts ?? [])
  const [timeChunks, setTimeChunks] = useState<string[]>(card.time_chunks ?? [])
  const [saving, setSaving]       = useState(false)
  const [showDefer, setShowDefer] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'dates' | 'repeat'>('details')
  const { data: entityData } = useSWR<{ data: EntityOption[] }>('/api/entities', fetcher)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function buildRecurrence(): Recurrence | null {
    if (!recurring) return null
    const base: Recurrence = { archetype }
    if (archetype === 'habit') base.time_anchor = timeAnchor as Recurrence['time_anchor']
    if (archetype === 'schedule') base.day_of_week = dayOfWeek
    if (archetype === 'interval' || archetype === 'seasonal') base.interval_days = intervalDays
    return base
  }

  async function save() {
    setSaving(true)
    await onSave(card._id, {
      title,
      notes,
      priority,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      due_date: fromDateInput(dueDate),
      start_date: fromDateInput(startDate),
      defer_until: fromDateInput(deferUntil),
      recurrence:  buildRecurrence(),
      contexts,
      time_chunks: timeChunks,
    })
    setSaving(false)
    onClose()
  }

  async function handleDefer(until: Date | null, _label: string) {
    const iso = until ? until.toISOString() : null
    setDeferUntil(toDateInput(iso))
    await onSave(card._id, { defer_until: iso, due_date: until ? null : fromDateInput(dueDate) })
    onClose()
  }

  async function remove() {
    if (!confirm('Delete this card?')) return
    await onDelete(card._id)
    onClose()
  }

  const col = columns.find(c => c._id === card.column_id)
  const isOverdue = card.due_date && new Date(card.due_date) < new Date() && !card.defer_until
  const isDeferredActive = card.defer_until && new Date(card.defer_until) > new Date()

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{col?.title}</span>
            {isOverdue && <span className="text-xs text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded">past due</span>}
            {isDeferredActive && <span className="text-xs text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded">snoozed</span>}
            {card.recurrence?.archetype === 'habit' && card.recurrence.streak_count && card.recurrence.streak_count > 2 && (
              <span className="text-xs text-orange-400">🔥 {card.recurrence.streak_count}</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800">
          {(['details', 'dates', 'repeat'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-medium capitalize transition ${
                activeTab === tab
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
              {tab === 'dates' && (dueDate || deferUntil) && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />}
              {tab === 'repeat' && recurring && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {/* Title always visible */}
          <textarea
            autoFocus={activeTab === 'details'}
            value={title}
            onChange={e => setTitle(e.target.value)}
            rows={2}
            className="w-full bg-transparent text-base font-medium resize-none focus:outline-none"
          />

          {/* Details tab */}
          {activeTab === 'details' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
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
                    {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
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

              {/* Entity contexts */}
              {entityData && entityData.data.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Surface when at</label>
                  <div className="flex flex-wrap gap-1.5">
                    {entityData.data.map(e => {
                      const active = contexts.includes(e._id)
                      return (
                        <button
                          key={e._id}
                          type="button"
                          onClick={() => setContexts(prev =>
                            active ? prev.filter(id => id !== e._id) : [...prev, e._id]
                          )}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${
                            active
                              ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                              : 'border-slate-700 text-slate-500 hover:border-slate-500'
                          }`}
                        >
                          <span>{e.icon}</span>
                          <span>{e.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Dates tab */}
          {activeTab === 'dates' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                  Start date
                  <span className="ml-1 text-slate-600 normal-case font-normal">— hide until this date</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                    Snooze until
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowDefer(v => !v)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                  >
                    Quick presets ▾
                  </button>
                </div>
                <input
                  type="date"
                  value={deferUntil}
                  onChange={e => setDeferUntil(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {showDefer && (
                  <DeferMenu
                    onDefer={handleDefer}
                    onClose={() => setShowDefer(false)}
                  />
                )}
              </div>
              {/* Time windows — when to float this card to the top */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Best time</label>
                  <span className="text-xs text-slate-700">— card rises to top of Now during these windows</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TIME_CHUNK_OPTS.map(tc => {
                    const active = timeChunks.includes(tc.value)
                    return (
                      <button
                        key={tc.value}
                        type="button"
                        onClick={() => setTimeChunks(prev =>
                          active ? prev.filter(c => c !== tc.value) : [...prev, tc.value]
                        )}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${
                          active
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                            : 'border-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {tc.label} <span className="text-slate-600">{tc.sub}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {(dueDate || deferUntil || startDate) && (
                <button
                  type="button"
                  onClick={() => { setDueDate(''); setStartDate(''); setDeferUntil('') }}
                  className="text-xs text-slate-600 hover:text-slate-400 transition"
                >
                  Clear all dates
                </button>
              )}
            </div>
          )}

          {/* Repeat tab */}
          {activeTab === 'repeat' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Repeats</span>
                <button
                  onClick={() => setRecurring(v => !v)}
                  className={`relative w-10 h-5 rounded-full transition ${recurring ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${recurring ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>

              {recurring && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Type</label>
                    {(Object.keys(ARCHETYPE_LABELS) as RecurrenceArchetype[]).map(a => (
                      <button
                        key={a}
                        onClick={() => setArchetype(a)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition ${
                          archetype === a
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                            : 'border-slate-800 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {ARCHETYPE_LABELS[a]}
                      </button>
                    ))}
                  </div>

                  {archetype === 'habit' && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Time of day</label>
                      <div className="grid grid-cols-2 gap-2">
                        {TIME_ANCHORS.map(t => (
                          <button
                            key={t.value}
                            onClick={() => setTimeAnchor(t.value)}
                            className={`py-2 rounded-lg border text-sm transition ${
                              timeAnchor === t.value
                                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                                : 'border-slate-800 text-slate-400 hover:border-slate-600'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {archetype === 'schedule' && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Day of week</label>
                      <div className="flex gap-1">
                        {DAYS.map((d, i) => (
                          <button
                            key={d}
                            onClick={() => setDayOfWeek(i)}
                            className={`flex-1 py-1.5 rounded text-xs transition ${
                              dayOfWeek === i
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {d[0]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(archetype === 'interval' || archetype === 'seasonal') && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Every</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={intervalDays}
                          onChange={e => setIntervalDays(parseInt(e.target.value) || 1)}
                          className="w-20 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-400">days from last completion</span>
                      </div>
                      <p className="text-xs text-slate-600">
                        The clock resets when you complete it — perfect for "call friends" or "haircut"
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
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
