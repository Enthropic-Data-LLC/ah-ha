import { useState, useRef } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { fetcher, api, ApiError } from '../lib/api'
import { useMe } from '../hooks/useMe'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

type Tone = 'happy' | 'sorrow' | 'neutral'
type ToneFilter = Tone | 'all'

interface TrailEntry {
  id: string
  ref: string
  ts: string
  text: string
  tone: Tone
  source: string
  tags: string[]
  prev_hash: string
}

interface TrailSummary {
  total: number
  happy: number
  sorrow: number
  neutral: number
  streaks: {
    current_tone: Tone | null
    current_length: number
    sorrows_since_last_happy: number
  }
}

const TONE_BAR: Record<Tone, string> = {
  happy:   'bg-emerald-500',
  sorrow:  'bg-red-500',
  neutral: 'bg-slate-600',
}

const TONE_RING: Record<Tone, string> = {
  happy:   'border-emerald-500 bg-emerald-500/20 text-emerald-300',
  sorrow:  'border-red-500 bg-red-500/20 text-red-300',
  neutral: 'border-slate-500 bg-slate-500/20 text-slate-300',
}

const TONE_DOT: Record<Tone, string> = {
  happy:   'bg-emerald-400',
  sorrow:  'bg-red-400',
  neutral: 'bg-slate-500',
}

