/**
 * Notifications go out through Node-RED's ah-ha-notify webhook, which routes to
 * Telegram / email from the user's notification prefs. Shared by the notifier and
 * Ah! Link's notify block.
 */
const NODERED_URL = process.env['NODERED_URL'] ?? 'http://otto.local:1880'

export async function postToNodeRed(type: string, username: string, data: unknown, log: (msg: string) => void = console.log): Promise<boolean> {
  // The Node-RED flow sends to a default chat when none is given, so a user with no Telegram
  // linked would have their message land in someone else's. No chat id, no delivery.
  const chatId = (data as { telegram_chat_id?: unknown } | null)?.telegram_chat_id
  if (!chatId) { log(`[node-red] skipped ${type} for ${username}: no Telegram chat linked`); return false }
  try {
    const res = await fetch(`${NODERED_URL}/webhook/ah-ha-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, username, data }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) { log(`[node-red] error ${res.status} for ${type}`); return false }
    log(`[node-red] → ${type} for ${username}`)
    return true
  } catch (err) {
    log(`[node-red] unreachable: ${String(err)}`)
    return false
  }
}
