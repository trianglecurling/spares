import { and, asc, eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { getCalendarFeed, getLeagueCalendarFeed } from '../domains/calendar/queries/calendarReadFacade.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import {
  clubOperatingDateFromInstant,
  clubOperatingDayWindow,
  intervalsOverlap,
  isClubOperatingDateString,
  parseFlexibleDateTime,
  toIsoTimestamp,
} from '../utils/clubOperatingDay.js';
import { isBonspielCalendarType, parseCalendarTypeIds } from './eventCalendarTypes.js';
import { getTournamentDrawForEvent } from './eventTournamentDrawService.js';
import { EventServiceError } from './eventServiceError.js';
import {
  listTournamentTeamsForEvent,
  type TournamentTeamRow,
} from './eventTournamentTeamsService.js';
import {
  resolveRegistrationIdForGameSlot,
  stoneColorForSlot,
} from './tournamentSlotResolution.js';

const MS_DAY = 24 * 60 * 60 * 1000;

const LEAGUE_FEED_ID_RE = /^league:(\d+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/;
const EVENT_FEED_ID_RE = /^event:(\d+):(\d+)$/;

const PLAYER_ROLE_ORDER = ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] as const;

export type IceDaySchedulePlayer = {
  position: string;
  name: string | null;
  isSkip?: boolean;
  isVice?: boolean;
};

export type IceDayScheduleTeam = {
  name: string;
  clubName?: string | null;
  stoneColor?: string | null;
  players: IceDaySchedulePlayer[];
};

export type IceDayScheduleActivity = {
  id: string;
  calendarEventId: string;
  typeId: string;
  source: string;
  kind: 'league' | 'bonspiel' | 'other';
  title: string;
  start: string;
  end: string;
  slug?: string;
  gameLabel?: string;
  teams?: IceDayScheduleTeam[];
};

export type IceDayScheduleSheet = {
  id: number;
  name: string;
  activities: IceDayScheduleActivity[];
};

export type IceDaySchedule = {
  date: string;
  timeZone: string;
  dayStart: string;
  dayEnd: string;
  sheets: IceDayScheduleSheet[];
};

type FeedItem = {
  id: string;
  typeId: string;
  title: string;
  start: string | Date;
  end: string | Date;
  source: string;
  slug?: string;
  locations?: Array<{ type: string; sheetId?: number; sheetName?: string }>;
};

export function parseLeagueCalendarEventId(
  id: string
): { leagueId: number; date: string; time: string } | null {
  const match = LEAGUE_FEED_ID_RE.exec(id);
  if (!match) return null;
  return { leagueId: Number(match[1]), date: match[2]!, time: match[3]! };
}

export function parseEventCalendarEventId(id: string): { eventId: number; timespanId: number } | null {
  const match = EVENT_FEED_ID_RE.exec(id);
  if (!match) return null;
  return { eventId: Number(match[1]), timespanId: Number(match[2]) };
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}

function formatTimeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(11, 16);
  }
  if (typeof value === 'string') {
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value ?? '');
}

function sheetIdsOf(item: FeedItem): number[] {
  const ids: number[] = [];
  for (const loc of item.locations ?? []) {
    if (loc.type === 'sheet' && loc.sheetId != null && Number.isFinite(loc.sheetId)) {
      ids.push(loc.sheetId);
    }
  }
  return [...new Set(ids)];
}

function activityKind(item: FeedItem): IceDayScheduleActivity['kind'] {
  if (item.source === 'leagues' || item.typeId === 'leagues') return 'league';
  if (
    item.typeId === 'bonspiel' ||
    item.typeId === 'bonspiel-fours' ||
    item.typeId === 'bonspiel-doubles'
  ) {
    return 'bonspiel';
  }
  return 'other';
}

function compareActivities(a: IceDayScheduleActivity, b: IceDayScheduleActivity): number {
  const byStart = a.start.localeCompare(b.start);
  if (byStart !== 0) return byStart;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.id.localeCompare(b.id);
}

function roleSortKey(role: string): number {
  const index = PLAYER_ROLE_ORDER.indexOf(role as (typeof PLAYER_ROLE_ORDER)[number]);
  return index === -1 ? PLAYER_ROLE_ORDER.length : index;
}

