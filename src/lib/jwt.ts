import { SignJWT, jwtVerify } from 'jose'
import { ObjectId } from 'mongodb'
import type { Plan } from '../types.js'

// Resolve the secret lazily, NOT at module load: tsup/esbuild bundles every
// module's top-level code into one file and can run it before the entrypoint's
// `import 'dotenv/config'` side effect populates process.env, so a module-load
// read sees no JWT_SECRET (see incident_ahha_dotenv_bundler_hoisting). Reading on
// first use — after env is loaded — keeps the fail-closed check without crashing
// startup, and still never falls back to a literal/default secret.
let secretCache: Uint8Array | null = null
function secret(): Uint8Array {
  if (secretCache) return secretCache
  const rawSecret = process.env['JWT_SECRET']
  if (!rawSecret || rawSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters')
  }
  secretCache = new TextEncoder().encode(rawSecret)
  return secretCache
}

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
    .sign(secret())
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  // Pin the algorithm so a token with alg:none or a different alg cannot be
  // substituted (CWE-345), and validate the id claims before constructing
  // ObjectIds so a malformed token fails as an auth error, not a 500 (CWE-20).
  const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
  const sub = payload['sub']
  const orgId = payload['orgId']
  if (typeof sub !== 'string' || !ObjectId.isValid(sub) ||
      typeof orgId !== 'string' || !ObjectId.isValid(orgId)) {
    throw new Error('invalid token claims')
  }
  return {
    id: new ObjectId(sub),
    orgId: new ObjectId(orgId),
    plan: payload['plan'] as Plan,
    username: payload['username'] as string,
  }
}
