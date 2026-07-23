import { Resend } from 'resend'

const FROM     = process.env['EMAIL_FROM'] ?? 'noreply@ah-ha.app'
const API_KEY  = process.env['RESEND_API_KEY'] ?? ''
const OVERRIDE = process.env['EMAIL_OVERRIDE']

// Provider selection. Defaults to resend so the cutover is a single env flip
// (EMAIL_PROVIDER=maileroo) once ah-ha.app is DNS-verified in Maileroo.
const PROVIDER      = (process.env['EMAIL_PROVIDER'] ?? 'resend').toLowerCase()
const MAILEROO_KEY  = process.env['MAILEROO_SENDING_KEY'] ?? ''
const MAILEROO_URL  = 'https://smtp.maileroo.com/api/v2/emails'

const resend = API_KEY ? new Resend(API_KEY) : null

function magicLinkHtml(url: string): string {
  return `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1e293b">Sign in to aH-Ha</h2>
          <p style="color:#475569;margin:0 0 24px">Click the button below to sign in. It expires in 15 minutes and can only be used once.</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600" target="_blank" rel="noreferrer noopener">Sign in</a>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">Or copy this link: ${url}</p>
          <p style="color:#94a3b8;font-size:12px;margin:8px 0 0">If you didn\'t request this, you can ignore it.</p>
        </div>
      `
}

async function sendViaResend(dest: string, subject: string, html: string) {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — magic link not sent')
    return
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to: dest, subject, html })
    if (error) console.error('[email] resend error:', error)
    else console.log('[email] sent via resend:', data?.id, '→', dest)
  } catch (err) {
    console.error('[email] resend exception:', (err as Error).message)
  }
}

async function sendViaMaileroo(dest: string, subject: string, html: string) {
  if (!MAILEROO_KEY) {
    console.warn('[email] MAILEROO_SENDING_KEY not set — magic link not sent')
    return
  }
  // "Name <addr>" -> { display_name, address }; bare addr -> { address }
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(FROM)
  const from = m ? { display_name: m[1], address: m[2] } : { address: FROM }
  try {
    const res = await fetch(MAILEROO_URL, {
      method: 'POST',
      headers: { 'X-API-Key': MAILEROO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [{ address: dest }], subject, html }),
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok || !body?.success) {
      console.error('[email] maileroo error:', res.status, body?.message ?? body)
    } else {
      console.log('[email] sent via maileroo:', body?.data?.reference_id, '→', dest)
    }
  } catch (err) {
    console.error('[email] maileroo exception:', (err as Error).message)
  }
}

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url  = `${base}/auth/verify?token=${token}`
  const dest = OVERRIDE ?? to
  const subject = 'Your aH-Ha sign-in link'
  const html = magicLinkHtml(url)

  if (PROVIDER === 'maileroo') {
    await sendViaMaileroo(dest, subject, html)
  } else {
    await sendViaResend(dest, subject, html)
  }
}
