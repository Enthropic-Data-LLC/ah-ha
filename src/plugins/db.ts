import fp from 'fastify-plugin'
import { MongoClient, type Db } from 'mongodb'
import type { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    mongo: Db
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const uri = process.env['MONGODB_URI']
  if (!uri) throw new Error('MONGODB_URI required')

  const client = new MongoClient(uri)
  await client.connect()

  const db = client.db()

  await ensureIndexes(db)

  fastify.decorate('mongo', db)

  fastify.addHook('onClose', async () => {
    await client.close()
  })
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('spaces').createIndex({ ref: 1 }, { unique: true }),
    db.collection('spaces').createIndex({ owner_id: 1, org_id: 1 }),
    db.collection('spaces').createIndex({ org_id: 1, type: 1 }),
    db.collection('board_cards').createIndex({ space_id: 1, org_id: 1, column_id: 1, position: 1 }),
    db.collection('board_cards').createIndex({ ref: 1 }, { unique: true }),
    db.collection('board_columns').createIndex({ space_id: 1, position: 1 }),
    db.collection('api_keys').createIndex({ prefix: 1 }),
    db.collection('api_keys').createIndex({ user_id: 1, org_id: 1 }),
    db.collection('audit_log').createIndex({ seq: 1 }, { unique: true }),
    db.collection('audit_log').createIndex({ org_id: 1, ts: -1 }),
    db.collection('table_columns').createIndex({ space_id: 1, position: 1 }),
    db.collection('table_rows').createIndex({ space_id: 1, org_id: 1, position: 1 }),
    db.collection('mqtt_subscriptions').createIndex({ org_id: 1, enabled: 1 }),
    db.collection('mqtt_subscriptions').createIndex({ topic_pattern: 1 }),
  ])
}

export default fp(dbPlugin, { name: 'db' })
