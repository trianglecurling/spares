import type { TournamentConnectionEdge, TournamentDrawState, TournamentGameNode } from './tournamentDrawModel';
import { ordinalPlaceLabel } from './tournamentDrawModel';

export const VIRTUAL_FEEDER_PREFIX = 'vf:';

export function virtualFeederPositionId(connectionId: string): string {
  return `${VIRTUAL_FEEDER_PREFIX}${connectionId}`;
}

/** Cross-event feed into a deeper round in the target lane (virtual placeholder applies). */
export function connectionQualifiesForVirtualFeederCard(
  draw: TournamentDrawState,
  c: TournamentConnectionEdge,
): boolean {
  if (c.terminalType !== 'game' || !c.toGameId) return false;
  const fromG = draw.games[c.fromGameId];
  const toG = draw.games[c.toGameId];
  if (!fromG || !toG) return false;
  if (fromG.eventId === toG.eventId) return false;
  if (toG.depth <= fromG.depth) return false;
  if (toG.depth <= 0) return false;
  return true;
}

export function connectionsWithVirtualFeederInto(
  draw: TournamentDrawState,
  toGameId: string,
): TournamentConnectionEdge[] {
  return draw.connections.filter(
    (c) => c.toGameId === toGameId && connectionQualifiesForVirtualFeederCard(draw, c),
  );
}

/** Depth columns that need to exist so cross-event virtual feeder cards can be placed at `to.depth - 1`. */
export function virtualFeederDepthsNeeded(draw: TournamentDrawState): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const c of draw.connections) {
    if (!connectionQualifiesForVirtualFeederCard(draw, c)) continue;
    const toG = draw.games[c.toGameId!];
    if (!toG) continue;
    const vd = toG.depth - 1;
    if (!m.has(toG.eventId)) m.set(toG.eventId, new Set());
    m.get(toG.eventId)!.add(vd);
  }
  return m;
}

/**
 * Short label for the finish being routed (Winner / Loser for 2-way games; 1st / 2nd / … for larger fields).
 */
export function virtualFeederOutcomeLabel(from: TournamentGameNode, place: number): string {
  const k = from.slots.length;
  if (k <= 2) return place === 1 ? 'Winner' : 'Loser';
  return ordinalPlaceLabel(place);
}

export function isVirtualFeederPositionKey(id: string): boolean {
  return id.startsWith(VIRTUAL_FEEDER_PREFIX);
}
