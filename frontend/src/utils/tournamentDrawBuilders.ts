import type { TournamentDrawState } from './tournamentDrawModel';

const LANE_COLORS = ['#0d9488', '#6366f1', '#d97706', '#db2777', '#64748b', '#059669', '#7c3aed', '#ca8a04'];

export function defaultBracketEvents(count: number) {
  const codes = 'ABCDEFGHIJKLMNOP'.slice(0, count).split('');
  return codes.map((code, i) => ({
    id: `lane-${code.toLowerCase()}`,
    name: `${code} event`,
    code,
    order: i,
    color: LANE_COLORS[i % LANE_COLORS.length]!,
  }));
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
