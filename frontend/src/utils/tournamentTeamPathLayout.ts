import type { TournamentDrawState } from './tournamentDrawModel';
import { ordinalPlaceLabel } from './tournamentDrawModel';
import { CARD_H, CARD_W } from './tournamentDrawBracketLayout';

export type TeamPathLayoutBox = { x: number; y: number; w: number; h: number };

/** One node in the expanded tree; `gameId` may repeat across different `id`s. Terminal sinks use `gameId: null`. */
export type TeamPathTreeNode = {
  id: string;
  gameId: string | null;
  /** Shown when `gameId` is null (terminal). */
  sinkLabel?: string;
  depth: number;
  parentId: string | null;
  /** Finish place on the edge from the parent; null for roots. */
  placeFromParent: number | null;
};

export type TeamPathTreeEdge = {
  fromId: string;
  toId: string;
  connId: string;
  place: number;
};

type LayoutParams = {
  paddingX: number;
  paddingBottom: number;
  columnTitleH: number;
  columnTitleGap: number;
  hGap: number;
  vGap: number;
  cardW: number;
  cardH: number;
};

const defaultParams: LayoutParams = {
  paddingX: 16,
  paddingBottom: 36,
  columnTitleH: 22,
  columnTitleGap: 10,
  hGap: 80,
  vGap: 36,
  cardW: CARD_W,
  cardH: CARD_H,
};

/** Internal tree node for layout: `x` = grid column, `y` = grid row (after placement). */
type LayoutWorkNode = {
  id: string;
  gameId: string | null;
  sinkLabel?: string;
  num_outputs: number;
  /** One entry per finish place; `null` = omitted terminal (not shown), e.g. TBD or L-Out. */
  outputs: (LayoutWorkNode | null)[];
  /** Subtree height — unused after grid layout; kept for struct compatibility. */
  height: number;
  /** Grid column (0 = left). */
  x: number;
  /** Grid row (0 = top). */
  y: number;
};

type GridPos = { row: number; col: number };

type CellFlags = { winning_placed: boolean; losing_placed: boolean };

function connectionForPlace(draw: TournamentDrawState, fromGameId: string, place: number) {
  return draw.connections.find((c) => c.fromGameId === fromGameId && c.place === place);
}

function terminalSinkLabel(
  fromGame: { id: string; slots: { length: number } },
  place: number,
  terminalType: 'tbd' | 'out',
): string {
  const k = fromGame.slots.length;
  if (terminalType === 'tbd') return 'TBD';
  const prefix = k <= 2 ? (place === 1 ? 'W' : 'L') : ordinalPlaceLabel(place);
  return `${prefix}-Out`;
}

/**
 * Phase 1 — Expand reachable subgraph into a tree: one LayoutNode per visit; terminal outputs become sinks.
 */
function expandGame(
  draw: TournamentDrawState,
  gameId: string,
  reachable: Set<string>,
  makeId: () => string,
): LayoutWorkNode {
  const g = draw.games[gameId];
  const k = g?.slots.length ?? 0;
  const id = makeId();
  const node: LayoutWorkNode = {
    id,
    gameId,
    num_outputs: Math.max(0, k),
    outputs: [],
    height: 1,
    x: 0,
    y: 0,
  };

  if (!g || k === 0) {
    node.num_outputs = 0;
    return node;
  }

  for (let place = 1; place <= k; place++) {
    const c = connectionForPlace(draw, gameId, place);
    if (!c || c.terminalType === 'tbd') {
      // Omit TBD terminals from the team path diagram (no card, no arrow).
      node.outputs.push(null);
    } else if (c.terminalType === 'out') {
      const outLabel = terminalSinkLabel(g, place, 'out');
      if (outLabel === 'L-Out') {
        // Omit loser-out for typical two-team games (same as TBD: no dashed card / edge).
        node.outputs.push(null);
      } else {
        const sid = makeId();
        node.outputs.push({
          id: sid,
          gameId: null,
          sinkLabel: outLabel,
          num_outputs: 0,
          outputs: [],
          height: 1,
          x: 0,
          y: 0,
        });
      }
    } else if (c.terminalType === 'game' && c.toGameId && reachable.has(c.toGameId)) {
      node.outputs.push(expandGame(draw, c.toGameId, reachable, makeId));
    } else {
      const sid = makeId();
      node.outputs.push({
        id: sid,
        gameId: null,
        sinkLabel: '—',
        num_outputs: 0,
        outputs: [],
        height: 1,
        x: 0,
        y: 0,
      });
    }
  }

  node.num_outputs = node.outputs.length;
  return node;
}