// Source labels — omit 'manual' (default, too noisy)
const SOURCE_LABEL: Record<string, string> = {
  api:      'API',
  mqtt:     'MQTT',
  mcp:      'AI',
  presence: 'Presence',
  nfc:      'NFC',
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)   return `${d}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function TrailPage({ slug }: { slug: string }) {
  const { user } = useMe()
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function deleteSpace() {
    if (!user?.username) return
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(`${user.username}/trail/${slug}`)}`)
      window.location.href = `/${user.username}/spaces`
    } catch { setDeleting(false) }
  }

  const [text, setText]           = useState('')
  const [tone, setTone]           = useState<Tone>('neutral')
  const [tagsInput, setTagsInput] = useState('')
  const [toneFilter, setToneFilter] = useState<ToneFilter>('all')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Summary for arc detection — 7-day window
  const { data: summaryResp, mutate: mutateSummary } =
    useSWR<{ data: TrailSummary }>(`/api/trail/${slug}/summary?since=7d`, fetcher, {
      revalidateOnFocus: false,
    })

  // Paginated entry feed — key changes with filter so SWR resets automatically
  const getKey = (
    pageIndex: number,
    prev: { data: TrailEntry[]; meta: { has_more: boolean; cursor: string | null } } | null
  ) => {
    if (pageIndex > 0 && !prev?.meta?.cursor) return null
    const p = new URLSearchParams({ limit: '30' })
    if (toneFilter !== 'all') p.set('tone', toneFilter)
    if (pageIndex > 0 && prev?.meta?.cursor) p.set('cursor', prev.meta.cursor)
    return `/api/trail/${slug}/entries?${p}`
  }

  const {
    data: pages,
    setSize,
    size,
    mutate: mutateEntries,
    isLoading,
  } = useSWRInfinite<{
    data: TrailEntry[]
    meta: { has_more: boolean; cursor: string | null }
  }>(getKey, fetcher, { revalidateFirstPage: false })

  const entries = pages?.flatMap(p => p.data) ?? []
  const hasMore = pages?.[pages.length - 1]?.meta.has_more ?? false

  async function mutateAll() {
    await Promise.all([mutateSummary(), mutateEntries()])
  }

  async function append(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setError('')
    setSubmitting(true)
    try {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
      await api.post(`/api/trail/${slug}/append`, { text: text.trim(), tone, tags })
      setText('')
      setTagsInput('')
      await mutateAll()
      textareaRef.current?.focus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to append')
    } finally {
      setSubmitting(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      append(e as unknown as React.FormEvent)
    }
  }

  const summary  = summaryResp?.data
  const streaks  = summary?.streaks
  const showSorrowArc = streaks && streaks.sorrows_since_last_happy > 1
  const showHappyArc  = streaks && streaks.current_tone === 'happy' && streaks.current_length >= 3

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

      {/* Arc banner */}
      {(showSorrowArc || showHappyArc) && (
        <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-3 ${
          showSorrowArc
            ? 'bg-red-500/10 border border-red-500/20 text-red-300'
            : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
        }`}>
          <span className="text-base select-none">
            {showSorrowArc ? '⚠' : '✦'}
          </span>
          <span className="font-medium">
            {showSorrowArc
              ? `${streaks!.sorrows_since_last_happy} sorrows since last happy`
              : `Happy streak — ${streaks!.current_length} in a row`}
          </span>
          {summary && (
            <span className="ml-auto text-xs opacity-50 font-normal whitespace-nowrap">
              {summary.happy} happy · {summary.sorrow} sorrow · 7d
            </span>
          )}
        </div>
      )}

      {/* Compose */}
      <form onSubmit={append} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Log an entry…"
          rows={2}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />

        <div className="flex items-center gap-2 flex-wrap">
          {/* Tone selector */}
          {(['neutral', 'happy', 'sorrow'] as Tone[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition ${
                tone === t ? TONE_RING[t] : 'border-slate-700 text-slate-500 hover:border-slate-500'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${tone === t ? TONE_DOT[t] : 'bg-slate-600'}`} />
              {t}
            </button>
          ))}

          {/* Tags */}
          <input
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder="tags, comma separated"
            className="flex-1 min-w-0 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-400 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600"
          />

          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-medium rounded-lg transition"
          >
            {submitting ? 'Saving…' : (
              <>Append <span className="opacity-40">⌘↵</span></>
            )}
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>

      {/* Filter bar */}
      <div className="flex items-center gap-1">
        {(['all', 'happy', 'sorrow', 'neutral'] as ToneFilter[]).map(f => (
          <button
            key={f}
            onClick={() => { setToneFilter(f); setSize(1) }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition ${
              toneFilter === f
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {f !== 'all' && (
              <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[f as Tone]}`} />
            )}
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && summary && (
              <span className="opacity-40">
                {f === 'happy' ? summary.happy : f === 'sorrow' ? summary.sorrow : summary.neutral}
              </span>
            )}
          </button>
        ))}

        {summary && (
          <span className="ml-auto text-xs text-slate-600 tabular-nums">
            {summary.total} total
          </span>
        )}
      </div>

      {/* Feed */}
      <div className="space-y-1.5">
        {isLoading && entries.length === 0 && (
          <div className="flex justify-center py-12">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <div className="text-center py-12 space-y-2">
            <p className="text-slate-500 text-sm">No entries yet.</p>
            <p className="text-slate-600 text-xs">Log something above — anything counts.</p>
          </div>
        )}

        {entries.map(entry => (
          <div
            key={entry.id}
            className="flex bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition group"
          >
            {/* Tone left bar */}
            <div className={`w-1 flex-shrink-0 ${TONE_BAR[entry.tone]}`} />

            <div className="flex-1 px-4 py-3 min-w-0 space-y-1">
              <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                {entry.text}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs text-slate-500 font-mono tabular-nums"
                  title={new Date(entry.ts).toLocaleString()}
                >
                  {relativeTime(entry.ts)}
                </span>

                {SOURCE_LABEL[entry.source] && (
                  <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400">
                    {SOURCE_LABEL[entry.source]}
                  </span>
                )}

                {entry.tags.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400">
                    #{tag}
                  </span>
                ))}

                <span
                  className="ml-auto font-mono text-[10px] text-slate-700 group-hover:text-slate-600 transition cursor-default select-none"
                  title={`Chain: ${entry.prev_hash}`}
                >
                  {entry.prev_hash.slice(0, 8)}
                </span>
              </div>
            </div>
          </div>
        ))}

        {hasMore && (
          <button
            onClick={() => setSize(size + 1)}
            className="w-full py-3 text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Load more
          </button>
        )}
      </div>
    </div>

    {showDelete && (
      <ConfirmDeleteModal
        name={slug}
        type="trail"
        onConfirm={deleteSpace}
        onCancel={() => setShowDelete(false)}
        deleting={deleting}
      />
    )}
  )
}
