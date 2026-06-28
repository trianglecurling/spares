import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { splitMemberDisplayName } from '../utils/memberName.js';
import {
  createTournamentTeam,
  defaultViceSkip,
  deleteTournamentTeam,
  normalizeTournamentFormat,
  rosterSlotsForFormat,
  updateTournamentTeam,
  type RosterSlotPayload,
  type TournamentFormat,
} from './eventTournamentTeamsService.js';

type TeamPlayerRow = { name: string; email: string; homeClub: string };

const FOURS_LINEUP_SLOTS = ['lead', 'second', 'third', 'fourth'] as const;
const DOUBLES_LINEUP_SLOTS = ['player1', 'player2'] as const;

function statusShouldHaveTournamentTeam(status: string): boolean {
  return status === 'confirmed';
}

function resolveFormat(
  eventFormat: string | null | undefined,
  teamFieldType: string | null,
): TournamentFormat {
  const fromEvent = normalizeTournamentFormat(eventFormat);
  if (fromEvent) return fromEvent;
  if (teamFieldType === 'preset_team_doubles') return 'doubles';
  return 'fours';
}

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

function buildRosterFromRegistration(
  format: TournamentFormat,
  teamFieldType: string | null,
  players: TeamPlayerRow[] | null,
): RosterSlotPayload[] {
  const lineupSlots =
    teamFieldType === 'preset_team_doubles'
      ? DOUBLES_LINEUP_SLOTS
      : teamFieldType === 'preset_team_four'
        ? FOURS_LINEUP_SLOTS
        : format === 'doubles'
          ? DOUBLES_LINEUP_SLOTS
          : FOURS_LINEUP_SLOTS;

  const roster: RosterSlotPayload[] = rosterSlotsForFormat(format).map((slotCode) => ({
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

function resolveTeamName(
  fieldValues: Array<{ field_id: number; value: string }>,
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

async function findRegistrationLinkedTeamId(registrationId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.eventTournamentTeams.id })
    .from(schema.eventTournamentTeams)
    .where(eq(schema.eventTournamentTeams.registration_id, registrationId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Keeps the event tournament roster in sync with a bonspiel registration.
 * Creates or updates a linked team for active registrations; removes it when cancelled or waitlisted.
 */
export async function syncTournamentTeamForRegistration(registrationId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();

  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);
  if (!reg) return;

  const [eventRow] = await db
    .select({
      id: schema.events.id,
      calendar_type_id: schema.events.calendar_type_id,
      tournament_format: schema.events.tournament_format,
    })
    .from(schema.events)
    .where(eq(schema.events.id, reg.event_id))
    .limit(1);

  if (!eventRow || (eventRow.calendar_type_id ?? 'other') !== 'bonspiel') return;

  const existingTeamId = await findRegistrationLinkedTeamId(registrationId);

  if (!statusShouldHaveTournamentTeam(reg.status)) {
    if (existingTeamId != null) {
      await deleteTournamentTeam(reg.event_id, existingTeamId);
    }
    return;
  }

  const fields = await db
    .select({
      id: schema.eventRegistrationFields.id,
      field_type: schema.eventRegistrationFields.field_type,
    })
    .from(schema.eventRegistrationFields)
    .where(eq(schema.eventRegistrationFields.event_id, reg.event_id));

  const fieldValues = await db
    .select({
      field_id: schema.eventRegistrationFieldValues.field_id,
      value: schema.eventRegistrationFieldValues.value,
    })
    .from(schema.eventRegistrationFieldValues)
    .where(eq(schema.eventRegistrationFieldValues.registration_id, registrationId));

  const fourField = fields.find((f) => f.field_type === 'preset_team_four');
  const doublesField = fields.find((f) => f.field_type === 'preset_team_doubles');
  const eventFormat = normalizeTournamentFormat(eventRow.tournament_format);
  const preferredTeamField =
    eventFormat === 'doubles' ? (doublesField ?? fourField) : (fourField ?? doublesField);

  const teamFieldType = preferredTeamField?.field_type ?? null;
  const teamFieldValue =
    preferredTeamField != null
      ? fieldValues.find((fv) => fv.field_id === preferredTeamField.id)?.value ?? ''
      : '';

  const format = resolveFormat(eventRow.tournament_format, teamFieldType);
  const players =
    teamFieldType != null ? parseTeamPlayers(teamFieldValue, teamFieldType) : null;
  const roster = buildRosterFromRegistration(format, teamFieldType, players);
  const teamName = resolveTeamName(fieldValues, fields, reg.contact_name);
  const defs = defaultViceSkip(format);

  if (existingTeamId != null) {
    await updateTournamentTeam(reg.event_id, existingTeamId, {
      teamName,
      roster,
      formatOverride: normalizeTournamentFormat(eventRow.tournament_format) ? undefined : format,
    });
    return;
  }

  await createTournamentTeam(reg.event_id, {
    teamName,
    roster,
    viceSlotCode: defs.vice,
    skipSlotCode: defs.skip,
    registrationId,
    formatOverride: normalizeTournamentFormat(eventRow.tournament_format) ? undefined : format,
  });
}

export async function syncTournamentTeamForRegistrationSafe(registrationId: number): Promise<void> {
  try {
    await syncTournamentTeamForRegistration(registrationId);
  } catch (err) {
    console.error('[Tournament registration sync] Failed for registration', registrationId, err);
  }
}
