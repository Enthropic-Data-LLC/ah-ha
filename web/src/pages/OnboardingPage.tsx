import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { mutate } from 'swr'

export default function OnboardingPage() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/claim-username', { username })
      await mutate('/auth/me')
      window.location.href = '/spaces'
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Choose your username</h1>
          <p className="text-slate-400 text-sm">This is how your spaces are addressed.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 focus-within:ring-2 focus-within:ring-indigo-500">
            <span className="text-slate-500 text-sm select-none">ah-ha.app/</span>
            <input
              type="text"
              autoFocus
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_-]+"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              placeholder="yourname"
              className="flex-1 bg-transparent text-sm focus:outline-none min-w-0"
            />
          </div>
          <p className="text-xs text-slate-600">Lowercase letters, numbers, hyphens and underscores only.</p>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || username.length < 3}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       disabled:cursor-not-allowed text-sm font-semibold rounded-lg transition"
          >
            {loading ? 'Claiming…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
