/** Client types for bonspiel draw graph (must stay aligned with backend eventTournamentDrawSchema). */

export type TournamentSlotSource =
  | { sourceType: 'tbd' }
  | { sourceType: 'bye' }
  | { sourceType: 'team'; teamId?: number | null }
  | { sourceType: 'game_place'; gameId?: string | null; place: number };

export type TournamentBracketEvent = {
  id: string;
  name: string;
  code: string;
  order: number;
  color: string;
};

/** Stored outcome for a game (aligned with backend tournamentGameResultSchema). */
export type TournamentGameResult =
  | { entryKind: 'pick_winner'; winnerSlot: 0 | 1 }
  | { entryKind: 'final_score'; finalScores: [number, number] }
  | {
      entryKind: 'ends';
      ends: { side0: number[]; side1: number[] };
    }
  /** 3+ competitors: total score per slot; highest score is 1st place (tie-break: lower slot index). */
  | { entryKind: 'multi_score'; scores: number[] };

export type TournamentGameNode = {
  id: string;
  eventId: string;
  label: string;
  depth: number;
  verticalOrder: number;
  /** Competitor entries (min 2). Outputs/routing use the same count (place 1 = best). */
  slots: TournamentSlotSource[];
  notes?: string;
  schedule?: {
    drawBlockId?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    sheetId?: number | null;
    sheetLabel?: string | null;
  };
  /** Optional recorded result (Results tab). */
  result?: TournamentGameResult;
  layout?: { x?: number; y?: number };
};

/** One finish position from `fromGameId` (1 = best). Replaces legacy winner/loser. */
export type TournamentConnectionEdge = {
  id: string;
  fromGameId: string;
  place: number;
  toGameId?: string | null;
  toSlotPosition?: 1 | 2 | null;
  terminalType: 'game' | 'out' | 'tbd';
};

/**
 * Sheets available for this tournament.
 * `clubSheetId` is a positive club ice sheet id from Manage sheets, or a negative integer for ad-hoc sheets only on this draw.
 */
export type TournamentSheet = {
  clubSheetId: number;
  name: string;
  order: number;
};

export type TournamentDrawState = {
  version: 1;
  setup: {
    eventCount: number;
    events: TournamentBracketEvent[];
  };
  canvas: {
    zoom: number;
    panX: number;
    panY: number;
  };
  games: Record<string, TournamentGameNode>;
  connections: TournamentConnectionEdge[];
  drawBlocks: Array<{
    id: string;
    name: string;
    startTime?: string | null;
    endTime?: string | null;
    order: number;
  }>;
  sheets: TournamentSheet[];
  /** Free-form labels/notes on the bracket canvas. */
  textNodes: TournamentTextNode[];
};

/** `anchorKind: 'none'` uses `x`/`y` in layout space; anchored kinds use offsets from the target node’s top-left. */
export type TournamentTextNode = {
  id: string;
  text: string;
  width: number;
  height: number;
  x: number;
  y: number;
  anchorKind: 'none' | 'game' | 'virtual';
  anchorGameId?: string | null;
  /** Connection id whose virtual card (`vf:<id>`) is the anchor target. */
  anchorConnectionId?: string | null;
  offsetX: number;
  offsetY: number;
  showConnector: boolean;
  connectorLineStyle: 'solid' | 'dashed';
  connectorColor?: string;
};

export function encodeSlotSource(s: TournamentSlotSource): string {
  switch (s.sourceType) {
    case 'tbd':
      return 'tbd';
    case 'bye':
      return 'bye';
    case 'team':
      return `team:${s.teamId ?? ''}`;
    case 'game_place': {
      const gid = s.gameId ?? '';
      const p = s.place;
      return `gp:${gid}:${p}`;
    }
    default:
      return 'tbd';
  }
}

export function decodeSlotSource(v: string): TournamentSlotSource {
  if (v === 'tbd') return { sourceType: 'tbd' };
  if (v === 'bye') return { sourceType: 'bye' };
  if (v.startsWith('team:')) {
    const rest = v.slice(5);
    if (rest === '') return { sourceType: 'team', teamId: null };
    const n = Number.parseInt(rest, 10);
    return { sourceType: 'team', teamId: Number.isFinite(n) ? n : null };
  }
  if (v.startsWith('gp:')) {
    const rest = v.slice(3);
    const colon = rest.indexOf(':');
    const gid = colon >= 0 ? rest.slice(0, colon) : rest;
    const pl = colon >= 0 ? Number.parseInt(rest.slice(colon + 1), 10) : 1;
    return {
      sourceType: 'game_place',
      gameId: gid || null,
      place: Number.isFinite(pl) && pl >= 1 ? pl : 1,
    };
  }
  if (v.startsWith('gw:')) {
    const gid = v.slice(3);
    return { sourceType: 'game_place', gameId: gid || null, place: 1 };
  }
  if (v.startsWith('gl:')) {
    const gid = v.slice(3);
    return { sourceType: 'game_place', gameId: gid || null, place: 2 };
  }
  return { sourceType: 'tbd' };
}

/** Human label for a finish rank (1 → 1st, 2 → 2nd, …). */
export function ordinalPlaceLabel(n: number): string {
  const k = Math.floor(n);
  if (k <= 0) return String(n);
  const j = k % 10;
  const k100 = k % 100;
  if (j === 1 && k100 !== 11) return `${k}st`;
  if (j === 2 && k100 !== 12) return `${k}nd`;
  if (j === 3 && k100 !== 13) return `${k}rd`;
  return `${k}th`;
}

/** Label for routing UI: W/L when the source game has 2 competitors; otherwise ordinal. */
export function outputRoutingLabel(place: number, competitorCount: number): string {
  if (competitorCount <= 2) {
    return place === 1 ? 'Winner advances to' : 'Loser drops to';
  }
  return `${ordinalPlaceLabel(place)} place goes to`;
}
