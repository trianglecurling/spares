/**
 * Routes for game results, lineups, league settings, standings, and stats.
 * Phase 3: Results, rankings, and stats foundation.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { successResponseSchema } from '../api/schemas.js';
import {
  gameLineupsPutBodySchema,
  gameLineupsSchema,
  gameListWithResultsResponseSchema,
  gameResultsPutBodySchema,
  gameResultsSchema,
  gameWithResultSchema,
  leagueSettingsPutBodySchema,
  leagueSettingsSchema,
  leagueStandingsResponseSchema,
  memberStatsListResponseSchema,
  teamStatsSchema,
} from '../api/leagueResultsSchemas.js';
import { hasLeagueSetupAccess } from '../utils/leagueAccess.js';

type DrizzleDb = ReturnType<typeof getDrizzleDb>['db'];
type DrizzleSchema = ReturnType<typeof getDrizzleDb>['schema'];

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return typeof value === 'string' ? value : String(value ?? '');
}

function formatTimeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[1]?.slice(0, 5) ?? '';
  }
  if (typeof value === 'string') {
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value ?? '');
}

async function loadTeamNames(
  db: DrizzleDb,
  schema: DrizzleSchema,
  teamIds: number[]
): Promise<Map<number, string>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.leagueTeams.id, name: schema.leagueTeams.name })
    .from(schema.leagueTeams)
    .where(inArray(schema.leagueTeams.id, teamIds));
  return new Map(rows.map((row) => [row.id, row.name ?? `Team ${row.id}`]));
}

/**
 * Compute lineup for one team for a game: standard roster with filled spares overriding replaced players.
 * Returns array of { member_id, role, is_spare, sparing_for_member_id } for insertion into game_lineups.
 */
async function computeTeamLineup(
  db: DrizzleDb,
  schema: DrizzleSchema,
  gameId: number,
  teamId: number
): Promise<
  Array<{
    member_id: number;
    role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
    is_spare: number;
    sparing_for_member_id: number | null;
    is_skip: number;
    is_vice: number;
  }>
> {
  const roster = await db
    .select({
      member_id: schema.teamMembers.member_id,
      role: schema.teamMembers.role,
      is_skip: schema.teamMembers.is_skip,
      is_vice: schema.teamMembers.is_vice,
    })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.team_id, teamId))
    .orderBy(asc(schema.teamMembers.role));

  const filledSpares = await db
    .select({
      requested_for_member_id: schema.spareRequests.requested_for_member_id,
      filled_by_member_id: schema.spareRequests.filled_by_member_id,
    })
    .from(schema.spareRequests)
    .where(
      and(
        eq(schema.spareRequests.game_id, gameId),
        eq(schema.spareRequests.status, 'filled')
      )
    );
  const spareByReplaced = new Map<number, number>();
  for (const row of filledSpares) {
    if (row.requested_for_member_id != null && row.filled_by_member_id != null) {
      spareByReplaced.set(row.requested_for_member_id, row.filled_by_member_id);
    }
  }

  return roster.map((r) => {
    const spareId = spareByReplaced.get(r.member_id);
    if (spareId != null) {
      return {
        member_id: spareId,
        role: r.role,
        is_spare: 1,
        sparing_for_member_id: r.member_id,
        is_skip: r.is_skip,
        is_vice: r.is_vice,
      };
    }
    return {
      member_id: r.member_id,
      role: r.role,
      is_spare: 0,
      sparing_for_member_id: null,
      is_skip: r.is_skip,
      is_vice: r.is_vice,
    };
  });
}

async function getOrCreateLeagueSettings(
  db: DrizzleDb,
  schema: DrizzleSchema,
  leagueId: number
): Promise<{ head_to_head_first: number; result_labels: string | null; collect_bye_requests: number }> {
  const rows = await db
    .select({
      head_to_head_first: schema.leagueSettings.head_to_head_first,
      result_labels: schema.leagueSettings.result_labels,
      collect_bye_requests: schema.leagueSettings.collect_bye_requests,
    })
    .from(schema.leagueSettings)
    .where(eq(schema.leagueSettings.league_id, leagueId))
    .limit(1);

  if (rows.length > 0) {
    return {
      head_to_head_first: rows[0].head_to_head_first,
      result_labels: rows[0].result_labels,
      collect_bye_requests: rows[0].collect_bye_requests ?? 1,
    };
  }

  await db.insert(schema.leagueSettings).values({
    league_id: leagueId,
    head_to_head_first: 0,
    result_labels: null,
    collect_bye_requests: 1,
  });
  return { head_to_head_first: 0, result_labels: null, collect_bye_requests: 1 };
}