function flattenWorkTree(
  node: LayoutWorkNode,
  parentId: string | null,
  placeFromParent: number | null,
  treeDepth: number,
  nodes: Map<string, TeamPathTreeNode>,
  edges: TeamPathTreeEdge[],
  draw: TournamentDrawState,
): void {
  nodes.set(node.id, {
    id: node.id,
    gameId: node.gameId,
    sinkLabel: node.sinkLabel,
    depth: treeDepth,
    parentId,
    placeFromParent,
  });

  const g = node.gameId ? draw.games[node.gameId] : undefined;
  for (let i = 0; i < node.outputs.length; i++) {
    const place = i + 1;
    const child = node.outputs[i];
    if (child == null) continue;
    const c = g ? connectionForPlace(draw, g.id, place) : undefined;
    const connId = c?.id ?? `synthetic:${node.id}->${child.id}:${place}`;
    edges.push({ fromId: node.id, toId: child.id, connId, place });
    flattenWorkTree(child, node.id, place, treeDepth + 1, nodes, edges, draw);
  }
}

/**
 * Expand the team's reachable subgraph into a forest: each outgoing branch gets its own target
 * instance (DAG → tree). Outputs are ordered by finish place 1..k; `out` / `tbd` become leaf sinks.
 */
export function expandTeamPathTree(
  draw: TournamentDrawState,
  seeds: Set<string>,
  reachable: Set<string>,
): {
  nodes: Map<string, TeamPathTreeNode>;
  edges: TeamPathTreeEdge[];
  roots: string[];
  /** Roots of the internal layout tree (same structure as expanded forest). */
  layoutRoots: LayoutWorkNode[];
} {
  const nodes = new Map<string, TeamPathTreeNode>();
  const edges: TeamPathTreeEdge[] = [];
  let idCounter = 0;
  const makeId = (): string => {
    idCounter += 1;
    return `tpn-${idCounter}`;
  };

  const seedList = [...seeds].filter((s) => reachable.has(s));
  seedList.sort((a, b) =>
    (draw.games[a]?.label ?? a).localeCompare(draw.games[b]?.label ?? b, undefined, { numeric: true }),
  );

  const layoutRoots: LayoutWorkNode[] = [];
  const roots: string[] = [];

  for (const gameId of seedList) {
    const w = expandGame(draw, gameId, reachable, makeId);
    layoutRoots.push(w);
    roots.push(w.id);
    flattenWorkTree(w, null, null, 0, nodes, edges, draw);
  }

  return { nodes, edges, roots, layoutRoots };
}

/**
 * Index every node under `root` for grid placement (single-tree perspective).
 */
function indexSubtree(root: LayoutWorkNode): Map<string, LayoutWorkNode> {
  const nodeById = new Map<string, LayoutWorkNode>();
  const visit = (n: LayoutWorkNode): void => {
    nodeById.set(n.id, n);
    for (const ch of n.outputs) {
      if (ch) visit(ch);
    }
  };
  visit(root);
  return nodeById;
}

