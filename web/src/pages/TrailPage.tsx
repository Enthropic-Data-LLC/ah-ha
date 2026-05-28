import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState } from 'react'

const TONE_COLORS: Record<string, string> = {
  happy: 'text-emerald-400',
  sorrow: 'text-red-400',
  neutral: 'text-slate-400',
}

const TONE_ICONS: Record<string, string> = {
  happy: '😊',
  sorrow: '😔',
  neutral: '•',
}

interface TrailEntry {
  id: string
  ts: string
  text: string
  tone: 'happy' | 'sorrow' | 'neutral'
  source: string
  tags: string[]
}

export default function TrailPage({ slug }: { slug: string }) {
  const { data, mutate } = useSWR<{ data: TrailEntry[] }>(`/api/trail/${slug}/entries`, fetcher)
  const [text, setText] = useState('')
  const [tone, setTone] = useState<'happy' | 'sorrow' | 'neutral'>('neutral')
  const [submitting, setSubmitting] = useState(false)

  async function append(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      await api.post(`/api/trail/${slug}/append`, { text: text.trim(), tone })
      setText('')
      await mutate()
    } finally {
      setSubmitting(false)
    }
  }

  const entries = data?.data ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-xl font-bold capitalize">{slug}</h1>

      <form onSubmit={append} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Log an entry…"
          rows={3}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['neutral', 'happy', 'sorrow'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`px-2 py-1 rounded text-xs border transition ${tone === t ? 'border-indigo-500 bg-indigo-500/20' : 'border-slate-700 text-slate-400'}`}
              >
                {TONE_ICONS[t]} {t}
              </button>
            ))}
          </div>
          <button type="submit" disabled={submitting || !text.trim()} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition">
            {submitting ? 'Saving…' : 'Append'}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {entries.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">No entries yet.</p>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className={TONE_COLORS[entry.tone]}>{TONE_ICONS[entry.tone]}</span>
              <span>{new Date(entry.ts).toLocaleString()}</span>
              {entry.tags.length > 0 && entry.tags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">#{tag}</span>
              ))}
            </div>
            <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
