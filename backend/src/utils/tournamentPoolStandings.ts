/**
 * Bonspiel draw phases, pool-play standings, advancing seeds, and competitor resolution.
 * Self-contained (no backend-only imports) so the frontend imports it directly.
 */

export type TournamentPhaseKind = 'bracket' | 'pool';

export type PoolStandingsSettings = {
  /** Most standings points one team can earn in one game (e.g. 1 for W/L, 2 for 2-1-0). */
  pointsPossiblePerGame: number;
  rankBy: 'points' | 'percentage';
  /** Two-way ties use the head-to-head game(s) first. */
  headToHead: boolean;
  tiebreakLabel: string;
  tiebreakLowerIsBetter: boolean;
};

export const DEFAULT_POOL_STANDINGS_SETTINGS: PoolStandingsSettings = {
  pointsPossiblePerGame: 1,
  rankBy: 'points',
  headToHead: true,
  tiebreakLabel: 'Tiebreak',
  tiebreakLowerIsBetter: true,
};

export type AdvancingStep =
  | { id: string; kind: 'top_per_pool'; count: number }
  | { id: string; kind: 'pool_place'; poolId: string; rank: number }
  | { id: string; kind: 'best_remaining'; count: number };

export type TournamentPhase = {
  id: string;
  name: string;
  order: number;
  kind: TournamentPhaseKind;
  standings?: PoolStandingsSettings;
  advancing?: AdvancingStep[];
};

export type TournamentSlotSource =
  | { sourceType: 'tbd' }
  | { sourceType: 'bye' }
  | { sourceType: 'registration'; registrationId?: number | null }
  | { sourceType: 'game_place'; gameId?: string | null; place: number }
  /** A pool game competitor: the team in pool entry `entryId` (e.g. "A2"). */
  | { sourceType: 'pool_entry'; entryId?: string | null }
  /**
   * A finishing position in a pool phase. `poolId` = that pool; `poolRank` = the Nth-ranked pool
   * (pools ranked by their top team); neither = overall across all pools.
   * `afterDrawBlockId` = standings counting only games through that draw (mid-phase matchups).
   */
  | {
      sourceType: 'standing';
      phaseId: string;
      poolId?: string | null;
      poolRank?: number | null;
      rank: number;
      afterDrawBlockId?: string | null;
    }
  /** Seed `seed` (1-based) from a pool phase's advancing teams list. */
  | { sourceType: 'qualifier'; phaseId: string; seed: number };

export type TournamentPoolEntry = { id: string; source: TournamentSlotSource };

export type TournamentPool = {
  id: string;
  phaseId: string;
  name: string;
  code: string;
  order: number;
  color: string;
  entries: TournamentPoolEntry[];
};

/** Pool game standings points and tiebreak values, one per competitor slot. */
export type TournamentGameStanding = {
  points: [number | null, number | null];
  tiebreak: [number | null, number | null];
};

export type TournamentGameResult =
  | { entryKind: 'pick_winner'; winnerSlot: 0 | 1 }
  | { entryKind: 'final_score'; finalScores: [number, number] }
  | {
      entryKind: 'ends';
      ends: { side0: number[]; side1: number[] };
      complete?: boolean;
      firstEndHammerSlot?: 0 | 1;
      powerPlayEndBySlot?: { side0?: number | null; side1?: number | null };
    }
  | { entryKind: 'multi_score'; scores: number[] };

export type DrawGameShape = {
  id: string;
  label: string;
  eventId: string;
  phaseId: string;
  poolId?: string | null;
  slots: TournamentSlotSource[];
  result?: TournamentGameResult;
  standing?: TournamentGameStanding;
  schedule?: { drawBlockId?: string | null };
};

export type PoolDrawShape = {
  phases: TournamentPhase[];
  pools: TournamentPool[];
  games: Record<string, DrawGameShape>;
  connections: Array<{
    id: string;
    fromGameId: string;
    place: number;
    toGameId?: string | null;
    terminalType: 'game' | 'out' | 'tbd';
  }>;
  drawBlocks: Array<{ id: string; name: string; order: number }>;
};

export const DEFAULT_BRACKET_PHASE_ID = 'phase-bracket';

export function ordinal(n: number): string {
  const k = Math.floor(n);
  if (k <= 0) return String(n);
  const j = k % 10;
  const k100 = k % 100;
  if (j === 1 && k100 !== 11) return `${k}st`;
  if (j === 2 && k100 !== 12) return `${k}nd`;
  if (j === 3 && k100 !== 13) return `${k}rd`;
  return `${k}th`;
}

