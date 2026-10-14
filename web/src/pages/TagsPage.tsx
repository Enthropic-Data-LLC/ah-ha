import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { api, fetcher, ApiError } from '../lib/api'
import type { Entity, Space } from '../lib/types'
import QrCode, { downloadQrPng } from '../components/QrCode'

/**
 * Tags & QR codes. A tag is one link (ah-ha.app/t/<id>) that does one thing — log to the
 * trail, check in, open Heading out — whether it's on an NFC sticker or printed as a QR
 * code. NFC stickers are written from the phone app; QR codes print from here.
 */
export interface Tag {
  tag_id: string
  name: string
  icon: string
  url: string
  tap_count: number
  action:
    | { type: 'trail'; space_slug: string; text: string }
    | { type: 'checkin'; entity_id: string }
    | { type: 'complete_card'; card_id: string }
    | { type: 'open'; view: 'leave' | 'now' }
}

type Kind = 'trail' | 'checkin' | 'open-leave' | 'open-now'

export function describeTag(t: Tag, trails: Space[], places: Entity[]): string {
  const a = t.action
  switch (a.type) {
    case 'trail': return `Logs “${a.text}” to ${trails.find(s => s.slug === a.space_slug)?.name ?? a.space_slug}`
    case 'checkin': { const p = places.find(e => e._id === a.entity_id); return `Checks you in at ${p ? `${p.icon} ${p.name}` : 'a place'}` }
    case 'complete_card': return 'Ticks off a task'
    case 'open': return a.view === 'leave' ? 'Opens Heading out' : 'Opens Ah! Today'
  }
}

