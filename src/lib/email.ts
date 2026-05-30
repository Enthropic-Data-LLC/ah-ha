const EMAIL_RELAY = process.env['EMAIL_RELAY_URL'] ?? 'http://otto.local:1880/webhook/ah-ha-email'
const FROM = process.env['EMAIL_FROM'] ?? 'noreply@ah-ha.app'
const OVERRIDE = process.env['EMAIL_OVERRIDE']

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url = `${base}/auth/verify?token=${token}`
  const dest = OVERRIDE ?? to

  const res = await fetch(EMAIL_RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: dest,
      subject: 'Your Ah-Ha sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1e293b">Sign in to Ah-Ha</h2>
          <p style="color:#475569;margin:0 0 24px">Click the button below to sign in. It expires in 15 minutes and can only be used once.</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Sign in</a>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">Or copy this link: ${url}</p>
          <p style="color:#94a3b8;font-size:12px;margin:8px 0 0">If you didn't request this, you can ignore it.</p>
        </div>
      `,
    }),
  })

  const data = await res.json() as { ok: boolean; id?: string; error?: unknown }

  if (!data.ok) {
    console.error('[email] relay error:', data.error)
    throw new Error(`Email send failed: ${JSON.stringify(data.error)}`)
  }

  console.log('[email] sent via relay:', data.id, '→', dest)
}
