import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { formatTeamHomeClubFromRoster } from '../utils/tournamentTeamHomeClub.js';
import { splitMemberDisplayName } from '../utils/memberName.js';
import { EventServiceError } from './eventServiceError.js';
import {
  isBonspielCalendarType,
  normalizeTournamentFormat,
  parseCalendarTypeIds,
} from './eventCalendarTypes.js';

export type TournamentFormat = 'fours' | 'doubles';

/** Lineup slots for fours (no alternate — registration presets only have four players). */
export const FOURS_SLOTS = ['lead', 'second', 'third', 'fourth'] as const;
export const DOUBLES_SLOTS = ['player1', 'player2'] as const;

type TeamPlayerRow = { name: string; email: string; homeClub: string };

type EventTournamentContext = {
  id: number;
  calendar_type_ids: string | null;
  tournament_format: string | null;
};

async function getEventTournamentContext(eventId: number): Promise<EventTournamentContext | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.events.id,
      calendar_type_ids: schema.events.calendar_type_ids,
      tournament_format: schema.events.tournament_format,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

function assertBonspiel(event: { calendar_type_ids: string | null }): void {
  if (!isBonspielCalendarType(parseCalendarTypeIds(event.calendar_type_ids))) {
    throw new EventServiceError('Tournament teams are only available for bonspiel events', 400);
  }
}

export function rosterSlotsForFormat(format: TournamentFormat): readonly string[] {
  return format === 'fours' ? FOURS_SLOTS : DOUBLES_SLOTS;
}

export function defaultViceSkip(format: TournamentFormat): { vice: string; skip: string } {
  return format === 'fours'
    ? { vice: 'third', skip: 'fourth' }
    : { vice: 'player1', skip: 'player2' };
}

export { normalizeTournamentFormat };

function parseTeamPlayers(value: string, fieldType: string): TeamPlayerRow[] | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const want = fieldType === 'preset_team_doubles' ? 2 : 4;
    if (parsed.length !== want) return null;
    return parsed.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: typeof r.name === 'string' ? r.name : '',
        email: typeof r.email === 'string' ? r.email : '',
        homeClub: typeof r.homeClub === 'string' ? r.homeClub : '',
      };
    });
  } catch {
    return null;
  }
}

function resolveTeamName(
  fieldValues: Array<{ field_id: number; value: string | null }>,
  fields: Array<{ id: number; field_type: string }>,
  contactName: string,
): string {
  const teamNameField = fields.find((f) => f.field_type === 'preset_team_name');
  if (teamNameField) {
    const value = fieldValues.find((fv) => fv.field_id === teamNameField.id)?.value?.trim();
    if (value) return value;
  }

  const { lastName, firstName } = splitMemberDisplayName(contactName);
  if (lastName.trim()) return `Team ${lastName.trim()}`;
  if (firstName.trim()) return `Team ${firstName.trim()}`;
  return 'Team';
}

function buildRosterFromRegistration(
  format: TournamentFormat,
  teamFieldType: string | null,
  players: TeamPlayerRow[] | null,
): TournamentTeamRow['roster'] {
  const lineupSlots =
    teamFieldType === 'preset_team_doubles'
      ? DOUBLES_SLOTS
      : teamFieldType === 'preset_team_four'
        ? FOURS_SLOTS
        : format === 'doubles'
          ? DOUBLES_SLOTS
          : FOURS_SLOTS;

  const roster: TournamentTeamRow['roster'] = rosterSlotsForFormat(format).map((slotCode) => ({
    slotCode,
    playerName: null,
    email: null,
    notes: null,
    homeClub: null,
  }));

  if (!players) return roster;

  for (let i = 0; i < players.length && i < lineupSlots.length; i += 1) {
    const slotCode = lineupSlots[i]!;
    const player = players[i]!;
    const idx = roster.findIndex((r) => r.slotCode === slotCode);
    if (idx === -1) continue;
    roster[idx] = {
      slotCode,
      playerName: player.name.trim() || null,
      email: player.email.trim() || null,
      notes: null,
      homeClub: player.homeClub.trim() || null,
    };
  }

  return roster;
}

