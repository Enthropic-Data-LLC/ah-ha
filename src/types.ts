import type { ObjectId } from 'mongodb'

export type Plan = 'free' | 'pro' | 'team' | 'iot' | 'enterprise'
export type SpaceType = 'board' | 'note' | 'list' | 'trail' | 'table' | 'canvas' | 'gauge' | 'doc'
export type Tone = 'happy' | 'sorrow' | 'neutral'
export type ActorType = 'user' | 'apikey' | 'mcp'
export type LinkType = 'caused-by' | 'resolved-by' | 'documented-in' | 'depends-on' | 'triggered' | 'references' | 'related-to'

export interface User {
  _id: ObjectId
  username: string
  email: string
  plan: Plan
  created_at: Date
  last_seen: Date
  onboarding_completed: boolean
  settings: {
    timezone: string
    notifications: Record<string, unknown>
  }
  llm?: {
    provider: 'anthropic' | 'openai' | 'ollama' | 'custom'
    base_url?: string
    api_key_enc?: string
    model: string
  }
}

export interface Space {
  _id: ObjectId
  ref: string           // "david/board/sprint-12"
  slug: string
  type: SpaceType
  name: string
  owner_id: ObjectId
  org_id: ObjectId
  settings: Record<string, unknown>
  pinned: boolean
  created_at: Date
  updated_at: Date
  deleted_at?: Date
}

export interface BoardCard {
  _id: ObjectId
  ref: string           // "david/board/sprint-12#card_89"
  space_id: ObjectId
  org_id: ObjectId
  column_id: ObjectId
  title: string
  notes: string
  priority: 'none' | 'low' | 'medium' | 'high'
  tags: string[]
  color: string
  position: number      // Lexorank float
  created_by: ObjectId
  updated_at: Date
  deleted_at?: Date
  links: Array<{
    ref: string
    type: LinkType
    created_at: Date
    created_by: ObjectId | null
  }>
}

export interface BoardColumn {
  _id: ObjectId
  space_id: ObjectId
  org_id: ObjectId
  title: string
  color: string
  position: number
  created_at: Date
  deleted_at?: Date
}

export interface ApiKey {
  _id: ObjectId
  name: string
  hash: string
  prefix: string        // "aha_live_4xkQ..." display only
  org_id: ObjectId
  user_id: ObjectId
  scope: 'all' | string
  access: 'read' | 'write'
  expires_at: Date | null
  last_used: Date | null
  created_at: Date
  revoked_at?: Date
}

export interface AuditEntry {
  _id: ObjectId
  seq: number
  ts: Date
  actor_id: ObjectId
  actor_type: ActorType
  action: string
  resource_ref: string
  org_id: ObjectId
  ip: string
  prev_hash: string
  hash: string
}

// Fastify request augmentation
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: ObjectId
      orgId: ObjectId
      plan: Plan
      username: string
    }
    apiKeyId?: ObjectId
  }
}
