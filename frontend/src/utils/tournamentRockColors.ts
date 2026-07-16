import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentRockColorMode,
  TournamentSheet,
} from './tournamentDrawModel';
import type { ClubSheet } from './tournamentDrawSchedule';

export type SheetStoneColors = { stoneColor1: string; stoneColor2: string };

export function resolveRockColorMode(draw: TournamentDrawState): TournamentRockColorMode {
  return draw.rockColorMode === 'randomized' ? 'randomized' : 'manual';
}

export function sheetColorsForGame(
  draw: TournamentDrawState,
  game: TournamentGameNode,
): SheetStoneColors | null {
  const sheetId = game.schedule?.sheetId;
  if (sheetId == null || sheetId <= 0) return null;
  const sheet = draw.sheets.find((s) => s.clubSheetId === sheetId);
  if (!sheet?.stoneColor1 || !sheet?.stoneColor2) return null;
  return { stoneColor1: sheet.stoneColor1, stoneColor2: sheet.stoneColor2 };
}

export function gameCanHaveRockColors(
  draw: TournamentDrawState,
  game: TournamentGameNode,
): boolean {
  return game.slots.length === 2 && sheetColorsForGame(draw, game) != null;
}

/**
 * Visual order: sheet color 1’s team first, then color 2’s team.
 * When unset, keep logical slot order `[0, 1]`.
 */
export function displaySlotOrder(game: TournamentGameNode): [0 | 1, 0 | 1] {
  if (game.slots.length !== 2) return [0, 1];
  const color1 = game.rockColor1Slot;
  if (color1 === 0) return [0, 1];
  if (color1 === 1) return [1, 0];
  return [0, 1];
}

/** Logical slot that appears in a given visual row (0 = top / first). */
export function logicalSlotForDisplayRow(game: TournamentGameNode, displayRow: 0 | 1): 0 | 1 {
  return displaySlotOrder(game)[displayRow]!;
}

/** Visual row for a logical slot. */
export function displayRowForLogicalSlot(game: TournamentGameNode, logicalSlot: 0 | 1): 0 | 1 {
  const [first, second] = displaySlotOrder(game);
  return first === logicalSlot ? 0 : second === logicalSlot ? 1 : logicalSlot;
}

/** Stone color key for a logical slot when colors are assigned. */
export function stoneColorForLogicalSlot(
  game: TournamentGameNode,
  logicalSlot: 0 | 1,
  colors: SheetStoneColors,
): string | null {
  if (game.rockColor1Slot !== 0 && game.rockColor1Slot !== 1) return null;
  return game.rockColor1Slot === logicalSlot ? colors.stoneColor1 : colors.stoneColor2;
}

/**
 * Assign `rockColor1Slot` so `logicalSlot` gets `whichColor` (1 = stoneColor1, 2 = stoneColor2).
 */
export function rockColor1SlotForChoice(
  logicalSlot: 0 | 1,
  whichColor: 1 | 2,
): 0 | 1 {
  if (whichColor === 1) return logicalSlot;
  return logicalSlot === 0 ? 1 : 0;
}

export function setGameRockColor1Slot(
  draw: TournamentDrawState,
  gameId: string,
  rockColor1Slot: 0 | 1 | null,
): TournamentDrawState {
  const game = draw.games[gameId];
  if (!game) return draw;
  const nextGame =
    rockColor1Slot == null
      ? (() => {
          const { rockColor1Slot: _drop, ...rest } = game;
          void _drop;
          return rest;
        })()
      : { ...game, rockColor1Slot };
  return { ...draw, games: { ...draw.games, [gameId]: nextGame } };
}

/** Clear rock color assignments from every game. */
export function clearAllRockColors(draw: TournamentDrawState): TournamentDrawState {
  let changed = false;
  const games: TournamentDrawState['games'] = {};
  for (const [id, game] of Object.entries(draw.games)) {
    if (game.rockColor1Slot !== 0 && game.rockColor1Slot !== 1) {
      games[id] = game;
      continue;
    }
    const { rockColor1Slot: _drop, ...rest } = game;
    void _drop;
    games[id] = rest;
    changed = true;
  }
  return changed ? { ...draw, games } : draw;
}

export function countGamesWithRockColors(draw: TournamentDrawState): number {
  let n = 0;
  for (const game of Object.values(draw.games)) {
    if (game.rockColor1Slot === 0 || game.rockColor1Slot === 1) n += 1;
  }
  return n;
}

/** Merge club sheet stone colors onto matching draw.sheets entries. */
export function syncStoneColorsOntoDrawSheets(
  draw: TournamentDrawState,
  clubSheets: Array<Pick<ClubSheet, 'id' | 'stoneColor1' | 'stoneColor2'>>,
): TournamentDrawState {
  if (clubSheets.length === 0) return draw;
  const byId = new Map(clubSheets.map((s) => [s.id, s]));
  let changed = false;
  const sheets: TournamentSheet[] = draw.sheets.map((sheet) => {
    if (sheet.clubSheetId <= 0) return sheet;
    const club = byId.get(sheet.clubSheetId);
    if (!club) return sheet;
    const stoneColor1 = club.stoneColor1 ?? sheet.stoneColor1;
    const stoneColor2 = club.stoneColor2 ?? sheet.stoneColor2;
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

/**
 * For randomized mode: assign rock colors only to eligible two-sided games that still lack one.
 */
export function assignMissingRandomRockColors(draw: TournamentDrawState): TournamentDrawState {
  let changed = false;
  const games: TournamentDrawState['games'] = { ...draw.games };
  for (const [id, game] of Object.entries(draw.games)) {
    if (game.rockColor1Slot === 0 || game.rockColor1Slot === 1) continue;
    if (!gameCanHaveRockColors(draw, game)) continue;
    const rockColor1Slot = Math.random() < 0.5 ? (0 as const) : (1 as const);
    games[id] = { ...game, rockColor1Slot };
    changed = true;
  }
  return changed ? { ...draw, games } : draw;
}

export function applyRockColorModeChange(
  draw: TournamentDrawState,
  mode: TournamentRockColorMode,
  clubSheets: Array<Pick<ClubSheet, 'id' | 'stoneColor1' | 'stoneColor2'>>,
): TournamentDrawState {
  let next = syncStoneColorsOntoDrawSheets({ ...draw, rockColorMode: mode }, clubSheets);
  if (mode === 'randomized') {
    next = assignMissingRandomRockColors(next);
  }
  return next;
}
