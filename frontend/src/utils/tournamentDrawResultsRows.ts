import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentGameResult,
} from './tournamentDrawModel';
import { resolveResultsTableSideLabel } from './tournamentDrawRouting';
import { multiScoreRanking } from './tournamentDrawResult';
import type { TournamentTeamApi } from '../types/tournamentTeam';

export type TournamentResultsTeamMeta = { teamName: string | null; sortOrder: number };

export type TournamentResultsTableRow = {
  game: TournamentGameNode;
  comp0: string;
  comp1: string;
  drawLabel: string;
  sheetLabel: string;
  sortTime: number;
  sortSheet: number;
  drawBlockId: string | null;
  sheetId: number | null;
};

function lastNameFromPlayerName(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  if (t.includes(',')) {
    return t.split(',')[0]?.trim() || null;
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1]!.replace(/\.$/, '');
}

/** Fourth’s last name when set; otherwise skip’s last name (e.g. doubles). */
export function fourthOrSkipLastName(team: TournamentTeamApi | undefined): string | null {
  if (!team) return null;
  const fourth = team.roster.find((r) => r.slotCode === 'fourth');
  const fromFourth = lastNameFromPlayerName(fourth?.playerName);
  if (fromFourth) return fromFourth;
  const skip = team.roster.find((r) => r.slotCode === team.skipSlotCode);
  return lastNameFromPlayerName(skip?.playerName);
}

export function formatResultsCompetitorLabel(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  slotIndex: number,
  teamsById: Map<number, TournamentResultsTeamMeta>,
  teamsFullById: Map<number, TournamentTeamApi>,
): string {
  const base = resolveResultsTableSideLabel(draw, g, slotIndex, teamsById);
  const slot = g.slots[slotIndex];
  if (!slot || slot.sourceType !== 'registration' || slot.registrationId == null) return base;
  const ln = fourthOrSkipLastName(teamsFullById.get(slot.registrationId));
  if (ln) return `${base} (${ln})`;
  return base;
}

export function buildResultsTableRows(
  draw: TournamentDrawState,
  teams: TournamentTeamApi[],
): TournamentResultsTableRow[] {
  const teamsById = new Map(teams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }]));
  const teamsFullById = new Map(teams.map((t) => [t.id, t]));
  const blocks = [...draw.drawBlocks].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const blockIndex = new Map(blocks.map((b, i) => [b.id, i + 1]));
  const out: TournamentResultsTableRow[] = [];
  for (const g of Object.values(draw.games)) {
    const sch = g.schedule;
    const comp0 = formatResultsCompetitorLabel(draw, g, 0, teamsById, teamsFullById);
    const comp1 = formatResultsCompetitorLabel(draw, g, 1, teamsById, teamsFullById);
    let drawLabel = '—';
    let sortTime = Number.POSITIVE_INFINITY;
    let drawBlockId: string | null = null;
    if (sch?.drawBlockId) {
      drawBlockId = sch.drawBlockId;
      const idx = blockIndex.get(sch.drawBlockId);
      if (idx != null) drawLabel = String(idx);
      const b = blocks.find((x) => x.id === sch.drawBlockId);
      if (b?.startTime?.trim()) {
        const d = new Date(b.startTime);
        if (!Number.isNaN(d.getTime())) {
          sortTime = d.getTime();
        }
      }
    }
    let sheetLabel = '—';
    let sortSheet = 99999;
    let sheetId: number | null = null;
    if (sch?.sheetId != null) {
      sheetId = sch.sheetId;
      const sh = draw.sheets.find((s) => s.clubSheetId === sch.sheetId);
      sheetLabel = sh?.name ?? String(sch.sheetId);
      sortSheet = sh?.order ?? sortSheet;
    }
    out.push({
      game: g,
      comp0,
      comp1,
      drawLabel,
      sheetLabel,
      sortTime,
      sortSheet,
      drawBlockId,
      sheetId,
    });
  }
  out.sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    if (a.sortSheet !== b.sortSheet) return a.sortSheet - b.sortSheet;
    return a.game.label.localeCompare(b.game.label, undefined, { numeric: true });
  });
  return out;
}

