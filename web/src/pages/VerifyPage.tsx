import { useState } from 'react'
import { api, ApiError } from '../lib/api'

export default function VerifyPage() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const token = new URLSearchParams(window.location.search).get('token')

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-red-400">Missing sign-in token.</p>
          <a href="/auth" className="text-sm text-slate-400 hover:text-slate-200 underline">
            Request a new sign-in link
          </a>
        </div>
      </div>
    )
  }

  async function signIn() {
    setStatus('loading')
    setMessage('')
    try {
      const res = await api.post<{ ok: boolean; username: string | null }>('/api/auth/verify', { token })
      window.location.replace(res.username ? `/${res.username}` : '/onboarding')
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof ApiError ? err.message : 'Sign-in failed. The link may have expired.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-sm w-full">
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-100">Sign in to Ah-Ha</h1>
          <p className="text-sm text-slate-400">Click the button below to complete your sign-in.</p>
        </div>

        {status === 'error' ? (
          <div className="space-y-3">
            <p className="text-red-400 text-sm">{message}</p>
            <a href="/auth" className="text-sm text-slate-400 hover:text-slate-200 underline">
              Request a new sign-in link
            </a>
          </div>
        ) : (
          <button
            onClick={signIn}
            disabled={status === 'loading'}
            className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition"
          >
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        )}
      </div>
    </div>
  )
}
