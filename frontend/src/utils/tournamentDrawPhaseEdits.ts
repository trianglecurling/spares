import {
  createAddedBracketEvent,
  createPhase,
  createPool,
  MAX_BRACKET_EVENT_COUNT,
  nextAvailableBracketEventCode,
} from './tournamentDrawBuilders';
import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentPhaseKind,
  TournamentSlotSource,
} from './tournamentDrawModel';
import { firstBracketPhaseId, phasesInOrder } from './tournamentDrawPhases';

/** Appends a phase (with one starter lane or pool). Returns the new phase id. */
export function addPhaseToDraw(
  draw: TournamentDrawState,
  kind: TournamentPhaseKind,
): { draw: TournamentDrawState; phaseId: string } {
  const order = draw.phases.length ? Math.max(...draw.phases.map((p) => p.order)) + 1 : 0;
  const phase = createPhase(kind, order);
  let next: TournamentDrawState = { ...draw, phases: [...draw.phases, phase] };
  if (kind === 'pool') {
    next = { ...next, pools: [...next.pools, createPool(phase.id, 'A', 0)] };
  } else if (draw.setup.events.length < MAX_BRACKET_EVENT_COUNT) {
    const code = nextAvailableBracketEventCode(draw.setup.events);
    if (code) {
      const events = [...draw.setup.events, createAddedBracketEvent(code, 0, phase.id)];
      next = { ...next, setup: { eventCount: events.length, events } };
    }
  }
  return { draw: next, phaseId: phase.id };
}

export function movePhaseInDraw(draw: TournamentDrawState, phaseId: string, delta: -1 | 1): TournamentDrawState {
  const ordered = phasesInOrder(draw);
  const i = ordered.findIndex((p) => p.id === phaseId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ordered.length) return draw;
  const swapped = [...ordered];
  [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
  return { ...draw, phases: swapped.map((p, order) => ({ ...p, order })) };
}

/** Removes a phase with its lanes, pools, games, and notes; references to them become TBD. */
export function removePhaseFromDraw(draw: TournamentDrawState, phaseId: string): TournamentDrawState {
  if (draw.phases.length <= 1) return draw;
  const fallbackTextPhase = firstBracketPhaseId(draw);
  const removedGames = new Set(Object.values(draw.games).filter((g) => g.phaseId === phaseId).map((g) => g.id));
  const removedPools = draw.pools.filter((p) => p.phaseId === phaseId);
  const removedEntries = new Set(removedPools.flatMap((p) => p.entries.map((e) => e.id)));

  const fix = (s: TournamentSlotSource): TournamentSlotSource => {
    if (s.sourceType === 'game_place' && s.gameId != null && removedGames.has(s.gameId)) return { sourceType: 'tbd' };
    if (s.sourceType === 'pool_entry' && s.entryId != null && removedEntries.has(s.entryId)) {
      return { sourceType: 'tbd' };
    }
    if ((s.sourceType === 'standing' || s.sourceType === 'qualifier') && s.phaseId === phaseId) {
      return { sourceType: 'tbd' };
    }
    return s;
  };

  const games: Record<string, TournamentGameNode> = {};
  for (const [id, g] of Object.entries(draw.games)) {
    if (removedGames.has(id)) continue;
    games[id] = { ...g, slots: g.slots.map(fix) };
  }
  const connections = draw.connections
    .filter((c) => !removedGames.has(c.fromGameId))
    .map((c) =>
      c.toGameId && removedGames.has(c.toGameId)
        ? { id: c.id, fromGameId: c.fromGameId, place: c.place, terminalType: 'tbd' as const }
        : c,
    );
  const events = draw.setup.events.filter((e) => e.phaseId !== phaseId);
  const pools = draw.pools
    .filter((p) => p.phaseId !== phaseId)
    .map((p) => ({ ...p, entries: p.entries.map((e) => ({ ...e, source: fix(e.source) })) }));
  const textNodes = draw.textNodes
    .map((tn) => ({ ...tn, phaseId: tn.phaseId ?? fallbackTextPhase ?? undefined }))
    .filter((tn) => tn.phaseId !== phaseId);
  const phases = phasesInOrder(draw)
    .filter((p) => p.id !== phaseId)
    .map((p, order) => ({ ...p, order }));

  return {
    ...draw,
    phases,
    pools,
    games,
    connections,
    textNodes,
    setup: { eventCount: events.length, events },
  };
}
