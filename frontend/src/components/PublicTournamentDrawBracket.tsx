import type { RefObject } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import TournamentDrawBracketScene from './TournamentDrawBracketScene';
import { useBracketCanvasView } from '../hooks/useBracketCanvasView';
import type { TournamentDrawState } from '../utils/tournamentDrawModel';
import { normalizeDrawState } from '../utils/tournamentDrawRouting';
import {
  BRACKET_LANE_BACKDROP_LEFT_INSET,
  computeBracketEdgePaths,
  computeTextConnectorPaths,
  layoutDraw,
  CARD_W,
  CARD_H,
  LANE_HEADER,
} from '../utils/tournamentDrawBracketLayout';

export type PublicTournamentDrawTeamRef = {
  teamName: string | null;
  sortOrder: number;
};

type PublicTournamentDrawBracketProps = {
  draw: TournamentDrawState;
  teamsById: Map<number, PublicTournamentDrawTeamRef>;
  /** Padded content column (e.g. tab bar wrapper) so the default pan lines up with public page text. */
  alignContentColumnRef?: RefObject<HTMLElement | null>;
};

/**
 * Read-only tournament bracket: shared scene + local pan/zoom (not persisted).
 */
export default function PublicTournamentDrawBracket({
  draw: rawDraw,
  teamsById,
  alignContentColumnRef,
}: PublicTournamentDrawBracketProps) {
  const draw = useMemo(() => normalizeDrawState(rawDraw), [rawDraw]);

  const layout = useMemo(
    () => layoutDraw(draw),
    [draw, CARD_W, CARD_H, LANE_HEADER],
  );

  const edgePaths = useMemo(
    () => computeBracketEdgePaths(draw, layout),
    [draw, layout],
  );

  const textConnectorPaths = useMemo(() => computeTextConnectorPaths(draw, layout), [draw, layout]);

  const bracketView = useBracketCanvasView({ enabled: true, attachToken: layout.width });
  const { setBaselinePan, snapPanToBaseline } = bracketView;
  const didSnapInitialPan = useRef(false);

  useLayoutEffect(() => {
    if (!alignContentColumnRef) return;
    const shell = bracketView.canvasShellRef.current;
    const col = alignContentColumnRef.current;
    if (!shell || !col) return;

    const measureBaseline = () => {
      const shellR = shell.getBoundingClientRect();
      const colR = col.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(col).paddingLeft) || 0;
      const contentLeft = colR.left + padL;
      const x = contentLeft - shellR.left - BRACKET_LANE_BACKDROP_LEFT_INSET;
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
  }, [alignContentColumnRef, layout.width, setBaselinePan, snapPanToBaseline]);

  return (
    <div className="flex flex-1 min-h-0 flex-col w-full min-w-0">
      <div className="shrink-0 max-w-6xl mx-auto px-4 sm:px-6 mb-3 w-full min-w-0 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/80"
          onClick={() => bracketView.resetView()}
        >
          Reset view
        </button>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drag the bracket to pan. Pinch or scroll to zoom.
        </p>
      </div>
      <div
        ref={bracketView.canvasShellRef}
        className="relative flex-1 min-h-[650px] w-full select-none [&_*]:select-none overflow-hidden bg-white"
      >
        <div
          role="application"
          aria-label="Tournament bracket"
          className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={bracketView.beginCanvasPan}
        >
          <div
            style={{
              transform: `translate(${bracketView.displayPan.x}px, ${bracketView.displayPan.y}px) scale(${bracketView.zoom})`,
              transformOrigin: '0 0',
              width: layout.width,
              minHeight: layout.height,
              position: 'relative',
            }}
          >
            <TournamentDrawBracketScene
              draw={draw}
              layout={layout}
              edgePaths={edgePaths}
              textConnectorPaths={textConnectorPaths}
              teamsById={teamsById}
              emptyLaneLabel="No games in this bracket yet."
              interactive={false}
              selectedGameId={null}
              selectedTextNodeId={null}
              onSelectGame={() => {}}
              onSelectTextNode={() => {}}
              viewZoom={bracketView.zoom}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
