/**
 * Ah-Ha Notifier — daily briefing + presence-triggered notifications
 *
 * Delivery channels:
 *   - Node-RED webhook → Telegram (http://otto.local:1880/webhook/ah-ha-notify)
 *   - Email via SMTP (nodemailer)
 *
 * Triggers:
 *   - Daily briefing: cron-style check every minute against user's configured time
 *   - Presence: Redis pub/sub on aha:presence:{username}
 */
import 'dotenv/config'
import { Redis } from 'ioredis'
import { MongoClient, ObjectId, type Db } from 'mongodb'
import nodemailer from 'nodemailer'

const MONGO_URI      = process.env['MONGODB_URI']
const REDIS_URL      = process.env['REDIS_URL']
const API_BASE       = `http://localhost:${process.env['PORT'] ?? 3100}`
const BRIDGE_KEY     = process.env['MQTT_BRIDGE_API_KEY']
const NODERED_URL    = process.env['NODERED_URL'] ?? 'http://otto.local:1880'
const SMTP_HOST      = process.env['SMTP_HOST']
const SMTP_PORT      = parseInt(process.env['SMTP_PORT'] ?? '587', 10)
const SMTP_USER      = process.env['SMTP_USER']
const SMTP_PASS      = process.env['SMTP_PASS']
const EMAIL_FROM     = process.env['EMAIL_FROM'] ?? SMTP_USER

if (!MONGO_URI) { process.stderr.write('MONGODB_URI required\n'); process.exit(1) }
if (!REDIS_URL) { process.stderr.write('REDIS_URL required\n'); process.exit(1) }
if (!BRIDGE_KEY) { process.stderr.write('MQTT_BRIDGE_API_KEY required\n'); process.exit(1) }

// ── Email transport ────────────────────────────────────────────────────────

const mailer = SMTP_HOST ? nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
}) : null

async function sendEmail(to: string, subject: string, text: string) {
  if (!mailer) return
  try {
    await mailer.sendMail({ from: EMAIL_FROM, to, subject, text })
    console.log(`[notifier] email sent → ${to}`)
  } catch (err) {
    console.error(`[notifier] email error → ${to}:`, err)
  }
}

// ── Node-RED delivery ──────────────────────────────────────────────────────

