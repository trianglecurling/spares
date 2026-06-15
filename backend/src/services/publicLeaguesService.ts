import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { effectiveLeagueRegistrationFeeMinor } from '../registration/registrationConfigValidation.js';
import {
  resolveAdjacentSessionsForLeagues,
  resolveRelevantSessionIdForLeagues,
} from './curlingSessionService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { sortLeaguesByDayOfWeekThenFirstDrawTime } from '../utils/leagueOrdering.js';
import {
  buildPublicLeagueCapacityText,
  buildPublicLeagueCostText,
  buildPublicLeagueDatesText,
  buildPublicLeagueTypeText,
  formatPublicDrawTime,
} from '../utils/publicLeagueDisplay.js';

export type PublicLeagueRow = {
  id: number;
  name: string;
  leagueTypeText: string;
  capacityText: string;
  datesText: string;
  drawTimesText: string;
  coordinators: string[];
  costText: string;
  publicNotes: string | null;
};

export type PublicLeaguesPagePayload = {
  session: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  previousSession: { id: number; name: string } | null;
  nextSession: { id: number; name: string } | null;
  leagues: PublicLeagueRow[];
};

function normalizeDateString(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toBool(value: number | boolean | null | undefined): boolean {
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

async function loadDrawTimesByLeagueIds(leagueIds: number[]): Promise<Map<number, string[]>> {
  const byLeagueId = new Map<number, string[]>();
  if (leagueIds.length === 0) return byLeagueId;

  const { db, schema } = getDrizzleDb();
  const allRows = await db
    .select({
      leagueId: schema.leagueDrawTimes.league_id,
      drawTime: schema.leagueDrawTimes.draw_time,
    })
    .from(schema.leagueDrawTimes)
    .where(inArray(schema.leagueDrawTimes.league_id, leagueIds))
    .orderBy(asc(schema.leagueDrawTimes.league_id), asc(schema.leagueDrawTimes.draw_time));

  for (const row of allRows) {
    const list = byLeagueId.get(row.leagueId) ?? [];
    list.push(row.drawTime);
    byLeagueId.set(row.leagueId, list);
  }
  return byLeagueId;
}

async function loadExceptionsByLeagueIds(leagueIds: number[]): Promise<Map<number, string[]>> {
  const byLeagueId = new Map<number, string[]>();
  if (leagueIds.length === 0) return byLeagueId;

  const { db, schema } = getDrizzleDb();
  const allRows = await db
    .select({
      leagueId: schema.leagueExceptions.league_id,
      exceptionDate: schema.leagueExceptions.exception_date,
    })
    .from(schema.leagueExceptions)
    .where(inArray(schema.leagueExceptions.league_id, leagueIds))
    .orderBy(asc(schema.leagueExceptions.league_id), asc(schema.leagueExceptions.exception_date));

  for (const row of allRows) {
    if (!leagueIds.includes(row.leagueId)) continue;
    const list = byLeagueId.get(row.leagueId) ?? [];
    list.push(normalizeDateString(row.exceptionDate));
    byLeagueId.set(row.leagueId, list);
  }
  return byLeagueId;
}

async function loadCoordinatorNamesByLeagueIds(leagueIds: number[]): Promise<Map<number, string[]>> {
  const byLeagueId = new Map<number, string[]>();
  if (leagueIds.length === 0) return byLeagueId;

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueMemberRoles.league_id,
      name: schema.members.name,
    })
    .from(schema.leagueMemberRoles)
    .innerJoin(schema.members, eq(schema.leagueMemberRoles.member_id, schema.members.id))
    .where(
      and(
        inArray(schema.leagueMemberRoles.league_id, leagueIds),
        eq(schema.leagueMemberRoles.role, 'league_manager')
      )
    )
    .orderBy(asc(schema.leagueMemberRoles.league_id), asc(schema.members.name));

  for (const row of rows) {
    if (row.leagueId == null) continue;
    const list = byLeagueId.get(row.leagueId) ?? [];
    list.push(row.name);
    byLeagueId.set(row.leagueId, list);
  }
  return byLeagueId;
}

