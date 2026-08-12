import type { MatchupRound } from './generateMatchups';
import {
  applyByeFairnessGames,
  cloneByeFairnessContext,
  compareByeFairnessCoverage,
  countHonoredRequests,
  createByeFairnessContext,
  getByeFairnessCoverage,
  getByeFairnessCoverageAfterGames,
  type ByeFairnessContext,
  type ByeFairnessCoverage,
} from './byeFairness';
import type {
  GeneratedGame,
  Matchup,
  ProgressUpdate,
  ScheduleByeRequest,
  ScheduleDrawSlot,
  ScheduleHardConstraint,
  ScheduleResult,
  ScheduleStrategy,
  ScheduleWarning,
  UnschedulableMatchup,
} from './types';
import {
  buildByeMap,
  buildEarlyLateDrawTimesByDate,
  buildStrategyPhaseMap,
  byePenalty,
  compactnessScoreFromCounts,
  computeTeamStats,
  partitionCompactnessScore,
  preferDrawTimePenalty,
  totalScheduleScore,
  WEIGHT_DRAW_FILL_BALANCE,
  WEIGHT_DRAW_TIME_BALANCE,
  WEIGHT_BYE_PRIORITY_1,
  WEIGHT_BYE_PRIORITY_2,
  WEIGHT_POSITION_BALANCE,
  WEIGHT_SHEET_BALANCE,
} from './scoring';

// ─── Seeded PRNG ────────────────────────────────────────────────────────────

/**
 * Mulberry32: a fast, seedable 32-bit PRNG. Returns a function that produces
 * values in [0, 1) with each call.
 */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ─── Available slot pool ────────────────────────────────────────────────────

/** A concrete slot: a specific date, time, and sheet. */
interface GameSlot {
  date: string;
  time: string;
  sheetId: number;
}

/**
 * Build the pool of available game slots from draw slots, filtered to only
 * slots selected by at least one strategy and only available sheets.
 */
function buildSlotPool(drawSlots: ScheduleDrawSlot[], strategies: ScheduleStrategy[]): GameSlot[] {
  // Union of all draw slot keys across strategies (normalized HH:MM)
  const allowedKeys = new Set<string>();
  for (const s of strategies) {
    for (const key of s.drawSlotKeys) {
      const [date, time] = key.split('|');
      if (!date || !time) {
        allowedKeys.add(key);
        continue;
      }
      allowedKeys.add(`${date}|${normalizeTime(time)}`);
    }
  }

  const slots: GameSlot[] = [];
  for (const ds of drawSlots) {
    const key = `${ds.date}|${normalizeTime(ds.time)}`;
    if (!allowedKeys.has(key)) continue;
    for (const sheet of ds.sheets) {
      if (sheet.isAvailable) {
        slots.push({ date: ds.date, time: normalizeTime(ds.time), sheetId: sheet.id });
      }
    }
  }

  return slots;
}

/**
 * Get the set of draw slot keys that a specific strategy is allowed to use.
 */
function strategyAllowedKeys(strategy: ScheduleStrategy): Set<string> {
  return new Set(
    strategy.drawSlotKeys.map((k) => {
      const [date, time] = k.split('|');
      if (!date || !time) return k;
      return `${date}|${normalizeTime(time)}`;
    })
  );
}

/** Map teamId → dates the team must not play (hard bye constraints). */
function buildHardByeByTeam(hardConstraints: ScheduleHardConstraint[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const hc of hardConstraints) {
    if (hc.type !== 'bye') continue;
    const dates = map.get(hc.teamId) ?? new Set<string>();
    dates.add(hc.drawDate);
    map.set(hc.teamId, dates);
  }
  return map;
}

function unorderedPairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function teamHasHardBye(
  hardByeByTeam: Map<number, Set<string>>,
  teamId: number,
  date: string
): boolean {
  return hardByeByTeam.get(teamId)?.has(date) ?? false;
}

// ─── Play-unit grouping ─────────────────────────────────────────────────────

/**
 * Play unit for the once-per-week hard constraint.
 * Returns the Monday of the ISO week (Mon–Sun) as "YYYY-MM-DD" so all dates
 * in the same week share a key. A team may play at most once per week.
 */
function playUnitKeyFromDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(date.getTime() + mondayOffset * 86_400_000);
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Normalize draw times to HH:MM so "18:15" and "18:15:00" share a draw key. */
function normalizeTime(time: string): string {
  const trimmed = time.trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return trimmed.slice(0, 5);
  return `${String(Number.parseInt(match[1]!, 10)).padStart(2, '0')}:${match[2]}`;
}

// ─── Greedy slot assignment (Phase 2) ───────────────────────────────────────

/** Tracks which teams are already scheduled per draw (date|time). */
type DrawTeamMap = Map<string, Set<number>>;

/** Tracks which teams are already scheduled per play unit (ISO week Monday). */
type WeekTeamMap = Map<string, Set<number>>;

/** Tracks which slots have been taken. */
type SlotOccupied = Set<string>; // "date|time|sheetId"

interface CandidateScore {
  byeCoverage: ByeFairnessCoverage;
  softPenalty: number;
}

function compareCandidateScores(a: CandidateScore, b: CandidateScore): number {
  const byeComparison = compareByeFairnessCoverage(a.byeCoverage, b.byeCoverage);
  if (byeComparison !== 0) return byeComparison;
  return a.softPenalty - b.softPenalty;
}

function slotKey(s: GameSlot): string {
  return `${s.date}|${normalizeTime(s.time)}|${s.sheetId}`;
}

function drawKey(s: GameSlot): string {
  return `${s.date}|${normalizeTime(s.time)}`;
}

/**
 * Score a candidate assignment of a matchup to a slot. Lower is better.
 * Returns null if the assignment is invalid (hard constraint violation).
 *
 * Note: draw compactness (constraints #3 and #4) is handled STRUCTURALLY by
 * the two-tier assignment loop, not by this scoring function. This function
 * only handles fill-level balance (prefer less-full active draws) and the
 * remaining soft constraints (#5–#10).
 */
function scoreCandidate(
  matchup: Matchup,
  slot: GameSlot,
  drawTeams: DrawTeamMap,
  weekTeams: WeekTeamMap,
  occupiedSlots: SlotOccupied,
  drawGameCounts: Map<string, number>,
  teamDrawTimeCounts: Map<number, Map<string, number>>,
  teamSheetCounts: Map<number, Map<number, number>>,
  teamPositionCounts: Map<number, { asTeam1: number; asTeam2: number }>,
  byeMap: Map<string, ScheduleByeRequest[]>,
  byeFairness: ByeFairnessContext,
  strategyAllowed: Set<string>,
  hardByeByTeam: Map<number, Set<string>>,
  preferEarlyTeamIds: Set<number>,
  preferLateTeamIds: Set<number>,
  earlyDrawTimeByDate: Map<string, string>,
  lateDrawTimeByDate: Map<string, string>,
  weekKeyForDate: (date: string) => string,
  rng: () => number
): CandidateScore | null {
  // Check strategy draw slot allowance
  const dk = drawKey(slot);
  if (!strategyAllowed.has(dk)) return null;

  // Hard: slot already taken
  if (occupiedSlots.has(slotKey(slot))) return null;

  // Hard: admin-required bye on this date
  if (
    teamHasHardBye(hardByeByTeam, matchup.team1Id, slot.date) ||
    teamHasHardBye(hardByeByTeam, matchup.team2Id, slot.date)
  ) {
    return null;
  }

  // Hard: team already playing in this draw
  const teamsInDraw = drawTeams.get(dk);
  if (teamsInDraw) {
    if (teamsInDraw.has(matchup.team1Id) || teamsInDraw.has(matchup.team2Id)) {
      return null;
    }
  }

  // Hard: team already playing this week (at most once per ISO week)
  const wk = weekKeyForDate(slot.date);
  const teamsInWeek = weekTeams.get(wk);
  if (teamsInWeek) {
    if (teamsInWeek.has(matchup.team1Id) || teamsInWeek.has(matchup.team2Id)) {
      return null;
    }
  }

  let score = 0;

  // #4: Fill-level balance – among active draws, prefer the one with fewer
  // games so that all active draws fill evenly (avoids >1 empty per draw).
  const gamesInThisDraw = drawGameCounts.get(dk) ?? 0;
  score += gamesInThisDraw * WEIGHT_DRAW_FILL_BALANCE;

  // #5: Top bye penalty (priority 1)
  // #7: 2nd bye penalty (priority 2)
  // #9: Additional bye penalty (priority 3+)
  // (byePenalty applies the correct per-priority weight internally)
  const candidateGame: GeneratedGame = {
    team1Id: matchup.team1Id,
    team2Id: matchup.team2Id,
    gameDate: slot.date,
    gameTime: slot.time,
    sheetId: slot.sheetId,
    strategyLocalId: matchup.strategyLocalId,
  };
  score += byePenalty(candidateGame, byeMap);
  score += preferDrawTimePenalty(
    candidateGame,
    preferEarlyTeamIds,
    preferLateTeamIds,
    earlyDrawTimeByDate,
    lateDrawTimeByDate
  );

  // #6: Draw time balance – for teams *without* an early/late preference, keep
  // times even. Preferring teams may stack their preferred time; only the
  // preferDrawTimePenalty (and a light non-preferred count) push them.
  for (const teamId of [matchup.team1Id, matchup.team2Id]) {
    if (preferEarlyTeamIds.has(teamId) || preferLateTeamIds.has(teamId)) continue;
    const dtCounts = teamDrawTimeCounts.get(teamId);
    const currentCount = dtCounts?.get(slot.time) ?? 0;
    score += currentCount * WEIGHT_DRAW_TIME_BALANCE * 0.5;
  }

  // #8: Sheet balance – penalize sheets where these teams already play often
  for (const teamId of [matchup.team1Id, matchup.team2Id]) {
    const sCounts = teamSheetCounts.get(teamId);
    const currentCount = sCounts?.get(slot.sheetId) ?? 0;
    score += currentCount * WEIGHT_SHEET_BALANCE * 0.5;
  }

  // #10: Position balance – prefer assigning the team with fewer Team1 games as Team1
  const pos1 = teamPositionCounts.get(matchup.team1Id);
  const pos2 = teamPositionCounts.get(matchup.team2Id);
  const t1Diff = (pos1?.asTeam1 ?? 0) - (pos1?.asTeam2 ?? 0);
  const t2Diff = (pos2?.asTeam1 ?? 0) - (pos2?.asTeam2 ?? 0);
  score += Math.max(0, t1Diff) * WEIGHT_POSITION_BALANCE * 0.5;
  score += Math.max(0, -t2Diff) * WEIGHT_POSITION_BALANCE * 0.5;

  // Small random tiebreaker so that different seeds produce different schedules
  score += rng() * 0.01;

  return {
    byeCoverage: getByeFairnessCoverageAfterGames(
      byeFairness,
      [candidateGame],
      byeMap
    ),
    softPenalty: score,
  };
}

