import { createPool, MAX_POOL_COUNT, nextAvailablePoolCode } from './tournamentDrawBuilders';
import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentPool,
  TournamentSlotSource,
} from './tournamentDrawModel';
import { gamesForPhase, poolsForPhase } from './tournamentDrawPhases';

function replacePool(draw: TournamentDrawState, pool: TournamentPool): TournamentDrawState {
  return { ...draw, pools: draw.pools.map((p) => (p.id === pool.id ? pool : p)) };
}

export function addPoolToPhase(draw: TournamentDrawState, phaseId: string): TournamentDrawState {
  if (draw.pools.length >= MAX_POOL_COUNT) return draw;
  const pools = poolsForPhase(draw, phaseId);
  const code = nextAvailablePoolCode(pools);
  if (!code) return draw;
  const order = pools.length ? Math.max(...pools.map((p) => p.order)) + 1 : 0;
  return { ...draw, pools: [...draw.pools, createPool(phaseId, code, order)] };
}

function clearEntryReferences(draw: TournamentDrawState, entryIds: Set<string>): TournamentDrawState {
  const fix = (s: TournamentSlotSource): TournamentSlotSource =>
    s.sourceType === 'pool_entry' && s.entryId != null && entryIds.has(s.entryId) ? { sourceType: 'tbd' } : s;
  const games: Record<string, TournamentGameNode> = {};
  for (const [id, g] of Object.entries(draw.games)) games[id] = { ...g, slots: g.slots.map(fix) };
  return { ...draw, games };
}

/** Removes a pool and its games; other games that used its entries switch to TBD. */
export function removePool(draw: TournamentDrawState, poolId: string): TournamentDrawState {
  const pool = draw.pools.find((p) => p.id === poolId);
  if (!pool) return draw;
  const entryIds = new Set(pool.entries.map((e) => e.id));
  const games = Object.fromEntries(Object.entries(draw.games).filter(([, g]) => g.poolId !== poolId));
  const phase = draw.phases.find((p) => p.id === pool.phaseId);
  const phases = draw.phases.map((p) =>
    p === phase && p.advancing
      ? { ...p, advancing: p.advancing.filter((s) => !(s.kind === 'pool_place' && s.poolId === poolId)) }
      : p,
  );
  return clearEntryReferences(
    { ...draw, phases, games, pools: draw.pools.filter((p) => p.id !== poolId) },
    entryIds,
  );
}

export function addPoolEntry(
  draw: TournamentDrawState,
  poolId: string,
  source: TournamentSlotSource = { sourceType: 'tbd' },
): TournamentDrawState {
  const pool = draw.pools.find((p) => p.id === poolId);
  if (!pool) return draw;
  return replacePool(draw, { ...pool, entries: [...pool.entries, { id: crypto.randomUUID(), source }] });
}

export function setPoolEntrySource(
  draw: TournamentDrawState,
  poolId: string,
  entryId: string,
  source: TournamentSlotSource,
): TournamentDrawState {
  const pool = draw.pools.find((p) => p.id === poolId);
  if (!pool) return draw;
  return replacePool(draw, {
    ...pool,
    entries: pool.entries.map((e) => (e.id === entryId ? { ...e, source } : e)),
  });
}

/**
 * Reorders entries inside one phase, including moves from one pool to another.
 * Entry objects stay the same, so games that point at an entry id keep that team.
 * Returns the same draw when the request is not a permutation of this phase's entries.
 */
export function arrangePoolEntries(
  draw: TournamentDrawState,
  phaseId: string,
  entryIdsByPoolId: Readonly<Record<string, readonly string[]>>,
): TournamentDrawState {
  const phasePools = poolsForPhase(draw, phaseId);
  const requestedIds = Object.keys(entryIdsByPoolId);
  if (requestedIds.length !== phasePools.length) return draw;
  if (phasePools.some((pool) => entryIdsByPoolId[pool.id] == null)) return draw;

  const byEntry = new Map<string, TournamentPool['entries'][number]>();
  for (const pool of phasePools) {
    for (const entry of pool.entries) byEntry.set(entry.id, entry);
  }

  const seen = new Set<string>();
  for (const poolId of requestedIds) {
    if (!phasePools.some((pool) => pool.id === poolId)) return draw;
    for (const entryId of entryIdsByPoolId[poolId] ?? []) {
      if (!byEntry.has(entryId) || seen.has(entryId)) return draw;
      seen.add(entryId);
    }
  }
  if (seen.size !== byEntry.size) return draw;

  const unchanged = phasePools.every((pool) => {
    const ids = entryIdsByPoolId[pool.id] ?? [];
    return ids.length === pool.entries.length && ids.every((id, index) => pool.entries[index]?.id === id);
  });
  if (unchanged) return draw;

  return {
    ...draw,
    pools: draw.pools.map((pool) => {
      const ids = entryIdsByPoolId[pool.id];
      if (!ids || pool.phaseId !== phaseId) return pool;
      return { ...pool, entries: ids.map((id) => byEntry.get(id)!) };
    }),
  };
}

