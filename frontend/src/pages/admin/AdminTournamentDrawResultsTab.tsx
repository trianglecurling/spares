import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { HiOutlinePencilSquare } from 'react-icons/hi2';
import ChoiceInput from '../../components/ChoiceInput';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import Modal from '../../components/Modal';
import type {
  TournamentGameNode,
  TournamentGameResult,
  TournamentDrawState,
} from '../../utils/tournamentDrawModel';
import { resolveResultsTableSideLabel } from '../../utils/tournamentDrawRouting';
import {
  multiScoreRanking,
  outcomeFromResult,
  resultLocksTableRadios,
  sumEnds,
} from '../../utils/tournamentDrawResult';
import type { TournamentTeamApi } from './AdminEventTournamentTeamModal';

type AdminTournamentDrawResultsTabProps = {
  draw: TournamentDrawState;
  teams: TournamentTeamApi[];
  updateDraw: (
    fn: (d: TournamentDrawState) => TournamentDrawState,
    opts?: { persistGameResult?: { gameId: string; result: TournamentGameResult | null } },
  ) => void;
};

type ResultsTableRow = {
  game: TournamentGameNode;
  comp0: string;
  comp1: string;
  drawLabel: string;
  sheetLabel: string;
  sortTime: number;
  sortSheet: number;
};

function lastNameFromPlayerName(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  if (t.includes(',')) {
    return t.split(',')[0]?.trim() || null;
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1]!.replace(/\.$/, '');
}

/** Fourth’s last name when set; otherwise skip’s last name (e.g. doubles). */
function fourthOrSkipLastName(team: TournamentTeamApi | undefined): string | null {
  if (!team) return null;
  const fourth = team.roster.find((r) => r.slotCode === 'fourth');
  const fromFourth = lastNameFromPlayerName(fourth?.playerName);
  if (fromFourth) return fromFourth;
  const skip = team.roster.find((r) => r.slotCode === team.skipSlotCode);
  return lastNameFromPlayerName(skip?.playerName);
}

function formatResultsCompetitorLabel(
  draw: TournamentDrawState,
  g: TournamentGameNode,
  slotIndex: number,
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>,
  teamsFullById: Map<number, TournamentTeamApi>,
): string {
  const base = resolveResultsTableSideLabel(draw, g, slotIndex, teamsById);
  const slot = g.slots[slotIndex];
  if (!slot || slot.sourceType !== 'team' || slot.teamId == null) return base;
  const ln = fourthOrSkipLastName(teamsFullById.get(slot.teamId));
  if (ln) return `${base} (${ln})`;
  return base;
}

function buildResultsTableRows(draw: TournamentDrawState, teams: TournamentTeamApi[]): ResultsTableRow[] {
  const teamsById = new Map(teams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }]));
  const teamsFullById = new Map(teams.map((t) => [t.id, t]));
  const blocks = [...draw.drawBlocks].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const blockIndex = new Map(blocks.map((b, i) => [b.id, i + 1]));
  const out: ResultsTableRow[] = [];
  for (const g of Object.values(draw.games)) {
    const sch = g.schedule;
    const comp0 = formatResultsCompetitorLabel(draw, g, 0, teamsById, teamsFullById);
    const comp1 = formatResultsCompetitorLabel(draw, g, 1, teamsById, teamsFullById);
    let drawLabel = '—';
    let sortTime = Number.POSITIVE_INFINITY;
    if (sch?.drawBlockId) {
      const idx = blockIndex.get(sch.drawBlockId);
      if (idx != null) drawLabel = String(idx);
      const b = blocks.find((x) => x.id === sch.drawBlockId);
      if (b?.startTime?.trim()) {
        const d = new Date(b.startTime);
        if (!Number.isNaN(d.getTime())) {
          sortTime = d.getTime();
        }
      }
    }
    let sheetLabel = '—';
    let sortSheet = 99999;
    if (sch?.sheetId != null) {
      const sh = draw.sheets.find((s) => s.clubSheetId === sch.sheetId);
      sheetLabel = sh?.name ?? String(sch.sheetId);
      sortSheet = sh?.order ?? sortSheet;
    }
    out.push({
      game: g,
      comp0,
      comp1,
      drawLabel,
      sheetLabel,
      sortTime,
      sortSheet,
    });
  }
  out.sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    if (a.sortSheet !== b.sortSheet) return a.sortSheet - b.sortSheet;
    return a.game.label.localeCompare(b.game.label, undefined, { numeric: true });
  });
  return out;
}