export function formatMultiCompetitorResultsLine(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  teamsById: Map<number, TournamentResultsTeamMeta>,
): string | null {
  const ranking = multiScoreRanking(game);
  if (!ranking) return null;
  return ranking
    .map((row, i) => {
      const label = resolveResultsTableSideLabel(draw, game, row.slotIndex, teamsById);
      return `${i + 1}. ${label} (${row.score})`;
    })
    .join(' · ');
}

export function formatMultiCompetitionIntroLine(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  teamsById: Map<number, TournamentResultsTeamMeta>,
): string {
  const n = game.slots.length;
  const labels = game.slots.map((_, idx) => resolveResultsTableSideLabel(draw, game, idx, teamsById));
  return `Competition among ${n} teams: ${labels.join(' v. ')}`;
}

export function clearGameResult(gameId: string, d: TournamentDrawState): TournamentDrawState {
  const g = d.games[gameId];
  if (!g) return d;
  const { result: _r, ...rest } = g;
  void _r;
  return { ...d, games: { ...d.games, [gameId]: rest } };
}

export function setGameResult(
  d: TournamentDrawState,
  gameId: string,
  result: TournamentGameResult | null,
): TournamentDrawState {
  if (result == null) return clearGameResult(gameId, d);
  const g = d.games[gameId];
  if (!g) return d;
  return { ...d, games: { ...d.games, [gameId]: { ...g, result } } };
}

/** Clear recorded results from every game in the draw. */
export function clearAllGameResults(draw: TournamentDrawState): TournamentDrawState {
  let changed = false;
  const games: TournamentDrawState['games'] = {};
  for (const [id, game] of Object.entries(draw.games)) {
    if (game.result == null) {
      games[id] = game;
      continue;
    }
    const { result: _drop, ...rest } = game;
    void _drop;
    games[id] = rest;
    changed = true;
  }
  return changed ? { ...draw, games } : draw;
}

export function countGamesWithResults(draw: TournamentDrawState): number {
  let n = 0;
  for (const game of Object.values(draw.games)) {
    if (game.result != null) n += 1;
  }
  return n;
}

/** True when any game has a stored result (including in-progress end-by-end scores). */
export function drawHasScoreActivity(draw: TournamentDrawState): boolean {
  return countGamesWithResults(draw) > 0;
}

export function gameHasRecordedResult(game: TournamentGameNode): boolean {
  if (game.result == null) return false;
  // In-progress end-by-end scores are saved but the game is not finished yet.
  if (game.result.entryKind === 'ends') {
    if (game.result.complete === false) return false;
    if (game.result.ends.side0.length === 0) return false;
  }
  return true;
}

/**
 * Scheduled start for a game from its draw block (ms since epoch), or null if unknown.
 */
export function gameScheduleStartMs(
  draw: TournamentDrawState,
  game: TournamentGameNode,
): number | null {
  const blockId = game.schedule?.drawBlockId;
  if (!blockId) return null;
  const block = draw.drawBlocks.find((b) => b.id === blockId);
  const iso = block?.startTime?.trim();
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Live: scheduled start has passed and the game does not yet have a final recorded result.
 * (In-progress end-by-end scores count as live until marked complete.)
 */
export function gameIsLive(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  nowMs: number,
): boolean {
  if (gameHasRecordedResult(game)) return false;
  const startMs = gameScheduleStartMs(draw, game);
  if (startMs == null) return false;
  return nowMs >= startMs;
}

export function endsResultIsComplete(
  result: TournamentGameResult | null | undefined,
): boolean {
  if (!result || result.entryKind !== 'ends') return false;
  return result.complete !== false;
}
