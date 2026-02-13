import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { get, post, put } from '../../api/client';

function nextStrategyLocalId(): string {
  return `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextConstraintLocalId(): string {
  return `constraint-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Hard constraint: required bye week for a team. */
interface HardConstraintBye {
  type: 'bye';
  localId: string;
  teamId: number;
  drawDate: string;
}

/** Hard constraint: required draw (and optional sheet) for a specific match-up. */
interface HardConstraintMatchup {
  type: 'matchup';
  localId: string;
  team1Id: number;
  team2Id: number;
  drawDate: string;
  drawTime: string;
  sheetId: number | null;
}

type HardConstraint = HardConstraintBye | HardConstraintMatchup;
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { useScheduleGenerator } from '../../scheduling/useScheduleGenerator';
import type { ScheduleInput } from '../../scheduling/types';

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
  /** Draw slot keys ("date|time") this strategy is allowed to use. */
  drawSlotKeys: string[];
}

interface TeamByeRequest {
  id: number;
  teamId: number;
  teamName: string | null;
  drawDate: string;
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

interface ExistingGame {
  id: number;
  gameDate: string | null;
  gameTime: string | null;
  sheetId: number | null;
  team1Id: number;
  team2Id: number;
  status: string;
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
  const [preferLateDrawByTeam, setPreferLateDrawByTeam] = useState<Record<number, boolean>>({});
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
    drawSlotKeys: [] as string[],
  });

  const [existingGames, setExistingGames] = useState<ExistingGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);

  const [editingByeTeamId, setEditingByeTeamId] = useState<number | null>(null);
  const [byePriorities, setByePriorities] = useState<Record<string, number>>({});
  const [preferLateDraw, setPreferLateDraw] = useState(false);
  const [byeTeamEditLoading, setByeTeamEditLoading] = useState(false);
  const [byeTeamEditSaving, setByeTeamEditSaving] = useState(false);

  const {
    generate,
    isGenerating,
    progress,
    result,
    error: genError,
    reset: resetGenerator,
  } = useScheduleGenerator();
  const [committing, setCommitting] = useState(false);
  const [includeUnscheduled, setIncludeUnscheduled] = useState(false);
  /** 0 = no optimization, 100 = 5 minutes of iterations */
  const [optimizationLevel, setOptimizationLevel] = useState(60);

  const [hardConstraints, setHardConstraints] = useState<HardConstraint[]>([]);
  const [constraintModalOpen, setConstraintModalOpen] = useState(false);
  const [hardConstraintForm, setHardConstraintForm] = useState<{
    type: 'bye' | 'matchup';
    teamId: string;
    team1Id: string;
    team2Id: string;
    drawDate: string;
    drawTime: string;
    sheetId: string;
  }>({
    type: 'bye',
    teamId: '',
    team1Id: '',
    team2Id: '',
    drawDate: '',
    drawTime: '',
    sheetId: '',
  });

  const teamNameMap = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name ?? `Team ${t.id}`])),
    [teams]
  );

  /** All unique sheet objects across draw slots, sorted by id. */
  const allSheets = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>();
    for (const ds of drawSlots) {
      for (const s of ds.sheets) {
        if (!seen.has(s.id)) seen.set(s.id, { id: s.id, name: s.name });
      }
    }
    return [...seen.values()].sort((a, b) => a.id - b.id);
  }, [drawSlots]);

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
      const data = response as {
        requests?: TeamByeRequest[];
        preferLateDrawByTeam?: Record<number, boolean>;
      } | null;
      if (data && Array.isArray(data.requests)) {
        setByeRequests(data.requests);
        setPreferLateDrawByTeam(data.preferLateDrawByTeam ?? {});
      } else {
        setByeRequests([]);
        setPreferLateDrawByTeam({});
      }
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
      const res = (await getUntyped('/leagues/{id}/settings', undefined, {
        id: String(leagueId),
      })) as { collectByeRequests?: boolean };
      setCollectByeRequests(res?.collectByeRequests ?? true);
    } catch {
      setCollectByeRequests(true);
    } finally {
      setLoadingSettings(false);
    }
  };

  const loadExistingGames = async () => {
    setLoadingGames(true);
    try {
      const response = await getUntyped(
        '/leagues/{id}/games',
        { includeUnscheduled: true },
        {
          id: String(leagueId),
        }
      );
      setExistingGames((response ?? []) as ExistingGame[]);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to load existing games'), 'error');
    } finally {
      setLoadingGames(false);
    }
  };

  /** Set of "date|time" keys for draw slots that already have scheduled games. */
  const occupiedSlotKeys = new Set(
    existingGames.filter((g) => g.gameDate && g.gameTime).map((g) => `${g.gameDate}|${g.gameTime}`)
  );

  useEffect(() => {
    loadByeRequests();
    loadDrawSlots();
    loadLeagueSettings();
    loadExistingGames();
  }, [leagueId]);

  const openStrategyModal = (strategy?: RoundRobinStrategy) => {
    const allSlotKeys = drawSlots.map((s) => `${s.date}|${s.time}`);
    if (strategy) {
      setEditingStrategy(strategy);
      setStrategyForm({
        priority: strategy.priority,
        isIntraDivision: strategy.isIntraDivision,
        divisionId: strategy.divisionId != null ? String(strategy.divisionId) : '',
        gamesPerTeam: strategy.gamesPerTeam,
        drawSlotKeys: strategy.drawSlotKeys,
      });
    } else {
      setEditingStrategy(null);
      const defaultDivisionId = divisions.find((d) => d.isDefault)?.id ?? divisions[0]?.id;
      setStrategyForm({
        priority: strategies.length,
        isIntraDivision: true,
        divisionId: defaultDivisionId != null ? String(defaultDivisionId) : '',
        gamesPerTeam: 1,
        drawSlotKeys: allSlotKeys.filter((k) => !occupiedSlotKeys.has(k)),
      });
    }
    setStrategyModalOpen(true);
  };

  const getDivisionName = (divisionId: number | null): string | null => {
    if (divisionId == null) return null;
    return divisions.find((d) => d.id === divisionId)?.name ?? null;
  };

  /** Unique sorted draw dates across all draw slots. */
  const uniqueDrawDates = useMemo(() => {
    const dates = new Set(drawSlots.map((s) => s.date));
    return [...dates].sort();
  }, [drawSlots]);

  /** League has 2+ draw times (e.g. early and late draw). */
  const hasTwoDraws = useMemo(() => new Set(drawSlots.map((s) => s.time)).size >= 2, [drawSlots]);

  const openTeamByeEditModal = async (teamId: number) => {
    setEditingByeTeamId(teamId);
    setByePriorities({});
    setPreferLateDraw(false);
    setByeTeamEditLoading(true);
    try {
      const byesRes = await getUntyped(
        '/leagues/{leagueId}/teams/{teamId}/bye-requests',
        undefined,
        {
          leagueId: String(leagueId),
          teamId: String(teamId),
        }
      );
      const data = byesRes as {
        byeRequests?: Array<{ drawDate: string; priority: number }>;
        preferLateDraw?: boolean;
      } | null;
      const byes = data?.byeRequests ?? [];
      const prio: Record<string, number> = {};
      byes.forEach((b) => {
        prio[b.drawDate] = b.priority;
      });
      setByePriorities(prio);
      setPreferLateDraw(Boolean(data?.preferLateDraw));
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
    setPreferLateDraw(false);
  };

  const handleSaveTeamByeRequests = async (e: FormEvent) => {
    e.preventDefault();
    if (editingByeTeamId == null || !canManage) return;
    const requests = uniqueDrawDates
      .filter((date) => {
        const p = byePriorities[date];
        return p != null && Number.isInteger(p) && p >= 1;
      })
      .map((date) => ({
        drawDate: date,
        priority: Number(byePriorities[date]),
      }));
    const body = hasTwoDraws ? { requests, preferLateDraw } : { requests };
    setByeTeamEditSaving(true);
    try {
      const putUntyped = put as (
        path: string,
        body: unknown,
        pathParams?: Record<string, string>
      ) => Promise<unknown>;
      await putUntyped('/leagues/{leagueId}/teams/{teamId}/bye-requests', body, {
        leagueId: String(leagueId),
        teamId: String(editingByeTeamId),
      });
      showAlert('Bye requests saved.', 'success');
      await loadByeRequests();
      closeTeamByeEditModal();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to save bye requests'), 'error');
    } finally {
      setByeTeamEditSaving(false);
    }
  };

  const openConstraintModal = () => {
    setHardConstraintForm({
      type: 'bye',
      teamId: '',
      team1Id: '',
      team2Id: '',
      drawDate: '',
      drawTime: '',
      sheetId: '',
    });
    setConstraintModalOpen(true);
  };

  const handleAddHardConstraint = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (hardConstraintForm.type === 'bye') {
      const teamId = Number(hardConstraintForm.teamId);
      const drawDate = hardConstraintForm.drawDate;
      if (!teamId || !drawDate) {
        showAlert('Select a team and bye date.', 'warning');
        return;
      }
      setHardConstraints((prev) => [
        ...prev,
        { type: 'bye', localId: nextConstraintLocalId(), teamId, drawDate },
      ]);
      setConstraintModalOpen(false);
      return;
    }
    const team1Id = Number(hardConstraintForm.team1Id);
    const team2Id = Number(hardConstraintForm.team2Id);
    const drawDate = hardConstraintForm.drawDate;
    const drawTime = hardConstraintForm.drawTime;
    const sheetId = hardConstraintForm.sheetId ? Number(hardConstraintForm.sheetId) : null;
    if (!team1Id || !team2Id || team1Id === team2Id) {
      showAlert('Select two different teams.', 'warning');
      return;
    }
    if (!drawDate || !drawTime) {
      showAlert('Select a draw (date and time).', 'warning');
      return;
    }
    setHardConstraints((prev) => [
      ...prev,
      {
        type: 'matchup',
        localId: nextConstraintLocalId(),
        team1Id,
        team2Id,
        drawDate,
        drawTime,
        sheetId,
      },
    ]);
    setConstraintModalOpen(false);
  };

  const handleRemoveHardConstraint = (localId: string) => {
    setHardConstraints((prev) => prev.filter((c) => c.localId !== localId));
  };

  const handleSaveStrategy = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const divisionId = strategyForm.divisionId ? parseInt(strategyForm.divisionId, 10) : null;
    if (strategyForm.isIntraDivision && !divisionId) {
      showAlert('Select a division for intra-division strategy.', 'warning');
      return;
    }
    if (strategyForm.drawSlotKeys.length === 0) {
      showAlert('Select at least one draw slot for this strategy.', 'warning');
      return;
    }
    const conflicting = strategyForm.drawSlotKeys.filter((k) => occupiedSlotKeys.has(k));
    if (conflicting.length > 0) {
      const labels = conflicting.map((k) => {
        const [d, t] = k.split('|');
        return `${formatDateDisplay(d)} ${formatTime(t)}`;
      });
      showAlert(`Cannot use draw slots that already have games: ${labels.join(', ')}`, 'warning');
      return;
    }
    const next: RoundRobinStrategy = {
      localId: editingStrategy?.localId ?? nextStrategyLocalId(),
      priority: strategyForm.priority,
      isIntraDivision: strategyForm.isIntraDivision,
      divisionId: strategyForm.isIntraDivision ? divisionId : null,
      gamesPerTeam: strategyForm.gamesPerTeam,
      drawSlotKeys: strategyForm.drawSlotKeys,
    };
    if (editingStrategy) {
      setStrategies((prev) => prev.map((s) => (s.localId === editingStrategy.localId ? next : s)));
    } else {
      setStrategies((prev) => [...prev, next]);
    }
    setStrategyModalOpen(false);
  };

  const handleDeleteStrategy = async (strategy: RoundRobinStrategy) => {
    if (!canManage) return;
    const confirmed = await confirm({
      title: 'Delete round',
      message: 'Are you sure you want to remove this round?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    setStrategies((prev) => prev.filter((s) => s.localId !== strategy.localId));
  };

  const buildScheduleInput = (seed: number): ScheduleInput => {
    const optimizationTimeBudgetMs = (optimizationLevel / 100) * 5 * 60 * 1000;
    return {
      strategies: strategies.map((s) => ({
        localId: s.localId,
        priority: s.priority,
        isIntraDivision: s.isIntraDivision,
        divisionId: s.divisionId,
        gamesPerTeam: s.gamesPerTeam,
        drawSlotKeys: s.drawSlotKeys,
      })),
      teams: teams.map((t) => ({ id: t.id, divisionId: t.divisionId, name: t.name })),
      divisions: divisions.map((d) => ({ id: d.id, name: d.name })),
      drawSlots: drawSlots.map((ds) => ({
        date: ds.date,
        time: ds.time,
        sheets: ds.sheets,
      })),
      byeRequests: byeRequests.map((b) => ({
        teamId: b.teamId,
        drawDate: b.drawDate,
        priority: b.priority,
      })),
      seed,
      optimizationTimeBudgetMs,
    };
  };

  const handleGenerateSchedule = () => {
    if (!canManage || strategies.length === 0) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    generate(buildScheduleInput(seed));
  };

  const handleRegenerateSchedule = () => {
    if (!canManage || strategies.length === 0) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    resetGenerator();
    generate(buildScheduleInput(seed));
  };

  const handleCommitSchedule = async () => {
    if (!canManage || !result) return;

    const gamesToCommit: Array<{
      team1Id: number;
      team2Id: number;
      gameDate?: string;
      gameTime?: string;
      sheetId?: number;
      status: 'scheduled' | 'unscheduled';
    }> = result.games.map((g) => ({
      team1Id: g.team1Id,
      team2Id: g.team2Id,
      gameDate: g.gameDate,
      gameTime: g.gameTime,
      sheetId: g.sheetId,
      status: 'scheduled' as const,
    }));

    if (includeUnscheduled && result.unschedulable.length > 0) {
      for (const u of result.unschedulable) {
        gamesToCommit.push({
          team1Id: u.team1Id,
          team2Id: u.team2Id,
          status: 'unscheduled',
        });
      }
    }

    if (gamesToCommit.length === 0) {
      showAlert('No games to save.', 'warning');
      return;
    }

    const confirmed = await confirm({
      title: 'Commit schedule',
      message: `Save ${gamesToCommit.length} game${gamesToCommit.length === 1 ? '' : 's'} to the league schedule?`,
      confirmText: 'Save',
    });
    if (!confirmed) return;

    setCommitting(true);
    try {
      const postUntyped = post as (
        path: string,
        body: unknown,
        pathParams?: Record<string, string>
      ) => Promise<unknown>;
      await postUntyped(
        '/leagues/{id}/games/bulk',
        { games: gamesToCommit },
        { id: String(leagueId) }
      );
      showAlert(`${gamesToCommit.length} games saved.`, 'success');
      resetGenerator();
      await loadExistingGames();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to save schedule'), 'error');
    } finally {
      setCommitting(false);
    }
  };

  const handleCollectByeRequestsToggle = async (checked: boolean) => {
    if (!canManage) return;
    setSavingCollectByeRequests(true);
    try {
      const putUntyped = put as (
        path: string,
        body: unknown,
        pathParams?: Record<string, string>
      ) => Promise<unknown>;
      await putUntyped(
        '/leagues/{id}/settings',
        { collectByeRequests: checked },
        { id: String(leagueId) }
      );
      setCollectByeRequests(checked);
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to update setting'), 'error');
    } finally {
      setSavingCollectByeRequests(false);
    }
  };

  const loading = loadingByeRequests || loadingDrawSlots || loadingSettings || loadingGames;

  if (loading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Loading schedule generation settings…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Bye request collection
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={collectByeRequests}
              disabled={savingCollectByeRequests}
              onClick={() => handleCollectByeRequestsToggle(!collectByeRequests)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                collectByeRequests ? 'bg-primary-teal' : 'bg-gray-200 dark:bg-gray-600'
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
            When enabled, league members will see an &quot;Update bye requests&quot; button on the
            league Overview.
          </p>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Rounds</h2>
          {canManage && (
            <Button onClick={() => openStrategyModal()} variant="secondary">
              Add round
            </Button>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Rounds are applied in priority order (lower number first). Each round defines how many
          times each pair of teams plays and whether games are within one division (intra) or across
          divisions (cross).
        </p>
        {strategies.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No strategies configured. Add one to define how many games per team and intra/cross
            division.
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
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      Priority {s.priority}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {s.isIntraDivision
                        ? `Intra: ${getDivisionName(s.divisionId) ?? 'Division'}`
                        : 'Cross-division'}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {s.gamesPerTeam === 1
                        ? 'Single RR'
                        : s.gamesPerTeam === 2
                          ? 'Double RR'
                          : `${s.gamesPerTeam}x RR`}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      {s.drawSlotKeys.length} {s.drawSlotKeys.length === 1 ? 'draw' : 'draws'}
                    </span>
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
        <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <summary className="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
            Bye requests
          </summary>
          <div className="px-4 pb-4 pt-0 space-y-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400 pt-3">
              Teams can request specific draw times as byes. Lower priority number means higher
              preference (1 = highest). Edit per team to set or change bye priorities.
            </p>
            {teams.length === 0 ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
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
                    const prefersLate = preferLateDrawByTeam[team.id];
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
                          <span className="text-gray-600 dark:text-gray-300">
                            {team.divisionName}
                          </span>
                          <span className="mx-2 text-gray-400">·</span>
                          <span className="text-gray-500 dark:text-gray-400">{summary}</span>
                          {prefersLate && (
                            <span className="ml-2 text-gray-500 dark:text-gray-400">
                              · Prefers late draw
                            </span>
                          )}
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
          </div>
        </details>
      </section>

      {canManage && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Hard constraints
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                Require specific outcomes in the generated schedule.
              </p>
            </div>
            <Button variant="secondary" onClick={openConstraintModal}>
              Add constraint
            </Button>
          </div>
          {hardConstraints.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No hard constraints added.</p>
          ) : (
            <ul className="space-y-2">
              {hardConstraints.map((c) => (
                <li
                  key={c.localId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
                >
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {c.type === 'bye' ? (
                      <>
                        <span className="font-medium">Bye week:</span>{' '}
                        {teams.find((t) => t.id === c.teamId)?.name ?? `Team ${c.teamId}`} on{' '}
                        {formatDateDisplay(c.drawDate)}
                      </>
                    ) : (
                      <>
                        <span className="font-medium">Match-up:</span>{' '}
                        {teams.find((t) => t.id === c.team1Id)?.name ?? `Team ${c.team1Id}`} vs{' '}
                        {teams.find((t) => t.id === c.team2Id)?.name ?? `Team ${c.team2Id}`} at{' '}
                        {formatDateDisplay(c.drawDate)} {formatTime(c.drawTime)}
                        {c.sheetId != null && (
                          <>
                            {' '}
                            ·{' '}
                            {drawSlots.flatMap((d) => d.sheets).find((s) => s.id === c.sheetId)
                              ?.name ?? `Sheet ${c.sheetId}`}
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <Button variant="danger" onClick={() => handleRemoveHardConstraint(c.localId)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canManage && constraintModalOpen && (
        <Modal
          isOpen={constraintModalOpen}
          title="Add constraint"
          onClose={() => setConstraintModalOpen(false)}
        >
          <form onSubmit={handleAddHardConstraint} className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
              <select
                value={hardConstraintForm.type}
                onChange={(e) =>
                  setHardConstraintForm((f) => ({
                    ...f,
                    type: e.target.value as 'bye' | 'matchup',
                    teamId: '',
                    team1Id: '',
                    team2Id: '',
                    drawDate: '',
                    drawTime: '',
                    sheetId: '',
                  }))
                }
                className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="bye">Bye week</option>
                <option value="matchup">Match-up</option>
              </select>
            </div>
            {hardConstraintForm.type === 'bye' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Team
                  </label>
                  <select
                    value={hardConstraintForm.teamId}
                    onChange={(e) =>
                      setHardConstraintForm((f) => ({ ...f, teamId: e.target.value }))
                    }
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[140px]"
                  >
                    <option value="">Select team</option>
                    {teams
                      .slice()
                      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name ?? `Team ${t.id}`}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Bye date
                  </label>
                  <select
                    value={hardConstraintForm.drawDate}
                    onChange={(e) =>
                      setHardConstraintForm((f) => ({ ...f, drawDate: e.target.value }))
                    }
                    className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[140px]"
                  >
                    <option value="">Select date</option>
                    {uniqueDrawDates.map((d) => (
                      <option key={d} value={d}>
                        {formatDateDisplay(d)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Team 1
                    </label>
                    <select
                      value={hardConstraintForm.team1Id}
                      onChange={(e) =>
                        setHardConstraintForm((f) => ({ ...f, team1Id: e.target.value }))
                      }
                      className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[140px]"
                    >
                      <option value="">Select team</option>
                      {teams
                        .slice()
                        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name ?? `Team ${t.id}`}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Team 2
                    </label>
                    <select
                      value={hardConstraintForm.team2Id}
                      onChange={(e) =>
                        setHardConstraintForm((f) => ({ ...f, team2Id: e.target.value }))
                      }
                      className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[140px]"
                    >
                      <option value="">Select team</option>
                      {teams
                        .slice()
                        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name ?? `Team ${t.id}`}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Draw
                    </label>
                    <select
                      value={
                        hardConstraintForm.drawDate && hardConstraintForm.drawTime
                          ? `${hardConstraintForm.drawDate}|${hardConstraintForm.drawTime}`
                          : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          setHardConstraintForm((f) => ({
                            ...f,
                            drawDate: '',
                            drawTime: '',
                            sheetId: '',
                          }));
                          return;
                        }
                        const [date, time] = v.split('|');
                        setHardConstraintForm((f) => ({
                          ...f,
                          drawDate: date ?? '',
                          drawTime: time ?? '',
                          sheetId: '',
                        }));
                      }}
                      className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[180px]"
                    >
                      <option value="">Select draw</option>
                      {drawSlots
                        .slice()
                        .sort((a, b) => {
                          const d = (a.date ?? '').localeCompare(b.date ?? '');
                          return d !== 0 ? d : (a.time ?? '').localeCompare(b.time ?? '');
                        })
                        .map((slot) => (
                          <option
                            key={`${slot.date}|${slot.time}`}
                            value={`${slot.date}|${slot.time}`}
                          >
                            {formatDateDisplay(slot.date)} {formatTime(slot.time)}
                          </option>
                        ))}
                    </select>
                  </div>
                  {(() => {
                    const slot = drawSlots.find(
                      (s) =>
                        s.date === hardConstraintForm.drawDate &&
                        s.time === hardConstraintForm.drawTime
                    );
                    const sheets = slot?.sheets ?? [];
                    return (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Sheet (optional)
                        </label>
                        <select
                          value={hardConstraintForm.sheetId}
                          onChange={(e) =>
                            setHardConstraintForm((f) => ({ ...f, sheetId: e.target.value }))
                          }
                          disabled={sheets.length === 0}
                          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 min-w-[120px]"
                        >
                          <option value="">Any sheet</option>
                          {sheets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConstraintModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {hardConstraintForm.type === 'bye'
                  ? 'Add bye constraint'
                  : 'Add match-up constraint'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {canManage && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Generate schedule
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use the strategies and bye requests above, then generate a schedule preview. You can
            review and commit or adjust before saving.
          </p>
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Optimization
                <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                  {optimizationLevel === 0
                    ? 'None (0 iterations)'
                    : (() => {
                        const totalSeconds = Math.round((optimizationLevel / 100) * 5 * 60);
                        if (totalSeconds >= 60) {
                          const mins = Math.floor(totalSeconds / 60);
                          const secs = totalSeconds % 60;
                          return secs > 0
                            ? `${mins}m ${secs}s`
                            : `${mins} minute${mins !== 1 ? 's' : ''}`;
                        }
                        return `${totalSeconds}s`;
                      })()}
                </span>
              </label>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                Decide how much time to spend optimizing the schedule. This specifies how long it
                will take to generate your schedule.
              </p>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={optimizationLevel}
              onChange={(e) => setOptimizationLevel(Number(e.target.value))}
              disabled={isGenerating}
              className="h-2 w-full max-w-sm cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700 accent-primary-teal"
            />
          </div>
          {!result && !isGenerating && (
            <Button
              onClick={handleGenerateSchedule}
              disabled={strategies.length === 0 || teams.length < 2}
            >
              Generate schedule
            </Button>
          )}

          {/* Progress indicator */}
          {isGenerating && progress && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{progress.phase}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary-teal transition-all duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{progress.message}</p>
            </div>
          )}

          {/* Error display */}
          {genError && (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
              <p className="font-medium mb-1">Schedule generation failed</p>
              <p>{genError}</p>
              <Button variant="secondary" onClick={resetGenerator} className="mt-2">
                Dismiss
              </Button>
            </div>
          )}

          {/* Preview */}
          {result && (
            <div className="space-y-6">
              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-2">
                  {result.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 text-sm ${
                        w.severity === 'error'
                          ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                          : w.severity === 'warning'
                            ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                            : 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      {w.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Summary line */}
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{result.games.length}</span> scheduled game
                {result.games.length !== 1 ? 's' : ''}
                {result.unschedulable.length > 0 && (
                  <span>
                    ,{' '}
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {result.unschedulable.length}
                    </span>{' '}
                    unschedulable
                  </span>
                )}
              </div>

              {/* Schedule grid */}
              {result.games.length > 0 &&
                (() => {
                  // Group games by draw (date|time)
                  const gamesByDraw = new Map<string, typeof result.games>();
                  for (const g of result.games) {
                    const dk = `${g.gameDate}|${g.gameTime}`;
                    const list = gamesByDraw.get(dk) ?? [];
                    list.push(g);
                    gamesByDraw.set(dk, list);
                  }
                  // Sort draws chronologically
                  const drawKeys = [...gamesByDraw.keys()].sort();
                  // Build bye lookup for highlighting (keyed by date)
                  const byeByDate = new Map<string, Set<number>>();
                  for (const b of byeRequests) {
                    const s = byeByDate.get(b.drawDate) ?? new Set();
                    s.add(b.teamId);
                    byeByDate.set(b.drawDate, s);
                  }
                  // Group draw keys by date (week)
                  const drawKeysByDate = new Map<string, string[]>();
                  for (const dk of drawKeys) {
                    const [date] = dk.split('|');
                    const list = drawKeysByDate.get(date) ?? [];
                    list.push(dk);
                    drawKeysByDate.set(date, list);
                  }
                  const sortedDates = [...drawKeysByDate.keys()].sort();

                  // Build set of all team ids involved in the schedule
                  const allTeamIds = new Set<number>();
                  for (const g of result.games) {
                    allTeamIds.add(g.team1Id);
                    allTeamIds.add(g.team2Id);
                  }

                  return sortedDates.map((date, dateIdx) => {
                    const dateDrawKeys = drawKeysByDate.get(date) ?? [];

                    // Determine which teams play on this date (any draw)
                    const teamsPlayingThisDate = new Set<number>();
                    for (const dk of dateDrawKeys) {
                      const games = gamesByDraw.get(dk) ?? [];
                      for (const g of games) {
                        teamsPlayingThisDate.add(g.team1Id);
                        teamsPlayingThisDate.add(g.team2Id);
                      }
                    }
                    // Teams on bye = teams not playing any draw this date
                    const byeTeamIds = [...allTeamIds].filter(
                      (id) => !teamsPlayingThisDate.has(id)
                    );
                    byeTeamIds.sort((a, b) => {
                      const nameA = teamNameMap.get(a) ?? '';
                      const nameB = teamNameMap.get(b) ?? '';
                      return nameA.localeCompare(nameB);
                    });

                    return (
                      <div key={date} className={dateIdx > 0 ? 'mt-6' : ''}>
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          {formatDateDisplay(date)}
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm border-collapse">
                            <thead>
                              <tr>
                                <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                                  Draw
                                </th>
                                {allSheets.map((sheet) => (
                                  <th
                                    key={sheet.id}
                                    className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-medium bg-gray-50 dark:bg-gray-900"
                                  >
                                    {sheet.name}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dateDrawKeys.map((dk) => {
                                const [, time] = dk.split('|');
                                const games = gamesByDraw.get(dk) ?? [];
                                const gameBySheet = new Map<
                                  number,
                                  (typeof result.games)[number]
                                >();
                                for (const g of games) {
                                  gameBySheet.set(g.sheetId, g);
                                }
                                const byeTeamsForDate = byeByDate.get(date);
                                return (
                                  <tr key={dk}>
                                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">
                                      {formatTime(time)}
                                    </td>
                                    {allSheets.map((sheet) => {
                                      const game = gameBySheet.get(sheet.id);
                                      if (!game) {
                                        return (
                                          <td
                                            key={sheet.id}
                                            className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-400 dark:text-gray-600"
                                          >
                                            —
                                          </td>
                                        );
                                      }
                                      const hasByeConflict =
                                        byeTeamsForDate &&
                                        (byeTeamsForDate.has(game.team1Id) ||
                                          byeTeamsForDate.has(game.team2Id));
                                      return (
                                        <td
                                          key={sheet.id}
                                          className={`border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-sm ${
                                            hasByeConflict
                                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                                              : 'text-gray-800 dark:text-gray-200'
                                          }`}
                                        >
                                          <div className="whitespace-nowrap">
                                            {teamNameMap.get(game.team1Id) ?? `#${game.team1Id}`}
                                          </div>
                                          <div className="text-xs text-gray-400 dark:text-gray-500">
                                            vs
                                          </div>
                                          <div className="whitespace-nowrap">
                                            {teamNameMap.get(game.team2Id) ?? `#${game.team2Id}`}
                                          </div>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {byeTeamIds.length > 0 && (
                          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            <span className="font-medium text-gray-600 dark:text-gray-300">
                              Bye:
                            </span>{' '}
                            {byeTeamIds.map((id) => teamNameMap.get(id) ?? `#${id}`).join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}

              {/* Unschedulable matchups */}
              {result.unschedulable.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Unschedulable matchups
                  </h3>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    {result.unschedulable.map((u, i) => (
                      <li key={i}>
                        {teamNameMap.get(u.team1Id) ?? `#${u.team1Id}`} vs{' '}
                        {teamNameMap.get(u.team2Id) ?? `#${u.team2Id}`}
                        <span className="ml-2 text-gray-400 dark:text-gray-500">({u.reason})</span>
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={includeUnscheduled}
                      onChange={(e) => setIncludeUnscheduled(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Include as unscheduled games when saving
                  </label>
                </div>
              )}

              {/* Per-team statistics */}
              {result.teamStats.length > 0 && (
                <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <summary className="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    Per-team statistics
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900">
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Team
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-medium">
                            Games
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-medium">
                            As T1
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-medium">
                            As T2
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Draw times
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Sheets
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-medium">
                            Bye conflicts
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.teamStats
                          .slice()
                          .sort((a, b) => {
                            const nameA = teamNameMap.get(a.teamId) ?? '';
                            const nameB = teamNameMap.get(b.teamId) ?? '';
                            return nameA.localeCompare(nameB);
                          })
                          .map((ts) => {
                            const totalGames = ts.asTeam1 + ts.asTeam2;
                            const dtEntries = Object.entries(ts.drawTimeCounts)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([t, c]) => `${formatTime(t)}: ${c}`)
                              .join(', ');
                            const sheetEntries = Object.entries(ts.sheetCounts)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([sid, c]) => {
                                const sheet = allSheets.find((s) => s.id === Number(sid));
                                return `${sheet?.name ?? `#${sid}`}: ${c}`;
                              })
                              .join(', ');
                            const highByeConflicts = ts.byeConflicts.filter(
                              (c) => c.priority <= 2
                            ).length;
                            const lowByeConflicts = ts.byeConflicts.filter(
                              (c) => c.priority > 2
                            ).length;
                            return (
                              <tr key={ts.teamId}>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                                  {teamNameMap.get(ts.teamId) ?? `#${ts.teamId}`}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300">
                                  {totalGames}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300">
                                  {ts.asTeam1}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-gray-700 dark:text-gray-300">
                                  {ts.asTeam2}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">
                                  {dtEntries || '—'}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">
                                  {sheetEntries || '—'}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-center">
                                  {highByeConflicts > 0 && (
                                    <span className="text-red-600 dark:text-red-400 font-medium">
                                      {highByeConflicts}
                                    </span>
                                  )}
                                  {highByeConflicts > 0 && lowByeConflicts > 0 && ' / '}
                                  {lowByeConflicts > 0 && (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      {lowByeConflicts}
                                    </span>
                                  )}
                                  {highByeConflicts === 0 && lowByeConflicts === 0 && (
                                    <span className="text-gray-400 dark:text-gray-500">0</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleCommitSchedule}
                  disabled={committing || result.games.length === 0}
                >
                  {committing ? 'Saving…' : 'Commit schedule'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleRegenerateSchedule}
                  disabled={committing}
                >
                  Regenerate
                </Button>
                <Button variant="secondary" onClick={resetGenerator} disabled={committing}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {canManage && strategyModalOpen && (
        <Modal
          isOpen={strategyModalOpen}
          title={editingStrategy ? 'Edit round' : 'Add round'}
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
                onChange={(e) =>
                  setStrategyForm((prev) => ({
                    ...prev,
                    priority: parseInt(e.target.value, 10) || 0,
                  }))
                }
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Division
                </label>
                <select
                  value={strategyForm.divisionId}
                  onChange={(e) =>
                    setStrategyForm((prev) => ({ ...prev, divisionId: e.target.value }))
                  }
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
                Games per opponent
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                How many times each pair of teams plays each other. 1 = single round robin, 2 =
                double, etc.
              </p>
              <input
                type="number"
                min={1}
                value={strategyForm.gamesPerTeam}
                onChange={(e) =>
                  setStrategyForm((prev) => ({
                    ...prev,
                    gamesPerTeam: parseInt(e.target.value, 10) || 1,
                  }))
                }
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Draw slots ({strategyForm.drawSlotKeys.length} of {drawSlots.length} selected)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const selectableKeys = drawSlots
                      .map((s) => `${s.date}|${s.time}`)
                      .filter((k) => !occupiedSlotKeys.has(k));
                    const allSelected = selectableKeys.every((k) =>
                      strategyForm.drawSlotKeys.includes(k)
                    );
                    setStrategyForm((prev) => ({
                      ...prev,
                      drawSlotKeys: allSelected ? [] : selectableKeys,
                    }));
                  }}
                  className="text-xs text-primary-teal hover:underline"
                >
                  {drawSlots
                    .map((s) => `${s.date}|${s.time}`)
                    .filter((k) => !occupiedSlotKeys.has(k))
                    .every((k) => strategyForm.drawSlotKeys.includes(k))
                    ? 'Deselect all'
                    : 'Select all'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1">
                {drawSlots.map((slot) => {
                  const key = `${slot.date}|${slot.time}`;
                  const occupied = occupiedSlotKeys.has(key);
                  const checked = strategyForm.drawSlotKeys.includes(key);
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 text-sm px-1 py-0.5 rounded ${
                        occupied
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={occupied}
                        checked={checked && !occupied}
                        onChange={(ev) => {
                          const next = ev.target.checked
                            ? [...strategyForm.drawSlotKeys, key]
                            : strategyForm.drawSlotKeys.filter((k) => k !== key);
                          setStrategyForm((prev) => ({ ...prev, drawSlotKeys: next }));
                        }}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-gray-700 dark:text-gray-300">
                        {formatDateDisplay(slot.date)} · {formatTime(slot.time)}
                        {slot.isExtra && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">(extra)</span>
                        )}
                      </span>
                      {occupied && (
                        <span className="ml-auto text-xs text-red-500 dark:text-red-400">
                          has games
                        </span>
                      )}
                    </label>
                  );
                })}
                {drawSlots.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                    No draw slots available.
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setStrategyModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{editingStrategy ? 'Update' : 'Add'}</Button>
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
              Assign a priority to any draw date you want as a bye. Lower number = higher preference
              (1 = most preferred). Leave blank for no preference.
            </p>
            {byeTeamEditLoading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading draw schedule…</div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {hasTwoDraws && !byeTeamEditLoading && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2 border-b border-gray-200 dark:border-gray-600">
                    <input
                      type="checkbox"
                      checked={preferLateDraw}
                      onChange={(e) => setPreferLateDraw(e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                    />
                    Prefer late draw
                  </label>
                )}
                {uniqueDrawDates.map((date) => {
                  const value = byePriorities[date];
                  return (
                    <div key={date} className="flex items-center gap-3 text-sm">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">
                        {formatDateDisplay(date)}
                      </span>
                      <label className="sr-only" htmlFor={`bye-priority-${date}`}>
                        Priority for {date}
                      </label>
                      <input
                        id={`bye-priority-${date}`}
                        type="number"
                        min={1}
                        placeholder="—"
                        value={value === undefined || value === 0 ? '' : value}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setByePriorities((prev) => ({
                            ...prev,
                            [date]: v === '' ? 0 : parseInt(v, 10) || 0,
                          }));
                        }}
                        className="w-20 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-gray-100 text-right"
                      />
                    </div>
                  );
                })}
                {uniqueDrawDates.length === 0 && !byeTeamEditLoading && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    No draw dates for this league.
                  </div>
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
