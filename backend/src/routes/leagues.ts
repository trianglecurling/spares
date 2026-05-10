import { FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, eq, sql, asc, type SQL } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { Member, League } from '../types.js';
import { hasScope } from '../utils/rbac.js';
import { sendValidationError } from '../api/errors.js';
import {
  leagueExportResponseSchema,
  leagueImportResponseSchema,
  leagueListResponseSchema,
  leagueResponseSchema,
  successResponseSchema,
  upcomingGamesResponseSchema,
} from '../api/schemas.js';
import type { ApiReply } from '../api/types.js';
import {
  hasClubLeagueAdministratorAccess,
  hasLeagueManagerAccess,
} from '../utils/leagueAccess.js';
import { config } from '../config.js';
import {
  RegistrationConfigValidationError,
  assertNoLeagueContinuityCycle,
  assertValidLeagueRegistrationSettings,
} from '../registration/registrationConfigValidation.js';

const createLeagueSchema = z.object({
  name: z.string().min(1),
  dayOfWeek: z.number().min(0).max(6),
  format: z.enum(['teams', 'doubles']),
  startDate: z.string(),
  endDate: z.string(),
  drawTimes: z.array(z.string()),
  exceptions: z.array(z.string()).optional(),
});

const updateLeagueSchema = z.object({
  name: z.string().min(1).optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  format: z.enum(['teams', 'doubles']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sessionId: z.number().int().positive().nullable().optional(),
  leagueType: z.enum(['standard', 'bring_your_own_team']).optional(),
  capacityType: z.enum(['individual', 'team']).optional(),
  capacityValue: z.number().int().optional(),
  registrationFeeMinor: z.number().int().optional(),
  requiresClubMembership: z.boolean().optional(),
  isInstructional: z.boolean().optional(),
  minExperienceYears: z.number().int().nullable().optional(),
  minAge: z.number().int().nullable().optional(),
  maxAge: z.number().int().nullable().optional(),
  firstDayOfPlay: z.string().nullable().optional(),
  lastDayOfPlay: z.string().nullable().optional(),
  allowsWaitlist: z.boolean().optional(),
  allowsSabbatical: z.boolean().optional(),
  predecessorLeagueId: z.number().int().positive().nullable().optional(),
  successorLeagueId: z.number().int().positive().nullable().optional(),
  drawTimes: z.array(z.string()).optional(),
  exceptions: z.array(z.string()).optional(),
});

function normalizeDateString(value: string | Date | number): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

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

function computeLeagueDrawDates(
  startDateStr: string,
  endDateStr: string,
  dayOfWeek: number,
  exceptions: Set<string>
): string[] {
  if (!startDateStr || !endDateStr) return [];
  if (startDateStr > endDateStr) return [];
  const dates: string[] = [];
  const startDay = getDayOfWeek(startDateStr);
  const daysUntilTarget = (dayOfWeek - startDay + 7) % 7;
  let currentDateStr = addDays(startDateStr, daysUntilTarget);

  while (currentDateStr <= endDateStr) {
    if (!exceptions.has(currentDateStr)) {
      dates.push(currentDateStr);
    }
    currentDateStr = addDays(currentDateStr, 7);
  }
  return dates;
}

function getTodayDateString(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getTimePartsInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  return { hour, minute, second };
}

function toBool(value: number | boolean): boolean {
  return value === true || value === 1;
}

function mapLeagueResponse(league: League, drawTimes: string[], exceptions: string[], canManage?: boolean) {
  const row = league as League & {
    session_id?: number | null;
    league_type?: 'standard' | 'bring_your_own_team';
    capacity_type?: 'individual' | 'team';
    capacity_value?: number;
    registration_fee_minor?: number;
    requires_club_membership?: number | boolean;
    is_instructional?: number | boolean;
    min_experience_years?: number | null;
    min_age?: number | null;
    max_age?: number | null;
    first_day_of_play?: string | Date | number | null;
    last_day_of_play?: string | Date | number | null;
    allows_waitlist?: number | boolean;
    allows_sabbatical?: number | boolean;
    predecessor_league_id?: number | null;
    successor_league_id?: number | null;
  };

  return {
    id: row.id,
    name: row.name,
    dayOfWeek: row.day_of_week,
    format: row.format,
    startDate: normalizeDateString(row.start_date),
    endDate: normalizeDateString(row.end_date),
    sessionId: row.session_id ?? null,
    leagueType: row.league_type ?? 'standard',
    capacityType: row.capacity_type ?? 'individual',
    capacityValue: row.capacity_value ?? 0,
    registrationFeeMinor: row.registration_fee_minor ?? 0,
    requiresClubMembership: toBool(row.requires_club_membership ?? 1),
    isInstructional: toBool(row.is_instructional ?? 0),
    minExperienceYears: row.min_experience_years ?? null,
    minAge: row.min_age ?? null,
    maxAge: row.max_age ?? null,
    firstDayOfPlay: row.first_day_of_play ? normalizeDateString(row.first_day_of_play) : null,
    lastDayOfPlay: row.last_day_of_play ? normalizeDateString(row.last_day_of_play) : null,
    allowsWaitlist: toBool(row.allows_waitlist ?? 1),
    allowsSabbatical: toBool(row.allows_sabbatical ?? 1),
    predecessorLeagueId: row.predecessor_league_id ?? null,
    successorLeagueId: row.successor_league_id ?? null,
    drawTimes,
    exceptions,
    ...(canManage === undefined ? {} : { canManage }),
  };
}

function handleRegistrationValidationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationConfigValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  return false;
}

