import { useEffect, useState } from 'react'

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
    // The server redirects on verify — just follow it
    window.location.href = `/auth/verify?token=${token}`
  }, [])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-red-400">{message}</p>
          <a href="/" className="text-sm text-slate-400 hover:text-slate-200 underline">
            Back to sign in
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