function buildGridForRoot(root: LayoutWorkNode, rowOffset: number): { maxLocalRow: number } {
  const nodeById = indexSubtree(root);
  const pos = new Map<string, GridPos>();
  const flags = new Map<string, CellFlags>();

  const isOccupied = (r: number, c: number): boolean => {
    for (const p of pos.values()) {
      if (p.row === r && p.col === c) return true;
    }
    return false;
  };

  const isRowEmpty = (r: number): boolean => {
    for (const p of pos.values()) {
      if (p.row === r) return false;
    }
    return true;
  };

  const findFirstEmptyRowBelow = (startRow: number): number => {
    let r = startRow + 1;
    while (!isRowEmpty(r)) r += 1;
    return r;
  };

  const winningExtensionIsPending = (id: string): boolean => {
    const n = nodeById.get(id);
    if (!n || !n.outputs[0]) return false;
    const f = flags.get(id);
    if (!f || f.winning_placed) return false;
    const p = pos.get(id);
    if (!p) return false;
    return !isOccupied(p.row, p.col + 1);
  };

  const placeWinningCell = (id: string): void => {
    const n = nodeById.get(id)!;
    const p = pos.get(id)!;
    const f = flags.get(id)!;
    const winner = n.outputs[0];
    if (!winner) return;
    const targetRow = p.row;
    const targetCol = p.col + 1;
    if (isOccupied(targetRow, targetCol)) {
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        console.warn(
          `[TeamPathLayout] winning placement collision at (${targetRow},${targetCol}) from ${id}`,
        );
      }
      return;
    }
    pos.set(winner.id, { row: targetRow, col: targetCol });
    flags.set(winner.id, { winning_placed: false, losing_placed: false });
    f.winning_placed = true;
  };

  const placeAllWinningCells = (): void => {
    for (;;) {
      let placedAny = false;
      for (const id of pos.keys()) {
        if (!winningExtensionIsPending(id)) continue;
        placeWinningCell(id);
        placedAny = true;
      }
      if (!placedAny) break;
    }
  };

  const selectNextUnprocessedCellForLosing = (): string | null => {
    const candidates: string[] = [];
    for (const id of pos.keys()) {
      const n = nodeById.get(id)!;
      const f = flags.get(id)!;
      if (f.losing_placed) continue;
      if (n.outputs.length < 2) continue;
      if (!n.outputs.slice(1).some((o) => o != null)) continue;
      candidates.push(id);
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      if (pa.row !== pb.row) return pb.row - pa.row;
      return pb.col - pa.col;
    });
    return candidates[0]!;
  };

  const placeLosingCells = (id: string): void => {
    const n = nodeById.get(id)!;
    const pc = pos.get(id)!;
    const f = flags.get(id)!;
    for (let i = 1; i < n.outputs.length; i++) {
      const losing = n.outputs[i];
      if (losing == null) continue;
      const targetRow = findFirstEmptyRowBelow(pc.row);
      const targetCol = pc.col + 1;
      if (isOccupied(targetRow, targetCol)) {
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          console.warn(
            `[TeamPathLayout] losing placement collision at (${targetRow},${targetCol}) from ${id}`,
          );
        }
        continue;
      }
      pos.set(losing.id, { row: targetRow, col: targetCol });
      flags.set(losing.id, { winning_placed: false, losing_placed: false });
    }
    f.losing_placed = true;
  };

  pos.set(root.id, { row: 0, col: 0 });
  flags.set(root.id, { winning_placed: false, losing_placed: false });

  placeAllWinningCells();
  for (;;) {
    const target = selectNextUnprocessedCellForLosing();
    if (target == null) break;
    placeLosingCells(target);
    placeAllWinningCells();
  }

  let maxLocalRow = 0;
  for (const [id, p] of pos) {
    const node = nodeById.get(id)!;
    node.x = p.col;
    node.y = p.row + rowOffset;
    maxLocalRow = Math.max(maxLocalRow, p.row);
  }

  return { maxLocalRow };
}

/**
 * Assign grid columns and rows: winning paths extend right; losing paths drop to the next fully empty row
 * in the next column, processed bottom-to-top / right-to-left for losing placement rounds.
 */
function assignGridLayoutForest(layoutRoots: LayoutWorkNode[]): void {
  let rowOffset = 0;
  for (const root of layoutRoots) {
    const { maxLocalRow } = buildGridForRoot(root, rowOffset);
    rowOffset += maxLocalRow + 1;
  }
}

function verifyLayoutInvariants(layoutRoots: LayoutWorkNode[], edges: TeamPathTreeEdge[]): void {
  if (typeof import.meta === 'undefined' || !import.meta.env?.DEV) return;

  const byId = new Map<string, LayoutWorkNode>();
  const collect = (n: LayoutWorkNode): void => {
    byId.set(n.id, n);
    for (const ch of n.outputs) {
      if (ch) collect(ch);
    }
  };
  for (const r of layoutRoots) collect(r);

  const pos = new Map<string, string>();
  for (const n of byId.values()) {
    const key = `${n.x},${n.y}`;
    if (pos.has(key)) {
      console.warn(`[TeamPathLayout] duplicate grid cell ${key}: ${pos.get(key)} vs ${n.id}`);
    }
    pos.set(key, n.id);
  }

  for (const e of edges) {
    const a = byId.get(e.fromId);
    const b = byId.get(e.toId);
    if (!a || !b) continue;
    if (b.x !== a.x + 1) {
      console.warn(
        `[TeamPathLayout] edge target not in next column: ${e.fromId} (${a.x},${a.y}) -> ${e.toId} (${b.x},${b.y})`,
      );
    }
    if (e.place === 1 && a.y !== b.y) {
      console.warn(`[TeamPathLayout] primary edge not horizontal row: ${e.fromId} y=${a.y} -> ${e.toId} y=${b.y}`);
    }
    if (e.place >= 2 && b.y <= a.y) {
      console.warn(`[TeamPathLayout] non-primary edge must go strictly down: ${e.fromId} -> ${e.toId}`);
    }
  }
}

