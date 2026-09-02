import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { DEFAULT_SITE_NAME } from './spaDocumentMeta.js';
import {
  isBonspielCalendarType,
  parseCalendarTypeIds,
} from './eventCalendarTypes.js';
import {
  listTournamentTeamsForEvent,
  type TournamentTeamRow,
} from './eventTournamentTeamsService.js';
import { EventServiceError } from './eventServiceError.js';
import { memberNamePartsFromStored, splitMemberDisplayName } from '../utils/memberName.js';
import { notArchivedCondition } from '../utils/softDelete.js';
import { getCurrentDateStringAsync, getCurrentTimeAsync } from '../utils/time.js';

export const CATALOG_PLAYER_POSITIONS = [
  'lead',
  'second',
  'third',
  'fourth',
  'player1',
  'player2',
] as const;

export type CatalogPlayerPosition = (typeof CATALOG_PLAYER_POSITIONS)[number];

export type CatalogPlayer = {
  firstName: string;
  lastName: string;
  homeClub: string;
  position: CatalogPlayerPosition;
  isVice: boolean;
  isSkip: boolean;
};

export type CatalogTeam = {
  teamName: string;
  players: CatalogPlayer[];
};

export type CatalogContext = {
  id: number;
  name: string;
  teams: CatalogTeam[];
};

export type TeamCatalogResponse = {
  events: CatalogContext[];
  leagues: CatalogContext[];
};

const POSITION_SET = new Set<string>(CATALOG_PLAYER_POSITIONS);
const POSITION_ORDER = new Map<CatalogPlayerPosition, number>(
  CATALOG_PLAYER_POSITIONS.map((position, index) => [position, index]),
);

export function catalogPlayerPositionFromSlot(slot: string | null | undefined): CatalogPlayerPosition | null {
  if (!slot) return null;
  return POSITION_SET.has(slot) ? (slot as CatalogPlayerPosition) : null;
}

export function compareCatalogPlayers(a: CatalogPlayer, b: CatalogPlayer): number {
  const orderA = POSITION_ORDER.get(a.position) ?? Number.MAX_SAFE_INTEGER;
  const orderB = POSITION_ORDER.get(b.position) ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
}

export function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** True when the league's last day of play (or end date) is before club-local today. */
export function leagueHasConcluded(
  input: { lastDayOfPlay: unknown; endDate: unknown },
  today: string,
): boolean {
  const end = toDateOnly(input.lastDayOfPlay) ?? toDateOnly(input.endDate);
  if (!end) return true;
  return end < today;
}

export function eventHasConcluded(latestEndMs: number, nowMs: number): boolean {
  return latestEndMs < nowMs;
}

export function resolveCatalogTeamName(
  storedName: string | null | undefined,
  players: CatalogPlayer[],
): string {
  const named = storedName?.trim();
  if (named) return named;
  const skip = players.find((player) => player.isSkip) ?? players.find((player) => player.isVice) ?? players[0];
  if (skip?.lastName) return `Team ${skip.lastName}`;
  return 'Unnamed team';
}

export function mapTournamentTeamToCatalogTeam(team: TournamentTeamRow): CatalogTeam {
  const players: CatalogPlayer[] = [];
  for (const slot of team.roster) {
    const position = catalogPlayerPositionFromSlot(slot.slotCode);
    if (!position) continue;
    const name = slot.playerName?.trim();
    if (!name) continue;
    const { firstName, lastName } = splitMemberDisplayName(name);
    players.push({
      firstName,
      lastName,
      homeClub: slot.homeClub?.trim() || '',
      position,
      isVice: slot.slotCode === team.viceSlotCode,
      isSkip: slot.slotCode === team.skipSlotCode,
    });
  }
  players.sort(compareCatalogPlayers);
  return {
    teamName: team.teamName?.trim() || 'Unnamed team',
    players,
  };
}

export function mapLeagueMemberToCatalogPlayer(row: {
  firstName: string | null;
  lastName: string | null;
  name: string;
  role: string;
  isSkip: boolean;
  isVice: boolean;
  homeClub: string;
}): CatalogPlayer | null {
  const position = catalogPlayerPositionFromSlot(row.role);
  if (!position) return null;
  const names = memberNamePartsFromStored({
    name: row.name,
    first_name: row.firstName,
    last_name: row.lastName,
  });
  if (!names.firstName && !names.lastName) return null;
  return {
    firstName: names.firstName,
    lastName: names.lastName,
    homeClub: row.homeClub,
    position,
    isVice: row.isVice,
    isSkip: row.isSkip,
  };
}

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function getConfiguredClubName(): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ clubName: schema.siteConfig.club_name })
    .from(schema.siteConfig)
    .where(eq(schema.siteConfig.id, 1))
    .limit(1);
  return row?.clubName?.trim() || DEFAULT_SITE_NAME;
}

