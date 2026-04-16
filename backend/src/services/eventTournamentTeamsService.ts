import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { EventServiceError } from './eventServiceError.js';

export type TournamentFormat = 'fours' | 'doubles';

export const FOURS_SLOTS = ['lead', 'second', 'third', 'fourth', 'alternate'] as const;
export const DOUBLES_SLOTS = ['player1', 'player2'] as const;

const EMAIL_MAX = 320;
const TEXT_MAX = 200;
const NOTES_MAX = 2000;

type EventTournamentContext = {
  id: number;
  calendar_type_id: string | null;
  tournament_format: string | null;
};

async function getEventTournamentContext(eventId: number): Promise<EventTournamentContext | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.events.id,
      calendar_type_id: schema.events.calendar_type_id,
      tournament_format: schema.events.tournament_format,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

function assertBonspiel(event: { calendar_type_id: string | null }): void {
  const t = event.calendar_type_id ?? 'other';
  if (t !== 'bonspiel') {
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

export function normalizeTournamentFormat(raw: string | null | undefined): TournamentFormat | null {
  if (raw === 'fours' || raw === 'doubles') return raw;
  return null;
}

function validateViceSkip(format: TournamentFormat, vice: string, skip: string): void {
  const slots = rosterSlotsForFormat(format) as readonly string[];
  const nonAlt = format === 'fours' ? slots.filter((s) => s !== 'alternate') : [...slots];
  if (vice === skip) {
    throw new EventServiceError('Vice and skip must be different players', 400);
  }
  if (!nonAlt.includes(vice)) {
    throw new EventServiceError('Vice must be a non-alternate lineup position for this format', 400);
  }
  if (!nonAlt.includes(skip)) {
    throw new EventServiceError('Skip must be a non-alternate lineup position for this format', 400);
  }
}

function validateOptionalEmail(email: string | null | undefined): void {
  if (email == null || email === '') return;
  if (email.length > EMAIL_MAX) {
    throw new EventServiceError(`Email must be at most ${EMAIL_MAX} characters`, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EventServiceError('Invalid email address', 400);
  }
}

export async function countTournamentTeams(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.eventTournamentTeams.id })
    .from(schema.eventTournamentTeams)
    .where(eq(schema.eventTournamentTeams.event_id, eventId));
  return rows.length;
}

export type RosterSlotPayload = {
  slotCode: string;
  playerName?: string | null;
  email?: string | null;
  notes?: string | null;
};

export type TournamentTeamRow = {
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
  }>;
};

function mapTeamRow(team: Record<string, unknown>, roster: TournamentTeamRow['roster']): TournamentTeamRow {
  return {
    id: team.id as number,
    eventId: team.event_id as number,
    sortOrder: team.sort_order as number,
    teamName: (team.team_name as string | null) ?? null,
    homeClub: (team.home_club as string | null) ?? null,
    viceSlotCode: team.vice_slot_code as string,
    skipSlotCode: team.skip_slot_code as string,
    roster,
  };
}

