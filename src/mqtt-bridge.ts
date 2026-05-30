/**
 * MQTT Bridge — subscribes to broker topics and appends to Trail spaces.
 *
 * Canonical topics:
 *   aha/trail/{username}/{slug}     payload {text, tone?, tags?, meta?} or plain string
 *   aha/presence/{username}/state   payload {state: "home"|"away", location?}
 *
 * Mapped:  any topic pattern → Trail via mqtt_subscriptions collection
 *
 * Reloads subscriptions live on Redis pub/sub message: mqtt-bridge:reload
 */
import 'dotenv/config'
import mqtt from 'mqtt'
import { Redis } from 'ioredis'
import { MongoClient, type Db } from 'mongodb'

const BROKER_URL  = process.env['MQTT_BROKER_URL']
const API_KEY     = process.env['MQTT_BRIDGE_API_KEY']
const API_BASE    = `http://localhost:${process.env['PORT'] ?? 3100}`
const MONGO_URI   = process.env['MONGODB_URI']
const REDIS_URL   = process.env['REDIS_URL']

if (!BROKER_URL) { process.stderr.write('MQTT_BROKER_URL required\n'); process.exit(1) }
if (!API_KEY)    { process.stderr.write('MQTT_BRIDGE_API_KEY required\n'); process.exit(1) }
if (!MONGO_URI)  { process.stderr.write('MONGODB_URI required\n'); process.exit(1) }
if (!REDIS_URL)  { process.stderr.write('REDIS_URL required\n'); process.exit(1) }

interface Subscription {
  _id: string
  topic_pattern: string
  space_ref: string
  text_template: string
  tone_field: string | null
  tone_map: Record<string, string>
  default_tone: 'happy' | 'sorrow' | 'neutral'
  enabled: boolean
}

// ── Template engine ────────────────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): string {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return ''
    if (typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[p]
    } else if (Array.isArray(cur)) {
      cur = (cur as unknown[])[parseInt(p, 10)]
    } else {
      return String(cur)
    }
  }
  return cur === undefined || cur === null ? '' : JSON.stringify(cur).replace(/^"|"$/g, '')
}

function renderTemplate(template: string, payload: unknown, topicParts: string[]): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const e = expr.trim()
    if (e === 'ts') return new Date().toISOString()
    if (e.startsWith('topic.')) return topicParts[parseInt(e.slice(6), 10)] ?? ''
    if (e.startsWith('payload.')) return resolvePath(payload, e.slice(8))
    if (e === 'payload') return typeof payload === 'string' ? payload : JSON.stringify(payload)
    return resolvePath(payload, e)
  })
}

function resolveTone(
  payload: unknown,
  toneField: string | null,
  toneMap: Record<string, string>,
  defaultTone: string,
): 'happy' | 'sorrow' | 'neutral' {
  if (toneField && typeof payload === 'object' && payload !== null) {
    const raw = resolvePath(payload, toneField)
    const mapped = toneMap[raw] ?? toneMap['*']
    if (mapped === 'happy' || mapped === 'sorrow' || mapped === 'neutral') return mapped
  }
  return (defaultTone as 'happy' | 'sorrow' | 'neutral') ?? 'neutral'
}

// ── Trail append ───────────────────────────────────────────────────────────

