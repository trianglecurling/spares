import type {
  TournamentConnectionEdge,
  TournamentDrawState,
  TournamentGameNode,
  TournamentSlotSource,
} from './tournamentDrawModel';
import { ordinalPlaceLabel } from './tournamentDrawModel';
import { multiScoreRanking, outcomeFromResult } from './tournamentDrawResult';
import { formatTeamDisplayName } from './tournamentDisplay';
import { ensureUniqueBracketEventIds } from './tournamentDrawBuilders';
import { migrateTournamentDrawJson } from './tournamentDrawMigration';
import { migrateSheetsArray } from './tournamentDrawSchedule';

type TeamRow = { teamName: string | null; sortOrder: number };

/** Keys `fromGameId:place` for connections that feed into `toGameId`. */
export function incomingFeederKeys(draw: TournamentDrawState, toGameId: string): Set<string> {
  const keys = new Set<string>();
  for (const c of draw.connections) {
    if (c.terminalType === 'game' && c.toGameId === toGameId) {
      keys.add(`${c.fromGameId}:${c.place}`);
    }
  }
  return keys;
}

/** Unique feeder games whose **1st-place** finish is routed into `toGameId` (bracket layout). */
export function incomingWinnerFeederIdsSorted(draw: TournamentDrawState, toGameId: string): string[] {
  const ids = [
    ...new Set(
      draw.connections
        .filter(
          (c) =>
            c.place === 1 && c.terminalType === 'game' && c.toGameId === toGameId,
        )
        .map((c) => c.fromGameId),
    ),
  ];
  ids.sort((a, b) =>
    (draw.games[a]?.label ?? a).localeCompare(draw.games[b]?.label ?? b, undefined, {
      numeric: true,
    }),
  );
  return ids;
}

function slotRedundantWithIncoming(
  slot: TournamentSlotSource,
  incomingKeys: Set<string>,
): boolean {
  return (
    slot.sourceType === 'game_place' &&
    slot.gameId != null &&
    incomingKeys.has(`${slot.gameId}:${slot.place}`)
  );
}

/** Clear slot picks that duplicate an incoming feeder edge. */
export function normalizeIncomingWinnerSlots(draw: TournamentDrawState): TournamentDrawState {
  const games = { ...draw.games };
  for (const [id, g] of Object.entries(games)) {
    const inc = incomingFeederKeys(draw, id);
    const clear = (s: TournamentSlotSource): TournamentSlotSource => {
      if (slotRedundantWithIncoming(s, inc)) {
        return { sourceType: 'tbd' };
      }
      return s;
    };
    games[id] = { ...g, slots: g.slots.map(clear) };
  }
  return { ...draw, games };
}

/** Drop legacy target-slot field; routing no longer distinguishes top/bottom on the target game. */
export function stripLegacyToSlotPosition(draw: TournamentDrawState): TournamentDrawState {
  return {
    ...draw,
    connections: draw.connections.map((c) => {
      const { toSlotPosition: _t, ...rest } = c;
      void _t;
      return rest;
    }),
  };
}

/**
 * Each incoming feeder edge into a game needs a competitor slot. Expand `slots` with TBD entries
 * when routing would otherwise exceed `slots.length` (matches backend `validateTournamentDrawSemantics`).
 */
