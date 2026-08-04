import { Resend } from 'resend'

// Every one of these is read at call time, never at module load.
//
// tsup code-splits the shared email module into a chunk, and the emitted
// bundle hoists `import "./chunk-*.js"` ABOVE `import "dotenv/config"` —
// even though dotenv is the first import in api.ts and notifier.ts. Any
// process.env read at module scope therefore runs before .env is loaded and
// sees undefined. That silently disabled all magic-link email from the
// 2026-07-27 build until 2026-08-04: /auth/magic-link still returned
// {"ok":true}, it just never sent anything.
const FROM         = () => process.env['EMAIL_FROM'] ?? 'noreply@ah-ha.app'
const API_KEY      = () => process.env['RESEND_API_KEY'] ?? ''
const OVERRIDE     = () => process.env['EMAIL_OVERRIDE']

// Provider selection. Defaults to resend so the cutover is a single env flip
// (EMAIL_PROVIDER=maileroo) once ah-ha.app is DNS-verified in Maileroo.
const PROVIDER     = () => (process.env['EMAIL_PROVIDER'] ?? 'resend').toLowerCase()
const MAILEROO_KEY = () => process.env['MAILEROO_SENDING_KEY'] ?? ''
const MAILEROO_URL = 'https://smtp.maileroo.com/api/v2/emails'

let resendClient: Resend | null = null
function getResend(): Resend | null {
  if (!resendClient && API_KEY()) resendClient = new Resend(API_KEY())
  return resendClient
}

export interface MailBody {
  html?: string
  text?: string
}

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

async function sendViaResend(dest: string, subject: string, body: MailBody) {
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — message not sent')
    return
  }
  try {
    // Resend requires at least one of html/text; the notifier sends text-only.
    const payload = { from: FROM(), to: dest, subject, ...body } as Parameters<typeof resend.emails.send>[0]
    const { data, error } = await resend.emails.send(payload)
    if (error) console.error('[email] resend error:', error)
    else console.log('[email] sent via resend:', data?.id, '→', dest)
  } catch (err) {
    console.error('[email] resend exception:', (err as Error).message)
  }
}

async function sendViaMaileroo(dest: string, subject: string, body: MailBody) {
  const key = MAILEROO_KEY()
  if (!key) {
    console.warn('[email] MAILEROO_SENDING_KEY not set — message not sent')
    return
  }
  // "Name <addr>" -> { display_name, address }; bare addr -> { address }
  const fromRaw = FROM()
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(fromRaw)
  const from = m ? { display_name: m[1], address: m[2] } : { address: fromRaw }
  try {
    const res = await fetch(MAILEROO_URL, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [{ address: dest }],
        subject,
        ...(body.html ? { html: body.html } : {}),
        ...(body.text ? { plain: body.text } : {}),
      }),
    })
    const body_: any = await res.json().catch(() => ({}))
    if (!res.ok || !body_?.success) {
      console.error('[email] maileroo error:', res.status, body_?.message ?? body_)
    } else {
      console.log('[email] sent via maileroo:', body_?.data?.reference_id, '→', dest)
    }
  } catch (err) {
    console.error('[email] maileroo exception:', (err as Error).message)
  }
}

/**
 * Single outbound path for every ah-ha email. Honours EMAIL_PROVIDER and
 * EMAIL_OVERRIDE so auth mail and notifier mail can never drift onto
 * different providers again (the notifier held its own Migadu SMTP
 * transport until 2026-07-27).
 */
export async function sendMail(to: string, subject: string, body: MailBody) {
  const dest = OVERRIDE() ?? to
  if (!body.html && !body.text) {
    console.warn('[email] empty body — message not sent →', dest)
    return
  }
  if (PROVIDER() === 'maileroo') {
    await sendViaMaileroo(dest, subject, body)
  } else {
    await sendViaResend(dest, subject, body)
  }
}

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url  = `${base}/auth/verify?token=${token}`
  await sendMail(to, 'Your aH-Ha sign-in link', { html: magicLinkHtml(url) })
}
