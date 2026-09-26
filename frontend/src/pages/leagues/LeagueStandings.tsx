import { useEffect, useId, useState } from 'react';
import { get, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import HelpCallout from '../../components/HelpCallout';
import Modal from '../../components/Modal';

type RankBy = 'total' | 'percentage';

interface StandingRow {
  rank: number;
  teamId: number;
  teamName: string | null;
  divisionId: number;
  divisionName: string;
  tiebreakerValues: number[];
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  h2hResult: 'win' | 'loss' | null;
  h2hOpponentName: string | null;
  h2hPairIndex: number | null;
}

interface DivisionStandings {
  divisionId: number;
  divisionName: string;
  headToHeadFirst: boolean;
  resultLabels: string[] | null;
  pointsPossiblePerGame: number | null;
  rankBy: RankBy;
  rows: StandingRow[];
}

interface LeagueSettings {
  leagueId: number;
  headToHeadFirst: boolean;
  resultLabels: string[] | null;
  pointsPossiblePerGame: number | null;
  rankBy: RankBy;
  maxAssignedPrimaryPoints: number;
}

interface LeagueStandingsProps {
  leagueId: number;
  canManage: boolean;
}

function formatPrimaryPoints(
  points: number,
  gamesPlayed: number,
  pointsPossiblePerGame: number | null
): string {
  if (pointsPossiblePerGame == null || pointsPossiblePerGame <= 0) {
    return String(points);
  }
  const possible = gamesPlayed * pointsPossiblePerGame;
  const percent = possible > 0 ? Math.round((points / possible) * 100) : 0;
  return `${points}/${possible} (${percent}%)`;
}

const H2H_PAIR_BADGE_CLASSES = [
  'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
] as const;

function H2hBadge({
  result,
  opponentName,
  pairIndex,
}: {
  result: 'win' | 'loss';
  opponentName: string;
  pairIndex: number;
}) {
  const tooltip = result === 'win' ? `H2H win vs. ${opponentName}` : `H2H loss vs. ${opponentName}`;
  const colorClass = H2H_PAIR_BADGE_CLASSES[pairIndex] ?? H2H_PAIR_BADGE_CLASSES[0];

  return (
    <HelpCallout
      text={tooltip}
      label={tooltip}
      tooltipClassName="w-max max-w-xs p-2 text-xs"
    >
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
        {result === 'win' ? 'H2H win' : 'H2H loss'}
      </span>
    </HelpCallout>
  );
}

export default function LeagueStandings({ leagueId, canManage }: LeagueStandingsProps) {
  const { showAlert } = useAlert();
  const resultLabelsId = useId();
  const pointsPossibleId = useId();
  const rankByLabelId = useId();
  const [standings, setStandings] = useState<DivisionStandings[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [maxAssignedPrimaryPoints, setMaxAssignedPrimaryPoints] = useState(0);
  const [settingsForm, setSettingsForm] = useState({
    headToHeadFirst: false,
    resultLabels: [] as string[],
    pointsPossiblePerGame: '',
    rankBy: 'total' as RankBy,
  });
  const [pointsPossibleError, setPointsPossibleError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadStandings = async () => {
    setLoading(true);
    try {
      const [standingsRes, settingsRes] = await Promise.all([
        (
          get as (
            path: string,
            query?: unknown,
            pathParams?: Record<string, string>
          ) => Promise<unknown>
        )('/leagues/{id}/standings', undefined, { id: String(leagueId) }),
        (
          get as (
            path: string,
            query?: unknown,
            pathParams?: Record<string, string>
          ) => Promise<unknown>
        )('/leagues/{id}/settings', undefined, { id: String(leagueId) }),
      ]);
      setStandings(standingsRes as DivisionStandings[]);
      const settings = settingsRes as LeagueSettings;
      setMaxAssignedPrimaryPoints(settings.maxAssignedPrimaryPoints ?? 0);
      setSettingsForm({
        headToHeadFirst: settings.headToHeadFirst,
        resultLabels: settings.resultLabels ?? [],
        pointsPossiblePerGame:
          settings.pointsPossiblePerGame != null ? String(settings.pointsPossiblePerGame) : '',
        rankBy: settings.rankBy ?? 'total',
      });
      setPointsPossibleError(null);
    } catch (error: unknown) {
      console.error('Failed to load standings', error);
      showAlert(formatApiError(error, 'Failed to load standings'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStandings();
  }, [leagueId]);

  const parsePointsPossible = (): number | null | 'invalid' => {
    const raw = settingsForm.pointsPossiblePerGame.trim();
    if (raw === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) return 'invalid';
    return value;
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const pointsPossible = parsePointsPossible();
    if (pointsPossible === 'invalid') {
      setPointsPossibleError('Enter a whole number of 1 or more, or leave this blank.');
      return;
    }
    if (pointsPossible != null && pointsPossible < maxAssignedPrimaryPoints) {
      setPointsPossibleError(
        `Cannot be lower than ${maxAssignedPrimaryPoints}, the highest points already assigned to a game.`
      );
      return;
    }

    setSavingSettings(true);
    try {
      await (
        put as (
          path: string,
          body: unknown,
          pathParams?: Record<string, string>
        ) => Promise<unknown>
      )(
        '/leagues/{id}/settings',
        {
          headToHeadFirst: settingsForm.headToHeadFirst,
          resultLabels: settingsForm.resultLabels.length > 0 ? settingsForm.resultLabels : null,
          pointsPossiblePerGame: pointsPossible,
          rankBy: pointsPossible != null ? settingsForm.rankBy : 'total',
        },
        { id: String(leagueId) }
      );
      setSettingsModalOpen(false);
      await loadStandings();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to save settings'), 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading standings...</div>;
  }

  const showRankBy = settingsForm.pointsPossiblePerGame.trim() !== '';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="app-section-title">Standings</h2>
        {canManage && (
          <Button variant="secondary" onClick={() => setSettingsModalOpen(true)}>
            Ranking settings
          </Button>
        )}
      </div>

      {standings.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No divisions or no results yet. Record game results to see standings.
        </p>
      ) : (
        standings.map((div) => (
          <section key={div.divisionId} className="space-y-2">
            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200">
              {div.divisionName}
            </h3>
            <div className="app-table-shell">
              <table className="app-table">
                <thead className="app-table-head">
                  <tr>
                    <th scope="col" className="app-table-th">
                      Rank
                    </th>
                    <th scope="col" className="app-table-th">
                      Team
                    </th>
                    <th scope="col" className="app-table-th text-right">
                      GP/W/L
                    </th>
                    {div.resultLabels && div.resultLabels.length > 0 ? (
                      div.resultLabels.map((label, i) => (
                        <th key={i} scope="col" className="app-table-th text-right">
                          {label}
                        </th>
                      ))
                    ) : (
                      <th scope="col" className="app-table-th text-right">
                        Pts
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {div.rows.map((row) => (
                    <tr key={row.teamId}>
                      <td className="app-table-td">{row.rank}</td>
                      <td className="app-table-td font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{row.teamName ?? `Team ${row.teamId}`}</span>
                          {row.h2hResult && row.h2hOpponentName ? (
                            <H2hBadge
                              result={row.h2hResult}
                              opponentName={row.h2hOpponentName}
                              pairIndex={row.h2hPairIndex ?? 0}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="app-table-td text-right">
                        {row.gamesPlayed}/{row.wins}/{row.losses}
                      </td>
                      {row.tiebreakerValues.length > 0 ? (
                        row.tiebreakerValues.map((v, i) => (
                          <td key={i} className="app-table-td text-right">
                            {i === 0
                              ? formatPrimaryPoints(v, row.gamesPlayed, div.pointsPossiblePerGame)
                              : v}
                          </td>
                        ))
                      ) : (
                        <td className="app-table-td text-right">—</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1">
              {div.pointsPossiblePerGame != null && div.rankBy === 'percentage' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ranked by percentage of points possible.
                </p>
              )}
              {div.headToHeadFirst && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ties broken by head-to-head.
                </p>
              )}
            </div>
          </section>
        ))
      )}

      {canManage && (
        <Modal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          title="Ranking settings"
        >
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <FormCheckbox
              label="Use head-to-head as first tiebreaker"
              checked={settingsForm.headToHeadFirst}
              onChange={(checked) =>
                setSettingsForm((prev) => ({ ...prev, headToHeadFirst: checked }))
              }
            />
            <FormField
              label="Points possible per game"
              htmlFor={pointsPossibleId}
              optional
              error={pointsPossibleError}
              helperText={
                maxAssignedPrimaryPoints > 0
                  ? `A game already has ${maxAssignedPrimaryPoints} points, so this must be at least ${maxAssignedPrimaryPoints}. Leave blank if games do not have a fixed points possible.`
                  : 'For the primary ranking points. Leave blank if games do not have a fixed points possible.'
              }
            >
              {({ describedBy, invalid }) => (
                <input
                  id={pointsPossibleId}
                  type="number"
                  min={maxAssignedPrimaryPoints > 0 ? maxAssignedPrimaryPoints : 1}
                  step={1}
                  inputMode="numeric"
                  value={settingsForm.pointsPossiblePerGame}
                  onChange={(e) => {
                    setPointsPossibleError(null);
                    setSettingsForm((prev) => ({
                      ...prev,
                      pointsPossiblePerGame: e.target.value,
                    }));
                  }}
                  className="app-input"
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                />
              )}
            </FormField>
            {showRankBy && (
              <FormField
                label="How to rank teams"
                labelId={rankByLabelId}
                helperText="Percentage uses primary points divided by points possible across games played."
              >
                <ChoiceInput<RankBy>
                  layout="block"
                  name="standings-rank-by"
                  ariaLabelledBy={rankByLabelId}
                  options={[
                    { value: 'total', label: 'Total points' },
                    { value: 'percentage', label: 'Percentage of points possible' },
                  ]}
                  value={settingsForm.rankBy}
                  onChange={(next) => {
                    if (next == null || Array.isArray(next)) return;
                    setSettingsForm((prev) => ({ ...prev, rankBy: next }));
                  }}
                />
              </FormField>
            )}
            <FormField
              label="Result column labels"
              htmlFor={resultLabelsId}
              optional
              helperText='One label per tiebreaker column, in order. Leave empty to use default "Pts".'
            >
              <input
                id={resultLabelsId}
                type="text"
                value={settingsForm.resultLabels.join(', ')}
                onChange={(e) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    resultLabels: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="e.g. Wins, Points"
                className="app-input"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setSettingsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingSettings}>
                {savingSettings ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
