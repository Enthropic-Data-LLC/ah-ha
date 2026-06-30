import FormData from 'form-data'
import Mailgun from 'mailgun.js'

const FROM     = process.env['EMAIL_FROM'] ?? 'noreply@ah-ha.app'
const API_KEY  = process.env['MAILGUN_API_KEY'] ?? ''
const DOMAIN   = process.env['MAILGUN_DOMAIN'] ?? 'ah-ha.app'
const OVERRIDE = process.env['EMAIL_OVERRIDE']

const mg = API_KEY
  ? new Mailgun(FormData).client({ username: 'api', key: API_KEY })
  : null

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url  = `${base}/auth/verify?token=${token}`
  const dest = OVERRIDE ?? to

  if (!mg) {
    console.warn('[email] MAILGUN_API_KEY not set — magic link not sent')
    return
  }

  try {
    const result = await mg.messages.create(DOMAIN, {
      from: FROM,
      to: dest,
      subject: 'Your aH-Ha sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1e293b">Sign in to aH-Ha</h2>
          <p style="color:#475569;margin:0 0 24px">Click the button below to sign in. It expires in 15 minutes and can only be used once.</p>
          <a href="${url}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600" target="_blank" rel="noreferrer noopener">Sign in</a>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0">Or copy this link: ${url}</p>
          <p style="color:#94a3b8;font-size:12px;margin:8px 0 0">If you didn't request this, you can ignore it.</p>
        </div>
      `,
    })
    console.log('[email] sent via mailgun:', result.id, '→', dest)
  } catch (err) {
    console.error('[email] mailgun error:', (err as Error).message)
  }
}
