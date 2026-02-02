import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { del, get, patch, post, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/Button';
import LeagueTabs from '../../components/LeagueTabs';
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
  email: string | null;
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
  return teamRoles.reduce((acc, role) => {
    acc[role] = value;
    return acc;
  }, {} as Record<TeamRole, T>);
}

function createDoublesRecord<T>(value: T) {
  return doublesRoles.reduce((acc, role) => {
    acc[role] = value;
    return acc;
  }, {} as Record<DoublesRole, T>);
}

const leagueParamTabs = ['teams', 'roster', 'divisions', 'managers'] as const;
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
  const normalizedTab = useMemo<LeagueSetupTab>(() => {
    if (tab && leagueParamTabs.includes(tab as LeagueParamTab)) {
      return tab as LeagueSetupTab;
    }
    return 'overview';
  }, [tab]);
  const [loading, setLoading] = useState(true);

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
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterSearchResults, setRosterSearchResults] = useState<MemberSearchResult[]>([]);
  const [rosterSearchLoading, setRosterSearchLoading] = useState(false);
  const [rosterDropdownOpen, setRosterDropdownOpen] = useState(false);
  const rosterDropdownRef = useRef<HTMLDivElement>(null);
  const [rosterHighlightedIndex, setRosterHighlightedIndex] = useState(-1);
  const rosterInputRef = useRef<HTMLInputElement>(null);
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
  const [bulkRosterQuery, setBulkRosterQuery] = useState('');
  const [bulkRosterResults, setBulkRosterResults] = useState<MemberSearchResult[]>([]);
  const [bulkRosterLoading, setBulkRosterLoading] = useState(false);
  const [bulkRosterDropdownOpen, setBulkRosterDropdownOpen] = useState(false);
  const [bulkRosterHighlightedIndex, setBulkRosterHighlightedIndex] = useState(-1);
  const bulkRosterSearchTimeout = useRef<number | null>(null);

  const [managers, setManagers] = useState<LeagueManager[]>([]);
  const [managerSearchQuery, setManagerSearchQuery] = useState('');
  const [managerSearchResults, setManagerSearchResults] = useState<MemberSearchResult[]>([]);
  const [managerSearchLoading, setManagerSearchLoading] = useState(false);
  const [managerDropdownOpen, setManagerDropdownOpen] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);
  const [managerHighlightedIndex, setManagerHighlightedIndex] = useState(-1);
  const managerInputRef = useRef<HTMLInputElement>(null);

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
  const teamFormRef = useRef<HTMLDivElement | null>(null);
  const [teamFormOpen, setTeamFormOpen] = useState(false);

  const [roleMembers, setRoleMembers] = useState<Record<TeamRole, MemberSearchResult | null>>(
    createRoleRecord(null)
  );
  const [roleQueries, setRoleQueries] = useState<Record<TeamRole, string>>(createRoleRecord(''));
  const [roleDropdownOpen, setRoleDropdownOpen] = useState<Record<TeamRole, boolean>>(createRoleRecord(false));
  const [roleHighlightedIndex, setRoleHighlightedIndex] = useState<Record<TeamRole, number>>(createRoleRecord(-1));
  const roleDropdownRefs = useRef<Record<TeamRole, HTMLDivElement | null>>(createRoleRecord(null));
  const roleInputRefs = useRef<Record<TeamRole, HTMLInputElement | null>>(createRoleRecord(null));
  const [skipRole, setSkipRole] = useState<TeamRole>('fourth');
  const [viceRole, setViceRole] = useState<TeamRole>('third');
  const [focusedRole, setFocusedRole] = useState<TeamRole | null>(null);
  const [doublesMembers, setDoublesMembers] = useState<Record<DoublesRole, MemberSearchResult | null>>(
    createDoublesRecord(null)
  );
  const [doublesQueries, setDoublesQueries] = useState<Record<DoublesRole, string>>(
    createDoublesRecord('')
  );
  const [doublesDropdownOpen, setDoublesDropdownOpen] = useState<Record<DoublesRole, boolean>>(
    createDoublesRecord(false)
  );
  const [doublesHighlightedIndex, setDoublesHighlightedIndex] = useState<Record<DoublesRole, number>>(
    createDoublesRecord(-1)
  );
  const doublesDropdownRefs = useRef<Record<DoublesRole, HTMLDivElement | null>>(createDoublesRecord(null));
  const doublesInputRefs = useRef<Record<DoublesRole, HTMLInputElement | null>>(createDoublesRecord(null));
  const [focusedDoublesRole, setFocusedDoublesRole] = useState<DoublesRole | null>(null);

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

  const canManageRoster = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin,
    [leagueAccess]
  );
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

  const rosterSearchOptions = useMemo(() => {
    return rosterMembers.map((member) => ({
      id: member.memberId,
      name: member.name,
      email: member.email,
      assignedTeamId: member.assignedTeamId,
    }));
  }, [rosterMembers]);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rosterDropdownRef.current && !rosterDropdownRef.current.contains(target)) {
        setRosterDropdownOpen(false);
      }
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(target)) {
        setManagerDropdownOpen(false);
      }
      teamRoles.forEach((role) => {
        const ref = roleDropdownRefs.current[role];
        if (ref && !ref.contains(target)) {
          setRoleDropdownOpen((prev) => ({ ...prev, [role]: false }));
        }
      });
      doublesRoles.forEach((role) => {
        const ref = doublesDropdownRefs.current[role];
        if (ref && !ref.contains(target)) {
          setDoublesDropdownOpen((prev) => ({ ...prev, [role]: false }));
        }
      });
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const loadRoster = async () => {
    const rosterResponse = await get('/leagues/{id}/roster', undefined, { id: String(numericLeagueId) });
    setRosterMembers(rosterResponse);
  };

  const loadManagers = async () => {
    const managersResponse = await get('/leagues/{id}/managers', undefined, { id: String(numericLeagueId) });
    setManagers(managersResponse);
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

      const [divisionsResponse, teamsResponse, rosterResponse, managersResponse] = await Promise.all([
        get('/leagues/{id}/divisions', undefined, { id: String(numericLeagueId) }),
        get('/leagues/{id}/teams', undefined, { id: String(numericLeagueId) }),
        get('/leagues/{id}/roster', undefined, { id: String(numericLeagueId) }),
        get('/leagues/{id}/managers', undefined, { id: String(numericLeagueId) }),
      ]);

      setDivisions(divisionsResponse);
      setTeams(teamsResponse);
      setRosterMembers(rosterResponse);
      setManagers(managersResponse);
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
        const nextRoleQueries = createRoleRecord<string>('');
        let nextSkip: TeamRole | null = null;
        let nextVice: TeamRole | null = null;
        team.roster.forEach((member) => {
          if (teamRoles.includes(member.role as TeamRole)) {
            const role = member.role as TeamRole;
            nextRoleMembers[role] = { id: member.memberId, name: member.name, email: null };
            nextRoleQueries[role] = member.name;
            if (member.isSkip) nextSkip = role;
            if (member.isVice) nextVice = role;
          }
        });
        setRoleMembers(nextRoleMembers);
        setRoleQueries(nextRoleQueries);
        setSkipRole(nextSkip ?? 'fourth');
        setViceRole(nextVice ?? 'third');
      } else {
        const nextDoublesMembers = createDoublesRecord<MemberSearchResult | null>(null);
        const nextDoublesQueries = createDoublesRecord<string>('');
        team.roster.forEach((member) => {
          if (member.role === 'player1' || member.role === 'player2') {
            const role = member.role as DoublesRole;
            nextDoublesMembers[role] = { id: member.memberId, name: member.name, email: null };
            nextDoublesQueries[role] = member.name;
          }
        });
        setDoublesMembers(nextDoublesMembers);
        setDoublesQueries(nextDoublesQueries);
      }
    } else {
      setEditingTeam(null);
      setTeamForm({
        name: '',
        divisionId: divisions[0]?.id || 0,
      });
      if (league.format === 'teams') {
        setRoleMembers(createRoleRecord<MemberSearchResult | null>(null));
        setRoleQueries(createRoleRecord(''));
        setSkipRole('fourth');
        setViceRole('third');
      } else {
        setDoublesMembers(createDoublesRecord<MemberSearchResult | null>(null));
        setDoublesQueries(createDoublesRecord(''));
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
    setRoleQueries(createRoleRecord(''));
    setRoleDropdownOpen(createRoleRecord(false));
    setRoleHighlightedIndex(createRoleRecord(-1));
    setSkipRole('fourth');
    setViceRole('third');
    setFocusedRole(null);
    setDoublesMembers(createDoublesRecord<MemberSearchResult | null>(null));
    setDoublesQueries(createDoublesRecord(''));
    setDoublesDropdownOpen(createDoublesRecord(false));
    setDoublesHighlightedIndex(createDoublesRecord(-1));
    setFocusedDoublesRole(null);
    setTeamFormOpen(false);
  };

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
    const valid = new Set(computeLeagueDates(leagueForm.startDate, leagueForm.endDate, leagueForm.dayOfWeek));
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

  useEffect(() => {
    const query = rosterSearchQuery.trim();
    if (query.length < 2) {
      setRosterSearchResults([]);
      setRosterDropdownOpen(false);
      return;
    }

    setRosterDropdownOpen(true);
    setRosterHighlightedIndex(-1);
    const handle = window.setTimeout(async () => {
      setRosterSearchLoading(true);
      try {
        const response = await get(
          '/leagues/{id}/roster/search',
          { query },
          { id: String(numericLeagueId) }
        );
        setRosterSearchResults(response);
      } catch (error: unknown) {
        console.error('Failed to search roster candidates:', error);
        showAlert(formatApiError(error, 'Failed to search members'), 'error');
      } finally {
        setRosterSearchLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [rosterSearchQuery, numericLeagueId]);

  const handleAddToRoster = async (candidate: MemberSearchResult) => {
    try {
      await post('/leagues/{id}/roster', { memberId: candidate.id }, { id: String(numericLeagueId) });
      await loadRoster();
      setRosterSearchResults([]);
      setRosterSearchQuery('');
      setRosterDropdownOpen(false);
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
    setBulkRosterQuery('');
    setBulkRosterResults([]);
    setBulkRosterLoading(false);
    setBulkRosterDropdownOpen(false);
    setBulkRosterHighlightedIndex(-1);
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
      const response = await post('/leagues/{id}/roster/bulk', { names }, { id: String(numericLeagueId) });
      setBulkRosterResult(response);
      setBulkRosterMatchedNames(response.matchedNames || []);
      setBulkRosterUnmatched(response.unmatched || []);
      setBulkRosterSelection(null);
      setBulkRosterQuery('');
      setBulkRosterResults([]);
      setBulkRosterLoading(false);
      setBulkRosterDropdownOpen(false);
      setBulkRosterHighlightedIndex(-1);
      await loadRoster();
    } catch (error: unknown) {
      console.error('Failed to bulk add roster members:', error);
      showAlert(formatApiError(error, 'Failed to bulk add roster members'), 'error');
    } finally {
      setBulkRosterSubmitting(false);
    }
  };

  const handleBulkRosterSearchChange = (value: string) => {
    setBulkRosterQuery(value);
    if (bulkRosterSearchTimeout.current) {
      window.clearTimeout(bulkRosterSearchTimeout.current);
    }

    if (value.trim().length < 2) {
      setBulkRosterResults([]);
      setBulkRosterDropdownOpen(false);
      setBulkRosterLoading(false);
      return;
    }

    setBulkRosterDropdownOpen(true);
    setBulkRosterHighlightedIndex(-1);
    bulkRosterSearchTimeout.current = window.setTimeout(async () => {
      setBulkRosterLoading(true);
      try {
        const response = await get(
          '/leagues/{id}/roster/search',
          { query: value.trim() },
          { id: String(numericLeagueId) }
        );
        setBulkRosterResults(response.filter((result: MemberSearchResult) => !rosterMemberIds.has(result.id)));
      } catch (error: unknown) {
        console.error('Failed to search members:', error);
        showAlert(formatApiError(error, 'Failed to search members'), 'error');
      } finally {
        setBulkRosterLoading(false);
      }
    }, 200);
  };

  const handleSelectBulkRosterCandidate = (candidate: MemberSearchResult) => {
    setBulkRosterSelection(candidate);
    setBulkRosterQuery(candidate.name);
    setBulkRosterResults([]);
    setBulkRosterDropdownOpen(false);
  };

  const handleBulkRosterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!(bulkRosterDropdownOpen && bulkRosterResults.length > 0)) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setBulkRosterHighlightedIndex((prev) =>
          prev < bulkRosterResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setBulkRosterHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (bulkRosterHighlightedIndex >= 0 && bulkRosterHighlightedIndex < bulkRosterResults.length) {
          handleSelectBulkRosterCandidate(bulkRosterResults[bulkRosterHighlightedIndex]);
        }
        break;
      case 'Escape':
        setBulkRosterDropdownOpen(false);
        setBulkRosterHighlightedIndex(-1);
        break;
    }
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
      await post('/leagues/{id}/roster', { memberId: bulkRosterSelection.id }, { id: String(numericLeagueId) });
      await loadRoster();
      setBulkRosterUnmatched((prev) => prev.slice(1));
      setBulkRosterSelection(null);
      setBulkRosterQuery('');
      setBulkRosterResults([]);
      setBulkRosterDropdownOpen(false);
      setBulkRosterHighlightedIndex(-1);
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
    setBulkRosterQuery('');
    setBulkRosterResults([]);
    setBulkRosterDropdownOpen(false);
    setBulkRosterHighlightedIndex(-1);
  };

  useEffect(() => {
    const query = managerSearchQuery.trim();
    if (query.length < 2) {
      setManagerSearchResults([]);
      setManagerDropdownOpen(false);
      return;
    }

    setManagerDropdownOpen(true);
    setManagerHighlightedIndex(-1);
    const handle = window.setTimeout(async () => {
      setManagerSearchLoading(true);
      try {
        const response = await get(
          '/leagues/{id}/managers/search',
          { query },
          { id: String(numericLeagueId) }
        );
        setManagerSearchResults(response);
      } catch (error: unknown) {
        console.error('Failed to search managers:', error);
        showAlert(formatApiError(error, 'Failed to search members'), 'error');
      } finally {
        setManagerSearchLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [managerSearchQuery, numericLeagueId]);

  const handleAddManager = async (candidate: MemberSearchResult) => {
    try {
      await post('/leagues/{id}/managers', { memberId: candidate.id }, { id: String(numericLeagueId) });
      await loadManagers();
      setManagerSearchResults([]);
      setManagerSearchQuery('');
      setManagerDropdownOpen(false);
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

  const handleRosterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!rosterDropdownOpen || rosterSearchResults.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setRosterHighlightedIndex((prev) =>
          prev < rosterSearchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setRosterHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (rosterHighlightedIndex >= 0 && rosterHighlightedIndex < rosterSearchResults.length) {
          const selected = rosterSearchResults[rosterHighlightedIndex];
          handleAddToRoster(selected);
        }
        break;
      case 'Escape':
        setRosterDropdownOpen(false);
        setRosterHighlightedIndex(-1);
        break;
    }
  };

  const handleManagerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!managerDropdownOpen || managerSearchResults.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setManagerHighlightedIndex((prev) =>
          prev < managerSearchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setManagerHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (managerHighlightedIndex >= 0 && managerHighlightedIndex < managerSearchResults.length) {
          const selected = managerSearchResults[managerHighlightedIndex];
          handleAddManager(selected);
        }
        break;
      case 'Escape':
        setManagerDropdownOpen(false);
        setManagerHighlightedIndex(-1);
        break;
    }
  };

  const getAvailableRoleResults = (role: TeamRole) => {
    const query = roleQueries[role].trim().toLowerCase();
    const currentMemberId = roleMembers[role]?.id;
    const results = rosterSearchOptions.filter((candidate) => {
      const matches =
        query.length === 0 ||
        candidate.name.toLowerCase().includes(query) ||
        (candidate.email || '').toLowerCase().includes(query);
      if (!matches) return false;
      const assignedTeamId = rosterAssignmentsByMemberId.get(candidate.id);
      if (assignedTeamId && assignedTeamId !== editingTeam?.id) {
        return false;
      }
      if (candidate.id === currentMemberId) return true;
      return !selectedRoleMemberIds.includes(candidate.id);
    });
    return results.slice(0, 8);
  };

  const handleSelectRoleMember = (role: TeamRole, selected: MemberSearchResult) => {
    if (selectedRoleMemberIds.includes(selected.id) && roleMembers[role]?.id !== selected.id) {
      showAlert('Member is already selected for another role.', 'warning');
      return;
    }
    setRoleMembers((prev) => ({ ...prev, [role]: selected }));
    setRoleQueries((prev) => ({ ...prev, [role]: selected.name }));
    setRoleDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setRoleHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
    setFocusedRole(role);
    roleInputRefs.current[role]?.focus();
  };

  const handleClearRoleMember = (role: TeamRole) => {
    setRoleMembers((prev) => ({ ...prev, [role]: null }));
    setRoleQueries((prev) => ({ ...prev, [role]: '' }));
    setRoleDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setRoleHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
  };

  const handleRoleBlur = (role: TeamRole) => {
    setFocusedRole((current) => (current === role ? null : current));
    setRoleDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setRoleHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));

    const selected = roleMembers[role];
    const query = roleQueries[role].trim();
    if (!selected || query !== selected.name) {
      handleClearRoleMember(role);
    }
  };

  const handleRoleKeyDown = (role: TeamRole, event: React.KeyboardEvent<HTMLInputElement>) => {
    const availableResults = getAvailableRoleResults(role);
    if (!roleDropdownOpen[role] || availableResults.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setRoleHighlightedIndex((prev) => ({
          ...prev,
          [role]: prev[role] < availableResults.length - 1 ? prev[role] + 1 : prev[role],
        }));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setRoleHighlightedIndex((prev) => ({
          ...prev,
          [role]: prev[role] > 0 ? prev[role] - 1 : 0,
        }));
        break;
      case 'Enter':
        event.preventDefault();
        if (roleHighlightedIndex[role] >= 0 && roleHighlightedIndex[role] < availableResults.length) {
          handleSelectRoleMember(role, availableResults[roleHighlightedIndex[role]]);
        }
        break;
      case 'Escape':
        setRoleDropdownOpen((prev) => ({ ...prev, [role]: false }));
        setRoleHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
        break;
    }
  };

  const getAvailableDoublesResults = (role: DoublesRole) => {
    const query = doublesQueries[role].trim().toLowerCase();
    const currentMemberId = doublesMembers[role]?.id;
    const results = rosterSearchOptions.filter((candidate) => {
      const matches =
        query.length === 0 ||
        candidate.name.toLowerCase().includes(query) ||
        (candidate.email || '').toLowerCase().includes(query);
      if (!matches) return false;
      const assignedTeamId = rosterAssignmentsByMemberId.get(candidate.id);
      if (assignedTeamId && assignedTeamId !== editingTeam?.id) {
        return false;
      }
      if (candidate.id === currentMemberId) return true;
      return !selectedDoublesMemberIds.includes(candidate.id);
    });
    return results.slice(0, 8);
  };

  const handleSelectDoublesMember = (role: DoublesRole, selected: MemberSearchResult) => {
    if (selectedDoublesMemberIds.includes(selected.id) && doublesMembers[role]?.id !== selected.id) {
      showAlert('Member is already selected for another role.', 'warning');
      return;
    }
    setDoublesMembers((prev) => ({ ...prev, [role]: selected }));
    setDoublesQueries((prev) => ({ ...prev, [role]: selected.name }));
    setDoublesDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setDoublesHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
    setFocusedDoublesRole(role);
    doublesInputRefs.current[role]?.focus();
  };

  const handleClearDoublesMember = (role: DoublesRole) => {
    setDoublesMembers((prev) => ({ ...prev, [role]: null }));
    setDoublesQueries((prev) => ({ ...prev, [role]: '' }));
    setDoublesDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setDoublesHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
  };

  const handleDoublesBlur = (role: DoublesRole) => {
    setFocusedDoublesRole((current) => (current === role ? null : current));
    setDoublesDropdownOpen((prev) => ({ ...prev, [role]: false }));
    setDoublesHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));

    const selected = doublesMembers[role];
    const query = doublesQueries[role].trim();
    if (!selected || query !== selected.name) {
      handleClearDoublesMember(role);
    }
  };

  const handleDoublesKeyDown = (role: DoublesRole, event: React.KeyboardEvent<HTMLInputElement>) => {
    const availableResults = getAvailableDoublesResults(role);
    if (!doublesDropdownOpen[role] || availableResults.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setDoublesHighlightedIndex((prev) => ({
          ...prev,
          [role]: prev[role] < availableResults.length - 1 ? prev[role] + 1 : prev[role],
        }));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setDoublesHighlightedIndex((prev) => ({
          ...prev,
          [role]: prev[role] > 0 ? prev[role] - 1 : 0,
        }));
        break;
      case 'Enter':
        event.preventDefault();
        if (doublesHighlightedIndex[role] >= 0 && doublesHighlightedIndex[role] < availableResults.length) {
          handleSelectDoublesMember(role, availableResults[doublesHighlightedIndex[role]]);
        }
        break;
      case 'Escape':
        setDoublesDropdownOpen((prev) => ({ ...prev, [role]: false }));
        setDoublesHighlightedIndex((prev) => ({ ...prev, [role]: -1 }));
        break;
    }
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
      const rosterPayload =
        league.format === 'teams' ? buildTeamRoster() : buildDoublesRoster();
      if (rosterPayload === null) {
        setTeamSubmitting(false);
        return;
      }

      const payload = {
        name: teamForm.name || undefined,
        divisionId: teamForm.divisionId || undefined,
        members: rosterPayload.length > 0
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

  const sortedDivisions = useMemo(() => {
    return divisions.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [divisions]);

  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [teams]);

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">League not found.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
              {league.name}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              League details
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/leagues')}>
            Back to leagues
          </Button>
        </div>

        {leagueId && <LeagueTabs leagueId={leagueId} />}

        {normalizedTab === 'overview' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">League info</h2>
                {canEditLeagueInfo && (
                  <Button onClick={handleOpenLeagueEdit} variant="secondary">
                    Edit league info
                  </Button>
                )}
              </div>
              <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium dark:text-gray-300">Day:</span> {getDayName(league.dayOfWeek)}
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
                  {formatDateDisplay(league.startDate)} - {formatDateDisplay(league.endDate)}
                </div>
                {league.exceptions?.length > 0 && (
                  <div>
                    <span className="font-medium dark:text-gray-300">Exceptions:</span>{' '}
                    {league.exceptions.length} date(s)
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
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

        {normalizedTab === 'divisions' && (
          <div className="space-y-4">
            {canManageSetup && (
              <div className="flex justify-end">
                <Button onClick={() => handleOpenDivisionModal()}>Add division</Button>
              </div>
            )}

            {divisions.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
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
                  <div key={division.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2 dark:text-gray-100">
                          {division.name}
                        </h3>
                      </div>

                {canManageSetup && (
                  <div className="flex space-x-2">
                    <Button onClick={() => handleOpenDivisionModal(division)} variant="secondary">
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
              <div ref={teamFormRef} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
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
                    {teamFormOpen ? 'Hide team builder' : editingTeam ? 'Show edit form' : 'Add team'}
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
                  <label htmlFor="teamNameInline" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Team name
                  </label>
                  <input
                    type="text"
                    id="teamNameInline"
                    value={teamForm.name}
                    onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                  />
                </div>

                {divisions.length > 1 && (
                  <div>
                    <label htmlFor="teamDivisionInline" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Division
                    </label>
                    <select
                      id="teamDivisionInline"
                      value={teamForm.divisionId}
                      onChange={(e) => setTeamForm({ ...teamForm, divisionId: parseInt(e.target.value, 10) })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Roster</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {league.format === 'doubles'
                        ? 'Add Player 1 and Player 2.'
                        : 'Add lead, third, fourth (and optional second), then pick skip and vice.'}
                    </p>
                  </div>

                  {league.format === 'teams' ? (
                    <div className="space-y-4">
                      {teamRoles.map((role) => {
                        const availableResults = getAvailableRoleResults(role);
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
                            <div className="relative" ref={(el) => (roleDropdownRefs.current[role] = el)}>
                              <input
                                ref={(el) => (roleInputRefs.current[role] = el)}
                                type="text"
                                value={roleQueries[role]}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setRoleQueries((prev) => ({ ...prev, [role]: nextValue }));
                                  if (roleMembers[role] && nextValue !== roleMembers[role]?.name) {
                                    setRoleMembers((prev) => ({ ...prev, [role]: null }));
                                  }
                                  setRoleDropdownOpen((prev) => ({ ...prev, [role]: true }));
                                }}
                                onFocus={() => {
                                  setFocusedRole(role);
                                  setRoleDropdownOpen((prev) => ({ ...prev, [role]: true }));
                                }}
                                onBlur={() => handleRoleBlur(role)}
                                onKeyDown={(e) => handleRoleKeyDown(role, e)}
                                placeholder={`Select ${roleLabels[role].toLowerCase()}`}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                              />
                              {focusedRole === role && roleDropdownOpen[role] && (
                                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-64 overflow-y-auto">
                                  {availableResults.length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No members found</div>
                                  ) : (
                                    availableResults.map((result, index) => (
                                      <button
                                        type="button"
                                        key={result.id}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => handleSelectRoleMember(role, result)}
                                        className={`w-full text-left px-3 py-2 text-sm ${
                                          index === roleHighlightedIndex[role]
                                            ? 'bg-gray-100 dark:bg-gray-700'
                                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                        }`}
                                      >
                                        <div className="font-medium text-gray-800 dark:text-gray-200">{result.name}</div>
                                        {result.email && (
                                          <div className="text-xs text-gray-500 dark:text-gray-400">{result.email}</div>
                                        )}
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
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
                        const availableResults = getAvailableDoublesResults(role);
                        return (
                          <div key={role} className="space-y-2">
                            <label className="text-xs text-gray-500 dark:text-gray-400">
                              {roleLabels[role]}
                            </label>
                            <div className="relative" ref={(el) => (doublesDropdownRefs.current[role] = el)}>
                              <input
                                ref={(el) => (doublesInputRefs.current[role] = el)}
                                type="text"
                                value={doublesQueries[role]}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setDoublesQueries((prev) => ({ ...prev, [role]: nextValue }));
                                  if (doublesMembers[role] && nextValue !== doublesMembers[role]?.name) {
                                    setDoublesMembers((prev) => ({ ...prev, [role]: null }));
                                  }
                                  setDoublesDropdownOpen((prev) => ({ ...prev, [role]: true }));
                                }}
                                onFocus={() => {
                                  setFocusedDoublesRole(role);
                                  setDoublesDropdownOpen((prev) => ({ ...prev, [role]: true }));
                                }}
                                onBlur={() => handleDoublesBlur(role)}
                                onKeyDown={(e) => handleDoublesKeyDown(role, e)}
                                placeholder={`Select ${roleLabels[role].toLowerCase()}`}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                              />
                              {focusedDoublesRole === role &&
                                doublesDropdownOpen[role] && (
                                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-64 overflow-y-auto">
                                    {availableResults.length === 0 ? (
                                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                        No members found
                                      </div>
                                    ) : (
                                      availableResults.map((result, index) => (
                                        <button
                                          type="button"
                                          key={result.id}
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => handleSelectDoublesMember(role, result)}
                                          className={`w-full text-left px-3 py-2 text-sm ${
                                            index === doublesHighlightedIndex[role]
                                              ? 'bg-gray-100 dark:bg-gray-700'
                                              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                          }`}
                                        >
                                          <div className="font-medium text-gray-800 dark:text-gray-200">
                                            {result.name}
                                          </div>
                                          {result.email && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                              {result.email}
                                            </div>
                                          )}
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                            </div>
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
              <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
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
                      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        {division.name}
                      </h2>
                      <div className="grid gap-4">
                        {divisionTeams.map((team) => (
                          <div key={team.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1">
                                <h3 className="text-xl font-semibold mb-2 dark:text-gray-100">
                                  {team.name || 'Unnamed team'}
                                </h3>
                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                  <div>
                                    <span className="font-medium dark:text-gray-300">Roster:</span>
                                    {team.roster.length === 0 ? (
                                      <span className="ml-2">No roster set</span>
                                    ) : (
                                      <ul className="mt-2 space-y-1">
                                        {team.roster.map((member) => (
                                          <li key={member.memberId}>
                                            {member.name} — {roleLabels[member.role]}
                                            {member.isSkip ? ' (Skip)' : ''}
                                            {member.isVice ? ' (Vice)' : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {canManageSetup && (
                                <div className="flex space-x-2">
                                  <Button onClick={() => handleOpenTeamModal(team)} variant="secondary">
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
              </div>
            )}
          </div>
        )}

        {normalizedTab === 'managers' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">League managers</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Managers can edit league details except the roster.
                  </p>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total: <span className="font-medium">{managers.length}</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{entry.name}</div>
                        {entry.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{entry.email}</div>
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
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Add league manager</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Search any member to add as a league manager.
                  </p>
                </div>
              <div className="relative" ref={managerDropdownRef}>
                <input
                  ref={managerInputRef}
                  type="text"
                  value={managerSearchQuery}
                  onChange={(e) => {
                    setManagerSearchQuery(e.target.value);
                    setManagerDropdownOpen(true);
                  }}
                  onFocus={() => setManagerDropdownOpen(true)}
                  onKeyDown={handleManagerKeyDown}
                  placeholder="Search members by name or email"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                />
                {managerDropdownOpen && managerSearchQuery.trim().length >= 2 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {managerSearchLoading ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
                    ) : managerSearchResults.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No members found</div>
                    ) : (
                      managerSearchResults.map((result, index) => (
                        <button
                          type="button"
                          key={result.id}
                          onClick={() => handleAddManager(result)}
                          className={`w-full text-left px-3 py-2 text-sm ${
                            index === managerHighlightedIndex
                              ? 'bg-gray-100 dark:bg-gray-700'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          <div className="font-medium text-gray-800 dark:text-gray-200">{result.name}</div>
                          {result.email && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">{result.email}</div>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
        )}

        {normalizedTab === 'roster' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">League roster</h2>
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
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Add members to roster</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Search the full member list and add them to this league roster.
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={handleOpenBulkRosterModal}>
                    Bulk add
                  </Button>
                </div>
                <div className="relative" ref={rosterDropdownRef}>
                  <input
                    ref={rosterInputRef}
                    type="text"
                    value={rosterSearchQuery}
                    onChange={(e) => {
                      setRosterSearchQuery(e.target.value);
                      setRosterDropdownOpen(true);
                    }}
                    onFocus={() => setRosterDropdownOpen(true)}
                    onKeyDown={handleRosterKeyDown}
                    placeholder="Search members by name or email"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                  />
                  {rosterDropdownOpen && rosterSearchQuery.trim().length >= 2 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-56 overflow-y-auto">
                      {rosterSearchLoading ? (
                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
                      ) : rosterSearchResults.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No members found</div>
                      ) : (
                        rosterSearchResults.map((result, index) => (
                          <button
                            type="button"
                            key={result.id}
                            onClick={() => handleAddToRoster(result)}
                            className={`w-full text-left px-3 py-2 text-sm ${
                              index === rosterHighlightedIndex
                                ? 'bg-gray-100 dark:bg-gray-700'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            <div className="font-medium text-gray-800 dark:text-gray-200">{result.name}</div>
                            {result.email && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">{result.email}</div>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{entry.name}</div>
                        {entry.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{entry.email}</div>
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
      </div>

      {canManageSetup && (
        <Modal
          isOpen={divisionModalOpen}
          onClose={handleCloseDivisionModal}
          title={editingDivision ? 'Edit division' : 'Add division'}
        >
          <form onSubmit={handleDivisionSubmit} className="space-y-4">
          <div>
            <label htmlFor="divisionName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Division name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="divisionName"
              value={divisionForm.name}
              onChange={(e) => setDivisionForm({ ...divisionForm, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
              <label htmlFor="leagueName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                League name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="leagueName"
                value={leagueForm.name}
                onChange={(e) => setLeagueForm({ ...leagueForm, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="leagueDayOfWeek" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Day of week <span className="text-red-500">*</span>
              </label>
              <select
                id="leagueDayOfWeek"
                value={leagueForm.dayOfWeek}
                onChange={(e) => setLeagueForm({ ...leagueForm, dayOfWeek: parseInt(e.target.value, 10) })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Draw times <span className="text-red-500">*</span>
              </label>
              {leagueForm.drawTimes.map((time, index) => (
                <div key={`draw-${index}`} className="flex items-center space-x-2 mb-2">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => updateDrawTime(index, e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
              <label htmlFor="leagueStartDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Season start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="leagueStartDate"
                value={leagueForm.startDate}
                onChange={(e) => setLeagueForm({ ...leagueForm, startDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="leagueEndDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Season end date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="leagueEndDate"
                value={leagueForm.endDate}
                onChange={(e) => setLeagueForm({ ...leagueForm, endDate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="leagueFormat" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Format <span className="text-red-500">*</span>
              </label>
              <select
                id="leagueFormat"
                value={leagueForm.format}
                onChange={(e) => setLeagueForm({ ...leagueForm, format: e.target.value as League['format'] })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
                required
              >
                <option value="teams">Teams (4 players)</option>
                <option value="doubles">Doubles (2 players)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Exception dates (no games)
              </label>
              <div className="space-y-2">
                {leagueForm.exceptions.length > 0 && (
                  <div className="space-y-1">
                    {leagueForm.exceptions.map((dateStr) => (
                      <div key={dateStr} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">{formatDateDisplay(dateStr)}</span>
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
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md focus:ring-2 focus:ring-primary-teal focus:border-transparent"
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
                    <Button type="button" variant="secondary" onClick={() => setShowExceptionPicker(false)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {!showExceptionPicker && availableExceptionDates.length > 0 && (
                  <Button type="button" variant="secondary" onClick={() => setShowExceptionPicker(true)}>
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
        title={selectedTeam?.name || 'Team roster'}
      >
        {selectedTeam ? (
          selectedTeam.roster.length === 0 ? (
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
          )
        ) : null}
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
              <label htmlFor="bulkRosterNames" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Paste names (one per line)
              </label>
              <textarea
                id="bulkRosterNames"
                value={bulkRosterNames}
                onChange={(e) => setBulkRosterNames(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                placeholder="Jane Doe&#10;John Smith"
              />
            </div>
          )}

          {bulkRosterResult && (
            <div className="space-y-3">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Added: <span className="font-medium">{bulkRosterResult.addedCount}</span> · Already on roster:{' '}
                <span className="font-medium">{bulkRosterResult.alreadyOnRosterCount}</span> · Unmatched:{' '}
                <span className="font-medium">{bulkRosterUnmatched.length}</span>
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
                  <div className="text-sm text-gray-500 dark:text-gray-400">All unmatched names resolved.</div>
                ) : (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{bulkRosterUnmatched[0].name}</span>
                    </div>
                    {bulkRosterUnmatched[0].candidates.filter((candidate) => !rosterMemberIds.has(candidate.id))
                      .length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {bulkRosterUnmatched[0].candidates
                          .filter((candidate) => !rosterMemberIds.has(candidate.id))
                          .map((candidate) => (
                            <Button
                              key={candidate.id}
                              type="button"
                              variant={bulkRosterSelection?.id === candidate.id ? 'primary' : 'secondary'}
                              onClick={() => handleSelectBulkRosterCandidate(candidate)}
                            >
                              {candidate.name}
                            </Button>
                          ))}
                      </div>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={bulkRosterQuery}
                        onChange={(e) => handleBulkRosterSearchChange(e.target.value)}
                        onFocus={() => setBulkRosterDropdownOpen(true)}
                        onKeyDown={handleBulkRosterKeyDown}
                        placeholder="Search members by name or email"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md"
                      />
                      {bulkRosterDropdownOpen && bulkRosterQuery.trim().length >= 2 && (
                        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-56 overflow-y-auto">
                          {bulkRosterLoading ? (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
                          ) : bulkRosterResults.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No members found</div>
                          ) : (
                            bulkRosterResults.map((result, resultIndex) => (
                              <button
                                type="button"
                                key={result.id}
                                onClick={() => handleSelectBulkRosterCandidate(result)}
                                className={`w-full text-left px-3 py-2 text-sm ${
                                  resultIndex === bulkRosterHighlightedIndex
                                    ? 'bg-gray-100 dark:bg-gray-700'
                                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                              >
                                <div className="font-medium text-gray-800 dark:text-gray-200">{result.name}</div>
                                {result.email && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{result.email}</div>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
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
                <Button type="button" onClick={handleBulkRosterResolve} disabled={bulkRosterSubmitting || bulkRosterUnmatched.length === 0}>
                  Resolve
                </Button>
                <Button type="button" variant="secondary" onClick={handleBulkRosterSkip} disabled={bulkRosterUnmatched.length === 0}>
                  Skip
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseBulkRosterModal} className="ml-auto">
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={bulkRosterSubmitting} className="flex-1">
                  {bulkRosterSubmitting ? 'Processing...' : 'Match names'}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCloseBulkRosterModal} className="flex-1">
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
