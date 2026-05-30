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
    db.collection('board_cards').createIndex({ title: 'text', notes: 'text' }, { name: 'board_cards_text' }),
    db.collection('board_columns').createIndex({ space_id: 1, position: 1 }),
    db.collection('list_items').createIndex({ space_id: 1, org_id: 1 }),
    db.collection('list_items').createIndex({ title: 'text' }, { name: 'list_items_text' }),
    db.collection('note_content').createIndex({ space_id: 1, org_id: 1 }, { unique: true }),
    db.collection('note_content').createIndex({ body: 'text' }, { name: 'note_content_text' }),
    db.collection('api_keys').createIndex({ prefix: 1 }),
    db.collection('api_keys').createIndex({ user_id: 1, org_id: 1 }),
    db.collection('audit_log').createIndex({ seq: 1 }, { unique: true }),
    db.collection('audit_log').createIndex({ org_id: 1, ts: -1 }),
    db.collection('audit_log').createIndex({ org_id: 1, resource_ref: 1 }),
    db.collection('table_columns').createIndex({ space_id: 1, position: 1 }),
    db.collection('table_rows').createIndex({ space_id: 1, org_id: 1, position: 1 }),
    db.collection('mqtt_subscriptions').createIndex({ org_id: 1, enabled: 1 }),
    db.collection('mqtt_subscriptions').createIndex({ topic_pattern: 1 }),
    db.collection('notification_prefs').createIndex({ user_id: 1 }, { unique: true }),
    db.collection('notification_prefs').createIndex({ 'daily_briefing.enabled': 1 }),
    db.collection('webhooks').createIndex({ id: 1 }, { unique: true }),
    db.collection('webhooks').createIndex({ org_id: 1 }),
    db.collection('counters').createIndex({ _id: 1 }),
  ])
}

export default fp(dbPlugin, { name: 'db' })
