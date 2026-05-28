import { useState } from 'react'
import { api, ApiError } from '../lib/api'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/magic-link', { email })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">📬</div>
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-slate-400 text-sm">
            We sent a sign-in link to <span className="text-slate-200">{email}</span>.
            It expires in 15 minutes.
          </p>
          <button
            onClick={() => { setSent(false); setEmail('') }}
            className="text-sm text-slate-500 hover:text-slate-300 underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Ah-Ha</h1>
          <p className="text-slate-400 text-sm">Your personal knowledge space</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoFocus
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm
                         placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500
                         focus:border-transparent transition"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                       disabled:cursor-not-allowed text-sm font-semibold rounded-lg transition"
          >
            {loading ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600">
          No password. No friction.
        </p>
      </div>
    </div>
  )
}
