import useSWR from 'swr'
import { useState } from 'react'
import { fetcher, api, ApiError } from '../lib/api'

interface NfcTag {
  tag_id: string
  name: string
  icon: string
  action: { type: 'trail'; space_slug: string; text: string } | { type: 'checkin'; entity_id: string } | { type: 'complete_card'; card_id: string } | { type: 'open'; view: 'leave' | 'now' }
  tap_count: number
}

const ACTION_LABEL: Record<NfcTag['action']['type'], string> = {
  trail: 'Log to trail',
  checkin: 'Check in',
  complete_card: 'Complete card',
  open: 'Open',
}

// Phones without the Ah-Ha app open the tag's URL here. The action only runs on a
// button press — link scanners and prefetchers load URLs too (see VerifyPage).
export default function TapPage({ tagId }: { tagId: string }) {
  const { data, error } = useSWR<{ data: NfcTag }>(`/api/nfc/tags/${tagId}`, fetcher)
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const tag = data?.data

  async function runTag() {
    setRunning(true); setFailure(null)
    try {
      const res = await api.post<{ data: { message: string } }>(`/api/nfc/tap/${tagId}`, {})
      setResult(res.data.message)
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setRunning(false)
    }
  }

  if (error) {
    return <p className="text-center text-slate-500 py-24">This tag isn't registered to your account.</p>
  }
  // "Open" tags have no action to run — on the web, Now (with its Going-to checklist) is the screen.
  if (tag?.action.type === 'open') {
    window.location.replace('/now')
    return null
  }
  if (!tag) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-16 text-center space-y-6">
      <div className="text-5xl">{tag.icon}</div>
      <div className="space-y-1">
        <h1 className="text-xl text-slate-200">{tag.name}</h1>
        <p className="text-sm text-slate-500">
          {ACTION_LABEL[tag.action.type]}
          {tag.action.type === 'trail' && <> · “{tag.action.text}”</>}
        </p>
      </div>

      {result ? (
        <p className="text-emerald-400">✓ {result}</p>
      ) : (
        <button
          onClick={runTag}
          disabled={running}
          className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-lg transition"
        >
          {running ? 'Running…' : 'Run'}
        </button>
      )}
      {failure && <p className="text-sm text-rose-400">{failure}</p>}
      <p className="text-xs text-slate-700">Tapped {tag.tap_count} times</p>
    </div>
  )
}
