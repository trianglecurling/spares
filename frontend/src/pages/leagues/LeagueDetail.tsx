import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { del, get, patch, post, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import AppStateCard from '../../components/AppStateCard';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import LeagueTabs from '../../components/LeagueTabs';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import LeagueSchedule from './LeagueSchedule';
import LeagueScheduleGeneration from './LeagueScheduleGeneration';
import LeagueStandings from './LeagueStandings';
import LeagueSheets from './LeagueSheets';
import LeagueMaintenance from './LeagueMaintenance';
import Modal from '../../components/Modal';

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: 'teams' | 'doubles';
  startDate: string;
  endDate: string;
  drawTimes: string[];
  exceptions: string[];
}

interface Division {
  id: number;
  leagueId: number;
  name: string;
  sortOrder?: number;
  isDefault?: boolean;
}

interface RosterMember {
  memberId: number;
  name: string;
  role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
  isSkip: boolean;
  isVice: boolean;
}

interface Team {
  id: number;
  leagueId: number;
  divisionId: number;
  divisionName: string;
  name: string | null;
  roster: RosterMember[];
}

interface MemberSearchResult {
  id: number;
  name: string;
  email?: string | null;
}

type TeamRole = 'lead' | 'second' | 'third' | 'fourth';
type DoublesRole = 'player1' | 'player2';

interface LeagueManager {
  memberId: number;
  name: string;
  email: string | null;
}

interface LeagueRosterMember {
  memberId: number;
  name: string;
  email: string | null;
  assignedTeamId: number | null;
  assignedTeamName: string | null;
}

const roleLabels: Record<RosterMember['role'], string> = {
  lead: 'Lead',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  player1: 'Player 1',
  player2: 'Player 2',
};

const teamRoles: TeamRole[] = ['lead', 'second', 'third', 'fourth'];
const doublesRoles: DoublesRole[] = ['player1', 'player2'];

function createRoleRecord<T>(value: T) {
  return teamRoles.reduce(
    (acc, role) => {
      acc[role] = value;
      return acc;
    },
    {} as Record<TeamRole, T>
  );
}

function createDoublesRecord<T>(value: T) {
  return doublesRoles.reduce(
    (acc, role) => {
      acc[role] = value;
      return acc;
    },
    {} as Record<DoublesRole, T>
  );
}

const leagueParamTabs = [
  'schedule',
  'standings',
  'sheets',
  'schedule-generation',
  'teams',
  'roster',
  'divisions',
  'managers',
  'maintenance',
] as const;
type LeagueParamTab = (typeof leagueParamTabs)[number];
type LeagueSetupTab = 'overview' | LeagueParamTab;

function formatDateDisplay(dateString: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const userTimezoneOffset = date.getTimezoneOffset() * 60000;
  const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
  return adjustedDate.toLocaleDateString();
}

function formatTime(time: string) {
  if (!time) return '';
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = minuteStr.padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
}

function getDayName(dayOfWeek: number) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek] || '';
}

function computeLeagueDates(startDateStr: string, endDateStr: string, dayOfWeek: number): string[] {
  if (!startDateStr || !endDateStr) return [];
  const startDate = new Date(startDateStr + 'T00:00:00Z');
  const endDate = new Date(endDateStr + 'T00:00:00Z');
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return [];

  const dates: string[] = [];
  const currentDate = new Date(startDate);
  const currentDay = currentDate.getUTCDay();
  const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
  currentDate.setUTCDate(currentDate.getUTCDate() + daysUntilTarget);

  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setUTCDate(currentDate.getUTCDate() + 7);
  }
  return dates;
}