async function listCurrentLeagueContexts(): Promise<CatalogContext[]> {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();
  const homeClub = await getConfiguredClubName();

  const teamRows = await db
    .select({
      teamId: schema.leagueTeams.id,
      teamName: schema.leagueTeams.name,
      leagueId: schema.leagues.id,
      leagueName: schema.leagues.name,
      endDate: schema.leagues.end_date,
      lastDayOfPlay: schema.leagues.last_day_of_play,
    })
    .from(schema.leagueTeams)
    .innerJoin(schema.leagues, eq(schema.leagueTeams.league_id, schema.leagues.id));

  const activeTeams = teamRows.filter(
    (row) =>
      !leagueHasConcluded(
        { lastDayOfPlay: row.lastDayOfPlay, endDate: row.endDate },
        today,
      ),
  );
  if (activeTeams.length === 0) return [];

  const teamIds = [...new Set(activeTeams.map((row) => row.teamId))];
  const rosterRows =
    teamIds.length > 0
      ? await db
          .select({
            teamId: schema.teamMembers.team_id,
            role: schema.teamMembers.role,
            isSkip: schema.teamMembers.is_skip,
            isVice: schema.teamMembers.is_vice,
            name: schema.members.name,
            firstName: schema.members.first_name,
            lastName: schema.members.last_name,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
          .where(inArray(schema.teamMembers.team_id, teamIds))
      : [];

  const playersByTeam = new Map<number, CatalogPlayer[]>();
  for (const row of rosterRows) {
    const player = mapLeagueMemberToCatalogPlayer({
      firstName: row.firstName,
      lastName: row.lastName,
      name: row.name,
      role: row.role,
      isSkip: row.isSkip === 1,
      isVice: row.isVice === 1,
      homeClub,
    });
    if (!player) continue;
    const list = playersByTeam.get(row.teamId) ?? [];
    list.push(player);
    playersByTeam.set(row.teamId, list);
  }

  const leagues = new Map<number, CatalogContext>();
  for (const row of activeTeams) {
    const existing = leagues.get(row.leagueId) ?? {
      id: row.leagueId,
      name: row.leagueName,
      teams: [],
    };
    const players = (playersByTeam.get(row.teamId) ?? []).slice().sort(compareCatalogPlayers);
    existing.teams.push({
      teamName: resolveCatalogTeamName(row.teamName, players),
      players,
    });
    leagues.set(row.leagueId, existing);
  }

  return [...leagues.values()]
    .map((league) => ({
      ...league,
      teams: league.teams.slice().sort((a, b) => a.teamName.localeCompare(b.teamName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listCurrentEventContexts(): Promise<CatalogContext[]> {
  const { db, schema } = getDrizzleDb();
  const nowMs = (await getCurrentTimeAsync()).getTime();

  const timespanRows = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      calendarTypeIds: schema.events.calendar_type_ids,
      endDt: schema.eventTimespans.end_dt,
    })
    .from(schema.events)
    .innerJoin(schema.eventTimespans, eq(schema.eventTimespans.event_id, schema.events.id))
    .where(notArchivedCondition(schema.events.archived_at));

  const byEventId = new Map<number, { title: string; latestEndMs: number }>();
  for (const row of timespanRows) {
    if (!isBonspielCalendarType(parseCalendarTypeIds(row.calendarTypeIds))) continue;
    const endMs = new Date(toIsoTimestamp(row.endDt as string | Date)).getTime();
    if (!Number.isFinite(endMs)) continue;
    const existing = byEventId.get(row.eventId);
    if (!existing) {
      byEventId.set(row.eventId, { title: row.title, latestEndMs: endMs });
      continue;
    }
    if (endMs > existing.latestEndMs) existing.latestEndMs = endMs;
  }

  const candidateIds = [...byEventId.entries()]
    .filter(([, event]) => !eventHasConcluded(event.latestEndMs, nowMs))
    .map(([eventId]) => eventId);
  if (candidateIds.length === 0) return [];

  const confirmedRows = await db
    .select({ eventId: schema.eventRegistrations.event_id })
    .from(schema.eventRegistrations)
    .where(
      and(
        inArray(schema.eventRegistrations.event_id, candidateIds),
        eq(schema.eventRegistrations.status, 'confirmed'),
      ),
    );
  const eventsWithTeams = new Set(confirmedRows.map((row) => row.eventId));

  const contexts: CatalogContext[] = [];
  for (const eventId of candidateIds) {
    if (!eventsWithTeams.has(eventId)) continue;
    const meta = byEventId.get(eventId);
    if (!meta) continue;
    let teams: TournamentTeamRow[];
    try {
      teams = await listTournamentTeamsForEvent(eventId);
    } catch (err) {
      if (err instanceof EventServiceError) continue;
      throw err;
    }
    if (teams.length === 0) continue;
    contexts.push({
      id: eventId,
      name: meta.title,
      teams: teams
        .map(mapTournamentTeamToCatalogTeam)
        .sort((a, b) => a.teamName.localeCompare(b.teamName)),
    });
  }

  return contexts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTeamCatalog(): Promise<TeamCatalogResponse> {
  const [events, leagues] = await Promise.all([
    listCurrentEventContexts(),
    listCurrentLeagueContexts(),
  ]);
  return { events, leagues };
}
