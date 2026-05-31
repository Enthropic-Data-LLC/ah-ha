import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'
import { useMe } from '../hooks/useMe'
import CardModal from '../components/CardModal'
import type { BoardCard, BoardColumn } from '../lib/types'

interface NowCard { _id: string; title: string; due_date?: string; priority?: string; ref?: string; created_at?: string; recurrence?: { archetype: string; streak_count?: number; time_anchor?: string; interval_days?: number; last_completed_at?: string | null } }
interface NowItem { _id: string; title: string; due_at?: string }
interface NowListItem { _id: string; title: string; space_ref?: string }

interface NowData {
  context: {
    time_of_day: string
    presence: string
    presence_entity: { _id: string; name: string; icon: string } | null
    generated_at: string
  }
  urgent: NowCard[]
  due_today: NowCard[]
  habits: NowCard[]
  resurfaced: NowCard[]
  nudges: NowCard[]
  list_items: NowItem[]
  entity_list_items: NowListItem[]
  location_context: NowCard[]
  trail_pulse: { recent_tone: string; total_today: number } | null
  briefing: string | null
}

const TOD_LABEL: Record<string, string> = {
  morning: '🌤 Morning', active: '⚡ Active', evening: '🌆 Evening', night: '🌙 Night'
}
const PRESENCE_LABEL: Record<string, string> = {
  home: '🏠 Home', away: '🚶 Away', unknown: ''
}
const TONE_COLOR: Record<string, string> = {
  happy: 'text-emerald-400', sorrow: 'text-rose-400', neutral: 'text-slate-500'
}

function DaysOverdue({ due }: { due: string }) {
  const days = Math.floor((Date.now() - new Date(due).getTime()) / 86400000)
  if (days === 0) return <span className="text-xs text-amber-400">due today</span>
  return <span className="text-xs text-amber-500">{days}d past due</span>
}

function CardRow({ card, onDefer, onComplete, onOpen }: {
  card: NowCard
  onDefer: (id: string) => void
  onComplete: (id: string) => void
  onOpen: (ref: string, id: string) => void
}) {
  const isRecurring = !!card.recurrence
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/50 transition group">
      <div className="flex-1 min-w-0">
        <button
          onClick={() => card.ref && onOpen(card.ref, card._id)}
          className="text-sm text-slate-200 truncate text-left w-full hover:text-indigo-300 transition"
        >{card.title}</button>
        <div className="flex items-center gap-2 mt-0.5">
          {card.due_date && <DaysOverdue due={card.due_date} />}
          {card.recurrence?.archetype === 'habit' && (card.recurrence.streak_count ?? 0) > 2 && (
            <span className="text-xs text-orange-400">🔥 {card.recurrence.streak_count}</span>
          )}
          {isRecurring && (
            <span className="text-xs text-slate-700 capitalize">{card.recurrence?.archetype}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={() => onComplete(card._id)}
          className="text-xs text-slate-600 hover:text-emerald-400 transition px-2 py-1 rounded"
          title={isRecurring ? 'Done — advance recurrence' : 'Done'}
        >
          ✓
        </button>
        <button
          onClick={() => onDefer(card._id)}
          className="text-xs text-slate-600 hover:text-amber-400 transition px-2 py-1 rounded"
          title="Snooze"
        >
          ⏸
        </button>
      </div>
    </div>
  )
}

function daysSince(dateStr: string | null | undefined, fallback: string | undefined): number {
  const base = dateStr ? new Date(dateStr) : (fallback ? new Date(fallback) : null)
  if (!base) return 0
  return Math.floor((Date.now() - base.getTime()) / 86400000)
}

function NudgeRow({ card, onDefer, onComplete, onOpen }: {
  card: NowCard
  onDefer: (id: string) => void
  onComplete: (id: string) => void
  onOpen: (ref: string, id: string) => void
}) {
  const rec = card.recurrence
  const days = daysSince(rec?.last_completed_at, card.created_at)
  const interval = rec?.interval_days ?? 0
  const pct = interval > 0 ? Math.min(days / interval, 1) : 0

  const warmMsg = days === 0
    ? 'Just completed'
    : days === 1
    ? 'Yesterday'
    : `${days} days ago`

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/30 transition group">
      <div className="flex-1 min-w-0">
        <button
          onClick={() => card.ref && onOpen(card.ref, card._id)}
          className="text-sm text-slate-400 truncate text-left w-full hover:text-indigo-300 transition"
        >{card.title}</button>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-16 h-0.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-slate-600 rounded-full transition-all" style={{ width: `${pct * 100}%` }} />
          </div>
          <span className="text-xs text-slate-600">{warmMsg}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={() => onComplete(card._id)}
          className="text-xs text-slate-600 hover:text-emerald-400 transition px-2 py-1 rounded"
          title="Done — reset clock"
        >✓</button>
        <button
          onClick={() => onDefer(card._id)}
          className="text-xs text-slate-600 hover:text-amber-400 transition px-2 py-1 rounded"
          title="Snooze"
        >⏸</button>
      </div>
    </div>
  )
}

