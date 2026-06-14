/**
 * One-time import: TSV rows (Name, Email, League code) → members + league_roster.
 *
 * League codes in the spreadsheet are not stored on `leagues`; map them with a JSON file.
 *
 * Usage:
 *   bun run src/scripts/import-league-rosters-from-tsv.ts --list-leagues
 *   bun run src/scripts/import-league-rosters-from-tsv.ts --tsv ../w2026members.tsv --league-map ./data/league-code-map.w2026.json
 *   bun run src/scripts/import-league-rosters-from-tsv.ts --tsv ../w2026members.tsv --league-map ./data/league-code-map.w2026.json --dry-run
 *
 * Optional:
 *   --update-names   If a member already exists, set `name` from the TSV when it differs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';

type TsvRow = { name: string; email: string; leagueCode: string };

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argvValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function parseLeagueMapJson(filePath: string): Record<string, number> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`League map file not found: ${abs}`);
    process.exit(1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (e) {
    console.error(`Invalid JSON in league map: ${abs}`, e);
    process.exit(1);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('League map must be a JSON object, e.g. { "MonE": 12, "WedL": 5 }');
    process.exit(1);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const code = k.trim();
    if (!code) continue;
    const id = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(id) || id < 1) {
      console.error(`League map "${code}" must map to a positive integer league id, got: ${String(v)}`);
      process.exit(1);
    }
    out[code] = id;
  }
  if (Object.keys(out).length === 0) {
    console.error('League map is empty.');
    process.exit(1);
  }
  return out;
}

function parseTsv(filePath: string): TsvRow[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`TSV file not found: ${abs}`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const rows: TsvRow[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) {
      console.error(`Line ${li + 1}: expected at least 3 tab-separated columns, got ${parts.length}`);
      process.exit(1);
    }
    const c0 = parts[0].trim();
    const c1 = parts[1].trim();
    const c2 = parts[2].trim();
    if (
      li === 0 &&
      c0.toLowerCase() === 'name' &&
      c1.toLowerCase() === 'email' &&
      c2.toLowerCase() === 'league'
    ) {
      continue;
    }
    if (!c0 || !c1 || !c2) {
      console.error(`Line ${li + 1}: empty name, email, or league code`);
      process.exit(1);
    }
    if (!c1.includes('@')) {
      console.error(`Line ${li + 1}: invalid email (no @): ${c1}`);
      process.exit(1);
    }
    rows.push({ name: c0, email: c1, leagueCode: c2 });
  }
  return rows;
}

async function listLeagues(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagues.id,
      leagueName: schema.leagues.name,
      sessionId: schema.leagues.session_id,
      sessionName: schema.curlingSessions.name,
      startDate: schema.leagues.start_date,
    })
    .from(schema.leagues)
    .leftJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .orderBy(asc(schema.leagues.id));

  console.log('Use these `id` values in your league code map JSON (spreadsheet code → league id).\n');
  for (const r of rows) {
    const sess = r.sessionId == null ? '—' : `${r.sessionId}${r.sessionName ? ` ${r.sessionName}` : ''}`;
    console.log(
      `  id ${r.leagueId}\t${r.leagueName}\tsession: ${sess}\tstarts ${r.startDate ?? '—'}`
    );
  }
  console.log('\nExample `league-code-map.json`:');
  console.log('  {');
  console.log('    "MonE": <id-from-above>,');
  console.log('    "WedL": <id-from-above>');
  console.log('  }');
}

async function main(): Promise<void> {
  const dryRun = argvFlag('--dry-run');
  const updateNames = argvFlag('--update-names');
  const listOnly = argvFlag('--list-leagues');

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);

  if (listOnly) {
    await listLeagues();
    return;
  }

  const tsvPath = argvValue('--tsv');
  const mapPath = argvValue('--league-map');
  if (!tsvPath || !mapPath) {
    console.error(`Usage:
  bun run src/scripts/import-league-rosters-from-tsv.ts --list-leagues
  bun run src/scripts/import-league-rosters-from-tsv.ts --tsv <path.tsv> --league-map <codes-to-ids.json> [--dry-run] [--update-names]`);
    process.exit(1);
  }

  const leagueMap = parseLeagueMapJson(mapPath);
  const tsvRows = parseTsv(tsvPath);

  const codesInFile = new Set(tsvRows.map((r) => r.leagueCode));
  const unknownCodes = [...codesInFile].filter((c) => leagueMap[c] === undefined);
  if (unknownCodes.length > 0) {
    console.error('TSV contains league codes not present in the map. Add them to your JSON file:');
    for (const c of unknownCodes.sort()) console.error(`  - ${c}`);
    process.exit(1);
  }

  const { db, schema } = getDrizzleDb();

  const leagueIds = [...new Set(Object.values(leagueMap))];
  if (leagueIds.length > 0) {
    const existing = await db
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(inArray(schema.leagues.id, leagueIds));
    const found = new Set(existing.map((r) => r.id));
    const missing = leagueIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      console.error('League map references ids that do not exist in `leagues`:');
      for (const id of missing.sort((a, b) => a - b)) console.error(`  - ${id}`);
      process.exit(1);
    }
  }

  const firstNameByEmail = new Map<string, string>();
  for (const row of tsvRows) {
    const key = normalizeEmail(row.email);
    if (!firstNameByEmail.has(key)) firstNameByEmail.set(key, row.name);
  }

  if (dryRun) {
    console.log(`Dry run: ${tsvRows.length} roster rows, ${firstNameByEmail.size} unique emails.`);
    console.log(`League codes covered: ${[...codesInFile].sort().join(', ')}`);
    return;
  }

  const memberIdByEmail = new Map<string, number>();

  await db.transaction(async (tx) => {
    for (const [emailNorm, displayName] of firstNameByEmail) {
      const existing = await tx
        .select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(sql`LOWER(${schema.members.email}) = LOWER(${emailNorm})`)
        .limit(1);

      const row = existing[0];
      if (row) {
        if (updateNames && row.name !== displayName) {
          await tx
            .update(schema.members)
            .set({ name: displayName, updated_at: sql`CURRENT_TIMESTAMP` })
            .where(eq(schema.members.id, row.id));
        }
        memberIdByEmail.set(emailNorm, row.id);
        continue;
      }

      const inserted = await tx
        .insert(schema.members)
        .values({
          name: displayName,
          email: emailNorm,
          phone: null,
          is_server_admin: 0,
          is_calendar_admin: 0,
          is_content_admin: 0,
          is_sponsor_admin: 0,
          opted_in_sms: 0,
          email_subscribed: 1,
          email_visible: 0,
          phone_visible: 0,
        })
        .returning({ id: schema.members.id });

      const newRow = inserted[0];
      if (!newRow) throw new Error(`Insert failed for ${emailNorm}`);
      memberIdByEmail.set(emailNorm, newRow.id);
    }

    for (const row of tsvRows) {
      const emailNorm = normalizeEmail(row.email);
      const memberId = memberIdByEmail.get(emailNorm);
      if (!memberId) throw new Error(`Internal: missing member id for ${emailNorm}`);

      const leagueId = leagueMap[row.leagueCode];
      await tx
        .insert(schema.leagueRoster)
        .values({ league_id: leagueId, member_id: memberId })
        .onConflictDoNothing({
          target: [schema.leagueRoster.league_id, schema.leagueRoster.member_id],
        });
    }
  });

  console.log(
    `Done: ensured ${memberIdByEmail.size} members, processed ${tsvRows.length} roster placements (duplicates ignored).`
  );
}

main().catch((err) => {
  console.error('import-league-rosters-from-tsv failed:', err);
  process.exit(1);
});