function formatMultiCompetitorResultsLine(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>,
): string | null {
  const ranking = multiScoreRanking(game);
  if (!ranking) return null;
  return ranking
    .map((row, i) => {
      const label = resolveResultsTableSideLabel(draw, game, row.slotIndex, teamsById);
      return `${i + 1}. ${label} (${row.score})`;
    })
    .join(' · ');
}

function formatMultiCompetitionIntroLine(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>,
): string {
  const n = game.slots.length;
  const labels = game.slots.map((_, idx) => resolveResultsTableSideLabel(draw, game, idx, teamsById));
  return `Competition among ${n} teams: ${labels.join(' v. ')}`;
}

function clearGameResult(gameId: string, d: TournamentDrawState): TournamentDrawState {
  const g = d.games[gameId];
  if (!g) return d;
  const { result: _r, ...rest } = g;
  void _r;
  return { ...d, games: { ...d.games, [gameId]: rest } };
}

type DetailMode = 'pick' | 'score' | 'ends';

function GameResultDetailModal({
  game,
  draw,
  teamsById,
  open,
  onClose,
  updateDraw,
}: {
  game: TournamentGameNode | null;
  draw: TournamentDrawState;
  teamsById: Map<number, { teamName: string | null; sortOrder: number }>;
  open: boolean;
  onClose: () => void;
  updateDraw: AdminTournamentDrawResultsTabProps['updateDraw'];
}) {
  const resultTypeInputId = useId();
  const winnerInputId = useId();
  const [mode, setMode] = useState<DetailMode>('pick');
  const [pickSlot, setPickSlot] = useState<0 | 1 | null>(null);
  const [score0, setScore0] = useState('');
  const [score1, setScore1] = useState('');
  const [endRows, setEndRows] = useState<Array<{ s0: string; s1: string }>>([{ s0: '', s1: '' }]);
  const [multiScoreInputs, setMultiScoreInputs] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !game) return;
    const k = game.slots.length;
    if (k >= 3) {
      const r = game.result;
      if (r?.entryKind === 'multi_score' && r.scores.length === k) {
        setMultiScoreInputs(r.scores.map((n) => String(n)));
      } else {
        setMultiScoreInputs(Array.from({ length: k }, () => ''));
      }
      return;
    }
    const r = game.result;
    if (!r) {
      setMode('pick');
      setPickSlot(null);
      setScore0('');
      setScore1('');
      setEndRows([{ s0: '', s1: '' }]);
      return;
    }
    if (r.entryKind === 'pick_winner') {
      setMode('pick');
      setPickSlot(r.winnerSlot);
      setScore0('');
      setScore1('');
      setEndRows([{ s0: '', s1: '' }]);
    } else if (r.entryKind === 'final_score') {
      setMode('score');
      setPickSlot(null);
      setScore0(String(r.finalScores[0]));
      setScore1(String(r.finalScores[1]));
      setEndRows([{ s0: '', s1: '' }]);
    } else if (r.entryKind === 'ends') {
      setMode('ends');
      setPickSlot(null);
      setScore0('');
      setScore1('');
      const n = Math.max(r.ends.side0.length, r.ends.side1.length, 1);
      const rows: Array<{ s0: string; s1: string }> = [];
      for (let i = 0; i < n; i++) {
        rows.push({
          s0: String(r.ends.side0[i] ?? ''),
          s1: String(r.ends.side1[i] ?? ''),
        });
      }
      setEndRows(rows);
    } else {
      setMode('pick');
      setPickSlot(null);
      setScore0('');
      setScore1('');
      setEndRows([{ s0: '', s1: '' }]);
    }
  }, [open, game]);

  const twoSlots = game != null && game.slots.length === 2;
  const multiSlot = game != null && game.slots.length >= 3;

  const resultTypeOptions = useMemo(
    () =>
      [
        { value: 'pick' as const, label: 'Pick winner' },
        { value: 'score' as const, label: 'Final score' },
        { value: 'ends' as const, label: 'End by end' },
      ] as const,
    [],
  );

  const winnerOptions = useMemo(() => {
    if (!game || game.slots.length < 2) return [];
    return [
      {
        value: 0 as const,
        label: resolveResultsTableSideLabel(draw, game, 0, teamsById),
      },
      {
        value: 1 as const,
        label: resolveResultsTableSideLabel(draw, game, 1, teamsById),
      },
    ];
  }, [game, teamsById, draw]);

  const handleSave = useCallback(() => {
    if (!game) return;
    if (game.slots.length >= 3) {
      const k = game.slots.length;
      if (multiScoreInputs.length !== k) {
        window.alert('Scores are out of sync with this game; close and reopen the form.');
        return;
      }
      const nums = multiScoreInputs.map((s) => {
        const t = s.trim();
        if (t === '') return Number.NaN;
        return Number.parseFloat(t);
      });
      if (nums.some((n) => !Number.isFinite(n))) {
        window.alert('Enter a valid final score for every competitor.');
        return;
      }
      const next: TournamentGameResult = { entryKind: 'multi_score', scores: nums };
      updateDraw(
        (d) => ({
          ...d,
          games: { ...d.games, [game.id]: { ...d.games[game.id]!, result: next } },
        }),
        { persistGameResult: { gameId: game.id, result: next } },
      );
      onClose();
      return;
    }
    if (mode === 'pick') {
      if (pickSlot == null) {
        window.alert('Choose which side won, or pick another result type.');
        return;
      }
      const next: TournamentGameResult = { entryKind: 'pick_winner', winnerSlot: pickSlot };
      updateDraw(
        (d) => ({
          ...d,
          games: { ...d.games, [game.id]: { ...d.games[game.id]!, result: next } },
        }),
        { persistGameResult: { gameId: game.id, result: next } },
      );
      onClose();
      return;
    }
    if (mode === 'score') {
      const a = Number.parseFloat(score0);
      const b = Number.parseFloat(score1);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        window.alert('Enter a valid final score for both sides.');
        return;
      }
      const next: TournamentGameResult = { entryKind: 'final_score', finalScores: [a, b] };
      updateDraw(
        (d) => ({
          ...d,
          games: { ...d.games, [game.id]: { ...d.games[game.id]!, result: next } },
        }),
        { persistGameResult: { gameId: game.id, result: next } },
      );
      onClose();
      return;
    }
    const side0: number[] = [];
    const side1: number[] = [];
    for (const row of endRows) {
      const v0 = row.s0.trim() === '' ? 0 : Number.parseInt(row.s0, 10);
      const v1 = row.s1.trim() === '' ? 0 : Number.parseInt(row.s1, 10);
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || v0 < 0 || v1 < 0 || v0 > 99 || v1 > 99) {
        window.alert('Each end must be a whole number from 0–99 (or leave blank for 0).');
        return;
      }
      side0.push(v0);
      side1.push(v1);
    }
    if (side0.length === 0 || side0.length !== side1.length) {
      window.alert('Add at least one end; both sides must have the same number of ends.');
      return;
    }
    const next: TournamentGameResult = { entryKind: 'ends', ends: { side0, side1 } };
    updateDraw(
      (d) => ({
        ...d,
        games: { ...d.games, [game.id]: { ...d.games[game.id]!, result: next } },
      }),
      { persistGameResult: { gameId: game.id, result: next } },
    );
    onClose();
  }, [game, mode, pickSlot, score0, score1, endRows, multiScoreInputs, updateDraw, onClose]);

  const handleClearResult = useCallback(() => {
    if (!game) return;
    updateDraw((d) => clearGameResult(game.id, d), {
      persistGameResult: { gameId: game.id, result: null },
    });
    onClose();
  }, [game, updateDraw, onClose]);

  if (!game) return null;

  const endsTotal0 = endRows.reduce((acc, r) => acc + (r.s0.trim() === '' ? 0 : Number.parseInt(r.s0, 10) || 0), 0);
  const endsTotal1 = endRows.reduce((acc, r) => acc + (r.s1.trim() === '' ? 0 : Number.parseInt(r.s1, 10) || 0), 0);

  return (
    <Modal isOpen={open} onClose={onClose} title={`Game result · ${game.label}`} size="lg" verticalAlign="start">
      {multiSlot ? (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Enter the final total score for each competitor. Places are ranked highest score first; when scores tie,
          the earlier competitor slot wins the tie.
        </p>
      ) : null}

      {twoSlots ? (
        <FormField label="Result type" htmlFor={resultTypeInputId}>
          <ChoiceInput<DetailMode>
            inputId={resultTypeInputId}
            listboxLabel="Result type"
            layout="inline"
            name="result-detail-mode"
            options={[...resultTypeOptions]}
            value={mode}
            onChange={(v) => {
              if (v == null || Array.isArray(v)) return;
              setMode(v);
            }}
          />
        </FormField>
      ) : null}

      {multiSlot ? (
        <div className="mt-4 space-y-3">
          {game.slots.map((_, idx) => (
            <FormField
              key={idx}
              label={`Score — ${resolveResultsTableSideLabel(draw, game, idx, teamsById)}`}
              htmlFor={`multi-score-${game.id}-${idx}`}
            >
              <input
                id={`multi-score-${game.id}-${idx}`}
                className="app-input w-full max-w-xs"
                type="text"
                inputMode="decimal"
                value={multiScoreInputs[idx] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setMultiScoreInputs((rows) => {
                    const next = [...rows];
                    next[idx] = v;
                    return next;
                  });
                }}
              />
            </FormField>
          ))}
        </div>
      ) : null}

      {mode === 'pick' && twoSlots ? (
        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
          <FormField label="Winner" htmlFor={winnerInputId}>
            <ChoiceInput<0 | 1>
              inputId={winnerInputId}
              listboxLabel="Winner"
              layout="inline"
              name={`detail-pick-${game.id}`}
              options={winnerOptions}
              value={pickSlot}
              onChange={(v) => {
                if (v == null || Array.isArray(v)) {
                  setPickSlot(null);
                  return;
                }
                setPickSlot(v === 0 || v === 1 ? v : null);
              }}
            />
          </FormField>
        </div>
      ) : null}

      {mode === 'score' && twoSlots ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FormField label={`Score — ${resolveResultsTableSideLabel(draw, game, 0, teamsById)}`}>
            <input
              className="app-input w-full"
              type="text"
              inputMode="decimal"
              value={score0}
              onChange={(e) => setScore0(e.target.value)}
            />
          </FormField>
          <FormField label={`Score — ${resolveResultsTableSideLabel(draw, game, 1, teamsById)}`}>
            <input
              className="app-input w-full"
              type="text"
              inputMode="decimal"
              value={score1}
              onChange={(e) => setScore1(e.target.value)}
            />
          </FormField>
        </div>
      ) : null}

      {mode === 'ends' && twoSlots ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Points per end for each side. Totals: {endsTotal0} — {endsTotal1}
          </p>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-600">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/80">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">End</th>
                  <th className="px-2 py-1.5 text-left font-medium">
                    {resolveResultsTableSideLabel(draw, game, 0, teamsById)}
                  </th>
                  <th className="px-2 py-1.5 text-left font-medium">
                    {resolveResultsTableSideLabel(draw, game, 1, teamsById)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {endRows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                    <td className="px-2 py-1">
                      <input
                        className="app-input w-16 py-1"
                        type="text"
                        inputMode="numeric"
                        value={row.s0}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEndRows((rows) => rows.map((r, j) => (j === i ? { ...r, s0: v } : r)));
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="app-input w-16 py-1"
                        type="text"
                        inputMode="numeric"
                        value={row.s1}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEndRows((rows) => rows.map((r, j) => (j === i ? { ...r, s1: v } : r)));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEndRows((rows) => [...rows, { s0: '', s1: '' }])}
            >
              Add end
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={endRows.length <= 1}
              onClick={() => setEndRows((rows) => (rows.length <= 1 ? rows : rows.slice(0, -1)))}
            >
              Remove last end
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <Button type="button" variant="secondary" className="text-red-700 dark:text-red-300" onClick={handleClearResult}>
          Clear result
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminTournamentDrawResultsTab({
  draw,
  teams,
  updateDraw,
}: AdminTournamentDrawResultsTabProps) {
  const teamsById = useMemo(
    () => new Map(teams.map((t) => [t.id, { teamName: t.teamName, sortOrder: t.sortOrder }])),
    [teams],
  );
  const rows = useMemo(() => buildResultsTableRows(draw, teams), [draw, teams]);
  const [detailGameId, setDetailGameId] = useState<string | null>(null);
  const detailGame = detailGameId ? draw.games[detailGameId] ?? null : null;

  const setPickWinner = useCallback(
    (gameId: string, slot: 0 | 1) => {
      const next: TournamentGameResult = { entryKind: 'pick_winner', winnerSlot: slot };
      updateDraw(
        (d) => {
          const g = d.games[gameId];
          if (!g) return d;
          return { ...d, games: { ...d.games, [gameId]: { ...g, result: next } } };
        },
        { persistGameResult: { gameId, result: next } },
      );
    },
    [updateDraw],
  );

  return (
    <FormSection title="Results" surface="panel">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        For two-team games, pick a winner or enter scores; for games with three or more competitors, enter a final
        score for each (highest wins). Changes save automatically.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/90 text-left dark:border-gray-600 dark:bg-gray-900/40">
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Draw #</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Game</th>
              <th className="px-3 py-2 font-semibold">Sheet</th>
              <th className="px-3 py-2 font-semibold">Side A</th>
              <th className="px-3 py-2 font-semibold">Side B</th>
              <th className="px-3 py-2 font-semibold w-12" aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const { game } = row;
              const newTimeGroup =
                rowIndex > 0 && row.sortTime !== rows[rowIndex - 1]!.sortTime;
              const two = game.slots.length === 2;
              const locked = resultLocksTableRadios(game.result);
              const outcome = outcomeFromResult(game);
              const win0 = outcome === 'slot0';
              const win1 = outcome === 'slot1';
              const tie = outcome === 'tie';
              const fs = game.result?.entryKind === 'final_score' ? game.result.finalScores : null;
              const endsTot =
                game.result?.entryKind === 'ends'
                  ? [sumEnds(game.result.ends.side0), sumEnds(game.result.ends.side1)]
                  : null;
              const multiLine = !two ? formatMultiCompetitorResultsLine(draw, game, teamsById) : null;

              const cellSide = (side: 0 | 1) => {
                const isWin = side === 0 ? win0 && !tie : win1 && !tie;
                const tieCell = tie ? 'bg-amber-50/90 dark:bg-amber-950/20' : '';
                const winBg = isWin ? 'bg-primary-teal/15 dark:bg-primary-teal/25' : '';
                const label = side === 0 ? row.comp0 : row.comp1;
                const radioId = `winner-${game.id}-side-${side}`;
                return (
                  <td className={`px-3 py-2 align-middle ${tieCell} ${winBg}`}>
                    {two ? (
                      <label
                        htmlFor={radioId}
                        className={`flex min-w-0 items-center gap-2${locked ? '' : ' cursor-pointer'}`}
                      >
                        <input
                          id={radioId}
                          type="radio"
                          name={`winner-${game.id}`}
                          className="h-3.5 w-3.5 shrink-0 border-gray-300 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
                          disabled={locked}
                          checked={side === 0 ? outcome === 'slot0' : outcome === 'slot1'}
                          onChange={() => setPickWinner(game.id, side)}
                        />
                        <div className="min-w-0 flex-1">
                          <span className={isWin ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}>
                            {label}
                          </span>
                          {locked && fs ? (
                            <span className="ml-1.5 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                              · {side === 0 ? fs[0] : fs[1]}
                            </span>
                          ) : null}
                          {locked && endsTot ? (
                            <span className="ml-1.5 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                              · {side === 0 ? endsTot[0] : endsTot[1]}
                            </span>
                          ) : null}
                          {tie && side === 0 ? (
                            <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                              Tie
                            </span>
                          ) : null}
                        </div>
                      </label>
                    ) : (
                      <div className="min-w-0">
                        <span className="text-gray-800 dark:text-gray-200">{label}</span>
                      </div>
                    )}
                  </td>
                );
              };

              return (
                <tr
                  key={game.id}
                  className={`border-b border-gray-100 dark:border-gray-800 ${
                    newTimeGroup
                      ? 'border-t-2 border-t-gray-400 dark:border-t-gray-500'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">{row.drawLabel}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 tabular-nums dark:text-gray-100">
                    {game.label}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.sheetLabel}</td>
                  {two ? (
                    <>
                      {cellSide(0)}
                      {cellSide(1)}
                    </>
                  ) : (
                    <td colSpan={2} className="px-3 py-2 align-top text-gray-800 dark:text-gray-200">
                      {multiLine ? (
                        <span className="text-sm leading-snug">{multiLine}</span>
                      ) : (
                        <span className="text-sm leading-snug text-gray-800 dark:text-gray-200">
                          {formatMultiCompetitionIntroLine(draw, game, teamsById)}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 align-middle">
                    <button
                      type="button"
                      className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-primary-teal dark:text-gray-400 dark:hover:bg-gray-800"
                      aria-label={`Enter detailed results`}
                      title={`Enter detailed results`}
                      onClick={() => setDetailGameId(game.id)}
                    >
                      <HiOutlinePencilSquare className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No games in this draw yet.</p>
      ) : null}

      <GameResultDetailModal
        game={detailGame}
        draw={draw}
        teamsById={teamsById}
        open={detailGameId != null}
        onClose={() => setDetailGameId(null)}
        updateDraw={updateDraw}
      />
    </FormSection>
  );
}
