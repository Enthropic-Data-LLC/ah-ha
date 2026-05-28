import { SignJWT, jwtVerify } from 'jose'
import { ObjectId } from 'mongodb'
import type { Plan } from '../types.js'

const secret = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production'
)

interface JWTPayload {
  id: ObjectId
  orgId: ObjectId
  plan: Plan
  username: string
}

export async function signJWT(payload: JWTPayload): Promise<string> {
  return new SignJWT({
    sub: payload.id.toString(),
    orgId: payload.orgId.toString(),
    plan: payload.plan,
    username: payload.username,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret)
  return {
    id: new ObjectId(payload['sub'] as string),
    orgId: new ObjectId(payload['orgId'] as string),
    plan: payload['plan'] as Plan,
    username: payload['username'] as string,
  }
}
