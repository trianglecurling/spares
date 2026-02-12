import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq, sql } from 'drizzle-orm';

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return typeof value === 'string' ? value : String(value ?? '');
}


function toDateParts(value: string) {
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  return { year, month, day };
}

function formatDateString(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number) {
  const { year, month, day } = toDateParts(dateStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getDayOfWeek(dateStr: string) {
  const { year, month, day } = toDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function computeDrawDates(
  startDate: string,
  endDate: string,
  dayOfWeek: number,
  exceptions: Set<string>,
): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const dates: string[] = [];
  const daysUntilTarget = (dayOfWeek - getDayOfWeek(startDate) + 7) % 7;
  let current = addDays(startDate, daysUntilTarget);
  while (current <= endDate) {
    if (!exceptions.has(current)) dates.push(current);
    current = addDays(current, 7);
  }
  return dates;
}

/**
 * Generate a non-decreasing priority sequence of length `n` starting at 1 with no gaps.
 * e.g. [1,1,2,3,4], [1,2,2,2,3], [1,2,3,4,5], [1], etc.
 */
function generatePriorities(n: number): number[] {
  const priorities = [1];
  for (let i = 1; i < n; i++) {
    const prev = priorities[i - 1];
    if (prev < 5 && Math.random() < 0.5) {
      priorities.push(prev + 1);
    } else {
      priorities.push(prev);
    }
  }
  return priorities;
}

async function seedByeRequests(leagueName: string): Promise<void> {
  const { db, schema } = getDrizzleDb();

  // 1. Look up the league
  const leagues = await db
    .select()
    .from(schema.leagues)
    .where(sql`LOWER(${schema.leagues.name}) = LOWER(${leagueName})`)
    .limit(1);

  const league = leagues[0];
  if (!league) {
    console.error(`League not found: "${leagueName}"`);
    process.exit(1);
  }

  const startDate = formatDateValue(league.start_date);
  const endDate = formatDateValue(league.end_date);
  console.log(`League: "${league.name}" (id=${league.id}, ${startDate} – ${endDate})`);

  // 2. Get exception dates
  const exceptionRows = await db
    .select({ exception_date: schema.leagueExceptions.exception_date })
    .from(schema.leagueExceptions)
    .where(eq(schema.leagueExceptions.league_id, league.id));

  const exceptions = new Set(exceptionRows.map((r) => formatDateValue(r.exception_date)));

  // 3. Compute regular draw dates
  const drawDates = computeDrawDates(startDate, endDate, league.day_of_week, exceptions);

  // 4. Add extra draw dates
  const extraDrawRows = await db
    .select({
      draw_date: schema.leagueExtraDraws.draw_date,
    })
    .from(schema.leagueExtraDraws)
    .where(eq(schema.leagueExtraDraws.league_id, league.id));

  const extraDates = new Set(extraDrawRows.map((r) => formatDateValue(r.draw_date)));

  // 5. Build unique dates (regular + extra)
  const allDatesSet = new Set(drawDates);
  for (const d of extraDates) {
    allDatesSet.add(d);
  }
  const allDates = [...allDatesSet].sort();

  if (allDates.length === 0) {
    console.error('No valid draw dates found. Does the league have draw times configured?');
    process.exit(1);
  }

  console.log(`Available draw dates: ${allDates.length} (${drawDates.length} regular + ${extraDates.size} extra)`);

  // 7. Get all teams for this league
  const teams = await db
    .select({ id: schema.leagueTeams.id, name: schema.leagueTeams.name })
    .from(schema.leagueTeams)
    .where(eq(schema.leagueTeams.league_id, league.id));

  if (teams.length === 0) {
    console.error('No teams found for this league.');
    process.exit(1);
  }

  // 8. For each team, check existing bye requests and seed if needed
  let seeded = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const team of teams) {
      const existing = await tx
        .select({ id: schema.teamByeRequests.id })
        .from(schema.teamByeRequests)
        .where(eq(schema.teamByeRequests.team_id, team.id))
        .limit(1);

      if (existing.length > 0) {
        console.log(`  ${team.name ?? `Team ${team.id}`}: already has bye requests, skipping`);
        skipped++;
        continue;
      }

      // Pick 1-5 random dates
      const count = Math.min(Math.floor(Math.random() * 5) + 1, allDates.length);
      const picked = shuffle([...allDates]).slice(0, count);
      const priorities = generatePriorities(count);

      for (let i = 0; i < count; i++) {
        await tx.insert(schema.teamByeRequests).values({
          team_id: team.id,
          draw_date: picked[i],
          priority: priorities[i],
          note: null,
        });
      }

      const prioStr = priorities.join(',');
      console.log(`  ${team.name ?? `Team ${team.id}`}: ${count} bye request(s), priorities=[${prioStr}]`);
      seeded++;
    }
  });

  console.log(`\nDone. Seeded ${seeded} team(s), skipped ${skipped} team(s) with existing requests.`);
}

async function main() {
  const leagueName = process.argv[2];
  if (!leagueName) {
    console.error('Usage: tsx src/scripts/seed-bye-requests.ts "<league name>"');
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  await seedByeRequests(leagueName);
}

main().catch((err) => {
  console.error('Seeding bye requests failed:', err);
  process.exit(1);
});
