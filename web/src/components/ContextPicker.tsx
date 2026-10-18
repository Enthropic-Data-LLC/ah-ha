import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'

export interface EntityOption { _id: string; name: string; icon: string; entity_type?: 'place' | 'person' }
export type CardContext = { entity_id: string; time_chunks: string[] }

export const TIME_CHUNK_OPTS = [
  { value: 'wakeup',         label: 'Wake up',    sub: '5–8am' },
  { value: 'morning',        label: 'Morning',    sub: '6–10am' },
  { value: 'midday',         label: 'Midday',     sub: '10am–5pm' },
  { value: 'evening',        label: 'Evening',    sub: '5–9pm' },
  { value: 'night',          label: 'Night',      sub: '9pm–2am' },
  { value: 'bedtime',        label: 'Bedtime',    sub: '9pm–1am' },
  { value: 'weekend',        label: 'Weekend',    sub: 'Sat+Sun' },
  { value: 'monday_evening', label: 'Mon evening',sub: 'Mon 5–9pm' },
]

export function useEntities() {
  return useSWR<{ data: EntityOption[] }>('/api/entities', fetcher)
}

/** "Do this at [place] / with [person] during [time]" — shared by the card modal and the board's quick-tag sheet. */
export default function ContextPicker({ contexts, onChange }: {
  contexts: CardContext[]
  onChange: (next: CardContext[]) => void
}) {
  const { data } = useEntities()
  const [expanded, setExpanded] = useState<string | null>(null)
  const entities = data?.data ?? []
  if (entities.length === 0) return null

  return (
    <div className="space-y-2">
      <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Where · who · when</label>
      {entities.map(e => {
        const ctx = contexts.find(c => c.entity_id === e._id)
        const active = !!ctx
        return (
          <div key={e._id} className={`rounded-xl border transition ${active ? 'border-indigo-700 bg-indigo-950/20' : 'border-slate-800'}`}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  if (active) {
                    onChange(contexts.filter(c => c.entity_id !== e._id))
                    setExpanded(null)
                  } else {
                    onChange([...contexts, { entity_id: e._id, time_chunks: [] }])
                    setExpanded(e._id)
                  }
                }}
                className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left min-w-0"
              >
                <span className="text-lg">{e.icon}</span>
                <span className={`text-sm flex-1 truncate ${active ? 'text-indigo-300' : 'text-slate-400'}`}>{e.name}</span>
                {e.entity_type === 'person' && <span className="text-[10px] text-slate-600">person</span>}
                {active && ctx && ctx.time_chunks.length > 0 && (
                  <span className="text-xs text-indigo-500 truncate">
                    {ctx.time_chunks.map(c => TIME_CHUNK_OPTS.find(o => o.value === c)?.label ?? c).join(' · ')}
                  </span>
                )}
                {active && ctx && ctx.time_chunks.length === 0 && <span className="text-xs text-slate-600">any time</span>}
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === e._id ? null : e._id)}
                  aria-label={`${e.name}: choose times`}
                  className="text-xs text-slate-600 hover:text-slate-300 px-3 py-2.5"
                >
                  {expanded === e._id ? '▲' : '▾'}
                </button>
              )}
            </div>
            {active && expanded === e._id && (
              <div className="px-3 pb-3 space-y-1.5">
                <p className="text-xs text-slate-600">When with {e.name}… (leave empty for any time)</p>
                <div className="flex flex-wrap gap-1.5">
                  {TIME_CHUNK_OPTS.map(tc => {
                    const on = ctx?.time_chunks.includes(tc.value) ?? false
                    return (
                      <button
                        key={tc.value}
                        type="button"
                        onClick={() => onChange(contexts.map(c =>
                          c.entity_id === e._id
                            ? { ...c, time_chunks: on ? c.time_chunks.filter(x => x !== tc.value) : [...c.time_chunks, tc.value] }
                            : c
                        ))}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${
                          on ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {tc.label} <span className="text-slate-600">{tc.sub}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
