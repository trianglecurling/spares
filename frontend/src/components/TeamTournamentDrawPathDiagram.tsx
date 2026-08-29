import type { RefObject } from 'react';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAlert } from '../contexts/AlertContext';
import { useBracketCanvasView } from '../hooks/useBracketCanvasView';
import type { TournamentDrawState, TournamentGameNode } from '../utils/tournamentDrawModel';
import {
  normalizeDrawState,
  resolveResultsTableSideLabel,
  slotIndexForPlaceAfterResult,
} from '../utils/tournamentDrawRouting';
import { CARD_H, CARD_W, placeRoutingLinesOnCard } from '../utils/tournamentDrawBracketLayout';
import { exportTournamentPathChartPdf } from '../utils/tournamentDrawPdfExport';
import { sheetBadgeGlyph } from '../utils/tournamentDrawPrintCard';
import {
  PRINT_PATH_LAYOUT_METRICS,
  expandTeamPathTree,
  layoutTournamentTeamPathTree,
  routeTeamPathEdge,
  type TeamPathLayoutBox,
  type TeamPathTreeEdge,
  type TeamPathTreeNode,
} from '../utils/tournamentTeamPathLayout';
import {
  competitorLabelsLineSegments,
  orderCompetitorSegmentsFocusedTeamFirst,
} from '../utils/tournamentDrawRouting';
import { outcomeFromResult } from '../utils/tournamentDrawResult';
import {
  formatGameScheduleParts,
  formatGameScheduleSummary,
} from '../utils/tournamentDrawSchedule';
import { formatTeamDisplayName } from '../utils/tournamentDisplay';
import { resolveSheetStoneColorHex } from '../utils/sheetStoneColors';
import type { PublicTournamentDrawTeamRef } from './PublicTournamentDrawBracket';

type Props = {
  draw: TournamentDrawState;
  teamId: number;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  /** When set, canvas is full viewport width and default pan aligns diagram content with this column’s padded left edge (same as public Draw tab). */
  alignContentColumnRef?: RefObject<HTMLElement | null>;
  /** When the bracket canvas is ready, pass `resetView`; pass `null` when unavailable (e.g. no seed). Toolbar is omitted when `alignContentColumnRef` is set. */
  onResetViewReady?: (resetView: (() => void) | null) => void;
  /** When the print scene is ready, pass `exportPdf`; pass `null` when unavailable. */
  onExportPdfReady?: (exportPdf: (() => Promise<void>) | null) => void;
  title?: string;
  filenameBase?: string;
};

const BRACKET_TOOLBAR_BUTTON_CLASS =
  'text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white dark:disabled:hover:bg-gray-800';

const PADDING_X = 16;
const PADDING_BOTTOM = 36;
const COLUMN_TITLE_H = 22;
const COLUMN_TITLE_GAP = 10;
const H_GAP = 80;
const V_GAP = 36;

function collectSeedGameIds(draw: TournamentDrawState, teamId: number): Set<string> {
  const seeds = new Set<string>();
  for (const [id, g] of Object.entries(draw.games)) {
    for (const s of g.slots) {
      if (s.sourceType === 'registration' && s.registrationId === teamId) {
        seeds.add(id);
      }
    }
  }
  return seeds;
}

function collectReachableGameIds(draw: TournamentDrawState, seeds: Set<string>): Set<string> {
  const reachable = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const gid of [...reachable]) {
      for (const c of draw.connections) {
        if (c.fromGameId !== gid) continue;
        if (c.terminalType !== 'game' || !c.toGameId) continue;
        if (!reachable.has(c.toGameId)) {
          reachable.add(c.toGameId);
          changed = true;
        }
      }
    }
  }
  return reachable;
}

function teamFinishedPlaceIfPlayed(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  teamId: number,
  teamsById: Map<number, PublicTournamentDrawTeamRef>
): number | null {
  if (!g.result) return null;
  const label = formatTeamDisplayName(
    teamsById.get(teamId)?.teamName ?? null,
    teamsById.get(teamId)?.sortOrder ?? 0
  );
  const k = g.slots.length;
  for (let place = 1; place <= k; place++) {
    const idx = slotIndexForPlaceAfterResult(g, place);
    if (idx == null) continue;
    const sideLabel = resolveResultsTableSideLabel(draw, g, idx, teamsById);
    if (sideLabel === label) return place;
  }
  return null;
}