export async function listTournamentTeamsForEvent(eventId: number): Promise<TournamentTeamRow[]> {
  const { db, schema } = getDrizzleDb();
  const event = await getEventTournamentContext(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  assertBonspiel(event);

  const teams = await db
    .select()
    .from(schema.eventTournamentTeams)
    .where(eq(schema.eventTournamentTeams.event_id, eventId))
    .orderBy(asc(schema.eventTournamentTeams.sort_order), asc(schema.eventTournamentTeams.id));

  if (teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id);
  const slots =
    teamIds.length > 0
      ? await db
          .select()
          .from(schema.eventTournamentRosterSlots)
          .where(inArray(schema.eventTournamentRosterSlots.team_id, teamIds))
      : [];

  const byTeam = new Map<number, TournamentTeamRow['roster']>();
  for (const tid of teamIds) {
    byTeam.set(tid, []);
  }
  for (const s of slots) {
    const list = byTeam.get(s.team_id);
    if (list) {
      list.push({
        slotCode: s.slot_code,
        playerName: s.player_name ?? null,
        email: s.email ?? null,
        notes: s.notes ?? null,
      });
    }
  }

  const format = normalizeTournamentFormat(event.tournament_format);
  const slotOrder = format ? [...rosterSlotsForFormat(format)] : [];
  const orderIdx = (code: string) => {
    const i = slotOrder.indexOf(code);
    return i === -1 ? 999 : i;
  };

  return teams.map((t) => {
    const roster = byTeam.get(t.id) ?? [];
    roster.sort((a, b) => orderIdx(a.slotCode) - orderIdx(b.slotCode));
    return mapTeamRow(t as unknown as Record<string, unknown>, roster);
  });
}

export async function getTournamentTeamById(eventId: number, teamId: number): Promise<TournamentTeamRow | null> {
  const rows = await listTournamentTeamsForEvent(eventId);
  return rows.find((r) => r.id === teamId) ?? null;
}

function normalizeRosterPayload(
  format: TournamentFormat,
  roster: RosterSlotPayload[] | undefined,
  defaultsForSlots: readonly string[],
): Map<string, { playerName: string | null; email: string | null; notes: string | null }> {
  const map = new Map<string, { playerName: string | null; email: string | null; notes: string | null }>();
  for (const code of defaultsForSlots) {
    map.set(code, { playerName: null, email: null, notes: null });
  }
  if (roster) {
    for (const row of roster) {
      if (!defaultsForSlots.includes(row.slotCode)) {
        throw new EventServiceError(`Invalid roster slot: ${row.slotCode}`, 400);
      }
      const name = row.playerName?.trim() || null;
      const emailRaw = row.email?.trim() || null;
      const notes = row.notes?.trim() || null;
      if (name != null && name.length > TEXT_MAX) {
        throw new EventServiceError(`Player name must be at most ${TEXT_MAX} characters`, 400);
      }
      if (notes != null && notes.length > NOTES_MAX) {
        throw new EventServiceError(`Notes must be at most ${NOTES_MAX} characters`, 400);
      }
      validateOptionalEmail(emailRaw);
      map.set(row.slotCode, { playerName: name, email: emailRaw, notes });
    }
  }
  return map;
}

export type CreateTournamentTeamInput = {
  teamName?: string | null;
  homeClub?: string | null;
  viceSlotCode?: string;
  skipSlotCode?: string;
  roster?: RosterSlotPayload[];
};

export async function createTournamentTeam(eventId: number, input: CreateTournamentTeamInput): Promise<TournamentTeamRow> {
  const { db, schema } = getDrizzleDb();
  const event = await getEventTournamentContext(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  assertBonspiel(event);

   const format = normalizeTournamentFormat(event.tournament_format);
  if (!format) {
    throw new EventServiceError('Choose fours or doubles for this tournament before adding teams', 400);
  }

  const defs = defaultViceSkip(format);
  const vice = input.viceSlotCode ?? defs.vice;
  const skip = input.skipSlotCode ?? defs.skip;
  validateViceSkip(format, vice, skip);

  const slotCodes = rosterSlotsForFormat(format);
  const rosterMap = normalizeRosterPayload(format, input.roster, slotCodes);

  const teamName = input.teamName?.trim() || null;
  const homeClub = input.homeClub?.trim() || null;
  if (teamName != null && teamName.length > TEXT_MAX) {
    throw new EventServiceError(`Team name must be at most ${TEXT_MAX} characters`, 400);
  }
  if (homeClub != null && homeClub.length > TEXT_MAX) {
    throw new EventServiceError(`Home club must be at most ${TEXT_MAX} characters`, 400);
  }

  const existingOrders = await db
    .select({ sort_order: schema.eventTournamentTeams.sort_order })
    .from(schema.eventTournamentTeams)
    .where(eq(schema.eventTournamentTeams.event_id, eventId));
  const nextOrder =
    existingOrders.length === 0 ? 0 : Math.max(...existingOrders.map((r) => r.sort_order ?? 0)) + 1;

  const [team] = await db
    .insert(schema.eventTournamentTeams)
    .values({
      event_id: eventId,
      sort_order: nextOrder,
      team_name: teamName,
      home_club: homeClub,
      vice_slot_code: vice,
      skip_slot_code: skip,
    } as any)
    .returning();

  if (!team) throw new EventServiceError('Failed to create team', 500);

  const rosterInsert = slotCodes.map((code) => {
    const r = rosterMap.get(code)!;
    return {
      team_id: team.id,
      slot_code: code,
      player_name: r.playerName,
      email: r.email,
      notes: r.notes,
    };
  });

  await db.insert(schema.eventTournamentRosterSlots).values(rosterInsert as any);

  const full = await getTournamentTeamById(eventId, team.id);
  if (!full) throw new EventServiceError('Failed to load new team', 500);
  return full;
}

export type UpdateTournamentTeamInput = {
  teamName?: string | null;
  homeClub?: string | null;
  viceSlotCode?: string;
  skipSlotCode?: string;
  roster?: RosterSlotPayload[];
};

export async function updateTournamentTeam(
  eventId: number,
  teamId: number,
  input: UpdateTournamentTeamInput,
): Promise<TournamentTeamRow> {
  const { db, schema } = getDrizzleDb();
  const event = await getEventTournamentContext(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  assertBonspiel(event);

  const format = normalizeTournamentFormat(event.tournament_format);
  if (!format) {
    throw new EventServiceError('Choose fours or doubles for this tournament before editing teams', 400);
  }

  const [existing] = await db
    .select()
    .from(schema.eventTournamentTeams)
    .where(and(eq(schema.eventTournamentTeams.id, teamId), eq(schema.eventTournamentTeams.event_id, eventId)))
    .limit(1);

  if (!existing) throw new EventServiceError('Team not found', 404);

  const vice = input.viceSlotCode ?? existing.vice_slot_code;
  const skip = input.skipSlotCode ?? existing.skip_slot_code;
  validateViceSkip(format, vice, skip);

  const slotCodes = rosterSlotsForFormat(format);

  const teamName =
    input.teamName !== undefined ? (input.teamName?.trim() || null) : existing.team_name;
  const homeClub =
    input.homeClub !== undefined ? (input.homeClub?.trim() || null) : existing.home_club;

  if (teamName != null && teamName.length > TEXT_MAX) {
    throw new EventServiceError(`Team name must be at most ${TEXT_MAX} characters`, 400);
  }
  if (homeClub != null && homeClub.length > TEXT_MAX) {
    throw new EventServiceError(`Home club must be at most ${TEXT_MAX} characters`, 400);
  }

  await db
    .update(schema.eventTournamentTeams)
    .set({
      team_name: teamName,
      home_club: homeClub,
      vice_slot_code: vice,
      skip_slot_code: skip,
    } as any)
    .where(eq(schema.eventTournamentTeams.id, teamId));

  if (input.roster !== undefined) {
    const rosterMap = normalizeRosterPayload(format, input.roster, slotCodes);
    await db.delete(schema.eventTournamentRosterSlots).where(eq(schema.eventTournamentRosterSlots.team_id, teamId));
    const rosterInsert = slotCodes.map((code) => {
      const r = rosterMap.get(code)!;
      return {
        team_id: teamId,
        slot_code: code,
        player_name: r.playerName,
        email: r.email,
        notes: r.notes,
      };
    });
    await db.insert(schema.eventTournamentRosterSlots).values(rosterInsert as any);
  }

  const full = await getTournamentTeamById(eventId, teamId);
  if (!full) throw new EventServiceError('Failed to load team', 500);
  return full;
}

export async function deleteTournamentTeam(eventId: number, teamId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const event = await getEventTournamentContext(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  assertBonspiel(event);

  const existing = await getTournamentTeamById(eventId, teamId);
  if (!existing) throw new EventServiceError('Team not found', 404);

  await db
    .delete(schema.eventTournamentTeams)
    .where(and(eq(schema.eventTournamentTeams.id, teamId), eq(schema.eventTournamentTeams.event_id, eventId)));
}

/** Copy tournament teams from one event to another (same format / roster). Used when duplicating an event. */
export async function copyTournamentTeamsBetweenEvents(sourceEventId: number, targetEventId: number): Promise<void> {
  const teams = await listTournamentTeamsForEvent(sourceEventId);
  for (const t of teams) {
    await createTournamentTeam(targetEventId, {
      teamName: t.teamName,
      homeClub: t.homeClub,
      viceSlotCode: t.viceSlotCode,
      skipSlotCode: t.skipSlotCode,
      roster: t.roster.map((r) => ({
        slotCode: r.slotCode,
        playerName: r.playerName,
        email: r.email,
        notes: r.notes,
      })),
    });
  }
}
