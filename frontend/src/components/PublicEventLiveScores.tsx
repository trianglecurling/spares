import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IoHammer } from 'react-icons/io5';
import { RockColorSwatch } from './tournament/ScorekeeperRockColorControl';
import {
  consecutiveFilledEndCount,
  entriesFromEndsArrays,
  visibleEndsLayout,
  type EndScoreEntry,
} from './tournament/ScorekeeperEndsEditor';
import type { TournamentDrawState, TournamentGameNode } from '../utils/tournamentDrawModel';
import {
  buildResultsTableRows,
  endsResultIsComplete,
  formatMultiCompetitorResultsLine,
  formatMultiCompetitionIntroLine,
  gameHasRecordedResult,
  gameIsLive,
  type TournamentResultsTableRow,
} from '../utils/tournamentDrawResultsRows';
import { outcomeFromResult, sumEnds } from '../utils/tournamentDrawResult';
import { normalizeDrawState } from '../utils/tournamentDrawRouting';
import { resolveDrawResultType } from '../utils/tournamentResultType';
import {
  displaySlotOrder,
  gameCanHaveRockColors,
  sheetColorsForGame,
  stoneColorForLogicalSlot,
} from '../utils/tournamentRockColors';
import type { TournamentFormat } from '../utils/tournamentDisplay';
import type { TournamentTeamApi } from '../types/tournamentTeam';
import { hammerSlotForEnd } from '../utils/tournamentEndsHammer';

type Props = {
  draw: TournamentDrawState;
  teams: TournamentTeamApi[];
  tournamentFormat: TournamentFormat;
  /** `Date.now()` adjustment so live badges match server time. */
  serverOffsetMs?: number;
};

function formatBlockTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-700 dark:bg-red-950/40 dark:text-red-200">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      Live
    </span>
  );
}

/**
 * Read-only public scoreboard for a published tournament draw (scorekeeper-shaped cards).
 */
export default function PublicEventLiveScores({
  draw: rawDraw,
  teams,
  tournamentFormat,
  serverOffsetMs = 0,
}: Props) {
  /** Re-evaluate live badges as wall clock advances past draw start times. */
  const [nowMs, setNowMs] = useState(() => Date.now() + serverOffsetMs);
  useEffect(() => {
    setNowMs(Date.now() + serverOffsetMs);
    const id = window.setInterval(() => setNowMs(Date.now() + serverOffsetMs), 30_000);
    return () => window.clearInterval(id);
  }, [serverOffsetMs]);

  const draw = useMemo(() => normalizeDrawState(rawDraw), [rawDraw]);
  const rows = useMemo(() => buildResultsTableRows(draw, teams), [draw, teams]);
  const teamsById = useMemo(
    () => new Map(teams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }])),
    [teams],
  );
  const resultType = resolveDrawResultType(draw);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">No games are on the draw yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3" role="list" aria-label="Live scores">
      {rows.map((row) => (
        <LiveScoreGameCard
          key={row.game.id}
          row={row}
          draw={draw}
          teamsById={teamsById}
          resultType={resultType}
          tournamentFormat={tournamentFormat}
          nowMs={nowMs}
        />
      ))}
    </div>
  );
}