function collectStillPossibleGameIds(
  draw: TournamentDrawState,
  teamId: number,
  teamsById: Map<number, PublicTournamentDrawTeamRef>,
  reachable: Set<string>,
  seeds: Set<string>
): Set<string> {
  const possible = new Set<string>();
  const queue: string[] = [...seeds];

  while (queue.length) {
    const gid = queue.shift()!;
    if (!reachable.has(gid)) continue;
    if (possible.has(gid)) continue;
    possible.add(gid);

    const g = draw.games[gid];
    if (!g) continue;

    const outgoing = draw.connections.filter(
      (c) =>
        c.fromGameId === gid && c.terminalType === 'game' && c.toGameId && reachable.has(c.toGameId)
    );

    if (!g.result) {
      for (const c of outgoing) {
        if (!possible.has(c.toGameId!)) queue.push(c.toGameId!);
      }
      continue;
    }

    const tp = teamFinishedPlaceIfPlayed(draw, g, teamId, teamsById);
    if (tp == null) continue;

    const next = outgoing.find((c) => c.place === tp);
    if (next?.toGameId && !possible.has(next.toGameId)) {
      queue.push(next.toGameId);
    }
  }

  return possible;
}

function filterDrawToReachable(
  full: TournamentDrawState,
  reachable: Set<string>
): TournamentDrawState {
  const games: TournamentDrawState['games'] = {};
  for (const id of reachable) {
    const g = full.games[id];
    if (g) games[id] = g;
  }

  const connections = full.connections.filter((c) => {
    if (!reachable.has(c.fromGameId)) return false;
    if (c.terminalType === 'game' && c.toGameId && !reachable.has(c.toGameId)) return false;
    return true;
  });

  const eventIdsUsed = new Set(Object.values(games).map((g) => g.eventId));
  const events = full.setup.events.filter((e) => eventIdsUsed.has(e.id));

  return {
    ...full,
    setup: {
      ...full.setup,
      eventCount: events.length,
      events,
    },
    games,
    connections,
    textNodes: [],
  };
}

function buildMutedConnectionIds(
  draw: TournamentDrawState,
  teamId: number,
  teamsById: Map<number, PublicTournamentDrawTeamRef>,
  reachable: Set<string>,
  stillPossible: Set<string>
): Set<string> {
  const mutedConnectionIds = new Set<string>();
  for (const c of draw.connections) {
    if (!reachable.has(c.fromGameId)) continue;

    const from = draw.games[c.fromGameId];
    if (!from) continue;

    if (!stillPossible.has(c.fromGameId)) {
      mutedConnectionIds.add(c.id);
      continue;
    }

    if (!from.result) continue;

    const tp = teamFinishedPlaceIfPlayed(draw, from, teamId, teamsById);
    if (tp == null) {
      mutedConnectionIds.add(c.id);
      continue;
    }

    if (c.terminalType === 'game' && c.toGameId && c.place !== tp) {
      mutedConnectionIds.add(c.id);
    }
  }

  return mutedConnectionIds;
}

/**
 * Tree nodes still on a viable path from a seed root, following only connections that are not ruled out
 * by known results. The same logical game may appear twice with different viability (e.g. two paths to a final).
 */
function collectViableTreeNodeIds(
  roots: string[],
  edges: Array<{ fromId: string; toId: string; connId: string }>,
  mutedConnectionIds: Set<string>
): Set<string> {
  const outgoing = new Map<string, Array<{ fromId: string; toId: string; connId: string }>>();
  for (const e of edges) {
    const list = outgoing.get(e.fromId);
    if (list) list.push(e);
    else outgoing.set(e.fromId, [e]);
  }

  const viable = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!viable.has(r)) {
      viable.add(r);
      queue.push(r);
    }
  }
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++]!;
    for (const e of outgoing.get(id) ?? []) {
      if (mutedConnectionIds.has(e.connId)) continue;
      if (!viable.has(e.toId)) {
        viable.add(e.toId);
        queue.push(e.toId);
      }
    }
  }
  return viable;
}

function TeamPathSinkCard({
  label,
  muted,
  print,
}: {
  label: string;
  muted: boolean;
  print?: boolean;
}) {
  return (
    <div
      className={
        print
          ? 'text-left rounded-md border border-dashed border-gray-300 bg-gray-50 h-full w-full box-border flex flex-col justify-center p-1.5'
          : 'text-left rounded-lg border shadow-sm p-2 border-dashed border-gray-300 dark:border-gray-500 bg-gray-50/90 dark:bg-gray-900/80 h-full w-full box-border flex flex-col justify-center'
      }
      style={{ opacity: muted ? 0.42 : undefined }}
    >
      <div
        className={
          print
            ? 'text-[10px] font-semibold text-gray-600 text-center leading-tight'
            : 'text-[11px] font-semibold text-gray-600 dark:text-gray-300 text-center leading-tight'
        }
      >
        {label}
      </div>
    </div>
  );
}

