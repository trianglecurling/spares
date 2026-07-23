import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiArrowPath, HiArrowUturnLeft } from 'react-icons/hi2';
import AppPageControlsRow from '../AppPageControlsRow';
import AppStateCard from '../AppStateCard';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import ScorekeeperEndsEditor, {
  endsArraysFromEntries,
  entriesFromEndsArrays,
  type EndScoreEntry,
} from './ScorekeeperEndsEditor';
import ScorekeeperRockColorControl, { RockColorSwatch } from './ScorekeeperRockColorControl';
import ScorekeeperSettingsDialog, {
  type ScorekeeperSettingsConfirm,
} from './ScorekeeperSettingsDialog';
import type { UpdateDrawForResults } from '../../hooks/useTournamentDrawResults';
import type {
  TournamentDrawState,
  TournamentGameResult,
  TournamentResultType,
} from '../../utils/tournamentDrawModel';
import type { TournamentFormat } from '../../utils/tournamentDisplay';
import {
  eligiblePowerPlayEnds,
} from '../../utils/tournamentEndsHammer';
import {
  outcomeFromResult,
  resultLocksTableRadios,
  sumEnds,
} from '../../utils/tournamentDrawResult';
import {
  buildResultsTableRows,
  clearAllGameResults,
  formatMultiCompetitionIntroLine,
  formatMultiCompetitorResultsLine,
  gameHasRecordedResult,
  setGameResult,
  type TournamentResultsTableRow,
} from '../../utils/tournamentDrawResultsRows';
import { resolveResultsTableSideLabel } from '../../utils/tournamentDrawRouting';
import {
  applyDrawResultTypeChange,
  resolveDrawResultType,
} from '../../utils/tournamentResultType';
import {
  applyRockColorModeChange,
  clearAllRockColors,
  displaySlotOrder,
  gameCanHaveRockColors,
  resolveRockColorMode,
  rockColor1SlotForChoice,
  setGameRockColor1Slot,
  sheetColorsForGame,
  stoneColorForLogicalSlot,
  syncStoneColorsOntoDrawSheets,
  type SheetStoneColors,
} from '../../utils/tournamentRockColors';
import type { ClubSheet } from '../../utils/tournamentDrawSchedule';
import type { TournamentTeamApi } from '../../types/tournamentTeam';
import api from '../../utils/api';

export type ScorekeeperStatusFilter = 'all' | 'needs' | 'completed';

/** Debounce network PATCHes for final / multi scores after the last input. */
const FINAL_SCORE_DEBOUNCE_MS = 5000;