export function removePoolEntry(draw: TournamentDrawState, poolId: string, entryId: string): TournamentDrawState {
  const pool = draw.pools.find((p) => p.id === poolId);
  if (!pool) return draw;
  const next = replacePool(draw, { ...pool, entries: pool.entries.filter((e) => e.id !== entryId) });
  return clearEntryReferences(next, new Set([entryId]));
}

/** Roster teams not yet placed in this phase, in seed order. */
function unplacedSources(
  draw: TournamentDrawState,
  phaseId: string,
  teamIdsInSeedOrder: number[],
): TournamentSlotSource[] {
  const placed = new Set<string>();
  for (const pool of poolsForPhase(draw, phaseId)) {
    for (const e of pool.entries) placed.add(JSON.stringify(e.source));
  }
  const candidates: TournamentSlotSource[] = teamIdsInSeedOrder.map((id) => ({
    sourceType: 'registration' as const,
    registrationId: id,
  }));
  return candidates.filter((s) => !placed.has(JSON.stringify(s)));
}

/**
 * Fills empty (TBD) entries, then appends, distributing unplaced teams snake-style
 * (A, B, C, C, B, A, …) so pool strength stays balanced.
 */
export function fillPools(
  draw: TournamentDrawState,
  phaseId: string,
  teamIdsInSeedOrder: number[],
): { draw: TournamentDrawState; placed: number } {
  const pools = poolsForPhase(draw, phaseId);
  if (pools.length === 0) return { draw, placed: 0 };
  const queue = unplacedSources(draw, phaseId, teamIdsInSeedOrder);
  if (queue.length === 0) return { draw, placed: 0 };

  const working = pools.map((p) => ({ ...p, entries: [...p.entries] }));
  let placed = 0;
  for (const pool of working) {
    for (let i = 0; i < pool.entries.length && queue.length; i++) {
      if (pool.entries[i]!.source.sourceType === 'tbd') {
        pool.entries[i] = { ...pool.entries[i]!, source: queue.shift()! };
        placed++;
      }
    }
  }
  let round = 0;
  while (queue.length) {
    const order = round % 2 === 0 ? working : [...working].reverse();
    for (const pool of order) {
      const next = queue.shift();
      if (!next) break;
      pool.entries.push({ id: crypto.randomUUID(), source: next });
      placed++;
    }
    round++;
  }
  const byId = new Map(working.map((p) => [p.id, p]));
  return { draw: { ...draw, pools: draw.pools.map((p) => byId.get(p.id) ?? p) }, placed };
}

