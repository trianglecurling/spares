import type { DatabaseAdapter } from './adapter.js';

const leagueWaitlistsDDL = `
  CREATE TABLE IF NOT EXISTS league_waitlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_league_waitlists_status ON league_waitlists(status);
`;

const leagueWaitlistsDDLPg = `
  CREATE TABLE IF NOT EXISTS league_waitlists (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_league_waitlists_status ON league_waitlists(status);
`;

export async function ensureLeagueWaitlistSchema(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  const isPostgres = Boolean(db.isAsync?.());
  await execSQL(db, isPostgres ? leagueWaitlistsDDLPg : leagueWaitlistsDDL);

  if (isPostgres) {
    await execSQL(db, 'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS waitlist_id INTEGER REFERENCES league_waitlists(id) ON DELETE SET NULL');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_leagues_waitlist_id ON leagues(waitlist_id)');
    await execSQL(db, 'ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS waitlist_id INTEGER REFERENCES league_waitlists(id) ON DELETE CASCADE');
    await execSQL(
      db,
      'ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS replaces_lineage_start_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL'
    );
    await execSQL(
      db,
      'ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS original_replaces_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL'
    );
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_waitlist_entries_waitlist_id ON waitlist_entries(waitlist_id)');
    return;
  }

  const leagueCols = [
    { name: 'waitlist_id', ddl: 'waitlist_id INTEGER REFERENCES league_waitlists(id) ON DELETE SET NULL' },
  ];
  for (const col of leagueCols) {
    const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(leagues)`);
    const rows = await stmt.all();
    if (!rows.some((r) => String(r.name) === col.name)) {
      await execSQL(db, `ALTER TABLE leagues ADD COLUMN ${col.ddl}`);
    }
  }
  await execSQL(db, `CREATE INDEX IF NOT EXISTS idx_leagues_waitlist_id ON leagues(waitlist_id)`);

  const entryCols = [
    { name: 'waitlist_id', ddl: 'waitlist_id INTEGER REFERENCES league_waitlists(id) ON DELETE CASCADE' },
    {
      name: 'replaces_lineage_start_league_id',
      ddl: 'replaces_lineage_start_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
    },
    {
      name: 'original_replaces_league_id',
      ddl: 'original_replaces_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
    },
  ];
  for (const col of entryCols) {
    const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(waitlist_entries)`);
    const rows = await stmt.all();
    if (!rows.some((r) => String(r.name) === col.name)) {
      await execSQL(db, `ALTER TABLE waitlist_entries ADD COLUMN ${col.ddl}`);
    }
  }
  await execSQL(db, `CREATE INDEX IF NOT EXISTS idx_waitlist_entries_waitlist_id ON waitlist_entries(waitlist_id)`);
}