function LiveScoreGameCard({
  row,
  draw,
  teamsById,
  resultType,
  tournamentFormat,
  nowMs,
}: {
  row: TournamentResultsTableRow;
  draw: TournamentDrawState;
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>;
  resultType: ReturnType<typeof resolveDrawResultType>;
  tournamentFormat: TournamentFormat;
  nowMs: number;
}) {
  const { game } = row;
  const multi = game.slots.length >= 3;
  const completed = gameHasRecordedResult(game);
  const live = gameIsLive(draw, game, nowMs);
  const outcome = outcomeFromResult(game);
  const tie = outcome === 'tie';
  const fs = game.result?.entryKind === 'final_score' ? game.result.finalScores : null;
  const endsTot =
    game.result?.entryKind === 'ends'
      ? [sumEnds(game.result.ends.side0), sumEnds(game.result.ends.side1)]
      : null;
  const multiLine = multi ? formatMultiCompetitorResultsLine(draw, game, teamsById) : null;
  const block = game.schedule?.drawBlockId
    ? draw.drawBlocks.find((b) => b.id === game.schedule?.drawBlockId)
    : null;
  const timeLabel = formatBlockTime(block?.startTime);
  const sheetColors = sheetColorsForGame(draw, game);
  const canRock = !multi && gameCanHaveRockColors(draw, game);
  const [display0, display1] = displaySlotOrder(game);
  const labelFor = (logical: 0 | 1) => (logical === 0 ? row.comp0 : row.comp1);
  const stoneFor = (logical: 0 | 1) =>
    sheetColors ? stoneColorForLogicalSlot(game, logical, sheetColors) : null;
  const rockLeading = (logical: 0 | 1): ReactNode => {
    if (!canRock || !sheetColors) return null;
    const stone = stoneFor(logical);
    return stone ? <RockColorSwatch color={stone} /> : null;
  };

  return (
    <div
      role="listitem"
      className={`rounded-xl border p-4 ${
        live
          ? 'border-red-200 bg-white shadow-sm dark:border-red-900/50 dark:bg-gray-900'
          : completed
            ? 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40'
            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
          <span className="font-semibold text-gray-900 dark:text-gray-100">Game {game.label}</span>
          <span>Draw {row.drawLabel}</span>
          <span>{row.sheetLabel}</span>
          {timeLabel ? <span>{timeLabel}</span> : null}
        </div>
        {live ? <LiveBadge /> : null}
      </div>

      {multi ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {multiLine ?? formatMultiCompetitionIntroLine(draw, game, teamsById)}
          </p>
          {!multiLine ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No scores yet.</p>
          ) : null}
        </div>
      ) : resultType === 'ends' || game.result?.entryKind === 'ends' ? (
        <ReadOnlyEndsBoard
          game={game}
          label0={row.comp0}
          label1={row.comp1}
          tournamentFormat={tournamentFormat}
          sheetColors={sheetColors}
        />
      ) : resultType === 'score' || game.result?.entryKind === 'final_score' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([display0, display1] as const).map((logical) => {
            const isWin =
              (logical === 0 ? outcome === 'slot0' : outcome === 'slot1') && !tie;
            const score =
              fs != null
                ? fs[logical]
                : endsTot != null
                  ? endsTot[logical]
                  : null;
            return (
              <div
                key={logical}
                className={`min-h-[3.5rem] rounded-xl border px-4 py-3 ${
                  isWin
                    ? 'border-primary-teal bg-primary-teal/15 font-semibold text-gray-900 dark:bg-primary-teal/25 dark:text-gray-100'
                    : tie
                      ? 'border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/20'
                      : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800'
                }`}
              >
                <div className="flex items-start gap-2">
                  {rockLeading(logical)}
                  <span className="block min-w-0 flex-1 text-base leading-snug">
                    {labelFor(logical)}
                  </span>
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {score != null ? score : '—'}
                </div>
                {tie && logical === display0 ? (
                  <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                    Tie
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([display0, display1] as const).map((logical) => {
            const isWin =
              (logical === 0 ? outcome === 'slot0' : outcome === 'slot1') && !tie;
            const scoreHint =
              fs != null
                ? String(fs[logical])
                : endsTot != null
                  ? String(endsTot[logical])
                  : null;
            return (
              <div
                key={logical}
                className={`flex min-h-[3.5rem] flex-col items-center justify-center rounded-xl border px-4 py-3 text-center ${
                  isWin
                    ? 'border-primary-teal bg-primary-teal/15 font-semibold text-gray-900 dark:bg-primary-teal/25 dark:text-gray-100'
                    : tie
                      ? 'border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/20'
                      : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  {rockLeading(logical)}
                  <span className="min-w-0 text-base leading-snug">
                    {labelFor(logical)}
                  </span>
                </div>
                {scoreHint ? (
                  <span className="mt-1 text-sm tabular-nums text-gray-500 dark:text-gray-400">
                    Score {scoreHint}
                  </span>
                ) : null}
                {tie && logical === display0 ? (
                  <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                    Tie
                  </span>
                ) : null}
                {!isWin && !tie && outcome == null && game.result == null ? (
                  <span className="mt-1 text-sm text-gray-400 dark:text-gray-500">
                    —
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReadOnlyEndsBoard({
  game,
  label0,
  label1,
  tournamentFormat,
  sheetColors,
}: {
  game: TournamentGameNode;
  label0: string;
  label1: string;
  tournamentFormat: TournamentFormat;
  sheetColors: ReturnType<typeof sheetColorsForGame>;
}) {
  const result = game.result?.entryKind === 'ends' ? game.result : null;
  /** Same as scorekeeper: keep sheet color1 on top; swap teams + scores together. */
  const swap = game.rockColor1Slot === 1;
  const visualLabel0 = swap ? label1 : label0;
  const visualLabel1 = swap ? label0 : label1;
  const toVisualEntries = (logical: Array<EndScoreEntry | null>) =>
    swap
      ? logical.map((e) => (e ? { side0: e.side1, side1: e.side0 } : null))
      : logical;
  const toVisualSlot = (logical: 0 | 1 | null): 0 | 1 | null => {
    if (logical == null) return null;
    if (!swap) return logical;
    return logical === 0 ? 1 : 0;
  };

  const logicalEntries: Array<EndScoreEntry | null> = result
    ? entriesFromEndsArrays(result.ends.side0, result.ends.side1)
    : [];
  const entries = toVisualEntries(logicalEntries);
  const gameComplete = endsResultIsComplete(result);
  const { columnCount, xColumnIndex } = visibleEndsLayout(entries, gameComplete);
  const filled = consecutiveFilledEndCount(entries);
  const total0 = entries.slice(0, filled).reduce((sum, e) => sum + (e?.side0 ?? 0), 0);
  const total1 = entries.slice(0, filled).reduce((sum, e) => sum + (e?.side1 ?? 0), 0);
  const hammerLogical =
    result?.firstEndHammerSlot === 0 || result?.firstEndHammerSlot === 1
      ? result.firstEndHammerSlot
      : null;
  const firstEndHammerSlot = toVisualSlot(hammerLogical);
  const pp0Logical = result?.powerPlayEndBySlot?.side0 ?? null;
  const pp1Logical = result?.powerPlayEndBySlot?.side1 ?? null;
  const pp0 = swap ? pp1Logical : pp0Logical;
  const pp1 = swap ? pp0Logical : pp1Logical;
  const isDoubles = tournamentFormat === 'doubles';
  const nextUnplayedEndIndex =
    !gameComplete && xColumnIndex !== filled ? filled : null;
  const nextEndHammerSlot =
    nextUnplayedEndIndex != null
      ? hammerSlotForEnd(nextUnplayedEndIndex, firstEndHammerSlot, entries, tournamentFormat)
      : null;

  const rockLeading = (visualRow: 0 | 1): ReactNode => {
    if (!sheetColors) return null;
    if (game.rockColor1Slot !== 0 && game.rockColor1Slot !== 1) return null;
    const color = visualRow === 0 ? sheetColors.stoneColor1 : sheetColors.stoneColor2;
    return <RockColorSwatch color={color} />;
  };

  if (filled === 0) {
    return (
      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No scores yet.</p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-900/60">
            <th className="sticky left-0 z-[1] bg-gray-50 px-2 py-2 text-left font-medium text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
              End
            </th>
            {Array.from({ length: columnCount }, (_, i) => (
              <th
                key={i}
                className="min-w-[2.75rem] px-1 py-2 text-center font-medium tabular-nums text-gray-700 dark:text-gray-200"
              >
                {i + 1}
              </th>
            ))}
            <th className="min-w-[3rem] px-2 py-2 text-center font-semibold text-gray-900 dark:text-gray-100">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as const).map((side) => {
            const label = side === 0 ? visualLabel0 : visualLabel1;
            const leading = rockLeading(side);
            const total = side === 0 ? total0 : total1;
            const hasHammer = firstEndHammerSlot === side;
            const ppEnd = side === 0 ? pp0 : pp1;
            return (
              <tr
                key={side}
                className={
                  side === 0
                    ? 'border-t border-gray-200 dark:border-gray-700'
                    : 'border-t border-gray-100 dark:border-gray-800'
                }
              >
                <th className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-100">
                  <span className="inline-flex max-w-[12rem] items-center gap-2">
                    {leading}
                    <span className="line-clamp-2" title={label}>
                      {label}
                    </span>
                    {hasHammer ? (
                      <span
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center"
                        title="Last stone in first end"
                        aria-label={`${label} has last stone in first end`}
                      >
                        <IoHammer className="h-3.5 w-3.5 text-primary-teal" aria-hidden />
                      </span>
                    ) : (
                      <span className="inline-flex h-7 w-7 shrink-0" aria-hidden />
                    )}
                  </span>
                </th>
                {Array.from({ length: columnCount }, (_, i) => {
                  const entry = entries[i] ?? null;
                  const display =
                    entry == null ? '' : side === 0 ? String(entry.side0) : String(entry.side1);
                  const isBlank = entry != null && entry.side0 === 0 && entry.side1 === 0;
                  const hasPowerPlay = isDoubles && ppEnd === i + 1;
                  const showHammerPlaceholder =
                    display === '' && nextEndHammerSlot === side && i === nextUnplayedEndIndex;
                  return (
                    <td key={i} className="px-1 py-1 text-center">
                      {xColumnIndex === i ? (
                        <span className="inline-flex h-9 w-full items-center justify-center font-semibold text-gray-400">
                          X
                        </span>
                      ) : (
                        <div className="flex flex-col items-center gap-0.5">
                          {hasPowerPlay ? (
                            <span
                              className="text-[0.65rem] font-medium leading-none text-primary-teal"
                              title="Power play"
                            >
                              PP
                            </span>
                          ) : null}
                          <span
                            className={`inline-flex h-9 w-full min-w-[2.5rem] items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800 ${
                              isBlank ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            {showHammerPlaceholder ? (
                              <IoHammer className="h-3.5 w-3.5 text-primary-teal" aria-hidden />
                            ) : display === '' ? (
                              '·'
                            ) : (
                              display
                            )}
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
