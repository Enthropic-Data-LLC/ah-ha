import { ObjectId } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { initial } from './lexorank.js'
import { startOfDay } from './repeat.js'
import { DEFAULT_BOARD_COLUMNS } from '../routes/spaces.js'

interface SeedCard { title: string; notes?: string; column: 'To Do' | 'In Progress'; due?: { day: number; hour: number } }

// Each card does one job on day one: the dated ones and the In Progress one fill Ah! Today,
// and every one of them teaches a single move.
const EXAMPLE_CARDS: SeedCard[] = [
  { title: 'Make Ah-Ha yours', column: 'In Progress',
    notes: 'Rename, delete or add spaces until this fits how you work. Cards in In Progress show on Ah! Today.' },
  { title: 'Move this card to Done once you\'ve read it', column: 'To Do', due: { day: 0, hour: 17 },
    notes: 'Cards due today show on Ah! Today. Drag this one to Done here, or tick it off from Ah! Today.' },
  { title: 'Add a task of your own, with a due date', column: 'To Do', due: { day: 1, hour: 12 } },
  { title: 'Tap a card to add notes, or make it repeat', column: 'To Do' },
]

const SHOPPING_ITEMS = ['Milk', 'Eggs', 'Bananas', 'This list comes up when you check in at Groceries. Tag any item to a place']

const START_HERE = `Welcome to Ah-Ha.

Ah! Today is your home screen. It shows what's overdue, what's due today, what's in progress, and what's tagged to where you are, a little at a time.

Spaces hold everything else:
- Boards: tasks that move through columns (To Do, In Progress, Done).
- Lists: quick checklists. Tag an item to a place and it comes up when you check in there.
- Notes: free text, like this one.
- Trails: a journal you can only add to. Each entry is linked to the one before it.
- Tables: rows and columns, like a small spreadsheet.

Android: get the app at ah-ha.app/android.
Your data: open the menu and choose Your data to see what you're using, or to download everything as one file.
Feedback: open the menu and choose Send feedback.

The Tasks board, the Shopping list, this note and the Home and Groceries places are examples. Delete them one at a time, or use Clear examples on Spaces.
`

/**
 * Give a brand-new user a workspace that already works at onboarding: Home and Groceries
 * places, a Shopping list (items tagged to Groceries so they surface there), a Tasks board
 * whose cards fill Ah! Today on day one, and a Start here note. Every document is marked
 * `example: true` so POST /api/examples/clear can remove what the user hasn't taken over.
 * Due times are local to [tz]. Documents mirror what the entity/list/board/note create
 * routes build. Anything the account already has is skipped (a space whose ref exists, even
 * deleted; a place with the same name, which is reused for tagging), so it is safe to run on
 * an existing account. Best-effort: the caller runs it in try/catch so it never blocks onboarding.
 */
export async function seedStarterContent(
  fastify: FastifyInstance,
  opts: { userId: ObjectId; orgId: ObjectId; username: string; tz: string },
): Promise<void> {
  const { userId, orgId, username, tz } = opts
  const db = fastify.mongo
  const now = new Date()
  const midnight = startOfDay(tz, now)
  // Calendar days are 24h apart except across a DST change, where this is off by an hour. Fine for examples.
  const localAt = (day: number, hour: number) => new Date(midnight.getTime() + (day * 24 + hour) * 3600000)

  // --- entities: Home, Groceries ---
  const placeNamed = (name: string) => db.collection('entities').findOne(
    { org_id: orgId, name: { $regex: `^${name}$`, $options: 'i' }, deleted_at: { $exists: false } })
  const existingGroceries = await placeNamed('Groceries')
  const entities = (await Promise.all([
    { name: 'Home', icon: '🏠' },
    { name: 'Groceries', icon: '🛒' },
  ].map(async e => (await placeNamed(e.name)) ? null : e))).filter(e => e !== null).map((e) => ({
    _id: new ObjectId(),
    name: e.name,
    icon: e.icon,
    entity_type: 'place' as const,
    color: '#818cf8',
    owner_id: userId,
    org_id: orgId,
    signatures: [] as unknown[],
    presence_token: new ObjectId().toHexString(),
    example: true,
    created_at: now,
    updated_at: now,
  }))
  if (entities.length) await db.collection('entities').insertMany(entities)
  const groceriesEntityId = String(existingGroceries?._id ?? entities.find(e => e.name === 'Groceries')!._id)
  const taken = async (ref: string) => !!(await db.collection('spaces').findOne({ ref }, { projection: { _id: 1 } }))

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
    example: true,
    created_at: now,
    updated_at: now,
  })

  // --- Start here note ---
  const noteSpace = makeSpace('note', 'start-here', 'Start here')
  if (!await taken(noteSpace.ref)) {
    await db.collection('spaces').insertOne(noteSpace)
    await db.collection('note_content').insertOne({
      _id: new ObjectId(), space_id: noteSpace._id, org_id: orgId, body: START_HERE, example: true, updated_at: now,
    })
  }

  // --- Shopping list ---
  const listSpace = makeSpace('list', 'shopping', 'Shopping')
  if (!await taken(listSpace.ref)) {
    await db.collection('spaces').insertOne(listSpace)
    const listBase = initial()
    await db.collection('list_items').insertMany(
      SHOPPING_ITEMS.map((title, i) => ({
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
        example: true,
        created_at: now,
      })),
    )
  }

  // --- Tasks board: default columns + example cards ---
  const boardSpace = makeSpace('board', 'tasks', 'Tasks')
  if (await taken(boardSpace.ref)) return
  await db.collection('spaces').insertOne(boardSpace)
  const colBase = initial()
  const columns = DEFAULT_BOARD_COLUMNS.map((col, i) => ({
    _id: new ObjectId(),
    space_id: boardSpace._id,
    org_id: orgId,
    ...col,
    position: colBase + i,
    created_at: now,
  }))
  await db.collection('board_columns').insertMany(columns)

  const columnId = (title: string) => columns.find(c => c.title === title)!._id
  const cardBase = initial()
  await db.collection('board_cards').insertMany(
    EXAMPLE_CARDS.map((card, i) => {
      const id = new ObjectId()
      return {
        _id: id,
        ref: `${boardSpace.ref}#card_${id.toString()}`,
        space_id: boardSpace._id,
        org_id: orgId,
        column_id: columnId(card.column),
        title: card.title,
        notes: card.notes ?? '',
        priority: 'none',
        tags: [] as string[],
        color: '',
        position: cardBase + i,
        created_by: userId,
        updated_at: now,
        links: [] as unknown[],
        due_date: card.due ? localAt(card.due.day, card.due.hour) : null,
        start_date: null,
        defer_until: null,
        recurrence: null,
        example: true,
      }
    }),
  )
}
