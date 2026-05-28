import { Resend } from 'resend'

const resend = new Resend(process.env['RESEND_API_KEY'])
const FROM = process.env['EMAIL_FROM'] ?? 'noreply@ah-ha.app'
const OVERRIDE = process.env['EMAIL_OVERRIDE']

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url = `${base}/auth/verify?token=${token}`
  const dest = OVERRIDE ?? to

  await resend.emails.send({
    from: FROM,
    to: dest,
    subject: 'Your Ah-Ha sign-in link',
    html: `
      <p>Click the link below to sign in. It expires in 15 minutes and can only be used once.</p>
      <p><a href="${url}">${url}</a></p>
      <p style="color:#999;font-size:12px">If you didn't request this, you can ignore it.</p>
    `,
  })
}
