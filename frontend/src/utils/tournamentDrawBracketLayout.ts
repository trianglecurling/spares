import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentTextNode,
} from './tournamentDrawModel';
import { ordinalPlaceLabel } from './tournamentDrawModel';
import { incomingWinnerFeederIdsSorted } from './tournamentDrawRouting';
import {
  connectionQualifiesForVirtualFeederCard,
  connectionsWithVirtualFeederInto,
  virtualFeederDepthsNeeded,
  virtualFeederPositionId,
} from './tournamentDrawVirtualFeeders';

/** Horizontal pitch between bracket depth columns (larger = more space between rounds). */
export const COL_W = 268;
export const CARD_W = 176;
/** Fits title, schedule hint, competitors, optional result line, and routing row. */
export const CARD_H = 120;
export const GAP_Y = 10;
/** Vertical band reserved for each lane’s event title (must fit heading text in the scene). */
export const LANE_HEADER = 56;
/** Space between the bottom of the lowest game card and the backdrop bottom edge. */
export const LANE_INNER_PAD_BOTTOM = 8;
export const LANE_BOTTOM = 16;
/** Left offset of lane backdrop bands from bracket layout origin (matches `TournamentDrawBracketScene` margin). */
export const BRACKET_LANE_BACKDROP_LEFT_INSET = 4;

export type BracketLayoutMetrics = {
  colW: number;
  cardW: number;
  cardH: number;
  gapY: number;
  laneHeader: number;
  laneInnerPadBottom: number;
  laneBottom: number;
  backdropLeftInset: number;
};

export const SCREEN_BRACKET_LAYOUT_METRICS: BracketLayoutMetrics = {
  colW: COL_W,
  cardW: CARD_W,
  cardH: CARD_H,
  gapY: GAP_Y,
  laneHeader: LANE_HEADER,
  laneInnerPadBottom: LANE_INNER_PAD_BOTTOM,
  laneBottom: LANE_BOTTOM,
  backdropLeftInset: BRACKET_LANE_BACKDROP_LEFT_INSET,
};

/** Compact metrics so a landscape letter page can hold readable event lanes. */
export const PRINT_BRACKET_LAYOUT_METRICS: BracketLayoutMetrics = {
  colW: 186,
  cardW: 158,
  cardH: 40,
  gapY: 6,
  laneHeader: 26,
  laneInnerPadBottom: 4,
  laneBottom: 6,
  backdropLeftInset: 4,
};

export type LayoutBox = { x: number; y: number; w: number; h: number };

export type LaneBand = {
  eventId: string;
  top: number;
  height: number;
  left?: number;
  width?: number;
};

export type LayoutDrawOptions = {
  /**
   * Place events side-by-side when they fit this row width. Order is not
   * preserved: leftover width on any row can take a later (or earlier) event.
   */
  packRowWidth?: number;
  /** Override the default card height for a game (print multi-entry routing). */
  cardHeightForGame?: (g: TournamentGameNode) => number;
};

export const SIDE_BY_SIDE_GUTTER_X = 12;

export type PackableLane = {
  eventId: string;
  width: number;
  height: number;
  order: number;
};

export type PackedLane = {
  eventId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Best-fit shelf pack: widest events first, then fill leftover width on any
 * existing row. Event order is only a tie-break.
 */
export function packLanesSideBySide(
  items: PackableLane[],
  packRowWidth: number,
  options?: { gutterX?: number; rowGap?: number; originY?: number }
): PackedLane[] {
  const gutterX = options?.gutterX ?? SIDE_BY_SIDE_GUTTER_X;
  const rowGap = options?.rowGap ?? 0;
  const originY = options?.originY ?? 0;
  const sorted = [...items].sort((a, b) => b.width - a.width || a.order - b.order);

  type Row = { items: PackableLane[]; usedWidth: number; height: number };
  const rows: Row[] = [];

  for (const item of sorted) {
    let bestIdx = -1;
    let bestWaste = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const nextUsed = row.usedWidth === 0 ? item.width : row.usedWidth + gutterX + item.width;
      const waste = packRowWidth - nextUsed;
      if (waste >= 0 && waste < bestWaste) {
        bestIdx = i;
        bestWaste = waste;
      }
    }
    if (bestIdx < 0) {
      rows.push({ items: [item], usedWidth: item.width, height: item.height });
    } else {
      const row = rows[bestIdx]!;
      row.items.push(item);
      row.usedWidth += gutterX + item.width;
      row.height = Math.max(row.height, item.height);
    }
  }

  const placed: PackedLane[] = [];
  let y = originY;
  for (const row of rows) {
    let x = 0;
    for (const item of row.items) {
      placed.push({
        eventId: item.eventId,
        left: x,
        top: y,
        width: item.width,
        height: item.height,
      });
      x += item.width + gutterX;
    }
    y += row.height + rowGap;
  }
  return placed;
}

