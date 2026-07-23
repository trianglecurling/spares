import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { del, get, patch, post, put } from '../../api/client';
import api, { formatApiError } from '../../utils/api';
import AppStateCard from '../../components/AppStateCard';
import InlineStateMessage from '../../components/InlineStateMessage';
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
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import { memberHasScope } from '../../utils/permissions';
import {
  defaultDrawDurationMinutes,
  extraDrawKey,
  type LeagueExtraDraw,
  type LeaguePlayFormat,
} from '../../utils/leagueSchedule';

const WEEKDAY_SELECT_OPTIONS: ChoiceOption<number>[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
].map((label, index) => ({ value: index, label }));

const LEAGUE_FORMAT_SELECT_OPTIONS: ChoiceOption<LeaguePlayFormat>[] = [
  { value: 'teams', label: 'Teams (4 players)' },
  { value: 'doubles', label: 'Doubles (2 players)' },
  { value: 'instructional', label: 'Instructional' },
];

function isTeamsLikeLeagueFormat(format: LeaguePlayFormat): boolean {
  return format === 'teams' || format === 'instructional';
}

function leagueFormatDisplayLabel(format: LeaguePlayFormat): string {
  switch (format) {
    case 'teams':
      return 'Teams';
    case 'doubles':
      return 'Doubles';
    case 'instructional':
      return 'Instructional';
    default:
      return format;
  }
}

const LEAGUE_REGISTRATION_FLAG_OPTIONS: ChoiceOption<string>[] = [
  { value: 'requiresClubMembership', label: 'Requires club membership' },
  { value: 'allowsSabbatical', label: 'Allows sabbaticals' },
];

function leagueRegistrationFlagKeys(form: {
  requiresClubMembership: boolean;
  allowsSabbatical: boolean;
}): string[] {
  const keys: string[] = [];
  if (form.requiresClubMembership) keys.push('requiresClubMembership');
  if (form.allowsSabbatical) keys.push('allowsSabbatical');
  return keys;
}

type WaitlistOption = {
  id: number;
  name: string;
  activeEntryCount: number;
  attachedLeagues: Array<{ id: number; name: string; sessionName: string | null }>;
};

function leagueScheduleFormat(format: LeaguePlayFormat): 'teams' | 'doubles' {
  return format === 'doubles' ? 'doubles' : 'teams';
}

const LEAGUE_TYPE_SELECT_OPTIONS: ChoiceOption<'standard' | 'bring_your_own_team'>[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'bring_your_own_team', label: 'Bring your own team' },
];

const CAPACITY_TYPE_SELECT_OPTIONS: ChoiceOption<'individual' | 'team'>[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'team', label: 'Team' },
];

const TEAM_FORMATION_SELECT_OPTIONS: ChoiceOption<'coordinator' | 'skips_draft'>[] = [
  { value: 'coordinator', label: 'Teams formed by coordinator' },
  { value: 'skips_draft', label: "Teams formed by skips' draft" },
];

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: LeaguePlayFormat;
  startDate: string;
  endDate: string;
  sessionId: number | null;
  leagueType: 'standard' | 'bring_your_own_team';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  registrationFeeMinor: number;
  registrationFeeOverrideMinor: number | null;
  requiresClubMembership: boolean;
  minExperienceYears: number | null;
  maxExperienceYears?: number | null;
  minAge: number | null;
  maxAge: number | null;
  firstDayOfPlay: string | null;
  lastDayOfPlay: string | null;
  allowsWaitlist: boolean;
  waitlistId?: number | null;
  isPlayInBased?: boolean;
  allowsSabbatical: boolean;
  allowsDropIns?: boolean;
  dropInFeeMinor?: number | null;
  predecessorLeagueId: number | null;
  successorLeagueId: number | null;
  publicNotes?: string | null;
  teamFormation?: 'coordinator' | 'skips_draft';
  drawDurationMinutes: number;
  drawTimes: string[];
  exceptions: string[];
  extraDraws: LeagueExtraDraw[];
}

interface RegistrationSession {
  id: number;
  name: string;
  seasonId: number;
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

interface LeagueSabbaticalMember {
  id: number;
  memberId: number;
  name: string;
  email: string | null;
  status: 'active' | 'returning' | 'staff_overridden';
  firstSabbaticalStartDate: string;
  staffOverride: boolean;
  staffOverrideReason: string | null;
  sourceRegistrationId: number | null;
  createdAt: string | null;
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
  'configuration',
  'schedule',
  'standings',
  'sheets',
  'schedule-generation',
  'teams',
  'roster',
  'divisions',
  'managers',
  'sabbaticals',
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
  const leagueConfigDrawTimeId = useId();
  const leagueRegistrationFlagsLegendId = useId();
  const { leagueId, tab } = useParams();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [allLeagues, setAllLeagues] = useState<League[]>([]);
  const [registrationSessions, setRegistrationSessions] = useState<RegistrationSession[]>([]);
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

