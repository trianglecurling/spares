import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { EventServiceError } from './eventServiceError.js';
import {
  assertDrawStateLimits,
  tournamentDrawStateSchema,
  tournamentGameResultSchema,
  type TournamentDrawState,
} from './eventTournamentDrawSchema.js';
import type { z } from 'zod';
import type { TournamentGameStandingPayload } from './eventTournamentDrawSchema.js';
import { poolSettings } from '../utils/tournamentPoolStandings.js';

export type TournamentGameResultPayload = z.infer<typeof tournamentGameResultSchema>;

export function parseTournamentDrawJson(raw: string | null | undefined): TournamentDrawState | null {
  if (raw == null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EventServiceError('Stored tournament draw is not valid JSON', 500);
  }
  const result = tournamentDrawStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new EventServiceError('Stored tournament draw failed validation', 500);
  }
  assertDrawStateLimits(result.data);
  return result.data;
}

export async function getTournamentDrawJsonString(eventId: number): Promise<string | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ tournament_draw_json: schema.events.tournament_draw_json })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const raw = row?.tournament_draw_json;
  if (raw == null || raw === '') return null;
  return raw;
}

/**
 * Merge live club sheet stone colors onto draw.sheets (by clubSheetId).
 * Scorekeeper does this client-side from GET /sheets; public/admin draw GETs need it
 * server-side so rock-color swatches render when rockColor1Slot is set but colors were
 * never copied into stored draw JSON.
 */
export function mergeClubSheetStoneColorsOntoDraw(
  draw: TournamentDrawState,
  clubSheets: Array<{ id: number; stoneColor1: string; stoneColor2: string }>,
): TournamentDrawState {
  if (clubSheets.length === 0 || draw.sheets.length === 0) return draw;
  const byId = new Map(clubSheets.map((s) => [s.id, s]));
  let changed = false;
  const sheets = draw.sheets.map((sheet) => {
    if (sheet.clubSheetId <= 0) return sheet;
    const club = byId.get(sheet.clubSheetId);
    if (!club) return sheet;
    const stoneColor1 = club.stoneColor1 || sheet.stoneColor1;
    const stoneColor2 = club.stoneColor2 || sheet.stoneColor2;
    if (stoneColor1 === sheet.stoneColor1 && stoneColor2 === sheet.stoneColor2) {
      return sheet;
    }
    changed = true;
    return {
      ...sheet,
      ...(stoneColor1 ? { stoneColor1 } : {}),
      ...(stoneColor2 ? { stoneColor2 } : {}),
    };
  });
  return changed ? { ...draw, sheets } : draw;
}

async function loadClubSheetStoneColors(
  queryDb: Pick<ReturnType<typeof getDrizzleDb>['db'], 'select'> = getDrizzleDb().db,
): Promise<Array<{ id: number; stoneColor1: string; stoneColor2: string }>> {
  const { schema } = getDrizzleDb();
  const rows = await queryDb
    .select({
      id: schema.sheets.id,
      stoneColor1: schema.sheets.stone_color_1,
      stoneColor2: schema.sheets.stone_color_2,
    })
    .from(schema.sheets);
  return rows.map((r) => ({
    id: r.id,
    stoneColor1: r.stoneColor1 ?? 'red',
    stoneColor2: r.stoneColor2 ?? 'yellow',
  }));
}

export async function getTournamentDrawForEvent(eventId: number): Promise<TournamentDrawState | null> {
  const raw = await getTournamentDrawJsonString(eventId);
  if (raw == null) return null;
  const draw = parseTournamentDrawJson(raw);
  if (!draw) return null;
  const clubSheets = await loadClubSheetStoneColors();
  return mergeClubSheetStoneColorsOntoDraw(draw, clubSheets);
}

/**
 * Each incoming feeder edge into a game needs a competitor slot. Pad with TBD slots when
 * connections would otherwise exceed `games[toId].slots.length` (kept in sync with frontend
 * `ensureIncomingTargetsHaveEnoughSlots`).
 */
