import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState, useEffect } from 'react'

export default function NotePage({ slug }: { slug: string }) {
  const { data, mutate } = useSWR<{ data: { body: string; updated_at: string | null } }>(`/api/note/${slug}`, fetcher)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data?.data?.body !== undefined) {
      setBody(data.data.body)
      setDirty(false)
    }
  }, [data?.data?.body])

  async function save() {
    setSaving(true)
    try {
      await api.put(`/api/note/${slug}`, { body })
      setDirty(false)
      await mutate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full px-4 py-8 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold capitalize">{slug}</h1>
        <div className="flex items-center gap-3">
          {data?.data?.updated_at && (
            <span className="text-xs text-slate-500">Saved {new Date(data.data.updated_at).toLocaleString()}</span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium rounded-lg transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={body}
        onChange={e => { setBody(e.target.value); setDirty(true) }}
        placeholder="Start writing…"
        className="flex-1 min-h-[60vh] w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
      />
    </div>
  )
}
