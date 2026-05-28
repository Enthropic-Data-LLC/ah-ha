export interface User {
  id: string
  username: string
  email: string
  plan: 'free' | 'pro' | 'team'
  orgId: string
}

export interface Space {
  _id: string
  ref: string
  slug: string
  name: string
  type: 'board' | 'trail' | 'note' | 'list'
  description?: string
  created_at: string
}

export interface BoardColumn {
  _id: string
  title: string
  color: string
  position: number
  space_id: string
}

export interface BoardCard {
  _id: string
  ref: string
  title: string
  notes: string
  priority: 'none' | 'low' | 'medium' | 'high'
  tags: string[]
  color: string
  position: number
  column_id: string
  updated_at: string
  created_by: string
}