function layoutBoxesOverlapVertically(a: LayoutBox, b: LayoutBox): boolean {
  return a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Stack downward until the column does not overlap another card at `columnX`. */
function findVirtualFeederY(
  preferredY: number,
  vid: string,
  columnX: number,
  positions: Record<string, LayoutBox>,
  metrics: BracketLayoutMetrics
): number {
  let y = preferredY;
  for (let attempt = 0; attempt < 48; attempt++) {
    const candidate: LayoutBox = { x: columnX, y, w: metrics.cardW, h: metrics.cardH };
    const clash = Object.entries(positions).some(([id, box]) => {
      if (id === vid || !box) return false;
      if (Math.abs(box.x - columnX) > 1) return false;
      return layoutBoxesOverlapVertically(box, candidate);
    });
    if (!clash) return y;
    y += metrics.cardH + metrics.gapY;
  }
  return preferredY;
}

function placeVirtualFeedersForLane(
  draw: TournamentDrawState,
  evId: string,
  positions: Record<string, LayoutBox>,
  depthToViewCol: Map<number, number>,
  colTop: number,
  metrics: BracketLayoutMetrics
): number {
  let maxVirtualExtent = 0;
  for (const c of draw.connections) {
    if (c.terminalType !== 'game' || !c.toGameId) continue;
    const fromG = draw.games[c.fromGameId];
    const toG = draw.games[c.toGameId];
    if (!fromG || !toG) continue;
    if (fromG.eventId === toG.eventId) continue;
    if (toG.depth <= fromG.depth) continue;
    if (toG.eventId !== evId) continue;
    if (toG.depth <= 0) continue;
    const toPos = positions[toG.id];
    if (!toPos) continue;
    const vd = toG.depth - 1;
    const viewCol = depthToViewCol.get(vd) ?? 0;
    const x = 12 + viewCol * metrics.colW;
    const vid = virtualFeederPositionId(c.id);
    const y0 = findVirtualFeederY(toPos.y, vid, x, positions, metrics);
    positions[vid] = { x, y: y0, w: metrics.cardW, h: metrics.cardH };
    maxVirtualExtent = Math.max(maxVirtualExtent, y0 + metrics.cardH - colTop);
  }
  return maxVirtualExtent;
}

export type BracketLayout = ReturnType<typeof layoutDraw>;

function layoutEventLaneIsolated(
  draw: TournamentDrawState,
  evId: string,
  metrics: BracketLayoutMetrics,
  cardHeightForGame?: (g: TournamentGameNode) => number
): { positions: Record<string, LayoutBox>; width: number; height: number } {
  const { colW, cardW, cardH, gapY, laneHeader, laneInnerPadBottom } = metrics;
  const heightOf = (g: TournamentGameNode) => cardHeightForGame?.(g) ?? cardH;
  const positions: Record<string, LayoutBox> = {};
  const laneTop = 0;
  const laneGames = Object.values(draw.games).filter((g) => g.eventId === evId);
  const virtualDepthsByEvent = virtualFeederDepthsNeeded(draw);
  const baseDepths =
    laneGames.length === 0
      ? [0]
      : Array.from(new Set(laneGames.map((g) => g.depth))).sort((a, b) => a - b);
  const extraDepths = virtualDepthsByEvent.get(evId);
  const depthValues = Array.from(
    new Set([...baseDepths, ...(extraDepths ? [...extraDepths] : [])])
  ).sort((a, b) => a - b);
  const orderedDepths = depthValues;

  const byDepth = new Map<number, TournamentGameNode[]>();
  for (const d of depthValues) byDepth.set(d, []);
  for (const g of laneGames) byDepth.get(g.depth)!.push(g);
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => a.verticalOrder - b.verticalOrder || a.label.localeCompare(b.label));
  }

  const colTop = laneTop + laneHeader;
  const depthsAsc = depthValues;

  const depthToViewCol = new Map<number, number>();
  for (let i = 0; i < orderedDepths.length; i++) {
    depthToViewCol.set(orderedDepths[i]!, i);
  }

  for (const d of depthsAsc) {
    const list = byDepth.get(d) ?? [];
    if (list.length === 0 && laneGames.length === 0 && d === depthsAsc[0]) {
      continue;
    }
    if (list.length === 0) continue;

    const viewCol = depthToViewCol.get(d) ?? 0;
    const x = 12 + viewCol * colW;

    const items: { g: TournamentGameNode; ideal: number }[] = [];
    let leafIdx = 0;
    for (const g of list) {
      const feederIds = incomingWinnerFeederIdsSorted(draw, g.id).filter((id) => positions[id]);
      const h = heightOf(g);
      let ideal: number;
      if (feederIds.length >= 2) {
        const mid =
          feederIds.reduce((s, id) => s + positions[id]!.y + positions[id]!.h / 2, 0) /
          feederIds.length;
        ideal = mid - h / 2;
      } else if (feederIds.length === 1) {
        ideal = positions[feederIds[0]!]!.y;
      } else {
        ideal = colTop + leafIdx * (h + gapY);
        leafIdx++;
      }
      items.push({ g, ideal });
    }

    items.sort((a, b) => a.ideal - b.ideal);
    let prevBottom = colTop - gapY;
    for (const { g, ideal } of items) {
      const h = heightOf(g);
      const y = Math.max(ideal, prevBottom + gapY);
      positions[g.id] = { x, y, w: cardW, h };
      prevBottom = y + h;
    }
  }

  let maxVirtualExtent = placeVirtualFeedersForLane(
    draw,
    evId,
    positions,
    depthToViewCol,
    colTop,
    metrics
  );

  for (const d of depthsAsc) {
    const list = byDepth.get(d) ?? [];
    if (list.length === 0 && laneGames.length === 0 && d === depthsAsc[0]) {
      continue;
    }
    if (list.length === 0) continue;

    const viewCol = depthToViewCol.get(d) ?? 0;
    const x = 12 + viewCol * colW;

    const items: { g: TournamentGameNode; ideal: number }[] = [];
    let leafIdx = 0;
    for (const g of list) {
      const feederIds = incomingWinnerFeederIdsSorted(draw, g.id).filter((id) => positions[id]);
      const virtualCenters = connectionsWithVirtualFeederInto(draw, g.id)
        .map((c) => positions[virtualFeederPositionId(c.id)])
        .filter(Boolean)
        .map((b) => b!.y + b!.h / 2);

      const winnerCenters = feederIds.map((id) => positions[id]!.y + positions[id]!.h / 2);
      const all = [...winnerCenters, ...virtualCenters];
      const h = heightOf(g);

      let ideal: number;
      if (all.length >= 2) {
        ideal = all.reduce((s, u) => s + u, 0) / all.length - h / 2;
      } else if (feederIds.length === 1 && virtualCenters.length === 0) {
        ideal = positions[feederIds[0]!]!.y;
      } else if (all.length === 1) {
        ideal = all[0]! - h / 2;
      } else {
        ideal = colTop + leafIdx * (h + gapY);
        leafIdx++;
      }
      items.push({ g, ideal });
    }

    items.sort((a, b) => a.ideal - b.ideal);
    let prevBottom = colTop - gapY;
    for (const { g, ideal } of items) {
      const h = heightOf(g);
      const y = Math.max(ideal, prevBottom + gapY);
      positions[g.id] = { x, y, w: cardW, h };
      prevBottom = y + h;
    }
  }

  maxVirtualExtent = placeVirtualFeedersForLane(
    draw,
    evId,
    positions,
    depthToViewCol,
    colTop,
    metrics
  );

  let maxExtentBelowHeader = cardH + gapY;
  for (const g of laneGames) {
    const b = positions[g.id];
    if (b) maxExtentBelowHeader = Math.max(maxExtentBelowHeader, b.y + b.h - colTop);
  }
  if (maxVirtualExtent > 0) {
    maxExtentBelowHeader = Math.max(maxExtentBelowHeader, maxVirtualExtent);
  }
  const height = laneHeader + maxExtentBelowHeader + laneInnerPadBottom;
  const numCols = Math.max(1, depthValues.length);
  const width = 12 + numCols * colW + 12;
  return { positions, width, height };
}