export async function getPublicLeaguesPage(sessionId?: number | null): Promise<PublicLeaguesPagePayload | null> {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  let resolvedSessionId = sessionId ?? null;
  if (resolvedSessionId == null) {
    resolvedSessionId = await resolveRelevantSessionIdForLeagues(today);
  }

  if (resolvedSessionId == null) {
    return null;
  }

  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, resolvedSessionId))
    .limit(1);

  if (!session) {
    return null;
  }

  const leaguesUnsorted = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, resolvedSessionId));

  const leagues = await sortLeaguesByDayOfWeekThenFirstDrawTime(db, schema, leaguesUnsorted);
  const leagueIds = leagues.map((league) => league.id);
  const defaultLeagueFeeMinor = await loadDefaultLeagueFeeMinor();
  const [drawTimesByLeagueId, exceptionsByLeagueId, coordinatorsByLeagueId, adjacent] = await Promise.all([
    loadDrawTimesByLeagueIds(leagueIds),
    loadExceptionsByLeagueIds(leagueIds),
    loadCoordinatorNamesByLeagueIds(leagueIds),
    resolveAdjacentSessionsForLeagues(resolvedSessionId),
  ]);

  const publicLeagues: PublicLeagueRow[] = leagues.map((league) => {
    const row = league as typeof league & {
      league_type?: 'standard' | 'bring_your_own_team';
      capacity_type?: 'individual' | 'team';
      capacity_value?: number;
      registration_fee_override_minor?: number | null;
      registration_fee_minor?: number;
      min_age?: number | null;
      max_age?: number | null;
      max_experience_years?: number | null;
      first_day_of_play?: unknown;
      last_day_of_play?: unknown;
      allows_drop_ins?: number;
      is_play_in_based?: number;
      public_notes?: string | null;
      team_formation?: 'coordinator' | 'skips_draft';
    };

    const drawTimes = drawTimesByLeagueId.get(league.id) ?? [];
    const exceptions = exceptionsByLeagueId.get(league.id) ?? [];
    const allowsDropIns = toBool(row.allows_drop_ins ?? 0);
    const registrationFeeMinor = effectiveLeagueRegistrationFeeMinor(
      row.registration_fee_override_minor ?? null,
      defaultLeagueFeeMinor
    );

    return {
      id: league.id,
      name: league.name,
      leagueTypeText: buildPublicLeagueTypeText({
        format: league.format,
        leagueType: row.league_type ?? 'standard',
        teamFormation: row.team_formation ?? 'coordinator',
        allowsDropIns,
        isPlayInBased: toBool(row.is_play_in_based ?? 0),
        minAge: row.min_age ?? null,
        maxAge: row.max_age ?? null,
        maxExperienceYears: row.max_experience_years ?? null,
      }),
      capacityText: buildPublicLeagueCapacityText({
        format: league.format,
        capacityType: row.capacity_type ?? 'individual',
        capacityValue: row.capacity_value ?? 0,
        allowsDropIns,
      }),
      datesText: buildPublicLeagueDatesText({
        firstDayOfPlay: row.first_day_of_play ? normalizeDateString(row.first_day_of_play) : null,
        lastDayOfPlay: row.last_day_of_play ? normalizeDateString(row.last_day_of_play) : null,
        startDate: normalizeDateString(league.start_date),
        endDate: normalizeDateString(league.end_date),
        exceptions,
      }),
      drawTimesText: drawTimes.map(formatPublicDrawTime).join(' and '),
      coordinators: coordinatorsByLeagueId.get(league.id) ?? [],
      costText: buildPublicLeagueCostText(registrationFeeMinor),
      publicNotes: row.public_notes?.trim() || null,
    };
  });

  return {
    session: {
      id: session.id,
      name: session.name,
      startDate: normalizeDateString(session.startDate),
      endDate: normalizeDateString(session.endDate),
    },
    previousSession: adjacent.previous,
    nextSession: adjacent.next,
    leagues: publicLeagues,
  };
}
