import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { solvePow } from '../lib/pow'
import { useMe } from '../hooks/useMe'
import { PublicLayout } from './PublicPages'

/** ah-ha.app/feedback — for anyone, signed in or not. Goes straight to the people who build Ah-Ha. */
export default function FeedbackPage() {
  const { user } = useMe()
  const signedIn = !!user?.username
  const from = new URLSearchParams(window.location.search).get('from') ?? document.referrer.replace(window.location.origin, '')
  const [message, setMessage] = useState('')
  const [doing, setDoing] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      let proof = {}
      if (!signedIn) {
        // The same small puzzle as sign-in: a second or two for a person, costly for a bot sending thousands.
        setState('checking')
        const { challenge, difficulty } = await api.get<{ challenge: string; difficulty: number }>('/auth/pow-challenge')
        proof = { challenge, nonce: await solvePow(challenge, difficulty) }
      }
      setState('sending')
      await api.post('/api/feedback', {
        message, doing: doing || undefined, email: signedIn ? undefined : email || undefined,
        page: from.startsWith('/') ? from.slice(0, 300) : undefined, ...proof,
      })
      setState('sent')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again')
      setState('idle')
    }
  }

  return (
    <PublicLayout>
      <div className="max-w-xl mx-auto px-6 pb-16 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-50">Send feedback</h1>
          <p className="text-sm text-slate-400">
            Something confusing, broken, or missing? Something you love? It goes straight to the people who build Ah-Ha.
          </p>
        </header>

        {state === 'sent' ? (
          <div role="status" className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
            <p className="text-lg text-slate-100">Thank you — got it.</p>
            <p className="text-sm text-slate-400">
              {signedIn || email ? 'If it needs an answer, we’ll get back to you.' : 'We read every message.'}
            </p>
            <div className="flex gap-4 text-sm">
              <button onClick={() => { setMessage(''); setDoing(''); setState('idle') }} className="text-indigo-300 underline underline-offset-4">Send another</button>
              <a href={signedIn ? '/now' : '/'} className="text-slate-400 underline underline-offset-4">{signedIn ? 'Back to Ah! Today' : 'Home'}</a>
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-200">What’s on your mind?</span>
              <textarea
                required
                rows={6}
                maxLength={4000}
                value={message}
                onChange={e => setMessage(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-200">What were you doing? <span className="text-slate-500">(optional)</span></span>
              <input
                value={doing}
                maxLength={1000}
                onChange={e => setDoing(e.target.value)}
                placeholder="e.g. adding a second location to a place"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            {signedIn ? (
              <p className="text-xs text-slate-500">Sending as @{user!.username}, so we can reply.</p>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-sm text-slate-200">Your email <span className="text-slate-500">(optional — only if you’d like a reply)</span></span>
                <input
                  type="email"
                  value={email}
                  maxLength={200}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </label>
            )}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={!message.trim() || state !== 'idle'}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
            >
              {state === 'checking' ? 'Checking you’re not a bot…' : state === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </PublicLayout>
  )
}