function offsetLayoutPositions(
  source: Record<string, LayoutBox>,
  dx: number,
  dy: number
): Record<string, LayoutBox> {
  const next: Record<string, LayoutBox> = {};
  for (const [id, box] of Object.entries(source)) {
    next[id] = { ...box, x: box.x + dx, y: box.y + dy };
  }
  return next;
}

export function layoutDraw(
  draw: TournamentDrawState,
  metrics: BracketLayoutMetrics = SCREEN_BRACKET_LAYOUT_METRICS,
  options?: LayoutDrawOptions
): {
  positions: Record<string, LayoutBox>;
  lanes: LaneBand[];
  width: number;
  height: number;
  metrics: BracketLayoutMetrics;
} {
  const { laneBottom } = metrics;
  const packRowWidth = options?.packRowWidth;
  const cardHeightForGame = options?.cardHeightForGame;
  const positions: Record<string, LayoutBox> = {};
  const lanes: LaneBand[] = [];
  const sortedEvents = [...draw.setup.events].sort((a, b) => a.order - b.order);
  const isolatedById = new Map(
    sortedEvents.map((ev) => [
      ev.id,
      layoutEventLaneIsolated(draw, ev.id, metrics, cardHeightForGame),
    ])
  );

  if (packRowWidth != null) {
    const eventsToPack = sortedEvents.filter((ev) =>
      Object.values(draw.games).some((g) => g.eventId === ev.id)
    );
    const packed = packLanesSideBySide(
      eventsToPack.map((ev) => {
        const isolated = isolatedById.get(ev.id)!;
        return {
          eventId: ev.id,
          width: isolated.width,
          height: isolated.height,
          order: ev.order,
        };
      }),
      packRowWidth,
      { gutterX: SIDE_BY_SIDE_GUTTER_X, rowGap: laneBottom, originY: 8 }
    );
    let maxRight = 0;
    let maxBottom = 8;
    for (const placed of packed) {
      const isolated = isolatedById.get(placed.eventId)!;
      Object.assign(positions, offsetLayoutPositions(isolated.positions, placed.left, placed.top));
      lanes.push({
        eventId: placed.eventId,
        left: placed.left,
        top: placed.top,
        width: placed.width,
        height: placed.height,
      });
      maxRight = Math.max(maxRight, placed.left + placed.width);
      maxBottom = Math.max(maxBottom, placed.top + placed.height);
    }
    return {
      positions,
      lanes,
      width: maxRight,
      height: maxBottom + 8,
      metrics,
    };
  }

  let cursorY = 8;
  let maxRight = 0;
  for (const ev of sortedEvents) {
    const isolated = isolatedById.get(ev.id)!;
    Object.assign(positions, offsetLayoutPositions(isolated.positions, 0, cursorY));
    lanes.push({
      eventId: ev.id,
      left: 0,
      top: cursorY,
      width: isolated.width,
      height: isolated.height,
    });
    maxRight = Math.max(maxRight, isolated.width);
    cursorY += isolated.height + laneBottom;
  }

  for (const lane of lanes) {
    lane.width = maxRight;
  }

  return {
    positions,
    lanes,
    width: maxRight,
    height: lanes.length === 0 ? 16 : cursorY - laneBottom + 8,
    metrics,
  };
}