/**
 * Decide whether to swap team1/team2 positions for a matchup to improve
 * position balance. Returns [team1Id, team2Id] in the optimal order.
 */
function optimizePositions(
  matchup: Matchup,
  teamPositionCounts: Map<number, { asTeam1: number; asTeam2: number }>
): [number, number] {
  const pos1 = teamPositionCounts.get(matchup.team1Id);
  const pos2 = teamPositionCounts.get(matchup.team2Id);
  const balance1AsT1 = (pos1?.asTeam1 ?? 0) - (pos1?.asTeam2 ?? 0);
  const balance2AsT1 = (pos2?.asTeam1 ?? 0) - (pos2?.asTeam2 ?? 0);

  // If team1 has relatively more Team1 assignments and team2 has fewer, swap
  if (balance1AsT1 > balance2AsT1) {
    return [matchup.team2Id, matchup.team1Id];
  }
  return [matchup.team1Id, matchup.team2Id];
}

// ─── Simulated Annealing optimization (Phase 3) ────────────────────────────

// ─── SA move helpers ────────────────────────────────────────────────────────

interface SAMove {
  indices: number[];
  saved: Array<{
    gameDate: string;
    gameTime: string;
    sheetId: number;
    team1Id: number;
    team2Id: number;
  }>;
  /** Slot keys freed / taken by the move (only non-empty for relocate). */
  freed: string[];
  taken: string[];
}

function snap(g: GeneratedGame) {
  return {
    gameDate: g.gameDate,
    gameTime: g.gameTime,
    sheetId: g.sheetId,
    team1Id: g.team1Id,
    team2Id: g.team2Id,
  };
}

/** True if every listed game sits on a draw slot allowed by its strategy. */
function gamesRespectStrategySlots(
  games: GeneratedGame[],
  indices: number[],
  strategyAllowedMap: Map<string, Set<string>>
): boolean {
  for (const idx of indices) {
    const g = games[idx];
    const allowed = strategyAllowedMap.get(g.strategyLocalId);
    if (!allowed) return false;
    if (!allowed.has(`${g.gameDate}|${normalizeTime(g.gameTime)}`)) return false;
  }
  return true;
}

/** Swap the date/time/sheet of two random unlocked games (prefer same strategy). */
function moveSwap(
  games: GeneratedGame[],
  strategyAllowedMap: Map<string, Set<string>>,
  lockedGameIndices: Set<number>,
  rng: () => number
): SAMove | null {
  const n = games.length;
  for (let attempt = 0; attempt < 24; attempt++) {
    const i = Math.floor(rng() * n);
    if (lockedGameIndices.has(i)) continue;
    const preferSameStrategy = rng() < 0.8;
    let j: number | null = null;
    if (preferSameStrategy) {
      for (let t = 0; t < 12; t++) {
        const cand = Math.floor(rng() * n);
        if (cand === i || lockedGameIndices.has(cand)) continue;
        if (games[cand].strategyLocalId === games[i].strategyLocalId) {
          j = cand;
          break;
        }
      }
    }
    if (j == null) {
      do {
        j = Math.floor(rng() * n);
      } while (j === i);
      if (lockedGameIndices.has(j)) continue;
    }
    const si = snap(games[i]);
    const sj = snap(games[j]);
    const allowedI = strategyAllowedMap.get(games[i].strategyLocalId);
    const allowedJ = strategyAllowedMap.get(games[j].strategyLocalId);
    if (!allowedI?.has(`${sj.gameDate}|${normalizeTime(sj.gameTime)}`)) continue;
    if (!allowedJ?.has(`${si.gameDate}|${normalizeTime(si.gameTime)}`)) continue;
    games[i] = {
      ...games[i],
      gameDate: sj.gameDate,
      gameTime: normalizeTime(sj.gameTime),
      sheetId: sj.sheetId,
    };
    games[j] = {
      ...games[j],
      gameDate: si.gameDate,
      gameTime: normalizeTime(si.gameTime),
      sheetId: si.sheetId,
    };
    return { indices: [i, j], saved: [si, sj], freed: [], taken: [] };
  }
  return null;
}

/** Move a random unlocked game to a free slot in an active, strategy-allowed draw. */
function moveRelocate(
  games: GeneratedGame[],
  freeSlotsByDraw: Map<string, GameSlot[]>,
  occ: Set<string>,
  strategyAllowedMap: Map<string, Set<string>>,
  lockedGameIndices: Set<number>,
  rng: () => number
): SAMove | null {
  const idx = Math.floor(rng() * games.length);
  if (lockedGameIndices.has(idx)) return null;
  const allowed = strategyAllowedMap.get(games[idx].strategyLocalId);
  if (!allowed || allowed.size === 0) return null;

  const candidateDraws: string[] = [];
  for (const dk of allowed) {
    const free = freeSlotsByDraw.get(dk);
    if (free && free.length > 0) candidateDraws.push(dk);
  }
  if (candidateDraws.length === 0) return null;

  for (let a = 0; a < 20; a++) {
    const dk = candidateDraws[Math.floor(rng() * candidateDraws.length)];
    const free = freeSlotsByDraw.get(dk);
    if (!free || free.length === 0) continue;
    const c = free[Math.floor(rng() * free.length)];
    const sk = `${c.date}|${normalizeTime(c.time)}|${c.sheetId}`;
    if (occ.has(sk)) continue;
    const old = snap(games[idx]);
    const oldSk = `${old.gameDate}|${normalizeTime(old.gameTime)}|${old.sheetId}`;
    games[idx] = {
      ...games[idx],
      gameDate: c.date,
      gameTime: normalizeTime(c.time),
      sheetId: c.sheetId,
    };
    occ.delete(oldSk);
    occ.add(sk);
    // Maintain free-slot index
    const oldDk = `${old.gameDate}|${normalizeTime(old.gameTime)}`;
    const oldFree = freeSlotsByDraw.get(oldDk) ?? [];
    oldFree.push({
      date: old.gameDate,
      time: normalizeTime(old.gameTime),
      sheetId: old.sheetId,
    });
    freeSlotsByDraw.set(oldDk, oldFree);
    const nextFree = free.filter((s) => `${s.date}|${normalizeTime(s.time)}|${s.sheetId}` !== sk);
    freeSlotsByDraw.set(dk, nextFree);
    return { indices: [idx], saved: [old], freed: [oldSk], taken: [sk] };
  }
  return null;
}

/** Rotate slots of three unlocked games (prefer same strategy). */
function moveCycle(
  games: GeneratedGame[],
  strategyAllowedMap: Map<string, Set<string>>,
  lockedGameIndices: Set<number>,
  rng: () => number
): SAMove | null {
  const n = games.length;
  if (n < 3) return null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const i = Math.floor(rng() * n);
    if (lockedGameIndices.has(i)) continue;
    const preferSame = rng() < 0.8;
    const pick = (): number | null => {
      for (let t = 0; t < 10; t++) {
        const cand = Math.floor(rng() * n);
        if (cand === i || lockedGameIndices.has(cand)) continue;
        if (!preferSame || games[cand].strategyLocalId === games[i].strategyLocalId) return cand;
      }
      const cand = Math.floor(rng() * n);
      if (cand === i || lockedGameIndices.has(cand)) return null;
      return cand;
    };
    const j = pick();
    if (j == null) continue;
    let k: number | null = null;
    for (let t = 0; t < 10; t++) {
      const cand = Math.floor(rng() * n);
      if (cand === i || cand === j || lockedGameIndices.has(cand)) continue;
      if (!preferSame || games[cand].strategyLocalId === games[i].strategyLocalId) {
        k = cand;
        break;
      }
    }
    if (k == null) continue;
    const si = snap(games[i]);
    const sj = snap(games[j]);
    const sk = snap(games[k]);
    const allowedI = strategyAllowedMap.get(games[i].strategyLocalId);
    const allowedJ = strategyAllowedMap.get(games[j].strategyLocalId);
    const allowedK = strategyAllowedMap.get(games[k].strategyLocalId);
    if (!allowedI?.has(`${sk.gameDate}|${normalizeTime(sk.gameTime)}`)) continue;
    if (!allowedJ?.has(`${si.gameDate}|${normalizeTime(si.gameTime)}`)) continue;
    if (!allowedK?.has(`${sj.gameDate}|${normalizeTime(sj.gameTime)}`)) continue;
    games[i] = {
      ...games[i],
      gameDate: sk.gameDate,
      gameTime: normalizeTime(sk.gameTime),
      sheetId: sk.sheetId,
    };
    games[j] = {
      ...games[j],
      gameDate: si.gameDate,
      gameTime: normalizeTime(si.gameTime),
      sheetId: si.sheetId,
    };
    games[k] = {
      ...games[k],
      gameDate: sj.gameDate,
      gameTime: normalizeTime(sj.gameTime),
      sheetId: sj.sheetId,
    };
    return { indices: [i, j, k], saved: [si, sj, sk], freed: [], taken: [] };
  }
  return null;
}

