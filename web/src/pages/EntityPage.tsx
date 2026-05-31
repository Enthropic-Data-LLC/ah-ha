import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'
import { useEntityContext } from '../hooks/useEntityContext'

interface LocationSignature {
  kind: 'gps' | 'network' | 'bluetooth_le'
  lat?: number; lng?: number; radius_m?: number
  external_ip?: string
  local_name?: string
}

interface Entity {
  _id: string
  name: string
  icon: string
  entity_type: 'place' | 'person'
  color: string
  signatures: LocationSignature[]
  time_chunks: string[]
}

const ENTITY_ICONS = ['📍', '🏠', '💼', '🏪', '🚗', '☕', '🏋️', '👤', '👥', '🏫', '🏥', '🌳']

const TIME_CHUNK_OPTS = [
  { value: 'wakeup',         label: 'Wake up',       sub: '5–8am' },
  { value: 'morning',        label: 'Morning',        sub: '6–10am' },
  { value: 'midday',         label: 'Midday',         sub: '10am–5pm' },
  { value: 'evening',        label: 'Evening',        sub: '5–9pm' },
  { value: 'night',          label: 'Night',          sub: '9pm–2am' },
  { value: 'bedtime',        label: 'Bedtime',        sub: '9pm–1am' },
  { value: 'weekend',        label: 'Weekend',        sub: 'Sat+Sun' },
  { value: 'monday_evening', label: 'Mon evening',    sub: 'Mon 5–9pm' },
]

function sigBadge(sig: LocationSignature) {
  if (sig.kind === 'gps') return `GPS (±${sig.radius_m ?? 100}m)`
  if (sig.kind === 'network') return `IP ${sig.external_ip?.slice(0, 8)}…`
  if (sig.kind === 'bluetooth_le') return `BT: ${sig.local_name}`
  return sig.kind
}