export function resolveTextNodeLayout(
  node: TournamentTextNode,
  positions: Record<string, LayoutBox>
): { box: LayoutBox; anchorBox: LayoutBox | null } {
  let anchorBox: LayoutBox | null = null;
  if (node.anchorKind === 'game' && node.anchorGameId) {
    anchorBox = positions[node.anchorGameId] ?? null;
  } else if (node.anchorKind === 'virtual' && node.anchorConnectionId) {
    anchorBox = positions[virtualFeederPositionId(node.anchorConnectionId)] ?? null;
  }
  if (node.anchorKind === 'none' || !anchorBox) {
    return {
      box: { x: node.x, y: node.y, w: node.width, h: node.height },
      anchorBox,
    };
  }
  return {
    box: {
      x: anchorBox.x + node.offsetX,
      y: anchorBox.y + node.offsetY,
      w: node.width,
      h: node.height,
    },
    anchorBox,
  };
}

/** Midpoints of top, right, bottom, left edges (clockwise from top). */
function boxEdgeMidpoints(b: LayoutBox): Array<{ x: number; y: number }> {
  const mx = b.x + b.w / 2;
  const my = b.y + b.h / 2;
  return [
    { x: mx, y: b.y },
    { x: b.x + b.w, y: my },
    { x: mx, y: b.y + b.h },
    { x: b.x, y: my },
  ];
}

