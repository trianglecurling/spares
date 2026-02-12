import type { MatchupRound } from './generateMatchups';
import type {
  GeneratedGame,
  Matchup,
  ProgressUpdate,
  ScheduleByeRequest,
  ScheduleDrawSlot,
  ScheduleResult,
  ScheduleStrategy,
  ScheduleWarning,
  UnschedulableMatchup,
} from './types';
import {
  buildByeMap,
  byePenalty,
  compactnessScore,
  computeTeamStats,
  totalScheduleScore,
  WEIGHT_COMPACTNESS_EXCESS_EMPTIES,
  WEIGHT_COMPACTNESS_EXTRA_DRAW,
  WEIGHT_COMPACTNESS_MULTI_EMPTY,
  WEIGHT_DRAW_FILL_BALANCE,
  WEIGHT_DRAW_TIME_BALANCE,
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
    a = (a + 0x6D2B79F5) | 0;
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
function buildSlotPool(
  drawSlots: ScheduleDrawSlot[],
  strategies: ScheduleStrategy[],
): GameSlot[] {
  // Union of all draw slot keys across strategies
  const allowedKeys = new Set<string>();
  for (const s of strategies) {
    for (const key of s.drawSlotKeys) {
      allowedKeys.add(key);
    }
  }

  const slots: GameSlot[] = [];
  for (const ds of drawSlots) {
    const key = `${ds.date}|${ds.time}`;
    if (!allowedKeys.has(key)) continue;
    for (const sheet of ds.sheets) {
      if (sheet.isAvailable) {
        slots.push({ date: ds.date, time: ds.time, sheetId: sheet.id });
      }
    }
  }

  return slots;
}

/**
 * Get the set of draw slot keys that a specific strategy is allowed to use.
 */
function strategyAllowedKeys(strategy: ScheduleStrategy): Set<string> {
  return new Set(strategy.drawSlotKeys);
}

// ─── Week grouping ──────────────────────────────────────────────────────────

/**
 * Compute an ISO-week key for a date string (YYYY-MM-DD).
 * Returns the Monday of the week as "YYYY-MM-DD" so that all dates in
 * the same Mon-Sun week share the same key.
 */
function weekKeyFromDate(dateStr: string): string {
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

// ─── Greedy slot assignment (Phase 2) ───────────────────────────────────────

/** Tracks which teams are already scheduled per draw (date|time). */
type DrawTeamMap = Map<string, Set<number>>;

/** Tracks which teams are already scheduled per week (Monday date key). */
type WeekTeamMap = Map<string, Set<number>>;

/** Tracks which slots have been taken. */
type SlotOccupied = Set<string>; // "date|time|sheetId"

function slotKey(s: GameSlot): string {
  return `${s.date}|${s.time}|${s.sheetId}`;
}

function drawKey(s: GameSlot): string {
  return `${s.date}|${s.time}`;
}

/**
 * Score a candidate assignment of a matchup to a slot. Lower is better.
 * Returns Infinity if the assignment is invalid (hard constraint violation).
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
  strategyAllowed: Set<string>,
  rng: () => number,
): number {
  // Check strategy draw slot allowance
  const dk = drawKey(slot);
  if (!strategyAllowed.has(dk)) return Infinity;

  // Hard: slot already taken
  if (occupiedSlots.has(slotKey(slot))) return Infinity;

  // Hard: team already playing in this draw
  const teamsInDraw = drawTeams.get(dk);
  if (teamsInDraw) {
    if (teamsInDraw.has(matchup.team1Id) || teamsInDraw.has(matchup.team2Id)) {
      return Infinity;
    }
  }

  // Hard: team already playing this week (a team can play at most once per week)
  const wk = weekKeyFromDate(slot.date);
  const teamsInWeek = weekTeams.get(wk);
  if (teamsInWeek) {
    if (teamsInWeek.has(matchup.team1Id) || teamsInWeek.has(matchup.team2Id)) {
      return Infinity;
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
  };
  score += byePenalty(candidateGame, byeMap);

  // #6: Draw time balance – penalize draw times where these teams already play often
  for (const teamId of [matchup.team1Id, matchup.team2Id]) {
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

  return score;
}

/**
 * Decide whether to swap team1/team2 positions for a matchup to improve
 * position balance. Returns [team1Id, team2Id] in the optimal order.
 */
function optimizePositions(
  matchup: Matchup,
  teamPositionCounts: Map<number, { asTeam1: number; asTeam2: number }>,
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

/** Swap the date/time/sheet of two random games. */
function moveSwap(games: GeneratedGame[], rng: () => number): SAMove {
  const n = games.length;
  const i = Math.floor(rng() * n);
  let j: number;
  do {
    j = Math.floor(rng() * n);
  } while (j === i);
  const si = snap(games[i]);
  const sj = snap(games[j]);
  games[i] = { ...games[i], gameDate: sj.gameDate, gameTime: sj.gameTime, sheetId: sj.sheetId };
  games[j] = { ...games[j], gameDate: si.gameDate, gameTime: si.gameTime, sheetId: si.sheetId };
  return { indices: [i, j], saved: [si, sj], freed: [], taken: [] };
}

/** Move a random game to a random empty slot within an already-active draw. */
function moveRelocate(
  games: GeneratedGame[],
  pool: GameSlot[],
  occ: Set<string>,
  activeDrawKeys: Set<string>,
  rng: () => number,
): SAMove | null {
  const idx = Math.floor(rng() * games.length);
  for (let a = 0; a < 30; a++) {
    const c = pool[Math.floor(rng() * pool.length)];
    const sk = `${c.date}|${c.time}|${c.sheetId}`;
    if (occ.has(sk)) continue;
    // Only allow relocation to draws that were used by the greedy phase.
    // This prevents SA from scattering games across more draws than necessary.
    const dk = `${c.date}|${c.time}`;
    if (!activeDrawKeys.has(dk)) continue;
    const old = snap(games[idx]);
    const oldSk = `${old.gameDate}|${old.gameTime}|${old.sheetId}`;
    games[idx] = { ...games[idx], gameDate: c.date, gameTime: c.time, sheetId: c.sheetId };
    occ.delete(oldSk);
    occ.add(sk);
    return { indices: [idx], saved: [old], freed: [oldSk], taken: [sk] };
  }
  return null;
}

/** Rotate the slots of three random games (i←k, j←i, k←j). */
function moveCycle(games: GeneratedGame[], rng: () => number): SAMove | null {
  const n = games.length;
  if (n < 3) return null;
  const i = Math.floor(rng() * n);
  let j: number;
  do {
    j = Math.floor(rng() * n);
  } while (j === i);
  let k: number;
  do {
    k = Math.floor(rng() * n);
  } while (k === i || k === j);
  const si = snap(games[i]);
  const sj = snap(games[j]);
  const sk = snap(games[k]);
  games[i] = { ...games[i], gameDate: sk.gameDate, gameTime: sk.gameTime, sheetId: sk.sheetId };
  games[j] = { ...games[j], gameDate: si.gameDate, gameTime: si.gameTime, sheetId: si.sheetId };
  games[k] = { ...games[k], gameDate: sj.gameDate, gameTime: sj.gameTime, sheetId: sj.sheetId };
  return { indices: [i, j, k], saved: [si, sj, sk], freed: [], taken: [] };
}

/** Flip team1 and team2 for a random game. */
function movePosition(games: GeneratedGame[], rng: () => number): SAMove {
  const idx = Math.floor(rng() * games.length);
  const old = snap(games[idx]);
  games[idx] = { ...games[idx], team1Id: old.team2Id, team2Id: old.team1Id };
  return { indices: [idx], saved: [old], freed: [], taken: [] };
}

/** Undo an SA move, restoring original game states and slot occupancy. */
function undoMove(games: GeneratedGame[], m: SAMove, occ: Set<string>): void {
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
  for (const sk of m.taken) occ.delete(sk);
  for (const sk of m.freed) occ.add(sk);
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
 *  - swap:     exchange slots of two random games
 *  - relocate: move a game to a random empty slot within an active draw
 *  - cycle:    rotate slots among three random games
 *  - position: flip team1/team2 for a game
 */
function simulatedAnnealing(
  initialGames: GeneratedGame[],
  teamIds: number[],
  byeMap: Map<string, ScheduleByeRequest[]>,
  slotPool: GameSlot[],
  drawCapacities: Map<string, number>,
  numSheets: number,
  rng: () => number,
  timeBudgetMs: number,
  reportProgress: (update: ProgressUpdate) => void,
): GeneratedGame[] {
  const n = initialGames.length;
  if (n < 2) return initialGames;

  // Working copy
  const games = initialGames.map((g) => ({ ...g }));

  // ── Week-key cache (avoids Date construction in the hot loop) ────────────
  const weekCache = new Map<string, string>();
  const cacheAllDates = (sources: Array<{ date?: string; gameDate?: string }>) => {
    for (const s of sources) {
      const d = ('date' in s ? s.date : (s as GeneratedGame).gameDate) as string;
      if (d && !weekCache.has(d)) weekCache.set(d, weekKeyFromDate(d));
    }
  };
  cacheAllDates(slotPool as Array<{ date: string }>);
  cacheAllDates(games as unknown as Array<{ gameDate: string }>);
  const getWk = (d: string): string => {
    let wk = weekCache.get(d);
    if (!wk) {
      wk = weekKeyFromDate(d);
      weekCache.set(d, wk);
    }
    return wk;
  };

  // ── Pre-allocated hard-constraint check buffers ──────────────────────────
  const hcDraw = new Map<string, Set<number>>();
  const hcWeek = new Map<string, Set<number>>();

  const hasConflict = (): boolean => {
    for (const s of hcDraw.values()) s.clear();
    for (const s of hcWeek.values()) s.clear();
    for (const g of games) {
      const dk = `${g.gameDate}|${g.gameTime}`;
      let ds = hcDraw.get(dk);
      if (!ds) {
        ds = new Set();
        hcDraw.set(dk, ds);
      }
      if (ds.has(g.team1Id) || ds.has(g.team2Id)) return true;
      ds.add(g.team1Id);
      ds.add(g.team2Id);
      const wk = getWk(g.gameDate);
      let ws = hcWeek.get(wk);
      if (!ws) {
        ws = new Set();
        hcWeek.set(wk, ws);
      }
      if (ws.has(g.team1Id) || ws.has(g.team2Id)) return true;
      ws.add(g.team1Id);
      ws.add(g.team2Id);
    }
    return false;
  };

  // ── Pre-allocated scoring buffers ────────────────────────────────────────
  const scPos = new Map<number, [number, number]>();
  const scDT = new Map<number, Map<string, number>>();
  const scSh = new Map<number, Map<number, number>>();
  const scDraw = new Map<string, number>();
  for (const id of teamIds) {
    scPos.set(id, [0, 0]);
    scDT.set(id, new Map());
    scSh.set(id, new Map());
  }

  /** Full SA score: bye + balance + compactness. */
  const computeScore = (): number => {
    // Clear buffers
    for (const id of teamIds) {
      const p = scPos.get(id)!;
      p[0] = 0;
      p[1] = 0;
      scDT.get(id)!.clear();
      scSh.get(id)!.clear();
    }
    scDraw.clear();

    let s = 0;
    for (const g of games) {
      s += byePenalty(g, byeMap);
      scPos.get(g.team1Id)![0]++;
      scPos.get(g.team2Id)![1]++;
      const dt1 = scDT.get(g.team1Id)!;
      dt1.set(g.gameTime, (dt1.get(g.gameTime) ?? 0) + 1);
      const dt2 = scDT.get(g.team2Id)!;
      dt2.set(g.gameTime, (dt2.get(g.gameTime) ?? 0) + 1);
      const sh1 = scSh.get(g.team1Id)!;
      sh1.set(g.sheetId, (sh1.get(g.sheetId) ?? 0) + 1);
      const sh2 = scSh.get(g.team2Id)!;
      sh2.set(g.sheetId, (sh2.get(g.sheetId) ?? 0) + 1);
      const dk = `${g.gameDate}|${g.gameTime}`;
      scDraw.set(dk, (scDraw.get(dk) ?? 0) + 1);
    }

    // Per-team balance penalties
    for (const id of teamIds) {
      const [t1, t2] = scPos.get(id)!;
      s += (t1 - t2) ** 2 * WEIGHT_POSITION_BALANCE;

      const dtm = scDT.get(id)!;
      if (dtm.size > 0) {
        let sum = 0;
        let sq = 0;
        let cnt = 0;
        for (const v of dtm.values()) {
          sum += v;
          sq += v * v;
          cnt++;
        }
        const mean = sum / cnt;
        s += (sq / cnt - mean * mean) * WEIGHT_DRAW_TIME_BALANCE;
      }

      const shm = scSh.get(id)!;
      if (shm.size > 0) {
        let sum = 0;
        let sq = 0;
        let cnt = 0;
        for (const v of shm.values()) {
          sum += v;
          sq += v * v;
          cnt++;
        }
        const mean = sum / cnt;
        s += (sq / cnt - mean * mean) * WEIGHT_SHEET_BALANCE;
      }
    }

    // Compactness penalties
    const target = Math.ceil(n / numSheets);
    const actual = scDraw.size;
    if (actual > target) s += (actual - target) * WEIGHT_COMPACTNESS_EXTRA_DRAW;
    let totalEmp = 0;
    let multiEmp = 0;
    for (const [dk, cnt] of scDraw) {
      const cap = drawCapacities.get(dk) ?? numSheets;
      const emp = cap - cnt;
      if (emp > 0) totalEmp += emp;
      if (emp > 1) multiEmp++;
    }
    s += multiEmp * WEIGHT_COMPACTNESS_MULTI_EMPTY;
    if (totalEmp >= numSheets) s += (totalEmp - numSheets + 1) * WEIGHT_COMPACTNESS_EXCESS_EMPTIES;

    return s;
  };

  // ── Occupied slot tracking (for relocate moves) ──────────────────────────
  const occupied = new Set<string>();
  for (const g of games) occupied.add(`${g.gameDate}|${g.gameTime}|${g.sheetId}`);

  // ── Active draw keys (draws used by the greedy phase) ──────────────────
  // SA relocate moves may only target these draws, preventing the optimizer
  // from scattering games into draws the greedy phase didn't select.
  // Consolidation (emptying a draw) is still allowed.
  const activeDrawKeys = new Set<string>();
  for (const g of games) activeDrawKeys.add(`${g.gameDate}|${g.gameTime}`);

  // ── Initial score & best tracking ────────────────────────────────────────
  let currentScore = computeScore();
  let bestScore = currentScore;
  let bestGames = games.map((g) => ({ ...g }));

  // ── SA parameters ────────────────────────────────────────────────────────
  const T0 = Math.max(currentScore * 0.05, 500);
  const TF = 0.01;
  const startTime = Date.now();
  let iterations = 0;
  let improved = 0;
  let lastReport = startTime;

  // ── Main SA loop ─────────────────────────────────────────────────────────
  while (true) {
    const now = Date.now();
    const elapsed = now - startTime;
    if (elapsed >= timeBudgetMs) break;

    iterations++;
    const progress = elapsed / timeBudgetMs;
    const temp = T0 * Math.pow(TF / T0, progress);

    // Pick and apply a random move
    const r = rng();
    let move: SAMove | null;
    if (r < 0.35) move = moveSwap(games, rng);
    else if (r < 0.60) move = moveRelocate(games, slotPool, occupied, activeDrawKeys, rng);
    else if (r < 0.85) move = moveCycle(games, rng);
    else move = movePosition(games, rng);
    if (!move) continue;

    // Hard constraint gate
    if (hasConflict()) {
      undoMove(games, move, occupied);
      continue;
    }

    // Score the new state and decide
    const newScore = computeScore();
    const delta = newScore - currentScore;
    if (delta <= 0 || rng() < Math.exp(-delta / temp)) {
      currentScore = newScore;
      if (newScore < bestScore) {
        bestScore = newScore;
        bestGames = games.map((g) => ({ ...g }));
        improved++;
      }
    } else {
      undoMove(games, move, occupied);
    }

    // Progress reporting (~2× per second)
    if (now - lastReport >= 500) {
      lastReport = now;
      reportProgress({
        phase: 'Optimizing',
        percent: Math.min(99, 80 + Math.round(progress * 19)),
        message: `${improved} improvements, score ${bestScore.toFixed(0)} (${(iterations / 1000).toFixed(0)}k iter, ${Math.round(elapsed / 1000)}s)`,
      });
    }
  }

  reportProgress({
    phase: 'Optimizing',
    percent: 99,
    message: `SA complete: ${improved} improvements in ${(iterations / 1000).toFixed(0)}k iterations`,
  });

  return bestGames;
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
): ScheduleResult {
  const rng = mulberry32(seed);
  const byeMap = buildByeMap(byeRequests);
  const slotPool = buildSlotPool(drawSlots, strategies);
  const warnings: ScheduleWarning[] = [];

  if (slotPool.length === 0) {
    warnings.push({ severity: 'error', message: 'No available game slots. Check draw slots and sheet availability.' });
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
    const dk = `${ds.date}|${ds.time}`;
    const availableSheetCount = ds.sheets.filter((s) => s.isAvailable).length;
    drawCapacities.set(dk, availableSheetCount);
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

  const totalMatchups = rounds.reduce((sum, r) => sum + r.matchups.length, 0);
  let assignedCount = 0;

  /** Helper: score a matchup against a subset of the slot pool. */
  const findBestSlot = (
    matchup: Matchup,
    allowed: Set<string>,
    filterFn: (dk: string) => boolean,
  ): { slot: GameSlot | null; score: number } => {
    let bestSlot: GameSlot | null = null;
    let bestScore = Infinity;
    for (const slot of slotPool) {
      const dk = drawKey(slot);
      if (!filterFn(dk)) continue;
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
        allowed,
        rng,
      );
      if (s < bestScore) {
        bestScore = s;
        bestSlot = slot;
      }
    }
    return { slot: bestSlot, score: bestScore };
  };

  // ─── Pre-compute draw-key → week-key mapping ───────────────────────────
  const drawWeekMap = new Map<string, string>();
  for (const slot of slotPool) {
    const dk = drawKey(slot);
    if (!drawWeekMap.has(dk)) {
      drawWeekMap.set(dk, weekKeyFromDate(slot.date));
    }
  }

  // Sorted unique week keys – used by Tier 3 to open new weeks in
  // chronological order so the schedule has no gaps.
  const allWeekKeysSorted = [...new Set(drawWeekMap.values())].sort();

  // Track which weeks already have at least one active draw.
  const activeWeeks = new Set<string>();

  /** Helper: commit a game assignment and update all tracking structures. */
  const commitAssignment = (matchup: Matchup, bestSlot: GameSlot) => {
    const [t1, t2] = optimizePositions(matchup, teamPositionCounts);
    const game: GeneratedGame = {
      team1Id: t1,
      team2Id: t2,
      gameDate: bestSlot.date,
      gameTime: bestSlot.time,
      sheetId: bestSlot.sheetId,
    };
    games.push(game);

    const dk = drawKey(bestSlot);
    if (!drawTeams.has(dk)) drawTeams.set(dk, new Set());
    drawTeams.get(dk)!.add(t1);
    drawTeams.get(dk)!.add(t2);

    drawGameCounts.set(dk, (drawGameCounts.get(dk) ?? 0) + 1);

    const wk = drawWeekMap.get(dk) ?? weekKeyFromDate(bestSlot.date);
    activeWeeks.add(wk);
    if (!weekTeams.has(wk)) weekTeams.set(wk, new Set());
    weekTeams.get(wk)!.add(t1);
    weekTeams.get(wk)!.add(t2);

    occupiedSlots.add(slotKey(bestSlot));

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

  // ─── Three-tier greedy assignment ─────────────────────────────────────
  // Tier 1: slots in "active" draws (draws that already have ≥1 game).
  //         Packs games into existing draws to enforce constraints #3/#4.
  // Tier 2: slots in inactive draws whose week already has an active draw.
  //         Fills out the current week before opening a new one, ensuring
  //         we don't leave draws empty in weeks that are partially used.
  // Tier 3: slots in inactive draws in completely new weeks.
  //         Opens a new week only when strictly necessary.

  for (const round of rounds) {
    for (const matchup of round.matchups) {
      assignedCount++;

      if (assignedCount % 10 === 0) {
        reportProgress({
          phase: 'Assigning slots',
          percent: Math.round((assignedCount / totalMatchups) * 80),
          message: `${assignedCount}/${totalMatchups} matchups`,
        });
      }

      const allowed = strategyAllowedMap.get(matchup.strategyLocalId) ?? new Set<string>();

      // Tier 1: active draws only (draws with ≥1 game)
      let { slot: bestSlot, score: bestScore } = findBestSlot(
        matchup,
        allowed,
        (dk) => drawGameCounts.has(dk),
      );

      // Tier 2: inactive draws in weeks that already have an active draw
      if (bestSlot == null || bestScore === Infinity) {
        ({ slot: bestSlot, score: bestScore } = findBestSlot(
          matchup,
          allowed,
          (dk) => !drawGameCounts.has(dk) && activeWeeks.has(drawWeekMap.get(dk)!),
        ));
      }

      // Tier 3: inactive draws in the earliest unused week.
      // Try weeks in chronological order so the schedule is contiguous –
      // no empty weeks appear between used weeks.
      if (bestSlot == null || bestScore === Infinity) {
        for (const wk of allWeekKeysSorted) {
          if (activeWeeks.has(wk)) continue;
          ({ slot: bestSlot, score: bestScore } = findBestSlot(
            matchup,
            allowed,
            (dk) => !drawGameCounts.has(dk) && drawWeekMap.get(dk) === wk,
          ));
          if (bestSlot != null && bestScore !== Infinity) break;
        }
      }

      if (bestSlot == null || bestScore === Infinity) {
        unschedulable.push({
          team1Id: matchup.team1Id,
          team2Id: matchup.team2Id,
          strategyLocalId: matchup.strategyLocalId,
          reason: 'No available slot without conflicts.',
        });
        continue;
      }

      commitAssignment(matchup, bestSlot);
    }
  }

  // Phase 3: simulated annealing
  reportProgress({ phase: 'Optimizing', percent: 80, message: 'Starting simulated annealing...' });
  const optimized = simulatedAnnealing(
    games,
    teamIds,
    byeMap,
    slotPool,
    drawCapacities,
    numSheets,
    rng,
    timeBudgetMs,
    reportProgress,
  );

  // Build result (include compactness in total score)
  const totalScore = totalScheduleScore(optimized, teamIds, byeMap) + compactnessScore(optimized, drawCapacities, numSheets);
  const teamStats = computeTeamStats(optimized, teamIds, byeMap);

  if (unschedulable.length > 0) {
    warnings.push({
      severity: 'warning',
      message: `${unschedulable.length} matchup${unschedulable.length === 1 ? '' : 's'} could not be scheduled due to slot constraints.`,
    });
  }

  // ─── Post-generation validation: draw compactness (constraints #3 & #4) ──
  const scheduledGames = optimized.length;
  const targetDrawCount = Math.ceil(scheduledGames / numSheets);

  // Count games per draw in the final schedule
  const finalDrawGameCounts = new Map<string, number>();
  for (const g of optimized) {
    const fdk = `${g.gameDate}|${g.gameTime}`;
    finalDrawGameCounts.set(fdk, (finalDrawGameCounts.get(fdk) ?? 0) + 1);
  }
  const actualDrawsUsed = finalDrawGameCounts.size;

  // Total empty sheets across all used draws
  let totalEmptySheets = 0;
  let drawsWithMultipleEmpties = 0;
  for (const [fdk, gamesInDraw] of finalDrawGameCounts) {
    const capacity = drawCapacities.get(fdk) ?? numSheets;
    const empties = capacity - gamesInDraw;
    if (empties > 0) totalEmptySheets += empties;
    if (empties > 1) drawsWithMultipleEmpties++;
  }

  if (actualDrawsUsed > targetDrawCount) {
    warnings.push({
      severity: 'warning',
      message: `Schedule uses ${actualDrawsUsed} draws but the optimal number is ${targetDrawCount} (${scheduledGames} games ÷ ${numSheets} sheets). Hard constraints (once-per-week, team conflicts) may prevent full compaction.`,
    });
  }
  if (drawsWithMultipleEmpties > 0) {
    warnings.push({
      severity: 'warning',
      message: `${drawsWithMultipleEmpties} draw${drawsWithMultipleEmpties === 1 ? ' has' : 's have'} more than 1 empty sheet. Consider adjusting strategies or draw slots.`,
    });
  }
  if (totalEmptySheets >= numSheets) {
    warnings.push({
      severity: 'warning',
      message: `Total empty sheets across all draws is ${totalEmptySheets} (≥ ${numSheets} sheets), meaning fewer draws could have been used with more efficient packing.`,
    });
  }

  // Check for significant imbalances
  for (const ts of teamStats) {
    const dtValues = Object.values(ts.drawTimeCounts);
    if (dtValues.length > 1) {
      const maxDt = Math.max(...dtValues);
      const minDt = Math.min(...dtValues);
      if (maxDt - minDt > 2) {
        warnings.push({
          severity: 'info',
          message: `Team ${ts.teamId} has a draw time spread of ${minDt}-${maxDt} games.`,
        });
      }
    }
    if (ts.byeConflicts.length > 0) {
      const highPriority = ts.byeConflicts.filter((c) => c.priority <= 2);
      if (highPriority.length > 0) {
        warnings.push({
          severity: 'warning',
          message: `Team ${ts.teamId} has ${highPriority.length} high-priority bye conflict${highPriority.length === 1 ? '' : 's'}.`,
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
