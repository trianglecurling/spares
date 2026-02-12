import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { successResponseSchema } from '../api/schemas.js';
import {
  drawAvailabilityUpdateBodySchema,
  drawSlotListResponseSchema,
  extraDrawCreateBodySchema,
  extraDrawResponseSchema,
  gameBulkCreateBodySchema,
  gameCreateBodySchema,
  gameListResponseSchema,
  gameSchema,
  gameUpdateBodySchema,
  memberUpcomingGamesResponseSchema,
} from '../api/leagueScheduleSchemas.js';
import { hasLeagueSetupAccess } from '../utils/leagueAccess.js';
import { getCurrentDateStringAsync } from '../utils/time.js';

type DrizzleDb = ReturnType<typeof getDrizzleDb>['db'];
type DrizzleSchema = ReturnType<typeof getDrizzleDb>['schema'];

const gameCreateSchema = z.object({
  team1Id: z.number().int().positive(),
  team2Id: z.number().int().positive(),
  gameDate: z.string().optional().nullable(),
  gameTime: z.string().optional().nullable(),
  sheetId: z.number().int().positive().optional().nullable(),
  status: z.enum(['scheduled', 'unscheduled']).optional(),
});

const gameUpdateSchema = z.object({
  team1Id: z.number().int().positive().optional(),
  team2Id: z.number().int().positive().optional(),
  gameDate: z.string().optional().nullable(),
  gameTime: z.string().optional().nullable(),
  sheetId: z.number().int().positive().optional().nullable(),
  status: z.enum(['scheduled', 'unscheduled']).optional(),
});

const gameBulkCreateSchema = z.object({
  games: z
    .array(
      z.object({
        team1Id: z.number().int().positive(),
        team2Id: z.number().int().positive(),
        gameDate: z.string().optional().nullable(),
        gameTime: z.string().optional().nullable(),
        sheetId: z.number().int().positive().optional().nullable(),
        status: z.enum(['scheduled', 'unscheduled']).optional(),
      })
    )
    .min(1),
});

const drawSlotQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const gameListQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeUnscheduled: z.coerce.boolean().optional(),
});

const extraDrawCreateSchema = z.object({
  date: z.string(),
  time: z.string(),
});

const drawAvailabilityUpdateSchema = z.object({
  date: z.string(),
  time: z.string(),
  sheets: z.array(
    z.object({
      sheetId: z.number().int().positive(),
      isAvailable: z.boolean(),
    })
  ),
});

function toDateParts(value: string) {
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  return { year, month, day };
}

function formatDateString(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
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

async function ensureTeamsBelongToLeague(
  db: DrizzleDb,
  schema: DrizzleSchema,
  leagueId: number,
  teamIds: number[]
): Promise<void> {
  const teams = await db
    .select({ id: schema.leagueTeams.id, league_id: schema.leagueTeams.league_id })
    .from(schema.leagueTeams)
    .where(inArray(schema.leagueTeams.id, teamIds));

  if (teams.length !== teamIds.length) {
    throw new Error('One or more teams not found.');
  }
  if (!teams.every((team) => team.league_id === leagueId)) {
    throw new Error('Both teams must belong to the same league.');
  }
}

async function ensureSheetAvailable(
  db: DrizzleDb,
  schema: DrizzleSchema,
  leagueId: number,
  gameDate: string,
  gameTime: string,
  sheetId: number,
  excludeGameId?: number
): Promise<void> {
  const sheetRows = await db
    .select({ id: schema.sheets.id, is_active: schema.sheets.is_active })
    .from(schema.sheets)
    .where(eq(schema.sheets.id, sheetId))
    .limit(1);

  if (sheetRows.length === 0 || sheetRows[0].is_active !== 1) {
    throw new Error('Selected sheet is not available.');
  }

  const sheetConflicts = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.sheet_id, sheetId),
        eq(schema.games.game_date, gameDate),
        sql`substr(CAST(${schema.games.game_time} AS TEXT), 1, 5) = ${gameTime}`,
        excludeGameId ? ne(schema.games.id, excludeGameId) : sql`1=1`
      )
    )
    .limit(1);

  if (sheetConflicts.length > 0) {
    throw new Error('Another game is already scheduled on that sheet at this time.');
  }

  const availabilityRows = await db
    .select({ is_available: schema.drawSheetAvailability.is_available })
    .from(schema.drawSheetAvailability)
    .where(
      and(
        eq(schema.drawSheetAvailability.league_id, leagueId),
        eq(schema.drawSheetAvailability.draw_date, gameDate),
        eq(schema.drawSheetAvailability.draw_time, gameTime),
        eq(schema.drawSheetAvailability.sheet_id, sheetId)
      )
    )
    .limit(1);

  if (availabilityRows.length > 0 && availabilityRows[0].is_available === 0) {
    throw new Error('That sheet is unavailable for the selected draw.');
  }
}