export function coerceTournamentDrawIncomingSlots(draw: TournamentDrawState): TournamentDrawState {
  const feedsIntoCount = new Map<string, number>();
  for (const c of draw.connections) {
    if (c.terminalType === 'game' && c.toGameId) {
      feedsIntoCount.set(c.toGameId, (feedsIntoCount.get(c.toGameId) ?? 0) + 1);
    }
  }
  if (feedsIntoCount.size === 0) return draw;

  let games = { ...draw.games };
  let changed = false;
  for (const [toId, n] of feedsIntoCount) {
    const g = games[toId];
    if (!g) continue;
    const need = Math.max(2, n);
    if (g.slots.length >= need) continue;
    const padCount = need - g.slots.length;
    games[toId] = {
      ...g,
      slots: [...g.slots, ...Array.from({ length: padCount }, () => ({ sourceType: 'tbd' as const }))],
    };
    changed = true;
  }
  return changed ? { ...draw, games } : draw;
}

/** Semantic checks after Zod parse (call from route after safeParse). */
export function validateTournamentDrawSemantics(
  draw: TournamentDrawState,
  options?: { confirmedRegistrationIds?: Set<number> },
): void {
  assertDrawStateLimits(draw);
  const gameIds = new Set(Object.keys(draw.games));
  const confirmedIds = options?.confirmedRegistrationIds;

  const poolPhaseIds = new Set(draw.phases.filter((p) => p.kind === 'pool').map((p) => p.id));
  for (const g of Object.values(draw.games)) {
    const inPoolPhase = poolPhaseIds.has(g.phaseId);
    if (inPoolPhase ? g.eventId !== g.phaseId : !draw.setup.events.some((e) => e.id === g.eventId)) {
      throw new EventServiceError(`Game ${g.label} references unknown event`, 400);
    }
    const k = g.slots.length;
    if (k < 2) {
      throw new EventServiceError(`Game ${g.label} must have at least two competitor slots`, 400);
    }
    for (const slot of g.slots) {
      if (slot.sourceType === 'game_place') {
        if (!slot.gameId) {
          throw new EventServiceError(`Game ${g.label} has a feeder slot without gameId`, 400);
        }
        if (!gameIds.has(slot.gameId)) {
          throw new EventServiceError(`Game ${g.label} references unknown feeder game`, 400);
        }
        const feeder = draw.games[slot.gameId];
        if (!feeder || slot.place < 1 || slot.place > feeder.slots.length) {
          throw new EventServiceError(`Game ${g.label} references an invalid place from a feeder game`, 400);
        }
      }
      if (slot.sourceType === 'registration' && slot.registrationId != null && confirmedIds) {
        if (!confirmedIds.has(slot.registrationId)) {
          throw new EventServiceError(
            `Game ${g.label} references registration ${slot.registrationId} which is not a confirmed team for this event`,
            400,
          );
        }
      }
    }

    const res = g.result;
    if (res) {
      if (k > 2) {
        if (res.entryKind !== 'multi_score') {
          throw new EventServiceError(
            `Game ${g.label}: games with three or more competitors must use per-competitor scores (multi_score)`,
            400,
          );
        }
        if (res.scores.length !== k) {
          throw new EventServiceError(
            `Game ${g.label}: expected ${k} scores (one per competitor), got ${res.scores.length}`,
            400,
          );
        }
      } else if (res.entryKind === 'multi_score') {
        throw new EventServiceError(`Game ${g.label}: multi_score is only for games with three or more competitors`, 400);
      }
    }
  }

  const outgoingKeys = new Set<string>();
  for (const c of draw.connections) {
    if (!gameIds.has(c.fromGameId)) {
      throw new EventServiceError(`Connection references unknown game ${c.fromGameId}`, 400);
    }
    const src = draw.games[c.fromGameId];
    if (!src) continue;
    if (c.place < 1 || c.place > src.slots.length) {
      throw new EventServiceError(
        `Connection place ${c.place} is out of range for game ${src.label}`,
        400,
      );
    }
    const ok = `${c.fromGameId}:${c.place}`;
    if (outgoingKeys.has(ok)) {
      throw new EventServiceError(`Duplicate routing from ${src.label} for place ${c.place}`, 400);
    }
    outgoingKeys.add(ok);

    if (c.terminalType === 'game') {
      if (!c.toGameId) {
        throw new EventServiceError('Connection to game requires toGameId', 400);
      }
      if (!gameIds.has(c.toGameId)) {
        throw new EventServiceError(`Connection references unknown target game ${c.toGameId}`, 400);
      }
    } else if (c.toGameId != null || c.toSlotPosition != null) {
      throw new EventServiceError('Connection with terminal out/tbd must not set a target game', 400);
    }
  }

  const feedsIntoCount = new Map<string, number>();
  for (const c of draw.connections) {
    if (c.terminalType === 'game' && c.toGameId) {
      feedsIntoCount.set(c.toGameId, (feedsIntoCount.get(c.toGameId) ?? 0) + 1);
    }
  }
  for (const [toId, n] of feedsIntoCount) {
    const cap = draw.games[toId]?.slots.length ?? 0;
    if (n > cap) {
      throw new EventServiceError(
        `At most ${cap} feeder routes may enter a game (target ${draw.games[toId]?.label ?? toId})`,
        400,
      );
    }
  }

  const blockIds = new Set(draw.drawBlocks.map((b) => b.id));
  const allowedSheetIds = new Set(draw.sheets.map((s) => s.clubSheetId));
  for (const g of Object.values(draw.games)) {
    const sch = g.schedule;
    if (!sch) continue;
    if (
      sch.drawBlockId != null &&
      sch.drawBlockId !== '' &&
      !blockIds.has(sch.drawBlockId)
    ) {
      throw new EventServiceError(
        `Game ${g.label} schedule references an unknown draw time block`,
        400,
      );
    }
    if (sch.sheetId != null && !allowedSheetIds.has(sch.sheetId)) {
      throw new EventServiceError(
        `Game ${g.label} schedule sheet is not in this tournament’s sheet list`,
        400,
      );
    }
  }

  const textIds = new Set<string>();
  for (const tn of draw.textNodes) {
    if (textIds.has(tn.id)) {
      throw new EventServiceError(`Duplicate text node id ${tn.id}`, 400);
    }
    textIds.add(tn.id);
  }

  validateTournamentPhases(draw, confirmedIds);
}