// ---------------------------------------------------------------------------
// Legacy JSON migration (shared by backend preprocess and frontend normalize)
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/** Adds `phases`, `pools`, `setup.events[].phaseId`, and `games[].phaseId` to legacy draws (idempotent). */
export function migrateDrawPhasesJson(data: Record<string, unknown>): Record<string, unknown> {
  const rawPhases = Array.isArray(data.phases) ? data.phases.filter(isRecord) : [];
  const phases: Record<string, unknown>[] = [...rawPhases];
  const phaseIds = new Set(phases.map((p) => String(p.id)));
  const setup = isRecord(data.setup) ? data.setup : null;
  const rawEvents = setup && Array.isArray(setup.events) ? setup.events.filter(isRecord) : [];

  const sortedPhases = [...phases].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  let fallbackBracketId = sortedPhases.find((p) => p.kind === 'bracket')?.id as string | undefined;
  const needsFallback =
    phases.length === 0 ||
    rawEvents.some((e) => typeof e.phaseId !== 'string' || !phaseIds.has(e.phaseId));
  if (needsFallback && !fallbackBracketId) {
    fallbackBracketId = phaseIds.has(DEFAULT_BRACKET_PHASE_ID)
      ? `${DEFAULT_BRACKET_PHASE_ID}-${phases.length}`
      : DEFAULT_BRACKET_PHASE_ID;
    const maxOrder = phases.reduce((m, p) => Math.max(m, Number(p.order ?? 0)), -1);
    phases.push({ id: fallbackBracketId, name: 'Bracket', order: maxOrder + 1, kind: 'bracket' });
    phaseIds.add(fallbackBracketId);
  }

  const events = rawEvents.map((e) =>
    typeof e.phaseId === 'string' && phaseIds.has(e.phaseId) ? e : { ...e, phaseId: fallbackBracketId },
  );
  const eventPhase = new Map(events.map((e) => [String(e.id), String(e.phaseId)]));

  let games = data.games;
  if (isRecord(data.games)) {
    const next: Record<string, unknown> = {};
    for (const [key, g] of Object.entries(data.games)) {
      if (!isRecord(g)) {
        next[key] = g;
        continue;
      }
      if (typeof g.phaseId === 'string' && phaseIds.has(g.phaseId)) {
        next[key] = g;
        continue;
      }
      const fromEvent = eventPhase.get(String(g.eventId));
      next[key] = { ...g, phaseId: fromEvent ?? fallbackBracketId ?? sortedPhases[0]?.id };
    }
    games = next;
  }

  return {
    ...data,
    phases,
    pools: Array.isArray(data.pools) ? data.pools : [],
    ...(setup ? { setup: { ...setup, events } } : {}),
    ...(games !== undefined ? { games } : {}),
  };
}

// ---------------------------------------------------------------------------
// Phase / pool helpers
// ---------------------------------------------------------------------------

export function sortedPhases<P extends { order: number }>(phases: P[]): P[] {
  return [...phases].sort((a, b) => a.order - b.order);
}

export function phaseById(draw: Pick<PoolDrawShape, 'phases'>, phaseId: string): TournamentPhase | undefined {
  return draw.phases.find((p) => p.id === phaseId);
}

export function poolsForPhase<P extends { phaseId: string; order: number }>(
  draw: { pools: P[] },
  phaseId: string,
): P[] {
  return draw.pools.filter((p) => p.phaseId === phaseId).sort((a, b) => a.order - b.order);
}

export function poolSettings(phase: Pick<TournamentPhase, 'standings'> | undefined): PoolStandingsSettings {
  return { ...DEFAULT_POOL_STANDINGS_SETTINGS, ...(phase?.standings ?? {}) };
}

export function isPoolPhaseGame(draw: Pick<PoolDrawShape, 'phases'>, game: Pick<DrawGameShape, 'phaseId'>): boolean {
  return phaseById(draw, game.phaseId)?.kind === 'pool';
}

export function poolEntryCode(pool: Pick<TournamentPool, 'code'>, index: number): string {
  return `${pool.code}${index + 1}`;
}