function nextPoolGameNumber(draw: TournamentDrawState): number {
  let max = 0;
  for (const g of Object.values(draw.games)) {
    const m = /^G(\d+)$/.exec(g.label);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return max + 1;
}

function newPoolGame(
  phaseId: string,
  poolId: string | null,
  number: number,
  slots: [TournamentSlotSource, TournamentSlotSource],
  schedule?: TournamentGameNode['schedule'],
): TournamentGameNode {
  return {
    id: crypto.randomUUID(),
    eventId: phaseId,
    phaseId,
    poolId,
    label: `G${number}`,
    depth: 0,
    verticalOrder: number,
    slots,
    ...(schedule ? { schedule } : {}),
  };
}

/** Same draw as the latest game until its sheets are full, then the next draw. */
function suggestedSchedule(draw: TournamentDrawState, phaseId: string): TournamentGameNode['schedule'] | undefined {
  const blocks = [...draw.drawBlocks].sort((a, b) => a.order - b.order);
  if (blocks.length === 0) return undefined;
  const phaseGames = gamesForPhase(draw, phaseId);
  const latest = [...phaseGames]
    .filter((g) => g.schedule?.drawBlockId)
    .sort((a, b) => {
      const ao = blocks.findIndex((x) => x.id === a.schedule!.drawBlockId);
      const bo = blocks.findIndex((x) => x.id === b.schedule!.drawBlockId);
      return bo - ao;
    })[0];
  let blockIndex = latest ? blocks.findIndex((b) => b.id === latest.schedule!.drawBlockId) : 0;
  if (blockIndex < 0) blockIndex = 0;
  const usedSheets = (blockId: string) =>
    new Set(
      Object.values(draw.games)
        .filter((g) => g.schedule?.drawBlockId === blockId && g.schedule.sheetId != null)
        .map((g) => g.schedule!.sheetId!),
    );
  const sheets = [...draw.sheets].sort((a, b) => a.order - b.order);
  if (sheets.length > 0 && usedSheets(blocks[blockIndex]!.id).size >= sheets.length && blockIndex < blocks.length - 1) {
    blockIndex++;
  }
  const block = blocks[blockIndex]!;
  const used = usedSheets(block.id);
  const sheet = sheets.find((s) => !used.has(s.clubSheetId));
  return {
    drawBlockId: block.id,
    startTime: block.startTime ?? null,
    sheetId: sheet?.clubSheetId ?? null,
    sheetLabel: sheet?.name ?? null,
  };
}

export function addPoolGame(
  draw: TournamentDrawState,
  phaseId: string,
  poolId: string | null,
): { draw: TournamentDrawState; gameId: string } {
  const game = newPoolGame(
    phaseId,
    poolId,
    nextPoolGameNumber(draw),
    [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
    suggestedSchedule(draw, phaseId),
  );
  return { draw: { ...draw, games: { ...draw.games, [game.id]: game } }, gameId: game.id };
}

/** Adds every missing pairing within each pool, ordered by round. Returns how many were added. */
export function addRoundRobinGames(
  draw: TournamentDrawState,
  phaseId: string,
): { draw: TournamentDrawState; added: number } {
  const existing = new Set<string>();
  for (const g of gamesForPhase(draw, phaseId)) {
    const ids = g.slots.map((s) => (s.sourceType === 'pool_entry' ? s.entryId : null));
    if (ids[0] && ids[1]) existing.add([ids[0], ids[1]].sort().join('|'));
  }
  const games = { ...draw.games };
  let number = nextPoolGameNumber(draw);
  let added = 0;
  for (const pool of poolsForPhase(draw, phaseId)) {
    const ids: (string | null)[] = pool.entries.map((e) => e.id);
    if (ids.length < 2) continue;
    if (ids.length % 2 === 1) ids.push(null);
    const n = ids.length;
    const rotating = ids.slice(1);
    for (let round = 0; round < n - 1; round++) {
      const lineup = [ids[0]!, ...rotating];
      for (let i = 0; i < n / 2; i++) {
        const a = lineup[i];
        const b = lineup[n - 1 - i];
        if (!a || !b) continue;
        const key = [a, b].sort().join('|');
        if (existing.has(key)) continue;
        existing.add(key);
        const game = newPoolGame(phaseId, pool.id, number++, [
          { sourceType: 'pool_entry', entryId: a },
          { sourceType: 'pool_entry', entryId: b },
        ]);
        games[game.id] = game;
        added++;
      }
      rotating.unshift(rotating.pop()!);
    }
  }
  return { draw: { ...draw, games }, added };
}

export function removeGame(draw: TournamentDrawState, gameId: string): TournamentDrawState {
  const games = { ...draw.games };
  delete games[gameId];
  const fix = (s: TournamentSlotSource): TournamentSlotSource =>
    s.sourceType === 'game_place' && s.gameId === gameId ? { sourceType: 'tbd' } : s;
  for (const [id, g] of Object.entries(games)) games[id] = { ...g, slots: g.slots.map(fix) };
  return {
    ...draw,
    games,
    connections: draw.connections.filter((c) => c.fromGameId !== gameId && c.toGameId !== gameId),
    pools: draw.pools.map((p) => ({ ...p, entries: p.entries.map((e) => ({ ...e, source: fix(e.source) })) })),
    textNodes: draw.textNodes.filter((t) => t.anchorGameId !== gameId),
  };
}