function occupancyActivity(item: FeedItem, startIso: string, endIso: string): IceDayScheduleActivity {
  return {
    id: item.id,
    calendarEventId: item.id,
    typeId: item.typeId,
    source: item.source,
    kind: activityKind(item),
    title: item.title,
    start: startIso,
    end: endIso,
    ...(item.slug ? { slug: item.slug } : {}),
  };
}

type LeagueGameRow = {
  id: number;
  leagueId: number;
  team1Id: number;
  team2Id: number;
  gameDate: string;
  gameTime: string;
  sheetId: number;
};

function gameKey(leagueId: number, date: string, time: string, sheetId: number): string {
  return `${leagueId}|${date}|${time}|${sheetId}`;
}

async function loadLeagueGamesForDraws(
  draws: Array<{ leagueId: number; date: string; time: string }>
): Promise<{
  gamesByDrawSheet: Map<string, LeagueGameRow>;
  teamsById: Map<number, { name: string }>;
  rosterByTeamId: Map<number, IceDaySchedulePlayer[]>;
  lineupByGameTeam: Map<string, IceDaySchedulePlayer[]>;
}> {
  const empty = {
    gamesByDrawSheet: new Map<string, LeagueGameRow>(),
    teamsById: new Map<number, { name: string }>(),
    rosterByTeamId: new Map<number, IceDaySchedulePlayer[]>(),
    lineupByGameTeam: new Map<string, IceDaySchedulePlayer[]>(),
  };
  if (draws.length === 0) return empty;

  const leagueIds = [...new Set(draws.map((draw) => draw.leagueId))];
  const dates = [...new Set(draws.map((draw) => draw.date))];
  const { db, schema } = getDrizzleDb();

  const gameRows = await db
    .select({
      id: schema.games.id,
      league_id: schema.games.league_id,
      team1_id: schema.games.team1_id,
      team2_id: schema.games.team2_id,
      game_date: schema.games.game_date,
      game_time: schema.games.game_time,
      sheet_id: schema.games.sheet_id,
      status: schema.games.status,
    })
    .from(schema.games)
    .where(
      and(
        inArray(schema.games.league_id, leagueIds),
        eq(schema.games.status, 'scheduled')
      )
    );

  const wanted = new Set(draws.map((draw) => `${draw.leagueId}|${draw.date}|${draw.time}`));
  const games: LeagueGameRow[] = [];
  for (const row of gameRows) {
    if (row.sheet_id == null) continue;
    const gameDate = formatDateValue(row.game_date);
    const gameTime = formatTimeValue(row.game_time);
    if (!dates.includes(gameDate)) continue;
    if (!wanted.has(`${row.league_id}|${gameDate}|${gameTime}`)) continue;
    games.push({
      id: row.id,
      leagueId: row.league_id,
      team1Id: row.team1_id,
      team2Id: row.team2_id,
      gameDate,
      gameTime,
      sheetId: row.sheet_id,
    });
  }

  if (games.length === 0) return empty;

  const gamesByDrawSheet = new Map<string, LeagueGameRow>();
  for (const game of games) {
    gamesByDrawSheet.set(gameKey(game.leagueId, game.gameDate, game.gameTime, game.sheetId), game);
  }

  const teamIds = [...new Set(games.flatMap((game) => [game.team1Id, game.team2Id]))];
  const gameIds = games.map((game) => game.id);

  const [teamRows, rosterRows, lineupRows] = await Promise.all([
    db
      .select({ id: schema.leagueTeams.id, name: schema.leagueTeams.name })
      .from(schema.leagueTeams)
      .where(inArray(schema.leagueTeams.id, teamIds)),
    db
      .select({
        team_id: schema.teamMembers.team_id,
        role: schema.teamMembers.role,
        is_skip: schema.teamMembers.is_skip,
        is_vice: schema.teamMembers.is_vice,
        name: schema.members.name,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
      .where(inArray(schema.teamMembers.team_id, teamIds)),
    db
      .select({
        game_id: schema.gameLineups.game_id,
        team_id: schema.gameLineups.team_id,
        role: schema.gameLineups.role,
        name: schema.members.name,
      })
      .from(schema.gameLineups)
      .innerJoin(schema.members, eq(schema.gameLineups.member_id, schema.members.id))
      .where(inArray(schema.gameLineups.game_id, gameIds)),
  ]);

  const teamsById = new Map(teamRows.map((row) => [row.id, { name: row.name?.trim() || `Team ${row.id}` }]));

  const rosterByTeamId = new Map<number, IceDaySchedulePlayer[]>();
  for (const row of rosterRows) {
    const list = rosterByTeamId.get(row.team_id) ?? [];
    list.push({
      position: row.role,
      name: row.name?.trim() || null,
      isSkip: row.is_skip === 1,
      isVice: row.is_vice === 1,
    });
    rosterByTeamId.set(row.team_id, list);
  }
  for (const [teamId, players] of rosterByTeamId) {
    players.sort((a, b) => roleSortKey(a.position) - roleSortKey(b.position));
    rosterByTeamId.set(teamId, players);
  }

  const lineupByGameTeam = new Map<string, IceDaySchedulePlayer[]>();
  for (const row of lineupRows) {
    const key = `${row.game_id}:${row.team_id}`;
    const list = lineupByGameTeam.get(key) ?? [];
    list.push({
      position: row.role,
      name: row.name?.trim() || null,
    });
    lineupByGameTeam.set(key, list);
  }
  for (const [key, players] of lineupByGameTeam) {
    players.sort((a, b) => roleSortKey(a.position) - roleSortKey(b.position));
    lineupByGameTeam.set(key, players);
  }

  return { gamesByDrawSheet, teamsById, rosterByTeamId, lineupByGameTeam };
}

function leagueTeamsForGame(
  game: LeagueGameRow,
  teamsById: Map<number, { name: string }>,
  rosterByTeamId: Map<number, IceDaySchedulePlayer[]>,
  lineupByGameTeam: Map<string, IceDaySchedulePlayer[]>
): IceDayScheduleTeam[] {
  return [game.team1Id, game.team2Id].map((teamId) => {
    const lineup = lineupByGameTeam.get(`${game.id}:${teamId}`);
    return {
      name: teamsById.get(teamId)?.name ?? `Team ${teamId}`,
      players: lineup ?? rosterByTeamId.get(teamId) ?? [],
    };
  });
}

function bonspielTeamFromRegistration(
  team: TournamentTeamRow | undefined,
  stoneColor: string | null
): IceDayScheduleTeam | null {
  if (!team) return null;
  const trimmedName = team.teamName?.trim();
  return {
    name: trimmedName || `Team ${team.sortOrder + 1}`,
    clubName: team.homeClub,
    stoneColor,
    players: team.roster.map((row) => ({
      position: row.slotCode,
      name: row.playerName?.trim() || null,
    })),
  };
}

export async function getIceDaySchedule(input: {
  date?: string;
  member?: Member;
  now?: Date;
}): Promise<IceDaySchedule> {
  const timeZone = config.timeZone;
  const now = input.now ?? new Date();
  const date = input.date?.trim() || clubOperatingDateFromInstant(now, timeZone);
  if (!date || !isClubOperatingDateString(date)) {
    throw new IceDayScheduleError('Invalid date', 400);
  }

  const { dayStart, dayEnd } = clubOperatingDayWindow(date, timeZone);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
    throw new IceDayScheduleError('Invalid date', 400);
  }

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const queryStart = new Date(dayStartMs - MS_DAY).toISOString();
  const queryEnd = new Date(dayEndMs + MS_DAY).toISOString();

  const { db, schema } = getDrizzleDb();
  const [sheetRows, calendarEvents, leagueEvents] = await Promise.all([
    db
      .select({ id: schema.sheets.id, name: schema.sheets.name })
      .from(schema.sheets)
      .where(eq(schema.sheets.is_active, 1))
      .orderBy(asc(schema.sheets.sort_order), asc(schema.sheets.name)),
    getCalendarFeed({ start: queryStart, end: queryEnd, member: input.member }),
    getLeagueCalendarFeed(queryStart, queryEnd),
  ]);

  const items = ([...calendarEvents, ...leagueEvents] as FeedItem[]).filter((item) => {
    const startMs = new Date(toIsoTimestamp(item.start)).getTime();
    const endMs = new Date(toIsoTimestamp(item.end)).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && intervalsOverlap(startMs, endMs, dayStartMs, dayEndMs);
  });

  const leagueDraws: Array<{ leagueId: number; date: string; time: string }> = [];
  const eventIds: number[] = [];
  for (const item of items) {
    const league = parseLeagueCalendarEventId(item.id);
    if (league) leagueDraws.push(league);
    const event = parseEventCalendarEventId(item.id);
    if (event) eventIds.push(event.eventId);
  }

  const uniqueEventIds = [...new Set(eventIds)];
  const [leagueLookup, eventRows] = await Promise.all([
    loadLeagueGamesForDraws(leagueDraws),
    uniqueEventIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: schema.events.id,
            calendar_type_ids: schema.events.calendar_type_ids,
            tournament_teams_published: schema.events.tournament_teams_published,
            tournament_draw_published: schema.events.tournament_draw_published,
          })
          .from(schema.events)
          .where(inArray(schema.events.id, uniqueEventIds)),
  ]);

  const eventMetaById = new Map(eventRows.map((row) => [row.id, row]));

  type BonspielEnrichment = {
    gamesBySheet: Map<number, IceDayScheduleActivity[]>;
  };
  const bonspielByEventId = new Map<number, BonspielEnrichment>();

  const bonspielEventIds = eventRows
    .filter((row) => isBonspielCalendarType(parseCalendarTypeIds(row.calendar_type_ids)))
    .map((row) => row.id);

  await Promise.all(
    bonspielEventIds.map(async (eventId) => {
      const meta = eventMetaById.get(eventId);
      if (!meta || meta.tournament_draw_published !== 1) return;

      let draw;
      try {
        draw = await getTournamentDrawForEvent(eventId);
      } catch (err) {
        if (err instanceof EventServiceError) return;
        throw err;
      }
      if (!draw) return;

      let teams: TournamentTeamRow[] = [];
      if (meta.tournament_teams_published === 1) {
        try {
          teams = await listTournamentTeamsForEvent(eventId);
        } catch (err) {
          if (!(err instanceof EventServiceError)) throw err;
        }
      }
      const teamsById = new Map(teams.map((team) => [team.id, team]));

      const calendarItem = items.find((item) => parseEventCalendarEventId(item.id)?.eventId === eventId);
      const gamesBySheet = new Map<number, IceDayScheduleActivity[]>();

      for (const game of Object.values(draw.games)) {
        const sheetId = game.schedule?.sheetId;
        if (sheetId == null || sheetId <= 0) continue;

        const block = game.schedule?.drawBlockId
          ? draw.drawBlocks.find((row) => row.id === game.schedule?.drawBlockId)
          : undefined;
        const scheduledStart =
          parseFlexibleDateTime(game.schedule?.startTime, timeZone) ??
          parseFlexibleDateTime(block?.startTime, timeZone);
        if (!scheduledStart) continue;
        const scheduledEnd =
          parseFlexibleDateTime(game.schedule?.endTime, timeZone) ??
          parseFlexibleDateTime(block?.endTime, timeZone);
        const start = scheduledStart;
        const end =
          scheduledEnd && scheduledEnd.getTime() > start.getTime()
            ? scheduledEnd
            : new Date(start.getTime() + 2 * 60 * 60 * 1000);
        if (!intervalsOverlap(start.getTime(), end.getTime(), dayStartMs, dayEndMs)) continue;

        const sides: IceDayScheduleTeam[] = [];
        for (let slotIndex = 0; slotIndex < game.slots.length; slotIndex += 1) {
          const registrationId = resolveRegistrationIdForGameSlot(draw, game, slotIndex);
          const stoneColor = stoneColorForSlot(draw, game, slotIndex);
          const team = registrationId != null ? bonspielTeamFromRegistration(teamsById.get(registrationId), stoneColor) : null;
          if (team) sides.push(team);
        }

        const activity: IceDayScheduleActivity = {
          id: `${calendarItem?.id ?? `event:${eventId}`}:game:${game.id}`,
          calendarEventId: calendarItem?.id ?? `event:${eventId}`,
          typeId: calendarItem?.typeId ?? 'bonspiel',
          source: calendarItem?.source ?? 'events',
          kind: 'bonspiel',
          title: calendarItem?.title ?? 'Bonspiel',
          start: start.toISOString(),
          end: end.toISOString(),
          ...(calendarItem?.slug ? { slug: calendarItem.slug } : {}),
          gameLabel: game.label,
          ...(sides.length > 0 ? { teams: sides } : {}),
        };

        const list = gamesBySheet.get(sheetId) ?? [];
        list.push(activity);
        gamesBySheet.set(sheetId, list);
      }

      bonspielByEventId.set(eventId, { gamesBySheet });
    })
  );

  const activitiesBySheet = new Map<number, IceDayScheduleActivity[]>();
  const ensureSheet = (sheetId: number) => {
    if (!activitiesBySheet.has(sheetId)) activitiesBySheet.set(sheetId, []);
    return activitiesBySheet.get(sheetId)!;
  };

  for (const item of items) {
    const startIso = toIsoTimestamp(item.start);
    const endIso = toIsoTimestamp(item.end);
    const kind = activityKind(item);
    const locationSheetIds = sheetIdsOf(item);

    if (kind === 'league') {
      const parsed = parseLeagueCalendarEventId(item.id);
      const sheets = locationSheetIds.length > 0 ? locationSheetIds : sheetRows.map((row) => row.id);
      for (const sheetId of sheets) {
        const game =
          parsed != null
            ? leagueLookup.gamesByDrawSheet.get(gameKey(parsed.leagueId, parsed.date, parsed.time, sheetId))
            : undefined;
        const activity = occupancyActivity(item, startIso, endIso);
        if (game) {
          activity.id = `${item.id}:sheet:${sheetId}:game:${game.id}`;
          activity.teams = leagueTeamsForGame(
            game,
            leagueLookup.teamsById,
            leagueLookup.rosterByTeamId,
            leagueLookup.lineupByGameTeam
          );
        }
        ensureSheet(sheetId).push(activity);
      }
      continue;
    }

    if (kind === 'bonspiel') {
      const parsed = parseEventCalendarEventId(item.id);
      const enrichment = parsed ? bonspielByEventId.get(parsed.eventId) : undefined;
      const drawSheetIds = enrichment ? [...enrichment.gamesBySheet.keys()] : [];
      const occupancySheetIds = locationSheetIds;
      const replaced = new Set<number>();

      for (const sheetId of drawSheetIds) {
        if (occupancySheetIds.length > 0 && !occupancySheetIds.includes(sheetId)) continue;
        const games = enrichment?.gamesBySheet.get(sheetId) ?? [];
        if (games.length === 0) continue;
        ensureSheet(sheetId).push(...games);
        replaced.add(sheetId);
      }

      for (const sheetId of occupancySheetIds) {
        if (replaced.has(sheetId)) continue;
        ensureSheet(sheetId).push(occupancyActivity(item, startIso, endIso));
      }
      continue;
    }

    for (const sheetId of locationSheetIds) {
      ensureSheet(sheetId).push(occupancyActivity(item, startIso, endIso));
    }
  }

  const sheets: IceDayScheduleSheet[] = sheetRows.map((row) => ({
    id: row.id,
    name: row.name,
    activities: (activitiesBySheet.get(row.id) ?? []).slice().sort(compareActivities),
  }));

  for (const [sheetId, activities] of activitiesBySheet) {
    if (sheets.some((sheet) => sheet.id === sheetId)) continue;
    sheets.push({
      id: sheetId,
      name: `Sheet ${sheetId}`,
      activities: activities.slice().sort(compareActivities),
    });
  }

  return {
    date,
    timeZone,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    sheets,
  };
}

export class IceDayScheduleError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'IceDayScheduleError';
    this.statusCode = statusCode;
  }
}