/** `draw` must include all connections used to resolve incoming opponents (typically full `normalizeDrawState`, not reachability-filtered). */
function TeamPathGameCard({
  draw,
  g,
  teamsById,
  teamId,
  muted,
  print,
}: {
  draw: TournamentDrawState;
  g: TournamentGameNode;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  teamId: number;
  muted: boolean;
  print?: boolean;
}) {
  const routingLines = print ? [] : placeRoutingLinesOnCard(draw, g);
  const competitorSegments = print
    ? []
    : orderCompetitorSegmentsFocusedTeamFirst(
        draw,
        g,
        competitorLabelsLineSegments(draw, g, teamsById, { rockColorOrder: 'slot' }),
        teamId,
        teamsById
      );
  const schedLine = print ? null : formatGameScheduleSummary(draw, g);
  const printSchedule = print ? formatGameScheduleParts(draw, g) : null;
  const printSheetBadge = printSchedule?.sheetName
    ? sheetBadgeGlyph(printSchedule.sheetName)
    : null;
  const showPrintMeta = print && !!(printSchedule?.drawLine || printSheetBadge);
  const outcome = outcomeFromResult(g);
  const twoSlot = g.slots.length === 2;
  const winnerSlotIdx =
    twoSlot && outcome === 'slot0' ? 0 : twoSlot && outcome === 'slot1' ? 1 : null;
  const loserSlotIdx = winnerSlotIdx === 0 ? 1 : winnerSlotIdx === 1 ? 0 : null;

  return (
    <div
      data-draw-game-card
      data-game-node-id={g.id}
      className={
        print
          ? 'text-left rounded-md border p-1.5 border-gray-300 bg-white h-full w-full box-border'
          : 'text-left rounded-lg border shadow-sm p-2 border-gray-200 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 h-full w-full box-border'
      }
      style={{
        opacity: muted ? 0.42 : undefined,
      }}
    >
      <div
        className={
          print
            ? 'text-[10px] font-bold leading-tight text-gray-900'
            : 'text-xs font-bold text-gray-900 dark:text-gray-100'
        }
      >
        {g.label}
      </div>
      {!print && competitorSegments.length > 0 ? (
        <div className="text-[10px] leading-tight mt-1 min-w-0 line-clamp-2">
          {competitorSegments.map((seg, i) => {
            const si = seg.slotIndex;
            const isWinner = winnerSlotIdx != null && si != null && si === winnerSlotIdx;
            const isLoser = loserSlotIdx != null && si != null && si === loserSlotIdx;
            return (
              <Fragment key={i}>
                {i > 0 ? (
                  <span className="text-gray-500 dark:text-gray-400" aria-hidden>
                    {' v. '}
                  </span>
                ) : null}
                <span
                  style={!isWinner && !isLoser && seg.color ? { color: seg.color } : undefined}
                  className={
                    isWinner
                      ? 'inline font-bold text-gray-950 dark:text-white'
                      : isLoser
                        ? 'font-normal text-gray-500 dark:text-gray-400'
                        : seg.color
                          ? undefined
                          : 'text-gray-600 dark:text-gray-400'
                  }
                >
                  {seg.rockColor ? (
                    <span
                      className="mr-0.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full border border-black/20 align-middle dark:border-white/25"
                      style={{ backgroundColor: resolveSheetStoneColorHex(seg.rockColor) }}
                      aria-hidden
                    />
                  ) : null}
                  {seg.text}
                </span>
              </Fragment>
            );
          })}
        </div>
      ) : null}
      {showPrintMeta ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] leading-none text-teal-800">
          {printSchedule?.drawLine ? (
            <span className="min-w-0 truncate">{printSchedule.drawLine}</span>
          ) : null}
          {printSheetBadge ? (
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-teal-800 text-[8px] font-semibold"
              aria-label={`Sheet ${printSheetBadge}`}
            >
              {printSheetBadge}
            </span>
          ) : null}
        </div>
      ) : schedLine ? (
        <div className="text-[10px] text-teal-700 dark:text-teal-300/90 leading-tight truncate">
          {schedLine}
        </div>
      ) : null}
      {!print && routingLines.length > 0 ? (
        <div className="text-[10px] font-medium tabular-nums mt-1 pt-0.5 border-t border-gray-100 dark:border-gray-700/80 space-y-0.5">
          {routingLines.map((line) => (
            <div key={line.key}>
              <span
                style={line.color ? { color: line.color } : undefined}
                className={line.color ? undefined : 'text-slate-500 dark:text-slate-400'}
              >
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildPathEdgeList(
  edges: TeamPathTreeEdge[],
  geom: {
    positions: Record<string, TeamPathLayoutBox>;
    gridRow: Record<string, number>;
    topBody: number;
    pitch: number;
  },
  mutedConnectionIds: Set<string>,
  viableTreeNodeIds: Set<string>
): Array<{ key: string; connId: string; d: string; muted: boolean }> {
  const edgeList: Array<{ key: string; connId: string; d: string; muted: boolean }> = [];
  for (const e of edges) {
    const a = geom.positions[e.fromId];
    const b = geom.positions[e.toId];
    const srcRow = geom.gridRow[e.fromId];
    const tgtRow = geom.gridRow[e.toId];
    if (!a || !b || srcRow == null || tgtRow == null) continue;
    const muted = mutedConnectionIds.has(e.connId) || !viableTreeNodeIds.has(e.fromId);
    edgeList.push({
      key: `${e.connId}-${e.fromId}-${e.toId}`,
      connId: e.connId,
      d: routeTeamPathEdge(a, b, e.place, {
        srcRow,
        tgtRow,
        topBody: geom.topBody,
        pitch: geom.pitch,
      }),
      muted,
    });
  }
  return edgeList;
}

function TeamPathDiagramScene({
  filteredDraw,
  labelingDraw,
  treeNodes,
  positions,
  width,
  height,
  maxColumn,
  viableTreeNodeIds,
  edgeList,
  teamsById,
  teamId,
  markerId,
  paddingX,
  hGap,
  cardW,
  cardH,
  print,
}: {
  filteredDraw: TournamentDrawState;
  labelingDraw: TournamentDrawState;
  treeNodes: Map<string, TeamPathTreeNode>;
  positions: Record<string, TeamPathLayoutBox>;
  width: number;
  height: number;
  maxColumn: number;
  viableTreeNodeIds: Set<string>;
  edgeList: Array<{ key: string; connId: string; d: string; muted: boolean }>;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  teamId: number;
  markerId: string;
  paddingX: number;
  hGap: number;
  cardW: number;
  cardH: number;
  print?: boolean;
}) {
  return (
    <div style={{ position: 'relative', width, height, background: print ? '#ffffff' : undefined }}>
      <svg
        className={
          print
            ? 'absolute left-0 top-0 pointer-events-none text-slate-600'
            : 'absolute left-0 top-0 pointer-events-none text-slate-600 dark:text-slate-300'
        }
        width={width}
        height={height}
        aria-hidden
      >
        <defs>
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-current" />
          </marker>
        </defs>
        {edgeList.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={print ? 1.5 : 2}
            opacity={e.muted ? 0.28 : 0.92}
            markerEnd={`url(#${markerId})`}
          />
        ))}
      </svg>

      {Array.from({ length: maxColumn + 1 }, (_, col) => (
        <div
          key={col}
          className={
            print
              ? 'absolute text-[10px] font-medium text-gray-500 pointer-events-none'
              : 'absolute text-[11px] font-medium text-gray-500 dark:text-gray-400 pointer-events-none'
          }
          style={{
            left: paddingX + col * (cardW + hGap),
            top: paddingX,
            width: cardW,
            textAlign: 'center',
          }}
        >
          Game {col + 1}
        </div>
      ))}

      {[...treeNodes.values()].map((node) => {
        const box = positions[node.id];
        if (!box) return null;
        const g = node.gameId ? filteredDraw.games[node.gameId] : undefined;
        return (
          <div
            key={node.id}
            className="absolute z-[1]"
            style={{ left: box.x, top: box.y, width: cardW, height: cardH }}
          >
            {g ? (
              <TeamPathGameCard
                draw={labelingDraw}
                g={g}
                teamsById={teamsById}
                teamId={teamId}
                muted={!viableTreeNodeIds.has(node.id)}
                print={print}
              />
            ) : (
              <TeamPathSinkCard
                label={node.sinkLabel ?? 'End'}
                muted={!viableTreeNodeIds.has(node.id)}
                print={print}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Team path: grid layout (Game 1…N by column) with horizontal winner links and drop-then-right links for
 * other outcomes. Same card content as the draw canvas, without event lanes.
 */
export default function TeamTournamentDrawPathDiagram({
  draw: rawDraw,
  teamId,
  teamsById,
  alignContentColumnRef,
  onResetViewReady,
  onExportPdfReady,
  title,
  filenameBase,
}: Props) {
  const { showAlert } = useAlert();
  const printSceneRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const svgMarkerId = useId().replace(/:/g, '');
  const printMarkerId = `${svgMarkerId}-print`;
  const normalized = useMemo(() => normalizeDrawState(rawDraw), [rawDraw]);

  const pathModel = useMemo(() => {
    const seeds = collectSeedGameIds(normalized, teamId);
    if (seeds.size === 0) {
      return { kind: 'no_seed' as const };
    }
    const reachable = collectReachableGameIds(normalized, seeds);
    const stillPossible = collectStillPossibleGameIds(
      normalized,
      teamId,
      teamsById,
      reachable,
      seeds
    );
    const filtered = filterDrawToReachable(normalized, reachable);
    const mutedConnectionIds = buildMutedConnectionIds(
      normalized,
      teamId,
      teamsById,
      reachable,
      stillPossible
    );
    const expansion = expandTeamPathTree(filtered, seeds, reachable);
    const viableTreeNodeIds = collectViableTreeNodeIds(
      expansion.roots,
      expansion.edges,
      mutedConnectionIds
    );
    const geom = layoutTournamentTeamPathTree(filtered, expansion, {
      paddingX: PADDING_X,
      paddingBottom: PADDING_BOTTOM,
      columnTitleH: COLUMN_TITLE_H,
      columnTitleGap: COLUMN_TITLE_GAP,
      hGap: H_GAP,
      vGap: V_GAP,
      cardW: CARD_W,
      cardH: CARD_H,
    });
    const printGeom = layoutTournamentTeamPathTree(filtered, expansion, PRINT_PATH_LAYOUT_METRICS);
    const edgeList = buildPathEdgeList(
      expansion.edges,
      geom,
      mutedConnectionIds,
      viableTreeNodeIds
    );
    const printEdgeList = buildPathEdgeList(
      expansion.edges,
      printGeom,
      mutedConnectionIds,
      viableTreeNodeIds
    );

    return {
      kind: 'ok' as const,
      filteredDraw: filtered,
      /** Full draw (same as `normalizeDrawState` input) — needed so game cards resolve all feeders (e.g. W-A2), not only edges kept in `filtered.connections`. */
      labelingDraw: normalized,
      treeNodes: expansion.nodes,
      positions: geom.positions,
      width: geom.width,
      height: geom.height,
      maxColumn: geom.maxColumn,
      viableTreeNodeIds,
      edgeList,
      printPositions: printGeom.positions,
      printWidth: printGeom.width,
      printHeight: printGeom.height,
      printMaxColumn: printGeom.maxColumn,
      printEdgeList,
    };
  }, [normalized, teamId, teamsById]);

  const bracketView = useBracketCanvasView({
    enabled: pathModel.kind === 'ok',
    attachToken: pathModel.kind === 'ok' ? pathModel.width : 0,
  });
  const { setBaselinePan, snapPanToBaseline, resetView } = bracketView;
  const didSnapInitialPan = useRef(false);

  const exportingRef = useRef(false);
  const handleExportPdf = useCallback(async () => {
    const scene = printSceneRef.current;
    if (!scene || pathModel.kind !== 'ok' || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      await exportTournamentPathChartPdf({
        sceneElement: scene,
        layout: { width: pathModel.printWidth, height: pathModel.printHeight },
        title: title?.trim() || 'Bracket path',
        filenameBase: filenameBase ?? 'tournament',
      });
    } catch {
      showAlert("Couldn't export the bracket path. Try again.", 'error');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [filenameBase, pathModel, showAlert, title]);

  useEffect(() => {
    if (!onResetViewReady) return;
    if (pathModel.kind !== 'ok') {
      onResetViewReady(null);
      return;
    }
    onResetViewReady(() => resetView());
    return () => onResetViewReady(null);
  }, [onResetViewReady, pathModel.kind, resetView]);

  useEffect(() => {
    if (!onExportPdfReady) return;
    if (pathModel.kind !== 'ok') {
      onExportPdfReady(null);
      return;
    }
    onExportPdfReady(handleExportPdf);
    return () => onExportPdfReady(null);
  }, [handleExportPdf, onExportPdfReady, pathModel.kind]);

  useLayoutEffect(() => {
    didSnapInitialPan.current = false;
  }, [teamId]);

  useLayoutEffect(() => {
    if (!alignContentColumnRef || pathModel.kind !== 'ok') return;
    const shell = bracketView.canvasShellRef.current;
    const col = alignContentColumnRef.current;
    if (!shell || !col) return;

    const measureBaseline = () => {
      const shellR = shell.getBoundingClientRect();
      const colR = col.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(col).paddingLeft) || 0;
      const contentLeft = colR.left + padL;
      const x = contentLeft - shellR.left - PADDING_X;
      setBaselinePan({ x, y: 0 });
    };

    measureBaseline();
    if (!didSnapInitialPan.current) {
      snapPanToBaseline();
      didSnapInitialPan.current = true;
    }

    const ro = new ResizeObserver(() => {
      measureBaseline();
    });
    ro.observe(shell);
    ro.observe(col);
    return () => ro.disconnect();
  }, [
    alignContentColumnRef,
    pathModel.kind,
    pathModel.kind === 'ok' ? pathModel.width : 0,
    setBaselinePan,
    snapPanToBaseline,
    bracketView.canvasShellRef,
  ]);

  if (pathModel.kind === 'no_seed') {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        This team is not assigned on the published draw yet, so a bracket path cannot be shown.
      </p>
    );
  }

  const {
    filteredDraw,
    labelingDraw,
    treeNodes,
    positions,
    width,
    height,
    maxColumn,
    viableTreeNodeIds,
    edgeList,
    printPositions,
    printWidth,
    printHeight,
    printMaxColumn,
    printEdgeList,
  } = pathModel;

  const fullPage = !!alignContentColumnRef;
  const sceneProps = {
    filteredDraw,
    labelingDraw,
    treeNodes,
    teamsById,
    teamId,
    viableTreeNodeIds,
  };

  return (
    <div
      className={
        fullPage
          ? 'flex flex-1 min-h-0 flex-col w-full min-w-0 text-gray-700 dark:text-gray-300'
          : 'flex flex-1 min-h-[420px] flex-col w-full min-w-0'
      }
    >
      {!fullPage ? (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className={BRACKET_TOOLBAR_BUTTON_CLASS}
            onClick={() => resetView()}
          >
            Reset view
          </button>
          <button
            type="button"
            className={BRACKET_TOOLBAR_BUTTON_CLASS}
            onClick={() => void handleExportPdf()}
            disabled={exporting}
            aria-busy={exporting}
            aria-label="Export PDF"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      ) : null}
      <div
        ref={bracketView.canvasShellRef}
        className={
          fullPage
            ? 'relative flex-1 min-h-[650px] w-full select-none [&_*]:select-none overflow-hidden bg-white'
            : 'relative flex-1 min-h-[420px] w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 select-none [&_*]:select-none'
        }
      >
        <div
          role="application"
          aria-label="Team bracket path"
          className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={bracketView.beginCanvasPan}
        >
          <div
            style={{
              transform: `translate(${bracketView.displayPan.x}px, ${bracketView.displayPan.y}px) scale(${bracketView.zoom})`,
              transformOrigin: '0 0',
              width,
              minHeight: height,
              position: 'relative',
            }}
          >
            <TeamPathDiagramScene
              {...sceneProps}
              positions={positions}
              width={width}
              height={height}
              maxColumn={maxColumn}
              edgeList={edgeList}
              markerId={svgMarkerId}
              paddingX={PADDING_X}
              hGap={H_GAP}
              cardW={CARD_W}
              cardH={CARD_H}
            />
          </div>
        </div>
      </div>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: -10000,
          top: 0,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        <div
          ref={printSceneRef}
          style={{
            position: 'relative',
            width: printWidth,
            height: printHeight,
            background: '#ffffff',
          }}
        >
          <TeamPathDiagramScene
            {...sceneProps}
            positions={printPositions}
            width={printWidth}
            height={printHeight}
            maxColumn={printMaxColumn}
            edgeList={printEdgeList}
            markerId={printMarkerId}
            paddingX={PRINT_PATH_LAYOUT_METRICS.paddingX}
            hGap={PRINT_PATH_LAYOUT_METRICS.hGap}
            cardW={PRINT_PATH_LAYOUT_METRICS.cardW}
            cardH={PRINT_PATH_LAYOUT_METRICS.cardH}
            print
          />
        </div>
      </div>
    </div>
  );
}