  const [leagueForm, setLeagueForm] = useState({
    name: '',
    dayOfWeek: 0,
    format: 'teams' as LeaguePlayFormat,
    startDate: '',
    endDate: '',
    drawDurationMinutes: defaultDrawDurationMinutes('teams'),
    drawTimes: [''],
    exceptions: [] as string[],
    extraDraws: [] as LeagueExtraDraw[],
    sessionId: 0,
    leagueType: 'standard' as 'standard' | 'bring_your_own_team',
    capacityType: 'individual' as 'individual' | 'team',
    capacityValue: 0,
    overrideLeagueFee: false,
    leagueFeeOverrideDollars: '' as number | '',
    requiresClubMembership: true,
    minExperienceYears: '' as number | '',
    maxExperienceYears: '' as number | '',
    minAge: '' as number | '',
    maxAge: '' as number | '',
    allowsSabbatical: true,
    allowsDropIns: false,
    dropInFeeDollars: '' as number | '',
    isPlayInBased: false,
    predecessorLeagueId: 0,
    teamFormation: 'coordinator' as 'coordinator' | 'skips_draft',
    publicNotes: '',
  });
  const [showExceptionPicker, setShowExceptionPicker] = useState(false);
  const [exceptionToAdd, setExceptionToAdd] = useState('');
  const [extraDrawToAdd, setExtraDrawToAdd] = useState<LeagueExtraDraw>({ date: '', time: '' });
  const [leagueSubmitting, setLeagueSubmitting] = useState(false);
  const [clubDefaultLeagueFeeDollars, setClubDefaultLeagueFeeDollars] = useState<number | null>(null);
  const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);
  const [waitlistOptions, setWaitlistOptions] = useState<WaitlistOption[]>([]);
  const [attachWaitlistId, setAttachWaitlistId] = useState<number | null>(null);
  const [newWaitlistName, setNewWaitlistName] = useState('');
  const [waitlistActionLoading, setWaitlistActionLoading] = useState(false);

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
  const [sabbaticalMembers, setSabbaticalMembers] = useState<LeagueSabbaticalMember[]>([]);
  const [sabbaticalAddReason, setSabbaticalAddReason] = useState('');
  const [sabbaticalAddSubmitting, setSabbaticalAddSubmitting] = useState(false);
  const sabbaticalAddReasonId = useId();

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
  const leagueAllowsDropIns = Boolean(league?.allowsDropIns);
  const unassignedRosterMembers = useMemo(
    () => rosterMembers.filter((member) => !member.assignedTeamId),
    [rosterMembers]
  );
  const rosterMemberIds = useMemo(() => {
    return new Set(rosterMembers.map((member) => member.memberId));
  }, [rosterMembers]);
  const sabbaticalMemberIds = useMemo(() => {
    return new Set(sabbaticalMembers.map((entry) => entry.memberId));
  }, [sabbaticalMembers]);
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
  /** Season structure, draw pattern, and registration-linked fields — club league admins only, not per-league managers. */
  const canEditLeagueConfiguration = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin,
    [leagueAccess]
  );

  useEffect(() => {
    if (!canEditLeagueConfiguration) return;
    get('/registration-config/sessions')
      .then((response) => setRegistrationSessions(response as RegistrationSession[]))
      .catch(() => {});
  }, [canEditLeagueConfiguration]);

  useEffect(() => {
    if (!canEditLeagueConfiguration || normalizedTab !== 'configuration') return;
    get('/registration-config/prices')
      .then((row) => setClubDefaultLeagueFeeDollars((row as { leagueFeeDollars: number }).leagueFeeDollars))
      .catch(() => setClubDefaultLeagueFeeDollars(null));
  }, [canEditLeagueConfiguration, normalizedTab]);

  const canManageSetup = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin || leagueAccess.isLeagueManagerForLeague,
    [leagueAccess]
  );
  const canEditManagers = useMemo(
    () => leagueAccess.hasGlobalLeagueAdmin || leagueAccess.isLeagueManagerForLeague,
    [leagueAccess]
  );
  const canManageSabbaticals = useMemo(
    () => Boolean(member && memberHasScope(member, 'members.manage')),
    [member]
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

  const loadSabbaticals = async () => {
    const sabbaticalsResponse = await get('/leagues/{id}/sabbaticals', undefined, {
      id: String(numericLeagueId),
    });
    setSabbaticalMembers(sabbaticalsResponse);
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
      setAllLeagues(leaguesResponse);
      const currentLeague = leaguesResponse.find((l: League) => l.id === numericLeagueId);
      if (!currentLeague) {
        showAlert('League not found', 'error');
        navigate('/leagues');
        return;
      }
      setLeague(currentLeague);

      const [divisionsResponse, teamsResponse, rosterResponse, managersResponse, sabbaticalsResponse, settingsResponse] =
        await Promise.all([
          get('/leagues/{id}/divisions', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/teams', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/roster', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/managers', undefined, { id: String(numericLeagueId) }),
          get('/leagues/{id}/sabbaticals', undefined, { id: String(numericLeagueId) }),
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
      setSabbaticalMembers(sabbaticalsResponse);
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
    if (leagueAllowsDropIns) {
      showAlert('Drop-in leagues keep a league roster only and cannot have teams.', 'warning');
      return;
    }
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
      if (isTeamsLikeLeagueFormat(league.format)) {
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
      if (isTeamsLikeLeagueFormat(league.format)) {
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

  useEffect(() => {
    if (normalizedTab !== 'configuration' || !league) return;
    setLeagueForm({
      name: league.name,
      dayOfWeek: league.dayOfWeek,
      format: league.format,
      startDate: league.startDate,
      endDate: league.endDate,
      drawDurationMinutes:
        league.drawDurationMinutes ?? defaultDrawDurationMinutes(league.format),
      drawTimes: league.drawTimes.length ? league.drawTimes : [''],
      exceptions: league.exceptions || [],
      extraDraws: (league.extraDraws || []).map((d) => ({
        date: d.date,
        time: d.time.slice(0, 5),
      })),
      sessionId: league.sessionId ?? 0,
      leagueType: league.leagueType,
      capacityType: league.capacityType,
      capacityValue: league.capacityValue,
      overrideLeagueFee:
        league.registrationFeeOverrideMinor !== null && league.registrationFeeOverrideMinor !== undefined,
      leagueFeeOverrideDollars:
        league.registrationFeeOverrideMinor !== null && league.registrationFeeOverrideMinor !== undefined
          ? league.registrationFeeOverrideMinor / 100
          : '',
      requiresClubMembership: league.requiresClubMembership,
      minExperienceYears: league.minExperienceYears == null || league.minExperienceYears <= 0 ? '' : league.minExperienceYears,
      maxExperienceYears: league.maxExperienceYears == null || league.maxExperienceYears <= 0 ? '' : league.maxExperienceYears,
      minAge: league.minAge == null || league.minAge <= 0 ? '' : league.minAge,
      maxAge: league.maxAge == null || league.maxAge <= 0 ? '' : league.maxAge,
      allowsSabbatical: league.allowsSabbatical,
      allowsDropIns: league.allowsDropIns ?? false,
      dropInFeeDollars:
        league.dropInFeeMinor != null && league.dropInFeeMinor !== undefined
          ? league.dropInFeeMinor / 100
          : '',
      isPlayInBased: league.isPlayInBased ?? false,
      predecessorLeagueId: league.predecessorLeagueId ?? 0,
      teamFormation: league.teamFormation ?? 'coordinator',
      publicNotes: league.publicNotes ?? '',
    });
    setShowExceptionPicker(false);
    setExceptionToAdd('');
    setExtraDrawToAdd({ date: '', time: '' });
  }, [normalizedTab, league]);

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
  }, [leagueForm.startDate, leagueForm.endDate, leagueForm.dayOfWeek]);

  useEffect(() => {
    const shouldLoadOptions =
      canManageSetup &&
      (waitlistModalOpen || (normalizedTab === 'configuration' && Boolean(league?.waitlistId)));
    if (!shouldLoadOptions) return;
    let canceled = false;
    void api
      .get<WaitlistOption[]>('/leagues/waitlist-options')
      .then((response) => {
        if (!canceled) setWaitlistOptions(response.data);
      })
      .catch(() => {
        if (!canceled) setWaitlistOptions([]);
      });
    return () => {
      canceled = true;
    };
  }, [waitlistModalOpen, canManageSetup, normalizedTab, league?.waitlistId]);

  const attachedWaitlistSummary = useMemo(() => {
    if (!league?.waitlistId) return null;
    const option = waitlistOptions.find((row) => row.id === league.waitlistId);
    return option?.name ?? `Waitlist #${league.waitlistId}`;
  }, [league?.waitlistId, waitlistOptions]);

  const closeWaitlistModal = () => {
    setWaitlistModalOpen(false);
    setAttachWaitlistId(null);
    setNewWaitlistName('');
  };

  const refreshLeague = async () => {
    const leaguesResponse = await get('/leagues');
    const updated = leaguesResponse.find((row) => row.id === numericLeagueId);
    if (!updated) return;
    setLeague(updated);
    setAllLeagues(leaguesResponse);
  };

  const handleCreateWaitlist = async () => {
    if (!league) return;
    setWaitlistActionLoading(true);
    try {
      const defaultName = newWaitlistName.trim() || `${league.name} waitlist`;
      await api.post(`/leagues/${numericLeagueId}/waitlist`, { mode: 'create', name: defaultName });
      await refreshLeague();
      closeWaitlistModal();
      showAlert('Waitlist created and attached.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to create waitlist'), 'error');
    } finally {
      setWaitlistActionLoading(false);
    }
  };

  const handleAttachWaitlist = async () => {
    if (attachWaitlistId == null) {
      showAlert('Select a waitlist to attach.', 'warning');
      return;
    }
    setWaitlistActionLoading(true);
    try {
      await api.post(`/leagues/${numericLeagueId}/waitlist`, { mode: 'attach', waitlistId: attachWaitlistId });
      await refreshLeague();
      closeWaitlistModal();
      showAlert('Waitlist attached.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to attach waitlist'), 'error');
    } finally {
      setWaitlistActionLoading(false);
    }
  };

  const handleDetachWaitlist = async () => {
    const confirmed = await confirm({
      title: 'Detach waitlist?',
      message:
        'This removes the waitlist from this league only. The waitlist and its queue entries are not deleted.',
      variant: 'danger',
      confirmText: 'Detach waitlist',
    });
    if (!confirmed) return;

    setWaitlistActionLoading(true);
    try {
      await api.delete(`/leagues/${numericLeagueId}/waitlist`);
      await refreshLeague();
      showAlert('Waitlist detached from this league.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to detach waitlist'), 'error');
    } finally {
      setWaitlistActionLoading(false);
    }
  };

  const handleLeagueSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!league) return;

    setLeagueSubmitting(true);
    try {
      if (
        leagueForm.overrideLeagueFee &&
        (leagueForm.leagueFeeOverrideDollars === '' ||
          !Number.isFinite(Number(leagueForm.leagueFeeOverrideDollars)))
      ) {
        showAlert('Enter a league fee amount when override is enabled.', 'warning');
        return;
      }

      if (
        leagueForm.allowsDropIns &&
        (leagueForm.dropInFeeDollars === '' || !Number.isFinite(Number(leagueForm.dropInFeeDollars)))
      ) {
        showAlert('Enter a drop-in fee when drop-ins are allowed.', 'warning');
        return;
      }

      if (leagueForm.allowsDropIns && teams.length > 0) {
        showAlert('Remove all teams before allowing drop-ins.', 'warning');
        return;
      }

      const uniqueExceptions = Array.from(new Set(leagueForm.exceptions)).sort();
      const uniqueExtraDraws = Array.from(
        new Map(
          leagueForm.extraDraws
            .filter((d) => d.date && d.time)
            .map((d) => [extraDrawKey(d), { date: d.date, time: d.time.slice(0, 5) }])
        ).values()
      ).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
      const payload = {
        name: leagueForm.name,
        dayOfWeek: leagueForm.dayOfWeek,
        format: leagueForm.format,
        startDate: leagueForm.startDate,
        endDate: leagueForm.endDate,
        drawDurationMinutes: leagueForm.drawDurationMinutes,
        drawTimes: leagueForm.drawTimes.filter((t) => t.trim() !== ''),
        exceptions: uniqueExceptions,
        extraDraws: uniqueExtraDraws,
      };
      const registrationPayload = {
        ...payload,
        sessionId: leagueForm.sessionId || null,
        leagueType: leagueForm.leagueType,
        capacityType: leagueForm.capacityType,
        capacityValue: leagueForm.capacityValue,
        registrationFeeOverrideMinor: leagueForm.overrideLeagueFee
          ? Math.round(Number(leagueForm.leagueFeeOverrideDollars) * 100)
          : null,
        requiresClubMembership: leagueForm.requiresClubMembership,
        minExperienceYears:
          leagueForm.minExperienceYears === '' || leagueForm.minExperienceYears <= 0 ? null : leagueForm.minExperienceYears,
        maxExperienceYears:
          leagueForm.maxExperienceYears === '' || leagueForm.maxExperienceYears <= 0 ? null : leagueForm.maxExperienceYears,
        minAge: leagueForm.minAge === '' || leagueForm.minAge <= 0 ? null : leagueForm.minAge,
        maxAge: leagueForm.maxAge === '' || leagueForm.maxAge <= 0 ? null : leagueForm.maxAge,
        firstDayOfPlay: null,
        lastDayOfPlay: null,
        allowsSabbatical: leagueForm.allowsSabbatical,
        allowsDropIns: leagueForm.allowsDropIns,
        dropInFeeMinor: leagueForm.allowsDropIns
          ? Math.round(Number(leagueForm.dropInFeeDollars) * 100)
          : null,
        isPlayInBased: leagueForm.isPlayInBased,
        predecessorLeagueId: leagueForm.predecessorLeagueId || null,
        teamFormation: leagueForm.teamFormation,
        publicNotes: leagueForm.publicNotes.trim() || null,
      };

      const updated = await patch('/leagues/{id}', registrationPayload, { id: String(numericLeagueId) });
      setLeague(updated as League);
      setAllLeagues((prev) => prev.map((l) => (l.id === numericLeagueId ? { ...l, ...(updated as League) } : l)));
      showAlert('League configuration saved.', 'success');
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

  const handleAddSabbatical = async (candidate: MemberSearchResult) => {
    const reason = sabbaticalAddReason.trim();
    if (!reason) {
      showAlert('Enter a reason before adding a sabbatical.', 'warning');
      return;
    }
    setSabbaticalAddSubmitting(true);
    try {
      await post(
        '/leagues/{id}/sabbaticals',
        { memberId: candidate.id, reason },
        { id: String(numericLeagueId) }
      );
      setSabbaticalAddReason('');
      await loadSabbaticals();
      showAlert(`${candidate.name} added to sabbatical.`, 'success');
    } catch (error: unknown) {
      console.error('Failed to add sabbatical:', error);
      showAlert(formatApiError(error, 'Failed to add sabbatical'), 'error');
    } finally {
      setSabbaticalAddSubmitting(false);
    }
  };

  const handleRemoveSabbatical = async (entry: LeagueSabbaticalMember) => {
    const confirmed = await confirm({
      title: 'Remove sabbatical',
      message: `Remove ${entry.name} from the sabbatical list for this league? Their protected spot will be released.`,
      confirmText: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await del(
        '/leagues/{id}/sabbaticals/{memberId}',
        { reason: 'Removed by staff from league sabbatical list' },
        {
          id: String(numericLeagueId),
          memberId: String(entry.memberId),
        }
      );
      await loadSabbaticals();
      showAlert(`${entry.name} removed from sabbatical.`, 'success');
    } catch (error: unknown) {
      console.error('Failed to remove sabbatical:', error);
      showAlert(formatApiError(error, 'Failed to remove sabbatical'), 'error');
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
    if (!league || !isTeamsLikeLeagueFormat(league.format)) {
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
      const rosterPayload = isTeamsLikeLeagueFormat(league.format) ? buildTeamRoster() : buildDoublesRoster();
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
      <>
        <AppPage>
          <AppStateCard title="Loading league..." />
        </AppPage>
      </>
    );
  }

  if (!league) {
    return (
      <>
        <AppPage>
          <AppStateCard title="League not found." />
        </AppPage>
      </>
    );
  }

  return (
    <>
      <AppPage>
        <AppPageHeader
          title={league.name}
          description="League details"
          actions={<BackButton label="Leagues" onClick={() => navigate('/leagues')} />}
        />

        {leagueId && (
          <LeagueTabs
            leagueId={leagueId}
            showConfigurationTab={canEditLeagueConfiguration}
            showSheetsTab={canManageSetup}
            showMaintenanceTab={canManageSetup}
            hideTeamsAndDivisionsTabs={leagueAllowsDropIns}
            showSabbaticalsTab={Boolean(league?.allowsSabbatical)}
          />
        )}

        {normalizedTab === 'overview' && (
          <div className="space-y-6">
            <div className="app-card space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h2 className="app-section-title">
                  League info
                </h2>
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
                  <span className="font-medium dark:text-gray-300">Draw duration:</span>{' '}
                  {league.drawDurationMinutes ?? defaultDrawDurationMinutes(league.format)} minutes
                </div>
                <div>
                  <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                  {leagueFormatDisplayLabel(league.format)}
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
                {league.extraDraws?.length > 0 && (
                  <div>
                    <span className="font-medium dark:text-gray-300">One-off draws:</span>{' '}
                    <span className="text-gray-600 dark:text-gray-400">
                      {league.extraDraws
                        .map((d) => `${formatDateDisplay(d.date)} · ${formatTime(d.time)}`)
                        .join(', ')}
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
                {leagueAllowsDropIns ? (
                  <h2 className="app-section-title">League roster</h2>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(`/leagues/${leagueId}/teams`)}
                    className="text-left text-lg font-semibold text-primary-teal hover:underline"
                  >
                    Teams
                  </button>
                )}
              </div>

              {leagueAllowsDropIns ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  This drop-in league keeps permanent members on the{' '}
                  <Link to={`/leagues/${leagueId}/roster`} className="font-medium text-primary-teal hover:underline">
                    league roster
                  </Link>{' '}
                  and does not use teams.
                </p>
              ) : teams.length === 0 ? (
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

        {normalizedTab === 'configuration' &&
          (canEditLeagueConfiguration ? (
            <div className="app-card space-y-6 max-w-3xl">
              <div>
                <h2 className="app-section-title">League configuration</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Season schedule pattern, registration catalog settings, and league continuity.
                  Day-to-day schedules, teams, and results are managed from the other tabs.
                </p>
              </div>

              <form onSubmit={handleLeagueSubmit} className="space-y-4">
                <div>
                  <label htmlFor="leagueName" className="app-label">
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
                  <label htmlFor="leagueDayOfWeek" className="app-label">
                    Day of week <span className="text-red-500">*</span>
                  </label>
                  <ChoiceInput<number>
                    inputId="leagueDayOfWeek"
                    options={WEEKDAY_SELECT_OPTIONS}
                    value={leagueForm.dayOfWeek}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next))
                        setLeagueForm({ ...leagueForm, dayOfWeek: next });
                    }}
                    listboxLabel="Day of week"
                    required
                  />
                </div>

                <div>
                  <p id={`${leagueConfigDrawTimeId}-legend`} className="app-label">
                    Draw times <span className="text-red-500">*</span>
                  </p>
                  {leagueForm.drawTimes.map((time, index) => (
                    <div key={`draw-${index}`} className="flex items-center space-x-2 mb-2">
                      <label htmlFor={`${leagueConfigDrawTimeId}-${index}`} className="sr-only">
                        Draw time {index + 1}
                      </label>
                      <input
                        type="time"
                        id={`${leagueConfigDrawTimeId}-${index}`}
                        aria-labelledby={`${leagueConfigDrawTimeId}-legend`}
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
                  <label htmlFor="leagueDrawDurationMinutes" className="app-label">
                    Draw duration (minutes) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    id="leagueDrawDurationMinutes"
                    min={15}
                    max={1440}
                    step={15}
                    value={leagueForm.drawDurationMinutes}
                    onChange={(e) =>
                      setLeagueForm({
                        ...leagueForm,
                        drawDurationMinutes:
                          Number.parseInt(e.target.value, 10) ||
                          defaultDrawDurationMinutes(leagueForm.format),
                      })
                    }
                    className="app-input"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="leagueStartDate" className="app-label">
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
                  <label htmlFor="leagueEndDate" className="app-label">
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
                  <label className="app-label">Exception dates (no games)</label>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <ChoiceInput<string>
                          ariaLabel="Exception date to add"
                          options={availableExceptionDates.map((date) => ({
                            value: date,
                            label: formatDateDisplay(date),
                          }))}
                          value={exceptionToAdd || null}
                          onChange={(next) =>
                            setExceptionToAdd(next == null || Array.isArray(next) ? '' : next)
                          }
                          placeholder="Select date"
                          listboxLabel="Exception date"
                          inputClassName="app-input flex-1 min-w-[12rem]"
                        />
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

                <div>
                  <label className="app-label">One-off draws (additional date and time)</label>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor="leagueExtraDrawDate" className="sr-only">
                        One-off draw date
                      </label>
                      <input
                        type="date"
                        id="leagueExtraDrawDate"
                        value={extraDrawToAdd.date}
                        onChange={(e) =>
                          setExtraDrawToAdd((prev) => ({ ...prev, date: e.target.value }))
                        }
                        className="app-input"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="leagueExtraDrawTime" className="sr-only">
                        One-off draw time
                      </label>
                      <input
                        type="time"
                        id="leagueExtraDrawTime"
                        value={extraDrawToAdd.time}
                        onChange={(e) =>
                          setExtraDrawToAdd((prev) => ({ ...prev, time: e.target.value }))
                        }
                        className="app-input"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!extraDrawToAdd.date || !extraDrawToAdd.time}
                      onClick={() => {
                        const date = extraDrawToAdd.date;
                        const time = extraDrawToAdd.time.slice(0, 5);
                        if (!date || !time) return;
                        const key = extraDrawKey({ date, time });
                        setLeagueForm((prev) => {
                          if (prev.extraDraws.some((d) => extraDrawKey(d) === key)) return prev;
                          return {
                            ...prev,
                            extraDraws: [...prev.extraDraws, { date, time }].sort(
                              (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
                            ),
                          };
                        });
                        setExtraDrawToAdd({ date: '', time: '' });
                      }}
                    >
                      Add one-off draw
                    </Button>
                  </div>
                  {leagueForm.extraDraws.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {leagueForm.extraDraws.map((draw) => (
                        <div
                          key={extraDrawKey(draw)}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-gray-700 dark:text-gray-300">
                            {formatDateDisplay(draw.date)} · {formatTime(draw.time)}
                          </span>
                          <button
                            type="button"
                            className="text-red-600 hover:text-red-800"
                            onClick={() => {
                              const key = extraDrawKey(draw);
                              setLeagueForm((prev) => ({
                                ...prev,
                                extraDraws: prev.extraDraws.filter((d) => extraDrawKey(d) !== key),
                              }));
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="leagueFormat" className="app-label">
                    Format <span className="text-red-500">*</span>
                  </label>
                  <ChoiceInput<LeaguePlayFormat>
                    inputId="leagueFormat"
                    options={LEAGUE_FORMAT_SELECT_OPTIONS}
                    value={leagueForm.format}
                    onChange={(next) => {
                      if (next == null || Array.isArray(next)) return;
                      setLeagueForm((prev) => {
                        const prevDefault = defaultDrawDurationMinutes(prev.format);
                        const nextDefault = defaultDrawDurationMinutes(next);
                        return {
                          ...prev,
                          format: next,
                          isPlayInBased: next === 'instructional' ? false : prev.isPlayInBased,
                          drawDurationMinutes:
                            prev.drawDurationMinutes === prevDefault
                              ? nextDefault
                              : prev.drawDurationMinutes,
                        };
                      });
                    }}
                    listboxLabel="League format"
                    required
                  />
                </div>

                <div className="space-y-3">
                  <FormCheckbox
                    label="Allows drop-ins"
                    checked={leagueForm.allowsDropIns}
                    helperText={
                      teams.length > 0
                        ? 'Remove all teams before enabling drop-ins. Drop-in leagues keep a league roster only.'
                        : 'Drop-in leagues keep a league roster only and do not use teams.'
                    }
                    onChange={(checked) =>
                      setLeagueForm((prev) => ({
                        ...prev,
                        allowsDropIns: checked,
                        dropInFeeDollars: checked
                          ? prev.dropInFeeDollars === '' && league?.dropInFeeMinor != null
                            ? league.dropInFeeMinor / 100
                            : prev.dropInFeeDollars
                          : '',
                      }))
                    }
                  />
                  {leagueForm.allowsDropIns ? (
                    <LeagueConfigurationOptionalDollarInput
                      id="leagueCfgDropInFee"
                      label="Drop-in fee"
                      description="Fee charged per drop-in session."
                      value={leagueForm.dropInFeeDollars}
                      onChange={(dropInFeeDollars) =>
                        setLeagueForm({ ...leagueForm, dropInFeeDollars })
                      }
                    />
                  ) : null}
                </div>

                <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Registration settings
                  </h3>

                  <div>
                    <label htmlFor="leagueCfgRegistrationSession" className="app-label">
                      Session assignment
                    </label>
                    <ChoiceInput<number>
                      inputId="leagueCfgRegistrationSession"
                      options={[
                        { value: 0, label: 'Unassigned' },
                        ...registrationSessions.map((session) => ({
                          value: session.id,
                          label: session.name,
                        })),
                      ]}
                      value={leagueForm.sessionId}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next)) {
                          setLeagueForm({ ...leagueForm, sessionId: next });
                        }
                      }}
                      listboxLabel="Registration session"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="leagueCfgLeagueType" className="app-label">
                        League type
                      </label>
                      <ChoiceInput<'standard' | 'bring_your_own_team'>
                        inputId="leagueCfgLeagueType"
                        options={LEAGUE_TYPE_SELECT_OPTIONS}
                        value={leagueForm.leagueType}
                        onChange={(next) => {
                          if (next != null && !Array.isArray(next)) {
                            setLeagueForm({
                              ...leagueForm,
                              leagueType: next,
                              ...(next === 'bring_your_own_team'
                                ? {
                                    capacityType: 'team' as const,
                                    allowsSabbatical: false,
                                  }
                                : { capacityType: 'individual' as const }),
                            });
                          }
                        }}
                        listboxLabel="League type"
                      />
                    </div>

                    {leagueForm.leagueType === 'standard' ? (
                      <div>
                        <label htmlFor="leagueCfgTeamFormation" className="app-label">
                          Team formation
                        </label>
                        <ChoiceInput<'coordinator' | 'skips_draft'>
                          inputId="leagueCfgTeamFormation"
                          options={TEAM_FORMATION_SELECT_OPTIONS}
                          value={leagueForm.teamFormation}
                          onChange={(next) => {
                            if (next != null && !Array.isArray(next)) {
                              setLeagueForm({ ...leagueForm, teamFormation: next });
                            }
                          }}
                          listboxLabel="Team formation"
                        />
                      </div>
                    ) : null}

                    <div>
                      <label htmlFor="leagueCfgCapacityType" className="app-label">
                        Capacity type
                      </label>
                      <ChoiceInput<'individual' | 'team'>
                        inputId="leagueCfgCapacityType"
                        options={CAPACITY_TYPE_SELECT_OPTIONS}
                        value={leagueForm.capacityType}
                        onChange={(next) => {
                          if (next != null && !Array.isArray(next)) {
                            setLeagueForm({ ...leagueForm, capacityType: next });
                          }
                        }}
                        listboxLabel="Capacity type"
                      />
                    </div>

                    <LeagueConfigurationNumberInput
                      id="leagueCfgCapacityValue"
                      label="Capacity value"
                      value={leagueForm.capacityValue}
                      onChange={(capacityValue) =>
                        setLeagueForm({
                          ...leagueForm,
                          capacityValue: capacityValue === '' ? 0 : capacityValue,
                        })
                      }
                    />
                    <div className="sm:col-span-2 space-y-3">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Registration league fee charged:{' '}
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          ${(league.registrationFeeMinor / 100).toFixed(2)}
                        </span>
                        {clubDefaultLeagueFeeDollars !== null ? (
                          <>
                            {' '}
                            · Club default:{' '}
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              ${clubDefaultLeagueFeeDollars.toFixed(2)}
                            </span>
                          </>
                        ) : null}
                      </p>
                      <FormCheckbox
                        label="Override league fee"
                        checked={leagueForm.overrideLeagueFee}
                        helperText="When unchecked, this league uses the club default registration league fee."
                        onChange={(checked) =>
                          setLeagueForm((prev) => ({
                            ...prev,
                            overrideLeagueFee: checked,
                            leagueFeeOverrideDollars: checked
                              ? prev.leagueFeeOverrideDollars === '' && league
                                ? league.registrationFeeMinor / 100
                                : prev.leagueFeeOverrideDollars
                              : '',
                          }))
                        }
                      />
                      <LeagueConfigurationOptionalDollarInput
                        id="leagueCfgLeagueFeeOverride"
                        label="Custom league fee (USD)"
                        description={
                          leagueForm.overrideLeagueFee
                            ? 'Amount charged for this league instead of the club default.'
                            : 'Enable "Override league fee" to set a custom amount.'
                        }
                        disabled={!leagueForm.overrideLeagueFee}
                        value={leagueForm.leagueFeeOverrideDollars}
                        onChange={(leagueFeeOverrideDollars) =>
                          setLeagueForm({ ...leagueForm, leagueFeeOverrideDollars })
                        }
                      />
                    </div>
                    <LeagueConfigurationNumberInput
                      id="leagueCfgMinExperienceYears"
                      label="Minimum experience years"
                      step={0.5}
                      value={leagueForm.minExperienceYears}
                      onChange={(minExperienceYears) =>
                        setLeagueForm({ ...leagueForm, minExperienceYears })
                      }
                    />
                    <LeagueConfigurationNumberInput
                      id="leagueCfgMaxExperienceYears"
                      label="Maximum experience years"
                      step={0.5}
                      value={leagueForm.maxExperienceYears}
                      onChange={(maxExperienceYears) =>
                        setLeagueForm({ ...leagueForm, maxExperienceYears })
                      }
                    />
                    <LeagueConfigurationNumberInput
                      id="leagueCfgMinAge"
                      label="Minimum age"
                      value={leagueForm.minAge}
                      onChange={(minAge) => setLeagueForm({ ...leagueForm, minAge })}
                    />
                    <LeagueConfigurationNumberInput
                      id="leagueCfgMaxAge"
                      label="Maximum age"
                      value={leagueForm.maxAge}
                      onChange={(maxAge) => setLeagueForm({ ...leagueForm, maxAge })}
                    />
                    <div className="sm:col-span-2">
                      <FormField label="Public notes" htmlFor="leagueCfgPublicNotes" optional>
                        <textarea
                          id="leagueCfgPublicNotes"
                          value={leagueForm.publicNotes}
                          onChange={(e) => setLeagueForm({ ...leagueForm, publicNotes: e.target.value })}
                          rows={4}
                          placeholder="Optional notes shown on the public leagues page"
                          className="app-input min-h-[6rem] text-sm"
                        />
                      </FormField>
                    </div>
                  </div>

                  <fieldset className="space-y-2 border-0 p-0 min-w-0">
                    <legend id={leagueRegistrationFlagsLegendId} className="app-label">
                      League registration options
                    </legend>
                    <ChoiceInput<string>
                      ariaLabelledBy={leagueRegistrationFlagsLegendId}
                      layout="inline"
                      maxSelectedItems={null}
                      multiSelectionIndicatorStyle="checkboxes"
                      options={LEAGUE_REGISTRATION_FLAG_OPTIONS}
                      value={leagueRegistrationFlagKeys(leagueForm)}
                      onChange={(next) => {
                        if (!Array.isArray(next)) return;
                        const selected = new Set(next);
                        setLeagueForm((prev) => ({
                          ...prev,
                          requiresClubMembership: selected.has('requiresClubMembership'),
                          allowsSabbatical: selected.has('allowsSabbatical'),
                        }));
                      }}
                      listboxLabel="League registration options"
                    />
                  </fieldset>

                  {leagueForm.format !== 'instructional' ? (
                    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <FormCheckbox
                        label="Play-in based roster"
                        helperText="Rosters are filled from play-in results instead of a waitlist."
                        checked={leagueForm.isPlayInBased}
                        disabled={Boolean(league?.waitlistId)}
                        onChange={(checked) =>
                          setLeagueForm((prev) => ({
                            ...prev,
                            isPlayInBased: checked,
                          }))
                        }
                      />
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="app-section-title">Waitlist</h3>
                      {leagueForm.isPlayInBased ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Play-in based leagues do not use waitlists. Disable play-in registration to attach a waitlist.
                        </p>
                      ) : leagueForm.leagueType === 'bring_your_own_team' ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          BYOT waitlists require registrants to submit a full team roster when joining the queue.
                        </p>
                      ) : null}
                      {league?.waitlistId ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          <Link
                            to={`/waitlists/${league.waitlistId}`}
                            className="font-medium text-primary-teal hover:underline"
                          >
                            View {attachedWaitlistSummary ?? `waitlist #${league.waitlistId}`}
                          </Link>
                        </p>
                      ) : (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No waitlist is attached.
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {league?.waitlistId ? (
                        <Button
                          type="button"
                          variant="outline-danger"
                          disabled={waitlistActionLoading}
                          onClick={() => void handleDetachWaitlist()}
                        >
                          Detach waitlist
                        </Button>
                      ) : leagueForm.isPlayInBased ? null : (
                        <Button type="button" variant="secondary" onClick={() => setWaitlistModalOpen(true)}>
                          Add waitlist
                        </Button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="leagueCfgPredecessorLeagueId" className="app-label">
                      Predecessor league
                    </label>
                    <ChoiceInput<number>
                      inputId="leagueCfgPredecessorLeagueId"
                      options={[
                        { value: 0, label: 'None' },
                        ...allLeagues
                          .filter((l) => l.id !== numericLeagueId)
                          .map((l) => ({ value: l.id, label: l.name })),
                      ]}
                      value={leagueForm.predecessorLeagueId}
                      onChange={(next) => {
                        if (next != null && !Array.isArray(next)) {
                          setLeagueForm({ ...leagueForm, predecessorLeagueId: next });
                        }
                      }}
                      listboxLabel="Predecessor league"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button type="submit" disabled={leagueSubmitting}>
                    {leagueSubmitting ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="app-card text-sm text-gray-600 dark:text-gray-400">
              You do not have access to edit league configuration. Ask a club administrator or
              league administrator if something here needs to change.
            </div>
          ))}

        {normalizedTab === 'schedule' && (
          <LeagueSchedule
            leagueId={numericLeagueId}
            teams={teams}
            canManage={canManageSetup}
            memberTeamIds={memberTeamIds}
            leagueFormat={leagueScheduleFormat(league.format)}
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
            {leagueAllowsDropIns ? (
              <InlineStateMessage
                title="Drop-in leagues do not use divisions"
                description={
                  <>
                    Manage permanent members on the{' '}
                    <Link to={`/leagues/${leagueId}/roster`} className="font-medium text-primary-teal hover:underline">
                      roster tab
                    </Link>
                    .
                  </>
                }
              />
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {normalizedTab === 'teams' && (
          <div className="space-y-4">
            {leagueAllowsDropIns ? (
              <InlineStateMessage
                title="Drop-in leagues do not use teams"
                description={
                  <>
                    Manage permanent members on the{' '}
                    <Link to={`/leagues/${leagueId}/roster`} className="font-medium text-primary-teal hover:underline">
                      roster tab
                    </Link>
                    .
                  </>
                }
              />
            ) : (
              <>
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
                        <ChoiceInput<number>
                          inputId="teamDivisionInline"
                          options={divisions.map((division) => ({
                            value: division.id,
                            label: division.name,
                          }))}
                          value={teamForm.divisionId}
                          onChange={(next) => {
                            if (next != null && !Array.isArray(next))
                              setTeamForm({ ...teamForm, divisionId: next });
                          }}
                          listboxLabel="Division"
                        />
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

                      {isTeamsLikeLeagueFormat(league.format) ? (
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
                {isTeamsLikeLeagueFormat(league.format) && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">* Skip · ** Vice</div>
                )}
              </div>
            )}
              </>
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

        {normalizedTab === 'sabbaticals' && (
          <div className="space-y-4">
            <div className="app-card space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="app-section-title">Sabbaticals</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Members holding a protected sabbatical spot for this league.
                  </p>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total: <span className="font-medium">{sabbaticalMembers.length}</span>
                </div>
              </div>
              {league && !league.allowsSabbatical && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This league is configured not to allow sabbaticals.
                </p>
              )}
              {league?.leagueType === 'bring_your_own_team' && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Bring-your-own-team leagues do not use sabbaticals.
                </p>
              )}
            </div>

            {canManageSabbaticals &&
              league?.allowsSabbatical &&
              league.leagueType !== 'bring_your_own_team' && (
                <div className="app-card space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Add member to sabbatical
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Search for a member and record a staff reason. This bypasses normal registration
                      eligibility checks.
                    </p>
                  </div>
                  <FormField label="Staff reason" htmlFor={sabbaticalAddReasonId} required>
                    <input
                      id={sabbaticalAddReasonId}
                      type="text"
                      className="app-input"
                      value={sabbaticalAddReason}
                      onChange={(event) => setSabbaticalAddReason(event.target.value)}
                      placeholder="Why is this sabbatical being added?"
                      disabled={sabbaticalAddSubmitting}
                    />
                  </FormField>
                  <MemberAutocomplete
                    value=""
                    onChange={() => {}}
                    onSelectOption={handleAddSabbatical}
                    placeholder="Search members by name or email"
                    minQueryLength={2}
                    openOnFocus={false}
                    noMatchesText="No members found"
                    disabled={sabbaticalAddSubmitting || !sabbaticalAddReason.trim()}
                    filterOption={(option) => !sabbaticalMemberIds.has(option.id)}
                  />
                </div>
              )}

            <div className="app-card">
              {sabbaticalMembers.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No members are on sabbatical for this league.
                </div>
              ) : (
                <div className="space-y-3">
                  {sabbaticalMembers.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md p-3"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {entry.name}
                        </div>
                        {entry.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">{entry.email}</div>
                        )}
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Sabbatical since {formatDateDisplay(entry.firstSabbaticalStartDate)}
                          {entry.staffOverride && entry.staffOverrideReason
                            ? ` · Staff override: ${entry.staffOverrideReason}`
                            : ''}
                          {entry.sourceRegistrationId
                            ? ` · Registration #${entry.sourceRegistrationId}`
                            : ''}
                        </div>
                      </div>
                      {canManageSabbaticals && (
                        <Button variant="danger" onClick={() => handleRemoveSabbatical(entry)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      <Modal isOpen={waitlistModalOpen} onClose={closeWaitlistModal} title="Add waitlist" size="md">
        <div className="space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Create a new waitlist for this league or attach an existing one. Attaching merges queue continuity with
            other leagues that use the same waitlist.
          </p>
          <FormField label="New waitlist name" htmlFor="leagueWaitlistDialogName">
            <input
              id="leagueWaitlistDialogName"
              className="app-input"
              value={newWaitlistName}
              onChange={(event) => setNewWaitlistName(event.target.value)}
              placeholder={league ? `${league.name} waitlist` : 'League waitlist'}
            />
          </FormField>
          <Button
            type="button"
            variant="primary"
            disabled={waitlistActionLoading}
            onClick={() => void handleCreateWaitlist()}
          >
            Create and attach waitlist
          </Button>
          <div className="relative border-t border-gray-200 pt-6 dark:border-gray-700">
            <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              Or
            </span>
            <FormField label="Attach existing waitlist" htmlFor="leagueWaitlistDialogAttach">
              <ChoiceInput<number>
                inputId="leagueWaitlistDialogAttach"
                layout="popover"
                value={attachWaitlistId}
                onChange={(next) => {
                  if (typeof next === 'number') setAttachWaitlistId(next);
                }}
                options={waitlistOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                  description: `${option.activeEntryCount} active entries · ${option.attachedLeagues
                    .map((attached) => `${attached.name}${attached.sessionName ? ` (${attached.sessionName})` : ''}`)
                    .join(', ') || 'No leagues attached yet'}`,
                }))}
                emptyText="No waitlists available yet."
              />
            </FormField>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" disabled={waitlistActionLoading} onClick={closeWaitlistModal}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={waitlistActionLoading || attachWaitlistId == null}
                onClick={() => void handleAttachWaitlist()}
              >
                Attach selected waitlist
              </Button>
            </div>
          </div>
        </div>
      </Modal>

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
              <ChoiceInput<number>
                inputId="bye-requests-team"
                options={teams
                  .filter((t) => memberTeamIds.includes(t.id))
                  .map((t) => ({
                    value: t.id,
                    label: t.name ?? `Team ${t.id}`,
                  }))}
                value={byeRequestsTeamId}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) void handleByeRequestsTeamChange(next);
                }}
                listboxLabel="Team"
              />
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
    </>
  );
}

function LeagueConfigurationNumberInput({
  id,
  label,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  id: string;
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  step?: number;
  min?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="app-label">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className="app-input"
      />
    </div>
  );
}

function LeagueConfigurationOptionalDollarInput({
  id,
  label,
  description,
  disabled = false,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  value: number | '';
  onChange: (value: number | '') => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className={disabled ? 'app-label opacity-60' : 'app-label'}>
        {label}
      </label>
      {description ? (
        <p id={hintId} className="mb-1 text-sm text-gray-600 dark:text-gray-400">
          {description}
        </p>
      ) : null}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        disabled={disabled}
        aria-describedby={description ? hintId : undefined}
        value={value === '' ? '' : value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : '');
        }}
        className="app-input disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}