export function findPoolEntry<P extends TournamentPool>(
  draw: { pools: P[] },
  entryId: string | null | undefined,
): { pool: P; entry: TournamentPoolEntry; index: number } | null {
  if (!entryId) return null;
  for (const pool of draw.pools) {
    const index = pool.entries.findIndex((e) => e.id === entryId);
    if (index >= 0) return { pool, entry: pool.entries[index]!, index };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Game outcomes and feeders
// ---------------------------------------------------------------------------

export type TwoSidedOutcome = 0 | 1 | 'tie' | null;

export function hasStandingPoints(game: Pick<DrawGameShape, 'standing'>): boolean {
  const pts = game.standing?.points;
  return pts != null && pts[0] != null && pts[1] != null;
}

/** Winner of a two-sided game. Recorded standings points take precedence over the score. */
export function twoSidedOutcome(game: Pick<DrawGameShape, 'result' | 'standing'>): TwoSidedOutcome {
  const pts = game.standing?.points;
  if (pts && pts[0] != null && pts[1] != null) {
    if (pts[0] > pts[1]) return 0;
    if (pts[1] > pts[0]) return 1;
    return 'tie';
  }
  const r = game.result;
  if (!r) return null;
  if (r.entryKind === 'pick_winner') return r.winnerSlot;
  if (r.entryKind === 'final_score') {
    const [a, b] = r.finalScores;
    return a > b ? 0 : b > a ? 1 : 'tie';
  }
  if (r.entryKind === 'ends') {
    if (r.complete === false) return null;
    const a = r.ends.side0.reduce((x, y) => x + y, 0);
    const b = r.ends.side1.reduce((x, y) => x + y, 0);
    return a > b ? 0 : b > a ? 1 : 'tie';
  }
  return null;
}

/** Slot index (0-based) that finished in `place` (1 = best), or null when undecided. */
export function slotIndexForPlace(game: Pick<DrawGameShape, 'result' | 'standing' | 'slots'>, place: number): number | null {
  const k = game.slots.length;
  if (place < 1 || place > k) return null;
  if (k === 2) {
    const outcome = twoSidedOutcome(game);
    if (outcome == null || outcome === 'tie') return null;
    return place === 1 ? outcome : 1 - outcome;
  }
  const r = game.result;
  if (!r || r.entryKind !== 'multi_score' || r.scores.length !== k) return null;
  const rows = r.scores.map((score, slotIndex) => ({ slotIndex, score }));
  rows.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.slotIndex - b.slotIndex));
  return rows[place - 1]?.slotIndex ?? null;
}