async function appendToTrail(
  slug: string,
  body: { text: string; tone: string; tags?: string[]; meta?: Record<string, unknown>; source?: string },
) {
  const res = await fetch(`${API_BASE}/api/trail/${slug}/append`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'X-Aha-Source': 'mqtt',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Trail append failed ${res.status}: ${txt}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const mongoClient = new MongoClient(MONGO_URI!)
  await mongoClient.connect()
  const db: Db = mongoClient.db()

  // Redis pub client — for publishing presence events to notifier
  const redisPub = new Redis(REDIS_URL!)

  let subscriptions: Subscription[] = []

  async function loadSubscriptions() {
    const docs = await db.collection('mqtt_subscriptions')
      .find({ enabled: true })
      .toArray()
    subscriptions = docs.map(d => ({
      _id: d['_id'].toString(),
      topic_pattern: d['topic_pattern'] as string,
      space_ref: d['space_ref'] as string,
      text_template: d['text_template'] as string,
      tone_field: d['tone_field'] as string | null ?? null,
      tone_map: (d['tone_map'] as Record<string, string>) ?? {},
      default_tone: (d['default_tone'] as 'happy' | 'sorrow' | 'neutral') ?? 'neutral',
      enabled: true,
    }))
    console.log(`[mqtt-bridge] loaded ${subscriptions.length} subscription(s)`)
    return subscriptions
  }

  await loadSubscriptions()

  // Redis subscriber for live reload
  const redisSub = new Redis(REDIS_URL!)
  await redisSub.subscribe('mqtt-bridge:reload')
  redisSub.on('message', async (channel: string) => {
    if (channel === 'mqtt-bridge:reload') {
      await loadSubscriptions()
      resubscribe()
    }
  })

  // MQTT client
  const client = mqtt.connect(BROKER_URL!, {
    clientId: `ah-ha-bridge-${Date.now()}`,
    reconnectPeriod: 3000,
    keepalive: 30,
  })

  function resubscribe() {
    client.subscribe('aha/trail/+/+', { qos: 1 }, (err) => {
      if (err) console.error('[mqtt-bridge] subscribe error (canonical trail):', err)
    })
    client.subscribe('aha/presence/+/state', { qos: 1 }, (err) => {
      if (err) console.error('[mqtt-bridge] subscribe error (canonical presence):', err)
    })
    const patterns = [...new Set(subscriptions.map(s => s.topic_pattern))]
    for (const pattern of patterns) {
      client.subscribe(pattern, { qos: 1 }, (err) => {
        if (err) console.error(`[mqtt-bridge] subscribe error (${pattern}):`, err)
      })
    }
  }

  client.on('connect', () => {
    console.log('[mqtt-bridge] connected to', BROKER_URL)
    resubscribe()
  })

  client.on('reconnect', () => console.log('[mqtt-bridge] reconnecting…'))
  client.on('error', (err) => console.error('[mqtt-bridge] error:', err))

  client.on('message', async (topic: string, message: Buffer) => {
    const raw = message.toString()
    const topicParts = topic.split('/')

    // ── Canonical: aha/trail/{username}/{slug}
    const trailMatch = topic.match(/^aha\/trail\/([^/]+)\/([^/]+)$/)
    if (trailMatch) {
      const slug = trailMatch[2]!
      let parsed: { text?: string; tone?: string; tags?: string[]; meta?: Record<string, unknown> }
      try { parsed = JSON.parse(raw) } catch { parsed = { text: raw } }

      if (!parsed.text?.trim()) {
        console.warn(`[mqtt-bridge] canonical trail on ${topic} has no text, skipping`)
        return
      }
      try {
        await appendToTrail(slug, {
          text: parsed.text,
          tone: parsed.tone ?? 'neutral',
          tags: parsed.tags,
          meta: parsed.meta,
          source: 'mqtt',
        })
        console.log(`[mqtt-bridge] ✓ appended to trail/${slug} from ${topic}`)
      } catch (err) {
        console.error(`[mqtt-bridge] ✗ failed trail/${slug}:`, err)
      }
      return
    }

    // ── Canonical: aha/presence/{username}/state
    const presenceMatch = topic.match(/^aha\/presence\/([^/]+)\/state$/)
    if (presenceMatch) {
      const username = presenceMatch[1]!
      let parsed: { state?: string; location?: string }
      try { parsed = JSON.parse(raw) } catch { parsed = {} }

      const state = parsed.state === 'home' ? 'home' : parsed.state === 'away' ? 'away' : null
      if (!state) {
        console.warn(`[mqtt-bridge] presence on ${topic} missing valid state, skipping`)
        return
      }

      try {
        await redisPub.publish(
          `aha:presence:${username}`,
          JSON.stringify({ state, location: parsed.location, ts: new Date().toISOString() })
        )
        console.log(`[mqtt-bridge] ✓ presence ${username} → ${state}`)
      } catch (err) {
        console.error(`[mqtt-bridge] ✗ failed presence publish for ${username}:`, err)
      }
      return
    }

    // ── Mapped subscriptions
    let payload: unknown
    try { payload = JSON.parse(raw) } catch { payload = raw }

    for (const sub of subscriptions) {
      if (!mqttTopicMatches(sub.topic_pattern, topic)) continue

      const slug = sub.space_ref.split('/').pop()!
      const text = renderTemplate(sub.text_template, payload, topicParts)
      if (!text.trim()) {
        console.warn(`[mqtt-bridge] rendered empty text for sub ${sub._id}, skipping`)
        continue
      }
      const tone = resolveTone(payload, sub.tone_field, sub.tone_map, sub.default_tone)

      try {
        await appendToTrail(slug, { text, tone, source: 'mqtt', meta: { topic, sub_id: sub._id } })
        console.log(`[mqtt-bridge] ✓ mapped ${topic} → trail/${slug}`)
      } catch (err) {
        console.error(`[mqtt-bridge] ✗ failed mapped ${topic} → trail/${slug}:`, err)
      }
    }
  })

  process.on('SIGTERM', async () => {
    client.end()
    redisSub.disconnect()
    redisPub.disconnect()
    await mongoClient.close()
    process.exit(0)
  })
}

// MQTT topic pattern matching (supports + and #)
function mqttTopicMatches(pattern: string, topic: string): boolean {
  const patParts = pattern.split('/')
  const topParts = topic.split('/')
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === '#') return true
    if (i >= topParts.length) return false
    if (patParts[i] !== '+' && patParts[i] !== topParts[i]) return false
  }
  return patParts.length === topParts.length
}

main().catch(err => {
  console.error('[mqtt-bridge] fatal:', err)
  process.exit(1)
})
