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
  type: 'board' | 'trail' | 'note' | 'list' | 'table'
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

export type RecurrenceArchetype = 'habit' | 'schedule' | 'interval' | 'seasonal'

export interface Recurrence {
  archetype: RecurrenceArchetype
  // habit
  time_anchor?: 'morning' | 'midday' | 'evening' | 'night'
  streak_count?: number
  streak_best?: number
  // schedule
  day_of_week?: number      // 0=Sun
  day_of_month?: number
  context?: 'home' | 'away' | null
  // interval
  interval_days?: number
  last_completed_at?: string | null
  // shared
  completions?: number
  end_date?: string | null
  end_count?: number | null
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
  // dates
  due_date?: string | null
  start_date?: string | null
  defer_until?: string | null
  recurrence?: Recurrence | null
  // engine flags
  overdue_notified?: boolean
  escalated_day_1?: boolean
  escalated_day_3?: boolean
  escalated_day_7?: boolean
  // location+time context — each entry pairs a place with optional time windows
  // e.g. [{ entity_id: "abc", time_chunks: ["evening", "night"] }]
  // empty time_chunks means "any time at this place"
  contexts?: Array<{ entity_id: string; time_chunks: string[] }>
}

export interface LocationSignature {
  kind: 'gps' | 'network' | 'bluetooth_le'
  // gps
  lat?: number
  lng?: number
  radius_m?: number
  // network
  external_ip?: string
  // bluetooth_le
  local_name?: string
  uuid?: string
}

export interface Entity {
  _id: string
  name: string
  icon: string
  entity_type: 'place' | 'person'
  color: string
  signatures: LocationSignature[]
  presence_token: string
  created_at: string
  updated_at: string
}

export interface ListItem {
  _id: string
  title: string
  done: boolean
  done_at: string | null
  due_at: string | null
  defer_until?: string | null
  contexts?: Array<{ entity_id: string; time_chunks: string[] }>
}
