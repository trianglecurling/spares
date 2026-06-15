import { FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { and, eq, sql, asc, inArray, type SQL } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { Member, League } from '../types.js';
import { hasScope } from '../utils/rbac.js';
import { sendValidationError } from '../api/errors.js';
import {
  leagueBulkCopyToSessionResponseSchema,
  leagueExportResponseSchema,
  leagueImportResponseSchema,
  leagueListResponseSchema,
  leagueResponseSchema,
  successResponseSchema,
  upcomingGamesResponseSchema,
} from '../api/schemas.js';
import type { ApiReply } from '../api/types.js';
import { hasClubLeagueAdministratorAccess } from '../utils/leagueAccess.js';
import {
  leagueTeamCount,
  sendDropInLeagueTeamsValidationError,
} from '../utils/leagueDropIn.js';
import { sortLeaguesByDayOfWeekThenFirstDrawTime } from '../utils/leagueOrdering.js';
import { resolveRelevantSessionIdForLeagues } from '../services/curlingSessionService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { parseQueryBoolean } from '../utils/queryParams.js';
import { config } from '../config.js';
import {
  RegistrationConfigValidationError,
  assertNoLeagueContinuityCycle,
  assertSessionWithinSeason,
  assertValidDateRange,
  assertValidLeagueRegistrationSettings,
  effectiveLeagueRegistrationFeeMinor,
} from '../registration/registrationConfigValidation.js';
import { isValidHalfYearExperienceValue } from '../registration/curlingExperienceYears.js';
import { normalizeLeagueConstraintForStorage } from '../registration/leagueEligibilityConstraints.js';
import {
  WaitlistEntityValidationError,
  attachWaitlistToLeague,
  createAndAttachWaitlistToLeague,
  detachWaitlistFromLeague,
  listLeagueWaitlistsForAttach,
} from '../registration/waitlistEntityService.js';


const leaguesListQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'number' },
    relevantSession: { type: 'string', enum: ['true', 'false'] },
    summary: { type: 'string', enum: ['true', 'false'] },
  },
} as const;

const createLeagueSchema = z.object({
  name: z.string().min(1),
  dayOfWeek: z.number().min(0).max(6),
  format: z.enum(['teams', 'doubles', 'instructional']),
  startDate: z.string(),
  endDate: z.string(),
  drawTimes: z.array(z.string()),
  exceptions: z.array(z.string()).optional(),
});

/** Clients often send whole numeric fields as floats (HTML inputs, JSON); DB columns are integers. */
function preprocessRoundFiniteInt(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  return val;
}

function preprocessOptionalNullableNumber(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : val;
  }
  return val;
}

const halfYearExperienceYearsSchema = z
  .preprocess(preprocessOptionalNullableNumber, z.number().nullable().optional())
  .superRefine((value, ctx) => {
    if (value === null || value === undefined) return;
    if (!isValidHalfYearExperienceValue(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Experience years must be at least 0, less than 100, and a whole number or end in .5.',
      });
    }
  });

const bulkCopyLeaguesBodySchema = z.object({
  sourceLeagueIds: z
    .array(z.preprocess(preprocessRoundFiniteInt, z.number().int().positive()))
    .min(1),
  seasonId: z.preprocess(preprocessRoundFiniteInt, z.number().int().positive()),
  targetSessionId: z.preprocess(preprocessRoundFiniteInt, z.number().int().positive()),
  anchorStartDate: z.string().min(1),
  anchorEndDate: z.string().min(1),
});

