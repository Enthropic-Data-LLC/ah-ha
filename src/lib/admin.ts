// Admins are the emails in ADMIN_EMAILS (comma-separated). Read on each call, never at module
// load: the bundle runs module init before dotenv has filled process.env.
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const list = (process.env['ADMIN_EMAILS'] ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return list.includes(email.trim().toLowerCase())
}
