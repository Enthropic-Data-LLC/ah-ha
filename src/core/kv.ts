import type { FastifyInstance } from 'fastify'

/**
 * Small cached values for a layer, under its own Redis namespace (`aha:<ns>:`), so a
 * layer keeps state without reaching into Redis keys that aren't its own.
 */
export function kvCore(fastify: FastifyInstance) {
  return (ns: string) => {
    const k = (key: string) => `aha:${ns}:${key}`
    return {
      get: (key: string) => fastify.redis.get(k(key)),
      set: (key: string, value: string, ttlSeconds: number) => fastify.redis.set(k(key), value, 'EX', ttlSeconds),
      incr: (key: string) => fastify.redis.incr(k(key)),
      expire: (key: string, ttlSeconds: number) => fastify.redis.expire(k(key), ttlSeconds),
    }
  }
}