function Section({ title, count, children, accent = 'text-slate-500' }: { title: string; count: number; children: React.ReactNode; accent?: string }) {
  if (count === 0) return null
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-mono uppercase tracking-wider ${accent}`}>{title}</span>
        <span className="text-xs text-slate-700">{count}</span>
      </div>
      {children}
    </div>
  )
}

export default function NowPage() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { data, mutate, isLoading } = useSWR<{ data: NowData }>(
    `/api/now?tz=${encodeURIComponent(tz)}`,
    fetcher,
    { refreshInterval: 60_000 }
  )
  const { user } = useMe()
  const entitiesHref = user ? `/${user.username}/entities` : '/entities'
  const [deferring, setDeferring] = useState<string | null>(null)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [activeBoardSlug, setActiveBoardSlug] = useState<string | null>(null)

  const { data: activeCardData, mutate: mutateCard } = useSWR<{ data: BoardCard }>(
    activeCardId ? `/api/cards/${activeCardId}` : null, fetcher
  )
  const { data: activeColsData } = useSWR<{ data: BoardColumn[] }>(
    activeBoardSlug ? `/api/board/${activeBoardSlug}/columns` : null, fetcher
  )

  function openCard(ref: string, id: string) {
    const slug = ref.split('/')[2]?.split('#')[0] ?? null
    setActiveBoardSlug(slug)
    setActiveCardId(id)
  }

  async function saveActiveCard(id: string, updates: Partial<BoardCard>) {
    if (!activeBoardSlug) return
    await api.patch(`/api/board/${activeBoardSlug}/cards/${id}`, updates)
    await mutateCard()
    await mutate()
  }

  async function deleteActiveCard(id: string) {
    if (!activeBoardSlug) return
    await api.delete(`/api/board/${activeBoardSlug}/cards/${id}`)
    setActiveCardId(null)
    await mutate()
  }

  const now = data?.data

  async function snooze(cardId: string) {
    setDeferring(cardId)
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
    await api.post(`/api/cards/${cardId}/defer`, { defer_until: tomorrow.toISOString() })
    setDeferring(null)
    await mutate()
  }

  async function complete(cardId: string) {
    await api.post(`/api/cards/${cardId}/complete`, {})
    await mutate()
  }

  if (isLoading || !now) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const total = now.urgent.length + now.due_today.length + now.habits.length + now.resurfaced.length + now.list_items.length + now.nudges.length + now.entity_list_items.length
  const isEmpty = total === 0

  return (
    <>
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Context header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{TOD_LABEL[now.context.time_of_day]}</span>
          {now.context.presence_entity ? (
            <>
              <span className="text-slate-700">·</span>
              <a href={entitiesHref} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition">
                <span>{now.context.presence_entity.icon}</span>
                <span>{now.context.presence_entity.name}</span>
              </a>
            </>
          ) : now.context.presence !== 'unknown' && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-500">{PRESENCE_LABEL[now.context.presence]}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!now.context.presence_entity && (
            <a href={entitiesHref} className="text-xs text-slate-700 hover:text-indigo-400 transition">
              📍 Check in
            </a>
          )}
          {now.trail_pulse && now.trail_pulse.total_today > 0 && (
            <span className={`text-xs ${TONE_COLOR[now.trail_pulse.recent_tone] ?? 'text-slate-500'}`}>
              {now.trail_pulse.total_today} trail entries today
            </span>
          )}
        </div>
      </div>

      {/* AI briefing */}
      {now.briefing && (
        <div className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl">
          <p className="text-sm text-slate-300 leading-relaxed">{now.briefing}</p>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-16 space-y-2">
          <p className="text-slate-400 text-lg">You're clear right now.</p>
          <p className="text-slate-600 text-sm">Enjoy it.</p>
        </div>
      )}

      {/* Urgent */}
      <Section title="Needs attention" count={now.urgent.length} accent="text-amber-500">
        {now.urgent.map(c => <CardRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />)}
      </Section>

      {/* Habits now */}
      <Section title="Now" count={now.habits.length} accent="text-indigo-400">
        {now.habits.map(c => <CardRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />)}
      </Section>

      {/* Due today */}
      <Section title="Today" count={now.due_today.length} accent="text-slate-400">
        {now.due_today.map(c => <CardRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />)}
      </Section>

      {/* Location context cards */}
      {now.context.presence_entity && now.location_context.length > 0 && (
        <Section
          title={`${now.context.presence_entity.icon} ${now.context.presence_entity.name}`}
          count={now.location_context.length}
          accent="text-indigo-400"
        >
          {now.location_context.map(c => <CardRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />)}
        </Section>
      )}

      {/* Resurfaced */}
      <Section title="Just resurfaced" count={now.resurfaced.length} accent="text-amber-500">
        {now.resurfaced.map(c => <CardRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />)}
      </Section>

      {/* Entity-tagged list items — surfaced because you're here */}
      {now.context.presence_entity && now.entity_list_items.length > 0 && (
        <Section
          title={`${now.context.presence_entity.icon} Pick up`}
          count={now.entity_list_items.length}
          accent="text-indigo-400"
        >
          {now.entity_list_items.map(i => (
            <div key={i._id} className="flex items-center gap-3 py-2.5 px-3 group">
              <div className="w-4 h-4 rounded border border-slate-600 flex-shrink-0" />
              <p className="text-sm text-slate-200 flex-1 truncate">{i.title}</p>
            </div>
          ))}
        </Section>
      )}

      {/* List items due today */}
      <Section title="List items" count={now.list_items.length} accent="text-slate-500">
        {now.list_items.map(i => (
          <div key={i._id} className="flex items-center gap-3 py-2.5 px-3">
            <p className="text-sm text-slate-300 flex-1 truncate">{i.title}</p>
            {i.due_at && <span className="text-xs text-slate-600">{new Date(i.due_at).toLocaleDateString()}</span>}
          </div>
        ))}
      </Section>

      {/* Nudges (interval recurrence) */}
      {now.nudges.length > 0 && (
        <div className="space-y-1 border-t border-slate-800/60 pt-4">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-600 px-1">It's been a while</span>
          {now.nudges.map(c => (
            <NudgeRow key={c._id} card={c} onDefer={snooze} onComplete={complete} onOpen={openCard} />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-700 text-center pt-2">
        Updated {new Date(now.context.generated_at).toLocaleTimeString()}
        {deferring && ' · snoozed'}
      </p>
    </div>

    {/* Card detail modal — opened by clicking any card title */}
    {activeCardId && activeCardData?.data && activeColsData?.data && (
      <CardModal
        card={activeCardData.data}
        columns={activeColsData.data}
        onClose={() => setActiveCardId(null)}
        onSave={saveActiveCard}
        onDelete={deleteActiveCard}
      />
    )}
    </>
  )
}