interface RoundMoveGroup {
  strategyLocalId: string;
  indices: number[];
}

/**
 * Exchange every slot occupied by two generated rounds from the same strategy.
 * This is the natural move for changing which team receives a bye in two weeks:
 * intermediate one-game moves are usually infeasible under once-per-week.
 */
function moveRoundSwap(
  games: GeneratedGame[],
  roundMoveGroups: RoundMoveGroup[],
  strategyAllowedMap: Map<string, Set<string>>,
  lockedGameIndices: Set<number>,
  rng: () => number
): SAMove | null {
  if (roundMoveGroups.length < 2) return null;

  for (let attempt = 0; attempt < 24; attempt++) {
    const first = roundMoveGroups[Math.floor(rng() * roundMoveGroups.length)];
    const candidates = roundMoveGroups.filter(
      (group) =>
        group !== first &&
        group.strategyLocalId === first.strategyLocalId &&
        group.indices.length === first.indices.length &&
        group.indices.every((idx) => !lockedGameIndices.has(idx))
    );
    if (first.indices.some((idx) => lockedGameIndices.has(idx)) || candidates.length === 0) {
      continue;
    }

    const second = candidates[Math.floor(rng() * candidates.length)];
    const firstSaved = first.indices.map((idx) => snap(games[idx]));
    const secondSaved = second.indices.map((idx) => snap(games[idx]));
    const allowed = strategyAllowedMap.get(first.strategyLocalId);
    if (!allowed) continue;

    let allowedSwap = true;
    for (let i = 0; i < first.indices.length; i++) {
      const firstDestination = secondSaved[i];
      const secondDestination = firstSaved[i];
      if (
        !allowed.has(`${firstDestination.gameDate}|${normalizeTime(firstDestination.gameTime)}`) ||
        !allowed.has(`${secondDestination.gameDate}|${normalizeTime(secondDestination.gameTime)}`)
      ) {
        allowedSwap = false;
        break;
      }
    }
    if (!allowedSwap) continue;

    for (let i = 0; i < first.indices.length; i++) {
      const firstIdx = first.indices[i];
      const secondIdx = second.indices[i];
      games[firstIdx] = {
        ...games[firstIdx],
        gameDate: secondSaved[i].gameDate,
        gameTime: normalizeTime(secondSaved[i].gameTime),
        sheetId: secondSaved[i].sheetId,
      };
      games[secondIdx] = {
        ...games[secondIdx],
        gameDate: firstSaved[i].gameDate,
        gameTime: normalizeTime(firstSaved[i].gameTime),
        sheetId: firstSaved[i].sheetId,
      };
    }

    return {
      indices: [...first.indices, ...second.indices],
      saved: [...firstSaved, ...secondSaved],
      freed: [],
      taken: [],
    };
  }
  return null;
}

function violatesHardByeDates(
  games: GeneratedGame[],
  indices: number[],
  hardByeByTeam: Map<number, Set<string>>
): boolean {
  for (const idx of indices) {
    const g = games[idx];
    if (
      teamHasHardBye(hardByeByTeam, g.team1Id, g.gameDate) ||
      teamHasHardBye(hardByeByTeam, g.team2Id, g.gameDate)
    ) {
      return true;
    }
  }
  return false;
}

/** Flip team1 and team2 for a random unlocked game. */
function movePosition(
  games: GeneratedGame[],
  lockedGameIndices: Set<number>,
  rng: () => number
): SAMove | null {
  let idx = Math.floor(rng() * games.length);
  for (let attempt = 0; attempt < 12 && lockedGameIndices.has(idx); attempt++) {
    idx = Math.floor(rng() * games.length);
  }
  if (lockedGameIndices.has(idx)) return null;
  const old = snap(games[idx]);
  games[idx] = { ...games[idx], team1Id: old.team2Id, team2Id: old.team1Id };
  return { indices: [idx], saved: [old], freed: [], taken: [] };
}

/** Undo an SA move, restoring original game states and slot occupancy. */
function undoMove(
  games: GeneratedGame[],
  m: SAMove,
  occ: Set<string>,
  freeSlotsByDraw?: Map<string, GameSlot[]>
): void {
  for (let i = 0; i < m.indices.length; i++) {
    const idx = m.indices[i];
    const s = m.saved[i];
    games[idx] = {
      ...games[idx],
      gameDate: s.gameDate,
      gameTime: s.gameTime,
      sheetId: s.sheetId,
      team1Id: s.team1Id,
      team2Id: s.team2Id,
    };
  }
  for (const sk of m.taken) {
    occ.delete(sk);
    if (freeSlotsByDraw) {
      const [date, time, sheetStr] = sk.split('|');
      const dk = `${date}|${normalizeTime(time)}`;
      const list = freeSlotsByDraw.get(dk) ?? [];
      list.push({ date, time: normalizeTime(time), sheetId: Number(sheetStr) });
      freeSlotsByDraw.set(dk, list);
    }
  }
  for (const sk of m.freed) {
    occ.add(sk);
    if (freeSlotsByDraw) {
      const [date, time] = sk.split('|');
      const dk = `${date}|${normalizeTime(time)}`;
      const list = freeSlotsByDraw.get(dk) ?? [];
      freeSlotsByDraw.set(
        dk,
        list.filter((s) => `${s.date}|${normalizeTime(s.time)}|${s.sheetId}` !== sk)
      );
    }
  }
}

function mapVariancePenalty(counts: Map<string | number, number>, weight: number): number {
  if (counts.size === 0) return 0;
  let sum = 0;
  let sq = 0;
  let cnt = 0;
  for (const v of counts.values()) {
    sum += v;
    sq += v * v;
    cnt++;
  }
  const mean = sum / cnt;
  return (sq / cnt - mean * mean) * weight;
}

/** True when any team is double-booked on a draw, sheet, or ISO week. */
function scheduleHasHardConflicts(games: GeneratedGame[]): boolean {
  const drawTeams = new Map<string, Set<number>>();
  const weekTeams = new Map<string, Set<number>>();
  const occupied = new Set<string>();

  for (const g of games) {
    const time = normalizeTime(g.gameTime);
    const sk = `${g.gameDate}|${time}|${g.sheetId}`;
    if (occupied.has(sk)) return true;
    occupied.add(sk);

    const dk = `${g.gameDate}|${time}`;
    let ds = drawTeams.get(dk);
    if (!ds) {
      ds = new Set();
      drawTeams.set(dk, ds);
    }
    if (ds.has(g.team1Id) || ds.has(g.team2Id)) return true;
    ds.add(g.team1Id);
    ds.add(g.team2Id);

    const wk = playUnitKeyFromDate(g.gameDate);
    let ws = weekTeams.get(wk);
    if (!ws) {
      ws = new Set();
      weekTeams.set(wk, ws);
    }
    if (ws.has(g.team1Id) || ws.has(g.team2Id)) return true;
    ws.add(g.team1Id);
    ws.add(g.team2Id);
  }
  return false;
}

// ─── Main SA function ───────────────────────────────────────────────────────

/**
 * Optimise a schedule via simulated annealing.
 *
 * Starts from the greedy solution and iteratively perturbs it, accepting
 * improvements always and worse solutions with a probability that decreases
 * over time (cooling).  This allows the algorithm to escape local minima.
 *
 * Move types:
 *  - swap:     exchange slots of two random games (prefer same strategy)
 *  - relocate: move a game to a free sheet in an active, strategy-allowed draw
 *  - cycle:    rotate slots among three random games (prefer same strategy)
 *  - position: flip team1/team2 for a game
 */
