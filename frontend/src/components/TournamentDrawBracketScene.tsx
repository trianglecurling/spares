import { Fragment } from 'react';
import type { TournamentDrawState } from '../utils/tournamentDrawModel';
import {
  competitorLabelsLineSegments,
  resolveVirtualFeederCompetitorLabel,
} from '../utils/tournamentDrawRouting';
import { outcomeFromResult } from '../utils/tournamentDrawResult';
import { formatGameScheduleSummary } from '../utils/tournamentDrawSchedule';
import { resolveSheetStoneColorHex } from '../utils/sheetStoneColors';
import type {
  BracketEdgePath,
  BracketLayout,
  TextConnectorPath,
} from '../utils/tournamentDrawBracketLayout';
import {
  BRACKET_LANE_BACKDROP_LEFT_INSET,
  CARD_W,
  CARD_H,
  LANE_HEADER,
  layoutDraw,
  placeRoutingLinesOnCard,
  resolveTextNodeLayout,
} from '../utils/tournamentDrawBracketLayout';
import {
  connectionQualifiesForVirtualFeederCard,
  virtualFeederOutcomeLabel,
  virtualFeederPositionId,
} from '../utils/tournamentDrawVirtualFeeders';

/** Bracket SVG path keys use `id`, `id-cross`, or `id-into` per connection. */
export function bracketPathKeyToConnectionId(key: string): string {
  if (key.endsWith('-cross')) return key.slice(0, -'-cross'.length);
  if (key.endsWith('-into')) return key.slice(0, -'-into'.length);
  return key;
}

export type TournamentDrawBracketTeamRef = {
  teamName: string | null;
  sortOrder: number;
};

export type TournamentDrawBracketSceneProps = {
  draw: TournamentDrawState;
  layout: BracketLayout;
  edgePaths: BracketEdgePath[];
  textConnectorPaths: TextConnectorPath[];
  teamsById: Map<number, TournamentDrawBracketTeamRef>;
  emptyLaneLabel: string;
  interactive: boolean;
  selectedGameId: string | null;
  selectedTextNodeId: string | null;
  onSelectGame: (gameId: string) => void;
  onSelectTextNode: (textNodeId: string) => void;
  viewZoom: number;
  updateDraw?: (fn: (d: TournamentDrawState) => TournamentDrawState) => void;
  /** Muted games / connections (e.g. bracket paths no longer available for a team). */
  teamPathDim?: {
    mutedGameIds: Set<string>;
    mutedConnectionIds: Set<string>;
  };
  /** Hide event lane backdrops and headers (team path column view). */
  hideLaneChrome?: boolean;
  /** Hide dashed virtual feeder cards (team path draws game-to-game lines instead). */
  hideVirtualFeederCards?: boolean;
};

