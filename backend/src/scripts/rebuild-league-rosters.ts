/**
 * Fall 2026 roster rebuild: export, clear, and rebuild league rosters in stages.
 *
 * Usage:
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --list-leagues
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --export
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --clear --apply
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --stage returning [--apply]
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --stage waitlists [--apply]
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --stage open-registration [--apply]
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --stage third-leagues [--apply]
 *   bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --compare path/to/rosters-export.csv
 *
 * Dry-run is the default. Pass --apply to write. --force skips ordering and unresolved-league guards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { initializeDatabase } from '../db/index.js';
import { applyRosterRebuildPlacements, applySabbaticalMutations, applyWaitlistMutations, clearSessionRosters } from '../registration/rosterRebuild/rosterRebuildApply.js';
import { diffRosters, runRosterRebuildStage } from '../registration/rosterRebuild/rosterRebuildEngine.js';
import {
  parseLeagueCategoryMapJson,
  unresolvedLeagues,
  type LeagueCategoryOverrideMap,
} from '../registration/rosterRebuild/rosterRebuildLeagues.js';
import {
  buildSummaryMarkdown,
  collectPlacementReasons,
  findLatestRosterExport,
  parseRosterExportCsv,
  placementsToCsv,
  preflightToCsv,
  rosterDiffToCsv,
  rosterExportToCsv,
  waitlistEventsToCsv,
  sabbaticalsToCsv,
  writeTextFile,
} from '../registration/rosterRebuild/rosterRebuildReports.js';
import {
  findSessionByName,
  findTeamMemberAssignments,
  loadRosterExportRows,
  loadRosterRebuildSnapshot,
  loadSessionLeagues,
} from '../registration/rosterRebuild/rosterRebuildSnapshot.js';
import type { RosterRebuildStage } from '../registration/rosterRebuild/rosterRebuildTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RUN_ROOT = path.join(BACKEND_ROOT, 'data/roster-rebuild');

const STAGES: RosterRebuildStage[] = ['returning', 'waitlists', 'open-registration', 'third-leagues'];

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argvValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function usage(): string {
  return `Usage:
  bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --list-leagues
  bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --export
  bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --clear --apply
  bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --stage returning|waitlists|open-registration|third-leagues [--apply]
  bun run src/scripts/rebuild-league-rosters.ts --session "Fall 2026" --compare <rosters-export.csv>

Options: --league-map <file.json>  --force  --seed <number>  --output-dir <dir>
Dry-run is the default. Pass --apply to write roster and waitlist changes.`;
}

function timestampStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createRunDir(runRoot: string, command: string): string {
  const dir = path.join(runRoot, `${timestampStamp()}-${command}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadOverrides(mapPath: string | undefined): LeagueCategoryOverrideMap {
  if (!mapPath) return {};
  const abs = path.resolve(mapPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`League map file not found: ${abs}`);
  }
  return parseLeagueCategoryMapJson(JSON.parse(fs.readFileSync(abs, 'utf8')));
}

function assertSingleCommand(commands: string[]): string {
  if (commands.length !== 1) {
    console.error(usage());
    process.exit(1);
  }
  return commands[0]!;
}

async function main(): Promise<void> {
  const listLeagues = argvFlag('--list-leagues');
  const doExport = argvFlag('--export');
  const doClear = argvFlag('--clear');
  const stageArg = argvValue('--stage');
  const comparePath = argvValue('--compare');
  const commands = [
    listLeagues ? 'list-leagues' : null,
    doExport ? 'export' : null,
    doClear ? 'clear' : null,
    stageArg ? 'stage' : null,
    comparePath ? 'compare' : null,
  ].filter((value): value is string => value != null);
  const command = assertSingleCommand(commands);

  const sessionName = argvValue('--session');
  if (!sessionName) {
    console.error('--session is required.\n');
    console.error(usage());
    process.exit(1);
  }

  const apply = argvFlag('--apply');
  const force = argvFlag('--force');
  const seedRaw = argvValue('--seed');
  const seed = seedRaw != null ? Number(seedRaw) : Date.now() >>> 0;
  if (seedRaw != null && !Number.isFinite(seed)) {
    console.error('--seed must be a number.');
    process.exit(1);
  }
  const runRoot = path.resolve(argvValue('--output-dir') ?? DEFAULT_RUN_ROOT);
  const overrides = loadOverrides(argvValue('--league-map'));

  if (apply && (listLeagues || comparePath || doExport)) {
    console.error('--apply is only valid with --clear or --stage.');
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }
  await initializeDatabase(dbConfig);

  const session = await findSessionByName(sessionName);

  if (command === 'list-leagues') {
    const leagues = await loadSessionLeagues(session.id, overrides);
    console.log(`Session ${session.id} ${session.name}\n`);
    console.log('id\tcategory\tname\tcapacity\tformat\twaitlist\tpredecessor');
    for (const league of leagues) {
      console.log(
        [
          league.id,
          league.category,
          league.name,
          league.capacityValue,
          league.format,
          league.waitlistId ?? '',
          league.predecessorName ? `${league.predecessorLeagueId} ${league.predecessorName}` : (league.predecessorLeagueId ?? ''),
        ].join('\t'),
      );
    }
    const unresolved = unresolvedLeagues(leagues);
    if (unresolved.length > 0) {
      console.log('\nUnresolved leagues (map these with --league-map before --stage):');
      for (const league of unresolved) console.log(`  ${league.id}\t${league.name}`);
    }
    return;
  }

  if (command === 'export') {
    const leagues = await loadSessionLeagues(session.id, overrides);
    const rows = await loadRosterExportRows(leagues.map((league) => league.id));
    const outDir = createRunDir(runRoot, 'export');
    const csvPath = path.join(outDir, 'rosters-export.csv');
    writeTextFile(csvPath, rosterExportToCsv(rows));
    writeTextFile(
      path.join(outDir, 'summary.md'),
      buildSummaryMarkdown({
        command: 'export',
        sessionName: session.name,
        applied: false,
        leagues,
        extraLines: [`Exported ${rows.length} roster rows to ${csvPath}`],
      }),
    );
    console.log(`Wrote ${rows.length} roster rows to ${csvPath}`);
    return;
  }

  if (command === 'clear') {
    const leagues = await loadSessionLeagues(session.id, overrides);
    const target = leagues.filter((league) => league.category !== 'tuesday_evening' && league.category !== 'instructional');
    const outDir = createRunDir(runRoot, 'clear');
    const latestExport = findLatestRosterExport(runRoot);
    if (!latestExport && !force) {
      console.error('No rosters-export.csv found under the output folder. Run --export first, or pass --force.');
      process.exit(1);
    }
    const assignments = await findTeamMemberAssignments(target.map((league) => league.id));
    if (assignments.length > 0 && !force) {
      console.error(
        `Refusing to clear: ${assignments.length} team_members row(s) still reference target leagues. Remove team assignments first, or pass --force.`,
      );
      for (const row of assignments.slice(0, 20)) {
        console.error(`  league ${row.leagueId} member ${row.memberId} team ${row.teamId}`);
      }
      process.exit(1);
    }
    const existing = await loadRosterExportRows(target.map((league) => league.id));
    writeTextFile(path.join(outDir, 'rosters-cleared-preview.csv'), rosterExportToCsv(existing));
    writeTextFile(
      path.join(outDir, 'summary.md'),
      buildSummaryMarkdown({
        command: 'clear',
        sessionName: session.name,
        applied: apply,
        leagues: target,
        extraLines: [
          `Target leagues: ${target.map((league) => league.name).join(', ')}`,
          `Rows that would be deleted: ${existing.length}`,
          latestExport ? `Latest export: ${latestExport}` : 'No prior export found (--force)',
          apply ? 'Deleted those roster rows.' : 'Dry run; pass --apply to delete.',
        ],
      }),
    );
    if (!apply) {
      console.log(`Dry run: would delete ${existing.length} roster rows from ${target.length} leagues. Pass --apply to write.`);
      console.log(`Preview: ${outDir}`);
      return;
    }
    const { db } = getDrizzleDb();
    const result = await db.transaction(async (tx) => clearSessionRosters({ leagueIds: target.map((league) => league.id), tx }));
    console.log(`Deleted ${result.deleted} roster rows. Report: ${outDir}`);
    return;
  }

  if (command === 'compare') {
    const absCompare = path.resolve(comparePath!);
    if (!fs.existsSync(absCompare)) {
      console.error(`Compare file not found: ${absCompare}`);
      process.exit(1);
    }
    const snapshot = await loadRosterRebuildSnapshot({
      sessionId: session.id,
      sessionName: session.name,
      overrides,
    });
    const before = parseRosterExportCsv(fs.readFileSync(absCompare, 'utf8')).filter(
      (row) => row.status === 'active' || row.status === 'completed' || row.status === '',
    );
    for (const row of before) {
      if (snapshot.members.has(row.memberId)) continue;
      snapshot.members.set(row.memberId, {
        memberId: row.memberId,
        name: row.memberName,
        email: row.memberEmail,
        isLifetimeMember: false,
        clubTenureYears: 0,
        totalExperienceYears: 0,
      });
    }
    const after = snapshot.currentRosters
      .filter((row) => row.status === 'active' || row.status === 'completed')
      .map((row) => ({ leagueId: row.leagueId, memberId: row.memberId }));
    const reasons = collectPlacementReasons(runRoot);
    const diff = diffRosters({
      before: before.map((row) => ({ leagueId: row.leagueId, memberId: row.memberId })),
      after,
      reasons,
    });
    const outDir = createRunDir(runRoot, 'compare');
    writeTextFile(path.join(outDir, 'roster-diff.csv'), rosterDiffToCsv(diff, snapshot.leagues, snapshot.members));
    const added = diff.filter((row) => row.change === 'added').length;
    const removed = diff.filter((row) => row.change === 'removed').length;
    const unchanged = diff.filter((row) => row.change === 'unchanged').length;
    writeTextFile(
      path.join(outDir, 'summary.md'),
      buildSummaryMarkdown({
        command: 'compare',
        sessionName: session.name,
        applied: false,
        leagues: snapshot.leagues,
        vacancies: snapshot.leagues.map((league) => {
          const rows = snapshot.currentRosters.filter(
            (row) => row.leagueId === league.id && (row.status === 'active' || row.status === 'completed'),
          );
          const rostered = rows.length;
          const temporary = rows.filter((row) => row.isTemporarySabbaticalFill).length;
          const permanent = rostered - temporary;
          const sabbaticals = snapshot.activeSabbaticals.filter((row) => row.leagueId === league.id).length;
          const permanentVacancy = Math.max(0, league.capacityValue - permanent - sabbaticals);
          const temporaryVacancy = Math.max(0, sabbaticals - temporary);
          return {
            leagueId: league.id,
            capacity: league.capacityValue,
            rostered,
            holds: 0,
            sabbaticals,
            vacancy: permanentVacancy + temporaryVacancy,
            permanentVacancy,
            temporaryVacancy,
          };
        }),
        extraLines: [
          `Baseline: ${absCompare}`,
          `Added: ${added}`,
          `Removed: ${removed}`,
          `Unchanged: ${unchanged}`,
        ],
      }),
    );
    console.log(`Compare: +${added} / -${removed} / ${unchanged} unchanged. ${outDir}`);
    return;
  }

  if (!stageArg || !STAGES.includes(stageArg as RosterRebuildStage)) {
    console.error(`--stage must be one of: ${STAGES.join(', ')}`);
    process.exit(1);
  }
  const stage = stageArg as RosterRebuildStage;
  const snapshot = await loadRosterRebuildSnapshot({
    sessionId: session.id,
    sessionName: session.name,
    overrides,
  });
  const unresolved = unresolvedLeagues(snapshot.leagues);
  if (unresolved.length > 0 && !force) {
    console.error('Unresolved leagues. Map them with --league-map or pass --force:');
    for (const league of unresolved) console.error(`  ${league.id}\t${league.name}`);
    process.exit(1);
  }
  if (stage === 'waitlists' && snapshot.guaranteedReturnPlacementCount === 0 && !force) {
    console.error('No guaranteed_return roster rows in this session. Run --stage returning first, or pass --force.');
    process.exit(1);
  }
  if (stage === 'open-registration' && snapshot.waitlistPlacementCount === 0 && !force) {
    console.error('No waitlist roster rows in this session. Run --stage waitlists first, or pass --force.');
    process.exit(1);
  }
  if (stage === 'third-leagues' && snapshot.waitlistPlacementCount === 0 && !force) {
    console.error('No waitlist roster rows in this session. Run --stage waitlists first, or pass --force.');
    process.exit(1);
  }

  const result = runRosterRebuildStage(snapshot, stage, { randomSeed: seed });
  const outDir = createRunDir(runRoot, `stage-${stage}`);
  writeTextFile(path.join(outDir, 'placements.csv'), placementsToCsv(result.placements, snapshot.leagues, snapshot.members));
  writeTextFile(path.join(outDir, 'waitlist-events.csv'), waitlistEventsToCsv(result.waitlistEvents, snapshot.leagues, snapshot.members));
  writeTextFile(path.join(outDir, 'preflight.csv'), preflightToCsv(result.notes, snapshot.leagues, snapshot.members));
  writeTextFile(
    path.join(outDir, 'sabbaticals.csv'),
    sabbaticalsToCsv(result.sabbaticalMutations, snapshot.leagues, snapshot.members),
  );
  writeTextFile(
    path.join(outDir, 'summary.md'),
    buildSummaryMarkdown({
      command: `stage ${stage}`,
      sessionName: session.name,
      applied: apply,
      leagues: snapshot.leagues,
      result,
      extraLines: apply ? ['Database writes applied.'] : ['Dry run; pass --apply to write.'],
    }),
  );

  if (!apply) {
    console.log(
      `Dry run stage ${stage}: ${result.placements.length} placements, ${result.waitlistEvents.length} waitlist events, ${result.sabbaticalMutations.length} fallback sabbaticals. Pass --apply to write.`,
    );
    console.log(`Report: ${outDir}`);
    return;
  }

  const { db } = getDrizzleDb();
  await db.transaction(async (tx) => {
    const sabbaticalResult = await applySabbaticalMutations(result.sabbaticalMutations, tx);
    const rosterResult = await applyRosterRebuildPlacements(result.placements, tx, sabbaticalResult.idMap);
    const waitlistResult = await applyWaitlistMutations(result.waitlistMutations, tx);
    console.log(
      `Applied stage ${stage}: inserted ${rosterResult.inserted} roster rows (skipped ${rosterResult.skipped}), fallback sabbaticals ${sabbaticalResult.inserted}, waitlist placed ${waitlistResult.placed}, temporary fills ${waitlistResult.temporaryFills}, declined ${waitlistResult.declined}.`,
    );
  });
  console.log(`Report: ${outDir}`);
}

main().catch((error) => {
  console.error('rebuild-league-rosters failed:', error);
  process.exit(1);
});
