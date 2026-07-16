/** Client types for bonspiel draw graph (must stay aligned with backend eventTournamentDrawSchema). */

export type TournamentSlotSource =
  | { sourceType: 'tbd' }
  | { sourceType: 'bye' }
  | { sourceType: 'registration'; registrationId?: number | null }
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
      /** When false, end scores are in progress. Omitted or true = game finished. */
      complete?: boolean;
      /** Side (0 or 1) with last stone (hammer) in the first end. */
      firstEndHammerSlot?: 0 | 1;
      /**
       * Doubles only: 1-based end number where each side used their power play.
       * Null / omitted = not used.
       */
      powerPlayEndBySlot?: {
        side0?: number | null;
        side1?: number | null;
      };
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
  /**
   * Which competitor slot throws the sheet’s first stone color (`stoneColor1`).
   * The other two-sided slot gets `stoneColor2`. Omitted = unset.
   */
  rockColor1Slot?: 0 | 1;
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
  /** Club sheet stone colors (copied for public/bracket display). */
  stoneColor1?: string;
  stoneColor2?: string;
};

/** Preferred way to record two-sided game results (scorekeeper). */
export type TournamentResultType = 'pick' | 'score' | 'ends';

/** How rock colors are assigned in the scorekeeper. Omitted → `manual`. */
export type TournamentRockColorMode = 'manual' | 'randomized';

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
  /**
   * How two-sided games are scored in the scorekeeper.
   * Omitted on legacy draws → treat as `pick`.
   */
  resultType?: TournamentResultType;
  /**
   * How rock colors are assigned for two-sided games.
   * Omitted on legacy draws → treat as `manual`.
   */
  rockColorMode?: TournamentRockColorMode;
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
    case 'registration':
      return `reg:${s.registrationId ?? ''}`;
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
  if (v.startsWith('reg:')) {
    const rest = v.slice(4);
    if (rest === '') return { sourceType: 'registration', registrationId: null };
    const n = Number.parseInt(rest, 10);
    return { sourceType: 'registration', registrationId: Number.isFinite(n) ? n : null };
  }
  // Legacy encode form before registrations-as-teams.
  if (v.startsWith('team:')) {
    const rest = v.slice(5);
    if (rest === '') return { sourceType: 'registration', registrationId: null };
    const n = Number.parseInt(rest, 10);
    return { sourceType: 'registration', registrationId: Number.isFinite(n) ? n : null };
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

/** Registration ids (teams) placed directly on a draw game slot. */
export function teamIdsAssignedOnDraw(draw: TournamentDrawState): Set<number> {
  const ids = new Set<number>();
  for (const g of Object.values(draw.games)) {
    for (const slot of g.slots) {
      if (slot.sourceType === 'registration' && slot.registrationId != null) {
        ids.add(slot.registrationId);
      }
    }
  }
  return ids;
}
