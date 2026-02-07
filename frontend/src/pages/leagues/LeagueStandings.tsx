import { useEffect, useState } from 'react';
import { get, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface StandingRow {
  rank: number;
  teamId: number;
  teamName: string | null;
  divisionId: number;
  divisionName: string;
  tiebreakerValues: number[];
  gamesPlayed: number;
}

interface DivisionStandings {
  divisionId: number;
  divisionName: string;
  headToHeadFirst: boolean;
  resultLabels: string[] | null;
  rows: StandingRow[];
}

interface LeagueSettings {
  leagueId: number;
  headToHeadFirst: boolean;
  resultLabels: string[] | null;
}

interface LeagueStandingsProps {
  leagueId: number;
  canManage: boolean;
}

export default function LeagueStandings({ leagueId, canManage }: LeagueStandingsProps) {
  const { showAlert } = useAlert();
  const [standings, setStandings] = useState<DivisionStandings[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    headToHeadFirst: false,
    resultLabels: [] as string[],
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const loadStandings = async () => {
    setLoading(true);
    try {
      const [standingsRes, settingsRes] = await Promise.all([
        (get as (path: string, query?: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
          '/leagues/{id}/standings',
          undefined,
          { id: String(leagueId) }
        ),
        (get as (path: string, query?: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
          '/leagues/{id}/settings',
          undefined,
          { id: String(leagueId) }
        ),
      ]);
      setStandings(standingsRes as DivisionStandings[]);
      setSettingsForm({
        headToHeadFirst: (settingsRes as LeagueSettings).headToHeadFirst,
        resultLabels: (settingsRes as LeagueSettings).resultLabels ?? [],
      });
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      (put as (path: string, body: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
        '/leagues/{id}/settings',
        {
          headToHeadFirst: settingsForm.headToHeadFirst,
          resultLabels: settingsForm.resultLabels.length > 0 ? settingsForm.resultLabels : null,
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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Standings</h2>
        {canManage && (
          <Button variant="secondary" onClick={() => setSettingsModalOpen(true)}>
            Ranking settings
          </Button>
        )}
      </div>

      {standings.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No divisions or no results yet. Record game results to see standings.</p>
      ) : (
        standings.map((div) => (
          <section key={div.divisionId} className="space-y-2">
            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200">{div.divisionName}</h3>
            <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Rank
                    </th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Team
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      GP
                    </th>
                    {div.resultLabels && div.resultLabels.length > 0 ? (
                      div.resultLabels.map((label, i) => (
                        <th key={i} scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {label}
                        </th>
                      ))
                    ) : (
                      <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Pts
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {div.rows.map((row) => (
                    <tr key={row.teamId}>
                      <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{row.rank}</td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {row.teamName ?? `Team ${row.teamId}`}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 text-right">{row.gamesPlayed}</td>
                      {row.tiebreakerValues.length > 0 ? (
                        row.tiebreakerValues.map((v, i) => (
                          <td key={i} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 text-right">
                            {v}
                          </td>
                        ))
                      ) : (
                        <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 text-right">—</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {div.headToHeadFirst && (
              <p className="text-xs text-gray-500 dark:text-gray-400">Ties broken by head-to-head when enabled.</p>
            )}
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
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsForm.headToHeadFirst}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, headToHeadFirst: e.target.checked }))}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Use head-to-head as first tiebreaker</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Result column labels (e.g. Win/Loss, Score)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                One label per tiebreaker column, in order. Leave empty to use default &quot;Pts&quot;.
              </p>
              <input
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
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              />
            </div>
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