type TournamentScorekeeperViewProps = {
  eventId: number;
  draw: TournamentDrawState;
  teams: TournamentTeamApi[];
  tournamentFormat: TournamentFormat;
  updateDraw: UpdateDrawForResults;
  replaceDrawAndPersist: (next: TournamentDrawState) => Promise<void>;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
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

export default function TournamentScorekeeperView({
  eventId,
  draw,
  teams,
  tournamentFormat,
  updateDraw,
  replaceDrawAndPersist,
  saveStatus,
}: TournamentScorekeeperViewProps) {
  const statusFilterId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [clubSheets, setClubSheets] = useState<ClubSheet[]>([]);

  const teamsById = useMemo(
    () => new Map(teams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }])),
    [teams],
  );
  const allRows = useMemo(() => buildResultsTableRows(draw, teams), [draw, teams]);
  const resultType = resolveDrawResultType(draw);
  const rockColorMode = resolveRockColorMode(draw);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ClubSheet[]>(`/sheets`)
      .then((res) => {
        if (!cancelled) setClubSheets(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setClubSheets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Draw with live club sheet stone colors merged for display / assignment checks. */
  const drawWithSheetColors = useMemo(
    () => syncStoneColorsOntoDrawSheets(draw, clubSheets),
    [draw, clubSheets],
  );

  const statusFilter = (searchParams.get('status') as ScorekeeperStatusFilter | null) ?? 'needs';

  const setStatusFilter = useCallback(
    (value: ScorekeeperStatusFilter) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('draw');
          next.delete('sheet');
          next.delete('resultType');
          if (value === 'needs') next.delete('status');
          else next.set('status', value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!searchParams.has('draw') && !searchParams.has('sheet') && !searchParams.has('resultType')) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('draw');
        next.delete('sheet');
        next.delete('resultType');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const statusOptions = useMemo(
    () =>
      [
        { value: 'needs' as const, label: 'Needs result' },
        { value: 'completed' as const, label: 'Completed' },
        { value: 'all' as const, label: 'All games' },
      ] as const,
    [],
  );

  const collectNeedsSessionIds = useCallback(
    (rows: TournamentResultsTableRow[]) =>
      new Set(rows.filter((row) => !gameHasRecordedResult(row.game)).map((row) => row.game.id)),
    [],
  );

  const [needsSessionIds, setNeedsSessionIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (statusFilter !== 'needs') {
      setNeedsSessionIds(null);
      return;
    }
    setNeedsSessionIds(collectNeedsSessionIds(allRows));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [statusFilter, collectNeedsSessionIds]);

  const refreshNeedsSession = useCallback(() => {
    setNeedsSessionIds(collectNeedsSessionIds(allRows));
  }, [allRows, collectNeedsSessionIds]);

  const filteredRows = useMemo(() => {
    if (statusFilter === 'completed') {
      return allRows.filter((row) => gameHasRecordedResult(row.game));
    }
    if (statusFilter === 'all') {
      return allRows;
    }
    if (needsSessionIds) {
      return allRows.filter((row) => needsSessionIds.has(row.game.id));
    }
    return allRows.filter((row) => !gameHasRecordedResult(row.game));
  }, [allRows, statusFilter, needsSessionIds]);

  const setPickWinner = useCallback(
    (gameId: string, slot: 0 | 1) => {
      const next: TournamentGameResult = { entryKind: 'pick_winner', winnerSlot: slot };
      updateDraw((d) => setGameResult(d, gameId, next), {
        persistGameResult: { gameId, result: next },
      });
    },
    [updateDraw],
  );

  const clearResult = useCallback(
    (gameId: string) => {
      updateDraw((d) => setGameResult(d, gameId, null), {
        persistGameResult: { gameId, result: null },
      });
    },
    [updateDraw],
  );

  const setFinalScore = useCallback(
    (gameId: string, scores: [number, number]) => {
      const next: TournamentGameResult = { entryKind: 'final_score', finalScores: scores };
      updateDraw((d) => setGameResult(d, gameId, next), {
        persistGameResult: { gameId, result: next, debounceMs: FINAL_SCORE_DEBOUNCE_MS },
      });
    },
    [updateDraw],
  );

  const setEndsResult = useCallback(
    (gameId: string, result: TournamentGameResult | null) => {
      updateDraw((d) => setGameResult(d, gameId, result), {
        persistGameResult: { gameId, result },
      });
    },
    [updateDraw],
  );

  const setMultiScore = useCallback(
    (gameId: string, scores: number[]) => {
      const next: TournamentGameResult = { entryKind: 'multi_score', scores };
      updateDraw((d) => setGameResult(d, gameId, next), {
        persistGameResult: { gameId, result: next, debounceMs: FINAL_SCORE_DEBOUNCE_MS },
      });
    },
    [updateDraw],
  );

  const handleConfirmSettings = useCallback(
    async ({ resultType: nextType, rockColorMode: nextMode }: ScorekeeperSettingsConfirm) => {
      setSettingsSaving(true);
      try {
        let nextDraw = draw;
        if (nextType !== resultType) {
          nextDraw = applyDrawResultTypeChange(nextDraw, nextType);
        }
        nextDraw = applyRockColorModeChange(nextDraw, nextMode, clubSheets);
        await replaceDrawAndPersist(nextDraw);
        setSettingsDialogOpen(false);
        if (statusFilter === 'needs') {
          setNeedsSessionIds(collectNeedsSessionIds(buildResultsTableRows(nextDraw, teams)));
        }
      } catch {
        // Alert already shown by persist helper
      } finally {
        setSettingsSaving(false);
      }
    },
    [
      clubSheets,
      collectNeedsSessionIds,
      draw,
      replaceDrawAndPersist,
      resultType,
      statusFilter,
      teams,
    ],
  );

  const handleResetAllScores = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const nextDraw = clearAllGameResults(draw);
      await replaceDrawAndPersist(nextDraw);
      if (statusFilter === 'needs') {
        setNeedsSessionIds(collectNeedsSessionIds(buildResultsTableRows(nextDraw, teams)));
      }
    } catch {
      // Alert already shown by persist helper
    } finally {
      setSettingsSaving(false);
    }
  }, [collectNeedsSessionIds, draw, replaceDrawAndPersist, statusFilter, teams]);

  const handleResetAllColors = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const nextDraw = clearAllRockColors(draw);
      await replaceDrawAndPersist(nextDraw);
    } catch {
      // Alert already shown by persist helper
    } finally {
      setSettingsSaving(false);
    }
  }, [draw, replaceDrawAndPersist]);

  const setRockColor1Slot = useCallback(
    (gameId: string, rockColor1Slot: 0 | 1 | null) => {
      updateDraw(
        (d) => {
          const synced = syncStoneColorsOntoDrawSheets(d, clubSheets);
          return setGameRockColor1Slot(synced, gameId, rockColor1Slot);
        },
        {
          persistGameResult: { gameId, rockColor1Slot, debounceMs: 0 },
        },
      );
    },
    [clubSheets, updateDraw],
  );

  const saveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? 'Save failed'
          : 'Changes save automatically';

  if (allRows.length === 0) {
    return (
      <AppStateCard
        title="No games in this draw yet"
        description="Add games on the Tournament Structure tab, then return here to enter results."
        action={
          <Link
            to={`/admin/events/${eventId}/tournament#structure`}
            className="text-sm font-medium text-primary-teal-link hover:underline"
          >
            Open tournament structure
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <AppPageControlsRow
        left={
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Status" htmlFor={statusFilterId} className="min-w-[10rem]">
              <ChoiceInput<ScorekeeperStatusFilter>
                inputId={statusFilterId}
                listboxLabel="Status"
                layout="popover"
                options={[...statusOptions]}
                value={
                  statusFilter === 'needs' || statusFilter === 'completed' || statusFilter === 'all'
                    ? statusFilter
                    : 'needs'
                }
                onChange={(v) => {
                  if (v == null || Array.isArray(v)) return;
                  setStatusFilter(v);
                }}
              />
            </FormField>
          </div>
        }
        right={
          <div className="flex flex-wrap items-center gap-3">
            <p
              className={`text-sm ${
                saveStatus === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
              aria-live="polite"
            >
              {saveLabel}
            </p>
            {statusFilter === 'needs' ? (
              <Button type="button" variant="secondary" onClick={refreshNeedsSession}>
                <span className="inline-flex items-center gap-1.5">
                  <HiArrowPath className="h-4 w-4" aria-hidden />
                  Refresh list
                </span>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setSettingsDialogOpen(true)}>
              Scorekeeping settings
            </Button>
          </div>
        }
      />

      {filteredRows.length === 0 ? (
        <AppStateCard
          title="No games match these filters"
          description="Try another status filter."
        />
      ) : (
        <div className="flex flex-col gap-3 pb-2" role="list">
          {filteredRows.map((row) => (
            <ScorekeeperGameCard
              key={row.game.id}
              row={row}
              draw={drawWithSheetColors}
              teamsById={teamsById}
              resultType={resultType}
              rockColorMode={rockColorMode}
              tournamentFormat={tournamentFormat}
              onPickWinner={setPickWinner}
              onClearResult={clearResult}
              onFinalScore={setFinalScore}
              onEndsResult={setEndsResult}
              onMultiScore={setMultiScore}
              onRockColor1Slot={setRockColor1Slot}
            />
          ))}
        </div>
      )}

      <ScorekeeperSettingsDialog
        open={settingsDialogOpen}
        currentResultType={resultType}
        currentRockColorMode={rockColorMode}
        draw={draw}
        saving={settingsSaving}
        onClose={() => setSettingsDialogOpen(false)}
        onConfirm={(next) => void handleConfirmSettings(next)}
        onResetAllScores={handleResetAllScores}
        onResetAllColors={handleResetAllColors}
      />
    </div>
  );
}

function ScorekeeperGameCard({
  row,
  draw,
  teamsById,
  resultType,
  rockColorMode,
  tournamentFormat,
  onPickWinner,
  onClearResult,
  onFinalScore,
  onEndsResult,
  onMultiScore,
  onRockColor1Slot,
}: {
  row: TournamentResultsTableRow;
  draw: TournamentDrawState;
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>;
  resultType: TournamentResultType;
  rockColorMode: ReturnType<typeof resolveRockColorMode>;
  tournamentFormat: TournamentFormat;
  onPickWinner: (gameId: string, slot: 0 | 1) => void;
  onClearResult: (gameId: string) => void;
  onFinalScore: (gameId: string, scores: [number, number]) => void;
  onEndsResult: (gameId: string, result: TournamentGameResult | null) => void;
  onMultiScore: (gameId: string, scores: number[]) => void;
  onRockColor1Slot: (gameId: string, rockColor1Slot: 0 | 1 | null) => void;
}) {
  const { game } = row;
  const multi = game.slots.length >= 3;
  const locked = resultLocksTableRadios(game.result);
  const completed = gameHasRecordedResult(game);
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
  const showManualColor = canRock && rockColorMode === 'manual' && sheetColors != null;
  const [display0, display1] = displaySlotOrder(game);
  const labelFor = (logical: 0 | 1) => (logical === 0 ? row.comp0 : row.comp1);
  const whichColorFor = (logical: 0 | 1): 1 | 2 | null => {
    if (game.rockColor1Slot !== 0 && game.rockColor1Slot !== 1) return null;
    return game.rockColor1Slot === logical ? 1 : 2;
  };
  const stoneFor = (logical: 0 | 1) =>
    sheetColors ? stoneColorForLogicalSlot(game, logical, sheetColors) : null;

  /** Single leading rock-color affordance: editable dot in manual mode, read-only swatch otherwise. */
  const rockLeading = (logical: 0 | 1): ReactNode => {
    if (!canRock || !sheetColors) return null;
    if (showManualColor) {
      return (
        <ScorekeeperRockColorControl
          teamLabel={labelFor(logical)}
          colors={sheetColors}
          assignedWhich={whichColorFor(logical)}
          onChoose={(which) =>
            onRockColor1Slot(game.id, rockColor1SlotForChoice(logical, which))
          }
          onUnset={() => onRockColor1Slot(game.id, null)}
        />
      );
    }
    const stone = stoneFor(logical);
    return stone ? <RockColorSwatch color={stone} /> : null;
  };

  return (
    <div
      role="listitem"
      className={`rounded-xl border p-4 ${
        completed
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
        {resultType === 'pick' && !multi && game.result != null ? (
          <button
            type="button"
            title="Clear result"
            aria-label="Clear result"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            onClick={() => onClearResult(game.id)}
          >
            <HiArrowUturnLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {multi ? (
        <MultiScoreEntry
          gameId={game.id}
          draw={draw}
          game={game}
          teamsById={teamsById}
          intro={multiLine ?? formatMultiCompetitionIntroLine(draw, game, teamsById)}
          initialScores={
            game.result?.entryKind === 'multi_score' && game.result.scores.length === game.slots.length
              ? game.result.scores
              : null
          }
          onSave={onMultiScore}
        />
      ) : resultType === 'score' ? (
        <FinalScoreEntry
          gameId={game.id}
          label0={labelFor(display0)}
          label1={labelFor(display1)}
          logical0={display0}
          logical1={display1}
          leading0={rockLeading(display0)}
          leading1={rockLeading(display1)}
          initialScores={
            fs ?? (endsTot ? ([endsTot[0]!, endsTot[1]!] as [number, number]) : null)
          }
          outcome={outcome}
          tie={tie}
          onSave={onFinalScore}
        />
      ) : resultType === 'ends' ? (
        <EndsResultEntry
          gameId={game.id}
          label0={row.comp0}
          label1={row.comp1}
          result={game.result}
          tournamentFormat={tournamentFormat}
          sheetColors={sheetColors}
          rockColor1Slot={
            game.rockColor1Slot === 0 || game.rockColor1Slot === 1 ? game.rockColor1Slot : null
          }
          showManualColor={showManualColor}
          onEndsResult={onEndsResult}
          onRockColor1Slot={(slot) => onRockColor1Slot(game.id, slot)}
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([display0, display1] as const).map((logical) => {
            const isWin =
              (logical === 0 ? outcome === 'slot0' : outcome === 'slot1') && !tie;
            const label = labelFor(logical);
            const scoreHint =
              locked && fs
                ? String(logical === 0 ? fs[0] : fs[1])
                : locked && endsTot
                  ? String(logical === 0 ? endsTot[0] : endsTot[1])
                  : null;
            const leading = rockLeading(logical);
            return (
              <button
                key={logical}
                type="button"
                disabled={locked}
                onClick={() => {
                  if (!locked) onPickWinner(game.id, logical);
                }}
                className={`flex min-h-[3.5rem] w-full flex-col items-center justify-center rounded-xl border px-4 py-3 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 disabled:cursor-default ${
                  isWin
                    ? 'border-primary-teal bg-primary-teal/15 font-semibold text-gray-900 dark:bg-primary-teal/25 dark:text-gray-100'
                    : tie
                      ? 'border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/20'
                      : 'border-gray-300 bg-white hover:border-primary-teal/60 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-primary-teal/50'
                } ${locked ? 'opacity-90' : ''}`}
              >
                <span className="flex items-center justify-center gap-2">
                  {leading ? (
                    // Nested color control inside pick-winner button: keep clicks/keys from selecting a winner.
                    <span
                      className="relative z-[1] shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {leading}
                    </span>
                  ) : null}
                  <span className="min-w-0 text-base leading-snug">{label}</span>
                </span>
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FinalScoreEntry({
  gameId,
  label0,
  label1,
  logical0,
  logical1,
  leading0,
  leading1,
  initialScores,
  outcome,
  tie,
  onSave,
}: {
  gameId: string;
  label0: string;
  label1: string;
  logical0: 0 | 1;
  logical1: 0 | 1;
  leading0?: ReactNode;
  leading1?: ReactNode;
  initialScores: [number, number] | null;
  outcome: ReturnType<typeof outcomeFromResult>;
  tie: boolean;
  onSave: (gameId: string, scores: [number, number]) => void;
}) {
  const id0 = useId();
  const id1 = useId();
  const scoreForLogical = (logical: 0 | 1) =>
    initialScores != null ? String(initialScores[logical]!) : '';
  const [score0, setScore0] = useState(() => scoreForLogical(logical0));
  const [score1, setScore1] = useState(() => scoreForLogical(logical1));
  const editingRef = useRef(false);

  useEffect(() => {
    if (editingRef.current) return;
    setScore0(scoreForLogical(logical0));
    setScore1(scoreForLogical(logical1));
  }, [gameId, logical0, logical1, initialScores?.[0], initialScores?.[1]]);

  const trySave = (rawDisplay0: string, rawDisplay1: string) => {
    const vals: [number | null, number | null] = [null, null];
    const a = Number(rawDisplay0);
    const b = Number(rawDisplay1);
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      rawDisplay0.trim() === '' ||
      rawDisplay1.trim() === ''
    ) {
      return;
    }
    if (a < 0 || b < 0) return;
    vals[logical0] = a;
    vals[logical1] = b;
    if (vals[0] == null || vals[1] == null) return;
    if (initialScores && initialScores[0] === vals[0] && initialScores[1] === vals[1]) return;
    onSave(gameId, [vals[0], vals[1]]);
  };

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {(
        [
          {
            display: 0 as const,
            logical: logical0,
            label: label0,
            inputId: id0,
            value: score0,
            setValue: setScore0,
            leading: leading0,
          },
          {
            display: 1 as const,
            logical: logical1,
            label: label1,
            inputId: id1,
            value: score1,
            setValue: setScore1,
            leading: leading1,
          },
        ] as const
      ).map((row) => {
        const isWin =
          (row.logical === 0 ? outcome === 'slot0' : outcome === 'slot1') && !tie;
        return (
          <div
            key={row.display}
            className={`rounded-xl border px-4 py-3 ${
              isWin
                ? 'border-primary-teal bg-primary-teal/10'
                : tie
                  ? 'border-amber-300 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/20'
                  : 'border-gray-300 dark:border-gray-600'
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              {row.leading}
              <label
                htmlFor={row.inputId}
                className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100"
                title={row.label}
              >
                {row.label}
              </label>
            </div>
            <input
              id={row.inputId}
              type="number"
              min={0}
              inputMode="numeric"
              className="app-input w-full tabular-nums"
              value={row.value}
              onFocus={() => {
                editingRef.current = true;
              }}
              onBlur={() => {
                editingRef.current = false;
                trySave(score0, score1);
              }}
              onChange={(e) => {
                const next = e.target.value;
                row.setValue(next);
                trySave(row.display === 0 ? next : score0, row.display === 1 ? next : score1);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function MultiScoreEntry({
  gameId,
  draw,
  game,
  teamsById,
  intro,
  initialScores,
  onSave,
}: {
  gameId: string;
  draw: TournamentDrawState;
  game: TournamentResultsTableRow['game'];
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>;
  intro: string;
  initialScores: number[] | null;
  onSave: (gameId: string, scores: number[]) => void;
}) {
  const [values, setValues] = useState<string[]>(() =>
    initialScores ? initialScores.map(String) : Array.from({ length: game.slots.length }, () => ''),
  );
  const editingRef = useRef(false);

  useEffect(() => {
    if (editingRef.current) return;
    setValues(
      initialScores
        ? initialScores.map(String)
        : Array.from({ length: game.slots.length }, () => ''),
    );
  }, [gameId, game.slots.length, initialScores?.join(',')]);

  const trySave = (nextValues: string[]) => {
    if (nextValues.length !== game.slots.length) return;
    const nums = nextValues.map((s) => {
      const t = s.trim();
      if (t === '') return Number.NaN;
      return Number(t);
    });
    if (nums.some((n) => !Number.isFinite(n))) return;
    if (
      initialScores &&
      initialScores.length === nums.length &&
      initialScores.every((n, i) => n === nums[i])
    ) {
      return;
    }
    onSave(gameId, nums);
  };

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">{intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {game.slots.map((_, idx) => {
          const inputId = `${gameId}-multi-${idx}`;
          const sideLabel = resolveResultsTableSideLabel(draw, game, idx, teamsById);
          return (
            <FormField key={idx} label={sideLabel} htmlFor={inputId}>
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                className="app-input w-full tabular-nums"
                value={values[idx] ?? ''}
                onFocus={() => {
                  editingRef.current = true;
                }}
                onBlur={() => {
                  editingRef.current = false;
                  trySave(values);
                }}
                onChange={(e) => {
                  const next = [...values];
                  next[idx] = e.target.value;
                  setValues(next);
                  trySave(next);
                }}
              />
            </FormField>
          );
        })}
      </div>
    </div>
  );
}

function EndsResultEntry({
  gameId,
  label0,
  label1,
  result,
  tournamentFormat,
  sheetColors,
  rockColor1Slot,
  showManualColor,
  onEndsResult,
  onRockColor1Slot,
}: {
  gameId: string;
  label0: string;
  label1: string;
  result: TournamentGameResult | null | undefined;
  tournamentFormat: TournamentFormat;
  sheetColors: SheetStoneColors | null;
  rockColor1Slot: 0 | 1 | null;
  showManualColor: boolean;
  onEndsResult: (gameId: string, result: TournamentGameResult | null) => void;
  onRockColor1Slot: (rockColor1Slot: 0 | 1 | null) => void;
}) {
  /** When slot 1 has color1, swap visual rows so color1 stays on top. */
  const swap = rockColor1Slot === 1;
  const visualLabel0 = swap ? label1 : label0;
  const visualLabel1 = swap ? label0 : label1;

  const toVisualEntries = (logical: Array<EndScoreEntry | null>) =>
    swap
      ? logical.map((e) => (e ? { side0: e.side1, side1: e.side0 } : null))
      : logical;
  const toLogicalEntries = (visual: Array<EndScoreEntry | null>) =>
    swap
      ? visual.map((e) => (e ? { side0: e.side1, side1: e.side0 } : null))
      : visual;
  const toVisualSlot = (logical: 0 | 1 | null): 0 | 1 | null => {
    if (logical == null) return null;
    if (!swap) return logical;
    return logical === 0 ? 1 : 0;
  };
  const toLogicalSlot = (visual: 0 | 1 | null): 0 | 1 | null => toVisualSlot(visual);

  const savedEnds = result?.entryKind === 'ends' ? result.ends : null;
  const savedComplete = result?.entryKind === 'ends' ? result.complete !== false : false;
  const savedHammer =
    result?.entryKind === 'ends' && (result.firstEndHammerSlot === 0 || result.firstEndHammerSlot === 1)
      ? result.firstEndHammerSlot
      : null;
  const savedPp0 =
    result?.entryKind === 'ends' ? (result.powerPlayEndBySlot?.side0 ?? null) : null;
  const savedPp1 =
    result?.entryKind === 'ends' ? (result.powerPlayEndBySlot?.side1 ?? null) : null;
  const savedKey = savedEnds
    ? `${savedEnds.side0.join(',')}|${savedEnds.side1.join(',')}|${savedComplete ? '1' : '0'}|${savedHammer ?? 'x'}|${savedPp0 ?? 'x'}|${savedPp1 ?? 'x'}|${rockColor1Slot ?? 'x'}`
    : `empty|${rockColor1Slot ?? 'x'}`;

  const [entries, setEntries] = useState<Array<EndScoreEntry | null>>(() =>
    savedEnds ? toVisualEntries(entriesFromEndsArrays(savedEnds.side0, savedEnds.side1)) : [],
  );
  const [gameComplete, setGameComplete] = useState(() => savedComplete);
  const [firstEndHammerSlot, setFirstEndHammerSlot] = useState<0 | 1 | null>(() =>
    toVisualSlot(savedHammer),
  );
  const [powerPlayEndSide0, setPowerPlayEndSide0] = useState<number | null>(() =>
    tournamentFormat === 'doubles' ? (swap ? savedPp1 : savedPp0) : null,
  );
  const [powerPlayEndSide1, setPowerPlayEndSide1] = useState<number | null>(() =>
    tournamentFormat === 'doubles' ? (swap ? savedPp0 : savedPp1) : null,
  );

  useEffect(() => {
    if (savedEnds) {
      setEntries(toVisualEntries(entriesFromEndsArrays(savedEnds.side0, savedEnds.side1)));
      setGameComplete(savedComplete);
      setFirstEndHammerSlot(toVisualSlot(savedHammer));
      setPowerPlayEndSide0(tournamentFormat === 'doubles' ? (swap ? savedPp1 : savedPp0) : null);
      setPowerPlayEndSide1(tournamentFormat === 'doubles' ? (swap ? savedPp0 : savedPp1) : null);
      return;
    }
    setEntries([]);
    setGameComplete(false);
    setFirstEndHammerSlot(null);
    setPowerPlayEndSide0(null);
    setPowerPlayEndSide1(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate on game change only
  }, [gameId]);

  useEffect(() => {
    if (savedEnds) {
      setEntries(toVisualEntries(entriesFromEndsArrays(savedEnds.side0, savedEnds.side1)));
    } else if (!savedHammer) {
      setEntries([]);
    }
    setGameComplete(savedComplete);
    setFirstEndHammerSlot(toVisualSlot(savedHammer));
    setPowerPlayEndSide0(tournamentFormat === 'doubles' ? (swap ? savedPp1 : savedPp0) : null);
    setPowerPlayEndSide1(tournamentFormat === 'doubles' ? (swap ? savedPp0 : savedPp1) : null);
  }, [savedKey, tournamentFormat, swap]);

  const sanitizePowerPlays = (
    nextLogicalEntries: Array<EndScoreEntry | null>,
    hammerLogical: 0 | 1 | null,
    pp0Logical: number | null,
    pp1Logical: number | null,
  ): { side0: number | null; side1: number | null } => {
    if (tournamentFormat !== 'doubles' || hammerLogical == null) {
      return { side0: null, side1: null };
    }
    const eligible0 = new Set(
      eligiblePowerPlayEnds(0, hammerLogical, nextLogicalEntries, tournamentFormat),
    );
    const eligible1 = new Set(
      eligiblePowerPlayEnds(1, hammerLogical, nextLogicalEntries, tournamentFormat),
    );
    return {
      side0: pp0Logical != null && eligible0.has(pp0Logical) ? pp0Logical : null,
      side1: pp1Logical != null && eligible1.has(pp1Logical) ? pp1Logical : null,
    };
  };

  const persistEnds = (
    nextVisualEntries: Array<EndScoreEntry | null>,
    complete: boolean,
    hammerVisual: 0 | 1 | null,
    pp0Visual: number | null,
    pp1Visual: number | null,
  ) => {
    const logicalEntries = toLogicalEntries(nextVisualEntries);
    const hammerLogical = toLogicalSlot(hammerVisual);
    const pp0Logical = swap ? pp1Visual : pp0Visual;
    const pp1Logical = swap ? pp0Visual : pp1Visual;
    const arrays = endsArraysFromEntries(logicalEntries);
    const pp = sanitizePowerPlays(logicalEntries, hammerLogical, pp0Logical, pp1Logical);
    const nextPp0Visual = swap ? pp.side1 : pp.side0;
    const nextPp1Visual = swap ? pp.side0 : pp.side1;
    if (nextPp0Visual !== pp0Visual) setPowerPlayEndSide0(nextPp0Visual);
    if (nextPp1Visual !== pp1Visual) setPowerPlayEndSide1(nextPp1Visual);

    if (!arrays && hammerLogical == null) {
      onEndsResult(gameId, null);
      return;
    }

    onEndsResult(gameId, {
      entryKind: 'ends',
      ends: arrays ?? { side0: [], side1: [] },
      complete: arrays == null ? false : complete,
      ...(hammerLogical != null ? { firstEndHammerSlot: hammerLogical } : {}),
      ...(tournamentFormat === 'doubles'
        ? { powerPlayEndBySlot: { side0: pp.side0, side1: pp.side1 } }
        : {}),
    });
  };

  const handleEntriesChange = (next: Array<EndScoreEntry | null>) => {
    setEntries(next);
    const arrays = endsArraysFromEntries(toLogicalEntries(next));
    const nextComplete = arrays == null ? false : gameComplete;
    if (arrays == null) setGameComplete(false);
    persistEnds(next, nextComplete, firstEndHammerSlot, powerPlayEndSide0, powerPlayEndSide1);
  };

  const handleCompleteChange = (complete: boolean) => {
    const arrays = endsArraysFromEntries(toLogicalEntries(entries));
    if (complete && !arrays) return;
    setGameComplete(complete);
    persistEnds(entries, complete, firstEndHammerSlot, powerPlayEndSide0, powerPlayEndSide1);
  };

  const handleHammerChange = (slot: 0 | 1 | null) => {
    setFirstEndHammerSlot(slot);
    persistEnds(entries, gameComplete, slot, powerPlayEndSide0, powerPlayEndSide1);
  };

  const handlePowerPlayChange = (slot: 0 | 1, endNumber: number | null) => {
    const next0 = slot === 0 ? endNumber : powerPlayEndSide0;
    const next1 = slot === 1 ? endNumber : powerPlayEndSide1;
    if (slot === 0) setPowerPlayEndSide0(endNumber);
    else setPowerPlayEndSide1(endNumber);
    persistEnds(entries, gameComplete, firstEndHammerSlot, next0, next1);
  };

  const whichForVisual = (visualRow: 0 | 1): 1 | 2 | null => {
    if (rockColor1Slot !== 0 && rockColor1Slot !== 1) return null;
    // Visual row 0 is always color1 when assigned.
    if (visualRow === 0) return 1;
    return 2;
  };

  const logicalForVisual = (visualRow: 0 | 1): 0 | 1 =>
    visualRow === 0 ? (swap ? 1 : 0) : swap ? 0 : 1;

  const rockLeading = (visualRow: 0 | 1): ReactNode => {
    if (!sheetColors) return null;
    if (showManualColor) {
      const logical = logicalForVisual(visualRow);
      const teamLabel = logical === 0 ? label0 : label1;
      return (
        <ScorekeeperRockColorControl
          teamLabel={teamLabel}
          colors={sheetColors}
          assignedWhich={whichForVisual(visualRow)}
          onChoose={(which) => onRockColor1Slot(rockColor1SlotForChoice(logical, which))}
          onUnset={() => onRockColor1Slot(null)}
        />
      );
    }
    if (rockColor1Slot !== 0 && rockColor1Slot !== 1) return null;
    const color = visualRow === 0 ? sheetColors.stoneColor1 : sheetColors.stoneColor2;
    return <RockColorSwatch color={color} />;
  };

  return (
    <ScorekeeperEndsEditor
      team0Label={visualLabel0}
      team1Label={visualLabel1}
      entries={entries}
      gameComplete={gameComplete}
      tournamentFormat={tournamentFormat}
      firstEndHammerSlot={firstEndHammerSlot}
      powerPlayEndSide0={powerPlayEndSide0}
      powerPlayEndSide1={powerPlayEndSide1}
      team0Leading={rockLeading(0)}
      team1Leading={rockLeading(1)}
      onChangeEntries={handleEntriesChange}
      onGameCompleteChange={handleCompleteChange}
      onFirstEndHammerChange={handleHammerChange}
      onPowerPlayEndChange={handlePowerPlayChange}
    />
  );
}
