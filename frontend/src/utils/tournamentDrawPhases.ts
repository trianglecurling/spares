import type { TournamentDrawState, TournamentGameNode, TournamentPhase } from './tournamentDrawModel';
import { sortedPhases } from '../../../backend/src/utils/tournamentPoolStandings';

export {
  computePhaseStandings,
  DEFAULT_POOL_STANDINGS_SETTINGS,
  findPoolEntry,
  isPoolPhaseGame,
  poolEntryCode,
  poolSettings,
  poolsForPhase,
  resolveSourceDetail,
  sortedPhases,
  type PhaseStandings,
  type PoolStandingRow,
} from '../../../backend/src/utils/tournamentPoolStandings';

export function phasesInOrder(draw: TournamentDrawState): TournamentPhase[] {
  return sortedPhases(draw.phases);
}

export function firstBracketPhaseId(draw: TournamentDrawState): string | null {
  return phasesInOrder(draw).find((p) => p.kind === 'bracket')?.id ?? null;
}

/** Phases before `phaseId` (earlier in tournament order). */
export function earlierPhases(draw: TournamentDrawState, phaseId: string): TournamentPhase[] {
  const order = draw.phases.find((p) => p.id === phaseId)?.order ?? Number.POSITIVE_INFINITY;
  return phasesInOrder(draw).filter((p) => p.order < order);
}

/**
 * The draw as one bracket phase's canvas sees it: only that phase's bracket events (lanes) and notes.
 * Games stay complete so competitor labels can resolve earlier phases (pools, seeds).
 */
export function bracketPhaseView(draw: TournamentDrawState, phaseId: string): TournamentDrawState {
  const events = draw.setup.events.filter((e) => e.phaseId === phaseId);
  const fallbackPhase = firstBracketPhaseId(draw);
  return {
    ...draw,
    setup: { eventCount: events.length, events },
    textNodes: draw.textNodes.filter((tn) => (tn.phaseId ?? fallbackPhase) === phaseId),
  };
}

/** Games for a phase, sorted by draw, then label. */
export function gamesForPhase(draw: TournamentDrawState, phaseId: string): TournamentGameNode[] {
  const blockOrder = new Map(draw.drawBlocks.map((b) => [b.id, b.order]));
  const order = (g: TournamentGameNode) =>
    g.schedule?.drawBlockId ? (blockOrder.get(g.schedule.drawBlockId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  return Object.values(draw.games)
    .filter((g) => g.phaseId === phaseId)
    .sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function hasPoolPhase(draw: TournamentDrawState | null | undefined): boolean {
  return !!draw?.phases.some((p) => p.kind === 'pool');
}