/**
 * Grid layout: each tree node is one cell; winners extend to (row, col+1); non-winners go to the next fully
 * empty row in column col+1, with losing rounds processed bottom-to-top, right-to-left. Multiple seed roots
 * are stacked vertically with a one-row gap.
 */
export function layoutTournamentTeamPathTree(
  _draw: TournamentDrawState,
  expansion: {
    nodes: Map<string, TeamPathTreeNode>;
    edges: TeamPathTreeEdge[];
    roots: string[];
    layoutRoots: LayoutWorkNode[];
  },
  params: Partial<LayoutParams> = {},
): {
  positions: Record<string, TeamPathLayoutBox>;
  width: number;
  height: number;
  maxColumn: number;
  /** Grid row index per tree node (for Phase 5 routing). */
  gridRow: Record<string, number>;
  topBody: number;
  pitch: number;
} {
  const p = { ...defaultParams, ...params };
  const { layoutRoots, edges } = expansion;

  if (expansion.nodes.size === 0) {
    const topBody = p.paddingX + p.columnTitleH + p.columnTitleGap;
    return {
      positions: {},
      width: p.paddingX * 2,
      height: topBody + p.paddingBottom,
      maxColumn: 0,
      gridRow: {},
      topBody,
      pitch: p.cardH + p.vGap,
    };
  }

  assignGridLayoutForest(layoutRoots);
  verifyLayoutInvariants(layoutRoots, edges);

  const topBody = p.paddingX + p.columnTitleH + p.columnTitleGap;
  const pitch = p.cardH + p.vGap;

  let maxColIdx = 0;
  const gridRow: Record<string, number> = {};
  const positions: Record<string, TeamPathLayoutBox> = {};

  const emit = (n: LayoutWorkNode): void => {
    maxColIdx = Math.max(maxColIdx, n.x);
    gridRow[n.id] = n.y;
    positions[n.id] = {
      x: p.paddingX + n.x * (p.cardW + p.hGap),
      y: topBody + n.y * pitch,
      w: p.cardW,
      h: p.cardH,
    };
    for (const ch of n.outputs) {
      if (ch) emit(ch);
    }
  };
  for (const r of layoutRoots) emit(r);

  let maxRow = 0;
  for (const id of Object.keys(gridRow)) {
    maxRow = Math.max(maxRow, gridRow[id]!);
  }
  const maxBottom = topBody + maxRow * pitch + p.cardH;
  const width = p.paddingX * 2 + (maxColIdx + 1) * p.cardW + maxColIdx * p.hGap;
  const height = maxBottom + p.paddingBottom;

  return {
    positions,
    width,
    height,
    maxColumn: maxColIdx,
    gridRow,
    topBody,
    pitch,
  };
}

/**
 * SVG path for grid edges: arrow rule 1 (horizontal same row) or arrow rule 2 (down source column to target
 * row midline, then across to the target’s left edge). Uses actual `srcRow` / `tgtRow` from the layout.
 */
export function routeTeamPathEdge(
  a: TeamPathLayoutBox,
  b: TeamPathLayoutBox,
  place: number,
  opts: { srcRow: number; tgtRow: number; topBody: number; pitch: number },
): string {
  const { srcRow, tgtRow, topBody, pitch } = opts;
  const yCenter = (row: number) => topBody + row * pitch + a.h / 2;

  if (place === 1) {
    const sxR = a.x + a.w;
    const syC = yCenter(srcRow);
    const txL = b.x;
    return `M ${sxR} ${syC} L ${txL} ${syC}`;
  }

  const xRail = a.x + a.w / 2;
  const yStart = a.y + a.h;
  const yMid = yCenter(tgtRow);
  const txL = b.x;
  return `M ${xRail} ${yStart} L ${xRail} ${yMid} L ${txL} ${yMid}`;
}