export function incomingFeedersSorted(
  draw: Pick<PoolDrawShape, 'games' | 'connections'>,
  toGameId: string,
): Array<{ fromGameId: string; place: number }> {
  return draw.connections
    .filter((c) => c.terminalType === 'game' && c.toGameId === toGameId)
    .sort((a, b) => {
      const la = draw.games[a.fromGameId]?.label ?? a.fromGameId;
      const lb = draw.games[b.fromGameId]?.label ?? b.fromGameId;
      const byLabel = la.localeCompare(lb, undefined, { numeric: true });
      if (byLabel !== 0) return byLabel;
      if (a.fromGameId !== b.fromGameId) return a.fromGameId.localeCompare(b.fromGameId);
      if (a.place !== b.place) return a.place - b.place;
      return a.id.localeCompare(b.id);
    })
    .map((c) => ({ fromGameId: c.fromGameId, place: c.place }));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type SourceResolution = {
  /** Confirmed team (standings are final and the position is not tied). */
  registrationId: number | null;
  /** Team currently holding the position, even when standings are not final. */
  projectedRegistrationId: number | null;
  /** Teams tied for the position (blocks resolution until tiebreaks separate them). */
  tiedRegistrationIds: number[];
};

const UNRESOLVED: SourceResolution = { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: [] };

function confirmed(id: number | null): SourceResolution {
  return { registrationId: id, projectedRegistrationId: id, tiedRegistrationIds: [] };
}

/** Registration occupying `slotIndex` of `game`, following feeders, pool entries, standings, and seeds. */
export function resolveGameSlotRegistrationId(
  draw: PoolDrawShape,
  game: DrawGameShape,
  slotIndex: number,
  visiting: Set<string> = new Set(),
): number | null {
  const key = `g:${game.id}`;
  if (visiting.has(key)) return null;
  visiting.add(key);
  try {
    const feeders = incomingFeedersSorted(draw, game.id);
    if (slotIndex < feeders.length) {
      const edge = feeders[slotIndex]!;
      const from = draw.games[edge.fromGameId];
      if (!from) return null;
      const finisher = slotIndexForPlace(from, edge.place);
      if (finisher == null) return null;
      return resolveGameSlotRegistrationId(draw, from, finisher, visiting);
    }
    const slot = game.slots[slotIndex];
    if (!slot) return null;
    return resolveSourceDetail(draw, slot, visiting).registrationId;
  } finally {
    visiting.delete(key);
  }
}

export function resolveSourceRegistrationId(
  draw: PoolDrawShape,
  source: TournamentSlotSource,
  visiting: Set<string> = new Set(),
): number | null {
  return resolveSourceDetail(draw, source, visiting).registrationId;
}

export function resolveSourceDetail(
  draw: PoolDrawShape,
  source: TournamentSlotSource,
  visiting: Set<string> = new Set(),
): SourceResolution {
  switch (source.sourceType) {
    case 'registration':
      return confirmed(source.registrationId ?? null);
    case 'game_place': {
      const from = source.gameId ? draw.games[source.gameId] : undefined;
      if (!from) return UNRESOLVED;
      const finisher = slotIndexForPlace(from, source.place);
      if (finisher == null) return UNRESOLVED;
      return confirmed(resolveGameSlotRegistrationId(draw, from, finisher, visiting));
    }
    case 'pool_entry': {
      const found = findPoolEntry(draw, source.entryId);
      if (!found || found.entry.source.sourceType === 'pool_entry') return UNRESOLVED;
      const key = `e:${found.entry.id}`;
      if (visiting.has(key)) return UNRESOLVED;
      visiting.add(key);
      try {
        return resolveSourceDetail(draw, found.entry.source, visiting);
      } finally {
        visiting.delete(key);
      }
    }
    case 'standing': {
      const standings = computePhaseStandings(draw, source.phaseId, source.afterDrawBlockId ?? null, visiting);
      if (!standings) return UNRESOLVED;
      return standingPosition(standings, source);
    }
    case 'qualifier': {
      const seeds = computeAdvancingSeeds(draw, source.phaseId, visiting);
      const seed = seeds?.[source.seed - 1];
      if (!seed) return UNRESOLVED;
      return {
        registrationId: seed.registrationId,
        projectedRegistrationId: seed.projectedRegistrationId,
        tiedRegistrationIds: seed.tiedRegistrationIds,
      };
    }
    default:
      return UNRESOLVED;
  }
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export type PoolStandingRow = {
  registrationId: number;
  poolId: string;
  rank: number;
  tied: boolean;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  pointsPossible: number;
  /** 0–1, or null before any games. */
  percentage: number | null;
  /** Summed tiebreak values, or null when none recorded. */
  tiebreak: number | null;
};

export type PoolStandingsTable = {
  rows: PoolStandingRow[];
  /** Teams in finish order; inner arrays with more than one team are unresolved ties. */
  tiers: number[][];
};

export type PhaseStandings = {
  phaseId: string;
  settings: PoolStandingsSettings;
  /** All pool entries known and every counted game has points. */
  final: boolean;
  hasResults: boolean;
  pools: Array<PoolStandingsTable & { pool: TournamentPool; final: boolean }>;
  overall: PoolStandingsTable;
  /** Pool ids ranked by their top team. */
  poolRanking: string[][];
};

type TeamStats = {
  registrationId: number;
  poolId: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  pointsPossible: number;
  tiebreakSum: number;
  tiebreakCount: number;
};

type CountedGame = { sides: [number, number]; points: [number, number] };

type RankContext = {
  stats: Map<number, TeamStats>;
  games: CountedGame[];
  settings: PoolStandingsSettings;
};

const standingsCache = new WeakMap<object, Map<string, PhaseStandings | null>>();
const seedsCache = new WeakMap<object, Map<string, AdvancingSeed[] | null>>();

function cacheFor<T>(cache: WeakMap<object, Map<string, T>>, draw: object): Map<string, T> {
  let m = cache.get(draw);
  if (!m) {
    m = new Map();
    cache.set(draw, m);
  }
  return m;
}

function comparePrimary(a: TeamStats, b: TeamStats, settings: PoolStandingsSettings): number {
  if (settings.rankBy === 'percentage') {
    if (a.pointsPossible === 0 && b.pointsPossible === 0) return 0;
    if (a.pointsPossible === 0) return 1;
    if (b.pointsPossible === 0) return -1;
    return b.points * a.pointsPossible - a.points * b.pointsPossible;
  }
  return b.points - a.points;
}

function compareTiebreak(a: TeamStats, b: TeamStats, settings: PoolStandingsSettings): number {
  if (a.tiebreakCount === 0 && b.tiebreakCount === 0) return 0;
  if (a.tiebreakCount === 0) return 1;
  if (b.tiebreakCount === 0) return -1;
  return settings.tiebreakLowerIsBetter ? a.tiebreakSum - b.tiebreakSum : b.tiebreakSum - a.tiebreakSum;
}

/** Positive when `a` ranks ahead of `b` on points in games between them. */
function headToHead(a: number, b: number, games: CountedGame[]): number {
  let aPts = 0;
  let bPts = 0;
  let found = false;
  for (const g of games) {
    const [s0, s1] = g.sides;
    if (s0 === a && s1 === b) {
      aPts += g.points[0];
      bPts += g.points[1];
      found = true;
    } else if (s0 === b && s1 === a) {
      aPts += g.points[1];
      bPts += g.points[0];
      found = true;
    }
  }
  return found ? aPts - bPts : 0;
}

function splitAdjacent(ids: number[], same: (a: number, b: number) => boolean): number[][] {
  const groups: number[][] = [];
  for (const id of ids) {
    const last = groups[groups.length - 1];
    if (last && same(last[0]!, id)) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

function headToHeadPair(pair: number[], ctx: RankContext): number[][] | null {
  if (!ctx.settings.headToHead || pair.length !== 2) return null;
  const h = headToHead(pair[0]!, pair[1]!, ctx.games);
  if (h > 0) return [[pair[0]!], [pair[1]!]];
  if (h < 0) return [[pair[1]!], [pair[0]!]];
  return null;
}

function breakTie(group: number[], ctx: RankContext): number[][] {
  if (group.length === 1) return [group];
  const byH2h = headToHeadPair(group, ctx);
  if (byH2h) return byH2h;
  const stat = (id: number) => ctx.stats.get(id)!;
  const sorted = [...group].sort((a, b) => compareTiebreak(stat(a), stat(b), ctx.settings) || a - b);
  const subgroups = splitAdjacent(sorted, (a, b) => compareTiebreak(stat(a), stat(b), ctx.settings) === 0);
  if (subgroups.length === 1) return [sorted];
  return subgroups.flatMap((sub) => (group.length > 2 ? (headToHeadPair(sub, ctx) ?? [sub]) : [sub]));
}

/** Ranks teams into tiers (ties stay together). */
function rankTeams(ids: number[], ctx: RankContext): number[][] {
  const stat = (id: number) => ctx.stats.get(id)!;
  const sorted = [...ids].sort((a, b) => comparePrimary(stat(a), stat(b), ctx.settings) || a - b);
  return splitAdjacent(sorted, (a, b) => comparePrimary(stat(a), stat(b), ctx.settings) === 0).flatMap((g) =>
    breakTie(g, ctx),
  );
}

function rowsFromTiers(tiers: number[][], stats: Map<number, TeamStats>): PoolStandingRow[] {
  const rows: PoolStandingRow[] = [];
  let before = 0;
  for (const tier of tiers) {
    for (const id of tier) {
      const s = stats.get(id)!;
      rows.push({
        registrationId: id,
        poolId: s.poolId,
        rank: before + 1,
        tied: tier.length > 1,
        gamesPlayed: s.gamesPlayed,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        points: s.points,
        pointsPossible: s.pointsPossible,
        percentage: s.pointsPossible > 0 ? s.points / s.pointsPossible : null,
        tiebreak: s.tiebreakCount > 0 ? s.tiebreakSum : null,
      });
    }
    before += tier.length;
  }
  return rows;
}

/** The tier holding 1-based position `rank`, or null when there are fewer teams. */
function tierAtPosition<T>(tiers: T[][], rank: number): T[] | null {
  let before = 0;
  for (const tier of tiers) {
    if (rank <= before + tier.length) return tier;
    before += tier.length;
  }
  return null;
}

function blockOrder(draw: PoolDrawShape, blockId: string | null | undefined): number | null {
  if (!blockId) return null;
  return draw.drawBlocks.find((b) => b.id === blockId)?.order ?? null;
}

export function computePhaseStandings(
  draw: PoolDrawShape,
  phaseId: string,
  afterDrawBlockId: string | null = null,
  visiting: Set<string> = new Set(),
): PhaseStandings | null {
  const phase = phaseById(draw, phaseId);
  if (!phase || phase.kind !== 'pool') return null;
  const cacheKey = `${phaseId}|${afterDrawBlockId ?? ''}`;
  const cache = cacheFor(standingsCache, draw);
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const visitKey = `s:${cacheKey}`;
  if (visiting.has(visitKey)) return null;
  visiting.add(visitKey);
  try {
    const result = buildPhaseStandings(draw, phase, afterDrawBlockId, visiting);
    cache.set(cacheKey, result);
    return result;
  } finally {
    visiting.delete(visitKey);
  }
}

function buildPhaseStandings(
  draw: PoolDrawShape,
  phase: TournamentPhase,
  afterDrawBlockId: string | null,
  visiting: Set<string>,
): PhaseStandings {
  const settings = poolSettings(phase);
  const pools = poolsForPhase(draw, phase.id);
  const stats = new Map<number, TeamStats>();
  const poolEntriesKnown = new Map<string, boolean>();

  for (const pool of pools) {
    let known = true;
    for (const entry of pool.entries) {
      const id = resolveSourceDetail(draw, entry.source, visiting).registrationId;
      if (id == null) {
        known = false;
        continue;
      }
      if (stats.has(id)) continue;
      stats.set(id, {
        registrationId: id,
        poolId: pool.id,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        points: 0,
        pointsPossible: 0,
        tiebreakSum: 0,
        tiebreakCount: 0,
      });
    }
    poolEntriesKnown.set(pool.id, known);
  }

  const cutoff = afterDrawBlockId ? (blockOrder(draw, afterDrawBlockId) ?? -Infinity) : null;
  const scopeGames = Object.values(draw.games).filter((g) => {
    if (g.phaseId !== phase.id) return false;
    if (cutoff == null) return true;
    const order = blockOrder(draw, g.schedule?.drawBlockId);
    return order != null && order <= cutoff;
  });

  const counted: CountedGame[] = [];
  const incompletePools = new Set<string>();
  let allComplete = true;
  let hasResults = false;
  const markIncomplete = (g: DrawGameShape, sides: Array<number | null>) => {
    allComplete = false;
    const touched = new Set<string>();
    if (g.poolId) touched.add(g.poolId);
    for (const s of sides) {
      const pool = s != null ? stats.get(s)?.poolId : undefined;
      if (pool) touched.add(pool);
    }
    if (touched.size === 0 || sides.some((s) => s == null)) {
      if (!g.poolId) for (const p of pools) touched.add(p.id);
    }
    for (const p of touched) incompletePools.add(p);
  };

  for (const g of scopeGames) {
    const sides = [0, 1].map((i) => resolveGameSlotRegistrationId(draw, g, i, visiting));
    const tb = g.standing?.tiebreak;
    sides.forEach((id, i) => {
      const v = tb?.[i];
      const s = id != null ? stats.get(id) : undefined;
      if (s && v != null) {
        s.tiebreakSum += v;
        s.tiebreakCount += 1;
      }
    });
    const pts = g.standing?.points;
    const s0 = sides[0];
    const s1 = sides[1];
    if (!pts || pts[0] == null || pts[1] == null || s0 == null || s1 == null) {
      markIncomplete(g, sides);
      continue;
    }
    hasResults = true;
    counted.push({ sides: [s0, s1], points: [pts[0], pts[1]] });
    const pairs: Array<[number, number, number]> = [
      [s0, pts[0], pts[1]],
      [s1, pts[1], pts[0]],
    ];
    for (const [id, mine, theirs] of pairs) {
      const s = stats.get(id);
      if (!s) continue;
      s.gamesPlayed += 1;
      s.points += mine;
      s.pointsPossible += settings.pointsPossiblePerGame;
      if (mine > theirs) s.wins += 1;
      else if (mine < theirs) s.losses += 1;
      else s.ties += 1;
    }
  }

  const ctx: RankContext = { stats, games: counted, settings };
  const poolTables = pools.map((pool) => {
    const ids = [...stats.values()].filter((s) => s.poolId === pool.id).map((s) => s.registrationId);
    const tiers = rankTeams(ids, ctx);
    return {
      pool,
      tiers,
      rows: rowsFromTiers(tiers, stats),
      final: (poolEntriesKnown.get(pool.id) ?? false) && !incompletePools.has(pool.id),
    };
  });
  const overallTiers = rankTeams([...stats.keys()], ctx);

  const reps = new Map<number, string>();
  for (const t of poolTables) {
    const top = t.tiers[0]?.[0];
    if (top != null) reps.set(top, t.pool.id);
  }
  const poolRanking = rankTeams([...reps.keys()], ctx).map((tier) => tier.map((id) => reps.get(id)!));

  const standings: PhaseStandings = {
    phaseId: phase.id,
    settings,
    final: allComplete && poolTables.every((t) => t.final),
    hasResults,
    pools: poolTables,
    overall: { tiers: overallTiers, rows: rowsFromTiers(overallTiers, stats) },
    poolRanking,
  };
  rankContexts.set(standings, ctx);
  return standings;
}

const rankContexts = new WeakMap<PhaseStandings, RankContext>();

function resolutionFromTier(tier: number[] | null, final: boolean): SourceResolution {
  if (!tier) return UNRESOLVED;
  if (tier.length > 1) return { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: [...tier] };
  const id = tier[0]!;
  return { registrationId: final ? id : null, projectedRegistrationId: id, tiedRegistrationIds: [] };
}

function standingPosition(
  standings: PhaseStandings,
  source: Extract<TournamentSlotSource, { sourceType: 'standing' }>,
): SourceResolution {
  if (source.poolId) {
    const table = standings.pools.find((t) => t.pool.id === source.poolId);
    if (!table) return UNRESOLVED;
    return resolutionFromTier(tierAtPosition(table.tiers, source.rank), table.final);
  }
  if (source.poolRank != null) {
    const poolTier = tierAtPosition(standings.poolRanking, source.poolRank);
    if (!poolTier) return UNRESOLVED;
    if (poolTier.length > 1) {
      const tied = poolTier.flatMap((pid) => standings.pools.find((t) => t.pool.id === pid)?.tiers[0] ?? []);
      return { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: tied };
    }
    const table = standings.pools.find((t) => t.pool.id === poolTier[0]);
    if (!table) return UNRESOLVED;
    return resolutionFromTier(tierAtPosition(table.tiers, source.rank), standings.final);
  }
  return resolutionFromTier(tierAtPosition(standings.overall.tiers, source.rank), standings.final);
}

// ---------------------------------------------------------------------------
// Advancing teams (seeds)
// ---------------------------------------------------------------------------

export type AdvancingSeed = SourceResolution & {
  seed: number;
  stepId: string;
  description: string;
};

function bestNthLabel(k: number): string {
  return k === 1 ? 'Best' : `${ordinal(k)}-best`;
}

export function computeAdvancingSeeds(
  draw: PoolDrawShape,
  phaseId: string,
  visiting: Set<string> = new Set(),
): AdvancingSeed[] | null {
  const phase = phaseById(draw, phaseId);
  if (!phase || phase.kind !== 'pool') return null;
  const cache = cacheFor(seedsCache, draw);
  if (cache.has(phaseId)) return cache.get(phaseId)!;
  const standings = computePhaseStandings(draw, phaseId, null, visiting);
  if (!standings) return null;
  const seeds = buildAdvancingSeeds(phase, standings);
  cache.set(phaseId, seeds);
  return seeds;
}

function buildAdvancingSeeds(phase: TournamentPhase, standings: PhaseStandings): AdvancingSeed[] {
  const seeds: AdvancingSeed[] = [];
  const taken = new Set<number>();
  /** Set once the set of already-advanced teams is unknown (a tie crosses a cut line). */
  let blocked = false;
  const final = standings.final;
  const ctx = rankContexts.get(standings)!;
  const statsById = ctx.stats;

  const push = (stepId: string, description: string, res: SourceResolution) => {
    seeds.push({ seed: seeds.length + 1, stepId, description, ...res });
  };
  const pushTiers = (stepId: string, describe: (k: number) => string, tiers: number[][], startK = 1) => {
    let k = startK;
    for (const tier of tiers) {
      for (const id of tier) {
        taken.add(id);
        push(stepId, describe(k), tier.length > 1
          ? { registrationId: null, projectedRegistrationId: id, tiedRegistrationIds: [...tier] }
          : { registrationId: final ? id : null, projectedRegistrationId: id, tiedRegistrationIds: [] });
        k++;
      }
    }
  };

  for (const step of phase.advancing ?? []) {
    if (step.kind === 'top_per_pool') {
      for (let place = 1; place <= step.count; place++) {
        const candidates: number[] = [];
        const ambiguous: number[] = [];
        let slots = 0;
        for (const table of standings.pools) {
          const tier = tierAtPosition(table.tiers, place);
          if (!tier) continue;
          if (tier.length > 1) {
            slots++;
            ambiguous.push(...tier);
            continue;
          }
          if (taken.has(tier[0]!)) continue;
          slots++;
          candidates.push(tier[0]!);
        }
        const describe = (k: number) => `${bestNthLabel(k)} ${ordinal(place)}-place team`;
        if (ambiguous.length > 0) {
          const tied = [...new Set([...candidates, ...ambiguous])];
          for (let k = 1; k <= slots; k++) {
            push(step.id, describe(k), { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: tied });
          }
          for (const id of candidates) taken.add(id);
          blocked = true;
          continue;
        }
        pushTiers(step.id, describe, rankTeams(candidates, ctx));
      }
    } else if (step.kind === 'pool_place') {
      const table = standings.pools.find((t) => t.pool.id === step.poolId);
      const description = table ? `Pool ${table.pool.code} ${ordinal(step.rank)}` : `Pool ${ordinal(step.rank)}`;
      const tier = table ? tierAtPosition(table.tiers, step.rank) : null;
      if (!tier) {
        push(step.id, description, UNRESOLVED);
        continue;
      }
      if (tier.length > 1) {
        blocked = true;
        push(step.id, description, { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: [...tier] });
        continue;
      }
      taken.add(tier[0]!);
      push(step.id, description, { registrationId: final ? tier[0]! : null, projectedRegistrationId: tier[0]!, tiedRegistrationIds: [] });
    } else {
      const describe = (k: number) => `Best remaining #${k}`;
      if (blocked) {
        for (let k = 1; k <= step.count; k++) push(step.id, describe(k), UNRESOLVED);
        continue;
      }
      const remaining = [...statsById.keys()].filter((id) => !taken.has(id));
      const tiers = rankTeams(remaining, ctx);
      let k = 1;
      for (const tier of tiers) {
        if (k > step.count) break;
        const room = step.count - k + 1;
        if (tier.length > room) {
          for (let i = 0; i < room; i++) {
            push(step.id, describe(k), { registrationId: null, projectedRegistrationId: null, tiedRegistrationIds: [...tier] });
            k++;
          }
          blocked = true;
          break;
        }
        pushTiers(step.id, describe, [tier], k);
        k += tier.length;
      }
      while (k <= step.count) {
        push(step.id, describe(k), UNRESOLVED);
        k++;
      }
    }
  }
  return seeds;
}

/** Number of seeds a phase's advancing steps produce (without needing results). */
export function advancingSeedCount(draw: Pick<PoolDrawShape, 'pools'>, phase: TournamentPhase): number {
  const pools = poolsForPhase(draw, phase.id);
  let n = 0;
  for (const step of phase.advancing ?? []) {
    if (step.kind === 'top_per_pool') {
      for (let place = 1; place <= step.count; place++) {
        n += pools.filter((p) => p.entries.length >= place).length;
      }
    } else if (step.kind === 'pool_place') n += 1;
    else n += step.count;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function phasePrefix(draw: Pick<PoolDrawShape, 'phases'>, phaseId: string): string {
  const poolPhases = draw.phases.filter((p) => p.kind === 'pool');
  if (poolPhases.length <= 1) return '';
  const phase = phaseById(draw, phaseId);
  return phase ? `${phase.name}: ` : '';
}

/** Short label for a standing source, e.g. "Pool A 1st", "Overall 5th", "Pool A 1st after Draw 2". */
export function describeStandingSource(
  draw: Pick<PoolDrawShape, 'phases' | 'pools' | 'drawBlocks'>,
  source: Extract<TournamentSlotSource, { sourceType: 'standing' }>,
): string {
  let base: string;
  if (source.poolId) {
    const pool = draw.pools.find((p) => p.id === source.poolId);
    base = `Pool ${pool?.code ?? '?'} ${ordinal(source.rank)}`;
  } else if (source.poolRank != null) {
    base = `${ordinal(source.poolRank)}-ranked pool ${ordinal(source.rank)}`;
  } else {
    base = `Overall ${ordinal(source.rank)}`;
  }
  const block = source.afterDrawBlockId ? draw.drawBlocks.find((b) => b.id === source.afterDrawBlockId) : undefined;
  const after = source.afterDrawBlockId ? ` after ${block?.name ?? 'draw'}` : '';
  return `${phasePrefix(draw, source.phaseId)}${base}${after}`;
}

export function describeQualifierSource(
  draw: Pick<PoolDrawShape, 'phases'>,
  source: Extract<TournamentSlotSource, { sourceType: 'qualifier' }>,
): string {
  return `${phasePrefix(draw, source.phaseId)}Q${source.seed}`;
}