export async function leagueRoutes(fastify: FastifyInstance) {
  const leagueManagerLeagueIdsFromMember = (member: Member): number[] => {
    const leagueIds = new Set<number>();
    for (const rule of member.authz?.scopeRules ?? []) {
      if (rule.effect !== 'allow') continue;
      if (rule.scope !== 'leagues.manage' && rule.scope !== 'leagues.*' && rule.scope !== '*') continue;
      if (rule.resourceType !== 'league') continue;
      if (rule.resourceId === null || rule.resourceId === undefined) continue;
      leagueIds.add(Number(rule.resourceId));
    }
    return Array.from(leagueIds);
  };

  // Get all leagues
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/leagues',
    {
      schema: {
        tags: ['leagues'],
        response: {
          200: leagueListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const canManageAll = isAdmin(member) || isServerAdmin(member);
    const leagueAdminInfo = canManageAll
      ? { isGlobal: true, leagueIds: [] as number[] }
      : {
          isGlobal: hasScope(member.authz, 'leagues.manage'),
          leagueIds: leagueManagerLeagueIdsFromMember(member),
        };
    const leagueManagerInfo = canManageAll
      ? { leagueIds: [] as number[] }
      : { leagueIds: leagueManagerLeagueIdsFromMember(member) };
    const leagues = await db
      .select()
      .from(schema.leagues)
      .orderBy(schema.leagues.day_of_week, schema.leagues.name) as League[];

    const result = await Promise.all(leagues.map(async (league) => {
      const drawTimes = await db
        .select({ draw_time: schema.leagueDrawTimes.draw_time })
        .from(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, league.id))
        .orderBy(asc(schema.leagueDrawTimes.draw_time));

      const exceptions = await db
        .select({ exception_date: schema.leagueExceptions.exception_date })
        .from(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, league.id))
        .orderBy(asc(schema.leagueExceptions.exception_date));

      return mapLeagueResponse(
        league,
        drawTimes.map((dt) => dt.draw_time),
        exceptions.map((ex) => normalizeDateString(ex.exception_date)),
        canManageAll ||
          leagueAdminInfo.isGlobal ||
          leagueManagerInfo.leagueIds.includes(league.id)
      );
    }));

    return result;
    }
  );

  // Get upcoming games for a league
  fastify.get<{ Params: { id: string } }>(
    '/leagues/:id/upcoming-games',
    {
      schema: {
        tags: ['leagues'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        response: {
          200: upcomingGamesResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League | undefined;
    if (!league) {
      return reply.code(404).send({ error: 'League not found' });
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
    const exceptions = new Set(exceptionsRows.map((ex) => normalizeDateString(ex.exception_date)));

    const games: { date: string; time: string }[] = [];
    const timeZone = config.timeZone;
    const todayDateStr = getTodayDateString(timeZone);
    const leagueStartDate = normalizeDateString(league.start_date);
    const leagueEndDate = normalizeDateString(league.end_date);
    const startDateStr = leagueStartDate > todayDateStr ? leagueStartDate : todayDateStr;
    const endDateStr = leagueEndDate;

    // Find the first game date on or after start date matching the day of week
    const targetDay = league.day_of_week; // 0=Sun, 6=Sat
    const startDay = getDayOfWeek(startDateStr);
    const daysUntilTarget = (targetDay - startDay + 7) % 7;
    let currentDateStr = addDays(startDateStr, daysUntilTarget);

    while (currentDateStr <= endDateStr) {
      // Skip dates where the league does not run (holiday / off week / etc.)
      if (exceptions.has(currentDateStr)) {
        currentDateStr = addDays(currentDateStr, 7);
        continue;
      }

      for (const dt of drawTimes) {
        // If the game is today, check if the time has passed in the league time zone
        if (currentDateStr === todayDateStr) {
          const [hours, minutes] = dt.draw_time.split(':').map(Number);
          const now = getTimePartsInTimeZone(timeZone);
          const nowSeconds = now.hour * 3600 + now.minute * 60 + now.second;
          const gameSeconds = hours * 3600 + minutes * 60;
          if (nowSeconds > gameSeconds) continue;
        }

        games.push({
          date: currentDateStr,
          time: dt.draw_time,
        });
      }

      currentDateStr = addDays(currentDateStr, 7);
    }

    return games;
    }
  );

  // Admin: Create league
  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/leagues',
    {
      schema: {
        tags: ['leagues'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            dayOfWeek: { type: 'number' },
            format: { type: 'string', enum: ['teams', 'doubles'] },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            sessionId: { type: ['number', 'null'] },
            leagueType: { type: 'string', enum: ['standard', 'bring_your_own_team'] },
            capacityType: { type: 'string', enum: ['individual', 'team'] },
            capacityValue: { type: 'number' },
            registrationFeeMinor: { type: 'number' },
            requiresClubMembership: { type: 'boolean' },
            isInstructional: { type: 'boolean' },
            minExperienceYears: { type: ['number', 'null'] },
            minAge: { type: ['number', 'null'] },
            maxAge: { type: ['number', 'null'] },
            firstDayOfPlay: { type: ['string', 'null'] },
            lastDayOfPlay: { type: ['string', 'null'] },
            allowsWaitlist: { type: 'boolean' },
            allowsSabbatical: { type: 'boolean' },
            predecessorLeagueId: { type: ['number', 'null'] },
            successorLeagueId: { type: ['number', 'null'] },
            drawTimes: { type: 'array', items: { type: 'string' } },
            exceptions: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'dayOfWeek', 'format', 'startDate', 'endDate', 'drawTimes'],
        },
        response: {
          200: leagueResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createLeagueSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const exceptions = uniqueStrings(body.exceptions ?? []);

    const result = await db
      .insert(schema.leagues)
      .values({
        name: body.name,
        day_of_week: body.dayOfWeek,
        format: body.format,
        start_date: body.startDate,
        end_date: body.endDate,
      })
      .returning();

    const leagueId = result[0].id;

    // Create default division for the league
    await db.insert(schema.leagueDivisions).values({
      league_id: leagueId,
      name: 'Default',
      sort_order: 0,
      is_default: 1,
    });

    // Insert draw times
    if (body.drawTimes.length > 0) {
      await db.insert(schema.leagueDrawTimes).values(
        body.drawTimes.map(drawTime => ({
          league_id: leagueId,
          draw_time: drawTime,
        }))
      );
    }

    // Insert exceptions
    if (exceptions.length > 0) {
      await db.insert(schema.leagueExceptions).values(
        exceptions.map((d) => ({
          league_id: leagueId,
          exception_date: d,
        }))
      );
    }

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League;
    
    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, leagueId))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, leagueId))
      .orderBy(asc(schema.leagueExceptions.exception_date));

    return mapLeagueResponse(
      league,
      drawTimes.map((dt) => dt.draw_time),
      exceptionRows.map((ex) => normalizeDateString(ex.exception_date))
    );
    }
  );

  // Admin: Update league
  fastify.patch<{ Params: { id: string } }>(
    '/leagues/:id',
    {
      schema: {
        tags: ['leagues'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            dayOfWeek: { type: 'number' },
            format: { type: 'string', enum: ['teams', 'doubles'] },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            drawTimes: { type: 'array', items: { type: 'string' } },
            exceptions: { type: 'array', items: { type: 'string' } },
          },
        },
        response: {
          200: leagueResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params;
    const leagueId = parseInt(id, 10);

    if (!(await hasLeagueManagerAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = updateLeagueSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const existingLeagueRows = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    const existingLeague = existingLeagueRows[0];
    if (!existingLeague) {
      return reply.code(404).send({ error: 'League not found' });
    }

    const nextLeagueRegistrationSettings = {
      id: leagueId,
      leagueType: body.leagueType ?? existingLeague.league_type,
      capacityType: body.capacityType ?? existingLeague.capacity_type,
      capacityValue: body.capacityValue ?? existingLeague.capacity_value,
      registrationFeeMinor: body.registrationFeeMinor ?? existingLeague.registration_fee_minor,
      minExperienceYears:
        body.minExperienceYears === undefined ? existingLeague.min_experience_years : body.minExperienceYears,
      minAge: body.minAge === undefined ? existingLeague.min_age : body.minAge,
      maxAge: body.maxAge === undefined ? existingLeague.max_age : body.maxAge,
      firstDayOfPlay: body.firstDayOfPlay === undefined ? existingLeague.first_day_of_play : body.firstDayOfPlay,
      lastDayOfPlay: body.lastDayOfPlay === undefined ? existingLeague.last_day_of_play : body.lastDayOfPlay,
      allowsWaitlist: body.allowsWaitlist ?? toBool(existingLeague.allows_waitlist),
      allowsSabbatical: body.allowsSabbatical ?? toBool(existingLeague.allows_sabbatical),
      predecessorLeagueId:
        body.predecessorLeagueId === undefined ? existingLeague.predecessor_league_id : body.predecessorLeagueId,
      successorLeagueId:
        body.successorLeagueId === undefined ? existingLeague.successor_league_id : body.successorLeagueId,
    };

    try {
      assertValidLeagueRegistrationSettings(nextLeagueRegistrationSettings);

      const continuityRows = await db
        .select({
          id: schema.leagues.id,
          predecessorLeagueId: schema.leagues.predecessor_league_id,
          successorLeagueId: schema.leagues.successor_league_id,
        })
        .from(schema.leagues);
      assertNoLeagueContinuityCycle(
        continuityRows.map((row) =>
          row.id === leagueId
            ? {
                ...row,
                predecessorLeagueId: nextLeagueRegistrationSettings.predecessorLeagueId,
                successorLeagueId: nextLeagueRegistrationSettings.successorLeagueId,
              }
            : row
        )
      );
    } catch (error) {
      if (handleRegistrationValidationError(reply, error)) return;
      throw error;
    }

    const updateData: Partial<{
      name: string;
      day_of_week: number;
      format: 'teams' | 'doubles';
      start_date: string;
      end_date: string;
      session_id: number | null;
      league_type: 'standard' | 'bring_your_own_team';
      capacity_type: 'individual' | 'team';
      capacity_value: number;
      registration_fee_minor: number;
      requires_club_membership: number;
      is_instructional: number;
      min_experience_years: number | null;
      min_age: number | null;
      max_age: number | null;
      first_day_of_play: string | null;
      last_day_of_play: string | null;
      allows_waitlist: number;
      allows_sabbatical: number;
      predecessor_league_id: number | null;
      successor_league_id: number | null;
      updated_at: SQL<unknown>;
    }> = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.dayOfWeek !== undefined) {
      updateData.day_of_week = body.dayOfWeek;
    }
    if (body.format !== undefined) {
      updateData.format = body.format;
    }
    if (body.startDate !== undefined) {
      updateData.start_date = body.startDate;
    }
    if (body.endDate !== undefined) {
      updateData.end_date = body.endDate;
    }
    if (body.sessionId !== undefined) {
      updateData.session_id = body.sessionId;
    }
    if (body.leagueType !== undefined) {
      updateData.league_type = body.leagueType;
    }
    if (body.capacityType !== undefined) {
      updateData.capacity_type = body.capacityType;
    }
    if (body.capacityValue !== undefined) {
      updateData.capacity_value = body.capacityValue;
    }
    if (body.registrationFeeMinor !== undefined) {
      updateData.registration_fee_minor = body.registrationFeeMinor;
    }
    if (body.requiresClubMembership !== undefined) {
      updateData.requires_club_membership = body.requiresClubMembership ? 1 : 0;
    }
    if (body.isInstructional !== undefined) {
      updateData.is_instructional = body.isInstructional ? 1 : 0;
    }
    if (body.minExperienceYears !== undefined) {
      updateData.min_experience_years = body.minExperienceYears;
    }
    if (body.minAge !== undefined) {
      updateData.min_age = body.minAge;
    }
    if (body.maxAge !== undefined) {
      updateData.max_age = body.maxAge;
    }
    if (body.firstDayOfPlay !== undefined) {
      updateData.first_day_of_play = body.firstDayOfPlay;
    }
    if (body.lastDayOfPlay !== undefined) {
      updateData.last_day_of_play = body.lastDayOfPlay;
    }
    if (body.allowsWaitlist !== undefined) {
      updateData.allows_waitlist = body.allowsWaitlist ? 1 : 0;
    }
    if (body.allowsSabbatical !== undefined) {
      updateData.allows_sabbatical = body.allowsSabbatical ? 1 : 0;
    }
    if (body.predecessorLeagueId !== undefined) {
      updateData.predecessor_league_id = body.predecessorLeagueId;
    }
    if (body.successorLeagueId !== undefined) {
      updateData.successor_league_id = body.successorLeagueId;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.leagues)
        .set(updateData)
        .where(eq(schema.leagues.id, leagueId));
    }

    // Update draw times if provided
    if (body.drawTimes !== undefined) {
      const existingTimes = await db
        .select({ draw_time: schema.leagueDrawTimes.draw_time })
        .from(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, leagueId));
      const previousTimes = existingTimes.map((dt) => dt.draw_time);
      const nextTimes = body.drawTimes;
      const removedTimes = previousTimes.filter((time) => !nextTimes.includes(time));

      await db
        .delete(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, leagueId));

      if (body.drawTimes.length > 0) {
        await db.insert(schema.leagueDrawTimes).values(
          body.drawTimes.map(drawTime => ({
            league_id: leagueId,
            draw_time: drawTime,
          }))
        );
      }

      if (removedTimes.length > 0) {
        const exceptionsRows = await db
          .select({ exception_date: schema.leagueExceptions.exception_date })
          .from(schema.leagueExceptions)
          .where(eq(schema.leagueExceptions.league_id, leagueId));
        const exceptions = new Set(exceptionsRows.map((ex) => normalizeDateString(ex.exception_date)));
        const startDateStr = normalizeDateString(body.startDate ?? existingLeague?.start_date ?? '');
        const endDateStr = normalizeDateString(body.endDate ?? existingLeague?.end_date ?? '');
        const dayOfWeek = body.dayOfWeek ?? existingLeague?.day_of_week ?? 0;
        const drawDates = computeLeagueDrawDates(startDateStr, endDateStr, dayOfWeek, exceptions);

        if (drawDates.length > 0) {
          const extraDrawRows = await db
            .select({
              draw_date: schema.leagueExtraDraws.draw_date,
              draw_time: schema.leagueExtraDraws.draw_time,
            })
            .from(schema.leagueExtraDraws)
            .where(eq(schema.leagueExtraDraws.league_id, leagueId));
          const extraDrawKeys = new Set(
            extraDrawRows.map((row) => `${normalizeDateString(row.draw_date)}|${row.draw_time}`)
          );

          const pairsToUnschedule: Array<{ date: string; time: string }> = [];
          for (const date of drawDates) {
            for (const time of removedTimes) {
              if (!extraDrawKeys.has(`${date}|${time}`)) {
                pairsToUnschedule.push({ date, time });
              }
            }
          }

          for (const pair of pairsToUnschedule) {
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
                  eq(schema.games.game_date, pair.date),
                  eq(schema.games.game_time, pair.time)
                )
              );
          }
        }
      }
    }

    // Update exceptions if provided
    if (body.exceptions !== undefined) {
      const exceptions = uniqueStrings(body.exceptions);
      await db
        .delete(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, leagueId));

      if (exceptions.length > 0) {
        await db.insert(schema.leagueExceptions).values(
          exceptions.map((d) => ({
            league_id: leagueId,
            exception_date: d,
          }))
        );
      }
    }

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League;
    
    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, leagueId))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, leagueId))
      .orderBy(asc(schema.leagueExceptions.exception_date));

    return mapLeagueResponse(
      league,
      drawTimes.map((dt) => dt.draw_time),
      exceptionRows.map((ex) => normalizeDateString(ex.exception_date))
    );
    }
  );

  // Admin: Delete league (requires name confirmation)
  const deleteLeagueBodySchema = z.object({
    name: z.string().min(1),
  });

  fastify.delete<{ Params: { id: string }; Body: { name: string } }>(
    '/leagues/:id',
    {
      schema: {
        tags: ['leagues'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
          },
          required: ['name'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const leagueId = parseInt(id, 10);
    const body = deleteLeagueBodySchema.parse(request.body ?? {});
    const { db, schema } = getDrizzleDb();

    const league = await db
      .select({ id: schema.leagues.id, name: schema.leagues.name })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);

    if (league.length === 0) {
      return reply.code(404).send({ error: 'League not found' });
    }

    if (league[0].name !== body.name) {
      return reply.code(400).send({
        error: 'League name does not match. Type the exact league name to confirm deletion.',
      });
    }

    await db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId));

      return { success: true };
    }
  );

  // Admin: Export leagues
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/leagues/export',
    {
      schema: {
        tags: ['leagues'],
        response: {
          200: leagueExportResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const leagues = await db
      .select()
      .from(schema.leagues)
      .orderBy(schema.leagues.day_of_week, schema.leagues.name) as League[];

    const result = await Promise.all(leagues.map(async (league) => {
      const drawTimes = await db
        .select({ draw_time: schema.leagueDrawTimes.draw_time })
        .from(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, league.id))
        .orderBy(asc(schema.leagueDrawTimes.draw_time));

      const exceptions = await db
        .select({ exception_date: schema.leagueExceptions.exception_date })
        .from(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, league.id))
        .orderBy(asc(schema.leagueExceptions.exception_date));

      return {
        name: league.name,
        dayOfWeek: league.day_of_week,
        format: league.format,
        startDate: league.start_date,
        endDate: league.end_date,
        drawTimes: drawTimes.map((dt) => dt.draw_time),
        exceptions: exceptions.map((ex) => normalizeDateString(ex.exception_date)),
      };
    }));

    return { leagues: result };
    }
  );

  // Admin: Import leagues
  const importLeaguesSchema = z.object({
    leagues: z.array(z.object({
      name: z.string().min(1),
      dayOfWeek: z.number().min(0).max(6),
      format: z.enum(['teams', 'doubles']),
      startDate: z.string(),
      endDate: z.string(),
      drawTimes: z.array(z.string()),
      exceptions: z.array(z.string()).optional(),
    })),
  });

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/leagues/import',
    {
      schema: {
        tags: ['leagues'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leagues: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1 },
                  dayOfWeek: { type: 'number' },
                  format: { type: 'string', enum: ['teams', 'doubles'] },
                  startDate: { type: 'string' },
                  endDate: { type: 'string' },
                  drawTimes: { type: 'array', items: { type: 'string' } },
                  exceptions: { type: 'array', items: { type: 'string' } },
                },
                required: ['name', 'dayOfWeek', 'format', 'startDate', 'endDate', 'drawTimes'],
              },
            },
          },
          required: ['leagues'],
        },
        response: {
          200: leagueImportResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = importLeaguesSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const importedLeagues = [];

    for (const leagueData of body.leagues) {
      // Check if a league with the same name already exists
      const existingLeagues = await db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.name, leagueData.name))
        .limit(1);

      let leagueId: number;

      if (existingLeagues.length > 0) {
        // Update existing league
        const existingLeague = existingLeagues[0] as League;
        leagueId = existingLeague.id;

        await db
          .update(schema.leagues)
          .set({
            day_of_week: leagueData.dayOfWeek,
            format: leagueData.format,
            start_date: leagueData.startDate,
            end_date: leagueData.endDate,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.leagues.id, leagueId));

        // Delete existing draw times
        await db
          .delete(schema.leagueDrawTimes)
          .where(eq(schema.leagueDrawTimes.league_id, leagueId));
        // Delete existing exceptions
        await db
          .delete(schema.leagueExceptions)
          .where(eq(schema.leagueExceptions.league_id, leagueId));
      } else {
        // Create new league
        const result = await db
          .insert(schema.leagues)
          .values({
            name: leagueData.name,
            day_of_week: leagueData.dayOfWeek,
            format: leagueData.format,
            start_date: leagueData.startDate,
            end_date: leagueData.endDate,
          })
          .returning();

        leagueId = result[0].id;

        await db.insert(schema.leagueDivisions).values({
          league_id: leagueId,
          name: 'Default',
          sort_order: 0,
          is_default: 1,
        });
      }

      // Insert draw times
      if (leagueData.drawTimes.length > 0) {
        await db.insert(schema.leagueDrawTimes).values(
          leagueData.drawTimes.map(drawTime => ({
            league_id: leagueId,
            draw_time: drawTime,
          }))
        );
      }

      // Insert exceptions
      const exceptions = uniqueStrings(leagueData.exceptions ?? []);
      if (exceptions.length > 0) {
        await db.insert(schema.leagueExceptions).values(
          exceptions.map((d) => ({
            league_id: leagueId,
            exception_date: d,
          }))
        );
      }

      importedLeagues.push({
        id: leagueId,
        name: leagueData.name,
        dayOfWeek: leagueData.dayOfWeek,
        format: leagueData.format,
        startDate: leagueData.startDate,
        endDate: leagueData.endDate,
        drawTimes: leagueData.drawTimes,
        exceptions,
      });
    }

    return {
      success: true,
      imported: importedLeagues.length,
      leagues: importedLeagues,
    };
    }
  );
}
