import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { fetcher, api, ApiError } from '../lib/api'

interface Match { trail?: string; source?: string; tag?: string; type?: string; text?: string; field?: { key: string; value: string } }
interface Tracker {
  _id: string
  name: string
  on: boolean
  match: Match
  notify: { text: string } | null
  status: { label: string; value: string; today: boolean } | null
  fired?: number
  last_fired_at?: string | null
}
interface Status { label: string; value: string; detail?: string; since?: string; today?: boolean }
interface Space { slug: string; name: string; type: string }

interface Form {
  name: string
  trail: string; source: string; tag: string; type: string; text: string; fieldKey: string; fieldValue: string
  notify: boolean; notifyText: string
  status: boolean; statusLabel: string; statusValue: string; today: boolean
}

const EMPTY: Form = {
  name: '', trail: '', source: '', tag: '', type: '', text: '', fieldKey: '', fieldValue: '',
  notify: true, notifyText: '{text}', status: false, statusLabel: '', statusValue: '', today: true,
}

/** Starting points for common sources. They only fill the form: nothing here is special-cased anywhere else. */
const PRESETS: Array<{ label: string; form: Partial<Form> }> = [
  { label: '🏠 Someone gets home (router)', form: { name: 'Gets home', source: 'presence', tag: 'home', fieldKey: 'person', notify: true, notifyText: '🏠 {meta.person} is home ({time})', status: true, statusValue: 'home' } },
  { label: '🚶 Someone leaves (router)', form: { name: 'Leaves home', source: 'presence', tag: 'away', fieldKey: 'person', notify: false, status: true, statusValue: 'away' } },
  { label: '✊ A hold finishes (Ah! Rhythm)', form: { name: 'Hold finished', type: 'ah-rhythm/hold@1', notify: true, notifyText: '{text}' } },
  { label: '🏷️ An NFC tag is tapped', form: { name: 'Tag tapped', source: 'nfc', notify: true, notifyText: '{text}' } },
]

function toBody(f: Form) {
  return {
    name: f.name.trim(),
    match: {
      trail: f.trail, source: f.source, tag: f.tag, type: f.type, text: f.text,
      ...(f.fieldKey.trim() && f.fieldValue.trim() ? { field: { key: f.fieldKey.trim(), value: f.fieldValue.trim() } } : {}),
    },
    notify: f.notify ? { text: f.notifyText.trim() || '{text}' } : null,
    status: f.status ? { label: f.statusLabel.trim(), value: f.statusValue.trim(), today: f.today } : null,
  }
}

function fromTracker(t: Tracker): Form {
  return {
    name: t.name,
    trail: t.match.trail ?? '', source: t.match.source ?? '', tag: t.match.tag ?? '', type: t.match.type ?? '', text: t.match.text ?? '',
    fieldKey: t.match.field?.key ?? '', fieldValue: t.match.field?.value ?? '',
    notify: !!t.notify, notifyText: t.notify?.text ?? '{text}',
    status: !!t.status, statusLabel: t.status?.label ?? '', statusValue: t.status?.value ?? '', today: t.status?.today ?? true,
  }
}

function describe(m: Match) {
  return [
    m.trail && `trail ${m.trail}`, m.source && `from ${m.source}`, m.tag && `tag ${m.tag}`, m.type && `type ${m.type}`,
    m.text && `text has “${m.text}”`, m.field && `${m.field.key} = ${m.field.value}`,
  ].filter(Boolean).join(' · ')
}

const when = (iso?: string | null) => iso
  ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  : ''

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
      />
      {hint && <span className="text-[11px] text-slate-600">{hint}</span>}
    </label>
  )
}

