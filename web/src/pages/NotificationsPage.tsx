import useSWR from 'swr'
import { fetcher, api, ApiError } from '../lib/api'
import { useEffect, useState } from 'react'

interface NotifPrefs {
  daily_briefing: { enabled: boolean; time: string; timezone: string }
  presence: { enabled: boolean; notify_on: string[] }
  channels: { telegram_chat_id?: string; email?: string }
}

const DEFAULT: NotifPrefs = {
  daily_briefing: { enabled: false, time: '08:00', timezone: 'UTC' },
  presence: { enabled: false, notify_on: ['home', 'away'] },
  channels: {},
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  )
}

export default function NotificationsPage() {
  const { data, isLoading } = useSWR<{ data: NotifPrefs }>('/api/notifications/prefs', fetcher)
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (data?.data) {
      setPrefs({
        daily_briefing: { ...DEFAULT.daily_briefing, ...data.data.daily_briefing },
        presence: { ...DEFAULT.presence, ...data.data.presence },
        channels: data.data.channels ?? {},
      })
    }
  }, [data])

  function set<K extends keyof NotifPrefs>(section: K, patch: Partial<NotifPrefs[K]>) {
    setPrefs(p => ({ ...p, [section]: { ...p[section] as object, ...patch } }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put('/api/notifications/prefs', prefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-xl font-bold mb-8">Notification Settings</h1>

      <form onSubmit={save} className="space-y-6">

        {/* Daily briefing */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Daily briefing</p>
              <p className="text-xs text-slate-500 mt-0.5">A summary of your spaces sent each morning</p>
            </div>
            <Toggle
              checked={prefs.daily_briefing.enabled}
              onChange={v => set('daily_briefing', { enabled: v })}
            />
          </div>

          {prefs.daily_briefing.enabled && (
            <div className="flex gap-3 pt-1">
              <div className="space-y-1 flex-1">
                <label className="text-xs text-slate-400">Time</label>
                <input
                  type="time"
                  value={prefs.daily_briefing.time}
                  onChange={e => set('daily_briefing', { time: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1 flex-1">
                <label className="text-xs text-slate-400">Timezone</label>
                <input
                  value={prefs.daily_briefing.timezone}
                  onChange={e => set('daily_briefing', { timezone: e.target.value })}
                  placeholder="America/New_York"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}
        </section>

        {/* Presence */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Presence alerts</p>
              <p className="text-xs text-slate-500 mt-0.5">Notify when your home/away status changes</p>
            </div>
            <Toggle
              checked={prefs.presence.enabled}
              onChange={v => set('presence', { enabled: v })}
            />
          </div>
        </section>

        {/* Delivery channels */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
          <p className="text-sm font-medium">Delivery channels</p>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Telegram chat ID</label>
            <input
              value={prefs.channels.telegram_chat_id ?? ''}
              onChange={e => set('channels', { telegram_chat_id: e.target.value || undefined })}
              placeholder="e.g. 6530879951"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-600">Start a chat with your bot and send /start to get your chat ID</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Email</label>
            <input
              type="email"
              value={prefs.channels.email ?? ''}
              onChange={e => set('channels', { email: e.target.value || undefined })}
              placeholder="you@example.com"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </section>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium rounded-lg transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-sm text-emerald-400">Saved!</span>}
        </div>
      </form>
    </div>
  )
}