async function ensureTeamsAvailable(
  db: DrizzleDb,
  schema: DrizzleSchema,
  gameDate: string,
  gameTime: string,
  teamIds: number[],
  excludeGameId?: number
): Promise<void> {
  const conflict = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.game_date, gameDate),
        sql`substr(CAST(${schema.games.game_time} AS TEXT), 1, 5) = ${gameTime}`,
        or(
          inArray(schema.games.team1_id, teamIds),
          inArray(schema.games.team2_id, teamIds)
        ),
        excludeGameId ? ne(schema.games.id, excludeGameId) : sql`1=1`
      )
    )
    .limit(1);

  if (conflict.length > 0) {
    throw new Error('One or more teams already have a game at this time.');
  }
}

function buildGameResponse(
  row: {
  id: number;
  league_id: number;
  team1_id: number;
  team2_id: number;
  game_date: unknown;
  game_time: unknown;
  sheet_id: number | null;
  status: 'scheduled' | 'unscheduled';
  created_at: unknown;
  updated_at: unknown;
  sheet_name: string | null;
  },
  teamNames: Map<number, string>
) {
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : null,
  };
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

async function getGameById(
  db: DrizzleDb,
  schema: DrizzleSchema,
  gameId: number
): Promise<ReturnType<typeof buildGameResponse> | null> {
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
    .where(eq(schema.games.id, gameId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const teamNames = await loadTeamNames(db, schema, [row.team1_id, row.team2_id]);
  return buildGameResponse(row, teamNames);
}

async function computeDrawSlots(
  db: DrizzleDb,
  schema: DrizzleSchema,
  leagueId: number,
  startDateOverride?: string,
  endDateOverride?: string
) {
  const leagueRows = await db
    .select({
      id: schema.leagues.id,
      day_of_week: schema.leagues.day_of_week,
      start_date: schema.leagues.start_date,
      end_date: schema.leagues.end_date,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  const league = leagueRows[0];
  if (!league) {
    throw new Error('League not found.');
  }

  const drawTimes = await db
    .select({ draw_time: schema.leagueDrawTimes.draw_time })
    .from(schema.leagueDrawTimes)
    .where(eq(schema.leagueDrawTimes.league_id, leagueId))
    .orderBy(asc(schema.leagueDrawTimes.draw_time));

  const exceptionsRows = await db
    .select({ exception_date: schema.leagueExceptions.exception_date })
    .from(schema.leagueExceptions)
    .where(eq(schema.leagueExceptions.league_id, leagueId));
  const exceptions = new Set(exceptionsRows.map((row) => formatDateValue(row.exception_date)));

  const extraDrawRows = await db
    .select({
      id: schema.leagueExtraDraws.id,
      draw_date: schema.leagueExtraDraws.draw_date,
      draw_time: schema.leagueExtraDraws.draw_time,
    })
    .from(schema.leagueExtraDraws)
    .where(eq(schema.leagueExtraDraws.league_id, leagueId));

  const startDate = startDateOverride ?? formatDateValue(league.start_date);
  const endDate = endDateOverride ?? formatDateValue(league.end_date);

  const regularSlots: Array<{ date: string; time: string; isExtra: boolean; extraDrawId: number | null }> = [];
  if (drawTimes.length > 0) {
    const targetDay = league.day_of_week;
    const startDay = getDayOfWeek(startDate);
    const daysUntilTarget = (targetDay - startDay + 7) % 7;
    let currentDate = addDays(startDate, daysUntilTarget);

    while (currentDate <= endDate) {
      if (!exceptions.has(currentDate)) {
        for (const dt of drawTimes) {
          regularSlots.push({
            date: currentDate,
            time: formatTimeValue(dt.draw_time),
            isExtra: false,
            extraDrawId: null,
          });
        }
      }
      currentDate = addDays(currentDate, 7);
    }
  }

  const slotMap = new Map<string, { date: string; time: string; isExtra: boolean; extraDrawId: number | null }>();
  for (const slot of regularSlots) {
    slotMap.set(`${slot.date}|${slot.time}`, slot);
  }

  for (const extra of extraDrawRows) {
    const date = formatDateValue(extra.draw_date);
    const time = formatTimeValue(extra.draw_time);
    if (date < startDate || date > endDate) continue;
    const key = `${date}|${time}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, { date, time, isExtra: true, extraDrawId: extra.id });
    }
  }

  const slots = Array.from(slotMap.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  const sheetRows = await db
    .select({ id: schema.sheets.id, name: schema.sheets.name, sort_order: schema.sheets.sort_order, is_active: schema.sheets.is_active })
    .from(schema.sheets)
    .orderBy(schema.sheets.sort_order, schema.sheets.name);
  const activeSheets = sheetRows.filter((sheet) => sheet.is_active === 1);

  const availabilityRows = await db
    .select({
      draw_date: schema.drawSheetAvailability.draw_date,
      draw_time: schema.drawSheetAvailability.draw_time,
      sheet_id: schema.drawSheetAvailability.sheet_id,
      is_available: schema.drawSheetAvailability.is_available,
    })
    .from(schema.drawSheetAvailability)
    .where(
      and(
        eq(schema.drawSheetAvailability.league_id, leagueId),
        gte(schema.drawSheetAvailability.draw_date, startDate),
        lte(schema.drawSheetAvailability.draw_date, endDate)
      )
    );

  const availabilityMap = new Map<string, Map<number, boolean>>();
  for (const row of availabilityRows) {
    const key = `${formatDateValue(row.draw_date)}|${formatTimeValue(row.draw_time)}`;
    const sheetMap = availabilityMap.get(key) ?? new Map<number, boolean>();
    sheetMap.set(row.sheet_id, row.is_available === 1);
    availabilityMap.set(key, sheetMap);
  }

  return slots.map((slot) => {
    const sheetMap = availabilityMap.get(`${slot.date}|${slot.time}`) ?? new Map<number, boolean>();
    return {
      ...slot,
      sheets: activeSheets.map((sheet) => ({
        id: sheet.id,
        name: sheet.name,
        isAvailable: sheetMap.get(sheet.id) ?? true,
      })),
    };
  });
}

async function isValidDrawSlot(
  db: DrizzleDb,
  schema: DrizzleSchema,
  leagueId: number,
  date: string,
  time: string
): Promise<boolean> {
  const extra = await db
    .select({ id: schema.leagueExtraDraws.id })
    .from(schema.leagueExtraDraws)
    .where(
      and(
        eq(schema.leagueExtraDraws.league_id, leagueId),
        eq(schema.leagueExtraDraws.draw_date, date),
        eq(schema.leagueExtraDraws.draw_time, time)
      )
    )
    .limit(1);
  if (extra.length > 0) return true;

  const leagueRows = await db
    .select({
      day_of_week: schema.leagues.day_of_week,
      start_date: schema.leagues.start_date,
      end_date: schema.leagues.end_date,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  const league = leagueRows[0];
  if (!league) return false;

  const startDate = formatDateValue(league.start_date);
  const endDate = formatDateValue(league.end_date);
  if (date < startDate || date > endDate) return false;
  if (getDayOfWeek(date) !== league.day_of_week) return false;

  const exceptionRows = await db
    .select({ id: schema.leagueExceptions.id })
    .from(schema.leagueExceptions)
    .where(and(eq(schema.leagueExceptions.league_id, leagueId), eq(schema.leagueExceptions.exception_date, date)))
    .limit(1);
  if (exceptionRows.length > 0) return false;

  const drawTimes = await db
    .select({ draw_time: schema.leagueDrawTimes.draw_time })
    .from(schema.leagueDrawTimes)
    .where(eq(schema.leagueDrawTimes.league_id, leagueId));

  return drawTimes.some((dt) => formatTimeValue(dt.draw_time) === time);
}

export async function gameRoutes(fastify: FastifyInstance) {
  // List games for a league
  fastify.get(
    '/leagues/:id/games',
    {
      schema: {
        tags: ['games'],
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
        response: {
          200: gameListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      const query = gameListQuerySchema.parse(request.query ?? {});
      const includeUnscheduled = query.includeUnscheduled !== false;
      const { db, schema } = getDrizzleDb();

      const filters = [eq(schema.games.league_id, leagueId)];
      if (!includeUnscheduled) {
        filters.push(eq(schema.games.status, 'scheduled'));
      }

      if (query.startDate || query.endDate) {
        const rangeFilters: Array<ReturnType<typeof gte>> = [];
        if (query.startDate) {
          rangeFilters.push(gte(schema.games.game_date, query.startDate));
        }
        if (query.endDate) {
          rangeFilters.push(lte(schema.games.game_date, query.endDate));
        }
        if (rangeFilters.length > 0) {
          const range = rangeFilters.length === 1 ? rangeFilters[0]! : and(...rangeFilters)!;
          const scheduleFilter = includeUnscheduled
            ? or(range, isNull(schema.games.game_date))
            : range;
          filters.push(scheduleFilter!);
        }
      }

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
        .where(and(...filters))
        .orderBy(asc(schema.games.game_date), asc(schema.games.game_time), asc(schema.games.id));

      const teamIds = Array.from(new Set(rows.flatMap((row) => [row.team1_id, row.team2_id])));
      const teamNames = await loadTeamNames(db, schema, teamIds);
      return rows.map((row) => buildGameResponse(row, teamNames));
    }
  );

  // Create game
  fastify.post(
    '/leagues/:id/games',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: gameCreateBodySchema,
        response: {
          200: gameSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = gameCreateSchema.parse(request.body);
      if (body.team1Id === body.team2Id) {
        return reply.code(400).send({ error: 'Teams must be different.' });
      }

      const { db, schema } = getDrizzleDb();
      try {
        await ensureTeamsBelongToLeague(db, schema, leagueId, [body.team1Id, body.team2Id]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid teams.';
        return reply.code(400).send({ error: message });
      }

      const hasScheduleFields =
        body.gameDate !== undefined || body.gameTime !== undefined || body.sheetId !== undefined;
      const status = body.status ?? (hasScheduleFields ? 'scheduled' : 'unscheduled');

      let gameDate: string | null = body.gameDate ?? null;
      let gameTime: string | null = body.gameTime ?? null;
      let sheetId: number | null = body.sheetId ?? null;

      if (status === 'unscheduled') {
        gameDate = null;
        gameTime = null;
        sheetId = null;
      }

      if (status === 'scheduled') {
        if (!gameDate || !gameTime || !sheetId) {
          return reply.code(400).send({ error: 'Scheduled games require date, time, and sheet.' });
        }
        try {
          await ensureSheetAvailable(db, schema, leagueId, gameDate, gameTime, sheetId);
          await ensureTeamsAvailable(db, schema, gameDate, gameTime, [body.team1Id, body.team2Id]);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Invalid schedule.';
          return reply.code(400).send({ error: message });
        }
      } else if (hasScheduleFields) {
        return reply.code(400).send({ error: 'Unscheduled games cannot include date/time/sheet.' });
      }

      const result = await db
        .insert(schema.games)
        .values({
          league_id: leagueId,
          team1_id: body.team1Id,
          team2_id: body.team2Id,
          game_date: gameDate,
          game_time: gameTime,
          sheet_id: sheetId,
          status,
        })
        .returning();

      const game = await getGameById(db, schema, result[0].id);
      return game;
    }
  );

  // Bulk create games
  fastify.post(
    '/leagues/:id/games/bulk',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: gameBulkCreateBodySchema,
        response: {
          200: gameListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = gameBulkCreateSchema.parse(request.body);

      // Validate: no self-matchups
      for (let i = 0; i < body.games.length; i++) {
        const g = body.games[i];
        if (g.team1Id === g.team2Id) {
          return reply.code(400).send({ error: `Game ${i + 1}: teams must be different.` });
        }
      }

      const { db, schema } = getDrizzleDb();

      // Validate: all teams belong to the league
      const allTeamIds = Array.from(
        new Set(body.games.flatMap((g) => [g.team1Id, g.team2Id]))
      );
      try {
        await ensureTeamsBelongToLeague(db, schema, leagueId, allTeamIds);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid teams.';
        return reply.code(400).send({ error: message });
      }

      // Prepare rows and validate scheduled games
      const rows: Array<{
        league_id: number;
        team1_id: number;
        team2_id: number;
        game_date: string | null;
        game_time: string | null;
        sheet_id: number | null;
        status: 'scheduled' | 'unscheduled';
      }> = [];

      // Track within-batch conflicts
      const batchSlots = new Set<string>(); // "date|time|sheetId"
      const batchTeamTimes = new Map<string, Set<number>>(); // "date|time" -> team ids

      for (let i = 0; i < body.games.length; i++) {
        const g = body.games[i];
        const hasScheduleFields =
          g.gameDate !== undefined || g.gameTime !== undefined || g.sheetId !== undefined;
        const status = g.status ?? (hasScheduleFields ? 'scheduled' : 'unscheduled');

        let gameDate: string | null = g.gameDate ?? null;
        let gameTime: string | null = g.gameTime ?? null;
        let sheetId: number | null = g.sheetId ?? null;

        if (status === 'unscheduled') {
          gameDate = null;
          gameTime = null;
          sheetId = null;
        }

        if (status === 'scheduled') {
          if (!gameDate || !gameTime || !sheetId) {
            return reply.code(400).send({ error: `Game ${i + 1}: scheduled games require date, time, and sheet.` });
          }

          // Within-batch sheet conflict
          const slotKey = `${gameDate}|${gameTime}|${sheetId}`;
          if (batchSlots.has(slotKey)) {
            return reply.code(400).send({ error: `Game ${i + 1}: duplicate sheet/time assignment within batch.` });
          }
          batchSlots.add(slotKey);

          // Within-batch team-time conflict
          const timeKey = `${gameDate}|${gameTime}`;
          if (!batchTeamTimes.has(timeKey)) batchTeamTimes.set(timeKey, new Set());
          const teamsAtTime = batchTeamTimes.get(timeKey)!;
          if (teamsAtTime.has(g.team1Id) || teamsAtTime.has(g.team2Id)) {
            return reply.code(400).send({ error: `Game ${i + 1}: team already has a game at this time in the batch.` });
          }
          teamsAtTime.add(g.team1Id);
          teamsAtTime.add(g.team2Id);

          // Validate against existing games in the database
          try {
            await ensureSheetAvailable(db, schema, leagueId, gameDate, gameTime, sheetId);
            await ensureTeamsAvailable(db, schema, gameDate, gameTime, [g.team1Id, g.team2Id]);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Invalid schedule.';
            return reply.code(400).send({ error: `Game ${i + 1}: ${message}` });
          }
        } else if (hasScheduleFields) {
          return reply.code(400).send({ error: `Game ${i + 1}: unscheduled games cannot include date/time/sheet.` });
        }

        rows.push({
          league_id: leagueId,
          team1_id: g.team1Id,
          team2_id: g.team2Id,
          game_date: gameDate,
          game_time: gameTime,
          sheet_id: sheetId,
          status,
        });
      }

      // Insert all games in a transaction
      const insertedIds: number[] = [];
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const inserted = await tx
            .insert(schema.games)
            .values(row)
            .returning({ id: schema.games.id });
          insertedIds.push(inserted[0].id);
        }
      });

      // Load all created games with team names
      const allGames = await db
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
        .where(inArray(schema.games.id, insertedIds))
        .orderBy(asc(schema.games.game_date), asc(schema.games.game_time), asc(schema.games.id));

      const teamNames = await loadTeamNames(db, schema, allTeamIds);
      return allGames.map((row) => buildGameResponse(row, teamNames));
    }
  );

  // Update game
  fastify.patch(
    '/games/:gameId',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        body: gameUpdateBodySchema,
        response: {
          200: gameSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { gameId } = request.params as { gameId: string };
      const id = parseInt(gameId, 10);
      const body = gameUpdateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();

      const gameRows = await db
        .select()
        .from(schema.games)
        .where(eq(schema.games.id, id))
        .limit(1);
      const existing = gameRows[0];
      if (!existing) {
        return reply.code(404).send({ error: 'Game not found.' });
      }

      if (!(await hasLeagueSetupAccess(member, existing.league_id))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const team1Id = body.team1Id ?? existing.team1_id;
      const team2Id = body.team2Id ?? existing.team2_id;

      if (team1Id === team2Id) {
        return reply.code(400).send({ error: 'Teams must be different.' });
      }

      try {
        await ensureTeamsBelongToLeague(db, schema, existing.league_id, [team1Id, team2Id]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid teams.';
        return reply.code(400).send({ error: message });
      }

      const nextDate = body.gameDate !== undefined ? body.gameDate : existing.game_date;
      const nextTime = body.gameTime !== undefined ? body.gameTime : existing.game_time;
      const nextSheetId = body.sheetId !== undefined ? body.sheetId : existing.sheet_id;
      const status = body.status ?? existing.status;

      const hasScheduleChange =
        body.gameDate !== undefined || body.gameTime !== undefined || body.sheetId !== undefined;

      let gameDate: string | null = nextDate ? String(nextDate) : null;
      let gameTime: string | null = nextTime ? String(nextTime) : null;
      let sheetId: number | null = nextSheetId ?? null;

      if (status === 'unscheduled') {
        gameDate = null;
        gameTime = null;
        sheetId = null;
      } else if (hasScheduleChange) {
        if (!gameDate || !gameTime || !sheetId) {
          return reply.code(400).send({ error: 'Scheduled games require date, time, and sheet.' });
        }
      }

      if (status === 'scheduled') {
        if (!gameDate || !gameTime || !sheetId) {
          return reply.code(400).send({ error: 'Scheduled games require date, time, and sheet.' });
        }
        try {
          await ensureSheetAvailable(db, schema, existing.league_id, gameDate, gameTime, sheetId, id);
          await ensureTeamsAvailable(db, schema, gameDate, gameTime, [team1Id, team2Id], id);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Invalid schedule.';
          return reply.code(400).send({ error: message });
        }
      } else if (hasScheduleChange && (gameDate || gameTime || sheetId)) {
        return reply.code(400).send({ error: 'Unscheduled games cannot include date/time/sheet.' });
      }

      await db
        .update(schema.games)
        .set({
          team1_id: team1Id,
          team2_id: team2Id,
          game_date: gameDate,
          game_time: gameTime,
          sheet_id: sheetId,
          status,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.games.id, id));

      const updated = await getGameById(db, schema, id);
      return updated;
    }
  );

  // Delete game
  fastify.delete(
    '/games/:gameId',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { gameId: { type: 'string' } },
          required: ['gameId'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { gameId } = request.params as { gameId: string };
      const id = parseInt(gameId, 10);
      const { db, schema } = getDrizzleDb();

      const gameRows = await db
        .select({ league_id: schema.games.league_id })
        .from(schema.games)
        .where(eq(schema.games.id, id))
        .limit(1);
      const game = gameRows[0];
      if (!game) {
        return reply.code(404).send({ error: 'Game not found.' });
      }
      if (!(await hasLeagueSetupAccess(member, game.league_id))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      await db.delete(schema.games).where(eq(schema.games.id, id));
      return { success: true };
    }
  );

  // Draw slots (computed from league rules + overrides)
  fastify.get(
    '/leagues/:id/draw-slots',
    {
      schema: {
        tags: ['games'],
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
          },
        },
        response: {
          200: drawSlotListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      const query = drawSlotQuerySchema.parse(request.query ?? {});
      const { db, schema } = getDrizzleDb();

      try {
        const slots = await computeDrawSlots(db, schema, leagueId, query.startDate, query.endDate);
        return slots;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load draw slots.';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // Create extra draw
  fastify.post(
    '/leagues/:id/extra-draws',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: extraDrawCreateBodySchema,
        response: {
          200: extraDrawResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = extraDrawCreateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();

      const isRegularDraw = await isValidDrawSlot(db, schema, leagueId, body.date, body.time);
      if (isRegularDraw) {
        return reply.code(400).send({ error: 'That draw already exists in the league schedule.' });
      }

      const existing = await db
        .select({ id: schema.leagueExtraDraws.id })
        .from(schema.leagueExtraDraws)
        .where(
          and(
            eq(schema.leagueExtraDraws.league_id, leagueId),
            eq(schema.leagueExtraDraws.draw_date, body.date),
            eq(schema.leagueExtraDraws.draw_time, body.time)
          )
        )
        .limit(1);
      if (existing.length > 0) {
        return reply.code(409).send({ error: 'Extra draw already exists.' });
      }

      const result = await db
        .insert(schema.leagueExtraDraws)
        .values({
          league_id: leagueId,
          draw_date: body.date,
          draw_time: body.time,
        })
        .returning();

      return {
        id: result[0].id,
        leagueId,
        date: body.date,
        time: body.time,
      };
    }
  );

  // Delete extra draw
  fastify.delete(
    '/leagues/:leagueId/extra-draws/:drawId',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { leagueId: { type: 'string' }, drawId: { type: 'string' } },
          required: ['leagueId', 'drawId'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { leagueId: leagueIdRaw, drawId } = request.params as { leagueId: string; drawId: string };
      const leagueId = parseInt(leagueIdRaw, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const { db, schema } = getDrizzleDb();
      const extraDrawRows = await db
        .select({
          id: schema.leagueExtraDraws.id,
          draw_date: schema.leagueExtraDraws.draw_date,
          draw_time: schema.leagueExtraDraws.draw_time,
        })
        .from(schema.leagueExtraDraws)
        .where(
          and(
            eq(schema.leagueExtraDraws.id, parseInt(drawId, 10)),
            eq(schema.leagueExtraDraws.league_id, leagueId)
          )
        )
        .limit(1);

      const extraDraw = extraDrawRows[0];
      if (!extraDraw) {
        return reply.code(404).send({ error: 'Extra draw not found.' });
      }

      const drawDate = formatDateValue(extraDraw.draw_date);
      const drawTime = formatTimeValue(extraDraw.draw_time);

      await db
        .update(schema.games)
        .set({
          game_date: null,
          game_time: null,
          sheet_id: null,
          status: 'unscheduled',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(schema.games.league_id, leagueId),
            eq(schema.games.game_date, drawDate),
            eq(schema.games.game_time, drawTime)
          )
        );

      await db
        .delete(schema.leagueExtraDraws)
        .where(and(eq(schema.leagueExtraDraws.id, extraDraw.id), eq(schema.leagueExtraDraws.league_id, leagueId)));

      return { success: true };
    }
  );

  // Update draw sheet availability
  fastify.put(
    '/leagues/:id/draws/availability',
    {
      schema: {
        tags: ['games'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: drawAvailabilityUpdateBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };
      const leagueId = parseInt(id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = drawAvailabilityUpdateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();

      const isValid = await isValidDrawSlot(db, schema, leagueId, body.date, body.time);
      if (!isValid) {
        return reply.code(400).send({ error: 'Draw slot not found for this league.' });
      }

      const sheetIds = body.sheets.map((sheet) => sheet.sheetId);
      if (sheetIds.length > 0) {
        const sheetRows = await db
          .select({ id: schema.sheets.id, is_active: schema.sheets.is_active })
          .from(schema.sheets)
          .where(inArray(schema.sheets.id, sheetIds));

        if (sheetRows.length !== sheetIds.length) {
          return reply.code(400).send({ error: 'Invalid sheet selection.' });
        }
        if (sheetRows.some((sheet) => sheet.is_active !== 1)) {
          return reply.code(400).send({ error: 'Inactive sheets cannot be scheduled.' });
        }
      }

      const blockedSheetIds = body.sheets.filter((sheet) => !sheet.isAvailable).map((sheet) => sheet.sheetId);
      if (blockedSheetIds.length > 0) {
        const conflicts = await db
          .select({ id: schema.games.id })
          .from(schema.games)
          .where(
            and(
              eq(schema.games.game_date, body.date),
              eq(schema.games.game_time, body.time),
              inArray(schema.games.sheet_id, blockedSheetIds)
            )
          )
          .limit(1);

        if (conflicts.length > 0) {
          return reply.code(400).send({ error: 'One or more sheets already have scheduled games.' });
        }
      }

      await db
        .delete(schema.drawSheetAvailability)
        .where(
          and(
            eq(schema.drawSheetAvailability.league_id, leagueId),
            eq(schema.drawSheetAvailability.draw_date, body.date),
            eq(schema.drawSheetAvailability.draw_time, body.time)
          )
        );

      if (body.sheets.length > 0) {
        await db.insert(schema.drawSheetAvailability).values(
          body.sheets.map((sheet) => ({
            league_id: leagueId,
            draw_date: body.date,
            draw_time: body.time,
            sheet_id: sheet.sheetId,
            is_available: sheet.isAvailable ? 1 : 0,
          }))
        );
      }

      return { success: true };
    }
  );

  // Upcoming games for the current member
  fastify.get(
    '/members/me/upcoming-games',
    {
      schema: {
        tags: ['games'],
        response: {
          200: memberUpcomingGamesResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { db, schema } = getDrizzleDb();
      const teamRows = await db
        .select({ team_id: schema.teamMembers.team_id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.member_id, member.id));

      const teamIds = teamRows.map((row) => row.team_id);
      if (teamIds.length === 0) {
        return [];
      }

      const today = await getCurrentDateStringAsync();
      const endDate = addDays(today, 6); // 7 days total: today + 6 more
      const rows = await db
        .select({
          id: schema.games.id,
          league_id: schema.games.league_id,
          league_name: schema.leagues.name,
          team1_id: schema.games.team1_id,
          team2_id: schema.games.team2_id,
          game_date: schema.games.game_date,
          game_time: schema.games.game_time,
          sheet_id: schema.games.sheet_id,
          sheet_name: schema.sheets.name,
        })
        .from(schema.games)
        .innerJoin(schema.leagues, eq(schema.games.league_id, schema.leagues.id))
        .leftJoin(schema.sheets, eq(schema.games.sheet_id, schema.sheets.id))
        .where(
          and(
            eq(schema.games.status, 'scheduled'),
            or(inArray(schema.games.team1_id, teamIds), inArray(schema.games.team2_id, teamIds)),
            gte(schema.games.game_date, today),
            lte(schema.games.game_date, endDate)
          )
        )
        .orderBy(asc(schema.games.game_date), asc(schema.games.game_time), asc(schema.games.id));

      const gameTeamIds = Array.from(new Set(rows.flatMap((row) => [row.team1_id, row.team2_id])));
      const teamNames = await loadTeamNames(db, schema, gameTeamIds);
      return rows.map((row) => {
        const team1InMyTeams = teamIds.includes(row.team1_id);
        const opponentTeamId = team1InMyTeams ? row.team2_id : row.team1_id;
        const opponentName = teamNames.get(opponentTeamId) ?? null;
        return {
          id: row.id,
          leagueId: row.league_id,
          leagueName: row.league_name,
          team1Id: row.team1_id,
          team2Id: row.team2_id,
          team1Name: teamNames.get(row.team1_id) ?? null,
          team2Name: teamNames.get(row.team2_id) ?? null,
          gameDate: row.game_date ? formatDateValue(row.game_date) : null,
          gameTime: row.game_time ? formatTimeValue(row.game_time) : null,
          sheetId: row.sheet_id,
          sheetName: row.sheet_name,
          opponentName,
          opponentTeamId,
        };
      });
    }
  );
}
