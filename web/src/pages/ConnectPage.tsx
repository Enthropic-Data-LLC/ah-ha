import { useState } from 'react'
import useSWR from 'swr'
import { api, fetcher, ApiError } from '../lib/api'

/**
 * /connect — an app asks to connect (see src/routes/connect.ts for the protocol).
 * One screen, one tap: what the app is, what it may do, Allow or Cancel.
 */

const RETURN_KEY = 'aha_return_to'

/** Called before sending a signed-out visitor to /auth; VerifyPage brings them back. */
export function rememberReturn() {
  try { localStorage.setItem(RETURN_KEY, JSON.stringify({ to: location.pathname + location.search, at: Date.now() })) } catch { /* private mode */ }
}

/** The /connect URL to resume after sign-in, if one was saved in the last 30 minutes. */
export function takeReturn(): string | null {
  try {
    const raw = localStorage.getItem(RETURN_KEY)
    localStorage.removeItem(RETURN_KEY)
    const r = raw ? JSON.parse(raw) as { to: string; at: number } : null
    return r && Date.now() - r.at < 30 * 60_000 && r.to.startsWith('/connect?') ? r.to : null
  } catch { return null }
}

// Same rule as the server: https or an app scheme, never http/javascript/data/file.
function safeRedirect(u: string | null): URL | null {
  if (!u) return null
  try {
    const url = new URL(u)
    const p = url.protocol.replace(/:$/, '')
    const ok = p === 'https' || (/^[a-z][a-z0-9+.-]*$/.test(p) && !['http', 'javascript', 'data', 'file', 'blob', 'vbscript'].includes(p))
    return ok ? url : null
  } catch { return null }
}

function sendBack(redirect: URL, params: Record<string, string>) {
  for (const [k, v] of Object.entries(params)) redirect.searchParams.set(k, v)
  window.location.replace(redirect.toString())
}

export default function ConnectPage() {
  const q = new URLSearchParams(window.location.search)
  const clientId = q.get('client_id') ?? ''
  const name = (q.get('client_name') ?? '').slice(0, 60)
  const device = (q.get('device') ?? '').slice(0, 60)
  const scopes = (q.get('scope') ?? '').split(/[\s,]+/).filter(Boolean)
  const state = q.get('state') ?? ''
  const challenge = q.get('code_challenge') ?? ''
  const method = q.get('code_challenge_method') ?? ''
  const redirect = safeRedirect(q.get('redirect_uri'))

  const { data: labels } = useSWR<{ data: Record<string, string> }>('/api/connect/scopes', fetcher)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The app takes over after the redirect; this tab stays behind, so say it's finished.
  const [done, setDone] = useState<'allowed' | 'cancelled' | null>(null)

  const problem =
    !redirect ? 'This connect link has no valid return address.' :
    !clientId || !name ? 'This connect link does not say which app is asking.' :
    !scopes.length ? 'This connect link does not say what the app wants to do.' :
    method !== 'S256' || !challenge ? 'This connect link is missing its security check (PKCE).' : ''

  async function allow() {
    setBusy(true); setError('')
    try {
      const res = await api.post<{ data: { code: string } }>('/api/connect/authorize', {
        client_id: clientId, client_name: name, device, scopes,
        redirect_uri: q.get('redirect_uri'), code_challenge: challenge, code_challenge_method: method,
      })
      sendBack(redirect!, { code: res.data.code, state })
      setDone('allowed')
    } catch (err) {
      setBusy(false)
      setError(err instanceof ApiError ? err.message : 'Could not connect. Try again from the app.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-6">
        {done ? (
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-slate-100">{done === 'allowed' ? `${name} is connected` : 'Not connected'}</h1>
            <p className="text-sm text-slate-400">Back in {name} now. You can close this tab.</p>
          </div>
        ) : problem ? (
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold text-slate-100">Can't connect</h1>
            <p className="text-sm text-slate-400">{problem}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-bold text-slate-100">Connect {name}</h1>
              {device && <p className="text-sm text-slate-400">on {device}</p>}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <p className="text-sm text-slate-300">{name} will be able to:</p>
              <ul className="space-y-1.5">
                {scopes.map(s => (
                  <li key={s} className="flex gap-2 text-sm text-slate-200">
                    <span className="text-emerald-400">✓</span>
                    {labels?.data[s] ?? s}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">Nothing else. Disconnect it any time under Keys.</p>
            </div>

            <p className="text-xs text-slate-500 text-center">
              Ah-Ha hasn't checked this app ({clientId}). Only allow it if you just opened it yourself.
            </p>

            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { sendBack(redirect!, { error: 'access_denied', state }); setDone('cancelled') }}
                disabled={busy}
                className="flex-1 px-4 py-3 border border-slate-700 hover:border-slate-500 text-slate-300 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={allow}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition"
              >
                {busy ? 'Connecting…' : 'Allow'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
