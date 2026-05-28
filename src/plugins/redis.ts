import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import type { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const url = process.env['REDIS_URL']
  if (!url) throw new Error('REDIS_URL required')

  const redis = new Redis(url, { lazyConnect: true })
  await redis.connect()

  fastify.decorate('redis', redis)

  fastify.addHook('onClose', async () => {
    await redis.quit()
  })
}

export default fp(redisPlugin, { name: 'redis' })
