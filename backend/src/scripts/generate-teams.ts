import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Randomly shuffles an array in-place using Fisher-Yates.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function generateTeams(leagueName: string): Promise<void> {
  const { db, schema } = getDrizzleDb();

  // 1. Look up the league by name
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

  const format = league.format as 'teams' | 'doubles';
  const teamSize = format === 'teams' ? 4 : 2;
  console.log(`League: "${league.name}" (id=${league.id}, format=${format})`);

  // 2. Get divisions for the league
  const divisions = await db
    .select()
    .from(schema.leagueDivisions)
    .where(eq(schema.leagueDivisions.league_id, league.id));

  if (divisions.length === 0) {
    console.error('League has no divisions. Create at least one division first.');
    process.exit(1);
  }

  console.log(`Divisions: ${divisions.map((d) => `"${d.name}" (id=${d.id})`).join(', ')}`);

  // 3. Get all roster members for this league
  const rosterRows = await db
    .select({
      member_id: schema.leagueRoster.member_id,
      member_name: schema.members.name,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(eq(schema.leagueRoster.league_id, league.id));

  console.log(`Roster size: ${rosterRows.length} members`);

  const totalTeams = Math.floor(rosterRows.length / teamSize);
  if (totalTeams === 0) {
    console.error(
      `Not enough members to form a single team. Need at least ${teamSize}, have ${rosterRows.length}.`,
    );
    process.exit(1);
  }

  const leftover = rosterRows.length - totalTeams * teamSize;
  if (leftover > 0) {
    console.log(
      `Note: ${leftover} member(s) will be left unassigned (not enough for a full team).`,
    );
  }

  // 4. Shuffle the roster
  shuffle(rosterRows);

  // 5. Distribute teams evenly across divisions
  const teamsPerDivision = Math.floor(totalTeams / divisions.length);
  let extraTeams = totalTeams % divisions.length;

  // Build a plan: how many teams each division gets
  const divisionPlan: { division: typeof divisions[0]; teamCount: number }[] = divisions.map(
    (div) => {
      const count = teamsPerDivision + (extraTeams > 0 ? 1 : 0);
      if (extraTeams > 0) extraTeams--;
      return { division: div, teamCount: count };
    },
  );

  // 6. Create teams and assign members
  let playerIndex = 0;
  let teamNumber = 1;

  await db.transaction(async (tx) => {
    for (const { division, teamCount } of divisionPlan) {
      for (let t = 0; t < teamCount; t++) {
        const teamName = `Team ${String(teamNumber).padStart(2, '0')}`;
        teamNumber++;

        // Create the team
        const [newTeam] = await tx
          .insert(schema.leagueTeams)
          .values({
            league_id: league.id,
            division_id: division.id,
            name: teamName,
          })
          .returning();

        // Grab the next `teamSize` players
        const teamPlayers = rosterRows.slice(playerIndex, playerIndex + teamSize);
        playerIndex += teamSize;

        if (format === 'teams') {
          // Roles: lead, second, third, fourth (already shuffled, so assignment is random)
          const roles = ['lead', 'second', 'third', 'fourth'] as const;

          // Randomly pick one player as skip and a different one as vice
          const skipIdx = Math.floor(Math.random() * teamPlayers.length);
          let viceIdx = Math.floor(Math.random() * (teamPlayers.length - 1));
          if (viceIdx >= skipIdx) viceIdx++;

          for (let i = 0; i < teamPlayers.length; i++) {
            await tx.insert(schema.teamMembers).values({
              team_id: newTeam.id,
              member_id: teamPlayers[i].member_id,
              role: roles[i],
              is_skip: i === skipIdx ? 1 : 0,
              is_vice: i === viceIdx ? 1 : 0,
            });
          }
        } else {
          // Doubles: player1, player2, no skip/vice
          const roles = ['player1', 'player2'] as const;
          for (let i = 0; i < teamPlayers.length; i++) {
            await tx.insert(schema.teamMembers).values({
              team_id: newTeam.id,
              member_id: teamPlayers[i].member_id,
              role: roles[i],
              is_skip: 0,
              is_vice: 0,
            });
          }
        }

        const memberNames = teamPlayers.map((p) => p.member_name).join(', ');
        console.log(`  ${teamName} → ${division.name} [${memberNames}]`);
      }
    }
  });

  console.log(`\nCreated ${totalTeams} teams across ${divisions.length} division(s).`);
}

async function main() {
  const leagueName = process.argv[2];
  if (!leagueName) {
    console.error('Usage: tsx src/scripts/generate-teams.ts "<league name>"');
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  await generateTeams(leagueName);
}

main().catch((err) => {
  console.error('Generating teams failed:', err);
  process.exit(1);
});
