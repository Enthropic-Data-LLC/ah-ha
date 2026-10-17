import { ObjectId } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { initial } from './lexorank.js'

interface SeedCol { title: string; color: string; in_today?: boolean; today_priority?: number }

// Same shape POST /api/spaces auto-creates for a new board.
const BOARD_COLUMNS: SeedCol[] = [
  { title: 'To Do',       color: '#94a3b8' },
  { title: 'In Progress', color: '#818cf8', in_today: true, today_priority: 1 },
  { title: 'Done',        color: '#34d399' },
]

const GROCERY_ITEMS = ['Milk', 'Eggs', 'Bread', 'Coffee']
const EXAMPLE_CARDS = [
  'Add your own tasks here',
  'Drag a card between columns as it moves along',
  'Tap a card to add notes, a due date, or make it repeat',
]

/**
 * Give a brand-new user a non-empty workspace at onboarding: Home/Work/Groceries
 * place entities, a Groceries shopping list (items tagged to the Groceries place
 * so they surface there), and a Tasks board (To Do / In Progress / Done) with a
 * few example cards. Documents mirror exactly what the entity/list/board create
 * routes build. Best-effort: the caller runs it in try/catch so it never blocks
 * or fails onboarding.
 */
export async function seedStarterContent(
  fastify: FastifyInstance,
  opts: { userId: ObjectId; orgId: ObjectId; username: string },
): Promise<void> {
  const { userId, orgId, username } = opts
  const db = fastify.mongo
  const now = new Date()

  // --- entities: Home, Work, Groceries ---
  const entities = [
    { name: 'Home', icon: '🏠' },
    { name: 'Work', icon: '💼' },
    { name: 'Groceries', icon: '🛒' },
  ].map((e) => ({
    _id: new ObjectId(),
    name: e.name,
    icon: e.icon,
    entity_type: 'place' as const,
    color: '#818cf8',
    owner_id: userId,
    org_id: orgId,
    signatures: [] as unknown[],
    presence_token: new ObjectId().toHexString(),
    created_at: now,
    updated_at: now,
  }))
  await db.collection('entities').insertMany(entities)
  const groceriesEntityId = entities[2]!._id.toString()

  const makeSpace = (type: string, slug: string, name: string) => ({
    _id: new ObjectId(),
    ref: `${username}/${type}/${slug}`,
    slug,
    type,
    name,
    description: '',
    owner_id: userId,
    org_id: orgId,
    settings: {},
    pinned: false,
    created_at: now,
    updated_at: now,
  })

  // --- Groceries shopping list ---
  const listSpace = makeSpace('list', 'groceries', 'Groceries')
  await db.collection('spaces').insertOne(listSpace)
  const listBase = initial()
  await db.collection('list_items').insertMany(
    GROCERY_ITEMS.map((title, i) => ({
      _id: new ObjectId(),
      space_id: listSpace._id,
      org_id: orgId,
      title,
      done: false,
      done_at: null,
      due_at: null,
      contexts: [{ entity_id: groceriesEntityId, time_chunks: [] as string[] }],
      repeat: 'once',
      position: listBase + i,
      created_by: userId,
      created_at: now,
    })),
  )

  // --- Tasks board: default columns + example cards in To Do ---
  const boardSpace = makeSpace('board', 'tasks', 'Tasks')
  await db.collection('spaces').insertOne(boardSpace)
  const colBase = initial()
  const columns = BOARD_COLUMNS.map((col, i) => ({
    _id: new ObjectId(),
    space_id: boardSpace._id,
    org_id: orgId,
    title: col.title,
    color: col.color,
    ...(col.in_today !== undefined ? { in_today: col.in_today, today_priority: col.today_priority } : {}),
    position: colBase + i,
  }))
  await db.collection('board_columns').insertMany(columns)

  const todoCol = columns[0]!
  const cardBase = initial()
  await db.collection('board_cards').insertMany(
    EXAMPLE_CARDS.map((title, i) => {
      const id = new ObjectId()
      return {
        _id: id,
        ref: `${boardSpace.ref}#card_${id.toString()}`,
        space_id: boardSpace._id,
        org_id: orgId,
        column_id: todoCol._id,
        title,
        notes: '',
        priority: 'none',
        tags: [] as string[],
        color: '',
        position: cardBase + i,
        created_by: userId,
        updated_at: now,
        links: [] as unknown[],
        due_date: null,
        start_date: null,
        defer_until: null,
        recurrence: null,
      }
    }),
  )
}
