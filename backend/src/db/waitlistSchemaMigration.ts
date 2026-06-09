import type { DatabaseAdapter } from './adapter.js';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';
import { lineageRootLeagueId, loadLeagueContinuityMap } from '../registration/waitlistLineage.js';

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

async function tableHasColumn(
  db: DatabaseAdapter,
  table: string,
  column: string,
  isPostgres: boolean
): Promise<boolean> {
  if (isPostgres) {
    const rows = await db.prepare<{ exists?: number }>(
      `SELECT 1 AS exists FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`
    ).all(table, column);
    return rows.length > 0;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(${table})`);
  const rows = await stmt.all();
  return rows.some((r) => String(r.name) === column);
}

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
  } else {
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

  const hasLegacyLeagueId = await tableHasColumn(db, 'waitlist_entries', 'league_id', isPostgres);
  const hasWaitlistId = await tableHasColumn(db, 'waitlist_entries', 'waitlist_id', isPostgres);
  if (hasLegacyLeagueId && hasWaitlistId) {
    await backfillLeagueWaitlistsFromLegacy();
  }
}

export async function backfillLeagueWaitlistsFromLegacy(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const continuity = await loadLeagueContinuityMap();

  const leagues = await db.select().from(schema.leagues);
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  const waitlistIdByRoot = new Map<number, number>();

  async function getOrCreateWaitlistForLeague(leagueId: number): Promise<number> {
    const league = leagueById.get(leagueId);
    if (!league) throw new Error(`League ${leagueId} not found`);
    if (league.waitlist_id) return league.waitlist_id;

    const rootId = lineageRootLeagueId(leagueId, continuity);
    const existing = waitlistIdByRoot.get(rootId);
    if (existing) {
      await db.update(schema.leagues).set({ waitlist_id: existing }).where(eq(schema.leagues.id, leagueId));
      league.waitlist_id = existing;
      return existing;
    }

    const rootLeague = leagueById.get(rootId) ?? league;
    const [created] = await db
      .insert(schema.leagueWaitlists)
      .values({ name: `${rootLeague.name} waitlist`, status: 'active' })
      .returning({ id: schema.leagueWaitlists.id });
    waitlistIdByRoot.set(rootId, created.id);

    for (const row of leagues) {
      if (lineageRootLeagueId(row.id, continuity) === rootId) {
        await db.update(schema.leagues).set({ waitlist_id: created.id }).where(eq(schema.leagues.id, row.id));
        row.waitlist_id = created.id;
      }
    }
    return created.id;
  }

  for (const league of leagues) {
    const allows =
      (league as { allows_waitlist?: number }).allows_waitlist === 1 ||
      (league as { allows_waitlist?: number }).allows_waitlist === undefined;
    if (allows || league.waitlist_id) {
      await getOrCreateWaitlistForLeague(league.id);
    }
  }

  type LegacyEntryRow = {
    id: number;
    member_id: number;
    league_id: number;
    replaces_league_id: number | null;
    waitlist_id: number | null;
  };

  let legacyRows: LegacyEntryRow[] = [];
  try {
    const result = await db.execute(
      sql.raw(
        `SELECT id, member_id, league_id, replaces_league_id, waitlist_id FROM waitlist_entries WHERE waitlist_id IS NULL`
      )
    );
    legacyRows = ((result as unknown as { rows?: LegacyEntryRow[] }).rows ?? result) as LegacyEntryRow[];
  } catch {
    const pending = await db
      .select({
        id: schema.waitlistEntries.id,
        waitlistId: schema.waitlistEntries.waitlist_id,
      })
      .from(schema.waitlistEntries);
    for (const entry of pending) {
      if (entry.waitlistId) continue;
    }
    legacyRows = [];
  }

  for (const raw of legacyRows) {
    const leagueId = Number(raw.league_id);
    const waitlistId = await getOrCreateWaitlistForLeague(leagueId);
    const replacesLeagueId = raw.replaces_league_id != null ? Number(raw.replaces_league_id) : null;
    const lineageStart = replacesLeagueId != null ? lineageRootLeagueId(replacesLeagueId, continuity) : null;
    await db
      .update(schema.waitlistEntries)
      .set({
        waitlist_id: waitlistId,
        replaces_lineage_start_league_id: lineageStart,
        original_replaces_league_id: replacesLeagueId,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.waitlistEntries.id, Number(raw.id)));
  }

  const activeEntries = await db
    .select()
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.status, 'active'));
  const byMemberWaitlist = new Map<string, typeof activeEntries>();
  for (const entry of activeEntries) {
    const key = `${entry.member_id}:${entry.waitlist_id}`;
    const list = byMemberWaitlist.get(key) ?? [];
    list.push(entry);
    byMemberWaitlist.set(key, list);
  }
  for (const [, group] of byMemberWaitlist) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => {
      const keyCmp = String(a.position_sort_key).localeCompare(String(b.position_sort_key));
      if (keyCmp !== 0) return keyCmp;
      return String(a.joined_at).localeCompare(String(b.joined_at));
    });
    const [, ...duplicates] = sorted;
    for (const dup of duplicates) {
      await db.delete(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, dup.id));
    }
  }

  await db.delete(schema.waitlistEntries).where(eq(schema.waitlistEntries.status, 'removed'));
}