/**
 * Picks one edge midpoint on `anchor` and one on `text` so Euclidean distance is minimal;
 * returns segment from anchor point → text point.
 */
function shortestTextConnectorEndpoints(
  anchor: LayoutBox,
  text: LayoutBox
): { x1: number; y1: number; x2: number; y2: number } {
  const ea = boxEdgeMidpoints(anchor);
  const eb = boxEdgeMidpoints(text);
  let bestA = ea[0]!;
  let bestB = eb[0]!;
  let bestD = Infinity;
  for (const a of ea) {
    for (const b of eb) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestA = a;
        bestB = b;
      }
    }
  }
  return { x1: bestA.x, y1: bestA.y, x2: bestB.x, y2: bestB.y };
}

/** True if this game is in the last round of its bracket (max depth in that event). */
function isChampionshipMatch(
  g: TournamentGameNode,
  games: Record<string, TournamentGameNode>
): boolean {
  const inEvent = Object.values(games).filter((x) => x.eventId === g.eventId);
  if (inEvent.length === 0) return false;
  const maxDepth = Math.max(...inEvent.map((x) => x.depth));
  return g.depth === maxDepth;
}

/** Non-TBD output routes on the card (W/L for two-way games; 1st/2nd/… for multi-competitor games). */
export function placeRoutingLinesOnCard(
  draw: TournamentDrawState,
  g: TournamentGameNode
): Array<{ key: string; text: string; color?: string }> {
  const k = g.slots.length;
  const lines: Array<{ key: string; text: string; color?: string }> = [];
  for (let p = 1; p <= k; p++) {
    const c = draw.connections.find((x) => x.fromGameId === g.id && x.place === p);
    if (!c || c.terminalType === 'tbd') continue;
    const prefix = k <= 2 ? (p === 1 ? 'W' : 'L') : ordinalPlaceLabel(p);
    if (c.terminalType === 'out') {
      if (k === 2 && p === 2 && isChampionshipMatch(g, draw.games)) continue;
      lines.push({ key: `out-${p}`, text: `${prefix}-Out` });
      continue;
    }
    if (c.terminalType === 'game' && c.toGameId) {
      const to = draw.games[c.toGameId];
      const ev = to ? draw.setup.events.find((e) => e.id === to.eventId) : undefined;
      lines.push({
        key: `g-${p}-${c.toGameId}`,
        text: `${prefix}-${to?.label ?? '?'}`,
        color: ev?.color,
      });
    }
  }
  return lines;
}

export type BracketEdgePath = {
  d: string;
  stroke: string;
  key: string;
  opacity: number;
};

export type BracketEdgePathOptions = {
  /** Same-lane curved edges for non-winner finishes (e.g. loser stays in bracket). */
  includeSecondarySameEventPaths?: boolean;
  /**
   * Source game → virtual feeder card (cross-lane). Public bracket omits these for cross-event
   * wins; team path view turns them on so win/loss routing into another sheet is visible.
   */
  includeVirtualFeederCrossSegments?: boolean;
};

