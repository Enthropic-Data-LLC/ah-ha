import pg from 'pg'

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env['TIMESCALE_URI'] })
  }
  return pool
}

export async function setupTrailSchema(): Promise<void> {
  const db = getPool()
  await db.query(`
    CREATE TABLE IF NOT EXISTS trail_entries (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      space_ref   TEXT NOT NULL,
      org_id      UUID NOT NULL,
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      text        TEXT NOT NULL,
      tone        VARCHAR(10) NOT NULL DEFAULT 'neutral'
                    CHECK (tone IN ('happy', 'sorrow', 'neutral')),
      source      VARCHAR(100) NOT NULL DEFAULT 'manual',
      tags        TEXT[] NOT NULL DEFAULT '{}',
      meta        JSONB NOT NULL DEFAULT '{}',
      created_by  UUID
    )
  `)

  // Create hypertable if not already one
  await db.query(`
    SELECT create_hypertable('trail_entries', 'ts', if_not_exists => TRUE)
  `).catch(() => {
    // create_hypertable not available (plain PG) — skip, table still works
  })

  await db.query(`
    CREATE INDEX IF NOT EXISTS trail_entries_space_ts ON trail_entries (space_ref, ts DESC)
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS trail_entries_org_ts ON trail_entries (org_id, ts DESC)
  `)
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = null
}
