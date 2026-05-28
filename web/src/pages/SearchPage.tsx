import { useState, useRef } from 'react'
import { api } from '../lib/api'

interface SearchResult {
  type: 'card' | 'trail' | 'note'
  ref: string
  title: string
  space_ref: string
  updated_at?: string
  ts?: string
}

const TYPE_ICONS: Record<string, string> = {
  card: '🗂️',
  trail: '📍',
  note: '📝',
}

function refToUrl(ref: string): string {
  const parts = ref.split('/')
  if (parts.length < 3) return '/spaces'
  const [username, type, rest] = parts
  const slug = rest?.split('#')[0] ?? ''
  return `/spaces/${username}/${type}/${slug}`
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function search(q: string) {
    if (!q.trim()) { setResults([]); setSearched(false); return }
    setLoading(true)
    try {
      const res = await api.get<{ data: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`)
      setResults((res as any).data)
      setSearched(true)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 350)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-xl font-bold">Search</h1>

      <div className="relative">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search across all spaces…"
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {loading && (
          <div className="absolute right-3 top-3.5 w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <div className="space-y-1">
        {searched && results.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">No results for "{query}"</p>
        )}
        {results.map((r, i) => (
          <a
            key={`${r.ref}-${i}`}
            href={refToUrl(r.ref)}
            className="flex items-start gap-3 px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition group"
          >
            <span className="text-lg mt-0.5">{TYPE_ICONS[r.type] ?? '•'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{r.title}</p>
              <p className="text-xs text-slate-500 truncate">{r.space_ref}</p>
            </div>
            <span className="text-xs text-slate-600 group-hover:text-slate-400 flex-shrink-0">
              {r.updated_at ? new Date(r.updated_at).toLocaleDateString() : r.ts ? new Date(r.ts).toLocaleDateString() : ''}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
