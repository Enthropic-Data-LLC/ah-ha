import { useRef, useState } from 'react'
import useSWR from 'swr'
import { useMe } from '../hooks/useMe'
import { fetcher } from '../lib/api'
import UsageMeters, { type Usage } from '../components/UsageMeters'

// The account's plan and usage (KB #2160); export it as one file, import such a file back (KB #2159).

interface ImportResult {
  counts: Record<string, number>
  renamed: string[]
  skipped: string[]
  webhooks_reissued: number
}

const LABELS: Record<string, string> = {
  spaces: 'spaces', board_cards: 'cards', board_columns: 'board columns', list_items: 'list items',
  note_content: 'notes', table_rows: 'table rows', table_columns: 'table columns', trail_entries: 'trail entries',
  entities: 'places & people', links: 'links', nfc_tags: 'NFC tags', trackers: 'trackers', statuses: 'statuses',
  mqtt_subscriptions: 'MQTT subscriptions', webhooks: 'webhooks', calendar_sources: 'calendars', notification_prefs: 'notification settings',
}

export default function DataPage() {
  const { user } = useMe()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const usage = useSWR<{ data: Usage }>('/api/usage', fetcher).data?.data
  const overAny = usage && (usage.over.spaces || usage.over.storage || usage.over.ai_calls)

  async function importFile(f: File) {
    setBusy(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: await f.text(),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const e = body.error
        setError(typeof e === 'string' ? e : e?.message ?? (res.status === 429 ? 'Too many tries — wait a minute' : 'The import failed'))
        return
      }
      setResult(body.data)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-10 space-y-8 overflow-y-auto">
      <h1 className="text-xl font-bold">Your data</h1>

      {usage && (
        <section className="space-y-3">
          <h2 className="font-semibold">Plan: <span className="capitalize">{usage.plan}</span></h2>
          <UsageMeters u={usage} />
          {usage.mode !== 'off' && overAny && (
            <p role="status" className="text-sm text-amber-200">
              {usage.mode === 'enforce'
                ? 'You’ve reached a limit of your plan. Delete something or upgrade to keep adding.'
                : 'You’re at a limit of your plan. Nothing is blocked yet.'}
            </p>
          )}
          <p className="text-xs text-slate-400">Counted from sizes and totals only. Nobody reads your content to measure it.</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Export</h2>
        <p className="text-sm text-slate-300">
          One file with everything in your account: spaces and what’s in them, your trail, places and people, NFC tags,
          trackers, and your MQTT, webhook, calendar and notification settings.
        </p>
        <p className="text-sm text-slate-400">
          It leaves out API keys, share links, your audit log and your own AI key. Webhook secrets aren’t included either.
          The file does contain your calendar feed addresses, so keep it somewhere private.
        </p>
        <a href="/api/export" download
           className="inline-block px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition">
          Download my data
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Import</h2>
        <p className="text-sm text-slate-300">
          Bring an Ah-Ha export into this account. Everything comes in as new copies alongside what’s already here. A space
          whose name is already taken gets a number on the end, so nothing is overwritten.
        </p>
        <p className="text-sm text-slate-400">
          Only a file exported from Ah-Ha, unchanged, can be imported: each export is sealed, and an edited file is refused.
          Each export can be imported into an account once.
        </p>
        {user?.disabled ? (
          <p className="text-sm text-amber-200">This account is disabled, so it can’t import.</p>
        ) : (
          <>
            <label className={`inline-block px-4 py-2 rounded-lg border border-slate-700 text-sm transition ${busy ? 'opacity-50' : 'hover:bg-slate-800 cursor-pointer'}`}>
              {busy ? 'Importing…' : 'Choose an export file…'}
              <input ref={input} type="file" accept="application/json,.json" className="sr-only" disabled={busy}
                     onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f) }} />
            </label>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </>
        )}

        {result && (
          <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2 text-sm">
            <p className="font-medium text-emerald-300">Imported</p>
            <p className="text-slate-300">
              {Object.entries(result.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${LABELS[k] ?? k}`).join(' · ')}
            </p>
            {result.renamed.length > 0 && (
              <p className="text-slate-400">Renamed because the name was taken: {result.renamed.map(r => r.split('/').slice(1).join('/')).join(', ')}</p>
            )}
            {result.webhooks_reissued > 0 && (
              <p className="text-slate-400">Imported webhooks have new addresses and secrets. Update whatever sends to them (Webhooks page).</p>
            )}
            {result.skipped.length > 0 && <p className="text-slate-400">Not imported: {result.skipped.join('; ')}</p>}
            {user && <a href={`/${user.username}/spaces`} className="inline-block text-indigo-300 hover:text-indigo-200">Go to your spaces →</a>}
          </div>
        )}
      </section>
    </div>
  )
}
