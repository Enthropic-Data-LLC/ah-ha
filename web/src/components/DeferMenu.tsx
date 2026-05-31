import { useState } from 'react'

interface Props {
  onDefer: (until: Date | null) => Promise<void>
  onClose: () => void
}

function nextWeekday(dayOfWeek: number): Date {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  const current = d.getDay()
  const diff = (dayOfWeek - current + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

function todayAt(hour: number): Date {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d
}

function daysFromNow(n: number, hour = 8): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hour, 0, 0, 0)
  return d
}

const PRESETS = [
  { label: 'Later today',  sub: '6pm',          value: () => todayAt(18) },
  { label: 'Tomorrow',     sub: '8am',           value: () => daysFromNow(1) },
  { label: 'This weekend', sub: 'Sat 9am',       value: () => nextWeekday(6) },
  { label: 'Next week',    sub: 'Mon 8am',       value: () => nextWeekday(1) },
  { label: 'In 2 weeks',   sub: '',              value: () => daysFromNow(14) },
  { label: 'Someday',      sub: 'clear date',    value: () => null },
]

export default function DeferMenu({ onDefer, onClose }: Props) {
  const [loading, setLoading] = useState<string | null>(null)

  async function pick(label: string, value: () => Date | null) {
    setLoading(label)
    await onDefer(value())
    onClose()
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800">
        <p className="text-xs text-slate-500 font-medium">Defer until…</p>
      </div>
      {PRESETS.map(p => (
        <button
          key={p.label}
          disabled={loading !== null}
          onClick={() => pick(p.label, p.value)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800 transition text-left disabled:opacity-50"
        >
          <span className="text-sm text-slate-200">{p.label}</span>
          {p.sub && <span className="text-xs text-slate-600">{p.sub}</span>}
          {loading === p.label && <span className="text-xs text-indigo-400">…</span>}
        </button>
      ))}
    </div>
  )
}