export default function LeagueDetail() {
  const { leagueId, tab } = useParams();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const defaultDivisionId = useMemo(() => {
    const explicitDefault = divisions.find((division) => division.isDefault);
    if (explicitDefault) return explicitDefault.id;
    return divisions[0]?.id ?? 0;
  }, [divisions]);
  const normalizedTab = useMemo<LeagueSetupTab>(() => {
    if (tab && leagueParamTabs.includes(tab as LeagueParamTab)) {
      return tab as LeagueSetupTab;
    }
    return 'overview';
  }, [tab]);
  const [loading, setLoading] = useState(true);
  const [leagueSettings, setLeagueSettings] = useState<{ collectByeRequests: boolean } | null>(
    null
  );

  const [byeRequestsModalOpen, setByeRequestsModalOpen] = useState(false);
  const [byeRequestsTeamId, setByeRequestsTeamId] = useState<number | null>(null);
  const [byeDrawDates, setByeDrawDates] = useState<string[]>([]);
  const [byePriorities, setByePriorities] = useState<Record<string, number>>({});
  const [preferLateDraw, setPreferLateDraw] = useState(false);
  const [hasTwoDraws, setHasTwoDraws] = useState(false);
  const [byeRequestsLoading, setByeRequestsLoading] = useState(false);
  const [byeRequestsSaving, setByeRequestsSaving] = useState(false);

  const [editLeagueModalOpen, setEditLeagueModalOpen] = useState(false);
  const [leagueForm, setLeagueForm] = useState({
    name: '',
    dayOfWeek: 0,
    format: 'teams' as 'teams' | 'doubles',
    startDate: '',
    endDate: '',
    drawTimes: [''],
    exceptions: [] as string[],
  });
  const [showExceptionPicker, setShowExceptionPicker] = useState(false);
  const [exceptionToAdd, setExceptionToAdd] = useState('');
  const [leagueSubmitting, setLeagueSubmitting] = useState(false);

  const [rosterMembers, setRosterMembers] = useState<LeagueRosterMember[]>([]);
  const [bulkRosterModalOpen, setBulkRosterModalOpen] = useState(false);
  const [bulkRosterNames, setBulkRosterNames] = useState('');
  const [bulkRosterSubmitting, setBulkRosterSubmitting] = useState(false);
  const [bulkRosterResult, setBulkRosterResult] = useState<{
    addedCount: number;
    alreadyOnRosterCount: number;
    matchedCount: number;
    matchedNames: string[];
    unmatched: Array<{ name: string; candidates: MemberSearchResult[] }>;
  } | null>(null);
  const [bulkRosterMatchedNames, setBulkRosterMatchedNames] = useState<string[]>([]);
  const [bulkRosterUnmatched, setBulkRosterUnmatched] = useState<
    Array<{ name: string; candidates: MemberSearchResult[] }>
  >([]);
  const [bulkRosterSelection, setBulkRosterSelection] = useState<MemberSearchResult | null>(null);

  const [managers, setManagers] = useState<LeagueManager[]>([]);

  const [divisionModalOpen, setDivisionModalOpen] = useState(false);
  const [editingDivision, setEditingDivision] = useState<Division | null>(null);
  const [divisionForm, setDivisionForm] = useState({
    name: '',
  });
  const [divisionSubmitting, setDivisionSubmitting] = useState(false);

  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamForm, setTeamForm] = useState({
    name: '',
    divisionId: 0,
  });
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [selectedTeamStats, setSelectedTeamStats] = useState<{
    gamesPlayed: number;
    wins: number;
    losses: number;
    ties: number;
  } | null>(null);
  const teamFormRef = useRef<HTMLDivElement | null>(null);
  const [teamFormOpen, setTeamFormOpen] = useState(false);

  const [roleMembers, setRoleMembers] = useState<Record<TeamRole, MemberSearchResult | null>>(
    createRoleRecord(null)
  );
  const [skipRole, setSkipRole] = useState<TeamRole>('fourth');
  const [viceRole, setViceRole] = useState<TeamRole>('third');
  const [doublesMembers, setDoublesMembers] = useState<
    Record<DoublesRole, MemberSearchResult | null>
  >(createDoublesRecord(null));

  const numericLeagueId = useMemo(() => parseInt(leagueId || '', 10), [leagueId]);
  const unassignedRosterMembers = useMemo(
    () => rosterMembers.filter((member) => !member.assignedTeamId),
    [rosterMembers]
  );
  const rosterMemberIds = useMemo(() => {
    return new Set(rosterMembers.map((member) => member.memberId));
  }, [rosterMembers]);
  const leagueAccess = useMemo(() => {
    if (!member || !Number.isFinite(numericLeagueId)) {
      return {
        hasGlobalLeagueAdmin: false,
        isLeagueManagerForLeague: false,
      };
    }

    const hasGlobalLeagueAdmin = Boolean(
      member.isAdmin || member.isServerAdmin || member.isLeagueAdministratorGlobal
    );
    const isLeagueManagerForLeague = Boolean(
      member.leagueManagerLeagueIds?.includes(numericLeagueId)
    );

    return { hasGlobalLeagueAdmin, isLeagueManagerForLeague };
  }, [member, numericLeagueId]);

  const canManageRoster = useMemo(() => leagueAccess.hasGlobalLeagueAdmin, [leagueAccess]);
  const canEditLeagueInfo = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin || leagueAccess.isLeagueManagerForLeague,
    [leagueAccess]
  );
  const canManageSetup = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin || leagueAccess.isLeagueManagerForLeague,
    [leagueAccess]
  );
  const canEditManagers = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin || leagueAccess.isLeagueManagerForLeague,
    [leagueAccess]
  );

  const selectedRoleMemberIds = useMemo(() => {
    return teamRoles
      .map((role) => roleMembers[role]?.id)
      .filter((id): id is number => Number.isFinite(id));
  }, [roleMembers]);

  const selectedDoublesMemberIds = useMemo(() => {
    return doublesRoles
      .map((role) => doublesMembers[role]?.id)
      .filter((id): id is number => Number.isFinite(id));
  }, [doublesMembers]);

  const rosterAssignmentsByMemberId = useMemo(() => {
    return new Map(rosterMembers.map((member) => [member.memberId, member.assignedTeamId]));
  }, [rosterMembers]);

  useEffect(() => {
    if (!Number.isFinite(numericLeagueId)) {
      showAlert('Invalid league ID', 'error');
      navigate('/leagues');
      return;
    }
    loadAll();
  }, [numericLeagueId]);

  useEffect(() => {
    if (!leagueId) return;
    if (tab && !leagueParamTabs.includes(tab as LeagueParamTab)) {
      navigate(`/leagues/${leagueId}`, { replace: true });
    }
  }, [leagueId, tab, navigate]);


  const loadRoster = async () => {
    const rosterResponse = await get('/leagues/{id}/roster', undefined, {
      id: String(numericLeagueId),
    });
    setRosterMembers(rosterResponse);
  };

  const loadManagers = async () => {
    const managersResponse = await get('/leagues/{id}/managers', undefined, {
      id: String(numericLeagueId),
    });
    setManagers(managersResponse);
  };

  const getUntyped = get as (
    path: string,
    query?: unknown,
    pathParams?: Record<string, string>
  ) => Promise<unknown>;
  const putUntyped = put as (
    path: string,
    body: unknown,
    pathParams?: Record<string, string>
  ) => Promise<unknown>;

  const loadByeRequestsData = async (teamId: number) => {
    setByeRequestsLoading(true);
    try {
      const [slotsRes, byesRes] = await Promise.all([
        getUntyped('/leagues/{id}/draw-slots', undefined, { id: String(numericLeagueId) }),
        getUntyped('/leagues/{leagueId}/teams/{teamId}/bye-requests', undefined, {
          leagueId: String(numericLeagueId),
          teamId: String(teamId),
        }),
      ]);
      const slots = (slotsRes ?? []) as Array<{ date: string; time: string }>;
      // Extract unique sorted dates from draw slots
      const dates = [...new Set(slots.map((s) => s.date))].sort();
      setByeDrawDates(dates);
      setHasTwoDraws(new Set(slots.map((s) => s.time)).size >= 2);
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
      showAlert(formatApiError(error, 'Failed to load draw slots or bye requests'), 'error');
    } finally {
      setByeRequestsLoading(false);
    }
  };

  const handleOpenByeRequestsModal = async () => {
    const firstTeamId = memberTeamIds[0] ?? null;
    setByeRequestsTeamId(firstTeamId);
    setByeRequestsModalOpen(true);
    setByePriorities({});
    if (firstTeamId != null) {
      await loadByeRequestsData(firstTeamId);
    } else {
      setByeDrawDates([]);
    }
  };

  const handleCloseByeRequestsModal = () => {
    setByeRequestsModalOpen(false);
    setByeRequestsTeamId(null);
    setByeDrawDates([]);
    setByePriorities({});
    setPreferLateDraw(false);
    setHasTwoDraws(false);
  };

  const handleByeRequestsTeamChange = async (teamId: number) => {
    setByeRequestsTeamId(teamId);
    await loadByeRequestsData(teamId);
  };

  const handleByeRequestsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (byeRequestsTeamId == null) return;
    const requests = byeDrawDates
      .filter((date) => {
        const p = byePriorities[date];
        return p != null && Number.isInteger(p) && p >= 1;
      })
      .map((date) => ({
        drawDate: date,
        priority: Number(byePriorities[date]),
      }));
    const body = hasTwoDraws ? { requests, preferLateDraw } : { requests };
    setByeRequestsSaving(true);
    try {
      await putUntyped('/leagues/{leagueId}/teams/{teamId}/bye-requests', body, {
        leagueId: String(numericLeagueId),
        teamId: String(byeRequestsTeamId),
      });
      showAlert('Bye requests saved. A confirmation email has been sent to your team.', 'success');
      handleCloseByeRequestsModal();
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to save bye requests'), 'error');
    } finally {
      setByeRequestsSaving(false);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const leaguesResponse = await get('/leagues');
      const currentLeague = leaguesResponse.find((l: League) => l.id === numericLeagueId);
      if (!currentLeague) {
        showAlert('League not found', 'error');
        navigate('/leagues');
        return;
      }
      setLeague(currentLeague);

      const [divisionsResponse, teamsResponse, rosterResponse, managersResponse, settingsResponse] =
        await Promise.all([
          get('/leagues/{id}/divisions', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/teams', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/roster', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/managers', undefined, { id: String(numericLeagueId) }),
          (
            get as (
              path: string,
              query?: unknown,
              pathParams?: Record<string, string>
            ) => Promise<{ collectByeRequests?: boolean }>
          )('/leagues/{id}/settings', undefined, { id: String(numericLeagueId) }),
        ]);

      setDivisions(divisionsResponse);
      setTeams(teamsResponse);
      setRosterMembers(rosterResponse);
      setManagers(managersResponse);
      setLeagueSettings(
        settingsResponse?.collectByeRequests !== undefined
          ? { collectByeRequests: settingsResponse.collectByeRequests }
          : null
      );
    } catch (error: unknown) {
      console.error('Failed to load league setup data:', error);
      showAlert(formatApiError(error, 'Failed to load league setup data'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDivisionModal = (division?: Division) => {
    if (division) {
      setEditingDivision(division);
      setDivisionForm({
        name: division.name,
      });
    } else {
      setEditingDivision(null);
      setDivisionForm({
        name: '',
      });
    }
    setDivisionModalOpen(true);
  };

  const handleCloseDivisionModal = () => {
    setDivisionModalOpen(false);
    setEditingDivision(null);
    setDivisionForm({
      name: '',
    });
  };

  const handleDivisionSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDivisionSubmitting(true);

    try {
      const payload = {
        name: divisionForm.name,
      };

      if (editingDivision) {
        await patch('/leagues/{leagueId}/divisions/{divisionId}', payload, {
          leagueId: String(numericLeagueId),
          divisionId: String(editingDivision.id),
        });
      } else {
        await post('/leagues/{id}/divisions', payload, { id: String(numericLeagueId) });
      }

      await loadAll();
      handleCloseDivisionModal();
    } catch (error: unknown) {
      console.error('Failed to save division:', error);
      showAlert(formatApiError(error, 'Failed to save division'), 'error');
    } finally {
      setDivisionSubmitting(false);
    }
  };

  const handleDeleteDivision = async (division: Division) => {
    const confirmed = await confirm({
      title: 'Delete division',
      message: `Are you sure you want to delete ${division.name}?`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await del('/leagues/{leagueId}/divisions/{divisionId}', undefined, {
        leagueId: String(numericLeagueId),
        divisionId: String(division.id),
      });
      setDivisions((prev) => prev.filter((d) => d.id !== division.id));
    } catch (error: unknown) {
      console.error('Failed to delete division:', error);
      showAlert(formatApiError(error, 'Failed to delete division'), 'error');
    }
  };

  const handleOpenTeamModal = (team?: Team) => {
    if (!league) return;
    if (!team && divisions.length === 0) {
      showAlert('Create a division before adding teams.', 'warning');
      return;
    }

    if (team) {
      setEditingTeam(team);
      setTeamForm({
        name: team.name || '',
        divisionId: team.divisionId,
      });
      if (league.format === 'teams') {
        const nextRoleMembers = createRoleRecord<MemberSearchResult | null>(null);
        let nextSkip: TeamRole | null = null;
        let nextVice: TeamRole | null = null;
        team.roster.forEach((member) => {
          if (teamRoles.includes(member.role as TeamRole)) {
            const role = member.role as TeamRole;
            nextRoleMembers[role] = { id: member.memberId, name: member.name, email: null };
            if (member.isSkip) nextSkip = role;
            if (member.isVice) nextVice = role;
          }
        });
        setRoleMembers(nextRoleMembers);
        setSkipRole(nextSkip ?? 'fourth');
        setViceRole(nextVice ?? 'third');
      } else {
        const nextDoublesMembers = createDoublesRecord<MemberSearchResult | null>(null);
        team.roster.forEach((member) => {
          if (member.role === 'player1' || member.role === 'player2') {
            const role = member.role as DoublesRole;
            nextDoublesMembers[role] = { id: member.memberId, name: member.name, email: null };
          }
        });
        setDoublesMembers(nextDoublesMembers);
      }
    } else {
      setEditingTeam(null);
      setTeamForm({
        name: '',
        divisionId: defaultDivisionId,
      });
      if (league.format === 'teams') {
        setRoleMembers(createRoleRecord<MemberSearchResult | null>(null));
        setSkipRole('fourth');
        setViceRole('third');
      } else {
        setDoublesMembers(createDoublesRecord<MemberSearchResult | null>(null));
      }
    }

    setTeamFormOpen(true);
    if (teamFormRef.current) {
      teamFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCloseTeamModal = () => {
    setEditingTeam(null);
    setTeamForm({
      name: '',
      divisionId: 0,
    });
    setRoleMembers(createRoleRecord<MemberSearchResult | null>(null));
    setSkipRole('fourth');
    setViceRole('third');
    setDoublesMembers(createDoublesRecord<MemberSearchResult | null>(null));
    setTeamFormOpen(false);
  };

  useEffect(() => {
    if (!teamFormOpen || editingTeam) return;
    if (teamForm.divisionId === 0 && defaultDivisionId) {
      setTeamForm((prev) => ({ ...prev, divisionId: defaultDivisionId }));
    }
  }, [teamFormOpen, editingTeam, teamForm.divisionId, defaultDivisionId]);

  const handleOpenLeagueEdit = () => {
    if (!league) return;
    setLeagueForm({
      name: league.name,
      dayOfWeek: league.dayOfWeek,
      format: league.format,
      startDate: league.startDate,
      endDate: league.endDate,
      drawTimes: league.drawTimes.length ? league.drawTimes : [''],
      exceptions: league.exceptions || [],
    });
    setShowExceptionPicker(false);
    setExceptionToAdd('');
    setEditLeagueModalOpen(true);
  };

  const handleCloseLeagueEdit = () => {
    setEditLeagueModalOpen(false);
    setShowExceptionPicker(false);
    setExceptionToAdd('');
  };

  const addDrawTime = () => {
    setLeagueForm({
      ...leagueForm,
      drawTimes: [...leagueForm.drawTimes, ''],
    });
  };

  const updateDrawTime = (index: number, value: string) => {
    const nextTimes = [...leagueForm.drawTimes];
    nextTimes[index] = value;
    setLeagueForm({ ...leagueForm, drawTimes: nextTimes });
  };

  const removeDrawTime = (index: number) => {
    setLeagueForm({
      ...leagueForm,
      drawTimes: leagueForm.drawTimes.filter((_, i) => i !== index),
    });
  };

  const allLeagueDates = computeLeagueDates(
    leagueForm.startDate,
    leagueForm.endDate,
    leagueForm.dayOfWeek
  );
  const availableExceptionDates = allLeagueDates.filter((d) => !leagueForm.exceptions.includes(d));

  useEffect(() => {
    const valid = new Set(
      computeLeagueDates(leagueForm.startDate, leagueForm.endDate, leagueForm.dayOfWeek)
    );
    if (leagueForm.exceptions.some((d) => !valid.has(d))) {
      setLeagueForm((prev) => ({
        ...prev,
        exceptions: prev.exceptions.filter((d) => valid.has(d)),
      }));
      setExceptionToAdd('');
    }
  }, [leagueForm.startDate, leagueForm.endDate, leagueForm.dayOfWeek, leagueForm.exceptions]);

  const handleLeagueSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!league) return;

    setLeagueSubmitting(true);
    try {
      const uniqueExceptions = Array.from(new Set(leagueForm.exceptions)).sort();
      const payload = {
        name: leagueForm.name,
        dayOfWeek: leagueForm.dayOfWeek,
        format: leagueForm.format,
        startDate: leagueForm.startDate,
        endDate: leagueForm.endDate,
        drawTimes: leagueForm.drawTimes.filter((t) => t.trim() !== ''),
        exceptions: uniqueExceptions,
      };

      await patch('/leagues/{id}', payload, { id: String(numericLeagueId) });
      setLeague((prev) => (prev ? { ...prev, ...payload } : prev));
      setEditLeagueModalOpen(false);
    } catch (error: unknown) {
      console.error('Failed to update league:', error);
      showAlert(formatApiError(error, 'Failed to update league'), 'error');
    } finally {
      setLeagueSubmitting(false);
    }
  };

  const handleAddToRoster = async (candidate: MemberSearchResult) => {
    try {
      await post(
        '/leagues/{id}/roster',
        { memberId: candidate.id },
        { id: String(numericLeagueId) }
      );
      await loadRoster();
    } catch (error: unknown) {
      console.error('Failed to add roster member:', error);
      showAlert(formatApiError(error, 'Failed to add to roster'), 'error');
    }
  };

  const handleRemoveRosterMember = async (rosterMember: LeagueRosterMember) => {
    try {
      await del('/leagues/{id}/roster/{memberId}', undefined, {
        id: String(numericLeagueId),
        memberId: String(rosterMember.memberId),
      });
      await loadRoster();
    } catch (error: unknown) {
      console.error('Failed to remove roster member:', error);
      showAlert(formatApiError(error, 'Failed to remove roster member'), 'error');
    }
  };

  const handleOpenBulkRosterModal = () => {
    setBulkRosterModalOpen(true);
    setBulkRosterNames('');
    setBulkRosterResult(null);
    setBulkRosterMatchedNames([]);
    setBulkRosterUnmatched([]);
    setBulkRosterSelection(null);
  };

  const handleCloseBulkRosterModal = () => {
    setBulkRosterModalOpen(false);
  };

  const handleBulkRosterSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const names = bulkRosterNames
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) {
      showAlert('Paste at least one name.', 'warning');
      return;
    }

    setBulkRosterSubmitting(true);
    try {
      const response = await post(
        '/leagues/{id}/roster/bulk',
        { names },
        { id: String(numericLeagueId) }
      );
      setBulkRosterResult(response);
      setBulkRosterMatchedNames(response.matchedNames || []);
      setBulkRosterUnmatched(response.unmatched || []);
      setBulkRosterSelection(null);
      await loadRoster();
    } catch (error: unknown) {
      console.error('Failed to bulk add roster members:', error);
      showAlert(formatApiError(error, 'Failed to bulk add roster members'), 'error');
    } finally {
      setBulkRosterSubmitting(false);
    }
  };

  const handleSelectBulkRosterCandidate = (candidate: MemberSearchResult) => {
    setBulkRosterSelection(candidate);
  };

  const handleBulkRosterResolve = async () => {
    const current = bulkRosterUnmatched[0];
    if (!current) return;
    if (!bulkRosterSelection) {
      showAlert('Select a member to resolve.', 'warning');
      return;
    }
    if (rosterMemberIds.has(bulkRosterSelection.id)) {
      showAlert('That member is already on the roster.', 'warning');
      return;
    }

    setBulkRosterSubmitting(true);
    try {
      await post(
        '/leagues/{id}/roster',
        { memberId: bulkRosterSelection.id },
        { id: String(numericLeagueId) }
      );
      await loadRoster();
      setBulkRosterUnmatched((prev) => prev.slice(1));
      setBulkRosterSelection(null);
    } catch (error: unknown) {
      console.error('Failed to add selected roster member:', error);
      showAlert(formatApiError(error, 'Failed to add roster member'), 'error');
    } finally {
      setBulkRosterSubmitting(false);
    }
  };

  const handleBulkRosterSkip = () => {
    if (bulkRosterUnmatched.length === 0) return;
    setBulkRosterUnmatched((prev) => prev.slice(1));
    setBulkRosterSelection(null);
  };

  useEffect(() => {
    if (!selectedTeam) {
      setSelectedTeamStats(null);
      return;
    }
    (
      get as (
        path: string,
        query?: unknown,
        pathParams?: Record<string, string>
      ) => Promise<unknown>
    )('/teams/{teamId}/stats', undefined, { teamId: String(selectedTeam.id) })
      .then((res: unknown) => {
        const data = res as { gamesPlayed: number; wins: number; losses: number; ties: number };
        setSelectedTeamStats(data);
      })
      .catch(() => setSelectedTeamStats(null));
  }, [selectedTeam]);

  const handleAddManager = async (candidate: MemberSearchResult) => {
    try {
      await post(
        '/leagues/{id}/managers',
        { memberId: candidate.id },
        { id: String(numericLeagueId) }
      );
      await loadManagers();
    } catch (error: unknown) {
      console.error('Failed to add manager:', error);
      showAlert(formatApiError(error, 'Failed to add manager'), 'error');
    }
  };

  const handleRemoveManager = async (managerEntry: LeagueManager) => {
    try {
      await del('/leagues/{id}/managers/{memberId}', undefined, {
        id: String(numericLeagueId),
        memberId: String(managerEntry.memberId),
      });
      await loadManagers();
    } catch (error: unknown) {
      console.error('Failed to remove manager:', error);
      showAlert(formatApiError(error, 'Failed to remove manager'), 'error');
    }
  };

  const handleSelectRoleMember = (role: TeamRole, selected: MemberSearchResult) => {
    if (selectedRoleMemberIds.includes(selected.id) && roleMembers[role]?.id !== selected.id) {
      showAlert('Member is already selected for another role.', 'warning');
      return;
    }
    setRoleMembers((prev) => ({ ...prev, [role]: selected }));
  };

  const handleClearRoleMember = (role: TeamRole) => {
    setRoleMembers((prev) => ({ ...prev, [role]: null }));
  };

  const handleSelectDoublesMember = (role: DoublesRole, selected: MemberSearchResult) => {
    if (
      selectedDoublesMemberIds.includes(selected.id) &&
      doublesMembers[role]?.id !== selected.id
    ) {
      showAlert('Member is already selected for another role.', 'warning');
      return;
    }
    setDoublesMembers((prev) => ({ ...prev, [role]: selected }));
  };

  const handleClearDoublesMember = (role: DoublesRole) => {
    setDoublesMembers((prev) => ({ ...prev, [role]: null }));
  };

  const buildTeamRoster = () => {
    if (!league || league.format !== 'teams') {
      return [];
    }

    const requiredRoles: TeamRole[] = ['lead', 'third', 'fourth'];
    for (const role of requiredRoles) {
      if (!roleMembers[role]) {
        showAlert(`Select a ${roleLabels[role]} for the roster.`, 'warning');
        return null;
      }
    }

    const selectedEntries = teamRoles
      .map((role) => {
        const selected = roleMembers[role];
        if (!selected) return null;
        return {
          memberId: selected.id,
          name: selected.name,
          role,
          isSkip: role === skipRole,
          isVice: role === viceRole,
        } as RosterMember;
      })
      .filter(Boolean) as RosterMember[];

    if (selectedEntries.length < 3) {
      showAlert('Teams rosters need at least 3 players.', 'warning');
      return null;
    }

    if (!roleMembers[skipRole] || !roleMembers[viceRole]) {
      showAlert('Select roster members for skip and vice.', 'warning');
      return null;
    }

    if (skipRole === viceRole) {
      showAlert('Skip and vice must be different roles.', 'warning');
      return null;
    }

    return selectedEntries;
  };

  const buildDoublesRoster = () => {
    if (!league || league.format !== 'doubles') {
      return [];
    }

    const requiredRoles: DoublesRole[] = ['player1', 'player2'];
    for (const role of requiredRoles) {
      if (!doublesMembers[role]) {
        showAlert(`Select ${roleLabels[role]} for the roster.`, 'warning');
        return null;
      }
    }

    const selectedEntries = doublesRoles.map((role) => {
      const selected = doublesMembers[role];
      return {
        memberId: selected!.id,
        name: selected!.name,
        role,
        isSkip: false,
        isVice: false,
      } as RosterMember;
    });

    if (selectedEntries[0].memberId === selectedEntries[1].memberId) {
      showAlert('Player 1 and Player 2 must be different members.', 'warning');
      return null;
    }

    return selectedEntries;
  };

  const getFallbackRole = (excludedRole: TeamRole) => {
    const fallbackOrder: TeamRole[] = ['third', 'fourth', 'lead', 'second'];
    const available = fallbackOrder.filter((role) => roleMembers[role] && role !== excludedRole);
    return available[0] ?? excludedRole;
  };

  const handleTeamSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!league) return;

    setTeamSubmitting(true);
    try {
      const rosterPayload = league.format === 'teams' ? buildTeamRoster() : buildDoublesRoster();
      if (rosterPayload === null) {
        setTeamSubmitting(false);
        return;
      }

      const payload = {
        name: teamForm.name || undefined,
        divisionId: teamForm.divisionId || undefined,
        members:
          rosterPayload.length > 0
            ? rosterPayload.map((member) => ({
                memberId: member.memberId,
                role: member.role,
                isSkip: member.isSkip,
                isVice: member.isVice,
              }))
            : undefined,
      };

      if (editingTeam) {
        await patch(
          '/teams/{teamId}',
          {
            name: teamForm.name || undefined,
            divisionId: teamForm.divisionId || undefined,
          },
          { teamId: String(editingTeam.id) }
        );

        if (rosterPayload.length > 0) {
          await put(
            '/teams/{teamId}/roster',
            {
              members: rosterPayload.map((member) => ({
                memberId: member.memberId,
                role: member.role,
                isSkip: member.isSkip,
                isVice: member.isVice,
              })),
            },
            { teamId: String(editingTeam.id) }
          );
        }
      } else {
        await post('/leagues/{id}/teams', payload, { id: String(numericLeagueId) });
      }

      await loadAll();
      handleCloseTeamModal();
    } catch (error: unknown) {
      console.error('Failed to save team:', error);
      showAlert(formatApiError(error, 'Failed to save team'), 'error');
    } finally {
      setTeamSubmitting(false);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    const confirmed = await confirm({
      title: 'Delete team',
      message: `Are you sure you want to delete ${team.name || 'this team'}?`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await del('/teams/{teamId}', undefined, { teamId: String(team.id) });
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
      await loadRoster();
    } catch (error: unknown) {
      console.error('Failed to delete team:', error);
      showAlert(formatApiError(error, 'Failed to delete team'), 'error');
    }
  };

  const teamsByDivision = useMemo(() => {
    const map = new Map<number, Team[]>();
    teams.forEach((team) => {
      const list = map.get(team.divisionId) ?? [];
      list.push(team);
      map.set(team.divisionId, list);
    });
    return map;
  }, [teams]);

  const memberTeamIds = useMemo(() => {
    if (!member?.id) return [];
    return teams
      .filter((team) => team.roster.some((entry) => entry.memberId === member.id))
      .map((team) => team.id);
  }, [teams, member?.id]);

  const sortedDivisions = useMemo(() => {
    return divisions.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [divisions]);

  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [teams]);

  const teamRosterDisplay = (team: Team) => {
    if (team.roster.length === 0) {
      return <span className="ml-2">No roster set</span>;
    }
    if (league?.format === 'doubles') {
      return (
        <ul className="mt-2 space-y-1">
          {team.roster.map((member) => (
            <li key={member.memberId}>{member.name}</li>
          ))}
        </ul>
      );
    }

    const rosterByRole = new Map<TeamRole, RosterMember>();
    team.roster.forEach((member) => {
      if (
        member.role === 'lead' ||
        member.role === 'second' ||
        member.role === 'third' ||
        member.role === 'fourth'
      ) {
        rosterByRole.set(member.role, member);
      }
    });
    const orderedRoles: TeamRole[] = ['fourth', 'third', 'second', 'lead'];

    return (
      <ul className="mt-2 space-y-1">
        {orderedRoles.map((role) => {
          const entry = rosterByRole.get(role);
          const suffix = entry?.isSkip ? '*' : entry?.isVice ? '**' : '';
          return (
            <li key={role}>
              {roleLabels[role]}: {entry?.name || 'Unassigned'}
              {suffix}
            </li>
          );
        })}
      </ul>
    );
  };

  if (loading) {
    return (
      <Layout>
        <AppPage>
          <AppStateCard title="Loading league..." />
        </AppPage>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <AppPage>
          <AppStateCard title="League not found." />
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title={league.name}
          description="League details"
          actions={<BackButton label="Leagues" onClick={() => navigate('/leagues')} />}
        />

        {leagueId && (
          <LeagueTabs
            leagueId={leagueId}
            showSheetsTab={canManageSetup}
            showMaintenanceTab={canManageSetup}
          />
        )}

        {normalizedTab === 'overview' && (
          <div className="space-y-6">
            <div className="app-card space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h2 className="app-section-title">
                  League info
                </h2>
                {canEditLeagueInfo && (
                  <Button onClick={handleOpenLeagueEdit} variant="secondary">
                    Edit league info
                  </Button>
                )}
              </div>
              <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium dark:text-gray-300">Day:</span>{' '}
                  {getDayName(league.dayOfWeek)}
                </div>
                <div>
                  <span className="font-medium dark:text-gray-300">Draw times:</span>{' '}
                  {league.drawTimes.map(formatTime).join(', ')}
                </div>
                <div>
                  <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                  {league.format === 'teams' ? 'Teams' : 'Doubles'}
                </div>
                <div>
                  <span className="font-medium dark:text-gray-300">Season:</span>{' '}
                  {formatDateDisplay(league.startDate)} – {formatDateDisplay(league.endDate)}
                </div>
                {league.exceptions?.length > 0 && (
                  <div>
                    <span className="font-medium dark:text-gray-300">Exceptions:</span>{' '}
                    <span className="text-gray-600 dark:text-gray-400">
                      {league.exceptions.map((d) => formatDateDisplay(d)).join(', ')}
                    </span>
                  </div>
                )}
                {managers.length > 0 && (
                  <div>
                    <span className="font-medium dark:text-gray-300">League managers:</span>{' '}
                    <span className="text-gray-600 dark:text-gray-400">
                      {managers.map((m) => m.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {memberTeamIds.length > 0 && leagueSettings?.collectByeRequests && (
              <div className="app-card space-y-3">
                <h2 className="app-section-title">
                  Bye requests
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Submit your team&apos;s bye preferences for the draw schedule.
                </p>
                <Button onClick={handleOpenByeRequestsModal}>Update bye requests</Button>
              </div>
            )}

            <div className="app-card space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/leagues/${leagueId}/teams`)}
                  className="text-left text-lg font-semibold text-primary-teal hover:underline"
                >
                  Teams
                </button>
              </div>

              {teams.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No teams yet.</div>
              ) : divisions.length > 1 ? (
                <div className="space-y-4">
                  {sortedDivisions.map((division) => {
                    const divisionTeams = teamsByDivision.get(division.id) ?? [];
                    if (divisionTeams.length === 0) {
                      return null;
                    }
                    return (
                      <div key={division.id} className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {division.name} division
                        </h3>
                        <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                          {divisionTeams.map((team) => (
                            <li key={team.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedTeam(team)}
                                className="text-left text-primary-teal hover:underline"
                              >
                                {team.name || 'Unnamed team'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  {sortedTeams.map((team) => (
                    <li key={team.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTeam(team)}
                        className="text-left text-primary-teal hover:underline"
                      >
                        {team.name || 'Unnamed team'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {normalizedTab === 'schedule' && (
          <LeagueSchedule
            leagueId={numericLeagueId}
            teams={teams}
            canManage={canManageSetup}
            memberTeamIds={memberTeamIds}
            leagueFormat={league.format}
          />
        )}

        {normalizedTab === 'standings' && (
          <LeagueStandings leagueId={numericLeagueId} canManage={canManageSetup} />
        )}

        {normalizedTab === 'schedule-generation' &&
          (canManageSetup ? (
            <LeagueScheduleGeneration
              leagueId={numericLeagueId}
              divisions={divisions}
              teams={teams}
              canManage={canManageSetup}
            />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              You do not have access to schedule generation.
            </div>
          ))}

        {normalizedTab === 'sheets' &&
          (canManageSetup ? (
            <LeagueSheets leagueId={numericLeagueId} />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              You do not have access to manage sheets.
            </div>
          ))}

        {normalizedTab === 'divisions' && (
          <div className="space-y-4">
            {canManageSetup && (
              <div className="flex justify-end">
                <Button onClick={() => handleOpenDivisionModal()}>Add division</Button>
              </div>
            )}

            {divisions.length === 0 ? (
              <div className="app-card text-center py-12">
                <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No divisions yet.</p>
                {canManageSetup && (
                  <Button onClick={() => handleOpenDivisionModal()}>Create a division</Button>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                {divisions
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((division) => (
                    <div
                      key={division.id}
                      className="app-card"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="app-section-title mb-2">
                            {division.name}
                          </h3>
                        </div>

                        {canManageSetup && (
                          <div className="flex space-x-2">
                            <Button
                              onClick={() => handleOpenDivisionModal(division)}
                              variant="secondary"
                            >
                              Edit
                            </Button>
                            <Button onClick={() => handleDeleteDivision(division)} variant="danger">
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {normalizedTab === 'teams' && (
          <div className="space-y-4">
            {canManageSetup && (
              <div
                ref={teamFormRef}
                className="app-card space-y-4"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h2 className="app-section-title">
                      {editingTeam ? 'Edit team' : 'Add team'}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Build team rosters from the league roster.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setTeamFormOpen((prev) => !prev)}
                    >
                      {teamFormOpen
                        ? 'Hide team builder'
                        : editingTeam
                          ? 'Show edit form'
                          : 'Add team'}
                    </Button>
                    {editingTeam && (
                      <Button type="button" variant="secondary" onClick={handleCloseTeamModal}>
                        Cancel edit
                      </Button>
                    )}
                  </div>
                </div>

                {teamFormOpen && (
                  <form onSubmit={handleTeamSubmit} className="space-y-4">
                    <div>
                      <label
                        htmlFor="teamNameInline"
                        className="app-label"
                      >
                        Team name
                      </label>
                      <input
                        type="text"
                        id="teamNameInline"
                        value={teamForm.name}
                        onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                        className="app-input"
                      />
                    </div>

                    {divisions.length > 1 && (
                      <div>
                        <label
                          htmlFor="teamDivisionInline"
                          className="app-label"
                        >
                          Division
                        </label>
                        <select
                          id="teamDivisionInline"
                          value={teamForm.divisionId}
                          onChange={(e) =>
                            setTeamForm({ ...teamForm, divisionId: parseInt(e.target.value, 10) })
                          }
                          className="app-input"
                        >
                          {divisions.map((division) => (
                            <option key={division.id} value={division.id}>
                              {division.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Roster
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {league.format === 'doubles'
                            ? 'Add Player 1 and Player 2.'
                            : 'Add lead, third, fourth (and optional second), then pick skip and vice.'}
                        </p>
                      </div>

                      {league.format === 'teams' ? (
                        <div className="space-y-4">
                          {teamRoles.map((role) => {
                            return (
                              <div key={role} className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label className="text-xs text-gray-500 dark:text-gray-400">
                                    {roleLabels[role]}
                                  </label>
                                  <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name="viceRole"
                                        value={role}
                                        checked={viceRole === role}
                                        onChange={() => {
                                          setViceRole(role);
                                          if (skipRole === role) {
                                            setSkipRole(getFallbackRole(role));
                                          }
                                        }}
                                        disabled={!roleMembers[role]}
                                        className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                                      />
                                      Vice
                                    </label>
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name="skipRole"
                                        value={role}
                                        checked={skipRole === role}
                                        onChange={() => {
                                          setSkipRole(role);
                                          if (viceRole === role) {
                                            setViceRole(getFallbackRole(role));
                                          }
                                        }}
                                        disabled={!roleMembers[role]}
                                        className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                                      />
                                      Skip
                                    </label>
                                  </div>
                                </div>
                                <MemberAutocomplete
                                  value={roleMembers[role]?.id ?? ''}
                                  onChange={(nextValue) => {
                                    if (nextValue === '') {
                                      handleClearRoleMember(role);
                                    }
                                  }}
                                  selectedOption={roleMembers[role]}
                                  onSelectOption={(option) => handleSelectRoleMember(role, option)}
                                  placeholder={`Select ${roleLabels[role].toLowerCase()}`}
                                  minQueryLength={0}
                                  noMatchesText="No members found"
                                  filterOption={(option) => {
                                    const currentMemberId = roleMembers[role]?.id;
                                    if (!rosterMemberIds.has(option.id)) return false;
                                    const assignedTeamId = rosterAssignmentsByMemberId.get(option.id);
                                    if (assignedTeamId && assignedTeamId !== editingTeam?.id) {
                                      return false;
                                    }
                                    if (option.id === currentMemberId) return true;
                                    return !selectedRoleMemberIds.includes(option.id);
                                  }}
                                />
                              </div>
                            );
                          })}
                          {rosterMembers.length === 0 && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Add members to the league roster before assigning teams.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {doublesRoles.map((role) => {
                            return (
                              <div key={role} className="space-y-2">
                                <label className="text-xs text-gray-500 dark:text-gray-400">
                                  {roleLabels[role]}
                                </label>
                                <MemberAutocomplete
                                  value={doublesMembers[role]?.id ?? ''}
                                  onChange={(nextValue) => {
                                    if (nextValue === '') {
                                      handleClearDoublesMember(role);
                                    }
                                  }}
                                  selectedOption={doublesMembers[role]}
                                  onSelectOption={(option) => handleSelectDoublesMember(role, option)}
                                  placeholder={`Select ${roleLabels[role].toLowerCase()}`}
                                  minQueryLength={0}
                                  noMatchesText="No members found"
                                  filterOption={(option) => {
                                    const currentMemberId = doublesMembers[role]?.id;
                                    if (!rosterMemberIds.has(option.id)) return false;
                                    const assignedTeamId = rosterAssignmentsByMemberId.get(option.id);
                                    if (assignedTeamId && assignedTeamId !== editingTeam?.id) {
                                      return false;
                                    }
                                    if (option.id === currentMemberId) return true;
                                    return !selectedDoublesMemberIds.includes(option.id);
                                  }}
                                />
                              </div>
                            );
                          })}
                          {rosterMembers.length === 0 && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Add members to the league roster before assigning teams.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex space-x-3">
                      <Button type="submit" disabled={teamSubmitting} className="flex-1">
                        {teamSubmitting ? 'Saving...' : editingTeam ? 'Save team' : 'Create team'}
                      </Button>
                      {editingTeam && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleCloseTeamModal}
                          disabled={teamSubmitting}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}

            {teams.length === 0 ? (
              <div className="app-card text-center py-12">
                <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No teams yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {divisions.map((division) => {
                  const divisionTeams = teamsByDivision.get(division.id) || [];
                  if (divisionTeams.length === 0) {
                    return null;
                  }

                  return (
                    <div key={division.id} className="space-y-3">
                      <h2 className="app-section-title">
                        {division.name}
                      </h2>
                      <div className="grid gap-4">
                        {divisionTeams.map((team) => (
                          <div
                            key={team.id}
                            className="app-card"
                          >
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1">
                                <h3 className="app-section-title mb-2">
                                  {team.name || 'Unnamed team'}
                                </h3>
                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                  <div>{teamRosterDisplay(team)}</div>
                                </div>
                              </div>

                              {canManageSetup && (
                                <div className="flex space-x-2">
                                  <Button
                                    onClick={() => handleOpenTeamModal(team)}
                                    variant="secondary"
                                  >
                                    Edit
                                  </Button>
                                  <Button onClick={() => handleDeleteTeam(team)} variant="danger">
                                    Delete
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {league.format === 'teams' && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">* Skip · ** Vice</div>
                )}
              </div>
            )}
          </div>
        )}

        {normalizedTab === 'managers' && (
          <div className="space-y-4">
            <div className="app-card space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="app-section-title">
                    League managers
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Managers can edit league details except the roster.
                  </p>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total: <span className="font-medium">{managers.length}</span>
                </div>
              </div>
            </div>

            <div className="app-card">
              {managers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No league managers assigned yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {managers.map((entry) => (
                    <div
                      key={entry.memberId}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md p-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {entry.name}
                        </div>
                        {entry.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {entry.email}
                          </div>
                        )}
                      </div>
                      {canEditManagers && (
                        <Button variant="danger" onClick={() => handleRemoveManager(entry)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canEditManagers && (
              <div className="app-card space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Add league manager
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Search any member to add as a league manager.
                  </p>
                </div>
                <MemberAutocomplete
                  value=""
                  onChange={() => {}}
                  onSelectOption={handleAddManager}
                  placeholder="Search members by name or email"
                  minQueryLength={2}
                  openOnFocus={false}
                  noMatchesText="No members found"
                  filterOption={(option) =>
                    !managers.some((managerEntry) => managerEntry.memberId === option.id)
                  }
                />
              </div>
            )}
          </div>
        )}

        {normalizedTab === 'maintenance' && canManageSetup && league && (
          <LeagueMaintenance
            leagueId={numericLeagueId}
            leagueName={league.name}
            canDeleteLeague={leagueAccess.hasGlobalLeagueAdmin}
            onDataCleared={loadAll}
            onLeagueDeleted={() => navigate('/leagues')}
          />
        )}

        {normalizedTab === 'roster' && (
          <div className="space-y-4">
            <div className="app-card space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="app-section-title">
                    League roster
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Members eligible for team assignments.
                  </p>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total: <span className="font-medium">{rosterMembers.length}</span> · Unassigned:{' '}
                  <span className="font-medium">{unassignedRosterMembers.length}</span>
                </div>
              </div>
            </div>

            {canManageRoster && (
              <div className="app-card space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Add members to roster
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Search the full member list and add them to this league roster.
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={handleOpenBulkRosterModal}>
                    Bulk add
                  </Button>
                </div>
                <MemberAutocomplete
                  value=""
                  onChange={() => {}}
                  onSelectOption={handleAddToRoster}
                  placeholder="Search members by name or email"
                  minQueryLength={2}
                  openOnFocus={false}
                  noMatchesText="No members found"
                  filterOption={(option) => !rosterMemberIds.has(option.id)}
                />
              </div>
            )}

            <div className="app-card">
              {rosterMembers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No roster members yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {rosterMembers.map((entry) => (
                    <div
                      key={entry.memberId}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md p-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {entry.name}
                        </div>
                        {entry.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {entry.email}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {entry.assignedTeamName ? (
                          <span className="text-xs text-gray-600 dark:text-gray-300">
                            Assigned to {entry.assignedTeamName}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded-full">
                            Unassigned
                          </span>
                        )}
                        {canManageRoster && (
                          <Button
                            variant="danger"
                            onClick={() => handleRemoveRosterMember(entry)}
                            disabled={Boolean(entry.assignedTeamId)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AppPage>

      {canManageSetup && (
        <Modal
          isOpen={divisionModalOpen}
          onClose={handleCloseDivisionModal}
          title={editingDivision ? 'Edit division' : 'Add division'}
        >
          <form onSubmit={handleDivisionSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="divisionName"
                className="app-label"
              >
                Division name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="divisionName"
                value={divisionForm.name}
                onChange={(e) => setDivisionForm({ ...divisionForm, name: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div className="flex space-x-3">
              <Button type="submit" disabled={divisionSubmitting} className="flex-1">
                {divisionSubmitting ? 'Saving...' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseDivisionModal}
                disabled={divisionSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {canEditLeagueInfo && (
        <Modal
          isOpen={editLeagueModalOpen}
          onClose={handleCloseLeagueEdit}
          title="Edit league details"
        >
          <form onSubmit={handleLeagueSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="leagueName"
                className="app-label"
              >
                League name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="leagueName"
                value={leagueForm.name}
                onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="leagueDayOfWeek"
                className="app-label"
              >
                Day of week <span className="text-red-500">*</span>
              </label>
              <select
                id="leagueDayOfWeek"
                value={leagueForm.dayOfWeek}
                onChange={(e) =>
                  setLeagueForm({ ...leagueForm, dayOfWeek: parseInt(e.target.value, 10) })
                }
                className="app-input"
                required
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label className="app-label">
                Draw times <span className="text-red-500">*</span>
              </label>
              {leagueForm.drawTimes.map((time, index) => (
                <div key={`draw-${index}`} className="flex items-center space-x-2 mb-2">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => updateDrawTime(index, e.target.value)}
                    className="app-input flex-1"
                    required
                  />
                  {leagueForm.drawTimes.length > 1 && (
                    <Button type="button" variant="secondary" onClick={() => removeDrawTime(index)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={addDrawTime}>
                Add time
              </Button>
            </div>

            <div>
              <label
                htmlFor="leagueStartDate"
                className="app-label"
              >
                Season start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="leagueStartDate"
                value={leagueForm.startDate}
                onChange={(e) => setLeagueForm({ ...leagueForm, startDate: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="leagueEndDate"
                className="app-label"
              >
                Season end date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="leagueEndDate"
                value={leagueForm.endDate}
                onChange={(e) => setLeagueForm({ ...leagueForm, endDate: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="leagueFormat"
                className="app-label"
              >
                Format <span className="text-red-500">*</span>
              </label>
              <select
                id="leagueFormat"
                value={leagueForm.format}
                onChange={(e) =>
                  setLeagueForm({ ...leagueForm, format: e.target.value as League['format'] })
                }
                className="app-input"
                required
              >
                <option value="teams">Teams (4 players)</option>
                <option value="doubles">Doubles (2 players)</option>
              </select>
            </div>

            <div>
              <label className="app-label">
                Exception dates (no games)
              </label>
              <div className="space-y-2">
                {leagueForm.exceptions.length > 0 && (
                  <div className="space-y-1">
                    {leagueForm.exceptions.map((dateStr) => (
                      <div key={dateStr} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">
                          {formatDateDisplay(dateStr)}
                        </span>
                        <button
                          type="button"
                          className="text-red-600 hover:text-red-800"
                          onClick={() =>
                            setLeagueForm((prev) => ({
                              ...prev,
                              exceptions: prev.exceptions.filter((d) => d !== dateStr),
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showExceptionPicker && (
                  <div className="flex items-center space-x-2">
                    <select
                      value={exceptionToAdd}
                      onChange={(e) => setExceptionToAdd(e.target.value)}
                      className="app-input flex-1"
                    >
                      <option value="">Select date</option>
                      {availableExceptionDates.map((date) => (
                        <option key={date} value={date}>
                          {formatDateDisplay(date)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (exceptionToAdd) {
                          setLeagueForm((prev) => ({
                            ...prev,
                            exceptions: [...prev.exceptions, exceptionToAdd],
                          }));
                          setExceptionToAdd('');
                        }
                      }}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setShowExceptionPicker(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {!showExceptionPicker && availableExceptionDates.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowExceptionPicker(true)}
                  >
                    Add exception
                  </Button>
                )}
              </div>
            </div>

            <div className="flex space-x-3">
              <Button type="submit" disabled={leagueSubmitting} className="flex-1">
                {leagueSubmitting ? 'Saving...' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseLeagueEdit}
                disabled={leagueSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <Modal
        isOpen={Boolean(selectedTeam)}
        onClose={() => setSelectedTeam(null)}
        title={selectedTeam?.name ?? 'Team roster'}
      >
        {selectedTeam ? (
          <div className="space-y-4">
            {selectedTeamStats != null && (
              <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 pb-3">
                <span>
                  GP:{' '}
                  <strong className="text-gray-800 dark:text-gray-200">
                    {selectedTeamStats.gamesPlayed}
                  </strong>
                </span>
                <span>
                  W:{' '}
                  <strong className="text-gray-800 dark:text-gray-200">
                    {selectedTeamStats.wins}
                  </strong>
                </span>
                <span>
                  L:{' '}
                  <strong className="text-gray-800 dark:text-gray-200">
                    {selectedTeamStats.losses}
                  </strong>
                </span>
                <span>
                  T:{' '}
                  <strong className="text-gray-800 dark:text-gray-200">
                    {selectedTeamStats.ties}
                  </strong>
                </span>
              </div>
            )}
            {selectedTeam.roster.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">No roster set.</div>
            ) : (
              <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                {selectedTeam.roster.map((member) => (
                  <li key={member.memberId}>
                    {member.name} — {roleLabels[member.role]}
                    {member.isSkip ? ' (Skip)' : ''}
                    {member.isVice ? ' (Vice)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={byeRequestsModalOpen}
        onClose={handleCloseByeRequestsModal}
        title="Update bye requests"
      >
        <form onSubmit={handleByeRequestsSubmit} className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Assign a priority to any draw date you want as a bye. Lower number = higher preference
            (1 = most preferred). Leave blank for no preference. Priorities can be duplicated.
          </p>
          {memberTeamIds.length > 1 && (
            <div>
              <label
                htmlFor="bye-requests-team"
                className="app-label"
              >
                Team
              </label>
              <select
                id="bye-requests-team"
                value={byeRequestsTeamId ?? ''}
                onChange={(e) => handleByeRequestsTeamChange(Number(e.target.value))}
                className="app-input"
              >
                {teams
                  .filter((t) => memberTeamIds.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name ?? `Team ${t.id}`}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {byeRequestsLoading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading draw schedule…</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {hasTwoDraws && !byeRequestsLoading && (
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
              {byeDrawDates.map((date) => {
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
              {byeDrawDates.length === 0 && !byeRequestsLoading && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No draw dates for this league.
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={handleCloseByeRequestsModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={byeRequestsSaving || byeRequestsLoading}>
              {byeRequestsSaving ? 'Saving…' : 'Save bye requests'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={bulkRosterModalOpen}
        onClose={handleCloseBulkRosterModal}
        title="Bulk add roster members"
        contentOverflow="visible"
      >
        <form onSubmit={handleBulkRosterSubmit} className="space-y-4">
          {!bulkRosterResult && (
            <div>
              <label
                htmlFor="bulkRosterNames"
                className="app-label"
              >
                Paste names (one per line)
              </label>
              <textarea
                id="bulkRosterNames"
                value={bulkRosterNames}
                onChange={(e) => setBulkRosterNames(e.target.value)}
                rows={8}
                className="app-input"
                placeholder="Jane Doe&#10;John Smith"
              />
            </div>
          )}

          {bulkRosterResult && (
            <div className="space-y-3">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Added: <span className="font-medium">{bulkRosterResult.addedCount}</span> · Already
                on roster:{' '}
                <span className="font-medium">{bulkRosterResult.alreadyOnRosterCount}</span> ·
                Unmatched: <span className="font-medium">{bulkRosterUnmatched.length}</span>
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Matched names
                </div>
                {bulkRosterMatchedNames.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No exact matches.</div>
                ) : (
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    {bulkRosterMatchedNames.map((name, index) => (
                      <li key={`${name}-${index}`}>{name}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Resolve unmatched names
                </div>
                {bulkRosterUnmatched.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    All unmatched names resolved.
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{bulkRosterUnmatched[0].name}</span>
                    </div>
                    {bulkRosterUnmatched[0].candidates.filter(
                      (candidate) => !rosterMemberIds.has(candidate.id)
                    ).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {bulkRosterUnmatched[0].candidates
                          .filter((candidate) => !rosterMemberIds.has(candidate.id))
                          .map((candidate) => (
                            <Button
                              key={candidate.id}
                              type="button"
                              variant={
                                bulkRosterSelection?.id === candidate.id ? 'primary' : 'secondary'
                              }
                              onClick={() => handleSelectBulkRosterCandidate(candidate)}
                            >
                              {candidate.name}
                            </Button>
                          ))}
                      </div>
                    )}
                    <MemberAutocomplete
                      value={bulkRosterSelection?.id ?? ''}
                      onChange={(nextValue) => {
                        if (nextValue === '') {
                          setBulkRosterSelection(null);
                        }
                      }}
                      selectedOption={bulkRosterSelection}
                      onSelectOption={handleSelectBulkRosterCandidate}
                      placeholder="Search members by name or email"
                      minQueryLength={2}
                      openOnFocus={false}
                      noMatchesText="No members found"
                      filterOption={(option) => !rosterMemberIds.has(option.id)}
                    />
                    {bulkRosterSelection && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Selected: {bulkRosterSelection.name}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex space-x-3">
            {bulkRosterResult ? (
              <>
                <Button
                  type="button"
                  onClick={handleBulkRosterResolve}
                  disabled={bulkRosterSubmitting || bulkRosterUnmatched.length === 0}
                >
                  Resolve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBulkRosterSkip}
                  disabled={bulkRosterUnmatched.length === 0}
                >
                  Skip
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCloseBulkRosterModal}
                  className="ml-auto"
                >
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={bulkRosterSubmitting} className="flex-1">
                  {bulkRosterSubmitting ? 'Processing...' : 'Match names'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCloseBulkRosterModal}
                  className="flex-1"
                >
                  Close
                </Button>
              </>
            )}
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
