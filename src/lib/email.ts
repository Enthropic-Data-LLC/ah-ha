import nodemailer from 'nodemailer'

const FROM = process.env['EMAIL_FROM'] ?? 'noreply@smbaiguy.com'
const OVERRIDE = process.env['EMAIL_OVERRIDE']

const transporter = nodemailer.createTransport({
  host: process.env['SMTP_HOST'] ?? 'smtp.migadu.com',
  port: parseInt(process.env['SMTP_PORT'] ?? '465', 10),
  secure: (process.env['SMTP_PORT'] ?? '465') === '465',
  auth: {
    user: process.env['SMTP_USER'],
    pass: process.env['SMTP_PASS'],
  },
})

export async function sendMagicLink(to: string, token: string) {
  const base = process.env['BASE_URL'] ?? 'https://ah-ha.app'
  const url = `${base}/auth/verify?token=${token}`
  const dest = OVERRIDE ?? to

  if (!process.env['SMTP_USER'] || !process.env['SMTP_PASS']) {
    console.log(`[email] SMTP not configured — magic link for ${dest}: ${url}`)
    return
  }

  await transporter.sendMail({
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