function uniqueSourceLeagueIdsPreservingOrder(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const updateLeagueSchema = z.object({
  name: z.string().min(1).optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  format: z.enum(['teams', 'doubles', 'instructional']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sessionId: z.preprocess(preprocessRoundFiniteInt, z.number().int().positive().nullable().optional()),
  leagueType: z.enum(['standard', 'bring_your_own_team']).optional(),
  capacityType: z.enum(['individual', 'team']).optional(),
  capacityValue: z.preprocess(preprocessRoundFiniteInt, z.number().int().optional()),
  registrationFeeMinor: z.preprocess(preprocessRoundFiniteInt, z.number().int().optional()),
  registrationFeeOverrideMinor: z.preprocess(
    preprocessRoundFiniteInt,
    z.number().int().nonnegative().nullable().optional()
  ),
  requiresClubMembership: z.boolean().optional(),
  minExperienceYears: halfYearExperienceYearsSchema,
  maxExperienceYears: halfYearExperienceYearsSchema,
  minAge: z.preprocess(preprocessRoundFiniteInt, z.number().int().nullable().optional()),
  maxAge: z.preprocess(preprocessRoundFiniteInt, z.number().int().nullable().optional()),
  firstDayOfPlay: z.string().nullable().optional(),
  lastDayOfPlay: z.string().nullable().optional(),
  allowsWaitlist: z.boolean().optional(),
  isPlayInBased: z.boolean().optional(),
  allowsSabbatical: z.boolean().optional(),
  allowsDropIns: z.boolean().optional(),
  dropInFeeMinor: z.preprocess(
    preprocessRoundFiniteInt,
    z.number().int().nonnegative().nullable().optional()
  ),
  predecessorLeagueId: z.preprocess(preprocessRoundFiniteInt, z.number().int().positive().nullable().optional()),
  successorLeagueId: z.preprocess(preprocessRoundFiniteInt, z.number().int().positive().nullable().optional()),
  publicNotes: z.string().nullable().optional(),
  teamFormation: z.enum(['coordinator', 'skips_draft']).optional(),
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

/** First calendar date on or after `anchorStart` whose day-of-week equals `dayOfWeek` (0–6, UTC). */
function firstDowOnOrAfter(anchorStart: string, dayOfWeek: number): string {
  const anchorDow = getDayOfWeek(anchorStart);
  const delta = (dayOfWeek - anchorDow + 7) % 7;
  return addDays(anchorStart, delta);
}

/** Last calendar date on or before `anchorEnd` whose day-of-week equals `dayOfWeek` (0–6, UTC). */
function lastDowOnOrBefore(anchorEnd: string, dayOfWeek: number): string {
  const endDow = getDayOfWeek(anchorEnd);
  const delta = (endDow - dayOfWeek + 7) % 7;
  return addDays(anchorEnd, -delta);
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

async function loadDefaultLeagueFeeMinor(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ minor: schema.registrationPriceSettings.default_league_fee_minor })
    .from(schema.registrationPriceSettings)
    .limit(1);
  return row?.minor ?? 0;
}

async function loadDrawTimesByLeagueIds(
  leagueIds: number[],
): Promise<Map<number, string[]>> {
  if (leagueIds.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueDrawTimes.league_id,
      drawTime: schema.leagueDrawTimes.draw_time,
    })
    .from(schema.leagueDrawTimes)
    .where(inArray(schema.leagueDrawTimes.league_id, leagueIds))
    .orderBy(asc(schema.leagueDrawTimes.league_id), asc(schema.leagueDrawTimes.draw_time));

  const byLeagueId = new Map<number, string[]>();
  for (const row of rows) {
    const existing = byLeagueId.get(row.leagueId) ?? [];
    existing.push(row.drawTime);
    byLeagueId.set(row.leagueId, existing);
  }
  return byLeagueId;
}

async function loadExceptionsByLeagueIds(
  leagueIds: number[],
): Promise<Map<number, string[]>> {
  if (leagueIds.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueExceptions.league_id,
      exceptionDate: schema.leagueExceptions.exception_date,
    })
    .from(schema.leagueExceptions)
    .where(inArray(schema.leagueExceptions.league_id, leagueIds))
    .orderBy(asc(schema.leagueExceptions.league_id), asc(schema.leagueExceptions.exception_date));

  const byLeagueId = new Map<number, string[]>();
  for (const row of rows) {
    const existing = byLeagueId.get(row.leagueId) ?? [];
    existing.push(normalizeDateString(row.exceptionDate));
    byLeagueId.set(row.leagueId, existing);
  }
  return byLeagueId;
}

function mapLeagueResponse(
  league: League,
  drawTimes: string[],
  exceptions: string[],
  defaultLeagueFeeMinor: number,
  canManage?: boolean
) {
  const row = league as League & {
    session_id?: number | null;
    league_type?: 'standard' | 'bring_your_own_team';
    capacity_type?: 'individual' | 'team';
    capacity_value?: number;
    registration_fee_minor?: number;
    registration_fee_override_minor?: number | null;
    requires_club_membership?: number | boolean;
    min_experience_years?: number | null;
    max_experience_years?: number | null;
    min_age?: number | null;
    max_age?: number | null;
    first_day_of_play?: string | Date | number | null;
    last_day_of_play?: string | Date | number | null;
    allows_waitlist?: number | boolean;
    waitlist_id?: number | null;
    is_play_in_based?: number | boolean;
    allows_sabbatical?: number | boolean;
    allows_drop_ins?: number | boolean;
    drop_in_fee_minor?: number | null;
    predecessor_league_id?: number | null;
    successor_league_id?: number | null;
    public_notes?: string | null;
    team_formation?: 'coordinator' | 'skips_draft';
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
    registrationFeeMinor: effectiveLeagueRegistrationFeeMinor(
      row.registration_fee_override_minor ?? null,
      defaultLeagueFeeMinor
    ),
    registrationFeeOverrideMinor: row.registration_fee_override_minor ?? null,
    requiresClubMembership: toBool(row.requires_club_membership ?? 1),
    minExperienceYears: row.min_experience_years ?? null,
    maxExperienceYears: row.max_experience_years ?? null,
    minAge: row.min_age ?? null,
    maxAge: row.max_age ?? null,
    firstDayOfPlay: row.first_day_of_play ? normalizeDateString(row.first_day_of_play) : null,
    lastDayOfPlay: row.last_day_of_play ? normalizeDateString(row.last_day_of_play) : null,
    allowsWaitlist: row.waitlist_id != null,
    waitlistId: row.waitlist_id ?? null,
    isPlayInBased: toBool(row.is_play_in_based ?? 0),
    allowsSabbatical: toBool(row.allows_sabbatical ?? 1),
    allowsDropIns: toBool(row.allows_drop_ins ?? 0),
    dropInFeeMinor: row.drop_in_fee_minor ?? null,
    predecessorLeagueId: row.predecessor_league_id ?? null,
    successorLeagueId: row.successor_league_id ?? null,
    publicNotes: row.public_notes?.trim() || null,
    teamFormation: row.team_formation ?? 'coordinator',
    drawTimes,
    exceptions,
    ...(canManage === undefined ? {} : { canManage }),
  };
}

function handleRegistrationValidationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationConfigValidationError || error instanceof WaitlistEntityValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  return false;
}

const leagueWaitlistBodySchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const leagueIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const leagueWaitlistAttachSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    name: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('attach'),
    waitlistId: z.number().int().positive(),
  }),
]);

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
        querystring: leaguesListQuerySchemaJson,
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

    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const sessionIdParam =
      rawQuery.sessionId != null && rawQuery.sessionId !== ''
        ? Number.parseInt(String(rawQuery.sessionId), 10)
        : undefined;
    const relevantSession = parseQueryBoolean(rawQuery.relevantSession);
    const summary = parseQueryBoolean(rawQuery.summary);

    let filterSessionId =
      sessionIdParam != null && Number.isFinite(sessionIdParam) && sessionIdParam > 0
        ? sessionIdParam
        : null;
    if (filterSessionId == null && relevantSession) {
      const today = await getCurrentDateStringAsync();
      filterSessionId = await resolveRelevantSessionIdForLeagues(today);
      if (filterSessionId == null) {
        return [];
      }
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
    const leaguesUnsorted = (filterSessionId != null
      ? await db
          .select()
          .from(schema.leagues)
          .where(eq(schema.leagues.session_id, filterSessionId))
      : await db.select().from(schema.leagues)) as League[];
    const leagues = await sortLeaguesByDayOfWeekThenFirstDrawTime(db, schema, leaguesUnsorted);

    const leagueIds = leagues.map((league) => league.id);
    const defaultLeagueFeeMinor = summary ? 0 : await loadDefaultLeagueFeeMinor();
    const drawTimesByLeagueId = summary ? new Map<number, string[]>() : await loadDrawTimesByLeagueIds(leagueIds);
    const exceptionsByLeagueId = summary ? new Map<number, string[]>() : await loadExceptionsByLeagueIds(leagueIds);

    const result = leagues.map((league) =>
      mapLeagueResponse(
        league,
        drawTimesByLeagueId.get(league.id) ?? [],
        exceptionsByLeagueId.get(league.id) ?? [],
        defaultLeagueFeeMinor,
        canManageAll ||
          leagueAdminInfo.isGlobal ||
          leagueManagerInfo.leagueIds.includes(league.id)
      )
    );

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
            format: { type: 'string', enum: ['teams', 'doubles', 'instructional'] },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            sessionId: { type: ['number', 'null'] },
            leagueType: { type: 'string', enum: ['standard', 'bring_your_own_team'] },
            capacityType: { type: 'string', enum: ['individual', 'team'] },
            capacityValue: { type: 'number' },
            registrationFeeMinor: { type: 'number' },
            requiresClubMembership: { type: 'boolean' },
            minExperienceYears: { type: ['number', 'null'] },
            maxExperienceYears: { type: ['number', 'null'] },
            minAge: { type: ['number', 'null'] },
            maxAge: { type: ['number', 'null'] },
            firstDayOfPlay: { type: ['string', 'null'] },
            lastDayOfPlay: { type: ['string', 'null'] },
            allowsWaitlist: { type: 'boolean' },
            allowsSabbatical: { type: 'boolean' },
            allowsDropIns: { type: 'boolean' },
            dropInFeeMinor: { type: ['number', 'null'] },
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

    const defaultLeagueFeeMinor = await loadDefaultLeagueFeeMinor();
    const initialEffectiveFee = effectiveLeagueRegistrationFeeMinor(null, defaultLeagueFeeMinor);
    await db
      .update(schema.leagues)
      .set({
        registration_fee_minor: initialEffectiveFee,
        registration_fee_override_minor: null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.leagues.id, leagueId));

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
      exceptionRows.map((ex) => normalizeDateString(ex.exception_date)),
      defaultLeagueFeeMinor
    );
    }
  );

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/leagues/bulk-copy-to-session',
    {
      schema: {
        tags: ['leagues'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'sourceLeagueIds',
            'seasonId',
            'targetSessionId',
            'anchorStartDate',
            'anchorEndDate',
          ],
          properties: {
            sourceLeagueIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'number' },
            },
            seasonId: { type: 'number' },
            targetSessionId: { type: 'number' },
            anchorStartDate: { type: 'string' },
            anchorEndDate: { type: 'string' },
          },
        },
        response: {
          200: leagueBulkCopyToSessionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      let body: z.infer<typeof bulkCopyLeaguesBodySchema>;
      try {
        body = bulkCopyLeaguesBodySchema.parse(request.body);
      } catch {
        return reply.code(400).send({ error: 'Invalid request body' });
      }

      try {
        assertValidDateRange(body.anchorStartDate, body.anchorEndDate, 'anchorDates');
      } catch (error) {
        if (handleRegistrationValidationError(reply, error)) return;
        throw error;
      }

      const uniqueIds = uniqueSourceLeagueIdsPreservingOrder(body.sourceLeagueIds);
      const { db, schema } = getDrizzleDb();

      const [sessionRow] = await db
        .select()
        .from(schema.curlingSessions)
        .where(eq(schema.curlingSessions.id, body.targetSessionId))
        .limit(1);
      if (!sessionRow) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const [seasonRow] = await db
        .select()
        .from(schema.curlingSeasons)
        .where(eq(schema.curlingSeasons.id, body.seasonId))
        .limit(1);
      if (!seasonRow) {
        return reply.code(404).send({ error: 'Season not found' });
      }

      try {
        assertSessionWithinSeason({
          selectedSeasonId: body.seasonId,
          sessionSeasonId: sessionRow.season_id,
          sessionStartDate: normalizeDateString(sessionRow.start_date),
          sessionEndDate: normalizeDateString(sessionRow.end_date),
          seasonStartDate: normalizeDateString(seasonRow.start_date),
          seasonEndDate: normalizeDateString(seasonRow.end_date),
        });
      } catch (error) {
        if (handleRegistrationValidationError(reply, error)) return;
        throw error;
      }

      const sourceRows = await db
        .select()
        .from(schema.leagues)
        .where(inArray(schema.leagues.id, uniqueIds));
      if (sourceRows.length !== uniqueIds.length) {
        return reply.code(404).send({ error: 'One or more source leagues were not found' });
      }

      const leagueById = new Map(sourceRows.map((r) => [r.id, r]));
      const sourcesOrdered = uniqueIds.map((id) => leagueById.get(id)!) as League[];

      const sessionStart = normalizeDateString(sessionRow.start_date);
      const sessionEnd = normalizeDateString(sessionRow.end_date);
      const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const preflightDetails: Record<string, string> = {};
      const computedBySourceId = new Map<
        number,
        { start: string; end: string; source: League }
      >();

      for (const src of sourcesOrdered) {
        const computedStart = firstDowOnOrAfter(body.anchorStartDate, src.day_of_week);
        const computedEnd = lastDowOnOrBefore(body.anchorEndDate, src.day_of_week);
        if (computedStart > computedEnd) {
          preflightDetails[`league_${src.id}`] =
            `No ${dayLabels[src.day_of_week] ?? 'matching'} date exists between the anchor dates for "${src.name}".`;
          continue;
        }
        if (computedStart < sessionStart || computedEnd > sessionEnd) {
          preflightDetails[`league_${src.id}`] =
            `Computed dates for "${src.name}" (${computedStart}–${computedEnd}) must fall within the target session (${sessionStart}–${sessionEnd}).`;
          continue;
        }
        computedBySourceId.set(src.id, { start: computedStart, end: computedEnd, source: src });
      }

      if (Object.keys(preflightDetails).length > 0) {
        sendValidationError(
          reply,
          'Unable to copy leagues with the given dates and session.',
          preflightDetails
        );
        return;
      }

      const defaultLeagueFeeMinor = await loadDefaultLeagueFeeMinor();
      const newLeagueIds: number[] = [];

      try {
        await db.transaction(async (tx) => {
          for (const src of sourcesOrdered) {
            const { start: computedStart, end: computedEnd } = computedBySourceId.get(src.id)!;

            const [created] = await tx
              .insert(schema.leagues)
              .values({
                session_id: body.targetSessionId,
                name: src.name,
                day_of_week: src.day_of_week,
                format: src.format,
                start_date: computedStart,
                end_date: computedEnd,
                league_type: src.league_type ?? 'standard',
                capacity_type: src.capacity_type ?? 'individual',
                capacity_value: src.capacity_value ?? 0,
                registration_fee_minor: src.registration_fee_minor,
                registration_fee_override_minor: src.registration_fee_override_minor ?? null,
                requires_club_membership: src.requires_club_membership,
                min_experience_years: src.min_experience_years,
                max_experience_years: src.max_experience_years,
                min_age: src.min_age,
                max_age: src.max_age,
                first_day_of_play: null,
                last_day_of_play: null,
                allows_waitlist: src.allows_waitlist,
                waitlist_id: (src as { waitlist_id?: number | null }).waitlist_id ?? null,
                allows_sabbatical: src.allows_sabbatical,
                allows_drop_ins: (src as { allows_drop_ins?: number }).allows_drop_ins ?? 0,
                drop_in_fee_minor: (src as { drop_in_fee_minor?: number | null }).drop_in_fee_minor ?? null,
                public_notes: (src as { public_notes?: string | null }).public_notes ?? null,
                team_formation: (src as { team_formation?: 'coordinator' | 'skips_draft' }).team_formation ?? 'coordinator',
                predecessor_league_id: src.id,
                successor_league_id: null,
              })
              .returning();

            const newLeagueId = created.id;
            newLeagueIds.push(newLeagueId);

            const divisions = await tx
              .select()
              .from(schema.leagueDivisions)
              .where(eq(schema.leagueDivisions.league_id, src.id))
              .orderBy(asc(schema.leagueDivisions.sort_order));

            if (divisions.length === 0) {
              await tx.insert(schema.leagueDivisions).values({
                league_id: newLeagueId,
                name: 'Default',
                sort_order: 0,
                is_default: 1,
              });
            } else {
              for (const div of divisions) {
                await tx.insert(schema.leagueDivisions).values({
                  league_id: newLeagueId,
                  name: div.name,
                  sort_order: div.sort_order,
                  is_default: div.is_default,
                });
              }
            }

            const drawRows = await tx
              .select({ draw_time: schema.leagueDrawTimes.draw_time })
              .from(schema.leagueDrawTimes)
              .where(eq(schema.leagueDrawTimes.league_id, src.id))
              .orderBy(asc(schema.leagueDrawTimes.draw_time));

            if (drawRows.length > 0) {
              await tx.insert(schema.leagueDrawTimes).values(
                drawRows.map((dt) => ({
                  league_id: newLeagueId,
                  draw_time: dt.draw_time,
                }))
              );
            }

            const managerRows = await tx
              .select()
              .from(schema.leagueMemberRoles)
              .where(
                and(
                  eq(schema.leagueMemberRoles.league_id, src.id),
                  inArray(schema.leagueMemberRoles.role, ['league_manager', 'league_administrator'])
                )
              );

            if (managerRows.length > 0) {
              await tx.insert(schema.leagueMemberRoles).values(
                managerRows.map((mr) => ({
                  member_id: mr.member_id,
                  league_id: newLeagueId,
                  role: mr.role,
                }))
              );
            }
          }

          const continuityRows = await tx
            .select({
              id: schema.leagues.id,
              predecessorLeagueId: schema.leagues.predecessor_league_id,
              successorLeagueId: schema.leagues.successor_league_id,
            })
            .from(schema.leagues);

          assertNoLeagueContinuityCycle(
            continuityRows.map((row) => ({
              id: row.id,
              predecessorLeagueId: row.predecessorLeagueId,
              successorLeagueId: row.successorLeagueId,
            }))
          );

          for (const newId of newLeagueIds) {
            const [row] = await tx.select().from(schema.leagues).where(eq(schema.leagues.id, newId)).limit(1);
            if (!row) continue;
            assertValidLeagueRegistrationSettings({
              id: newId,
              format: row.format,
              leagueType: row.league_type ?? 'standard',
              capacityType: row.capacity_type ?? 'individual',
              capacityValue: row.capacity_value ?? 0,
              registrationFeeOverrideMinor: row.registration_fee_override_minor ?? null,
              minExperienceYears: row.min_experience_years,
              maxExperienceYears: row.max_experience_years,
              minAge: row.min_age,
              maxAge: row.max_age,
              firstDayOfPlay: row.first_day_of_play ? normalizeDateString(row.first_day_of_play) : null,
              lastDayOfPlay: row.last_day_of_play ? normalizeDateString(row.last_day_of_play) : null,
              allowsWaitlist: row.waitlist_id != null,
              hasAttachedWaitlist: row.waitlist_id != null,
              isPlayInBased: toBool((row as { is_play_in_based?: number }).is_play_in_based ?? 0),
              allowsSabbatical: toBool(row.allows_sabbatical ?? 1),
              predecessorLeagueId: row.predecessor_league_id,
              successorLeagueId: row.successor_league_id,
            });
          }
        });
      } catch (error) {
        if (handleRegistrationValidationError(reply, error)) return;
        throw error;
      }

      const leaguesPayload = await Promise.all(
        newLeagueIds.map(async (leagueId) => {
          const [league] = await db
            .select()
            .from(schema.leagues)
            .where(eq(schema.leagues.id, leagueId))
            .limit(1);
          const drawTimes = await db
            .select({ draw_time: schema.leagueDrawTimes.draw_time })
            .from(schema.leagueDrawTimes)
            .where(eq(schema.leagueDrawTimes.league_id, leagueId))
            .orderBy(asc(schema.leagueDrawTimes.draw_time));
          return mapLeagueResponse(
            league as League,
            drawTimes.map((dt) => dt.draw_time),
            [],
            defaultLeagueFeeMinor,
            true
          );
        })
      );

      return { leagues: leaguesPayload };
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
            format: { type: 'string', enum: ['teams', 'doubles', 'instructional'] },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            sessionId: { type: ['number', 'null'] },
            leagueType: { type: 'string', enum: ['standard', 'bring_your_own_team'] },
            capacityType: { type: 'string', enum: ['individual', 'team'] },
            capacityValue: { type: 'number' },
            registrationFeeMinor: { type: 'number' },
            registrationFeeOverrideMinor: { type: ['number', 'null'] },
            requiresClubMembership: { type: 'boolean' },
            minExperienceYears: { type: ['number', 'null'] },
            maxExperienceYears: { type: ['number', 'null'] },
            minAge: { type: ['number', 'null'] },
            maxAge: { type: ['number', 'null'] },
            firstDayOfPlay: { type: ['string', 'null'] },
            lastDayOfPlay: { type: ['string', 'null'] },
            allowsWaitlist: { type: 'boolean' },
            isPlayInBased: { type: 'boolean' },
            allowsSabbatical: { type: 'boolean' },
            allowsDropIns: { type: 'boolean' },
            dropInFeeMinor: { type: ['number', 'null'] },
            predecessorLeagueId: { type: ['number', 'null'] },
            successorLeagueId: { type: ['number', 'null'] },
            publicNotes: { type: ['string', 'null'] },
            teamFormation: { type: 'string', enum: ['coordinator', 'skips_draft'] },
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

    if (!(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const body = updateLeagueSchema.parse(request.body);
    const nextMinExperienceYears =
      body.minExperienceYears === undefined
        ? undefined
        : normalizeLeagueConstraintForStorage(body.minExperienceYears, 'minimum');
    const nextMaxExperienceYears =
      body.maxExperienceYears === undefined
        ? undefined
        : normalizeLeagueConstraintForStorage(body.maxExperienceYears, 'maximum');
    const nextMinAge =
      body.minAge === undefined ? undefined : normalizeLeagueConstraintForStorage(body.minAge, 'minimum');
    const nextMaxAge =
      body.maxAge === undefined ? undefined : normalizeLeagueConstraintForStorage(body.maxAge, 'maximum');
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

    const nextAllowsDropIns =
      body.allowsDropIns !== undefined
        ? body.allowsDropIns
        : toBool((existingLeague as { allows_drop_ins?: number }).allows_drop_ins ?? 0);
    const nextDropInFeeMinor =
      body.dropInFeeMinor !== undefined
        ? body.dropInFeeMinor
        : (existingLeague as { drop_in_fee_minor?: number | null }).drop_in_fee_minor ?? null;

    if (nextAllowsDropIns && (nextDropInFeeMinor == null || nextDropInFeeMinor < 0)) {
      return sendValidationError(reply, 'Drop-in fee is required when drop-ins are allowed.', {
        dropInFeeMinor: 'Enter a drop-in fee amount.',
      });
    }

    if (nextAllowsDropIns && (await leagueTeamCount(leagueId)) > 0) {
      return sendDropInLeagueTeamsValidationError(
        reply,
        'allowsDropIns',
        'Remove all teams before allowing drop-ins.'
      );
    }

    const defaultLeagueFeeMinor = await loadDefaultLeagueFeeMinor();

    let nextFeeOverride = existingLeague.registration_fee_override_minor ?? null;
    if (body.registrationFeeOverrideMinor !== undefined) {
      nextFeeOverride = body.registrationFeeOverrideMinor;
    } else if (body.registrationFeeMinor !== undefined) {
      nextFeeOverride = body.registrationFeeMinor;
    }
    const effectiveRegistrationFeeMinor = effectiveLeagueRegistrationFeeMinor(nextFeeOverride, defaultLeagueFeeMinor);

    const nextFormat = body.format ?? existingLeague.format;
    const nextWaitlistId =
      body.allowsWaitlist === false
        ? null
        : existingLeague.waitlist_id;
    const nextIsPlayInBased =
      body.isPlayInBased !== undefined
        ? body.isPlayInBased
        : toBool((existingLeague as { is_play_in_based?: number }).is_play_in_based ?? 0);

    const nextLeagueRegistrationSettings = {
      id: leagueId,
      format: nextFormat,
      leagueType: body.leagueType ?? existingLeague.league_type,
      capacityType: body.capacityType ?? existingLeague.capacity_type,
      capacityValue: body.capacityValue ?? existingLeague.capacity_value,
      registrationFeeOverrideMinor: nextFeeOverride,
      minExperienceYears:
        nextMinExperienceYears === undefined ? existingLeague.min_experience_years : nextMinExperienceYears,
      maxExperienceYears:
        nextMaxExperienceYears === undefined ? existingLeague.max_experience_years : nextMaxExperienceYears,
      minAge: nextMinAge === undefined ? existingLeague.min_age : nextMinAge,
      maxAge: nextMaxAge === undefined ? existingLeague.max_age : nextMaxAge,
      firstDayOfPlay: body.firstDayOfPlay === undefined ? existingLeague.first_day_of_play : body.firstDayOfPlay,
      lastDayOfPlay: body.lastDayOfPlay === undefined ? existingLeague.last_day_of_play : body.lastDayOfPlay,
      allowsWaitlist: nextWaitlistId != null,
      hasAttachedWaitlist: nextWaitlistId != null,
      isPlayInBased: nextIsPlayInBased,
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
      format: 'teams' | 'doubles' | 'instructional';
      start_date: string;
      end_date: string;
      session_id: number | null;
      league_type: 'standard' | 'bring_your_own_team';
      capacity_type: 'individual' | 'team';
      capacity_value: number;
      registration_fee_minor: number;
      registration_fee_override_minor: number | null;
      requires_club_membership: number;
      min_experience_years: number | null;
      max_experience_years: number | null;
      min_age: number | null;
      max_age: number | null;
      first_day_of_play: string | null;
      last_day_of_play: string | null;
      allows_waitlist: number;
      waitlist_id: number | null;
      is_play_in_based: number;
      allows_sabbatical: number;
      allows_drop_ins: number;
      drop_in_fee_minor: number | null;
      predecessor_league_id: number | null;
      successor_league_id: number | null;
      public_notes: string | null;
      team_formation: 'coordinator' | 'skips_draft';
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
    if (body.registrationFeeOverrideMinor !== undefined || body.registrationFeeMinor !== undefined) {
      updateData.registration_fee_override_minor = nextFeeOverride;
      updateData.registration_fee_minor = effectiveRegistrationFeeMinor;
    }
    if (body.requiresClubMembership !== undefined) {
      updateData.requires_club_membership = body.requiresClubMembership ? 1 : 0;
    }
    if (nextMinExperienceYears !== undefined) {
      updateData.min_experience_years = nextMinExperienceYears;
    }
    if (nextMaxExperienceYears !== undefined) {
      updateData.max_experience_years = nextMaxExperienceYears;
    }
    if (nextMinAge !== undefined) {
      updateData.min_age = nextMinAge;
    }
    if (nextMaxAge !== undefined) {
      updateData.max_age = nextMaxAge;
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
    if (body.isPlayInBased !== undefined) {
      updateData.is_play_in_based = body.isPlayInBased ? 1 : 0;
      if (body.isPlayInBased) {
        updateData.waitlist_id = null;
        updateData.allows_waitlist = 0;
      }
    }
    if (body.allowsSabbatical !== undefined) {
      updateData.allows_sabbatical = body.allowsSabbatical ? 1 : 0;
    }
    if (body.allowsDropIns !== undefined) {
      updateData.allows_drop_ins = body.allowsDropIns ? 1 : 0;
      if (!body.allowsDropIns) {
        updateData.drop_in_fee_minor = null;
      }
    }
    if (body.dropInFeeMinor !== undefined) {
      updateData.drop_in_fee_minor = body.dropInFeeMinor;
    }
    if (body.predecessorLeagueId !== undefined) {
      updateData.predecessor_league_id = body.predecessorLeagueId;
    }
    if (body.successorLeagueId !== undefined) {
      updateData.successor_league_id = body.successorLeagueId;
    }
    if (body.publicNotes !== undefined) {
      const trimmed = body.publicNotes?.trim() ?? '';
      updateData.public_notes = trimmed.length > 0 ? trimmed : null;
    }
    if (body.teamFormation !== undefined) {
      updateData.team_formation = body.teamFormation;
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
      exceptionRows.map((ex) => normalizeDateString(ex.exception_date)),
      defaultLeagueFeeMinor
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
    const leaguesUnsorted = (await db.select().from(schema.leagues)) as League[];
    const leagues = await sortLeaguesByDayOfWeekThenFirstDrawTime(db, schema, leaguesUnsorted);

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
      format: z.enum(['teams', 'doubles', 'instructional']),
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
                  format: { type: 'string', enum: ['teams', 'doubles', 'instructional'] },
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

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/leagues/waitlist-options',
    {
      schema: {
        tags: ['leagues'],
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });
      if (!isAdmin(member) && !isServerAdmin(member) && !hasScope(member.authz, 'leagues.manage')) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      return listLeagueWaitlistsForAttach();
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof leagueWaitlistAttachSchema> }>(
    '/leagues/:id/waitlist',
    {
      schema: {
        tags: ['leagues'],
        params: leagueIdParamsSchema,
        body: leagueWaitlistBodySchema,
        response: { 200: leagueWaitlistBodySchema, 400: leagueWaitlistBodySchema, 403: leagueWaitlistBodySchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });
      const leagueId = parseInt(request.params.id, 10);
      if (!Number.isFinite(leagueId)) return reply.code(400).send({ error: 'Invalid league id' });
      const canManage =
        isAdmin(member) ||
        isServerAdmin(member) ||
        hasScope(member.authz, 'leagues.manage') ||
        leagueManagerLeagueIdsFromMember(member).includes(leagueId);
      if (!canManage) return reply.code(403).send({ error: 'Forbidden' });

      const body = leagueWaitlistAttachSchema.parse(request.body);
      try {
        if (body.mode === 'create') {
          const { db, schema } = getDrizzleDb();
          const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
          const defaultName = body.name?.trim() || `${league?.name ?? 'League'} waitlist`;
          const waitlist = await createAndAttachWaitlistToLeague({ leagueId, name: defaultName });
          return { waitlistId: waitlist.id, name: waitlist.name };
        }
        await attachWaitlistToLeague({ leagueId, waitlistId: body.waitlistId });
        return { waitlistId: body.waitlistId };
      } catch (error) {
        if (handleRegistrationValidationError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/leagues/:id/waitlist',
    {
      schema: {
        tags: ['leagues'],
        params: leagueIdParamsSchema,
        response: { 200: successResponseSchema, 403: leagueWaitlistBodySchema },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return reply.code(401).send({ error: 'Unauthorized' });
      const leagueId = parseInt(request.params.id, 10);
      if (!Number.isFinite(leagueId)) return reply.code(400).send({ error: 'Invalid league id' });
      const canManage =
        isAdmin(member) ||
        isServerAdmin(member) ||
        hasScope(member.authz, 'leagues.manage') ||
        leagueManagerLeagueIdsFromMember(member).includes(leagueId);
      if (!canManage) return reply.code(403).send({ error: 'Forbidden' });
      try {
        await detachWaitlistFromLeague(leagueId);
        return { success: true };
      } catch (error) {
        if (handleRegistrationValidationError(reply, error)) return;
        throw error;
      }
    }
  );
}