type SlotSource = TournamentDrawState['games'][string]['slots'][number];

/** Phase, pool, and pool-play source checks (part of `validateTournamentDrawSemantics`). */
function validateTournamentPhases(draw: TournamentDrawState, confirmedIds?: Set<number>): void {
  const phaseById = new Map<string, TournamentDrawState['phases'][number]>();
  for (const p of draw.phases) {
    if (phaseById.has(p.id)) throw new EventServiceError(`Duplicate phase id ${p.id}`, 400);
    phaseById.set(p.id, p);
  }
  const phaseOrder = (id: string) => phaseById.get(id)?.order ?? Number.POSITIVE_INFINITY;

  for (const ev of draw.setup.events) {
    if (phaseById.get(ev.phaseId)?.kind !== 'bracket') {
      throw new EventServiceError(`Bracket event ${ev.name} must belong to a bracket phase`, 400);
    }
  }

  const poolById = new Map<string, TournamentDrawState['pools'][number]>();
  const entryPhase = new Map<string, string>();
  for (const pool of draw.pools) {
    if (poolById.has(pool.id)) throw new EventServiceError(`Duplicate pool id ${pool.id}`, 400);
    poolById.set(pool.id, pool);
    if (phaseById.get(pool.phaseId)?.kind !== 'pool') {
      throw new EventServiceError(`${pool.name} must belong to a pool play phase`, 400);
    }
    for (const entry of pool.entries) {
      if (entryPhase.has(entry.id)) throw new EventServiceError(`Duplicate pool entry id ${entry.id}`, 400);
      entryPhase.set(entry.id, pool.phaseId);
    }
  }

  const poolCodes = new Set<string>();
  const teamPhase = new Set<string>();
  for (const pool of draw.pools) {
    const codeKey = `${pool.phaseId}:${pool.code.toUpperCase()}`;
    if (poolCodes.has(codeKey)) throw new EventServiceError(`Pool code ${pool.code} is used twice in one phase`, 400);
    poolCodes.add(codeKey);
    for (const entry of pool.entries) {
      const s = entry.source;
      const where = `${pool.name} entry`;
      if (s.sourceType === 'pool_entry') {
        throw new EventServiceError(`${where} cannot reference another pool entry`, 400);
      }
      if (s.sourceType === 'registration' && s.registrationId != null) {
        const key = `${pool.phaseId}:${s.registrationId}`;
        if (teamPhase.has(key)) {
          throw new EventServiceError(`A team is placed in more than one pool in the same phase`, 400);
        }
        teamPhase.add(key);
      }
      validatePhaseSource(s, pool.phaseId, where, { allowSamePhaseStanding: false });
    }
  }

  for (const phase of draw.phases) {
    for (const step of phase.advancing ?? []) {
      if (step.kind === 'pool_place' && poolById.get(step.poolId)?.phaseId !== phase.id) {
        throw new EventServiceError(`${phase.name}: advancing step references a pool outside this phase`, 400);
      }
    }
  }

  for (const g of Object.values(draw.games)) {
    const phase = phaseById.get(g.phaseId);
    if (!phase) throw new EventServiceError(`Game ${g.label} references unknown phase`, 400);
    if (phase.kind === 'bracket') {
      const ev = draw.setup.events.find((e) => e.id === g.eventId);
      if (ev && ev.phaseId !== g.phaseId) {
        throw new EventServiceError(`Game ${g.label} is in a different phase than its bracket event`, 400);
      }
      if (g.standing) throw new EventServiceError(`Game ${g.label}: standings points are only for pool games`, 400);
    } else {
      if (g.slots.length !== 2) throw new EventServiceError(`Pool game ${g.label} must have two teams`, 400);
      if (g.poolId != null && poolById.get(g.poolId)?.phaseId !== g.phaseId) {
        throw new EventServiceError(`Pool game ${g.label} references a pool outside its phase`, 400);
      }
      const max = poolSettings(phase).pointsPossiblePerGame;
      for (const p of g.standing?.points ?? []) {
        if (p != null && (p < 0 || p > max)) {
          throw new EventServiceError(`Game ${g.label}: points must be between 0 and ${max}`, 400);
        }
      }
    }
    for (const slot of g.slots) {
      if (slot.sourceType === 'pool_entry') {
        if (phase.kind !== 'pool' || !slot.entryId || entryPhase.get(slot.entryId) !== g.phaseId) {
          throw new EventServiceError(`Game ${g.label} references a pool entry outside its phase`, 400);
        }
      }
      if (slot.sourceType === 'game_place' && slot.gameId) {
        const feeder = draw.games[slot.gameId];
        if (feeder && phaseOrder(feeder.phaseId) > phase.order) {
          throw new EventServiceError(`Game ${g.label} references a game in a later phase`, 400);
        }
      }
      validatePhaseSource(slot, g.phaseId, `Game ${g.label}`, { allowSamePhaseStanding: phase.kind === 'pool' });
    }
  }

  for (const c of draw.connections) {
    if (c.terminalType !== 'game') continue;
    const from = draw.games[c.fromGameId];
    const to = c.toGameId ? draw.games[c.toGameId] : undefined;
    if (phaseById.get(from?.phaseId ?? '')?.kind === 'pool' || phaseById.get(to?.phaseId ?? '')?.kind === 'pool') {
      throw new EventServiceError('Pool games cannot be connected with bracket routes', 400);
    }
  }

  function validatePhaseSource(
    s: SlotSource,
    contextPhaseId: string,
    where: string,
    opts: { allowSamePhaseStanding: boolean },
  ): void {
    if (s.sourceType === 'registration' && s.registrationId != null && confirmedIds && !confirmedIds.has(s.registrationId)) {
      throw new EventServiceError(`${where} references a team that is not confirmed for this event`, 400);
    }
    if (s.sourceType !== 'standing' && s.sourceType !== 'qualifier') return;
    const source = phaseById.get(s.phaseId);
    if (!source || source.kind !== 'pool') {
      throw new EventServiceError(`${where} references standings from a phase that is not pool play`, 400);
    }
    const contextOrder = phaseOrder(contextPhaseId);
    const samePhase = s.phaseId === contextPhaseId;
    if (source.order > contextOrder) {
      throw new EventServiceError(`${where} references a later phase`, 400);
    }
    if (samePhase) {
      if (s.sourceType === 'qualifier' || !opts.allowSamePhaseStanding || !s.afterDrawBlockId) {
        throw new EventServiceError(`${where} can only use its own phase's standings after a specific draw`, 400);
      }
    }
    if (s.sourceType === 'standing') {
      if (s.poolId != null && poolById.get(s.poolId)?.phaseId !== s.phaseId) {
        throw new EventServiceError(`${where} references a pool outside the standings phase`, 400);
      }
      if (s.afterDrawBlockId && !draw.drawBlocks.some((b) => b.id === s.afterDrawBlockId)) {
        throw new EventServiceError(`${where} references an unknown draw`, 400);
      }
    }
  }
}