async function postToNodeRed(type: string, username: string, data: unknown) {
  try {
    const res = await fetch(`${NODERED_URL}/webhook/ah-ha-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, username, data }),
    })
    if (!res.ok) console.error(`[notifier] node-red error: ${res.status}`)
    else console.log(`[notifier] node-red → ${type} for ${username}`)
  } catch (err) {
    console.error('[notifier] node-red unreachable:', err)
  }
}

// ── API helpers ────────────────────────────────────────────────────────────

async function fetchTrailSummary(slug: string, since = '24h') {
  try {
    const r = await fetch(`${API_BASE}/api/trail/${slug}/summary?since=${since}`, {
      headers: { 'Authorization': `Bearer ${BRIDGE_KEY}`, 'X-Aha-Source': 'mcp' },
    })
    if (!r.ok) return null
    const d = await r.json() as { data: { happy: number; sorrow: number; neutral: number; total: number; streaks: { current_tone: string; current_length: number; sorrows_since_last_happy: number } } }
    return d.data
  } catch { return null }
}

async function fetchTopCard(db: Db, orgId: string): Promise<{ title: string; column: string; board: string } | null> {
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 }
  const card = await db.collection('board_cards')
    .find({ org_id: new ObjectId(orgId), deleted_at: { $exists: false } })
    .sort({ priority: 1 })
    .limit(10)
    .toArray()

  if (!card.length) return null
  const sorted = card.sort((a, b) =>
    (PRIORITY_ORDER[a['priority'] as keyof typeof PRIORITY_ORDER] ?? 3) -
    (PRIORITY_ORDER[b['priority'] as keyof typeof PRIORITY_ORDER] ?? 3)
  )
  const top = sorted[0]!

  const col = await db.collection('board_columns').findOne({ _id: top['column_id'] })
  const space = await db.collection('spaces').findOne({ _id: top['space_id'] })

  return {
    title: top['title'] as string,
    column: (col?.['title'] as string) ?? '?',
    board: (space?.['name'] as string) ?? '?',
  }
}

// ── Message formatters ─────────────────────────────────────────────────────

function formatDailyBriefing(
  username: string,
  summary: Awaited<ReturnType<typeof fetchTrailSummary>>,
  topCard: { title: string; column: string; board: string } | null,
): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const lines = [`Good morning, @${username} ☀️`, `📅 ${date}`, '']

  if (summary) {
    lines.push(`📍 Trail (24h): ${summary.happy} happy · ${summary.sorrow} sorrow · ${summary.neutral} neutral`)
    const s = summary.streaks
    if (s.sorrows_since_last_happy > 1) {
      lines.push(`⚠️  ${s.sorrows_since_last_happy} sorrows since last happy`)
    } else if (s.current_tone === 'happy' && s.current_length >= 3) {
      lines.push(`✦  Happy streak — ${s.current_length} in a row`)
    }
    lines.push('')
  }

  if (topCard) {
    lines.push(`🎯 One thing today:`)
    lines.push(`   "${topCard.title}"`)
    lines.push(`   ${topCard.board} › ${topCard.column}`)
  } else {
    lines.push(`🎯 No open cards — clean slate today.`)
  }

  return lines.join('\n')
}

function formatPresenceMessage(
  username: string,
  state: 'home' | 'away',
  summary: Awaited<ReturnType<typeof fetchTrailSummary>>,
): string {
  if (state === 'home') {
    const lines = [`👋 Welcome home, @${username}`]
    if (summary && summary.total > 0) {
      lines.push(`Trail since you left: ${summary.total} entries — ${summary.happy} happy · ${summary.sorrow} sorrow`)
      if (summary.streaks.sorrows_since_last_happy > 1) {
        lines.push(`⚠️  ${summary.streaks.sorrows_since_last_happy} sorrows since last happy`)
      }
    } else {
      lines.push('Nothing logged while you were out.')
    }
    return lines.join('\n')
  } else {
    const lines = [`🚶 See you later, @${username}`]
    if (summary && summary.total > 0) {
      lines.push(`Today: ${summary.total} entries logged · last tone: ${summary.streaks.current_tone ?? 'none'}`)
    }
    return lines.join('\n')
  }
}

// ── Time helpers ───────────────────────────────────────────────────────────

function currentTimeInTz(timezone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date())
    const hour   = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10)
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
    return { hour, minute }
  } catch {
    return { hour: new Date().getUTCHours(), minute: new Date().getUTCMinutes() }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const mongoClient = new MongoClient(MONGO_URI!)
  await mongoClient.connect()
  const db = mongoClient.db()

  const redis    = new Redis(REDIS_URL!)
  const redisSub = new Redis(REDIS_URL!)

  // Track which users have received today's briefing (reset at midnight)
  const briefingSentToday = new Set<string>()
  let lastResetDay = new Date().getUTCDate()

  // ── Daily briefing cron (check every minute) ───────────────────────────
  async function checkBriefings() {
    const today = new Date().getUTCDate()
    if (today !== lastResetDay) {
      briefingSentToday.clear()
      lastResetDay = today
    }

    const prefs = await db.collection('notification_prefs')
      .find({ 'daily_briefing.enabled': true })
      .toArray()

    for (const pref of prefs) {
      const userId = pref['user_id']?.toString()
      if (!userId || briefingSentToday.has(userId)) continue

      const { time, timezone } = pref['daily_briefing'] as { time: string; timezone: string }
      const [targetHour, targetMinute] = time.split(':').map(Number)
      const { hour, minute } = currentTimeInTz(timezone ?? 'UTC')

      if (hour !== targetHour || minute !== targetMinute) continue

      briefingSentToday.add(userId)

      try {
        const user = await db.collection('users').findOne({ _id: pref['user_id'] })
        if (!user) continue

        // Find first trail space for this user
        const trailSpace = await db.collection('spaces').findOne({
          org_id: pref['org_id'], type: 'trail', deleted_at: { $exists: false }
        })

        const [summary, topCard] = await Promise.all([
          trailSpace ? fetchTrailSummary(trailSpace['slug'] as string) : null,
          fetchTopCard(db, pref['org_id']?.toString()),
        ])

        const message = formatDailyBriefing(user['username'] as string, summary, topCard)
        const channels = pref['channels'] as { telegram_chat_id?: string; email?: string }

        await postToNodeRed('daily_briefing', user['username'] as string, {
          message,
          telegram_chat_id: channels.telegram_chat_id,
        })

        if (channels.email) {
          await sendEmail(
            channels.email,
            `☀️ Daily briefing — ${new Date().toLocaleDateString()}`,
            message,
          )
        }
      } catch (err) {
        console.error(`[notifier] briefing error for user ${userId}:`, err)
      }
    }
  }

  setInterval(() => { checkBriefings().catch(console.error) }, 60_000)
  console.log('[notifier] daily briefing cron started')

  // ── Presence listener ──────────────────────────────────────────────────
  await redisSub.psubscribe('aha:presence:*')

  redisSub.on('pmessage', async (_pattern: string, channel: string, message: string) => {
    const username = channel.replace('aha:presence:', '')
    let state: 'home' | 'away'
    try {
      const parsed = JSON.parse(message) as { state: string }
      state = parsed.state === 'home' ? 'home' : 'away'
    } catch { return }

    console.log(`[notifier] presence event: ${username} → ${state}`)

    try {
      const user = await db.collection('users').findOne({ username })
      if (!user) return

      const pref = await db.collection('notification_prefs').findOne({ user_id: user._id })
      if (!pref) return

      const presence = pref['presence'] as { enabled: boolean; notify_on: string[] }
      if (!presence?.enabled || !presence.notify_on.includes(state)) return

      // Get trail summary since last presence event
      const lastKey = `aha:presence:last:${username}`
      const lastTs  = await redis.get(lastKey)
      await redis.set(lastKey, new Date().toISOString())

      const since = lastTs
        ? Math.round((Date.now() - new Date(lastTs).getTime()) / 3600000) + 'h'
        : '12h'

      const trailSpace = await db.collection('spaces').findOne({
        org_id: user._id, type: 'trail', deleted_at: { $exists: false }
      })
      const summary = trailSpace
        ? await fetchTrailSummary(trailSpace['slug'] as string, since)
        : null

      const message = formatPresenceMessage(username, state, summary)
      const channels = pref['channels'] as { telegram_chat_id?: string; email?: string }

      await postToNodeRed('presence', username, {
        message,
        state,
        telegram_chat_id: channels.telegram_chat_id,
      })

      if (channels.email) {
        const subject = state === 'home' ? `👋 Welcome home` : `🚶 See you later`
        await sendEmail(channels.email, subject, message)
      }
    } catch (err) {
      console.error(`[notifier] presence error for ${username}:`, err)
    }
  })

  console.log('[notifier] presence listener started')

  process.on('SIGTERM', async () => {
    clearInterval(undefined)
    redisSub.disconnect()
    redis.disconnect()
    await mongoClient.close()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('[notifier] fatal:', err)
  process.exit(1)
})