export type TournamentTeamRow = {
  /** Registration id (confirmed registrations are teams). */
  id: number;
  eventId: number;
  sortOrder: number;
  teamName: string | null;
  homeClub: string | null;
  viceSlotCode: string;
  skipSlotCode: string;
  roster: Array<{
    slotCode: string;
    playerName: string | null;
    email: string | null;
    notes: string | null;
    homeClub: string | null;
  }>;
};

export async function countConfirmedTournamentTeams(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.eventRegistrations.id })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'confirmed'),
      ),
    );
  return rows.length;
}

/** @deprecated Use countConfirmedTournamentTeams */
export async function countTournamentTeams(eventId: number): Promise<number> {
  return countConfirmedTournamentTeams(eventId);
}

/**
 * Confirmed registrations for a bonspiel, shaped as tournament teams.
 * `id` is the registration id.
 */
export async function listTournamentTeamsForEvent(eventId: number): Promise<TournamentTeamRow[]> {
  const { db, schema } = getDrizzleDb();
  const event = await getEventTournamentContext(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  assertBonspiel(event);

  const format = normalizeTournamentFormat(event.tournament_format);
  if (!format) {
    throw new EventServiceError('Bonspiel event is missing fours/doubles format', 400);
  }

  const registrations = await db
    .select({
      id: schema.eventRegistrations.id,
      contact_name: schema.eventRegistrations.contact_name,
      created_at: schema.eventRegistrations.created_at,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'confirmed'),
      ),
    )
    .orderBy(asc(schema.eventRegistrations.id));

  if (registrations.length === 0) return [];

  const fields = await db
    .select({
      id: schema.eventRegistrationFields.id,
      field_type: schema.eventRegistrationFields.field_type,
    })
    .from(schema.eventRegistrationFields)
    .where(eq(schema.eventRegistrationFields.event_id, eventId));

  const registrationIds = registrations.map((r) => r.id);
  const fieldValues =
    registrationIds.length > 0
      ? await db
          .select({
            registration_id: schema.eventRegistrationFieldValues.registration_id,
            field_id: schema.eventRegistrationFieldValues.field_id,
            value: schema.eventRegistrationFieldValues.value,
          })
          .from(schema.eventRegistrationFieldValues)
          .where(inArray(schema.eventRegistrationFieldValues.registration_id, registrationIds))
      : [];

  const valuesByRegistration = new Map<number, Array<{ field_id: number; value: string | null }>>();
  for (const fv of fieldValues) {
    const list = valuesByRegistration.get(fv.registration_id) ?? [];
    list.push({ field_id: fv.field_id, value: fv.value });
    valuesByRegistration.set(fv.registration_id, list);
  }

  const fourField = fields.find((f) => f.field_type === 'preset_team_four');
  const doublesField = fields.find((f) => f.field_type === 'preset_team_doubles');
  const preferredTeamField =
    format === 'doubles' ? (doublesField ?? fourField) : (fourField ?? doublesField);
  const teamFieldType = preferredTeamField?.field_type ?? null;
  const defs = defaultViceSkip(format);

  return registrations.map((reg, index) => {
    const regValues = valuesByRegistration.get(reg.id) ?? [];
    const teamFieldValue =
      preferredTeamField != null
        ? regValues.find((fv) => fv.field_id === preferredTeamField.id)?.value ?? ''
        : '';
    const players =
      teamFieldType != null ? parseTeamPlayers(teamFieldValue, teamFieldType) : null;
    const roster = buildRosterFromRegistration(format, teamFieldType, players);
    const teamName = resolveTeamName(regValues, fields, reg.contact_name);
    return {
      id: reg.id,
      eventId,
      sortOrder: index,
      teamName,
      homeClub: formatTeamHomeClubFromRoster(roster),
      viceSlotCode: defs.vice,
      skipSlotCode: defs.skip,
      roster,
    };
  });
}

export async function getTournamentTeamById(eventId: number, teamId: number): Promise<TournamentTeamRow | null> {
  const rows = await listTournamentTeamsForEvent(eventId);
  return rows.find((r) => r.id === teamId) ?? null;
}

/** Confirmed registration ids referenced by draw slots for an event. */
export async function listConfirmedRegistrationIdsForEvent(eventId: number): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.eventRegistrations.id })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'confirmed'),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
