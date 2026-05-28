/**
 * WebSocket server — Phase 1 Week 3-4 implementation
 * Clients connect to ws://host:3001/:spaceRef
 * Auth via session cookie on upgrade handshake
 * Receives ops from Redis pub/sub, broadcasts to room members
 */
import 'dotenv/config'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Redis } from 'ioredis'
import { verifyJWT } from './lib/jwt.js'

const PORT = parseInt(process.env['WS_PORT'] ?? '3001', 10)
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'

const wss = new WebSocketServer({ port: PORT })
const pub = new Redis(REDIS_URL)
const sub = new Redis(REDIS_URL)

// room → set of WebSocket clients
const rooms = new Map<string, Set<WebSocket>>()

sub.psubscribe('ws:*', (err: Error | null) => {
  if (err) console.error('Redis psubscribe error', err)
})

sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
  const spaceRef = channel.replace('ws:', '')
  const members = rooms.get(spaceRef)
  if (!members) return
  for (const ws of members) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message)
  }
})

wss.on('connection', async (ws, req: IncomingMessage) => {
  // Extract spaceRef from URL path
  const spaceRef = req.url?.slice(1)?.replace(/%2F/g, '/') ?? ''
  if (!spaceRef) return ws.close(1008, 'Missing space ref')

  // Auth via cookie
  const cookieHeader = req.headers['cookie'] ?? ''
  const token = cookieHeader.match(/aha_session=([^;]+)/)?.[1]

  if (token) {
    const user = await verifyJWT(token).catch(() => null)
    if (!user) return ws.close(1008, 'Unauthorized')
  } else {
    return ws.close(1008, 'Unauthorized')
  }

  // Join room
  if (!rooms.has(spaceRef)) rooms.set(spaceRef, new Set())
  rooms.get(spaceRef)!.add(ws)

  ws.on('close', () => {
    rooms.get(spaceRef)?.delete(ws)
    if (rooms.get(spaceRef)?.size === 0) rooms.delete(spaceRef)
  })

  ws.send(JSON.stringify({ op: 'connected', spaceRef }))
})

console.log(`WS server listening on :${PORT}`)

// Exported for use by API routes to publish operations
export async function publishOp(spaceRef: string, op: Record<string, unknown>) {
  await pub.publish(`ws:${spaceRef}`, JSON.stringify(op))
}