export default function EntityPage() {
  const { data, mutate } = useSWR<{ data: Entity[] }>('/api/entities', fetcher)
  const ctx = useEntityContext()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📍')
  const [entityType, setEntityType] = useState<'place' | 'person'>('place')
  const [timeChunks, setTimeChunks] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [editingChunksFor, setEditingChunksFor] = useState<string | null>(null)
  const [training, setTraining] = useState<string | null>(null)
  const [trainMsg, setTrainMsg] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  function toast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 2500)
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await api.post('/api/entities', { name: name.trim(), icon, entity_type: entityType, time_chunks: timeChunks })
      setName(''); setIcon('📍'); setTimeChunks([]); setCreating(false)
      await mutate()
    } finally { setSubmitting(false) }
  }

  async function trainLocation(entity: Entity) {
    setTraining(entity._id)
    setTrainMsg('Capturing signals…')
    try {
      const signals: Record<string, unknown> = {}

      // GPS
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
          )
          signals['gps'] = { kind: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, radius_m: Math.max(50, pos.coords.accuracy ?? 100) }
          setTrainMsg('Got GPS…')
        } catch { setTrainMsg('GPS denied — capturing network…') }
      }

      // Network IP
      try {
        const ipRes = await api.get<{ ip: string }>('/api/my-ip')
        signals['network'] = { kind: 'network', external_ip: ipRes.ip }
      } catch { /* ok */ }

      const sigs = Object.values(signals)
      if (sigs.length === 0) { setTrainMsg('No signals available — try from a browser with location permission.'); return }

      await api.post(`/api/entities/${entity._id}/train`, { signatures: sigs })
      // Also check in after training
      await api.post(`/api/entities/${entity._id}/checkin`, {})
      ctx.setLocal({ _id: entity._id, name: entity.name, icon: entity.icon })
      await mutate()
      toast(`Trained "${entity.name}" — checked in ✓`)
      setTrainMsg(null)
    } catch (err: unknown) {
      setTrainMsg(`Error: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally { setTraining(null) }
  }

  async function checkin(entity: Entity) {
    await ctx.checkin({ _id: entity._id, name: entity.name, icon: entity.icon })
    toast(`Checked in to ${entity.icon} ${entity.name}`)
  }

  async function checkout() {
    await ctx.checkout()
    toast('Checked out')
  }

  async function remove(entity: Entity) {
    if (!confirm(`Delete "${entity.name}"?`)) return
    await api.delete(`/api/entities/${entity._id}`)
    if (ctx.entity?._id === entity._id) await ctx.checkout()
    await mutate()
  }

  const entities = data?.data ?? []
  const currentId = ctx.entity?._id

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Entities</h1>
          <p className="text-xs text-slate-500 mt-0.5">Places and people — check in to surface relevant cards</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-sm font-medium rounded-lg transition"
        >
          + New
        </button>
      </div>

      {/* Current context banner */}
      {currentId && ctx.entity && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-950/40 border border-indigo-800/50 rounded-xl">
          <span className="text-2xl">{ctx.entity.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-indigo-300">Currently at: {ctx.entity.name}</p>
            <p className="text-xs text-indigo-600">Cards for this location are surfaced on the Now page</p>
          </div>
          <button
            onClick={checkout}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded transition"
          >
            Leave
          </button>
        </div>
      )}

      {/* Detect button */}
      <button
        onClick={async () => {
          const found = await ctx.detect()
          if (found) toast(`Detected: ${found.icon} ${found.name}`)
          else toast('No matching entity detected')
        }}
        disabled={ctx.detecting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm text-slate-300 transition disabled:opacity-50"
      >
        {ctx.detecting
          ? <><span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Detecting…</>
          : <><svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-400"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg> Detect my location</>
        }
      </button>

      {/* Create form */}
      {creating && (
        <form onSubmit={create} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold">New entity</h2>
          <div className="flex gap-2">
            <div className="relative">
              <select
                value={icon}
                onChange={e => setIcon(e.target.value)}
                className="appearance-none w-12 h-10 bg-slate-800 border border-slate-700 rounded-lg text-center text-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                {ENTITY_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <input
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name (Home, Work, Car…)"
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            {(['place', 'person'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setEntityType(t)}
                className={`flex-1 py-2 rounded-lg border text-sm transition ${entityType === t ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
              >
                {t === 'place' ? '📍 Place' : '👤 Person'}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 font-medium uppercase tracking-wide">Active during (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {TIME_CHUNK_OPTS.map(tc => {
                const active = timeChunks.includes(tc.value)
                return (
                  <button
                    key={tc.value}
                    type="button"
                    onClick={() => setTimeChunks(prev => active ? prev.filter(c => c !== tc.value) : [...prev, tc.value])}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${active ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}
                  >
                    {tc.label} <span className="text-slate-600">{tc.sub}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-700">Leave empty to always surface cards for this entity.</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-slate-400">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Entity list */}
      {entities.length === 0 && !creating ? (
        <div className="text-center py-12 text-slate-600 text-sm space-y-2">
          <p>No entities yet.</p>
          <p className="text-xs">Create a place like "Home" or "Work" — then train it when you arrive so the app learns the location.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entities.map(entity => (
            <div
              key={entity._id}
              className={`bg-slate-900 border rounded-xl transition ${entity._id === currentId ? 'border-indigo-700' : 'border-slate-800'}`}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-2xl flex-shrink-0">{entity.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{entity.name}</p>
                    {entity._id === currentId && (
                      <span className="text-xs text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0">here</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {entity.signatures.length === 0
                      ? <span className="text-xs text-slate-700">No location trained yet</span>
                      : entity.signatures.map((s, i) => (
                          <span key={i} className="text-xs text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">
                            {sigBadge(s)}
                          </span>
                        ))
                    }
                  </div>
                  {/* Time chunks */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(entity.time_chunks ?? []).length === 0 ? (
                      <span className="text-xs text-slate-700">Always active</span>
                    ) : (
                      (entity.time_chunks ?? []).map(c => {
                        const opt = TIME_CHUNK_OPTS.find(o => o.value === c)
                        return opt ? (
                          <span key={c} className="text-xs text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                            {opt.label}
                          </span>
                        ) : null
                      })
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingChunksFor(editingChunksFor === entity._id ? null : entity._id)}
                      className="text-xs text-slate-600 hover:text-slate-400 px-1 transition"
                      title="Edit time windows"
                    >
                      {editingChunksFor === entity._id ? 'done' : '✎'}
                    </button>
                  </div>
                  {/* Inline time chunk editor */}
                  {editingChunksFor === entity._id && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {TIME_CHUNK_OPTS.map(tc => {
                        const active = (entity.time_chunks ?? []).includes(tc.value)
                        return (
                          <button
                            key={tc.value}
                            type="button"
                            onClick={async () => {
                              const next = active
                                ? (entity.time_chunks ?? []).filter(c => c !== tc.value)
                                : [...(entity.time_chunks ?? []), tc.value]
                              await api.patch(`/api/entities/${entity._id}`, { time_chunks: next })
                              await mutate()
                            }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition ${active ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}
                          >
                            {tc.label} <span className="text-slate-600">{tc.sub}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {training === entity._id && trainMsg && (
                    <p className="text-xs text-indigo-400 mt-1">{trainMsg}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {entity._id === currentId ? (
                    <button
                      onClick={checkout}
                      className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-lg transition"
                    >
                      Leave
                    </button>
                  ) : (
                    <button
                      onClick={() => checkin(entity)}
                      className="px-2 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg transition"
                    >
                      I'm here
                    </button>
                  )}
                  <button
                    onClick={() => trainLocation(entity)}
                    disabled={training === entity._id}
                    className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition disabled:opacity-40"
                    title="Train location — I'm here now, capture signals"
                  >
                    {training === entity._id ? '…' : 'Train'}
                  </button>
                  <button
                    onClick={() => remove(entity)}
                    className="p-1.5 text-slate-700 hover:text-red-400 rounded-lg transition"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 shadow-xl pointer-events-none whitespace-nowrap">
          {toastMsg}
        </div>
      )}
    </div>
  )
}
