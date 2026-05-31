import useSWR from 'swr'
import { fetcher, api } from '../lib/api'
import { useState, useEffect } from 'react'
import { useMe } from '../hooks/useMe'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

export default function NotePage({ slug }: { slug: string }) {
  const { user } = useMe()
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { data, mutate } = useSWR<{ data: { body: string; updated_at: string | null } }>(`/api/note/${slug}`, fetcher)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (data?.data?.body !== undefined) {
      setBody(data.data.body)
      setDirty(false)
    }
    if (data?.data?.updated_at) {
      setSavedAt(new Date(data.data.updated_at))
    }
  }, [data?.data?.body, data?.data?.updated_at])

  async function save() {
    if (!dirty) return
    setSaveError('')
    setSaving(true)
    try {
      await api.put(`/api/note/${slug}`, { body })
      setDirty(false)
      setSavedAt(new Date())
      await mutate()
    } catch (err: any) {
      setSaveError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSpace() {
    if (!user?.username) return
    setDeleting(true)
    try {
      await api.delete(`/api/spaces/${encodeURIComponent(`${user.username}/note/${slug}`)}`)
      window.location.href = `/${user.username}/spaces`
    } catch { setDeleting(false) }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full px-4 py-8 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold capitalize">{slug}</h1>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          {!saveError && savedAt && !dirty && (
            <span className="text-xs text-slate-500">Saved {savedAt.toLocaleTimeString()}</span>
          )}
          {dirty && !saveError && <span className="text-xs text-slate-500">Unsaved changes</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium rounded-lg transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setShowDelete(true)} className="text-slate-600 hover:text-red-400 text-sm transition" title="Delete note">✕</button>
        </div>
      </div>
      <textarea
        value={body}
        onChange={e => { setBody(e.target.value); setDirty(true); setSaveError('') }}
        onKeyDown={handleKeyDown}
        placeholder="Start writing… (Ctrl+S to save)"
        className="flex-1 min-h-[60vh] w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
      />
    </div>
  )

      {showDelete && (
        <ConfirmDeleteModal
          name={slug}
          type="note"
          onConfirm={deleteSpace}
          onCancel={() => setShowDelete(false)}
          deleting={deleting}
        />
      )}
}