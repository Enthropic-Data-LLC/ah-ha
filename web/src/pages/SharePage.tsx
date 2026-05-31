import { useEffect, useState } from 'react'

interface ShareData {
  space: { name: string; type: string; ref: string }
  content: unknown
  expires_at: string | null
}

function TrailView({ entries }: { entries: Array<{ id: string; ts: string; text: string; tone: string; tags: string[] }> }) {
  const toneIcon = (t: string) => t === 'happy' ? '✦' : t === 'sorrow' ? '·' : '○'
  const toneColor = (t: string) => t === 'happy' ? 'text-emerald-400' : t === 'sorrow' ? 'text-rose-400' : 'text-slate-500'
  return (
    <div className="space-y-2">
      {entries.map(e => (
        <div key={e.id} className="flex gap-3 px-4 py-2.5 bg-slate-900/50 rounded-lg">
          <span className={`text-xs mt-0.5 flex-shrink-0 ${toneColor(e.tone)}`}>{toneIcon(e.tone)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200">{e.text}</p>
            <p className="text-xs text-slate-600 mt-0.5">{new Date(e.ts).toLocaleString()}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function NoteView({ body }: { body: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none px-4 py-3 bg-slate-900/50 rounded-lg">
      <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans">{body || 'Empty note.'}</pre>
    </div>
  )
}

function BoardView({ columns, cards }: { columns: Array<{ _id: string; title: string }>; cards: Array<{ _id: string; column_id: string; title: string; priority: string }> }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(col => {
        const colCards = cards.filter(c => String(c.column_id) === String(col._id))
        return (
          <div key={col._id} className="w-60 flex-shrink-0 space-y-2">
            <p className="text-xs font-semibold text-slate-400 px-1">{col.title} <span className="text-slate-600">({colCards.length})</span></p>
            {colCards.map(card => (
              <div key={card._id} className="px-3 py-2.5 bg-slate-900/70 border border-slate-800 rounded-lg">
                <p className="text-sm text-slate-200">{card.title}</p>
                {card.priority !== 'none' && <p className="text-xs text-slate-600 mt-0.5 capitalize">{card.priority}</p>}
              </div>
            ))}
            {colCards.length === 0 && <p className="text-xs text-slate-700 px-1 py-2">Empty</p>}
          </div>
        )
      })}
    </div>
  )
}

function ListView({ items }: { items: Array<{ _id: string; title: string; done: boolean }> }) {
  return (
    <div className="space-y-1">
      {items.map(item => (
        <div key={item._id} className="flex items-center gap-3 px-4 py-2 bg-slate-900/50 rounded-lg">
          <span className={`text-sm ${item.done ? 'text-slate-600 line-through' : 'text-slate-200'}`}>{item.title}</span>
        </div>
      ))}
      {items.length === 0 && <p className="text-slate-600 text-sm px-4 py-3">Empty list.</p>}
    </div>
  )
}

export default function SharePage({ token }: { token: string }) {
  const [data, setData] = useState<ShareData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error: string }) => { throw new Error(e.error) }))
      .then((res: { data: ShareData }) => setData(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center flex-col gap-3">
      <p className="text-slate-400">{error === 'Share link expired' ? '🔗 This share link has expired.' : '🔒 Not found.'}</p>
      <a href="/" className="text-sm text-indigo-400 hover:underline">Go to aH-Ha</a>
    </div>
  )

  if (!data) return null

  const content = data.content as Record<string, unknown>

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="font-bold text-sm tracking-tight">aH-Ha</a>
          <span className="text-slate-700">·</span>
          <span className="text-sm text-slate-400">{data.space.name}</span>
          <span className="text-xs px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-slate-500 capitalize">{data.space.type}</span>
        </div>
        <span className="text-xs text-slate-600">read-only</span>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 space-y-4">
        <h1 className="text-xl font-bold">{data.space.name}</h1>

        {data.space.type === 'trail' && (
          <TrailView entries={content as Parameters<typeof TrailView>[0]['entries']} />
        )}
        {data.space.type === 'note' && (
          <NoteView body={(content as { body: string }).body} />
        )}
        {data.space.type === 'board' && (
          <BoardView
            columns={(content as { columns: Parameters<typeof BoardView>[0]['columns'] }).columns}
            cards={(content as { cards: Parameters<typeof BoardView>[0]['cards'] }).cards}
          />
        )}
        {data.space.type === 'list' && (
          <ListView items={content as Parameters<typeof ListView>[0]['items']} />
        )}

        {data.expires_at && (
          <p className="text-xs text-slate-700 text-center pt-4">
            Link expires {new Date(data.expires_at).toLocaleDateString()}
          </p>
        )}
      </main>
    </div>
  )
}