export async function saveTournamentDrawForEvent(eventId: number, draw: TournamentDrawState): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const json = JSON.stringify(draw);
  await db
    .update(schema.events)
    .set({
      tournament_draw_json: json,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as Record<string, unknown>)
    .where(eq(schema.events.id, eventId));
}

/**
 * Update a single game's `result` and/or `rockColor1Slot` in stored draw JSON.
 * Runs in a transaction so concurrent patches serialize and do not drop each other's updates.
 */
export async function patchTournamentDrawGameResult(
  eventId: number,
  gameId: string,
  patch: {
    result?: TournamentGameResultPayload | null;
    rockColor1Slot?: 0 | 1 | null;
    standing?: TournamentGameStandingPayload | null;
  },
): Promise<TournamentDrawState> {
  const { db, schema } = getDrizzleDb();

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ tournament_draw_json: schema.events.tournament_draw_json })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!row) {
      throw new EventServiceError('Event not found', 404);
    }

    const raw = row.tournament_draw_json;
    if (raw == null || raw === '') {
      throw new EventServiceError('No tournament draw for this event', 404);
    }

    const draw = parseTournamentDrawJson(raw);
    if (!draw) {
      throw new EventServiceError('No tournament draw for this event', 404);
    }

    const g = draw.games[gameId];
    if (!g) {
      throw new EventServiceError('Game not found in this draw', 404);
    }

    let nextGame = { ...g };

    if (patch.result !== undefined) {
      if (patch.result == null) {
        const { result: _drop, ...rest } = nextGame;
        void _drop;
        nextGame = rest;
      } else {
        nextGame = { ...nextGame, result: patch.result };
      }
    }

    if (patch.rockColor1Slot !== undefined) {
      if (patch.rockColor1Slot == null) {
        const { rockColor1Slot: _drop, ...rest } = nextGame;
        void _drop;
        nextGame = rest;
      } else {
        nextGame = { ...nextGame, rockColor1Slot: patch.rockColor1Slot };
      }
    }

    if (patch.standing !== undefined) {
      if (patch.standing == null) {
        const { standing: _drop, ...rest } = nextGame;
        void _drop;
        nextGame = rest;
      } else {
        nextGame = { ...nextGame, standing: patch.standing };
      }
    }

    let nextDraw: TournamentDrawState = {
      ...draw,
      games: { ...draw.games, [gameId]: nextGame },
    };

    // Keep sheet stone colors on the stored draw so public/bracket clients can render
    // swatches without a separate sheets fetch (same merge as GET).
    if (patch.rockColor1Slot !== undefined && patch.rockColor1Slot != null) {
      const clubSheets = await loadClubSheetStoneColors(tx);
      nextDraw = mergeClubSheetStoneColorsOntoDraw(nextDraw, clubSheets);
    }

    const coerced = coerceTournamentDrawIncomingSlots(nextDraw);
    validateTournamentDrawSemantics(coerced);
    const json = JSON.stringify(coerced);

    await tx
      .update(schema.events)
      .set({
        tournament_draw_json: json,
        updated_at: sql`CURRENT_TIMESTAMP`,
      } as Record<string, unknown>)
      .where(eq(schema.events.id, eventId));

    return coerced;
  });
}

