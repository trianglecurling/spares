import type { TournamentDrawState, TournamentGameNode } from './eventTournamentDrawSchema.js';
import {
  resolveGameSlotRegistrationId,
  slotIndexForPlace,
} from '../utils/tournamentPoolStandings.js';

/** Maps finish place (1 = best) to the slot index that took that place. */
export function slotIndexForPlaceAfterResult(game: TournamentGameNode, place: number): number | null {
  return slotIndexForPlace(game, place);
}

/**
 * Walk bracket slots / incoming feeders / pool entries / standings to a confirmed registration id
 * when the competitor is already known (seeded, advanced, or finalized from pool play).
 */
export function resolveRegistrationIdForGameSlot(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  slotIndex: number,
  visitingGameIds: Set<string> = new Set()
): number | null {
  return resolveGameSlotRegistrationId(draw, game, slotIndex, visitingGameIds);
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