function simulatedAnnealing(
  initialGames: GeneratedGame[],
  teamIds: number[],
  byeMap: Map<string, ScheduleByeRequest[]>,
  slotPool: GameSlot[],
  drawCapacities: Map<string, number>,
  numSheets: number,
  strategyAllowedMap: Map<string, Set<string>>,
  lockedGameIndices: Set<number>,
  hardByeByTeam: Map<number, Set<string>>,
  preferEarlyTeamIds: Set<number>,
  preferLateTeamIds: Set<number>,
  earlyDrawTimeByDate: Map<string, string>,
  lateDrawTimeByDate: Map<string, string>,
  rng: () => number,
  timeBudgetMs: number,
  earlyStopPatienceMs: number,
  reportProgress: (update: ProgressUpdate) => void
): GeneratedGame[] {
  const n = initialGames.length;
  if (n < 2 || timeBudgetMs <= 0) return initialGames;

  const games = initialGames.map((g) => ({ ...g }));

  const playUnitCache = new Map<string, string>();
  const getPlayUnit = (d: string): string => {
    let wk = playUnitCache.get(d);
    if (!wk) {
      wk = playUnitKeyFromDate(d);
      playUnitCache.set(d, wk);
    }
    return wk;
  };
  for (const s of slotPool) getPlayUnit(s.date);
  for (const g of games) getPlayUnit(g.gameDate);

  // Incremental occupancy maps for local conflict checks
  const drawTeams: DrawTeamMap = new Map();
  const playUnitTeams: WeekTeamMap = new Map();
  const removeTeamsFromMaps = (g: {
    gameDate: string;
    gameTime: string;
    team1Id: number;
    team2Id: number;
  }) => {
    const dk = `${g.gameDate}|${normalizeTime(g.gameTime)}`;
    drawTeams.get(dk)?.delete(g.team1Id);
    drawTeams.get(dk)?.delete(g.team2Id);
    const pu = getPlayUnit(g.gameDate);
    playUnitTeams.get(pu)?.delete(g.team1Id);
    playUnitTeams.get(pu)?.delete(g.team2Id);
  };
  const addTeamsToMaps = (g: {
    gameDate: string;
    gameTime: string;
    team1Id: number;
    team2Id: number;
  }): boolean => {
    const dk = `${g.gameDate}|${normalizeTime(g.gameTime)}`;
    let ds = drawTeams.get(dk);
    if (!ds) {
      ds = new Set();
      drawTeams.set(dk, ds);
    }
    if (ds.has(g.team1Id) || ds.has(g.team2Id)) return false;
    ds.add(g.team1Id);
    ds.add(g.team2Id);
    const pu = getPlayUnit(g.gameDate);
    let ps = playUnitTeams.get(pu);
    if (!ps) {
      ps = new Set();
      playUnitTeams.set(pu, ps);
    }
    if (ps.has(g.team1Id) || ps.has(g.team2Id)) {
      ds.delete(g.team1Id);
      ds.delete(g.team2Id);
      return false;
    }
    ps.add(g.team1Id);
    ps.add(g.team2Id);
    return true;
  };
  for (const g of games) {
    if (!addTeamsToMaps(g)) {
      // Greedy/repair should never hand SA a conflicting schedule; rebuild from
      // scratch would drop games. Fail closed by keeping maps best-effort.
    }
  }

  // Incremental scoring buffers
  const scPos = new Map<number, [number, number]>();
  const scDT = new Map<number, Map<string, number>>();
  const scSh = new Map<number, Map<number, number>>();
  const teamBalance = new Map<number, number>();
  const strategyPhaseMap = buildStrategyPhaseMap(strategyAllowedMap);
  const drawCountsByPhase = new Map<string, Map<string, number>>();
  for (const id of teamIds) {
    scPos.set(id, [0, 0]);
    scDT.set(id, new Map());
    scSh.set(id, new Map());
    teamBalance.set(id, 0);
  }
  for (const phaseId of new Set(strategyPhaseMap.values())) {
    drawCountsByPhase.set(phaseId, new Map());
  }

  const bumpCount = (map: Map<string | number, number>, key: string | number, delta: number) => {
    const next = (map.get(key) ?? 0) + delta;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  };

  const recomputeTeamBalance = (teamId: number) => {
    const [t1, t2] = scPos.get(teamId)!;
    const pos = (t1 - t2) ** 2 * WEIGHT_POSITION_BALANCE;
    const dtm = scDT.get(teamId)!;
    let dt = 0;
    if (!preferEarlyTeamIds.has(teamId) && !preferLateTeamIds.has(teamId)) {
      dt = mapVariancePenalty(dtm, WEIGHT_DRAW_TIME_BALANCE);
    }
    const sh = mapVariancePenalty(scSh.get(teamId)!, WEIGHT_SHEET_BALANCE);
    teamBalance.set(teamId, pos + dt + sh);
  };

  const gameSoftPlacement = (g: GeneratedGame): number =>
    byePenalty(g, byeMap) +
    preferDrawTimePenalty(
      g,
      preferEarlyTeamIds,
      preferLateTeamIds,
      earlyDrawTimeByDate,
      lateDrawTimeByDate
    );

  const applyGameCounts = (g: GeneratedGame, sign: 1 | -1) => {
    const time = normalizeTime(g.gameTime);
    scPos.get(g.team1Id)![0] += sign;
    scPos.get(g.team2Id)![1] += sign;
    bumpCount(scDT.get(g.team1Id)!, time, sign);
    bumpCount(scDT.get(g.team2Id)!, time, sign);
    bumpCount(scSh.get(g.team1Id)!, g.sheetId, sign);
    bumpCount(scSh.get(g.team2Id)!, g.sheetId, sign);
    const dk = `${g.gameDate}|${time}`;
    const allowed = strategyAllowedMap.get(g.strategyLocalId);
    if (allowed?.has(dk)) {
      const phaseId = strategyPhaseMap.get(g.strategyLocalId) ?? g.strategyLocalId;
      const counts = drawCountsByPhase.get(phaseId)!;
      bumpCount(counts, dk, sign);
    }
  };

  let placementSoft = 0;
  let balanceSoft = 0;
  let compactnessPart = 0;

  const recomputeCompactness = () => {
    let s = 0;
    for (const [, counts] of drawCountsByPhase) {
      s += compactnessScoreFromCounts(counts, drawCapacities, numSheets);
    }
    compactnessPart = s;
  };

  for (const g of games) {
    placementSoft += gameSoftPlacement(g);
    applyGameCounts(g, 1);
  }
  for (const id of teamIds) recomputeTeamBalance(id);
  for (const id of teamIds) balanceSoft += teamBalance.get(id)!;
  recomputeCompactness();

  const totalScoreNow = () => placementSoft + balanceSoft + compactnessPart;

  const occupied = new Set<string>();
  for (const g of games) {
    occupied.add(`${g.gameDate}|${normalizeTime(g.gameTime)}|${g.sheetId}`);
  }

  const freeSlotsByDraw = new Map<string, GameSlot[]>();
  for (const slot of slotPool) {
    const sk = `${slot.date}|${normalizeTime(slot.time)}|${slot.sheetId}`;
    if (occupied.has(sk)) continue;
    const dk = `${slot.date}|${normalizeTime(slot.time)}`;
    const list = freeSlotsByDraw.get(dk) ?? [];
    list.push({ date: slot.date, time: normalizeTime(slot.time), sheetId: slot.sheetId });
    freeSlotsByDraw.set(dk, list);
  }

  const roundGroupMap = new Map<string, RoundMoveGroup>();
  for (let index = 0; index < games.length; index++) {
    const game = games[index];
    if (!game.roundLocalId) continue;
    const group = roundGroupMap.get(game.roundLocalId) ?? {
      strategyLocalId: game.strategyLocalId,
      indices: [],
    };
    group.indices.push(index);
    roundGroupMap.set(game.roundLocalId, group);
  }
  const roundMoveGroups = [...roundGroupMap.values()].filter((group) => group.indices.length >= 2);

  let currentScore = totalScoreNow();
  const allByeRequests = [...byeMap.values()].flat();
  let currentByeFairness = createByeFairnessContext(allByeRequests, games, byeMap);
  let currentByeCoverage = getByeFairnessCoverage(currentByeFairness);
  let bestScore = currentScore;
  let bestByeCoverage = currentByeCoverage;
  let bestGames = games.map((g) => ({ ...g }));

  const p1Conflicts = [...currentByeFairness.p1ConflictCounts.values()].reduce(
    (sum, count) => sum + count,
    0
  );
  const p2Conflicts = [...currentByeFairness.p2ConflictCounts.values()].reduce(
    (sum, count) => sum + count,
    0
  );
  const annealableInitialScore =
    currentScore -
    p1Conflicts * WEIGHT_BYE_PRIORITY_1 -
    p2Conflicts * WEIGHT_BYE_PRIORITY_2;
  const T0 = Math.max(Math.abs(annealableInitialScore) * 0.05, 500);
  const TF = 0.01;
  const startTime = Date.now();
  let iterations = 0;
  let improved = 0;
  let lastReport = startTime;
  let lastImproveTime = startTime;
  const patienceMs = Math.max(0, earlyStopPatienceMs);

  while (true) {
    const now = Date.now();
    const elapsed = now - startTime;
    if (elapsed >= timeBudgetMs) break;
    if (patienceMs > 0 && now - lastImproveTime >= patienceMs) break;

    iterations++;
    const progress = elapsed / timeBudgetMs;
    const temp = T0 * Math.pow(TF / T0, progress);

    const r = rng();
    let move: SAMove | null;
    if (r < 0.18) {
      move = moveRoundSwap(games, roundMoveGroups, strategyAllowedMap, lockedGameIndices, rng);
    } else if (r < 0.43) {
      move = moveSwap(games, strategyAllowedMap, lockedGameIndices, rng);
    } else if (r < 0.58) {
      move = moveRelocate(
        games,
        freeSlotsByDraw,
        occupied,
        strategyAllowedMap,
        lockedGameIndices,
        rng
      );
    } else if (r < 0.82) {
      move = moveCycle(games, strategyAllowedMap, lockedGameIndices, rng);
    } else {
      move = movePosition(games, lockedGameIndices, rng);
    }
    if (!move) continue;

    const slotChanged =
      move.freed.length > 0 ||
      move.indices.length > 1 ||
      move.saved.some((s, i) => {
        const g = games[move!.indices[i]];
        return s.gameDate !== g.gameDate || s.gameTime !== g.gameTime || s.sheetId !== g.sheetId;
      });

    if (slotChanged) {
      for (const s of move.saved) removeTeamsFromMaps(s);
      const addedIdx: number[] = [];
      let conflict = false;
      for (const idx of move.indices) {
        if (!addTeamsToMaps(games[idx])) {
          conflict = true;
          break;
        }
        addedIdx.push(idx);
      }
      if (conflict) {
        // Only roll back teams we successfully added — removing a rejected
        // placement's teams from its target draw can delete *other* games'
        // occupancy and allow later double-booking.
        for (const idx of addedIdx) removeTeamsFromMaps(games[idx]);
        for (const s of move.saved) addTeamsToMaps(s);
        undoMove(games, move, occupied, freeSlotsByDraw);
        continue;
      }
    }

    if (
      !gamesRespectStrategySlots(games, move.indices, strategyAllowedMap) ||
      violatesHardByeDates(games, move.indices, hardByeByTeam)
    ) {
      if (slotChanged) {
        for (const idx of move.indices) removeTeamsFromMaps(games[idx]);
        for (const s of move.saved) addTeamsToMaps(s);
      }
      undoMove(games, move, occupied, freeSlotsByDraw);
      continue;
    }

    const touchedTeams = new Set<number>();
    const beforeGames: GeneratedGame[] = [];
    const afterGames: GeneratedGame[] = [];
    let placementDelta = 0;
    for (let i = 0; i < move.indices.length; i++) {
      const idx = move.indices[i];
      const before: GeneratedGame = {
        ...games[idx],
        gameDate: move.saved[i].gameDate,
        gameTime: move.saved[i].gameTime,
        sheetId: move.saved[i].sheetId,
        team1Id: move.saved[i].team1Id,
        team2Id: move.saved[i].team2Id,
      };
      const after = games[idx];
      beforeGames.push(before);
      afterGames.push(after);
      placementDelta -= gameSoftPlacement(before);
      placementDelta += gameSoftPlacement(after);
      applyGameCounts(before, -1);
      applyGameCounts(after, 1);
      touchedTeams.add(before.team1Id);
      touchedTeams.add(before.team2Id);
      touchedTeams.add(after.team1Id);
      touchedTeams.add(after.team2Id);
    }

    let balanceDelta = 0;
    for (const tid of touchedTeams) {
      balanceDelta -= teamBalance.get(tid) ?? 0;
      recomputeTeamBalance(tid);
      balanceDelta += teamBalance.get(tid) ?? 0;
    }

    const oldCompact = compactnessPart;
    recomputeCompactness();
    const compactDelta = compactnessPart - oldCompact;

    placementSoft += placementDelta;
    balanceSoft += balanceDelta;
    const newScore = currentScore + placementDelta + balanceDelta + compactDelta;
    const delta = newScore - currentScore;
    const candidateByeFairness = cloneByeFairnessContext(currentByeFairness);
    applyByeFairnessGames(candidateByeFairness, beforeGames, byeMap, -1);
    applyByeFairnessGames(candidateByeFairness, afterGames, byeMap, 1);
    const candidateByeCoverage = getByeFairnessCoverage(candidateByeFairness);
    const fairnessComparison = compareByeFairnessCoverage(
      candidateByeCoverage,
      currentByeCoverage
    );
    const acceptsByPriority =
      fairnessComparison < 0 ||
      (fairnessComparison === 0 &&
        (delta <= 0 ||
          rng() < Math.exp(-delta / Math.max(temp, 1e-9))));

    if (acceptsByPriority && !scheduleHasHardConflicts(games)) {
      currentScore = totalScoreNow();
      currentByeFairness = candidateByeFairness;
      currentByeCoverage = candidateByeCoverage;
      const bestFairnessComparison = compareByeFairnessCoverage(
        currentByeCoverage,
        bestByeCoverage
      );
      const beatsBest =
        bestFairnessComparison < 0 ||
        (bestFairnessComparison === 0 && currentScore < bestScore);
      if (beatsBest) {
        bestScore = currentScore;
        bestByeCoverage = currentByeCoverage;
        bestGames = games.map((g) => ({ ...g }));
        improved++;
        lastImproveTime = now;
      }
    } else {
      for (let i = 0; i < move.indices.length; i++) {
        const idx = move.indices[i];
        const before: GeneratedGame = {
          ...games[idx],
          gameDate: move.saved[i].gameDate,
          gameTime: move.saved[i].gameTime,
          sheetId: move.saved[i].sheetId,
          team1Id: move.saved[i].team1Id,
          team2Id: move.saved[i].team2Id,
        };
        const after = games[idx];
        applyGameCounts(after, -1);
        applyGameCounts(before, 1);
      }
      for (const tid of touchedTeams) recomputeTeamBalance(tid);
      placementSoft -= placementDelta;
      balanceSoft = 0;
      for (const id of teamIds) balanceSoft += teamBalance.get(id)!;
      if (slotChanged) {
        for (const idx of move.indices) removeTeamsFromMaps(games[idx]);
        for (const s of move.saved) addTeamsToMaps(s);
      }
      undoMove(games, move, occupied, freeSlotsByDraw);
      recomputeCompactness();
      currentScore = totalScoreNow();
    }

    if (now - lastReport >= 500) {
      lastReport = now;
      reportProgress({
        phase: 'Optimizing',
        percent: Math.min(99, 80 + Math.round(progress * 19)),
        message: `${improved} improvements, P1 ${countHonoredRequests(bestByeCoverage.p1)} honored across ${bestByeCoverage.p1[0] ?? 0} teams, penalty ${bestScore.toFixed(0)} (${(iterations / 1000).toFixed(0)}k iter · ${Math.round(elapsed / 1000)}s)`,
      });
    }
  }

  reportProgress({
    phase: 'Optimizing',
    percent: 99,
    message: `SA complete: ${improved} improvements, P1 ${countHonoredRequests(bestByeCoverage.p1)} honored across ${bestByeCoverage.p1[0] ?? 0} teams, best penalty ${bestScore.toFixed(0)} (${(iterations / 1000).toFixed(0)}k iterations)`,
  });

  if (scheduleHasHardConflicts(bestGames)) {
    // Fail closed: never return a double-booked schedule from SA.
    return initialGames.map((g) => ({ ...g, gameTime: normalizeTime(g.gameTime) }));
  }
  return bestGames.map((g) => ({ ...g, gameTime: normalizeTime(g.gameTime) }));
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Assign matchup rounds to concrete draw slots and optimize.
 *
 * Returns a ScheduleResult with generated games, unschedulable matchups,
 * per-team statistics, warnings, and the total score.
 */
export function assignAndOptimize(
  rounds: MatchupRound[],
  drawSlots: ScheduleDrawSlot[],
  strategies: ScheduleStrategy[],
  byeRequests: ScheduleByeRequest[],
  teamIds: number[],
  seed: number,
  timeBudgetMs: number,
  reportProgress: (update: ProgressUpdate) => void,
  hardConstraints: ScheduleHardConstraint[] = [],
  preferLateDrawTeamIds: number[] = [],
  preferEarlyDrawTeamIds: number[] = [],
  teamNamesById: Map<number, string> = new Map(),
  earlyStopPatienceMs?: number
): ScheduleResult {
  const rng = mulberry32(seed);
  const byeMap = buildByeMap(byeRequests);
  const assignmentByeFairness = createByeFairnessContext(
    byeRequests,
    [],
    byeMap
  );
  const hardByeByTeam = buildHardByeByTeam(hardConstraints);
  const preferLateTeamIds = new Set(preferLateDrawTeamIds);
  const preferEarlyTeamIds = new Set(preferEarlyDrawTeamIds);
  const slotPool = buildSlotPool(drawSlots, strategies);
  const warnings: ScheduleWarning[] = [];
  const teamLabel = (id: number) => teamNamesById.get(id) ?? `Team ${id}`;

  if (slotPool.length === 0) {
    warnings.push({
      severity: 'error',
      message: 'No available game slots. Check draw slots and sheet availability.',
    });
    return { games: [], unschedulable: [], teamStats: [], warnings, totalScore: 0 };
  }

  // Build a lookup from strategy localId -> allowed draw slot keys
  const strategyAllowedMap = new Map<string, Set<string>>();
  for (const s of strategies) {
    strategyAllowedMap.set(s.localId, strategyAllowedKeys(s));
  }

  // ─── Pre-compute draw capacities (available sheets per draw) ───────────
  const drawCapacities = new Map<string, number>();
  for (const ds of drawSlots) {
    const dk = `${ds.date}|${normalizeTime(ds.time)}`;
    const availableSheetCount = ds.sheets.filter((s) => s.isAvailable).length;
    drawCapacities.set(dk, (drawCapacities.get(dk) ?? 0) + availableSheetCount);
  }

  // Compute the number of sheets (max sheets per draw) for post-generation checks
  const numSheets = Math.max(...[...drawCapacities.values()], 1);

  // Tracking structures
  const drawTeams: DrawTeamMap = new Map();
  const weekTeams: WeekTeamMap = new Map();
  const occupiedSlots: SlotOccupied = new Set();
  const drawGameCounts = new Map<string, number>();
  const teamDrawTimeCounts = new Map<number, Map<string, number>>();
  const teamSheetCounts = new Map<number, Map<number, number>>();
  const teamPositionCounts = new Map<number, { asTeam1: number; asTeam2: number }>();

  for (const id of teamIds) {
    teamDrawTimeCounts.set(id, new Map());
    teamSheetCounts.set(id, new Map());
    teamPositionCounts.set(id, { asTeam1: 0, asTeam2: 0 });
  }

  const games: GeneratedGame[] = [];
  const unschedulable: UnschedulableMatchup[] = [];
  const lockedGameIndices = new Set<number>();
  /** Matchups already pinned by hard constraints: `${roundIndex}|${matchupIndex}`. */
  const consumedMatchups = new Set<string>();

  const totalMatchups = rounds.reduce((sum, r) => sum + r.matchups.length, 0);
  let assignedCount = 0;

  // ─── Pre-compute draw-key → play-unit (ISO week) mapping ───────────────
  const drawWeekMap = new Map<string, string>();
  for (const slot of slotPool) {
    const dk = drawKey(slot);
    if (!drawWeekMap.has(dk)) {
      drawWeekMap.set(dk, playUnitKeyFromDate(slot.date));
    }
  }
  const weekKeyForDate = (date: string): string => playUnitKeyFromDate(date);

  const { earlyByDate: earlyDrawTimeByDate, lateByDate: lateDrawTimeByDate } =
    buildEarlyLateDrawTimesByDate(drawWeekMap.keys());

  // Track which weeks already have at least one active draw.
  const activeWeeks = new Set<string>();

  // Indexed free sheets by draw key (Wave 3: avoid scanning full slot pool).
  const freeSlotsByDraw = new Map<string, GameSlot[]>();
  for (const slot of slotPool) {
    const dk = drawKey(slot);
    const list = freeSlotsByDraw.get(dk) ?? [];
    list.push(slot);
    freeSlotsByDraw.set(dk, list);
  }

  /**
   * Score every allowed free slot. P1 and P2 conflicts are compared before the
   * compactness tier, so an active draw cannot silently override a requested bye.
   */
  const findBestSlot = (
    matchup: Matchup,
    allowed: Set<string>
  ): { slot: GameSlot | null; score: CandidateScore | null } => {
    let bestSlot: GameSlot | null = null;
    let bestScore: CandidateScore | null = null;
    let bestTier = Infinity;
    for (const [dk, free] of freeSlotsByDraw) {
      if (free.length === 0) continue;
      if (!allowed.has(dk)) continue;
      const tier = drawGameCounts.has(dk) ? 0 : activeWeeks.has(drawWeekMap.get(dk) ?? '') ? 1 : 2;
      for (const slot of free) {
        const s = scoreCandidate(
          matchup,
          slot,
          drawTeams,
          weekTeams,
          occupiedSlots,
          drawGameCounts,
          teamDrawTimeCounts,
          teamSheetCounts,
          teamPositionCounts,
          byeMap,
          assignmentByeFairness,
          allowed,
          hardByeByTeam,
          preferEarlyTeamIds,
          preferLateTeamIds,
          earlyDrawTimeByDate,
          lateDrawTimeByDate,
          weekKeyForDate,
          rng
        );
        if (!s) continue;
        const fairnessComparison =
          bestScore == null
            ? -1
            : compareByeFairnessCoverage(s.byeCoverage, bestScore.byeCoverage);
        const better =
          bestScore == null ||
          fairnessComparison < 0 ||
          (fairnessComparison === 0 &&
            (tier < bestTier ||
              (tier === bestTier && s.softPenalty < bestScore.softPenalty)));
        if (better) {
          bestScore = s;
          bestTier = tier;
          bestSlot = slot;
        }
      }
    }
    return { slot: bestSlot, score: bestScore };
  };

  /** Helper: commit a game assignment and update all tracking structures. */
  const commitAssignment = (matchup: Matchup, bestSlot: GameSlot) => {
    const [t1, t2] = optimizePositions(matchup, teamPositionCounts);
    const game: GeneratedGame = {
      team1Id: t1,
      team2Id: t2,
      gameDate: bestSlot.date,
      gameTime: normalizeTime(bestSlot.time),
      sheetId: bestSlot.sheetId,
      strategyLocalId: matchup.strategyLocalId,
      roundLocalId: matchup.roundLocalId,
    };
    games.push(game);
    applyByeFairnessGames(assignmentByeFairness, [game], byeMap, 1);

    const dk = drawKey(bestSlot);
    if (!drawTeams.has(dk)) drawTeams.set(dk, new Set());
    drawTeams.get(dk)!.add(t1);
    drawTeams.get(dk)!.add(t2);

    drawGameCounts.set(dk, (drawGameCounts.get(dk) ?? 0) + 1);

    const wk = drawWeekMap.get(dk) ?? playUnitKeyFromDate(bestSlot.date);
    activeWeeks.add(wk);
    if (!weekTeams.has(wk)) weekTeams.set(wk, new Set());
    weekTeams.get(wk)!.add(t1);
    weekTeams.get(wk)!.add(t2);

    occupiedSlots.add(slotKey(bestSlot));
    const free = freeSlotsByDraw.get(dk) ?? [];
    freeSlotsByDraw.set(
      dk,
      free.filter((s) => slotKey(s) !== slotKey(bestSlot))
    );

    const dtc1 = teamDrawTimeCounts.get(t1)!;
    dtc1.set(bestSlot.time, (dtc1.get(bestSlot.time) ?? 0) + 1);
    const dtc2 = teamDrawTimeCounts.get(t2)!;
    dtc2.set(bestSlot.time, (dtc2.get(bestSlot.time) ?? 0) + 1);

    const sc1 = teamSheetCounts.get(t1)!;
    sc1.set(bestSlot.sheetId, (sc1.get(bestSlot.sheetId) ?? 0) + 1);
    const sc2 = teamSheetCounts.get(t2)!;
    sc2.set(bestSlot.sheetId, (sc2.get(bestSlot.sheetId) ?? 0) + 1);

    const pc1 = teamPositionCounts.get(t1)!;
    pc1.asTeam1++;
    const pc2 = teamPositionCounts.get(t2)!;
    pc2.asTeam2++;
  };

  const findBestRoundPlacement = (
    roundMatchups: Matchup[]
  ): Array<{ matchup: Matchup; slot: GameSlot }> | null => {
    if (roundMatchups.length === 0) return [];
    const allowed = strategyAllowedMap.get(roundMatchups[0].strategyLocalId) ?? new Set<string>();
    const allowedWeeks = new Set<string>();
    for (const dk of allowed) {
      const week = drawWeekMap.get(dk);
      if (week) allowedWeeks.add(week);
    }

    let bestPlacement: Array<{ matchup: Matchup; slot: GameSlot }> | null = null;
    let bestScore: CandidateScore | null = null;
    let bestTier = Infinity;

    for (const week of allowedWeeks) {
      const availableSlots: GameSlot[] = [];
      for (const [dk, free] of freeSlotsByDraw) {
        if (!allowed.has(dk) || drawWeekMap.get(dk) !== week) continue;
        availableSlots.push(...free);
      }
      if (availableSlots.length < roundMatchups.length) continue;

      const unassigned = [...roundMatchups];
      const remainingSlots = [...availableSlots];
      const placement: Array<{ matchup: Matchup; slot: GameSlot }> = [];
      const roundByeFairness = cloneByeFairnessContext(assignmentByeFairness);
      let aggregateSoftPenalty = 0;
      let valid = true;

      while (unassigned.length > 0) {
        let selectedMatchupIndex = -1;
        let selectedSlotIndex = -1;
        let selectedScore: CandidateScore | null = null;
        let selectedOptionCount = Infinity;

        for (let matchupIndex = 0; matchupIndex < unassigned.length; matchupIndex++) {
          const matchup = unassigned[matchupIndex];
          let matchupBestSlotIndex = -1;
          let matchupBestScore: CandidateScore | null = null;
          let optionCount = 0;

          for (let slotIndex = 0; slotIndex < remainingSlots.length; slotIndex++) {
            const slot = remainingSlots[slotIndex];
            const score = scoreCandidate(
              matchup,
              slot,
              drawTeams,
              weekTeams,
              occupiedSlots,
              drawGameCounts,
              teamDrawTimeCounts,
              teamSheetCounts,
              teamPositionCounts,
              byeMap,
              roundByeFairness,
              allowed,
              hardByeByTeam,
              preferEarlyTeamIds,
              preferLateTeamIds,
              earlyDrawTimeByDate,
              lateDrawTimeByDate,
              weekKeyForDate,
              rng
            );
            if (!score) continue;
            optionCount++;
            if (matchupBestScore == null || compareCandidateScores(score, matchupBestScore) < 0) {
              matchupBestScore = score;
              matchupBestSlotIndex = slotIndex;
            }
          }

          if (
            matchupBestScore &&
            (optionCount < selectedOptionCount ||
              (optionCount === selectedOptionCount &&
                (selectedScore == null ||
                  compareCandidateScores(matchupBestScore, selectedScore) < 0)))
          ) {
            selectedMatchupIndex = matchupIndex;
            selectedSlotIndex = matchupBestSlotIndex;
            selectedScore = matchupBestScore;
            selectedOptionCount = optionCount;
          }
        }

        if (selectedMatchupIndex < 0 || selectedSlotIndex < 0 || selectedScore == null) {
          valid = false;
          break;
        }

        const [matchup] = unassigned.splice(selectedMatchupIndex, 1);
        const [slot] = remainingSlots.splice(selectedSlotIndex, 1);
        placement.push({ matchup, slot });
        aggregateSoftPenalty += selectedScore.softPenalty;
        applyByeFairnessGames(
          roundByeFairness,
          [
            {
              team1Id: matchup.team1Id,
              team2Id: matchup.team2Id,
              gameDate: slot.date,
              gameTime: slot.time,
              sheetId: slot.sheetId,
              strategyLocalId: matchup.strategyLocalId,
              roundLocalId: matchup.roundLocalId,
            },
          ],
          byeMap,
          1
        );
      }

      if (!valid) continue;
      const aggregate: CandidateScore = {
        byeCoverage: getByeFairnessCoverage(roundByeFairness),
        softPenalty: aggregateSoftPenalty,
      };
      const tier = activeWeeks.has(week) ? 0 : 1;
      const fairnessComparison =
        bestScore == null
          ? -1
          : compareByeFairnessCoverage(aggregate.byeCoverage, bestScore.byeCoverage);
      const better =
        bestScore == null ||
        fairnessComparison < 0 ||
        (fairnessComparison === 0 &&
          (tier < bestTier ||
            (tier === bestTier &&
              aggregate.softPenalty < bestScore.softPenalty)));
      if (better) {
        bestPlacement = placement;
        bestScore = aggregate;
        bestTier = tier;
      }
    }

    return bestPlacement;
  };

  // ─── Pin hard match-up constraints (only when pairing already exists) ──
  for (const hc of hardConstraints) {
    if (hc.type !== 'matchup') continue;

    const targetPair = unorderedPairKey(hc.team1Id, hc.team2Id);
    let found: { ri: number; mi: number; matchup: Matchup } | null = null;
    for (let ri = 0; ri < rounds.length && !found; ri++) {
      for (let mi = 0; mi < rounds[ri].matchups.length; mi++) {
        const key = `${ri}|${mi}`;
        if (consumedMatchups.has(key)) continue;
        const m = rounds[ri].matchups[mi];
        if (unorderedPairKey(m.team1Id, m.team2Id) !== targetPair) continue;
        found = { ri, mi, matchup: m };
        break;
      }
    }

    if (!found) {
      warnings.push({
        severity: 'warning',
        message: `Hard match-up constraint ignored: pairing ${teamLabel(hc.team1Id)} vs ${teamLabel(hc.team2Id)} is not in the generated rounds.`,
      });
      continue;
    }

    const allowed = strategyAllowedMap.get(found.matchup.strategyLocalId) ?? new Set<string>();
    const dk = `${hc.drawDate}|${normalizeTime(hc.drawTime)}`;
    if (!allowed.has(dk)) {
      warnings.push({
        severity: 'warning',
        message: `Hard match-up constraint ignored: ${dk} is outside that strategy's allowed draw slots.`,
      });
      continue;
    }

    if (
      teamHasHardBye(hardByeByTeam, found.matchup.team1Id, hc.drawDate) ||
      teamHasHardBye(hardByeByTeam, found.matchup.team2Id, hc.drawDate)
    ) {
      warnings.push({
        severity: 'warning',
        message: `Hard match-up constraint ignored: conflicts with a hard bye on ${hc.drawDate}.`,
      });
      continue;
    }

    const candidates = slotPool.filter(
      (s) =>
        s.date === hc.drawDate &&
        normalizeTime(s.time) === normalizeTime(hc.drawTime) &&
        !occupiedSlots.has(slotKey(s))
    );
    let slot: GameSlot | undefined;
    if (hc.sheetId != null) {
      slot = candidates.find((s) => s.sheetId === hc.sheetId);
    } else {
      slot = candidates[0];
    }

    if (!slot) {
      warnings.push({
        severity: 'warning',
        message: `Hard match-up constraint ignored: no free sheet at ${formatDrawLabel(hc.drawDate, hc.drawTime)}.`,
      });
      continue;
    }

    // Validate hard conflicts without soft scoring
    const conflictScore = scoreCandidate(
      found.matchup,
      slot,
      drawTeams,
      weekTeams,
      occupiedSlots,
      drawGameCounts,
      teamDrawTimeCounts,
      teamSheetCounts,
      teamPositionCounts,
      byeMap,
      assignmentByeFairness,
      allowed,
      hardByeByTeam,
      preferEarlyTeamIds,
      preferLateTeamIds,
      earlyDrawTimeByDate,
      lateDrawTimeByDate,
      weekKeyForDate,
      () => 0
    );
    if (conflictScore == null) {
      warnings.push({
        severity: 'warning',
        message: `Hard match-up constraint ignored: ${formatDrawLabel(hc.drawDate, hc.drawTime)} conflicts with an existing assignment.`,
      });
      continue;
    }

    consumedMatchups.add(`${found.ri}|${found.mi}`);
    commitAssignment(found.matchup, slot);
    lockedGameIndices.add(games.length - 1);
  }

  // ─── Priority-aware round assignment ──────────────────────────────────
  // Keep generated rounds intact when possible. This preserves the natural
  // once-per-week unit and lets P1/P2 select which team receives each bye.
  for (let ri = 0; ri < rounds.length; ri++) {
    const remainingMatchups = rounds[ri].matchups.filter(
      (_matchup, mi) => !consumedMatchups.has(`${ri}|${mi}`)
    );
    const isIntactRound = remainingMatchups.length === rounds[ri].matchups.length;
    const roundPlacement = isIntactRound ? findBestRoundPlacement(remainingMatchups) : null;

    if (roundPlacement) {
      for (const { matchup, slot } of roundPlacement) {
        assignedCount++;
        commitAssignment(matchup, slot);
      }
      reportProgress({
        phase: 'Assigning rounds',
        percent: Math.round((assignedCount / Math.max(totalMatchups, 1)) * 80),
        message: `${assignedCount}/${totalMatchups} matchups`,
      });
      continue;
    }

    // Hard-pinned or unusually constrained partial rounds fall back to
    // individual placement and the repair pass below.
    for (const matchup of remainingMatchups) {
      assignedCount++;

      if (assignedCount % 10 === 0) {
        reportProgress({
          phase: 'Assigning slots',
          percent: Math.round((assignedCount / Math.max(totalMatchups, 1)) * 80),
          message: `${assignedCount}/${totalMatchups} matchups`,
        });
      }

      const allowed = strategyAllowedMap.get(matchup.strategyLocalId) ?? new Set<string>();
      const { slot: bestSlot } = findBestSlot(matchup, allowed);

      if (bestSlot == null) {
        unschedulable.push({
          team1Id: matchup.team1Id,
          team2Id: matchup.team2Id,
          strategyLocalId: matchup.strategyLocalId,
          roundLocalId: matchup.roundLocalId,
          reason: 'No available slot without conflicts.',
        });
        continue;
      }

      commitAssignment(matchup, bestSlot);
    }
  }

  // ─── Repair pass: retry unschedulable, then bump-relocate blockers ─────
  const uncommitByIndex = (index: number): GeneratedGame => {
    const g = games[index];
    applyByeFairnessGames(assignmentByeFairness, [g], byeMap, -1);
    const dk = `${g.gameDate}|${normalizeTime(g.gameTime)}`;
    drawTeams.get(dk)?.delete(g.team1Id);
    drawTeams.get(dk)?.delete(g.team2Id);
    const nextCount = (drawGameCounts.get(dk) ?? 1) - 1;
    if (nextCount <= 0) drawGameCounts.delete(dk);
    else drawGameCounts.set(dk, nextCount);

    const wk = playUnitKeyFromDate(g.gameDate);
    weekTeams.get(wk)?.delete(g.team1Id);
    weekTeams.get(wk)?.delete(g.team2Id);

    occupiedSlots.delete(`${g.gameDate}|${normalizeTime(g.gameTime)}|${g.sheetId}`);
    const free = freeSlotsByDraw.get(dk) ?? [];
    free.push({
      date: g.gameDate,
      time: normalizeTime(g.gameTime),
      sheetId: g.sheetId,
    });
    freeSlotsByDraw.set(dk, free);

    const dtc1 = teamDrawTimeCounts.get(g.team1Id);
    if (dtc1) {
      const c = (dtc1.get(g.gameTime) ?? 1) - 1;
      if (c <= 0) dtc1.delete(g.gameTime);
      else dtc1.set(g.gameTime, c);
    }
    const dtc2 = teamDrawTimeCounts.get(g.team2Id);
    if (dtc2) {
      const c = (dtc2.get(g.gameTime) ?? 1) - 1;
      if (c <= 0) dtc2.delete(g.gameTime);
      else dtc2.set(g.gameTime, c);
    }
    const sc1 = teamSheetCounts.get(g.team1Id);
    if (sc1) {
      const c = (sc1.get(g.sheetId) ?? 1) - 1;
      if (c <= 0) sc1.delete(g.sheetId);
      else sc1.set(g.sheetId, c);
    }
    const sc2 = teamSheetCounts.get(g.team2Id);
    if (sc2) {
      const c = (sc2.get(g.sheetId) ?? 1) - 1;
      if (c <= 0) sc2.delete(g.sheetId);
      else sc2.set(g.sheetId, c);
    }
    const pc1 = teamPositionCounts.get(g.team1Id);
    if (pc1) pc1.asTeam1 = Math.max(0, pc1.asTeam1 - 1);
    const pc2 = teamPositionCounts.get(g.team2Id);
    if (pc2) pc2.asTeam2 = Math.max(0, pc2.asTeam2 - 1);

    games.splice(index, 1);
    const nextLocked = new Set<number>();
    for (const li of lockedGameIndices) {
      if (li === index) continue;
      nextLocked.add(li > index ? li - 1 : li);
    }
    lockedGameIndices.clear();
    for (const li of nextLocked) lockedGameIndices.add(li);
    return g;
  };

  /** Commit an already-positioned game without reordering team1/team2. */
  const commitExactGame = (g: GeneratedGame) => {
    const normalized: GeneratedGame = {
      ...g,
      gameTime: normalizeTime(g.gameTime),
    };
    games.push(normalized);
    applyByeFairnessGames(assignmentByeFairness, [normalized], byeMap, 1);
    const dk = `${normalized.gameDate}|${normalized.gameTime}`;
    if (!drawTeams.has(dk)) drawTeams.set(dk, new Set());
    drawTeams.get(dk)!.add(normalized.team1Id);
    drawTeams.get(dk)!.add(normalized.team2Id);
    drawGameCounts.set(dk, (drawGameCounts.get(dk) ?? 0) + 1);
    const wk = playUnitKeyFromDate(normalized.gameDate);
    activeWeeks.add(wk);
    if (!weekTeams.has(wk)) weekTeams.set(wk, new Set());
    weekTeams.get(wk)!.add(normalized.team1Id);
    weekTeams.get(wk)!.add(normalized.team2Id);
    occupiedSlots.add(`${normalized.gameDate}|${normalized.gameTime}|${normalized.sheetId}`);
    const free = freeSlotsByDraw.get(dk) ?? [];
    freeSlotsByDraw.set(
      dk,
      free.filter(
        (s) =>
          !(
            s.date === normalized.gameDate &&
            normalizeTime(s.time) === normalized.gameTime &&
            s.sheetId === normalized.sheetId
          )
      )
    );
    const dtc1 = teamDrawTimeCounts.get(normalized.team1Id)!;
    dtc1.set(normalized.gameTime, (dtc1.get(normalized.gameTime) ?? 0) + 1);
    const dtc2 = teamDrawTimeCounts.get(normalized.team2Id)!;
    dtc2.set(normalized.gameTime, (dtc2.get(normalized.gameTime) ?? 0) + 1);
    const sc1 = teamSheetCounts.get(normalized.team1Id)!;
    sc1.set(normalized.sheetId, (sc1.get(normalized.sheetId) ?? 0) + 1);
    const sc2 = teamSheetCounts.get(normalized.team2Id)!;
    sc2.set(normalized.sheetId, (sc2.get(normalized.sheetId) ?? 0) + 1);
    teamPositionCounts.get(normalized.team1Id)!.asTeam1++;
    teamPositionCounts.get(normalized.team2Id)!.asTeam2++;
  };

  const tryPlaceMatchup = (matchup: Matchup): boolean => {
    const allowed = strategyAllowedMap.get(matchup.strategyLocalId) ?? new Set<string>();
    const { slot: bestSlot } = findBestSlot(matchup, allowed);
    if (bestSlot == null) return false;
    commitAssignment(matchup, bestSlot);
    return true;
  };

  if (unschedulable.length > 0) {
    reportProgress({
      phase: 'Repairing',
      percent: 78,
      message: `Retrying ${unschedulable.length} unschedulable matchup${unschedulable.length === 1 ? '' : 's'}...`,
    });
    const still: UnschedulableMatchup[] = [];
    for (const u of unschedulable) {
      const matchup: Matchup = {
        team1Id: u.team1Id,
        team2Id: u.team2Id,
        strategyLocalId: u.strategyLocalId,
        roundLocalId: u.roundLocalId,
      };
      if (tryPlaceMatchup(matchup)) continue;

      const allowed = strategyAllowedMap.get(matchup.strategyLocalId) ?? new Set<string>();
      let repaired = false;
      const candidateDraws = [...allowed].filter(
        (dk) => (freeSlotsByDraw.get(dk) ?? []).length > 0
      );

      for (const dk of candidateDraws) {
        if (repaired) break;
        const date = dk.split('|')[0];
        const blockerIdxs: number[] = [];
        for (let i = 0; i < games.length; i++) {
          if (lockedGameIndices.has(i)) continue;
          const g = games[i];
          if (g.gameDate !== date) continue;
          const involves =
            g.team1Id === matchup.team1Id ||
            g.team2Id === matchup.team1Id ||
            g.team1Id === matchup.team2Id ||
            g.team2Id === matchup.team2Id;
          if (involves) blockerIdxs.push(i);
        }
        const uniqueBlockers = [...new Set(blockerIdxs)].sort((a, b) => b - a);
        if (uniqueBlockers.length === 0 || uniqueBlockers.length > 2) continue;

        const baselineLen = games.length - uniqueBlockers.length;
        const removed = uniqueBlockers.map((bi) => uncommitByIndex(bi));

        let ok = true;
        for (const g of removed) {
          const m: Matchup = {
            team1Id: g.team1Id,
            team2Id: g.team2Id,
            strategyLocalId: g.strategyLocalId,
            roundLocalId: g.roundLocalId,
          };
          if (!tryPlaceMatchup(m)) {
            ok = false;
            break;
          }
        }
        if (ok) ok = tryPlaceMatchup(matchup);

        if (ok) {
          repaired = true;
        } else {
          while (games.length > baselineLen) {
            uncommitByIndex(games.length - 1);
          }
          for (const g of removed) {
            commitExactGame(g);
          }
        }
      }

      if (!repaired) still.push(u);
    }
    unschedulable.length = 0;
    unschedulable.push(...still);
  }

  // Phase 3: simulated annealing
  const patience = earlyStopPatienceMs ?? Math.max(2_000, Math.round(timeBudgetMs * 0.15));
  reportProgress({ phase: 'Optimizing', percent: 80, message: 'Starting simulated annealing...' });
  const optimized = simulatedAnnealing(
    games,
    teamIds,
    byeMap,
    slotPool,
    drawCapacities,
    numSheets,
    strategyAllowedMap,
    lockedGameIndices,
    hardByeByTeam,
    preferEarlyTeamIds,
    preferLateTeamIds,
    earlyDrawTimeByDate,
    lateDrawTimeByDate,
    rng,
    timeBudgetMs,
    patience,
    reportProgress
  );

  if (scheduleHasHardConflicts(optimized)) {
    warnings.push({
      severity: 'error',
      message:
        'Schedule contains a hard conflict (team double-booked on a draw, sheet, or week). Please regenerate.',
    });
  }

  const totalScore =
    totalScheduleScore(optimized, teamIds, byeMap, {
      preferEarlyTeamIds,
      preferLateTeamIds,
      earlyDrawTimeByDate,
      lateDrawTimeByDate,
    }) + partitionCompactnessScore(optimized, drawCapacities, numSheets, strategyAllowedMap);
  const teamStats = computeTeamStats(optimized, teamIds, byeMap);

  if (unschedulable.length > 0) {
    warnings.push({
      severity: 'warning',
      message: `${unschedulable.length} matchup${unschedulable.length === 1 ? '' : 's'} could not be scheduled due to slot constraints.`,
    });
  }

  // ─── Post-generation validation: per-calendar-phase compactness ────────
  const validationPhaseMap = buildStrategyPhaseMap(strategyAllowedMap);
  const validationAllowedByPhase = new Map<string, Set<string>>();
  const validationStrategiesByPhase = new Map<string, ScheduleStrategy[]>();
  for (const strategy of strategies) {
    const phaseId = validationPhaseMap.get(strategy.localId) ?? strategy.localId;
    const allowed = validationAllowedByPhase.get(phaseId) ?? new Set<string>();
    for (const drawSlotKey of strategyAllowedMap.get(strategy.localId) ?? []) {
      allowed.add(drawSlotKey);
    }
    validationAllowedByPhase.set(phaseId, allowed);
    const phaseStrategies = validationStrategiesByPhase.get(phaseId) ?? [];
    phaseStrategies.push(strategy);
    validationStrategiesByPhase.set(phaseId, phaseStrategies);
  }

  for (const [phaseId, allowed] of validationAllowedByPhase) {
    const phaseGames = optimized.filter(
      (game) => (validationPhaseMap.get(game.strategyLocalId) ?? game.strategyLocalId) === phaseId
    );
    if (phaseGames.length === 0) continue;

    const drawCounts = new Map<string, number>();
    for (const g of phaseGames) {
      const fdk = `${g.gameDate}|${g.gameTime}`;
      if (!allowed.has(fdk)) continue;
      drawCounts.set(fdk, (drawCounts.get(fdk) ?? 0) + 1);
    }
    const scheduledInPartition = [...drawCounts.values()].reduce((s, n) => s + n, 0);
    const targetDrawCount = Math.ceil(scheduledInPartition / numSheets);
    const actualDrawsUsed = drawCounts.size;

    let totalEmptySheets = 0;
    let drawsWithMultipleEmpties = 0;
    for (const [fdk, gamesInDraw] of drawCounts) {
      const capacity = drawCapacities.get(fdk) ?? numSheets;
      const empties = capacity - gamesInDraw;
      if (empties > 0) totalEmptySheets += empties;
      if (empties > 1) drawsWithMultipleEmpties++;
    }

    const phaseStrategies = validationStrategiesByPhase.get(phaseId) ?? [];
    const phaseLabel = phaseStrategies
      .map((strategy) => `priority ${strategy.priority} ${strategy.pairingMode}`)
      .join(', ');

    if (actualDrawsUsed > targetDrawCount) {
      warnings.push({
        severity: 'warning',
        message: `Calendar phase ${phaseLabel} uses ${actualDrawsUsed} draws but the target is ${targetDrawCount} (${scheduledInPartition} games ÷ ${numSheets} sheets).`,
      });
    }
    if (drawsWithMultipleEmpties > 0) {
      warnings.push({
        severity: 'warning',
        message: `Calendar phase ${phaseLabel}: ${drawsWithMultipleEmpties} draw${drawsWithMultipleEmpties === 1 ? ' has' : 's have'} more than 1 empty sheet.`,
      });
    }
    if (totalEmptySheets >= numSheets) {
      warnings.push({
        severity: 'warning',
        message: `Calendar phase ${phaseLabel}: total empty sheets is ${totalEmptySheets} (≥ ${numSheets}), so fewer draws may have been possible within that phase's slots.`,
      });
    }
  }

  // Check for significant imbalances
  for (const ts of teamStats) {
    const label = teamLabel(ts.teamId);
    const dtValues = Object.values(ts.drawTimeCounts);
    if (dtValues.length > 1) {
      const maxDt = Math.max(...dtValues);
      const minDt = Math.min(...dtValues);
      if (maxDt - minDt > 2) {
        warnings.push({
          severity: 'info',
          message: `${label} has a draw time spread of ${minDt}-${maxDt} games.`,
        });
      }
    }
    if (ts.byeConflicts.length > 0) {
      const highPriority = ts.byeConflicts.filter((c) => c.priority <= 2);
      if (highPriority.length > 0) {
        warnings.push({
          severity: 'warning',
          message: `${label} has ${highPriority.length} high-priority bye conflict${highPriority.length === 1 ? '' : 's'}.`,
        });
      }
    }
  }

  reportProgress({ phase: 'Complete', percent: 100, message: 'Schedule generated.' });

  return {
    games: optimized,
    unschedulable,
    teamStats,
    warnings,
    totalScore,
  };
}

function formatDrawLabel(date: string, time: string): string {
  return `${date} ${time}`;
}