/** Strip runtime tournament data when duplicating an event (keep bracket structure). */
export function sanitizeTournamentDrawForDuplicate(draw: TournamentDrawState): TournamentDrawState {
  const games: TournamentDrawState['games'] = {};
  for (const [key, game] of Object.entries(draw.games)) {
    const { result: _result, rockColor1Slot: _rock, standing: _standing, schedule, slots, ...rest } = game;
    void _result;
    void _rock;
    void _standing;
    const nextSlots = slots.map((slot) =>
      slot.sourceType === 'registration' ? { sourceType: 'tbd' as const } : slot,
    );
    const nextSchedule =
      schedule == null
        ? undefined
        : {
            ...schedule,
            startTime: null,
          };
    games[key] = {
      ...rest,
      slots: nextSlots,
      ...(nextSchedule !== undefined ? { schedule: nextSchedule } : {}),
    };
  }

  return {
    ...draw,
    games,
    pools: draw.pools.map((pool) => ({
      ...pool,
      entries: pool.entries.map((entry) =>
        entry.source.sourceType === 'registration' ? { ...entry, source: { sourceType: 'tbd' as const } } : entry,
      ),
    })),
    drawBlocks: draw.drawBlocks.map((block) => ({
      ...block,
      startTime: null,
    })),
  };
}

export function sanitizeTournamentDrawJsonForDuplicate(raw: string): string {
  const draw = parseTournamentDrawJson(raw);
  if (draw == null) {
    throw new EventServiceError('Stored tournament draw is empty', 500);
  }
  return JSON.stringify(sanitizeTournamentDrawForDuplicate(draw));
}