/**
 * Compare two tiebreaker value arrays (both same length). Returns negative if a wins, positive if b wins, 0 if tie.
 * Higher values are better (e.g. wins, points).
 */
function compareTiebreakerValues(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return vb - va; // descending: higher is better
  }
  return 0;
}

/**
 * Resolve head-to-head between two teams: positive if teamA beat teamB (A ranks higher), negative if B beat A, 0 if no game or tie.
 */
function h2hTwoTeams(
  teamA: number,
  teamB: number,
  gameResults: Array<{ team1_id: number; team2_id: number; team1_values: number[]; team2_values: number[] }>
): number {
  const game = gameResults.find(
    (g) =>
      (g.team1_id === teamA && g.team2_id === teamB) || (g.team1_id === teamB && g.team2_id === teamA)
  );
  if (!game) return 0;
  const cmp = compareTiebreakerValues(
    game.team1_id === teamA ? game.team1_values : game.team2_values,
    game.team1_id === teamA ? game.team2_values : game.team1_values
  );
  return -cmp; // positive when A has higher values (A wins)
}

/**
 * Among tied teams, apply head-to-head. Returns ordering: first element is highest rank.
 * If one team beat all others, they're first; then recurse on the rest.
 */
function orderByHeadToHead(
  teamIds: number[],
  gameResults: Array<{ team1_id: number; team2_id: number; team1_values: number[]; team2_values: number[] }>
): number[] {
  if (teamIds.length <= 1) return teamIds;

  const wins = new Map<number, number>();
  for (const id of teamIds) wins.set(id, 0);
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const a = teamIds[i]!;
      const b = teamIds[j]!;
      const h = h2hTwoTeams(a, b, gameResults);
      if (h > 0) wins.set(a, (wins.get(a) ?? 0) + 1);
      else if (h < 0) wins.set(b, (wins.get(b) ?? 0) + 1);
    }
  }

  const sorted = [...teamIds].sort((a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0));
  const maxWins = wins.get(sorted[0]!) ?? 0;
  if (maxWins === 0) return teamIds; // no head-to-head resolution (e.g. no games between them)

  const first = sorted.filter((id) => (wins.get(id) ?? 0) === maxWins);
  const rest = teamIds.filter((id) => !first.includes(id));
  if (rest.length === 0) return first;
  return [...first, ...orderByHeadToHead(rest, gameResults)];
}

