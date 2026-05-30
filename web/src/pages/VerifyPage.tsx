import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'

export default function VerifyPage() {
  const [status, setStatus] = useState<'checking' | 'error'>('checking')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setStatus('error')
      setMessage('Missing token.')
      return
    }
    api.post<{ ok: boolean; username: string | null }>('/api/auth/verify', { token })
      .then(res => {
        window.location.replace(res.username ? `/${res.username}` : '/onboarding')
      })
      .catch(err => {
        setStatus('error')
        setMessage(err instanceof ApiError ? err.message : 'Sign-in failed. The link may have expired.')
      })
  }, [])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-red-400">{message}</p>
          <a href="/auth" className="text-sm text-slate-400 hover:text-slate-200 underline">
            Request a new sign-in link
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Signing you in…</p>
      </div>
    </div>
  )
}