export default function TournamentDrawBracketScene({
  draw,
  layout,
  edgePaths,
  textConnectorPaths,
  teamsById,
  emptyLaneLabel,
  interactive,
  selectedGameId,
  selectedTextNodeId,
  onSelectGame,
  onSelectTextNode,
  viewZoom,
  updateDraw,
  teamPathDim,
  hideLaneChrome = false,
  hideVirtualFeederCards = false,
}: TournamentDrawBracketSceneProps) {
  const textNoteEditing = interactive && updateDraw != null;

  return (
    <>
      <svg
        className="absolute left-0 top-0 pointer-events-none text-gray-800 dark:text-gray-200"
        width={layout.width}
        height={layout.height}
        aria-hidden
      >
        {edgePaths.map((p) => {
          const connId = bracketPathKeyToConnectionId(p.key);
          const muted = teamPathDim?.mutedConnectionIds.has(connId) ?? false;
          return (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={muted ? '#94a3b8' : p.stroke}
              strokeWidth={2}
              opacity={muted ? 0.28 : p.opacity}
            />
          );
        })}
        {textConnectorPaths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.stroke}
            strokeWidth={1.75}
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}
      </svg>
      {!hideLaneChrome
        ? layout.lanes.map((lane) => {
            const ev = draw.setup.events.find((e) => e.id === lane.eventId);
            const laneGames = Object.values(draw.games).filter((g) => g.eventId === lane.eventId);
            return (
              <div key={lane.eventId}>
                <div
                  className="absolute left-0 rounded-md bg-white/50 dark:bg-gray-800/40 border border-gray-200/80 dark:border-gray-700/80"
                  style={{
                    top: lane.top,
                    width: layout.width - 8,
                    height: lane.height,
                    marginLeft: BRACKET_LANE_BACKDROP_LEFT_INSET,
                    borderLeftWidth: 4,
                    borderLeftColor: ev?.color ?? '#64748b',
                  }}
                >
                  <div
                    className="px-3 py-2 text-xl font-bold leading-tight tracking-tight"
                    style={{ color: ev?.color ?? '#64748b' }}
                  >
                    {ev?.name}
                  </div>
                </div>
                {laneGames.length === 0 ? (
                  <div
                    className="absolute rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 p-2 flex items-center justify-center"
                    style={{
                      left: 12,
                      top: lane.top + LANE_HEADER,
                      width: CARD_W,
                      height: CARD_H,
                    }}
                  >
                    {emptyLaneLabel}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}
      {!hideVirtualFeederCards
        ? draw.connections.map((c) => {
        const vfId = virtualFeederPositionId(c.id);
        const box = layout.positions[vfId];
        if (!box) return null;
        const fromG = draw.games[c.fromGameId];
        if (!fromG) return null;
        const sourceEv = draw.setup.events.find((e) => e.id === fromG.eventId);
        const accent = sourceEv?.color ?? '#64748b';
        const feederTeamLabel = resolveVirtualFeederCompetitorLabel(draw, fromG, c.place, teamsById);
        const body = (
          <>
            <div className="text-xs font-bold leading-tight truncate" style={{ color: accent }}>
              {fromG.label}
            </div>
            <div className="text-[10px] font-medium text-gray-800 dark:text-gray-100 mt-0.5">
              {virtualFeederOutcomeLabel(fromG, c.place)}
            </div>
            {feederTeamLabel ? (
              <div className="text-[9px] text-gray-600 dark:text-gray-400 mt-0.5 truncate leading-tight">
                {feederTeamLabel}
              </div>
            ) : null}
          </>
        );
        const vfMuted = teamPathDim?.mutedConnectionIds.has(c.id) ?? false;
        const style = {
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderColor: accent,
          opacity: vfMuted ? 0.42 : undefined,
        };
        if (interactive) {
          return (
            <button
              key={vfId}
              type="button"
              data-virtual-feeder-card
              data-virtual-connection-id={c.id}
              data-virtual-feeder-source-game-id={fromG.id}
              className="absolute z-0 rounded-lg border border-dashed p-2 text-left shadow-sm bg-white/80 dark:bg-gray-900/55 cursor-pointer transition-colors hover:bg-white dark:hover:bg-gray-900/75"
              style={style}
              aria-label={`Select source game ${fromG.label}`}
              onClick={(e) => {
                if (e.detail === 0) onSelectGame(fromG.id);
              }}
            >
              {body}
            </button>
          );
        }
        return (
          <div
            key={vfId}
            data-virtual-feeder-card
            data-virtual-connection-id={c.id}
            data-virtual-feeder-source-game-id={fromG.id}
            className="absolute z-0 rounded-lg border border-dashed p-2 text-left shadow-sm bg-white/80 dark:bg-gray-900/55"
            style={style}
          >
            {body}
          </div>
        );
      })
        : null}
      {Object.values(draw.games).map((g) => {
        const box = layout.positions[g.id];
        if (!box) return null;
        const selected = g.id === selectedGameId;
        const routingLines = placeRoutingLinesOnCard(draw, g);
        const competitorSegments = competitorLabelsLineSegments(draw, g, teamsById);
        const schedLine = formatGameScheduleSummary(draw, g);
        const outcome = outcomeFromResult(g);
        const twoSlot = g.slots.length === 2;
        const winnerSlotIdx =
          twoSlot && outcome === 'slot0' ? 0 : twoSlot && outcome === 'slot1' ? 1 : null;
        const loserSlotIdx = winnerSlotIdx === 0 ? 1 : winnerSlotIdx === 1 ? 0 : null;
        const cardBody = (
          <>
            <div className="text-xs font-bold text-gray-900 dark:text-gray-100">{g.label}</div>
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
            {schedLine ? (
              <div className="text-[10px] text-teal-700 dark:text-teal-300/90 leading-tight truncate">
                {schedLine}
              </div>
            ) : null}
            {routingLines.length > 0 ? (
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
          </>
        );
        const gameMuted = teamPathDim?.mutedGameIds.has(g.id) ?? false;
        const cardStyle = {
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          opacity: gameMuted ? 0.42 : undefined,
        };
        if (interactive) {
          return (
            <button
              key={g.id}
              type="button"
              data-draw-game-card
              data-game-node-id={g.id}
              className={[
                'absolute text-left rounded-lg border shadow-sm p-2 transition-colors z-[1]',
                selected
                  ? 'border-primary-teal ring-2 ring-primary-teal/30 bg-white/93 dark:bg-gray-800/93'
                  : 'border-gray-200 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 hover:border-primary-teal/50',
              ].join(' ')}
              style={cardStyle}
              onClick={(e) => {
                if (e.detail === 0) onSelectGame(g.id);
              }}
            >
              {cardBody}
            </button>
          );
        }
        return (
          <div
            key={g.id}
            data-draw-game-card
            data-game-node-id={g.id}
            className="absolute text-left rounded-lg border shadow-sm p-2 z-[1] border-gray-200 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90"
            style={cardStyle}
          >
            {cardBody}
          </div>
        );
      })}
      {draw.textNodes.map((tn) => {
        const { box } = resolveTextNodeLayout(tn, layout.positions);
        const selected = tn.id === selectedTextNodeId;
        if (!textNoteEditing) {
          return (
            <div
              key={tn.id}
              role="note"
              data-text-node
              data-text-node-id={tn.id}
              className="absolute z-[2] flex flex-col overflow-hidden rounded-md border bg-amber-50/95 text-gray-900 shadow-sm dark:bg-amber-950/90 dark:text-amber-50 border-amber-200/90 dark:border-amber-700/80"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
              }}
            >
              <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5 text-xs leading-snug whitespace-pre-wrap">
                {tn.text || '…'}
              </div>
            </div>
          );
        }
        return (
          <div
            key={tn.id}
            role="presentation"
            data-text-node
            data-text-node-id={tn.id}
            className={[
              'absolute z-[2] flex flex-col overflow-hidden rounded-md border bg-amber-50/95 text-gray-900 shadow-sm dark:bg-amber-950/90 dark:text-amber-50',
              selected
                ? 'border-primary-teal ring-2 ring-primary-teal/35'
                : 'border-amber-200/90 dark:border-amber-700/80',
            ].join(' ')}
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
            }}
            onClick={(e) => {
              if (e.detail === 0) onSelectTextNode(tn.id);
            }}
          >
            <div
              data-text-drag-handle
              className="flex shrink-0 cursor-grab items-center gap-1 border-b border-amber-200/80 bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-900/90 active:cursor-grabbing dark:border-amber-800/60 dark:bg-amber-900/50 dark:text-amber-100/90"
              onPointerDown={(e) => {
                e.preventDefault();
                if (e.button !== 0) return;
                const z = viewZoom;
                let lastX = e.clientX;
                let lastY = e.clientY;
                const tid = tn.id;
                const onMove = (ev: PointerEvent) => {
                  const dx = (ev.clientX - lastX) / z;
                  const dy = (ev.clientY - lastY) / z;
                  lastX = ev.clientX;
                  lastY = ev.clientY;
                  updateDraw!((d) => ({
                    ...d,
                    textNodes: d.textNodes.map((t) => {
                      if (t.id !== tid) return t;
                      if (t.anchorKind === 'none') {
                        return { ...t, x: t.x + dx, y: t.y + dy };
                      }
                      return { ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy };
                    }),
                  }));
                };
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                  window.removeEventListener('pointercancel', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
              }}
            >
              <span aria-hidden className="inline-block select-none opacity-60">
                ⋮⋮
              </span>
              <span className="truncate">Move</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5 text-xs leading-snug whitespace-pre-wrap">
              {tn.text || '…'}
            </div>
            <button
              type="button"
              data-text-anchor-handle
              title="Drag and release on a game or virtual feeder card to anchor; release on empty space to detach"
              className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-white text-[11px] shadow-sm hover:bg-amber-50 dark:border-amber-700 dark:bg-amber-950 dark:hover:bg-amber-900"
              aria-label="Anchor to node"
              onPointerDown={(e) => {
                e.preventDefault();
                if (e.button !== 0) return;
                const textId = tn.id;
                const onUp = (pev: PointerEvent) => {
                  window.removeEventListener('pointerup', onUp);
                  window.removeEventListener('pointercancel', onUp);
                  const els = document.elementsFromPoint(pev.clientX, pev.clientY);
                  let hitGame: string | null = null;
                  let hitVirtual: string | null = null;
                  for (const el of els) {
                    if (!(el instanceof Element)) continue;
                    if (el.closest(`[data-text-node-id="${textId}"]`)) continue;
                    const gEl = el.closest('[data-game-node-id]');
                    const gid = gEl?.getAttribute('data-game-node-id');
                    if (gid) {
                      hitGame = gid;
                      break;
                    }
                  }
                  if (!hitGame) {
                    for (const el of els) {
                      if (!(el instanceof Element)) continue;
                      if (el.closest(`[data-text-node-id="${textId}"]`)) continue;
                      const vEl = el.closest('[data-virtual-connection-id]');
                      const vid = vEl?.getAttribute('data-virtual-connection-id');
                      if (vid) {
                        hitVirtual = vid;
                        break;
                      }
                    }
                  }
                  updateDraw!((d) => {
                    const textNode = d.textNodes.find((t) => t.id === textId);
                    if (!textNode) return d;
                    const positions = layoutDraw(d).positions;
                    const curBox = resolveTextNodeLayout(textNode, positions).box;
                    return {
                      ...d,
                      textNodes: d.textNodes.map((t) => {
                        if (t.id !== textId) return t;
                        if (hitGame) {
                          const ab = positions[hitGame];
                          if (!ab) return t;
                          return {
                            ...t,
                            anchorKind: 'game',
                            anchorGameId: hitGame,
                            anchorConnectionId: null,
                            offsetX: curBox.x - ab.x,
                            offsetY: curBox.y - ab.y,
                          };
                        }
                        if (hitVirtual) {
                          const c = d.connections.find((x) => x.id === hitVirtual);
                          if (!c || !connectionQualifiesForVirtualFeederCard(d, c)) {
                            return {
                              ...t,
                              anchorKind: 'none',
                              anchorGameId: null,
                              anchorConnectionId: null,
                              x: curBox.x,
                              y: curBox.y,
                              offsetX: 0,
                              offsetY: 0,
                            };
                          }
                          const ab = positions[virtualFeederPositionId(hitVirtual)];
                          if (!ab) return t;
                          return {
                            ...t,
                            anchorKind: 'virtual',
                            anchorGameId: null,
                            anchorConnectionId: hitVirtual,
                            offsetX: curBox.x - ab.x,
                            offsetY: curBox.y - ab.y,
                          };
                        }
                        return {
                          ...t,
                          anchorKind: 'none',
                          anchorGameId: null,
                          anchorConnectionId: null,
                          x: curBox.x,
                          y: curBox.y,
                          offsetX: 0,
                          offsetY: 0,
                        };
                      }),
                    };
                  });
                };
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
              }}
            >
              ◎
            </button>
          </div>
        );
      })}
    </>
  );
}
