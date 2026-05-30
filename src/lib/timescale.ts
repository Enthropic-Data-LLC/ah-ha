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

  // Composite PK (id, ts) is required — TimescaleDB demands the partition
  // column (ts) be part of any unique index including the primary key.
  await db.query(`
    CREATE TABLE IF NOT EXISTS trail_entries (
      id          UUID    DEFAULT gen_random_uuid() NOT NULL,
      space_ref   TEXT    NOT NULL,
      org_id      TEXT    NOT NULL,
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      text        TEXT    NOT NULL,
      tone        TEXT    NOT NULL DEFAULT 'neutral'
                    CHECK (tone IN ('happy', 'sorrow', 'neutral')),
      source      TEXT    NOT NULL DEFAULT 'manual',
      tags        TEXT[]  NOT NULL DEFAULT '{}',
      meta        JSONB   NOT NULL DEFAULT '{}',
      created_by  TEXT,
      prev_hash   TEXT    NOT NULL DEFAULT '',
      PRIMARY KEY (id, ts)
    )
  `)

  // Convert to hypertable — migrate_data handles pre-existing rows.
  // Silently skip if not TimescaleDB (plain PG fallback for tests).
  await db.query(`
    SELECT create_hypertable('trail_entries', 'ts',
      if_not_exists => TRUE,
      migrate_data  => TRUE
    )
  `).catch(() => {})

  await db.query(`CREATE INDEX IF NOT EXISTS trail_entries_space_ts ON trail_entries (space_ref, ts DESC)`)
  await db.query(`CREATE INDEX IF NOT EXISTS trail_entries_org_ts   ON trail_entries (org_id,    ts DESC)`)
  await db.query(`CREATE INDEX IF NOT EXISTS trail_entries_tags     ON trail_entries USING gin(tags)`)
  await db.query(`CREATE INDEX IF NOT EXISTS trail_entries_meta     ON trail_entries USING gin(meta)`)
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = null
}
