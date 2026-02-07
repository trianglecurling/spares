import { useEffect, useState, type FormEvent } from 'react';
import { get, put } from '../../api/client';

function nextStrategyLocalId(): string {
  return `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface Division {
  id: number;
  leagueId: number;
  name: string;
  sortOrder?: number;
  isDefault?: boolean;
}

interface Team {
  id: number;
  leagueId: number;
  divisionId: number;
  divisionName: string;
  name: string | null;
}

/** Strategy is frontend-only state for the current schedule generation session. */
interface RoundRobinStrategy {
  localId: string;
  priority: number;
  isIntraDivision: boolean;
  divisionId: number | null;
  gamesPerTeam: number;
}

interface TeamByeRequest {
  id: number;
  teamId: number;
  teamName: string | null;
  drawDate: string;
  drawTime: string;
  priority: number;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface DrawSlot {
  date: string;
  time: string;
  isExtra: boolean;
  extraDrawId: number | null;
  sheets: Array<{ id: number; name: string; isAvailable: boolean }>;
}

interface LeagueScheduleGenerationProps {
  leagueId: number;
  divisions: Division[];
  teams: Team[];
  canManage: boolean;
}

const formatTime = (time: string) => {
  if (!time) return '';
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = (minuteStr ?? '00').padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
};

const formatDateDisplay = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const userTimezoneOffset = date.getTimezoneOffset() * 60000;
  const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
  return adjustedDate.toLocaleDateString();
};

export default function LeagueScheduleGeneration({
  leagueId,
  divisions,
  teams,
  canManage,
}: LeagueScheduleGenerationProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [strategies, setStrategies] = useState<RoundRobinStrategy[]>([]);
  const [byeRequests, setByeRequests] = useState<TeamByeRequest[]>([]);
  const [drawSlots, setDrawSlots] = useState<DrawSlot[]>([]);
  const [loadingByeRequests, setLoadingByeRequests] = useState(true);
  const [loadingDrawSlots, setLoadingDrawSlots] = useState(true);
  const [collectByeRequests, setCollectByeRequests] = useState<boolean>(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingCollectByeRequests, setSavingCollectByeRequests] = useState(false);

  const [strategyModalOpen, setStrategyModalOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<RoundRobinStrategy | null>(null);
  const [strategyForm, setStrategyForm] = useState({
    priority: 0,
    isIntraDivision: true,
    divisionId: '' as string,
    gamesPerTeam: 1,
  });

  const [editingByeTeamId, setEditingByeTeamId] = useState<number | null>(null);
  const [byePriorities, setByePriorities] = useState<Record<string, number>>({});
  const [byeTeamEditLoading, setByeTeamEditLoading] = useState(false);
  const [byeTeamEditSaving, setByeTeamEditSaving] = useState(false);

  const getUntyped = get as (
    path: string,
    query?: unknown,
    pathParams?: Record<string, string>
  ) => Promise<unknown>;

  const loadByeRequests = async () => {
    setLoadingByeRequests(true);
    try {
      const response = await getUntyped('/leagues/{id}/bye-requests', undefined, {
        id: String(leagueId),
      });
      setByeRequests((response ?? []) as TeamByeRequest[]);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to load bye requests'), 'error');
    } finally {
      setLoadingByeRequests(false);
    }
  };

  const loadDrawSlots = async () => {
    setLoadingDrawSlots(true);
    try {
      const response = await getUntyped('/leagues/{id}/draw-slots', undefined, {
        id: String(leagueId),
      });
      setDrawSlots((response ?? []) as DrawSlot[]);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to load draw slots'), 'error');
    } finally {
      setLoadingDrawSlots(false);
    }
  };

  const loadLeagueSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await getUntyped('/leagues/{id}/settings', undefined, { id: String(leagueId) }) as { collectByeRequests?: boolean };
      setCollectByeRequests(res?.collectByeRequests ?? true);
    } catch {
      setCollectByeRequests(true);
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    loadByeRequests();
    loadDrawSlots();
    loadLeagueSettings();
  }, [leagueId]);

  const openStrategyModal = (strategy?: RoundRobinStrategy) => {
    if (strategy) {
      setEditingStrategy(strategy);
      setStrategyForm({
        priority: strategy.priority,
        isIntraDivision: strategy.isIntraDivision,
        divisionId: strategy.divisionId != null ? String(strategy.divisionId) : '',
        gamesPerTeam: strategy.gamesPerTeam,
      });
    } else {
      setEditingStrategy(null);
      const defaultDivisionId = divisions.find((d) => d.isDefault)?.id ?? divisions[0]?.id;
      setStrategyForm({
        priority: strategies.length,
        isIntraDivision: true,
        divisionId: defaultDivisionId != null ? String(defaultDivisionId) : '',
        gamesPerTeam: 1,
      });
    }
    setStrategyModalOpen(true);
  };

  const getDivisionName = (divisionId: number | null): string | null => {
    if (divisionId == null) return null;
    return divisions.find((d) => d.id === divisionId)?.name ?? null;
  };

  const openTeamByeEditModal = async (teamId: number) => {
    setEditingByeTeamId(teamId);
    setByePriorities({});
    setByeTeamEditLoading(true);
    try {
      const byesRes = await getUntyped('/leagues/{leagueId}/teams/{teamId}/bye-requests', undefined, {
        leagueId: String(leagueId),
        teamId: String(teamId),
      });
      const byes = (byesRes ?? []) as Array<{ drawDate: string; drawTime: string; priority: number }>;
      const prio: Record<string, number> = {};
      byes.forEach((b) => {
        prio[`${b.drawDate}|${b.drawTime}`] = b.priority;
      });
      setByePriorities(prio);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to load bye requests'), 'error');
      setEditingByeTeamId(null);
    } finally {
      setByeTeamEditLoading(false);
    }
  };

  const closeTeamByeEditModal = () => {
    setEditingByeTeamId(null);
    setByePriorities({});
  };

  const handleSaveTeamByeRequests = async (e: FormEvent) => {
    e.preventDefault();
    if (editingByeTeamId == null || !canManage) return;
    const requests = drawSlots
      .filter((slot) => {
        const key = `${slot.date}|${slot.time}`;
        const p = byePriorities[key];
        return p != null && Number.isInteger(p) && p >= 1;
      })
      .map((slot) => ({
        drawDate: slot.date,
        drawTime: slot.time,
        priority: Number(byePriorities[`${slot.date}|${slot.time}`]),
      }));
    setByeTeamEditSaving(true);
    try {
      const putUntyped = put as (
        path: string,
        body: unknown,
        pathParams?: Record<string, string>
      ) => Promise<unknown>;
      await putUntyped(
        '/leagues/{leagueId}/teams/{teamId}/bye-requests',
        { requests },
        { leagueId: String(leagueId), teamId: String(editingByeTeamId) }
      );
      showAlert('Bye requests saved.', 'success');
      await loadByeRequests();
      closeTeamByeEditModal();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to save bye requests'), 'error');
    } finally {
      setByeTeamEditSaving(false);
    }
  };

  const handleSaveStrategy = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const divisionId = strategyForm.divisionId ? parseInt(strategyForm.divisionId, 10) : null;
    if (strategyForm.isIntraDivision && !divisionId) {
      showAlert('Select a division for intra-division strategy.', 'warning');
      return;
    }
    const next: RoundRobinStrategy = {
      localId: editingStrategy?.localId ?? nextStrategyLocalId(),
      priority: strategyForm.priority,
      isIntraDivision: strategyForm.isIntraDivision,
      divisionId: strategyForm.isIntraDivision ? divisionId : null,
      gamesPerTeam: strategyForm.gamesPerTeam,
    };
    if (editingStrategy) {
      setStrategies((prev) =>
        prev.map((s) => (s.localId === editingStrategy.localId ? next : s))
      );
    } else {
      setStrategies((prev) => [...prev, next]);
    }
    setStrategyModalOpen(false);
  };

  const handleDeleteStrategy = async (strategy: RoundRobinStrategy) => {
    if (!canManage) return;
    const confirmed = await confirm({
      title: 'Delete strategy',
      message: 'Are you sure you want to remove this round robin strategy?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    setStrategies((prev) => prev.filter((s) => s.localId !== strategy.localId));
  };

  const handleGenerateSchedule = () => {
    window.alert('Placeholder: generating schedule');
  };

  const handleCollectByeRequestsToggle = async (checked: boolean) => {
    if (!canManage) return;
    setSavingCollectByeRequests(true);
    try {
      const putUntyped = put as (path: string, body: unknown, pathParams?: Record<string, string>) => Promise<unknown>;
      await putUntyped('/leagues/{id}/settings', { collectByeRequests: checked }, { id: String(leagueId) });
      setCollectByeRequests(checked);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to update setting'), 'error');
    } finally {
      setSavingCollectByeRequests(false);
    }
  };

  const loading = loadingByeRequests || loadingDrawSlots || loadingSettings;

  if (loading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">Loading schedule generation settings…</div>
    );
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Bye request collection</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={collectByeRequests}
              disabled={savingCollectByeRequests}
              onClick={() => handleCollectByeRequestsToggle(!collectByeRequests)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                collectByeRequests
                  ? 'bg-primary-teal'
                  : 'bg-gray-200 dark:bg-gray-600'
              } ${savingCollectByeRequests ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  collectByeRequests ? 'translate-x-5' : 'translate-x-1'
                }`}
                aria-hidden
              />
            </button>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Collect bye requests
            </label>
            {savingCollectByeRequests && (
              <span className="text-sm text-gray-500 dark:text-gray-400">Saving…</span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            When enabled, league members will see a &quot;Submit bye requests&quot; button on the league Overview.
          </p>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Round robin strategies
          </h2>
          {canManage && (
            <Button onClick={() => openStrategyModal()} variant="secondary">
              Add strategy
            </Button>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Strategies are applied in priority order (lower number first). Each strategy defines how many games per team
          and whether games are within one division (intra) or across divisions (cross).
        </p>
        {strategies.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No strategies configured. Add one to define how many games per team and intra/cross division.
          </div>
        ) : (
          <ul className="space-y-2">
            {strategies
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((s) => (
                <li
                  key={s.localId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
                >
                  <div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">Priority {s.priority}</span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {s.isIntraDivision
                        ? `Intra: ${getDivisionName(s.divisionId) ?? 'Division'}`
                        : 'Cross-division'}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-600 dark:text-gray-300">{s.gamesPerTeam} {s.gamesPerTeam === 1 ? 'game' : 'games'}/team</span>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openStrategyModal(s)}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => handleDeleteStrategy(s)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Bye requests</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Teams can request specific draw times as byes. Lower priority number means higher preference (1 = highest). Edit per team to set or change bye priorities.
        </p>
        {teams.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No teams. Add teams to configure bye requests.
          </div>
        ) : (
          <ul className="space-y-2">
            {teams
              .slice()
              .sort((a, b) => {
                const divCmp = a.divisionName.localeCompare(b.divisionName);
                if (divCmp !== 0) return divCmp;
                return (a.name ?? `Team ${a.id}`).localeCompare(b.name ?? `Team ${b.id}`);
              })
              .map((team) => {
                const teamByes = byeRequests.filter((b) => b.teamId === team.id);
                const summary =
                  teamByes.length === 0
                    ? 'No bye requests'
                    : `${teamByes.length} bye request${teamByes.length === 1 ? '' : 's'}`;
                return (
                  <li
                    key={team.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
                  >
                    <div>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {team.name ?? `Team ${team.id}`}
                      </span>
                      <span className="mx-2 text-gray-400">·</span>
                      <span className="text-gray-600 dark:text-gray-300">{team.divisionName}</span>
                      <span className="mx-2 text-gray-400">·</span>
                      <span className="text-gray-500 dark:text-gray-400">{summary}</span>
                    </div>
                    {canManage && (
                      <Button
                        variant="secondary"
                        onClick={() => openTeamByeEditModal(team.id)}
                        disabled={drawSlots.length === 0}
                      >
                        Edit
                      </Button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {canManage && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Generate schedule</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use the strategies and bye requests above, then generate a schedule preview. You can review and commit or
            adjust before saving.
          </p>
          <Button onClick={handleGenerateSchedule}>Generate schedule</Button>
        </section>
      )}

      {canManage && strategyModalOpen && (
        <Modal
          isOpen={strategyModalOpen}
          title={editingStrategy ? 'Edit strategy' : 'Add strategy'}
          onClose={() => setStrategyModalOpen(false)}
        >
          <form onSubmit={handleSaveStrategy} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Priority (lower = applied first)
              </label>
              <input
                type="number"
                min={0}
                value={strategyForm.priority}
                onChange={(e) => setStrategyForm((prev) => ({ ...prev, priority: parseInt(e.target.value, 10) || 0 }))}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="strategy-intra"
                checked={strategyForm.isIntraDivision}
                onChange={(e) =>
                  setStrategyForm((prev) => ({ ...prev, isIntraDivision: e.target.checked }))
                }
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <label htmlFor="strategy-intra" className="text-sm text-gray-700 dark:text-gray-300">
                Intra-division (within one division)
              </label>
            </div>
            {strategyForm.isIntraDivision && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Division</label>
                <select
                  value={strategyForm.divisionId}
                  onChange={(e) => setStrategyForm((prev) => ({ ...prev, divisionId: e.target.value }))}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select division</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Games per team
              </label>
              <input
                type="number"
                min={1}
                value={strategyForm.gamesPerTeam}
                onChange={(e) =>
                  setStrategyForm((prev) => ({ ...prev, gamesPerTeam: parseInt(e.target.value, 10) || 1 }))
                }
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setStrategyModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {editingStrategy ? 'Update' : 'Add'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {canManage && editingByeTeamId !== null && (
        <Modal
          isOpen={true}
          title={`Bye requests · ${teams.find((t) => t.id === editingByeTeamId)?.name ?? `Team ${editingByeTeamId}`}`}
          onClose={closeTeamByeEditModal}
        >
          <form onSubmit={handleSaveTeamByeRequests} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Assign a priority to any draw date you want as a bye. Lower number = higher preference (1 = most preferred). Leave blank for no preference.
            </p>
            {byeTeamEditLoading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading draw schedule…</div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {drawSlots.map((slot) => {
                  const key = `${slot.date}|${slot.time}`;
                  const value = byePriorities[key];
                  return (
                    <div key={key} className="flex items-center gap-3 text-sm">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">
                        {formatDateDisplay(slot.date)} · {formatTime(slot.time)}
                        {slot.isExtra && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">(extra)</span>
                        )}
                      </span>
                      <label className="sr-only" htmlFor={`bye-priority-${key}`}>
                        Priority for {slot.date} {slot.time}
                      </label>
                      <input
                        id={`bye-priority-${key}`}
                        type="number"
                        min={1}
                        placeholder="—"
                        value={value === undefined || value === 0 ? '' : value}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setByePriorities((prev) => ({
                            ...prev,
                            [key]: v === '' ? 0 : parseInt(v, 10) || 0,
                          }));
                        }}
                        className="w-20 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-gray-100 text-right"
                      />
                    </div>
                  );
                })}
                {drawSlots.length === 0 && !byeTeamEditLoading && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No draw slots for this league.</div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={closeTeamByeEditModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={byeTeamEditSaving || byeTeamEditLoading}>
                {byeTeamEditSaving ? 'Saving…' : 'Save bye requests'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
