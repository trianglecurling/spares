import type {
  TournamentConnectionEdge,
  TournamentDrawState,
  TournamentGameNode,
} from './eventTournamentDrawSchema.js';

function compareIncomingConnections(
  draw: TournamentDrawState,
  a: TournamentConnectionEdge,
  b: TournamentConnectionEdge
): number {
  const labelA = draw.games[a.fromGameId]?.label ?? a.fromGameId;
  const labelB = draw.games[b.fromGameId]?.label ?? b.fromGameId;
  const byLabel = labelA.localeCompare(labelB, undefined, { numeric: true });
  if (byLabel !== 0) return byLabel;
  if (a.fromGameId !== b.fromGameId) return a.fromGameId.localeCompare(b.fromGameId);
  if (a.place !== b.place) return a.place - b.place;
  return a.id.localeCompare(b.id);
}

function incomingGameFeedersSorted(
  draw: TournamentDrawState,
  toGameId: string
): Array<{ fromGameId: string; place: number }> {
  return draw.connections
    .filter((connection) => connection.terminalType === 'game' && connection.toGameId === toGameId)
    .sort((a, b) => compareIncomingConnections(draw, a, b))
    .map((connection) => ({ fromGameId: connection.fromGameId, place: connection.place }));
}

function twoSidedOutcome(game: TournamentGameNode): 0 | 1 | null {
  const result = game.result;
  if (!result) return null;
  if (result.entryKind === 'pick_winner') {
    return result.winnerSlot;
  }
  if (result.entryKind === 'final_score') {
    const [score0, score1] = result.finalScores;
    if (score0 > score1) return 0;
    if (score1 > score0) return 1;
    return null;
  }
  if (result.entryKind === 'ends') {
    if (result.complete === false) return null;
    const score0 = result.ends.side0.reduce((sum, value) => sum + value, 0);
    const score1 = result.ends.side1.reduce((sum, value) => sum + value, 0);
    if (score0 > score1) return 0;
    if (score1 > score0) return 1;
    return null;
  }
  return null;
}

function multiScoreRanking(game: TournamentGameNode): number[] | null {
  const result = game.result;
  if (!result || result.entryKind !== 'multi_score') return null;
  if (result.scores.length !== game.slots.length) return null;
  const rows = result.scores.map((score, slotIndex) => ({ slotIndex, score }));
  rows.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.slotIndex - b.slotIndex));
  return rows.map((row) => row.slotIndex);
}

/** Maps finish place (1 = best) to the slot index that took that place. */
export function slotIndexForPlaceAfterResult(game: TournamentGameNode, place: number): number | null {
  const slotCount = game.slots.length;
  if (place < 1 || place > slotCount) return null;

  if (slotCount === 2) {
    const winnerSlot = twoSidedOutcome(game);
    if (winnerSlot == null) return null;
    const loserSlot = (1 - winnerSlot) as 0 | 1;
    return place === 1 ? winnerSlot : loserSlot;
  }

  const ranking = multiScoreRanking(game);
  if (!ranking) return null;
  return ranking[place - 1] ?? null;
}

function resolveRegistrationIdFromSlotSource(
  draw: TournamentDrawState,
  slot: TournamentGameNode['slots'][number],
  visitingGameIds: Set<string>
): number | null {
  if (slot.sourceType === 'registration') {
    return slot.registrationId ?? null;
  }
  if (slot.sourceType !== 'game_place' || !slot.gameId) return null;
  if (visitingGameIds.has(slot.gameId)) return null;
  const feeder = draw.games[slot.gameId];
  if (!feeder) return null;
  const finisherSlot = slotIndexForPlaceAfterResult(feeder, slot.place);
  if (finisherSlot == null) return null;
  return resolveRegistrationIdForGameSlot(draw, feeder, finisherSlot, visitingGameIds);
}

/**
 * Walk bracket slots / incoming feeders to a confirmed registration id when the
 * competitor is already known (seeded or advanced from a recorded result).
 */
export function resolveRegistrationIdForGameSlot(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  slotIndex: number,
  visitingGameIds: Set<string> = new Set()
): number | null {
  if (visitingGameIds.has(game.id)) return null;
  visitingGameIds.add(game.id);
  try {
    const feeders = incomingGameFeedersSorted(draw, game.id);
    if (slotIndex < feeders.length) {
      const edge = feeders[slotIndex]!;
      const from = draw.games[edge.fromGameId];
      if (!from) return null;
      const finisherSlot = slotIndexForPlaceAfterResult(from, edge.place);
      if (finisherSlot == null) return null;
      return resolveRegistrationIdForGameSlot(draw, from, finisherSlot, visitingGameIds);
    }
    const slot = game.slots[slotIndex];
    if (!slot) return null;
    return resolveRegistrationIdFromSlotSource(draw, slot, visitingGameIds);
  } finally {
    visitingGameIds.delete(game.id);
  }
}

export function stoneColorForSlot(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  slotIndex: number
): string | null {
  if (game.slots.length !== 2) return null;
  if (game.rockColor1Slot !== 0 && game.rockColor1Slot !== 1) return null;
  const sheet = draw.sheets.find((row) => row.clubSheetId === game.schedule?.sheetId);
  if (!sheet) return null;
  const color = game.rockColor1Slot === slotIndex ? sheet.stoneColor1 : sheet.stoneColor2;
  return color?.trim() || null;
}
