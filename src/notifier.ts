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

function formatIntervalNudge(title: string, daysSince: number, intervalDays: number): string {
  const RELATION_WORDS = ['call', 'text', 'reach out', 'catch up', 'connect', 'check in', 'visit', 'message']
  const isRelationship = RELATION_WORDS.some(w => title.toLowerCase().includes(w))
  const when = daysSince === 1 ? 'yesterday' : `${daysSince} days ago`
  if (isRelationship) {
    return `💙 It's been ${daysSince} days — "${title}". (~every ${intervalDays}d)`
  }
  return `🔔 It's been a while: "${title}" — last done ${when}. (~every ${intervalDays}d)`
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


  // ── Date engine (runs every 5 minutes) ────────────────────────────────
  async function runDateEngine() {
    const now = new Date()
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999)

    // 1. Cards due today — notify once per day (checked every 5 min)
    const dueToday = await db.collection('board_cards').find({
      done: { $ne: true },
      deleted_at: { $exists: false },
      due_date: { $gte: todayStart, $lte: todayEnd },
      due_today_notified: { $ne: true },
    }).toArray()

    for (const card of dueToday) {
      const user = await db.collection('users').findOne({ _id: card['created_by'] })
      if (!user) continue
      const pref = await db.collection('notification_prefs').findOne({ user_id: user._id })
      const channels = (pref?.['channels'] as { telegram_chat_id?: string; email?: string } | undefined) ?? {}
      if (!channels.telegram_chat_id && !channels.email) continue

      const msg = `📋 Due today: ${card['title'] as string}`
      await postToNodeRed('date_engine', user['username'] as string, { message: msg, telegram_chat_id: channels.telegram_chat_id })
      if (channels.email) await sendEmail(channels.email, `Due today: ${card['title'] as string}`, msg)

      await db.collection('board_cards').updateOne({ _id: card['_id'] }, { $set: { due_today_notified: true } })
    }

    // 2. Newly overdue cards (due before today, not done, not yet flagged)
    const newlyOverdue = await db.collection('board_cards').find({
      done: { $ne: true },
      deleted_at: { $exists: false },
      due_date: { $lt: todayStart },
      overdue_notified: { $ne: true },
    }).toArray()

    for (const card of newlyOverdue) {
      const user = await db.collection('users').findOne({ _id: card['created_by'] })
      if (!user) continue
      const pref = await db.collection('notification_prefs').findOne({ user_id: user._id })
      const channels = (pref?.['channels'] as { telegram_chat_id?: string; email?: string } | undefined) ?? {}

      const daysOver = Math.floor((now.getTime() - (card['due_date'] as Date).getTime()) / 86400000)
      const msg = `⏰ Still on your list: "${card['title'] as string}" — ${daysOver > 1 ? daysOver + ' days since the target date' : 'since yesterday'}`

      if (channels.telegram_chat_id || channels.email) {
        await postToNodeRed('date_engine', user['username'] as string, { message: msg, telegram_chat_id: channels.telegram_chat_id })
        if (channels.email) await sendEmail(channels.email, `Still on your list: ${card['title'] as string}`, msg)
      }
      await db.collection('board_cards').updateOne({ _id: card['_id'] }, { $set: { overdue_notified: true } })
    }

    // 3. Escalation — day 3 and day 7
    for (const level of [{ days: 3, flag: 'escalated_day_3' }, { days: 7, flag: 'escalated_day_7' }] as const) {
      const cutoff = new Date(now.getTime() - level.days * 86400000)
      const escalating = await db.collection('board_cards').find({
        done: { $ne: true },
        deleted_at: { $exists: false },
        due_date: { $lt: cutoff },
        [level.flag]: { $ne: true },
      }).toArray()

      for (const card of escalating) {
        const user = await db.collection('users').findOne({ _id: card['created_by'] })
        if (!user) continue
        const pref = await db.collection('notification_prefs').findOne({ user_id: user._id })
        const channels = (pref?.['channels'] as { telegram_chat_id?: string; email?: string } | undefined) ?? {}

        const suffix = level.days === 7
          ? '\n\nThis one has been sitting a week — still relevant? No shame in letting it go.'
          : ''
        const msg = `📌 Still waiting on you: "${card['title'] as string}" — ${level.days} days since the target${suffix}`

        if (channels.telegram_chat_id || channels.email) {
          await postToNodeRed('date_engine', user['username'] as string, { message: msg, telegram_chat_id: channels.telegram_chat_id })
          if (channels.email) await sendEmail(channels.email, `Still waiting: ${card['title'] as string}`, msg)
        }
        await db.collection('board_cards').updateOne({ _id: card['_id'] }, { $set: { [level.flag]: true } })
      }
    }

    // 4. Resurface deferred cards (defer_until just expired in last 5 min)
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000)
    const resurfacing = await db.collection('board_cards').find({
      done: { $ne: true },
      deleted_at: { $exists: false },
      defer_until: { $gte: fiveMinAgo, $lte: now },
    }).toArray()

    for (const card of resurfacing) {
      await redis.publish(`ws:${card['ref'] as string}`.split('#')[0]!, JSON.stringify({
        op: 'card.resurfaced', ref: card['ref'], title: card['title'],
      }))
    }

    // 5. Habit streak maintenance — miss detection
    const midnightCutoff = new Date(now)
    midnightCutoff.setHours(0, 0, 0, 0)

    const habitCards = await db.collection('board_cards').find({
      done: { $ne: true },
      deleted_at: { $exists: false },
      'recurrence.archetype': 'habit',
      'recurrence.streak_count': { $gt: 0 },
    }).toArray()

    for (const card of habitCards) {
      const rec = card['recurrence'] as { archetype: string; last_completed_at?: Date; streak_count?: number }
      if (!rec.last_completed_at) continue
      const lastDone = new Date(rec.last_completed_at)
      const daysSince = Math.floor((midnightCutoff.getTime() - lastDone.getTime()) / 86400000)
      if (daysSince > 1) {
        // Streak broken — reset
        await db.collection('board_cards').updateOne(
          { _id: card['_id'] },
          { $set: { 'recurrence.streak_count': 0 } }
        )
        console.log(`[date-engine] streak reset for: ${card['title'] as string}`)
      }
    }

    // 6. Interval nudge notifications (warm tone, once per cycle)
    type IntervalRec = { interval_days?: number; last_completed_at?: Date | string | null }
    const intervalCandidates = await db.collection('board_cards').find({
      done: { $ne: true },
      deleted_at: { $exists: false },
      'recurrence.archetype': { $in: ['interval', 'seasonal'] },
      interval_notified: { $ne: true },
    }).toArray()

    let nudgesSent = 0
    for (const card of intervalCandidates) {
      const rec = card['recurrence'] as IntervalRec | undefined
      if (!rec?.interval_days) continue
      const base = rec.last_completed_at
        ? new Date(rec.last_completed_at)
        : new Date(card['created_at'] as Date)
      const daysSince = Math.floor((now.getTime() - base.getTime()) / 86400000)
      if (daysSince < rec.interval_days * 0.8) continue

      // Always mark so we don't recheck every 5 min even if user has no prefs
      await db.collection('board_cards').updateOne({ _id: card['_id'] }, { $set: { interval_notified: true } })

      const user = await db.collection('users').findOne({ _id: card['created_by'] })
      if (!user) continue
      const pref = await db.collection('notification_prefs').findOne({ user_id: user._id })
      const channels = (pref?.['channels'] as { telegram_chat_id?: string; email?: string } | undefined) ?? {}
      if (!channels.telegram_chat_id && !channels.email) continue

      const msg = formatIntervalNudge(card['title'] as string, daysSince, rec.interval_days)
      await postToNodeRed('interval_nudge', user['username'] as string, { message: msg, telegram_chat_id: channels.telegram_chat_id })
      if (channels.email) await sendEmail(channels.email, `Gentle nudge: ${card['title'] as string}`, msg)
      nudgesSent++
    }

    if (dueToday.length + newlyOverdue.length + resurfacing.length + nudgesSent > 0) {
      console.log(`[date-engine] processed: ${dueToday.length} due today, ${newlyOverdue.length} newly overdue, ${resurfacing.length} resurfaced, ${nudgesSent} nudges sent`)
    }
  }

  setInterval(() => { runDateEngine().catch(console.error) }, 5 * 60_000)
  console.log('[notifier] date engine started')

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
