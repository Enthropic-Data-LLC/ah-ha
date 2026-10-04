/**
 * Notifications go out through Node-RED's ah-ha-notify webhook, which routes to
 * Telegram / email from the user's notification prefs. Shared by the notifier and
 * Ah! Link's notify block.
 */
const NODERED_URL = process.env['NODERED_URL'] ?? 'http://otto.local:1880'

export async function postToNodeRed(type: string, username: string, data: unknown, log: (msg: string) => void = console.log): Promise<boolean> {
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