export async function resultsRoutes(fastify: FastifyInstance) {
  // Get league settings
  fastify.get(
    '/leagues/:id/settings',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: leagueSettingsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const leagueId = parseInt((request.params as { id: string }).id, 10);
      const { db, schema } = getDrizzleDb();
      const settings = await getOrCreateLeagueSettings(db, schema, leagueId);
      const resultLabels = settings.result_labels ? (JSON.parse(settings.result_labels) as string[]) : null;
      return {
        leagueId,
        headToHeadFirst: settings.head_to_head_first === 1,
        resultLabels,
        collectByeRequests: settings.collect_bye_requests === 1,
      };
    }
  );

  // Update league settings (league manager only)
  fastify.put(
    '/leagues/:id/settings',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: leagueSettingsPutBodySchema,
        response: { 200: leagueSettingsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const leagueId = parseInt((request.params as { id: string }).id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = z
        .object({
          headToHeadFirst: z.boolean().optional(),
          resultLabels: z.array(z.string()).nullable().optional(),
          collectByeRequests: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      const { db, schema } = getDrizzleDb();
      await getOrCreateLeagueSettings(db, schema, leagueId);

      const update: {
        head_to_head_first?: number;
        result_labels?: string | null;
        collect_bye_requests?: number;
      } = {};
      if (body.headToHeadFirst !== undefined) update.head_to_head_first = body.headToHeadFirst ? 1 : 0;
      if (body.resultLabels !== undefined) update.result_labels = body.resultLabels ? JSON.stringify(body.resultLabels) : null;
      if (body.collectByeRequests !== undefined) update.collect_bye_requests = body.collectByeRequests ? 1 : 0;

      if (Object.keys(update).length > 0) {
        await db
          .update(schema.leagueSettings)
          .set({ ...update, updated_at: sql`CURRENT_TIMESTAMP` })
          .where(eq(schema.leagueSettings.league_id, leagueId));
      }

      const settings = await getOrCreateLeagueSettings(db, schema, leagueId);
      const resultLabels = settings.result_labels ? (JSON.parse(settings.result_labels) as string[]) : null;
      return {
        leagueId,
        headToHeadFirst: settings.head_to_head_first === 1,
        resultLabels,
        collectByeRequests: settings.collect_bye_requests === 1,
      };
    }
  );

  // Get game results
  fastify.get(
    '/games/:gameId/results',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        response: { 200: gameResultsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const gameId = parseInt((request.params as { gameId: string }).gameId, 10);
      const { db, schema } = getDrizzleDb();

      const gameRows = await db
        .select({
          id: schema.games.id,
          team1_id: schema.games.team1_id,
          team2_id: schema.games.team2_id,
        })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .limit(1);
      const game = gameRows[0];
      if (!game) return reply.code(404).send({ error: 'Game not found.' });

      const resultRows = await db
        .select({
          team_id: schema.gameResults.team_id,
          result_order: schema.gameResults.result_order,
          value: schema.gameResults.value,
        })
        .from(schema.gameResults)
        .where(eq(schema.gameResults.game_id, gameId))
        .orderBy(asc(schema.gameResults.result_order));

      const team1Results = resultRows
        .filter((r) => r.team_id === game.team1_id)
        .sort((a, b) => a.result_order - b.result_order)
        .map((r) => ({ resultOrder: r.result_order, value: r.value }));
      const team2Results = resultRows
        .filter((r) => r.team_id === game.team2_id)
        .sort((a, b) => a.result_order - b.result_order)
        .map((r) => ({ resultOrder: r.result_order, value: r.value }));

      return {
        gameId,
        team1Results,
        team2Results,
      };
    }
  );

  // Set/update game results (league manager only)
  fastify.put(
    '/games/:gameId/results',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        body: gameResultsPutBodySchema,
        response: { 200: gameResultsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const gameId = parseInt((request.params as { gameId: string }).gameId, 10);
      const body = z
        .object({
          team1Results: z.array(z.object({ resultOrder: z.number().int().min(0), value: z.number().int().min(0) })),
          team2Results: z.array(z.object({ resultOrder: z.number().int().min(0), value: z.number().int().min(0) })),
        })
        .parse(request.body);

      const { db, schema } = getDrizzleDb();
      const gameRows = await db
        .select({ id: schema.games.id, league_id: schema.games.league_id, team1_id: schema.games.team1_id, team2_id: schema.games.team2_id })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .limit(1);
      const game = gameRows[0];
      if (!game) return reply.code(404).send({ error: 'Game not found.' });
      if (!(await hasLeagueSetupAccess(member, game.league_id))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      await db.delete(schema.gameResults).where(eq(schema.gameResults.game_id, gameId));

      const toInsert: Array<{ game_id: number; team_id: number; result_order: number; value: number }> = [];
      for (const r of body.team1Results) {
        toInsert.push({ game_id: gameId, team_id: game.team1_id, result_order: r.resultOrder, value: r.value });
      }
      for (const r of body.team2Results) {
        toInsert.push({ game_id: gameId, team_id: game.team2_id, result_order: r.resultOrder, value: r.value });
      }
      if (toInsert.length > 0) {
        await db.insert(schema.gameResults).values(toInsert);
      }

      // Auto-record lineups from roster + filled spares (historical snapshot)
      const [team1LineupEntries, team2LineupEntries] = await Promise.all([
        computeTeamLineup(db, schema, gameId, game.team1_id),
        computeTeamLineup(db, schema, gameId, game.team2_id),
      ]);
      await db.delete(schema.gameLineups).where(eq(schema.gameLineups.game_id, gameId));
      const lineupInserts: Array<{
        game_id: number;
        team_id: number;
        member_id: number;
        role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
        is_spare: number;
        sparing_for_member_id: number | null;
      }> = [];
      for (const e of team1LineupEntries) {
        lineupInserts.push({
          game_id: gameId,
          team_id: game.team1_id,
          member_id: e.member_id,
          role: e.role,
          is_spare: e.is_spare,
          sparing_for_member_id: e.sparing_for_member_id,
        });
      }
      for (const e of team2LineupEntries) {
        lineupInserts.push({
          game_id: gameId,
          team_id: game.team2_id,
          member_id: e.member_id,
          role: e.role,
          is_spare: e.is_spare,
          sparing_for_member_id: e.sparing_for_member_id,
        });
      }
      if (lineupInserts.length > 0) {
        await db.insert(schema.gameLineups).values(lineupInserts);
      }

      const resultRows = await db
        .select({ team_id: schema.gameResults.team_id, result_order: schema.gameResults.result_order, value: schema.gameResults.value })
        .from(schema.gameResults)
        .where(eq(schema.gameResults.game_id, gameId))
        .orderBy(asc(schema.gameResults.result_order));

      const team1Results = resultRows
        .filter((r) => r.team_id === game.team1_id)
        .map((r) => ({ resultOrder: r.result_order, value: r.value }));
      const team2Results = resultRows
        .filter((r) => r.team_id === game.team2_id)
        .map((r) => ({ resultOrder: r.result_order, value: r.value }));

      return { gameId, team1Results, team2Results };
    }
  );

  // Get game lineups (computed from roster + filled spare requests for this game)
  fastify.get(
    '/games/:gameId/lineups',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        response: { 200: gameLineupsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const gameId = parseInt((request.params as { gameId: string }).gameId, 10);
      const { db, schema } = getDrizzleDb();

      const gameRows = await db
        .select({ id: schema.games.id, team1_id: schema.games.team1_id, team2_id: schema.games.team2_id })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .limit(1);
      const game = gameRows[0];
      if (!game) return reply.code(404).send({ error: 'Game not found.' });

      const [team1Entries, team2Entries] = await Promise.all([
        computeTeamLineup(db, schema, gameId, game.team1_id),
        computeTeamLineup(db, schema, gameId, game.team2_id),
      ]);

      const memberIds = [
        ...team1Entries.map((e) => e.member_id),
        ...team2Entries.map((e) => e.member_id),
        ...team1Entries.map((e) => e.sparing_for_member_id).filter((id): id is number => id != null),
        ...team2Entries.map((e) => e.sparing_for_member_id).filter((id): id is number => id != null),
      ];
      const uniqueIds = Array.from(new Set(memberIds));
      const nameRows = await db
        .select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(inArray(schema.members.id, uniqueIds));
      const names = new Map(nameRows.map((r) => [r.id, r.name]));

      const toResponse = (
        entries: typeof team1Entries
      ): Array<{ memberId: number; memberName: string; role: typeof entries[0]['role']; isSpare: boolean; sparingForMemberId: number | null; sparingForMemberName: string | null; isSkip: boolean; isVice: boolean }> =>
        entries.map((e) => ({
          memberId: e.member_id,
          memberName: names.get(e.member_id) ?? '',
          role: e.role,
          isSpare: e.is_spare === 1,
          sparingForMemberId: e.sparing_for_member_id,
          sparingForMemberName: e.sparing_for_member_id ? names.get(e.sparing_for_member_id) ?? null : null,
          isSkip: e.is_skip === 1,
          isVice: e.is_vice === 1,
        }));

      return {
        gameId,
        team1Lineup: toResponse(team1Entries),
        team2Lineup: toResponse(team2Entries),
      };
    }
  );

  // Set/update game lineups (league manager only)
  fastify.put(
    '/games/:gameId/lineups',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        body: gameLineupsPutBodySchema,
        response: { 200: gameLineupsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const gameId = parseInt((request.params as { gameId: string }).gameId, 10);
      const body = z
        .object({
          team1Lineup: z.array(
            z.object({
              memberId: z.number().int().positive(),
              role: z.enum(['lead', 'second', 'third', 'fourth', 'player1', 'player2']),
              isSpare: z.boolean(),
              sparingForMemberId: z.number().int().positive().nullable(),
            })
          ),
          team2Lineup: z.array(
            z.object({
              memberId: z.number().int().positive(),
              role: z.enum(['lead', 'second', 'third', 'fourth', 'player1', 'player2']),
              isSpare: z.boolean(),
              sparingForMemberId: z.number().int().positive().nullable(),
            })
          ),
        })
        .parse(request.body);

      const { db, schema } = getDrizzleDb();
      const gameRows = await db
        .select({ id: schema.games.id, league_id: schema.games.league_id, team1_id: schema.games.team1_id, team2_id: schema.games.team2_id })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .limit(1);
      const game = gameRows[0];
      if (!game) return reply.code(404).send({ error: 'Game not found.' });
      if (!(await hasLeagueSetupAccess(member, game.league_id))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      await db.delete(schema.gameLineups).where(eq(schema.gameLineups.game_id, gameId));

      const toInsert: Array<{
        game_id: number;
        team_id: number;
        member_id: number;
        role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
        is_spare: number;
        sparing_for_member_id: number | null;
      }> = [];
      for (const e of body.team1Lineup) {
        toInsert.push({
          game_id: gameId,
          team_id: game.team1_id,
          member_id: e.memberId,
          role: e.role,
          is_spare: e.isSpare ? 1 : 0,
          sparing_for_member_id: e.sparingForMemberId ?? null,
        });
      }
      for (const e of body.team2Lineup) {
        toInsert.push({
          game_id: gameId,
          team_id: game.team2_id,
          member_id: e.memberId,
          role: e.role,
          is_spare: e.isSpare ? 1 : 0,
          sparing_for_member_id: e.sparingForMemberId ?? null,
        });
      }
      if (toInsert.length > 0) {
        await db.insert(schema.gameLineups).values(toInsert);
      }

      // Return same shape as GET
      const lineupRows = await db
        .select({
          team_id: schema.gameLineups.team_id,
          member_id: schema.gameLineups.member_id,
          role: schema.gameLineups.role,
          is_spare: schema.gameLineups.is_spare,
          sparing_for_member_id: schema.gameLineups.sparing_for_member_id,
          member_name: schema.members.name,
        })
        .from(schema.gameLineups)
        .innerJoin(schema.members, eq(schema.gameLineups.member_id, schema.members.id))
        .where(eq(schema.gameLineups.game_id, gameId));
      const spareIds = lineupRows.map((r) => r.sparing_for_member_id).filter((id): id is number => id != null);
      const spareNames = new Map<number, string>();
      if (spareIds.length > 0) {
        const spareRows = await db.select({ id: schema.members.id, name: schema.members.name }).from(schema.members).where(inArray(schema.members.id, spareIds));
        spareRows.forEach((row) => spareNames.set(row.id, row.name));
      }
      const toEntry = (r: (typeof lineupRows)[0]) => ({
        memberId: r.member_id,
        memberName: r.member_name,
        role: r.role,
        isSpare: r.is_spare === 1,
        sparingForMemberId: r.sparing_for_member_id ?? null,
        sparingForMemberName: r.sparing_for_member_id ? spareNames.get(r.sparing_for_member_id) ?? null : null,
      });
      const team1Lineup = lineupRows.filter((r) => r.team_id === game.team1_id).map(toEntry);
      const team2Lineup = lineupRows.filter((r) => r.team_id === game.team2_id).map(toEntry);
      return { gameId, team1Lineup, team2Lineup };
    }
  );

  // Get league standings (per division)
  fastify.get(
    '/leagues/:id/standings',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: leagueStandingsResponseSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const leagueId = parseInt((request.params as { id: string }).id, 10);
      const { db, schema } = getDrizzleDb();

      const settings = await getOrCreateLeagueSettings(db, schema, leagueId);
      const resultLabels = settings.result_labels ? (JSON.parse(settings.result_labels) as string[]) : null;
      const headToHeadFirst = settings.head_to_head_first === 1;

      const divisions = await db
        .select({ id: schema.leagueDivisions.id, name: schema.leagueDivisions.name, sort_order: schema.leagueDivisions.sort_order })
        .from(schema.leagueDivisions)
        .where(eq(schema.leagueDivisions.league_id, leagueId))
        .orderBy(asc(schema.leagueDivisions.sort_order), asc(schema.leagueDivisions.id));

      const gamesWithResults: Array<{
        game_id: number;
        team1_id: number;
        team2_id: number;
        team1_values: number[];
        team2_values: number[];
      }> = [];
      const gameResultRows = await db
        .select({
          game_id: schema.gameResults.game_id,
          team_id: schema.gameResults.team_id,
          result_order: schema.gameResults.result_order,
          value: schema.gameResults.value,
        })
        .from(schema.gameResults)
        .innerJoin(schema.games, eq(schema.gameResults.game_id, schema.games.id))
        .where(eq(schema.games.league_id, leagueId));

      const gameIds = Array.from(new Set(gameResultRows.map((r) => r.game_id)));
      const gameTeamRows = await db
        .select({ id: schema.games.id, team1_id: schema.games.team1_id, team2_id: schema.games.team2_id })
        .from(schema.games)
        .where(inArray(schema.games.id, gameIds));
      const gameTeamMap = new Map(gameTeamRows.map((g) => [g.id, { team1_id: g.team1_id, team2_id: g.team2_id }]));

      const teamResultMap = new Map<number, Map<number, number[]>>(); // game_id -> team_id -> values by order
      for (const r of gameResultRows) {
        let byTeam = teamResultMap.get(r.game_id);
        if (!byTeam) {
          byTeam = new Map();
          teamResultMap.set(r.game_id, byTeam);
        }
        let arr = byTeam.get(r.team_id);
        if (!arr) {
          arr = [];
          byTeam.set(r.team_id, arr);
        }
        arr[r.result_order] = r.value;
      }
      for (const g of gameTeamRows) {
        const gt = gameTeamMap.get(g.id)!;
        const t1v = teamResultMap.get(g.id)?.get(gt.team1_id) ?? [];
        const t2v = teamResultMap.get(g.id)?.get(gt.team2_id) ?? [];
        gamesWithResults.push({
          game_id: g.id,
          team1_id: gt.team1_id,
          team2_id: gt.team2_id,
          team1_values: t1v,
          team2_values: t2v,
        });
      }

      const teams = await db
        .select({
          id: schema.leagueTeams.id,
          name: schema.leagueTeams.name,
          division_id: schema.leagueTeams.division_id,
        })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.league_id, leagueId));

      const divisionTeams = new Map<number, typeof teams>();
      for (const t of teams) {
        const list = divisionTeams.get(t.division_id) ?? [];
        list.push(t);
        divisionTeams.set(t.division_id, list);
      }

      const teamSums = new Map<
        number,
        { values: number[]; gamesPlayed: number }
      >();
      for (const g of gamesWithResults) {
        const maxOrder = Math.max(
          g.team1_values.length,
          g.team2_values.length
        );
        for (let o = 0; o < maxOrder; o++) {
          const v1 = g.team1_values[o] ?? 0;
          const v2 = g.team2_values[o] ?? 0;
          for (const [teamId, vals] of [
            [g.team1_id, g.team1_values] as const,
            [g.team2_id, g.team2_values] as const,
          ]) {
            let cur = teamSums.get(teamId);
            if (!cur) {
              cur = { values: [], gamesPlayed: 0 };
              teamSums.set(teamId, cur);
            }
            while (cur.values.length <= o) cur.values.push(0);
            cur.values[o] = (cur.values[o] ?? 0) + (teamId === g.team1_id ? v1 : v2);
          }
        }
        const cur1 = teamSums.get(g.team1_id);
        const cur2 = teamSums.get(g.team2_id);
        if (cur1) cur1.gamesPlayed++;
        if (cur2) cur2.gamesPlayed++;
      }

      const standings: Array<{
        divisionId: number;
        divisionName: string;
        headToHeadFirst: boolean;
        resultLabels: string[] | null;
        rows: Array<{
          rank: number;
          teamId: number;
          teamName: string | null;
          divisionId: number;
          divisionName: string;
          tiebreakerValues: number[];
          gamesPlayed: number;
        }>;
      }> = [];

      for (const div of divisions) {
        const divTeams = divisionTeams.get(div.id) ?? [];
        const withSums = divTeams.map((t) => ({
          team: t,
          sums: teamSums.get(t.id) ?? { values: [], gamesPlayed: 0 },
        }));

        withSums.sort((a, b) => {
          const cmp = compareTiebreakerValues(a.sums.values, b.sums.values);
          if (cmp !== 0) return cmp;
          if (!headToHeadFirst) return 0;
          const ordered = orderByHeadToHead(
            [a.team.id, b.team.id],
            gamesWithResults
          );
          return ordered.indexOf(a.team.id) - ordered.indexOf(b.team.id);
        });

        if (headToHeadFirst) {
          const byKey = (vals: number[]) => vals.join(',');
          const groups: typeof withSums[] = [];
          let prevKey: string | null = null;
          let group: typeof withSums = [];
          for (const row of withSums) {
            const key = byKey(row.sums.values);
            if (key !== prevKey) {
              if (group.length > 0) groups.push(group);
              group = [row];
              prevKey = key;
            } else {
              group.push(row);
            }
          }
          if (group.length > 0) groups.push(group);
          const reordered: typeof withSums = [];
          for (const g of groups) {
            if (g.length <= 1) {
              reordered.push(...g);
              continue;
            }
            const ordered = orderByHeadToHead(
              g.map((x) => x.team.id),
              gamesWithResults
            );
            for (const id of ordered) {
              const r = g.find((x) => x.team.id === id);
              if (r) reordered.push(r);
            }
          }
          withSums.length = 0;
          withSums.push(...reordered);
        }

        let rank = 1;
        const rows = withSums.map((x, idx) => {
          const sameAsPrev =
            idx > 0 &&
            compareTiebreakerValues(withSums[idx - 1]!.sums.values, x.sums.values) === 0 &&
            (!headToHeadFirst ||
              orderByHeadToHead(
                [withSums[idx - 1]!.team.id, x.team.id],
                gamesWithResults
              ).length === 2);
          if (!sameAsPrev) rank = idx + 1;
          return {
            rank,
            teamId: x.team.id,
            teamName: x.team.name,
            divisionId: div.id,
            divisionName: div.name,
            tiebreakerValues: x.sums.values,
            gamesPlayed: x.sums.gamesPlayed,
          };
        });
        standings.push({
          divisionId: div.id,
          divisionName: div.name,
          headToHeadFirst,
          resultLabels,
          rows,
        });
      }
      return standings;
    }
  );

  // List league games with results (for schedule + results UI)
  fastify.get(
    '/leagues/:id/games/with-results',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            includeUnscheduled: { type: 'boolean' },
          },
        },
        response: { 200: gameListWithResultsResponseSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const leagueId = parseInt((request.params as { id: string }).id, 10);
      const query = z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          includeUnscheduled: z.coerce.boolean().optional(),
        })
        .parse(request.query ?? {});

      const { db, schema } = getDrizzleDb();
      const filters = [eq(schema.games.league_id, leagueId)];
      if (query.includeUnscheduled !== false) {
        // include both
      } else {
        filters.push(eq(schema.games.status, 'scheduled'));
      }
      if (query.startDate) filters.push(gte(schema.games.game_date, query.startDate));
      if (query.endDate) filters.push(lte(schema.games.game_date, query.endDate));
      const whereClause = and(...filters);

      const rows = await db
        .select({
          id: schema.games.id,
          league_id: schema.games.league_id,
          team1_id: schema.games.team1_id,
          team2_id: schema.games.team2_id,
          game_date: schema.games.game_date,
          game_time: schema.games.game_time,
          sheet_id: schema.games.sheet_id,
          status: schema.games.status,
          created_at: schema.games.created_at,
          updated_at: schema.games.updated_at,
          sheet_name: schema.sheets.name,
        })
        .from(schema.games)
        .leftJoin(schema.sheets, eq(schema.games.sheet_id, schema.sheets.id))
        .where(whereClause!)
        .orderBy(asc(schema.games.game_date), asc(schema.games.game_time), asc(schema.games.id));

      const teamIds = Array.from(new Set(rows.flatMap((r) => [r.team1_id, r.team2_id])));
      const teamNames = await loadTeamNames(db, schema, teamIds);

      const resultRows = await db
        .select({
          game_id: schema.gameResults.game_id,
          team_id: schema.gameResults.team_id,
          result_order: schema.gameResults.result_order,
          value: schema.gameResults.value,
        })
        .from(schema.gameResults)
        .where(inArray(schema.gameResults.game_id, rows.map((r) => r.id)));

      const resultByGame = new Map<number, Map<number, number[]>>();
      for (const r of resultRows) {
        let byTeam = resultByGame.get(r.game_id);
        if (!byTeam) {
          byTeam = new Map();
          resultByGame.set(r.game_id, byTeam);
        }
        let arr = byTeam.get(r.team_id) ?? [];
        arr[r.result_order] = r.value;
        byTeam.set(r.team_id, arr);
      }

      return rows.map((row) => {
        const t1v = resultByGame.get(row.id)?.get(row.team1_id) ?? [];
        const t2v = resultByGame.get(row.id)?.get(row.team2_id) ?? [];
        const hasResult = t1v.length > 0 || t2v.length > 0;
        const maxLen = Math.max(t1v.length, t2v.length);
        const team1Results = Array.from({ length: maxLen }, (_, i) => t1v[i] ?? 0);
        const team2Results = Array.from({ length: maxLen }, (_, i) => t2v[i] ?? 0);
        return {
          id: row.id,
          leagueId: row.league_id,
          team1Id: row.team1_id,
          team2Id: row.team2_id,
          team1Name: teamNames.get(row.team1_id) ?? null,
          team2Name: teamNames.get(row.team2_id) ?? null,
          gameDate: row.game_date ? formatDateValue(row.game_date) : null,
          gameTime: row.game_time ? formatTimeValue(row.game_time) : null,
          sheetId: row.sheet_id,
          sheetName: row.sheet_name,
          status: row.status,
          hasResult,
          team1Results,
          team2Results,
        };
      });
    }
  );

  // Team stats (games played, wins, losses, ties) — derived from game_results using first tiebreaker as W/L/T
  fastify.get(
    '/teams/:teamId/stats',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { teamId: { type: 'string' } },
          required: ['teamId'],
        },
        response: { 200: teamStatsSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const teamId = parseInt((request.params as { teamId: string }).teamId, 10);
      const { db, schema } = getDrizzleDb();

      const teamRows = await db
        .select({ id: schema.leagueTeams.id, name: schema.leagueTeams.name })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.id, teamId))
        .limit(1);
      const team = teamRows[0];
      if (!team) return reply.code(404).send({ error: 'Team not found.' });

      const games = await db
        .select({
          id: schema.games.id,
          team1_id: schema.games.team1_id,
          team2_id: schema.games.team2_id,
        })
        .from(schema.games)
        .where(or(eq(schema.games.team1_id, teamId), eq(schema.games.team2_id, teamId)));
      const gameIds = games.map((g) => g.id);
      if (gameIds.length === 0) {
        return {
          teamId,
          teamName: team.name,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          ties: 0,
        };
      }

      const results = await db
        .select({
          game_id: schema.gameResults.game_id,
          team_id: schema.gameResults.team_id,
          result_order: schema.gameResults.result_order,
          value: schema.gameResults.value,
        })
        .from(schema.gameResults)
        .where(inArray(schema.gameResults.game_id, gameIds));

      let wins = 0;
      let losses = 0;
      let ties = 0;
      const byGame = new Map<number, Map<number, number[]>>();
      for (const r of results) {
        let byTeam = byGame.get(r.game_id);
        if (!byTeam) {
          byTeam = new Map();
          byGame.set(r.game_id, byTeam);
        }
        let arr = byTeam.get(r.team_id) ?? [];
        arr[r.result_order] = r.value;
        byTeam.set(r.team_id, arr);
      }
      for (const g of games) {
        const t1 = byGame.get(g.id)?.get(g.team1_id) ?? [];
        const t2 = byGame.get(g.id)?.get(g.team2_id) ?? [];
        const myVal = g.team1_id === teamId ? t1[0] ?? 0 : t2[0] ?? 0;
        const oppVal = g.team1_id === teamId ? t2[0] ?? 0 : t1[0] ?? 0;
        if (myVal > oppVal) wins++;
        else if (myVal < oppVal) losses++;
        else ties++;
      }
      return {
        teamId,
        teamName: team.name,
        gamesPlayed: games.length,
        wins,
        losses,
        ties,
      };
    }
  );

  // League member stats (from game_lineups)
  fastify.get(
    '/leagues/:id/member-stats',
    {
      schema: {
        tags: ['results'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: memberStatsListResponseSchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });

      const leagueId = parseInt((request.params as { id: string }).id, 10);
      const { db, schema } = getDrizzleDb();

      const gameIds = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.league_id, leagueId));
      const ids = gameIds.map((r) => r.id);
      if (ids.length === 0) return [];

      const results = await db
        .select({
          game_id: schema.gameResults.game_id,
          team_id: schema.gameResults.team_id,
          result_order: schema.gameResults.result_order,
          value: schema.gameResults.value,
        })
        .from(schema.gameResults)
        .where(inArray(schema.gameResults.game_id, ids));

      const gameTeamMap = new Map<number, { team1_id: number; team2_id: number }>();
      const gameRows = await db
        .select({ id: schema.games.id, team1_id: schema.games.team1_id, team2_id: schema.games.team2_id })
        .from(schema.games)
        .where(inArray(schema.games.id, ids));
      gameRows.forEach((g) => gameTeamMap.set(g.id, { team1_id: g.team1_id, team2_id: g.team2_id }));

      const lineupFull = await db
        .select({
          game_id: schema.gameLineups.game_id,
          member_id: schema.gameLineups.member_id,
          team_id: schema.gameLineups.team_id,
        })
        .from(schema.gameLineups)
        .where(inArray(schema.gameLineups.game_id, ids));

      const resultByGameTeam = new Map<string, number[]>(); // "gameId_teamId" -> values
      for (const r of results) {
        const key = `${r.game_id}_${r.team_id}`;
        let arr = resultByGameTeam.get(key) ?? [];
        arr[r.result_order] = r.value;
        resultByGameTeam.set(key, arr);
      }

      const memberGames = new Map<
        number,
        { wins: number; losses: number; ties: number }
      >();
      for (const l of lineupFull) {
        let cur = memberGames.get(l.member_id);
        if (!cur) {
          cur = { wins: 0, losses: 0, ties: 0 };
          memberGames.set(l.member_id, cur);
        }
        const key = `${l.game_id}_${l.team_id}`;
        const myVals = resultByGameTeam.get(key) ?? [];
        const game = gameTeamMap.get(l.game_id)!;
        const oppTeamId = l.team_id === game.team1_id ? game.team2_id : game.team1_id;
        const oppKey = `${l.game_id}_${oppTeamId}`;
        const oppVals = resultByGameTeam.get(oppKey) ?? [];
        const myFirst = myVals[0] ?? 0;
        const oppFirst = oppVals[0] ?? 0;
        if (myFirst > oppFirst) cur.wins++;
        else if (myFirst < oppFirst) cur.losses++;
        else cur.ties++;
      }

      const memberIds = Array.from(memberGames.keys());
      if (memberIds.length === 0) return [];
      const names = await db
        .select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(inArray(schema.members.id, memberIds));
      const nameMap = new Map(names.map((n) => [n.id, n.name]));

      return memberIds.map((memberId) => {
        const g = memberGames.get(memberId)!;
        const gamesPlayed = g.wins + g.losses + g.ties;
        return {
          memberId,
          memberName: nameMap.get(memberId) ?? '',
          gamesPlayed,
          wins: g.wins,
          losses: g.losses,
          ties: g.ties,
        };
      });
    }
  );
}