/** Curved bracket edges from each game to the next round (same-event winner paths only). */
export function computeBracketEdgePaths(
  draw: TournamentDrawState,
  layout: { positions: Record<string, LayoutBox>; width: number; height: number },
  options?: BracketEdgePathOptions
): BracketEdgePath[] {
  const { positions } = layout;
  const paths: BracketEdgePath[] = [];

  const midY = (b: LayoutBox) => b.y + b.h / 2;
  const rightX = (b: LayoutBox) => b.x + b.w;

  for (const c of draw.connections) {
    if (c.terminalType !== 'game' || !c.toGameId) continue;

    const fromG = draw.games[c.fromGameId];
    const toG = draw.games[c.toGameId];
    if (!fromG || !toG) continue;

    if (toG.depth <= fromG.depth) continue;

    const sameEvent = fromG.eventId === toG.eventId;
    const isFirstPlaceWinnerPath = c.place === 1 && sameEvent;
    const includeSecondary =
      options?.includeSecondarySameEventPaths === true && sameEvent && c.place > 1;
    const showSourceSegment = isFirstPlaceWinnerPath || includeSecondary;

    const from = positions[c.fromGameId];
    if (!from) continue;
    const to = positions[c.toGameId];
    if (!to) continue;

    const fromEvent = fromG.eventId;
    const stroke = fromEvent
      ? (draw.setup.events.find((e) => e.id === fromEvent)?.color ?? '#0d9488')
      : '#0d9488';
    const opacity = 0.9;

    const vf = positions[virtualFeederPositionId(c.id)];
    const showCrossToVirtualFeeder =
      showSourceSegment ||
      (options?.includeVirtualFeederCrossSegments === true &&
        !!vf &&
        connectionQualifiesForVirtualFeederCard(draw, c));

    if (vf) {
      if (showCrossToVirtualFeeder) {
        const x1a = rightX(from);
        const y1a = midY(from);
        const x2a = vf.x;
        const y2a = midY(vf);
        const cxa = (x1a + x2a) / 2;
        paths.push({
          key: `${c.id}-cross`,
          stroke,
          d: `M ${x1a} ${y1a} C ${cxa} ${y1a}, ${cxa} ${y2a}, ${x2a} ${y2a}`,
          opacity,
        });
      }
      const intoStroke = draw.setup.events.find((e) => e.id === toG.eventId)?.color ?? '#0d9488';
      const x1b = rightX(vf);
      const y1b = midY(vf);
      const x2b = to.x;
      const y2b = midY(to);
      const cxb = (x1b + x2b) / 2;
      paths.push({
        key: `${c.id}-into`,
        stroke: intoStroke,
        d: `M ${x1b} ${y1b} C ${cxb} ${y1b}, ${cxb} ${y2b}, ${x2b} ${y2b}`,
        opacity: 0.9,
      });
    } else {
      if (!showSourceSegment) continue;
      const x1 = rightX(from);
      const y1 = midY(from);
      const x2 = to.x;
      const y2 = midY(to);
      const cx = (x1 + x2) / 2;
      paths.push({
        key: c.id,
        stroke,
        d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
        opacity,
      });
    }
  }

  return paths;
}

export type TextConnectorPath = {
  key: string;
  d: string;
  stroke: string;
};

export function computeTextConnectorPaths(
  draw: TournamentDrawState,
  layout: { positions: Record<string, LayoutBox> }
): TextConnectorPath[] {
  const { positions } = layout;
  const out: TextConnectorPath[] = [];
  for (const tn of draw.textNodes) {
    if (!tn.showConnector) continue;
    if (tn.connectorLineStyle === 'dashed') continue;
    const { box, anchorBox } = resolveTextNodeLayout(tn, positions);
    if (!anchorBox) continue;
    const stroke = tn.connectorColor?.trim() || '#64748b';
    const { x1, y1, x2, y2 } = shortestTextConnectorEndpoints(anchorBox, box);
    out.push({
      key: `text-conn-${tn.id}`,
      stroke,
      d: `M ${x1} ${y1} L ${x2} ${y2}`,
    });
  }
  return out;
}