export default function TagsPage() {
  const { data, mutate } = useSWR<{ data: Tag[] }>('/api/nfc/tags', fetcher)
  const { data: trailData } = useSWR<{ data: Space[] }>('/api/spaces?type=trail', fetcher)
  const { data: entityData } = useSWR<{ data: Entity[] }>('/api/entities', fetcher)
  const tags = data?.data ?? []
  const trails = trailData?.data ?? []
  const places = (entityData?.data ?? []).filter(e => e.entity_type === 'place')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const printUrl = (ids: string[]) => `/tags/print?ids=${ids.join(',')}`

  async function remove(id: string) {
    await api.delete(`/api/nfc/tags/${id}`)
    setConfirmDelete(null)
    await mutate()
  }

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-8 space-y-8 overflow-y-auto">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">Tags &amp; QR codes</h1>
        <p className="text-sm text-slate-400">
          A tag does one thing when you scan it: logs something, checks you in, or opens a checklist. Print it as a QR code
          and stick it where it happens, or write it to an NFC sticker from the phone app. <a href="/help/nfc-tags" className="text-indigo-300 underline underline-offset-4">How tags work</a>
        </p>
      </header>

      <NewTag trails={trails} places={places} onMade={async () => { await mutate() }} />

      <section className="space-y-3" aria-labelledby="your-tags">
        <div className="flex items-center justify-between gap-3">
          <h2 id="your-tags" className="text-sm font-semibold text-slate-300">Your tags</h2>
          {selected.size > 0 && (
            <a href={printUrl([...selected])} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-lg transition">
              Print {selected.size} selected
            </a>
          )}
        </div>
        {data && tags.length === 0 && <p className="text-sm text-slate-500">No tags yet. Make one above.</p>}
        {tags.map(t => (
          <div key={t.tag_id} className="flex flex-col sm:flex-row gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
            <QrCode value={t.url} size={128} label={`QR code for ${t.name}`} />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="font-medium text-slate-100">{t.icon} {t.name}</p>
              <p className="text-sm text-slate-400">{describeTag(t, trails, places)}</p>
              <p className="text-xs text-slate-500">Used {t.tap_count}×</p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <a href={printUrl([t.tag_id])} target="_blank" rel="noreferrer" className="px-3 py-1.5 border border-slate-700 hover:border-slate-500 text-xs rounded-lg transition">Print</a>
                <button onClick={() => downloadQrPng(t.url, t.name)} className="px-3 py-1.5 border border-slate-700 hover:border-slate-500 text-xs rounded-lg transition">Download PNG</button>
                <label className="flex items-center gap-1.5 text-xs text-slate-400 px-2 py-1.5">
                  <input type="checkbox" checked={selected.has(t.tag_id)} onChange={() => toggle(t.tag_id)} /> Select to print together
                </label>
                {confirmDelete === t.tag_id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Delete it? Printed codes and stickers stop working.</span>
                    <button onClick={() => remove(t.tag_id)} className="text-red-400 hover:text-red-300">Delete</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-slate-400 hover:text-slate-200">Keep</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDelete(t.tag_id)} className="text-xs text-slate-500 hover:text-red-400 px-2 py-1.5">Delete</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

function NewTag({ trails, places, onMade }: { trails: Space[]; places: Entity[]; onMade: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🏷️')
  const [kind, setKind] = useState<Kind>('trail')
  const [trail, setTrail] = useState('')
  const [text, setText] = useState('')
  const [place, setPlace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!trail && trails[0]) setTrail(trails[0].slug) }, [trails, trail])
  useEffect(() => { if (!place && places[0]) setPlace(places[0]._id) }, [places, place])

  const action =
    kind === 'trail' ? (trail && text.trim() ? { type: 'trail', space_slug: trail, text: text.trim() } : null)
    : kind === 'checkin' ? (place ? { type: 'checkin', entity_id: place } : null)
    : { type: 'open', view: kind === 'open-leave' ? 'leave' : 'now' }

  async function make(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !action) return
    setBusy(true); setError(null)
    try {
      await api.post('/api/nfc/tags', { name: name.trim(), icon: icon.trim() || '🏷️', action })
      setName(''); setText('')
      await onMade()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make the tag')
    } finally { setBusy(false) }
  }

  const field = 'px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
  return (
    <form onSubmit={make} className="space-y-3 bg-slate-900/50 border border-slate-800 rounded-xl p-4" aria-labelledby="new-tag">
      <h2 id="new-tag" className="text-sm font-semibold text-slate-300">Make a tag</h2>
      <div className="flex gap-2">
        <label className="w-16"><span className="sr-only">Icon</span>
          <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={8} className={`${field} w-full text-center`} aria-label="Icon" /></label>
        <label className="flex-1"><span className="sr-only">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Meds or Front door" maxLength={60} className={`${field} w-full`} /></label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs text-slate-400 mb-1">When scanned</legend>
        <div className="flex flex-wrap gap-2">
          {([['trail', 'Log something'], ['checkin', 'Check in at a place'], ['open-leave', 'Open Heading out'], ['open-now', 'Open Ah! Today']] as const).map(([k, label]) => (
            <button type="button" key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-3 py-1.5 rounded-lg text-xs border transition ${kind === k ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>
        {kind === 'trail' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={text} onChange={e => setText(e.target.value)} placeholder="What to log, e.g. 💊 Took my meds" maxLength={500} className={`${field} flex-1`} aria-label="What to log" />
            {trails.length > 1 && (
              <select value={trail} onChange={e => setTrail(e.target.value)} className={field} aria-label="Which trail">
                {trails.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            )}
            {trails.length === 0 && <p className="text-xs text-amber-300">You need a trail first: make one in Spaces.</p>}
          </div>
        )}
        {kind === 'checkin' && (places.length ? (
          <select value={place} onChange={e => setPlace(e.target.value)} className={field} aria-label="Which place">
            {places.map(p => <option key={p._id} value={p._id}>{p.icon} {p.name}</option>)}
          </select>
        ) : <p className="text-xs text-amber-300">Add a place first (Entities, or 📍 Places in the phone app).</p>)}
      </fieldset>
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !name.trim() || !action} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold rounded-lg transition">
        Make tag
      </button>
    </form>
  )
}
