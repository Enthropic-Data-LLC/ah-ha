import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'

interface NowCard { _id: string; title: string; due_date?: string; priority?: string; ref?: string; recurrence?: { archetype: string; streak_count?: number; time_anchor?: string } }
interface NowItem { _id: string; title: string; due_at?: string }

interface NowData {
  context: { time_of_day: string; presence: string; generated_at: string }
  urgent: NowCard[]
  due_today: NowCard[]
  habits: NowCard[]
  resurfaced: NowCard[]
  nudges: NowCard[]
  list_items: NowItem[]
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
  return <span className="text-xs text-red-400">{days}d overdue</span>
}

function CardRow({ card, onDefer }: { card: NowCard; onDefer: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/50 transition group">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate">{card.title}</p>
        {card.due_date && <DaysOverdue due={card.due_date} />}
        {card.recurrence?.archetype === 'habit' && card.recurrence.streak_count && card.recurrence.streak_count > 2 && (
          <span className="text-xs text-orange-400 ml-2">🔥 {card.recurrence.streak_count}</span>
        )}
      </div>
      <button
        onClick={() => onDefer(card._id)}
        className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-amber-400 transition px-2 py-1 rounded"
        title="Snooze"
      >
        ⏸
      </button>
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
  const [deferring, setDeferring] = useState<string | null>(null)

  const now = data?.data

  async function snooze(cardId: string) {
    setDeferring(cardId)
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
    await api.patch(`/api/board/unknown/cards/${cardId}`, { defer_until: tomorrow.toISOString() })
    setDeferring(null)
    await mutate()
  }

  if (isLoading || !now) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const total = now.urgent.length + now.due_today.length + now.habits.length + now.resurfaced.length + now.list_items.length + now.nudges.length
  const isEmpty = total === 0

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Context header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{TOD_LABEL[now.context.time_of_day]}</span>
          {now.context.presence !== 'unknown' && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-500">{PRESENCE_LABEL[now.context.presence]}</span>
            </>
          )}
        </div>
        {now.trail_pulse && now.trail_pulse.total_today > 0 && (
          <span className={`text-xs ${TONE_COLOR[now.trail_pulse.recent_tone] ?? 'text-slate-500'}`}>
            {now.trail_pulse.total_today} trail entries today
          </span>
        )}
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
          <p className="text-slate-400 text-lg">Nothing urgent right now.</p>
          <p className="text-slate-600 text-sm">Enjoy it.</p>
        </div>
      )}

      {/* Urgent */}
      <Section title="Overdue" count={now.urgent.length} accent="text-red-500">
        {now.urgent.map(c => <CardRow key={c._id} card={c} onDefer={snooze} />)}
      </Section>

      {/* Habits now */}
      <Section title="Now" count={now.habits.length} accent="text-indigo-400">
        {now.habits.map(c => <CardRow key={c._id} card={c} onDefer={snooze} />)}
      </Section>

      {/* Due today */}
      <Section title="Today" count={now.due_today.length} accent="text-slate-400">
        {now.due_today.map(c => <CardRow key={c._id} card={c} onDefer={snooze} />)}
      </Section>

      {/* Resurfaced */}
      <Section title="Just resurfaced" count={now.resurfaced.length} accent="text-amber-500">
        {now.resurfaced.map(c => <CardRow key={c._id} card={c} onDefer={snooze} />)}
      </Section>

      {/* List items */}
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
            <div key={c._id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/30 transition">
              <p className="text-sm text-slate-400 flex-1 truncate">{c.title}</p>
              {c.recurrence?.archetype === 'interval' && (
                <span className="text-xs text-slate-600">~{(c.recurrence as { interval_days?: number }).interval_days}d interval</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-700 text-center pt-2">
        Updated {new Date(now.context.generated_at).toLocaleTimeString()}
        {deferring && ' · snoozed'}
      </p>
    </div>
  )
}
