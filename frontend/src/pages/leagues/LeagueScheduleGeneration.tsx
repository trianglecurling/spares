import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { HiOutlineInformationCircle } from 'react-icons/hi2';
import { get, post, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import { previewStrategyCapacities } from '../../scheduling/generateMatchups';
import { useScheduleGenerator } from '../../scheduling/useScheduleGenerator';
import type { ScheduleInput, SchedulePairingMode } from '../../scheduling/types';

function nextStrategyLocalId(): string {
  return `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextConstraintLocalId(): string {
  return `constraint-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type OptimizationPreset = 'none' | 'quick' | 'balanced' | 'deep';

const OPTIMIZATION_PRESETS: Record<
  OptimizationPreset,
  { budgetMs: number; patienceMs: number; label: string; hint: string }
> = {
  none: {
    budgetMs: 0,
    patienceMs: 0,
    label: 'None',
    hint: 'Greedy assignment only (no annealing)',
  },
  quick: {
    budgetMs: 20_000,
    patienceMs: 4_000,
    label: 'Quick',
    hint: 'About 20s, stops early if flat',
  },
  balanced: {
    budgetMs: 90_000,
    patienceMs: 15_000,
    label: 'Balanced',
    hint: 'About 90s, good default',
  },
  deep: {
    budgetMs: 300_000,
    patienceMs: 45_000,
    label: 'Deep',
    hint: 'Up to 5 minutes',
  },
};

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

const HARD_CONSTRAINT_TYPE_OPTIONS: ChoiceOption<'bye' | 'matchup'>[] = [
  { value: 'bye', label: 'Bye week' },
  { value: 'matchup', label: 'Match-up' },
];

const PAIRING_MODE_OPTIONS: ChoiceOption<SchedulePairingMode>[] = [
  {
    value: 'intra',
    label: 'Intra-division',
    description: 'Teams only play others in the same division.',
  },
  {
    value: 'cross',
    label: 'Cross-division',
    description: 'Teams only play teams in other divisions.',
  },
  {
    value: 'any',
    label: 'Any',
    description: 'Everyone can play everyone.',
  },
];

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
  pairingMode: SchedulePairingMode;
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
  const [preferEarlyDrawByTeam, setPreferEarlyDrawByTeam] = useState<Record<number, boolean>>({});
  type DrawTimePreference = 'none' | 'early' | 'late';
  const DRAW_TIME_PREFERENCE_OPTIONS: ChoiceOption<DrawTimePreference>[] = [
    { value: 'none', label: 'No preference' },
    { value: 'early', label: 'Prefer early draw' },
    { value: 'late', label: 'Prefer late draw' },
  ];
  const drawTimePreferenceFieldId = useId();
  const [drawSlots, setDrawSlots] = useState<DrawSlot[]>([]);
  const [loadingByeRequests, setLoadingByeRequests] = useState(true);
  const [loadingDrawSlots, setLoadingDrawSlots] = useState(true);
  const [collectByeRequests, setCollectByeRequests] = useState<boolean>(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingCollectByeRequests, setSavingCollectByeRequests] = useState(false);

  const [strategyModalOpen, setStrategyModalOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<RoundRobinStrategy | null>(null);
  const pairingModeFieldId = useId();
  const hasMultipleDivisions = divisions.length > 1;
  const [strategyForm, setStrategyForm] = useState({
    priority: 0,
    pairingMode: 'intra' as SchedulePairingMode,
    divisionId: '' as string,
    gamesPerTeam: 1,
    drawSlotKeys: [] as string[],
  });

  const [existingGames, setExistingGames] = useState<ExistingGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);

  const [editingByeTeamId, setEditingByeTeamId] = useState<number | null>(null);
  const [byePriorities, setByePriorities] = useState<Record<string, number>>({});
  const [drawTimePreference, setDrawTimePreference] = useState<DrawTimePreference>('none');
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
  /** Optimization depth preset: budget + early-stop patience for SA. */
  const [optimizationPreset, setOptimizationPreset] = useState<OptimizationPreset>('balanced');
  const optimizationPresetId = useId();

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

  const sortedTeamChoiceOptions = useMemo(
    () =>
      teams
        .slice()
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
        .map((t) => ({
          value: t.id,
          label: t.name ?? `Team ${t.id}`,
        })),
    [teams]
  );

  const hardConstraintDrawChoiceOptions = useMemo(
    () =>
      drawSlots
        .slice()
        .sort((a, b) => {
          const d = (a.date ?? '').localeCompare(b.date ?? '');
          return d !== 0 ? d : (a.time ?? '').localeCompare(b.time ?? '');
        })
        .map((slot) => ({
          value: `${slot.date}|${slot.time}`,
          label: `${formatDateDisplay(slot.date)} ${formatTime(slot.time)}`,
        })),
    [drawSlots]
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
    setByeRequests([]);
    setPreferLateDrawByTeam({});
    setPreferEarlyDrawByTeam({});
    try {
      const response = await getUntyped('/leagues/{id}/bye-requests', undefined, {
        id: String(leagueId),
      });
      const data = response as {
        requests?: TeamByeRequest[];
        preferLateDrawByTeam?: Record<number, boolean>;
        preferEarlyDrawByTeam?: Record<number, boolean>;
      } | null;
      if (data && Array.isArray(data.requests)) {
        setByeRequests(data.requests);
        setPreferLateDrawByTeam(data.preferLateDrawByTeam ?? {});
        setPreferEarlyDrawByTeam(data.preferEarlyDrawByTeam ?? {});
      } else {
        setByeRequests([]);
        setPreferLateDrawByTeam({});
        setPreferEarlyDrawByTeam({});
      }
    } catch (error: unknown) {
      setByeRequests([]);
      setPreferLateDrawByTeam({});
      setPreferEarlyDrawByTeam({});
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
        pairingMode: strategy.pairingMode,
        divisionId: strategy.divisionId != null ? String(strategy.divisionId) : '',
        gamesPerTeam: strategy.gamesPerTeam,
        drawSlotKeys: strategy.drawSlotKeys,
      });
    } else {
      setEditingStrategy(null);
      const defaultDivisionId = divisions.find((d) => d.isDefault)?.id ?? divisions[0]?.id;
      setStrategyForm({
        priority: strategies.length,
        pairingMode: 'intra',
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
  const schedulableByeRequests = useMemo(() => {
    const validDates = new Set(uniqueDrawDates);
    return byeRequests.filter((request) => validDates.has(request.drawDate));
  }, [byeRequests, uniqueDrawDates]);

  /** League has 2+ draw times (e.g. early and late draw). */
  const hasTwoDraws = useMemo(() => new Set(drawSlots.map((s) => s.time)).size >= 2, [drawSlots]);
  const drawTimeBoundsByDate = useMemo(() => {
    const bounds = new Map<string, { early: string; late: string }>();
    for (const slot of drawSlots) {
      const time = slot.time.slice(0, 5);
      const current = bounds.get(slot.date);
      if (!current) {
        bounds.set(slot.date, { early: time, late: time });
      } else {
        if (time < current.early) current.early = time;
        if (time > current.late) current.late = time;
      }
    }
    return bounds;
  }, [drawSlots]);

  const openTeamByeEditModal = async (teamId: number) => {
    setEditingByeTeamId(teamId);
    setByePriorities({});
    setDrawTimePreference('none');
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
        preferEarlyDraw?: boolean;
      } | null;
      const byes = data?.byeRequests ?? [];
      const prio: Record<string, number> = {};
      byes.forEach((b) => {
        prio[b.drawDate] = b.priority;
      });
      setByePriorities(prio);
      if (data?.preferEarlyDraw) setDrawTimePreference('early');
      else if (data?.preferLateDraw) setDrawTimePreference('late');
      else setDrawTimePreference('none');
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
    setDrawTimePreference('none');
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
    const body = {
      requests,
      preferEarlyDraw: hasTwoDraws && drawTimePreference === 'early',
      preferLateDraw: hasTwoDraws && drawTimePreference === 'late',
    };
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
      resetGenerator();
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
    const pairingMode: SchedulePairingMode = hasMultipleDivisions
      ? strategyForm.pairingMode
      : 'intra';
    const soleDivisionId = divisions.find((d) => d.isDefault)?.id ?? divisions[0]?.id ?? null;
    const divisionId = hasMultipleDivisions
      ? strategyForm.divisionId
        ? parseInt(strategyForm.divisionId, 10)
        : null
      : soleDivisionId;
    if (pairingMode === 'intra' && !divisionId) {
      showAlert('Select a division for intra-division rounds.', 'warning');
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
      pairingMode,
      divisionId: pairingMode === 'intra' ? divisionId : null,
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

  const strategyCapacityPreviews = useMemo(() => {
    if (strategies.length === 0 || teams.length < 2) return [];

    return previewStrategyCapacities(
      strategies.map((s) => ({
        localId: s.localId,
        priority: s.priority,
        pairingMode: s.pairingMode,
        divisionId: s.divisionId,
        gamesPerTeam: s.gamesPerTeam,
        drawSlotKeys: s.drawSlotKeys,
      })),
      teams.map((t) => ({
        id: t.id,
        divisionId: t.divisionId,
        name: t.name,
      })),
      drawSlots.map((ds) => ({
        date: ds.date,
        time: ds.time,
        sheets: ds.sheets,
      }))
    );
  }, [strategies, teams, drawSlots]);

  const strategyCapacityPreviewById = useMemo(() => {
    const map = new Map<string, (typeof strategyCapacityPreviews)[number]>();
    for (const preview of strategyCapacityPreviews) {
      map.set(preview.strategyLocalId, preview);
    }
    return map;
  }, [strategyCapacityPreviews]);

  const strategyCapacityNotes = useMemo(() => {
    return strategyCapacityPreviews
      .filter((p) => p.capped)
      .map((p) => {
        const s = strategies.find((st) => st.localId === p.strategyLocalId);
        const modeLabel =
          s == null
            ? 'round'
            : s.pairingMode === 'intra'
              ? `intra (${getDivisionName(s.divisionId) ?? 'division'})`
              : s.pairingMode === 'cross'
                ? 'cross-division'
                : 'any';
        return `Priority ${p.priority} (${modeLabel}): generating ${p.gameCount} of ${p.uncappedGameCount} possible games to fit ${p.slotCapacity} sheet slot${p.slotCapacity === 1 ? '' : 's'}.`;
      });
  }, [strategyCapacityPreviews, strategies, divisions]);

  const buildScheduleInput = (seed: number): ScheduleInput => {
    const preset = OPTIMIZATION_PRESETS[optimizationPreset];
    return {
      strategies: strategies.map((s) => ({
        localId: s.localId,
        priority: s.priority,
        pairingMode: s.pairingMode,
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
      byeRequests: schedulableByeRequests.map((b) => ({
        teamId: b.teamId,
        drawDate: b.drawDate,
        priority: b.priority,
      })),
      hardConstraints: hardConstraints.map((c) =>
        c.type === 'bye'
          ? { type: 'bye' as const, teamId: c.teamId, drawDate: c.drawDate }
          : {
              type: 'matchup' as const,
              team1Id: c.team1Id,
              team2Id: c.team2Id,
              drawDate: c.drawDate,
              drawTime: c.drawTime,
              sheetId: c.sheetId,
            }
      ),
      preferLateDrawTeamIds: Object.entries(preferLateDrawByTeam)
        .filter(([, prefers]) => prefers)
        .map(([teamId]) => Number(teamId)),
      preferEarlyDrawTeamIds: Object.entries(preferEarlyDrawByTeam)
        .filter(([, prefers]) => prefers)
        .map(([teamId]) => Number(teamId)),
      seed,
      optimizationTimeBudgetMs: preset.budgetMs,
      optimizationEarlyStopPatienceMs: preset.patienceMs,
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
          <h2 className="app-section-title">Bye request collection</h2>
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
          <h2 className="app-section-title">Rounds</h2>
          {canManage && (
            <Button onClick={() => openStrategyModal()} variant="secondary">
              Add round
            </Button>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Rounds are applied in priority order (lower number first). Each round defines how many
          times each pair of teams plays
          {hasMultipleDivisions
            ? ' and whether games are intra-division, cross-division, or open to any pairing'
            : ''}
          .
        </p>
        {strategies.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No strategies configured. Add one to define how many games per team
            {hasMultipleDivisions ? ' and pairing mode' : ''}.
          </div>
        ) : (
          <ul className="space-y-2">
            {strategies
              .slice()
              .sort((a, b) => a.priority - b.priority)
              .map((s) => {
                const capacityPreview = strategyCapacityPreviewById.get(s.localId);
                return (
                  <li
                    key={s.localId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
                  >
                    <div>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        Priority {s.priority}
                      </span>
                      {hasMultipleDivisions && (
                        <>
                          <span className="mx-2 text-gray-400">·</span>
                          <span className="text-gray-600 dark:text-gray-300">
                            {s.pairingMode === 'intra'
                              ? `Intra: ${getDivisionName(s.divisionId) ?? 'Division'}`
                              : s.pairingMode === 'cross'
                                ? 'Cross-division'
                                : 'Any'}
                          </span>
                        </>
                      )}
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
                      {capacityPreview && (
                        <>
                          <span className="mx-2 text-gray-400">·</span>
                          <span className="text-gray-600 dark:text-gray-300">
                            {capacityPreview.gameCount} game
                            {capacityPreview.gameCount === 1 ? '' : 's'}
                            {' / '}
                            {capacityPreview.slotCapacity} slot
                            {capacityPreview.slotCapacity === 1 ? '' : 's'}
                            {capacityPreview.capped ? ' (capped)' : ''}
                          </span>
                        </>
                      )}
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
                );
              })}
          </ul>
        )}
        {strategyCapacityNotes.length > 0 && (
          <div
            className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
            role="status"
          >
            <p className="text-sm font-medium">Fill-phase notes</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {strategyCapacityNotes.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
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
                    const teamByes = schedulableByeRequests.filter((b) => b.teamId === team.id);
                    const summary =
                      teamByes.length === 0
                        ? 'No bye requests'
                        : `${teamByes.length} bye request${teamByes.length === 1 ? '' : 's'}`;
                    const prefersLate = preferLateDrawByTeam[team.id];
                    const prefersEarly = preferEarlyDrawByTeam[team.id];
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
                          {prefersEarly && (
                            <span className="ml-2 text-gray-500 dark:text-gray-400">
                              · Prefers early draw
                            </span>
                          )}
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
              <h2 className="app-section-title">Hard constraints</h2>
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
              <ChoiceInput<'bye' | 'matchup'>
                ariaLabel="Constraint type"
                options={HARD_CONSTRAINT_TYPE_OPTIONS}
                value={hardConstraintForm.type}
                onChange={(next) => {
                  if (next == null || Array.isArray(next)) return;
                  setHardConstraintForm((f) => ({
                    ...f,
                    type: next,
                    teamId: '',
                    team1Id: '',
                    team2Id: '',
                    drawDate: '',
                    drawTime: '',
                    sheetId: '',
                  }));
                }}
                listboxLabel="Constraint type"
              />
            </div>
            {hardConstraintForm.type === 'bye' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Team
                  </label>
                  <ChoiceInput<number>
                    options={sortedTeamChoiceOptions}
                    value={
                      hardConstraintForm.teamId === '' ? null : Number(hardConstraintForm.teamId)
                    }
                    onChange={(next) =>
                      setHardConstraintForm((f) => ({
                        ...f,
                        teamId: next == null || Array.isArray(next) ? '' : String(next),
                      }))
                    }
                    placeholder="Select team"
                    listboxLabel="Team"
                    inputClassName="app-input min-w-[140px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Bye date
                  </label>
                  <ChoiceInput<string>
                    options={uniqueDrawDates.map((d) => ({
                      value: d,
                      label: formatDateDisplay(d),
                    }))}
                    value={hardConstraintForm.drawDate || null}
                    onChange={(next) =>
                      setHardConstraintForm((f) => ({
                        ...f,
                        drawDate: next == null || Array.isArray(next) ? '' : next,
                      }))
                    }
                    placeholder="Select date"
                    listboxLabel="Bye date"
                    inputClassName="app-input min-w-[140px]"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Team 1
                    </label>
                    <ChoiceInput<number>
                      options={sortedTeamChoiceOptions}
                      value={
                        hardConstraintForm.team1Id === ''
                          ? null
                          : Number(hardConstraintForm.team1Id)
                      }
                      onChange={(next) =>
                        setHardConstraintForm((f) => ({
                          ...f,
                          team1Id: next == null || Array.isArray(next) ? '' : String(next),
                        }))
                      }
                      placeholder="Select team"
                      listboxLabel="Team 1"
                      inputClassName="app-input min-w-[140px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Team 2
                    </label>
                    <ChoiceInput<number>
                      options={sortedTeamChoiceOptions}
                      value={
                        hardConstraintForm.team2Id === ''
                          ? null
                          : Number(hardConstraintForm.team2Id)
                      }
                      onChange={(next) =>
                        setHardConstraintForm((f) => ({
                          ...f,
                          team2Id: next == null || Array.isArray(next) ? '' : String(next),
                        }))
                      }
                      placeholder="Select team"
                      listboxLabel="Team 2"
                      inputClassName="app-input min-w-[140px]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Draw
                    </label>
                    <ChoiceInput<string>
                      options={hardConstraintDrawChoiceOptions}
                      value={
                        hardConstraintForm.drawDate && hardConstraintForm.drawTime
                          ? `${hardConstraintForm.drawDate}|${hardConstraintForm.drawTime}`
                          : null
                      }
                      onChange={(next) => {
                        const v = next == null || Array.isArray(next) ? '' : next;
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
                      placeholder="Select draw"
                      listboxLabel="Draw"
                      inputClassName="app-input min-w-[180px]"
                    />
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
                        <ChoiceInput<number>
                          options={sheets.map((s) => ({ value: s.id, label: s.name }))}
                          value={
                            hardConstraintForm.sheetId === ''
                              ? null
                              : Number(hardConstraintForm.sheetId)
                          }
                          onChange={(next) =>
                            setHardConstraintForm((f) => ({
                              ...f,
                              sheetId: next == null || Array.isArray(next) ? '' : String(next),
                            }))
                          }
                          disabled={sheets.length === 0}
                          placeholder="Any sheet"
                          listboxLabel="Sheet"
                          inputClassName="app-input min-w-[120px]"
                        />
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
          <h2 className="app-section-title">Generate schedule</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use the strategies and bye requests above, then generate a schedule preview. You can
            review and commit or adjust before saving.
          </p>
          <div className="space-y-2 max-w-lg">
            <FormField label="Optimization" labelId={optimizationPresetId}>
              <ChoiceInput<OptimizationPreset>
                layout="block"
                name="schedule-optimization-preset"
                ariaLabelledBy={optimizationPresetId}
                value={optimizationPreset}
                onChange={(next) => {
                  if (next == null || Array.isArray(next)) return;
                  setOptimizationPreset(next);
                }}
                disabled={isGenerating}
                options={(Object.keys(OPTIMIZATION_PRESETS) as OptimizationPreset[]).map((key) => ({
                  value: key,
                  label: OPTIMIZATION_PRESETS[key].label,
                }))}
              />
            </FormField>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {OPTIMIZATION_PRESETS[optimizationPreset].hint}. Stops early when the best penalty
              stops improving.
            </p>
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
                  // Bye requests by date → team → priority (for highlight + explanation)
                  const byePriorityByDateTeam = new Map<string, Map<number, number>>();
                  for (const b of schedulableByeRequests) {
                    let byTeam = byePriorityByDateTeam.get(b.drawDate);
                    if (!byTeam) {
                      byTeam = new Map();
                      byePriorityByDateTeam.set(b.drawDate, byTeam);
                    }
                    const prev = byTeam.get(b.teamId);
                    if (prev == null || b.priority < prev) {
                      byTeam.set(b.teamId, b.priority);
                    }
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

                  return (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Highlighted games show a &quot;P# bye conflict&quot; label when a team was
                        scheduled on a date they requested as a bye (number = request priority).
                        Hover the label for which team.
                      </p>
                      {sortedDates.map((date, dateIdx) => {
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
                                    const byeTeamsForDate = byePriorityByDateTeam.get(date);
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
                                          const conflictParts: string[] = [];
                                          const conflictPriorities: number[] = [];
                                          for (const teamId of [game.team1Id, game.team2Id]) {
                                            const priority = byeTeamsForDate?.get(teamId);
                                            if (priority == null) continue;
                                            const name =
                                              teamNameMap.get(teamId) ?? `Team ${teamId}`;
                                            conflictParts.push(
                                              `${name} requested a priority ${priority} bye on this date`
                                            );
                                            conflictPriorities.push(priority);
                                          }
                                          const hasByeConflict = conflictParts.length > 0;
                                          const conflictSummary = hasByeConflict
                                            ? `Bye conflict: ${conflictParts.join('; ')}.`
                                            : '';
                                          const uniqueConflictPriorities = [
                                            ...new Set(conflictPriorities),
                                          ].sort((a, b) => a - b);
                                          return (
                                            <td
                                              key={sheet.id}
                                              className={`border border-gray-200 dark:border-gray-700 px-3 py-2 text-center text-sm align-top ${
                                                hasByeConflict
                                                  ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
                                                  : 'text-gray-800 dark:text-gray-200'
                                              }`}
                                            >
                                              <div className="flex flex-col items-center gap-0.5">
                                                <div className="whitespace-nowrap">
                                                  {teamNameMap.get(game.team1Id) ??
                                                    `#${game.team1Id}`}
                                                </div>
                                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                                  vs
                                                </div>
                                                <div className="whitespace-nowrap">
                                                  {teamNameMap.get(game.team2Id) ??
                                                    `#${game.team2Id}`}
                                                </div>
                                                {uniqueConflictPriorities.length > 0 && (
                                                  <>
                                                    <span className="sr-only">
                                                      {conflictSummary}
                                                    </span>
                                                    {uniqueConflictPriorities.map((priority) => (
                                                      <span
                                                        key={priority}
                                                        className="mt-1 inline-flex max-w-full items-center justify-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium leading-tight text-amber-800 dark:text-amber-200"
                                                        title={conflictSummary}
                                                        aria-hidden
                                                      >
                                                        <HiOutlineInformationCircle className="h-3.5 w-3.5 shrink-0" />
                                                        {`P${priority} bye conflict`}
                                                      </span>
                                                    ))}
                                                  </>
                                                )}
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
                      })}
                    </div>
                  );
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
                            Draw preference honored
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Sheets
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Bye conflicts
                          </th>
                          <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-gray-700 dark:text-gray-300 font-medium">
                            Bye requests honored
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
                            const prefersEarly = preferEarlyDrawByTeam[ts.teamId] === true;
                            const prefersLate = preferLateDrawByTeam[ts.teamId] === true;
                            const teamGames = result.games.filter(
                              (game) => game.team1Id === ts.teamId || game.team2Id === ts.teamId
                            );
                            const preferenceEligibleGames = teamGames.filter((game) => {
                              const bounds = drawTimeBoundsByDate.get(game.gameDate);
                              return bounds != null && bounds.early !== bounds.late;
                            });
                            const preferredGames = preferenceEligibleGames.filter((game) => {
                              const bounds = drawTimeBoundsByDate.get(game.gameDate);
                              if (!bounds) return false;
                              const time = game.gameTime.slice(0, 5);
                              return (
                                (prefersEarly && time === bounds.early) ||
                                (prefersLate && time === bounds.late)
                              );
                            }).length;
                            const preferenceSummary = prefersEarly
                              ? `Early: ${preferredGames}/${preferenceEligibleGames.length}`
                              : prefersLate
                                ? `Late: ${preferredGames}/${preferenceEligibleGames.length}`
                                : null;
                            const highByeConflicts = ts.byeConflicts.filter(
                              (c) => c.priority <= 2
                            ).length;
                            const lowByeConflicts = ts.byeConflicts.filter(
                              (c) => c.priority > 2
                            ).length;
                            const byeConflictParts: string[] = [];
                            if (highByeConflicts > 0) {
                              byeConflictParts.push(`${highByeConflicts} high-priority (p1–p2)`);
                            }
                            if (lowByeConflicts > 0) {
                              byeConflictParts.push(`${lowByeConflicts} lower-priority (p3+)`);
                            }

                            const teamByeReqs = schedulableByeRequests.filter(
                              (b) => b.teamId === ts.teamId
                            );
                            const requestedByPriority = new Map<number, number>();
                            for (const b of teamByeReqs) {
                              requestedByPriority.set(
                                b.priority,
                                (requestedByPriority.get(b.priority) ?? 0) + 1
                              );
                            }
                            const conflictedByPriority = new Map<number, number>();
                            for (const c of ts.byeConflicts) {
                              conflictedByPriority.set(
                                c.priority,
                                (conflictedByPriority.get(c.priority) ?? 0) + 1
                              );
                            }
                            const honoredParts = [...requestedByPriority.keys()]
                              .sort((a, b) => a - b)
                              .map((priority) => {
                                const requested = requestedByPriority.get(priority) ?? 0;
                                const conflicted = conflictedByPriority.get(priority) ?? 0;
                                const honored = Math.max(0, requested - conflicted);
                                return `P${priority}: ${honored}/${requested}`;
                              });

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
                                  {preferenceSummary ?? 'No preference'}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">
                                  {sheetEntries || '—'}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-300">
                                  {byeConflictParts.length > 0 ? (
                                    byeConflictParts.join(' · ')
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500">None</span>
                                  )}
                                </td>
                                <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-300">
                                  {honoredParts.length > 0 ? (
                                    honoredParts.join(', ')
                                  ) : (
                                    <span className="text-gray-400 dark:text-gray-500">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    <p className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
                      A bye conflict means the team was scheduled to play on a date they requested
                      as a bye. High-priority covers request priorities 1–2; lower-priority is 3+.
                      Bye requests honored shows honored/requested counts by priority (a request is
                      honored when the team does not play that date). Draw preference honored
                      excludes dates that only have one draw.
                    </p>
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
              <label className="app-label">Priority (lower = applied first)</label>
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
                className="app-input"
              />
            </div>
            {hasMultipleDivisions && (
              <FormField label="Pairing mode" labelId={pairingModeFieldId} required>
                <ChoiceInput<SchedulePairingMode>
                  layout="block"
                  name="strategy-pairing-mode"
                  ariaLabelledBy={pairingModeFieldId}
                  options={PAIRING_MODE_OPTIONS}
                  value={strategyForm.pairingMode}
                  onChange={(next) => {
                    if (next == null || Array.isArray(next)) return;
                    setStrategyForm((prev) => ({ ...prev, pairingMode: next }));
                  }}
                />
              </FormField>
            )}
            {hasMultipleDivisions && strategyForm.pairingMode === 'intra' && (
              <div>
                <label className="app-label">Division</label>
                <ChoiceInput<number>
                  options={divisions.map((d) => ({ value: d.id, label: d.name }))}
                  value={
                    strategyForm.divisionId === '' ? null : parseInt(strategyForm.divisionId, 10)
                  }
                  onChange={(next) =>
                    setStrategyForm((prev) => ({
                      ...prev,
                      divisionId: next == null || Array.isArray(next) ? '' : String(next),
                    }))
                  }
                  placeholder="Select division"
                  listboxLabel="Division"
                />
              </div>
            )}
            <div>
              <label className="app-label">Games per opponent</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                How many times each pair of teams plays each other when capacity allows. 1 = single
                round robin, 2 = double, etc. If selected draws cannot hold that many games, the
                generator fills the available sheet slots instead.
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
                className="app-input"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="app-label">
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
                  className="text-xs text-primary-teal-link hover:underline"
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
                  <FormField
                    label="Draw time preference"
                    labelId={drawTimePreferenceFieldId}
                    className="pb-2 border-b border-gray-200 dark:border-gray-600"
                  >
                    <ChoiceInput<DrawTimePreference>
                      layout="block"
                      name="bye-draw-time-preference"
                      ariaLabelledBy={drawTimePreferenceFieldId}
                      options={DRAW_TIME_PREFERENCE_OPTIONS}
                      value={drawTimePreference}
                      onChange={(next) => {
                        if (next == null || Array.isArray(next)) return;
                        setDrawTimePreference(next);
                      }}
                    />
                  </FormField>
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
                        className="app-input w-20 text-right"
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
