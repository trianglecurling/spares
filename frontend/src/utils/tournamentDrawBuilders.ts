import type { TournamentBracketEvent, TournamentDrawState } from './tournamentDrawModel';

const LANE_COLORS = ['#0d9488', '#6366f1', '#d97706', '#db2777', '#64748b', '#059669', '#7c3aed', '#ca8a04'];

export const MAX_BRACKET_EVENT_COUNT = 16;

export function createBracketEvent(code: string, order: number): TournamentBracketEvent {
  return {
    id: `lane-${code.toLowerCase()}`,
    name: `${code} event`,
    code,
    order,
    color: LANE_COLORS[order % LANE_COLORS.length]!,
  };
}

/** Events added after initial setup. Id must not depend on code because codes can be renamed later. */
export function createAddedBracketEvent(code: string, order: number): TournamentBracketEvent {
  return {
    id: crypto.randomUUID(),
    name: `${code} event`,
    code,
    order,
    color: LANE_COLORS[order % LANE_COLORS.length]!,
  };
}

/**
 * Event ids were once derived from code (`lane-${code}`) and are not updated when code changes.
 * Reassign ids for later duplicate rows so games stay with the first event that claimed the id.
 */
export function ensureUniqueBracketEventIds(draw: TournamentDrawState): TournamentDrawState {
  const seen = new Set<string>();
  let changed = false;
  const events = [...draw.setup.events]
    .sort((a, b) => a.order - b.order)
    .map((ev) => {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        return ev;
      }
      changed = true;
      const id = crypto.randomUUID();
      seen.add(id);
      return { ...ev, id };
    });
  if (!changed) return draw;
  return {
    ...draw,
    setup: {
      ...draw.setup,
      events,
    },
  };
}

export function nextAvailableBracketEventCode(existing: TournamentBracketEvent[]): string | null {
  const used = new Set(existing.map((e) => e.code.toUpperCase()));
  for (const letter of 'ABCDEFGHIJKLMNOP') {
    if (!used.has(letter)) return letter;
  }
  return null;
}

export function defaultBracketEvents(count: number) {
  const codes = 'ABCDEFGHIJKLMNOP'.slice(0, count).split('');
  return codes.map((code, i) => createBracketEvent(code, i));
}

export function emptyTournamentDraw(eventCount: number): TournamentDrawState {
  const events = defaultBracketEvents(eventCount);
  return {
    version: 1,
    setup: {
      eventCount,
      events,
    },
    canvas: { zoom: 1, panX: 0, panY: 0 },
    games: {},
    connections: [],
    drawBlocks: [],
    sheets: [],
    textNodes: [],
  };
}