function ensureIncomingTargetsHaveEnoughSlots(draw: TournamentDrawState): TournamentDrawState {
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

/** Ensure each game has exactly one connection row per finish place (1..slots.length). */
function ensureConnectionsForSlots(draw: TournamentDrawState): TournamentDrawState {
  const connections = [...draw.connections];
  for (const g of Object.values(draw.games)) {
    const k = g.slots.length;
    for (let p = 1; p <= k; p++) {
      if (!connections.some((c) => c.fromGameId === g.id && c.place === p)) {
        connections.push({
          id: crypto.randomUUID(),
          fromGameId: g.id,
          place: p,
          terminalType: 'tbd',
        });
      }
    }
  }
  return { ...draw, connections };
}

export function normalizeDrawState(draw: TournamentDrawState): TournamentDrawState {
  const migrated = migrateTournamentDrawJson(draw) as TournamentDrawState;
  const withSheets: TournamentDrawState = {
    ...migrated,
    sheets: migrateSheetsArray(migrated.sheets as unknown),
  };
  return stripLegacyToSlotPosition(
    normalizeIncomingWinnerSlots(
      ensureConnectionsForSlots(ensureIncomingTargetsHaveEnoughSlots(ensureUniqueBracketEventIds(withSheets))),
    ),
  );
}

/** Label for a feeder’s finish (e.g. W-A1, L-B2, 3rd C1) — matches game cards. */
export function formatFeederPipeLabel(from: TournamentGameNode, place: number): string {
  const k = from.slots.length;
  if (k <= 2) {
    if (place === 1) return `W-${from.label}`;
    if (place === 2) return `L-${from.label}`;
  }
  return `${ordinalPlaceLabel(place)} ${from.label}`;
}

/** Stable ordering for edges into the same game (label → source game → place → id). */
function compareIncomingConnections(
  draw: TournamentDrawState,
  a: TournamentConnectionEdge,
  b: TournamentConnectionEdge,
): number {
  const la = draw.games[a.fromGameId]?.label ?? a.fromGameId;
  const lb = draw.games[b.fromGameId]?.label ?? b.fromGameId;
  const byLabel = la.localeCompare(lb, undefined, { numeric: true });
  if (byLabel !== 0) return byLabel;
  if (a.fromGameId !== b.fromGameId) return a.fromGameId.localeCompare(b.fromGameId);
  if (a.place !== b.place) return a.place - b.place;
  return a.id.localeCompare(b.id);
}

/**
 * Incoming feeder routes into this game (any finish place), same order as competitor lines on the card.
 * Use this (not only place-1 / “winner” routes) so finals and other leaves fed by bracket edges lock correctly.
 */
export function incomingGameFeedersSorted(
  draw: TournamentDrawState,
  toGameId: string,
): Array<{ fromGameId: string; place: number }> {
  return draw.connections
    .filter((c) => c.terminalType === 'game' && c.toGameId === toGameId)
    .sort((a, b) => compareIncomingConnections(draw, a, b))
    .map((c) => ({ fromGameId: c.fromGameId, place: c.place }));
}

/**
 * Maps finish place (1 = best) to the slot index that took that place.
 * Two-competitor games: pick_winner / final_score / ends (null if undecided or tie).
 * Three or more: multi_score only; ranks by highest score (tie-break lower slot index).
 */
export function slotIndexForPlaceAfterResult(game: TournamentGameNode, place: number): number | null {
  const k = game.slots.length;
  if (place < 1 || place > k) return null;

  if (k === 2) {
    const outcome = outcomeFromResult(game);
    if (outcome == null || outcome === 'tie') return null;
    const winnerSlot = outcome === 'slot0' ? 0 : 1;
    const loserSlot = 1 - winnerSlot;
    return place === 1 ? winnerSlot : loserSlot;
  }

  const ranking = multiScoreRanking(game);
  if (!ranking || ranking.length !== k) return null;
  const row = ranking[place - 1];
  return row != null ? row.slotIndex : null;
}

/**
 * Competitor to show on virtual feeder cards when the feeding side is known: after the source game
 * is decided, or before that when the only non-bye in a 2-way game is already the winner (bye advance).
 */
export function resolveVirtualFeederCompetitorLabel(
  draw: TournamentDrawState,
  fromG: TournamentGameNode,
  place: number,
  teamsById: Map<number, TeamRow>,
): string | null {
  const finisherIdx = slotIndexForPlaceAfterResult(fromG, place);
  if (finisherIdx != null) {
    /** Match game cards / incoming edges: slots are often TBD after normalize while feeders hold game_place. */
    const label = resolveResultsTableSideLabel(draw, fromG, finisherIdx, teamsById);
    if (label === 'TBD' || label === 'Bye' || label === '—' || label === '…') return null;
    return label;
  }

  const k = fromG.slots.length;
  if (k === 2 && place === 1) {
    const s0 = fromG.slots[0];
    const s1 = fromG.slots[1];
    if (!s0 || !s1) return null;
    const bye0 = s0.sourceType === 'bye';
    const bye1 = s1.sourceType === 'bye';
    if (bye0 === bye1) return null;
    const competitorIdx = bye0 ? 1 : 0;
    const label = resolveResultsTableSideLabel(draw, fromG, competitorIdx, teamsById);
    if (label === 'TBD' || label === 'Bye' || label === '—' || label === '…') return null;
    return label;
  }

  return null;
}

/**
 * Resolve a slot to the competitor label shown on bracket cards and the results table, following
 * `game_place` references into feeder games when those games have a recorded winner/loser.
 */
export function resolveSlotSourceForBracketDisplay(
  draw: TournamentDrawState,
  slot: TournamentSlotSource,
  teamsById: Map<number, TeamRow>,
  visitingGameIds: Set<string> = new Set(),
): string {
  switch (slot.sourceType) {
    case 'tbd':
      return 'TBD';
    case 'bye':
      return 'Bye';
    case 'team':
      return formatSlotSourceLabel(slot, teamsById, draw.games);
    case 'game_place': {
      const gid = slot.gameId;
      if (!gid) return '…';
      if (visitingGameIds.has(gid)) {
        return formatSlotSourceLabel(slot, teamsById, draw.games);
      }
      const og = draw.games[gid];
      if (!og) return '…';
      const idx = slotIndexForPlaceAfterResult(og, slot.place);
      if (idx == null) {
        return formatFeederPipeLabel(og, slot.place);
      }
      return resolveResultsTableSideLabel(draw, og, idx, teamsById, visitingGameIds);
    }
    default:
      return '—';
  }
}

/**
 * Results tab / pick-winner labels for one competitor slot. Matches the structure inspector:
 * slot `i` uses `incomingGameFeedersSorted(draw, g.id)[i]` when present, so games whose
 * `game_place` entries were cleared to TBD (duplicate feeder edges) still resolve.
 *
 * Recurses through feeder games by **slot index** (who occupies that side after normalization),
 * not by reading `g.slots[i]` when it is TBD — those rows no longer hold `game_place` after normalize.
 */
export function resolveResultsTableSideLabel(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  slotIndex: number,
  teamsById: Map<number, TeamRow>,
  visitingGameIds: Set<string> = new Set(),
): string {
  if (visitingGameIds.has(g.id)) {
    const slot = g.slots[slotIndex];
    if (!slot) return '—';
    return formatSlotSourceLabel(slot, teamsById, draw.games);
  }
  visitingGameIds.add(g.id);
  try {
    const feeders = incomingGameFeedersSorted(draw, g.id);
    if (slotIndex < feeders.length) {
      const edge = feeders[slotIndex]!;
      const from = draw.games[edge.fromGameId];
      if (!from) return 'TBD';
      const finisherSlotIdx = slotIndexForPlaceAfterResult(from, edge.place);
      if (finisherSlotIdx == null) {
        return formatFeederPipeLabel(from, edge.place);
      }
      return resolveResultsTableSideLabel(draw, from, finisherSlotIdx, teamsById, visitingGameIds);
    }
    const slot = g.slots[slotIndex];
    if (!slot) return '—';
    return resolveSlotSourceForBracketDisplay(draw, slot, teamsById, visitingGameIds);
  } finally {
    visitingGameIds.delete(g.id);
  }
}

export function formatSlotSourceLabel(
  slot: TournamentSlotSource,
  teamsById: Map<number, TeamRow>,
  games: Record<string, TournamentGameNode>,
): string {
  switch (slot.sourceType) {
    case 'tbd':
      return 'TBD';
    case 'bye':
      return 'Bye';
    case 'team': {
      if (slot.teamId == null) return 'Team…';
      const t = teamsById.get(slot.teamId);
      return t ? formatTeamDisplayName(t.teamName, t.sortOrder) : `Team #${slot.teamId}`;
    }
    case 'game_place': {
      const og = slot.gameId ? games[slot.gameId] : undefined;
      return og ? formatFeederPipeLabel(og, slot.place) : '…';
    }
    default:
      return '—';
  }
}

export type CompetitorLineSegment = {
  text: string;
  color?: string;
  /** Which `g.slots` index this line represents, when it maps to a single slot. */
  slotIndex?: number | null;
};

/**
 * Competitor labels for a game card, one segment per slot. When a feeder comes from another
 * bracket event, `color` is that event’s lane color.
 */
export function competitorLabelsLineSegments(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  teamsById: Map<number, TeamRow>,
): CompetitorLineSegment[] {
  const n = g.slots.length;
  const incomingConns = draw.connections
    .filter((c) => c.terminalType === 'game' && c.toGameId === g.id)
    .sort((a, b) => compareIncomingConnections(draw, a, b));
  const incomingKeys = new Set(incomingConns.map((c) => `${c.fromGameId}:${c.place}`));

  const incomingSegments: CompetitorLineSegment[] = incomingConns.map((c, i) => {
    const from = draw.games[c.fromGameId];
    let text: string;
    if (from) {
      const idx = slotIndexForPlaceAfterResult(from, c.place);
      text =
        idx != null
          ? resolveResultsTableSideLabel(draw, from, idx, teamsById)
          : formatFeederPipeLabel(from, c.place);
    } else {
      text = '…';
    }
    const color =
      from && from.eventId !== g.eventId
        ? draw.setup.events.find((e) => e.id === from.eventId)?.color
        : undefined;
    const slotIndex = i < n ? i : null;
    return { text, color, slotIndex };
  });

  const slotSegments: CompetitorLineSegment[] = [];
  for (let slotIdx = 0; slotIdx < g.slots.length; slotIdx++) {
    const s = g.slots[slotIdx]!;
    if (s.sourceType === 'game_place' && s.gameId && incomingKeys.has(`${s.gameId}:${s.place}`)) {
      continue;
    }
    const text = resolveSlotSourceForBracketDisplay(draw, s, teamsById);
    let color: string | undefined;
    if (s.sourceType === 'game_place' && s.gameId) {
      const og = draw.games[s.gameId];
      if (og && og.eventId !== g.eventId) {
        color = draw.setup.events.find((e) => e.id === og.eventId)?.color;
      }
    }
    slotSegments.push({ text, color, slotIndex: slotIdx });
  }

  const parts: CompetitorLineSegment[] = [...incomingSegments];
  for (const seg of slotSegments) {
    if (parts.length >= n) break;
    parts.push(seg);
  }
  while (parts.length < n) parts.push({ text: 'TBD' });
  return parts.slice(0, n);
}

/**
 * Single-line competitor summary for a game card (e.g. `W-A1 v. W-A2`, or `1st A1 v. …` for multi-entry games).
 */
export function competitorLabelsLine(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  teamsById: Map<number, TeamRow>,
): string {
  return competitorLabelsLineSegments(draw, g, teamsById)
    .map((s) => s.text)
    .join(' v. ');
}