export default function TrackersPage() {
  const { data, mutate } = useSWR<{ data: Tracker[] }>('/api/trackers', fetcher)
  const { data: statusData, mutate: mutateStatuses } = useSWR<{ data: Status[] }>('/api/statuses', fetcher)
  const { data: spaceData } = useSWR<{ data: Space[] }>('/api/spaces', fetcher)
  const trails = (spaceData?.data ?? []).filter(s => s.type === 'trail')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ count: number; recent: Array<{ text: string; source: string; ts: string }> } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))

  // What this match would have caught in the last two weeks, as you type.
  useEffect(() => {
    if (!editing) return
    const body = toBody(form)
    if (!Object.values(body.match).some(v => (typeof v === 'string' ? v.trim() : v))) { setPreview(null); return }
    const t = setTimeout(() => {
      api.post<{ data: { count: number; recent: Array<{ text: string; source: string; ts: string }> } }>('/api/trackers/test', { match: body.match })
        .then(r => setPreview(r.data)).catch(() => setPreview(null))
    }, 400)
    return () => clearTimeout(t)
  }, [editing, form])

  function start(t?: Tracker) {
    setForm(t ? fromTracker(t) : EMPTY)
    setEditing(t ? t._id : 'new')
    setError('')
    setPreview(null)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (editing === 'new') await api.post('/api/trackers', toBody(form))
      else await api.put(`/api/trackers/${editing}`, toBody(form))
      setEditing(null)
      await Promise.all([mutate(), mutateStatuses()])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  async function toggle(t: Tracker) {
    await api.put(`/api/trackers/${t._id}`, { ...toBody(fromTracker(t)), on: !t.on })
    await mutate()
  }

  async function remove(t: Tracker) {
    await api.delete(`/api/trackers/${t._id}`)
    setRemoving(null)
    await mutate()
  }

  async function clearStatus(s: Status) {
    await api.delete(`/api/statuses/${encodeURIComponent(s.label)}`)
    await mutateStatuses()
  }

  const trackers = data?.data ?? []
  const statuses = statusData?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Trackers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Anything can write to your trail — the router, Ah! Rhythm, NFC tags, webhooks. A tracker watches for the entries
            you care about, then tells your phone, keeps a status, or both.
          </p>
        </div>
        {!editing && (
          <button onClick={() => start()} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium flex-shrink-0">
            + Tracker
          </button>
        )}
      </div>

      {statuses.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-mono uppercase tracking-wider text-slate-500">Statuses</h2>
          <div className="flex flex-wrap gap-2">
            {statuses.map(s => (
              <span key={s.label} className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full pl-3 pr-1.5 py-1 text-sm">
                <span className="text-slate-300">{s.label}</span>
                <span className="text-indigo-300">{s.value}</span>
                {s.since && <span className="text-xs text-slate-600">since {when(s.since)}</span>}
                {s.today && <span className="text-[10px] text-slate-500 border border-slate-700 rounded px-1">Today</span>}
                <button onClick={() => clearStatus(s)} className="text-slate-600 hover:text-red-400 px-1" aria-label={`Clear ${s.label}`}>✕</button>
              </span>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <form onSubmit={save} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          {editing === 'new' && (
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button type="button" key={p.label} onClick={() => set({ ...EMPTY, ...p.form })}
                  className="px-2.5 py-1 rounded-full border border-slate-700 text-xs text-slate-400 hover:border-indigo-500 hover:text-indigo-300">
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <Field label="Name" value={form.name} onChange={v => set({ name: v })} placeholder="Lauri gets home" />

          <div className="space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500">When an entry arrives that matches</h3>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Trail</span>
              <select value={form.trail} onChange={e => set({ trail: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Any trail</option>
                {trails.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Source" value={form.source} onChange={v => set({ source: v })} placeholder="presence, nfc, ah-meds…" />
              <Field label="Tag" value={form.tag} onChange={v => set({ tag: v })} placeholder="home" />
              <Field label="Type (meta.type)" value={form.type} onChange={v => set({ type: v })} placeholder="ah-rhythm/hold@1" />
              <Field label="Text contains" value={form.text} onChange={v => set({ text: v })} placeholder="got home" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Field (meta.…)" value={form.fieldKey} onChange={v => set({ fieldKey: v })} placeholder="person" />
              <Field label="equals" value={form.fieldValue} onChange={v => set({ fieldValue: v })} placeholder="Lauri" />
            </div>
            {preview && (
              <div className="text-xs text-slate-500 bg-slate-950/50 rounded-lg p-3 space-y-1">
                <p>{preview.count === 0 ? 'Nothing in the last 2 weeks matches yet.' : `${preview.count} match${preview.count === 1 ? '' : 'es'} in the last 2 weeks — newest:`}</p>
                {preview.recent.map((r, i) => (
                  <p key={i} className="text-slate-400 truncate">{when(r.ts)} · {r.text} <span className="text-slate-600">({r.source})</span></p>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500">Then</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.notify} onChange={e => set({ notify: e.target.checked })} className="accent-indigo-500" />
              Notify my phone
            </label>
            {form.notify && (
              <Field label="Message" value={form.notifyText} onChange={v => set({ notifyText: v })}
                hint="Placeholders: {text} {source} {tags} {time} {meta.person} — any meta field" />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.status} onChange={e => set({ status: e.target.checked })} className="accent-indigo-500" />
              Keep a status
            </label>
            {form.status && (
              <div className="space-y-3 pl-6">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Status" value={form.statusLabel} onChange={v => set({ statusLabel: v })} placeholder="Lauri" />
                  <Field label="becomes" value={form.statusValue} onChange={v => set({ statusValue: v })} placeholder="home" />
                </div>
                <p className="text-[11px] text-slate-600">Two trackers can share one status: “Lauri” becomes home from one, away from the other.
                  A person whose status is “home” brings forward what’s tagged to them on Ah! Today.</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.today} onChange={e => set({ today: e.target.checked })} className="accent-indigo-500" />
                  Show on Ah! Today
                </label>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <section className="space-y-2">
        {trackers.length === 0 && !editing && (
          <p className="text-sm text-slate-600">No trackers yet. Start with “+ Tracker” — the presets fill in common ones.</p>
        )}
        {trackers.map(t => (
          <div key={t._id} className={`bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 ${t.on ? '' : 'opacity-50'}`}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-slate-500 truncate">{describe(t.match)}</p>
                <p className="text-xs text-slate-600 truncate">
                  {[t.notify && `🔔 “${t.notify.text}”`, t.status && `status ${t.status.label} → ${t.status.value}${t.status.today ? ' (Today)' : ''}`].filter(Boolean).join(' · ')}
                  {t.last_fired_at && ` · last ${when(t.last_fired_at)}`}
                </p>
              </div>
              <button onClick={() => toggle(t)} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1" aria-pressed={t.on}>
                {t.on ? 'On' : 'Off'}
              </button>
              <button onClick={() => start(t)} className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1">Edit</button>
              <button
                onClick={() => (removing === t._id ? remove(t) : setRemoving(t._id))}
                onBlur={() => setRemoving(null)}
                className={`text-xs px-2 py-1 ${removing === t._id ? 'text-red-400' : 'text-slate-600 hover:text-red-400'}`}
              >{removing === t._id ? 'Delete?' : '✕'}</button>
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs text-slate-600">
        Phone notifications need the Ah-Ha Android app with <em>Instant notifications</em> on (Settings in the app).
      </p>
    </div>
  )
}
