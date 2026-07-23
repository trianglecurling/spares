import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiChevronDown } from 'react-icons/hi2';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { get, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import {
  defaultDrawDurationMinutes,
  extraDrawKey,
  type LeagueExtraDraw,
  type LeaguePlayFormat,
} from '../../utils/leagueSchedule';

const WEEKDAY_CHOICES: ChoiceOption<number>[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
].map((label, index) => ({ value: index, label }));

type LeagueListPlayFormat = LeaguePlayFormat;

const LEAGUE_FORMAT_CHOICES: ChoiceOption<LeagueListPlayFormat>[] = [
  { value: 'teams', label: 'Teams' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'instructional', label: 'Instructional' },
];

function leagueFormatCardLabel(format: LeagueListPlayFormat): string {
  if (format === 'instructional') return 'Instructional';
  if (format === 'doubles') return 'Doubles';
  return 'Teams';
}

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: LeagueListPlayFormat;
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
  allowsSabbatical: boolean;
  predecessorLeagueId: number | null;
  successorLeagueId: number | null;
  drawDurationMinutes: number;
  drawTimes: string[];
  exceptions: string[];
  extraDraws: LeagueExtraDraw[];
  canManage?: boolean;
}

interface RegistrationSession {
  id: number;
  name: string;
  seasonId: number;
  startDate: string;
  endDate: string;
}

interface RegistrationSeason {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

interface RegistrationWindowPayload {
  state: string;
  season: { id: number; name: string; startDate: string; endDate: string };
  session: { id: number; seasonId: number; name: string; startDate: string; endDate: string };
}

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

export default function Leagues() {
  const { showAlert } = useAlert();
  const { member } = useAuth();
  const headerExtrasId = useId();
  const histSeasonFieldId = `${headerExtrasId}-hist-season`;
  const histSessionFieldId = `${headerExtrasId}-hist-session`;

  const [leagues, setLeagues] = useState<League[]>([]);
  const [registrationSessions, setRegistrationSessions] = useState<RegistrationSession[]>([]);
  const [registrationSeasons, setRegistrationSeasons] = useState<RegistrationSeason[]>([]);
  const [registrationWindow, setRegistrationWindow] = useState<RegistrationWindowPayload | null>(null);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [histSeasonId, setHistSeasonId] = useState<number | null>(null);
  const [histSessionId, setHistSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    dayOfWeek: 0,
    format: 'teams' as LeagueListPlayFormat,
    startDate: '',
    endDate: '',
    drawDurationMinutes: defaultDrawDurationMinutes('teams'),
    drawTimes: [''],
    exceptions: [] as string[],
    extraDraws: [] as LeagueExtraDraw[],
  });
  const [showExceptionPicker, setShowExceptionPicker] = useState(false);
  const [exceptionToAdd, setExceptionToAdd] = useState('');
  const [extraDrawToAdd, setExtraDrawToAdd] = useState<LeagueExtraDraw>({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);
  const [addLeagueMenuOpen, setAddLeagueMenuOpen] = useState(false);
  const addLeagueMenuRef = useRef<HTMLDivElement>(null);
  const [myRosterLeagueIds, setMyRosterLeagueIds] = useState<number[]>([]);

  useEffect(() => {
    if (!member?.id) {
      setMyRosterLeagueIds([]);
      return;
    }
    get('/members/{memberId}/leagues', undefined, {
      memberId: String(member.id),
    })
      .then((rows) => {
        const ids = Array.isArray(rows) ? rows.map((r) => r.leagueId) : [];
        setMyRosterLeagueIds(ids);
      })
      .catch(() => setMyRosterLeagueIds([]));
  }, [member?.id]);

  useEffect(() => {
    if (!addLeagueMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (addLeagueMenuRef.current && !addLeagueMenuRef.current.contains(e.target as Node)) {
        setAddLeagueMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addLeagueMenuOpen]);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (!member?.isAdmin && !member?.isServerAdmin && !member?.isLeagueAdministratorGlobal) return;
    Promise.all([
      get('/registration-config/sessions')
        .then((response) => setRegistrationSessions(response as RegistrationSession[]))
        .catch(() => {}),
      get('/registration-config/seasons')
        .then((response) => setRegistrationSeasons(response as RegistrationSeason[]))
        .catch(() => {}),
    ]).catch(() => {});
  }, [member]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [leaguesRes, windowRes] = await Promise.all([
        get('/leagues'),
        get('/registration/window').catch(() => null),
      ]);
      setLeagues(leaguesRes as League[]);
      if (windowRes && typeof windowRes === 'object' && windowRes !== null && 'session' in windowRes) {
        setRegistrationWindow(windowRes as unknown as RegistrationWindowPayload);
      } else {
        setRegistrationWindow(null);
      }
    } catch (error: unknown) {
      console.error('Failed to load leagues:', error);
      showAlert(formatApiError(error, 'Failed to load leagues'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = () => {
    setFormData({
      name: '',
      dayOfWeek: 0,
      format: 'teams',
      startDate: '',
      endDate: '',
      drawDurationMinutes: defaultDrawDurationMinutes('teams'),
      drawTimes: [''],
      exceptions: [],
      extraDraws: [],
    });
    setShowExceptionPicker(false);
    setExceptionToAdd('');
    setExtraDrawToAdd({ date: '', time: '' });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setShowExceptionPicker(false);
    setExceptionToAdd('');
    setExtraDrawToAdd({ date: '', time: '' });
  };

  const computeLeagueDates = (
    startDateStr: string,
    endDateStr: string,
    dayOfWeek: number
  ): string[] => {
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
  };

  const allLeagueDates = computeLeagueDates(
    formData.startDate,
    formData.endDate,
    formData.dayOfWeek
  );
  const availableExceptionDates = allLeagueDates.filter((d) => !formData.exceptions.includes(d));

  // If dates/day change, drop exceptions that are no longer valid for the league range/day
  useEffect(() => {
    const valid = new Set(
      computeLeagueDates(formData.startDate, formData.endDate, formData.dayOfWeek)
    );
    if (formData.exceptions.some((d) => !valid.has(d))) {
      setFormData((prev) => ({
        ...prev,
        exceptions: prev.exceptions.filter((d) => valid.has(d)),
      }));
      setExceptionToAdd('');
    }
  }, [formData.startDate, formData.endDate, formData.dayOfWeek]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const uniqueExceptions = Array.from(new Set(formData.exceptions)).sort();
      const uniqueExtraDraws = Array.from(
        new Map(
          formData.extraDraws
            .filter((d) => d.date && d.time)
            .map((d) => [extraDrawKey(d), { date: d.date, time: d.time.slice(0, 5) }])
        ).values()
      ).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
      const payload = {
        name: formData.name,
        dayOfWeek: formData.dayOfWeek,
        format: formData.format,
        startDate: formData.startDate,
        endDate: formData.endDate,
        drawDurationMinutes: formData.drawDurationMinutes,
        drawTimes: formData.drawTimes.filter((t) => t.trim() !== ''),
        exceptions: uniqueExceptions,
        extraDraws: uniqueExtraDraws,
      };

      await post('/leagues', payload);

      await loadInitialData();
      handleCloseModal();
    } catch (error: unknown) {
      console.error('Failed to save league:', error);
      showAlert(formatApiError(error, 'Failed to save league'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const addDrawTime = () => {
    setFormData({
      ...formData,
      drawTimes: [...formData.drawTimes, ''],
    });
  };

  const updateDrawTime = (index: number, value: string) => {
    const newDrawTimes = [...formData.drawTimes];
    newDrawTimes[index] = value;
    setFormData({ ...formData, drawTimes: newDrawTimes });
  };

  const removeDrawTime = (index: number) => {
    setFormData({
      ...formData,
      drawTimes: formData.drawTimes.filter((_, i) => i !== index),
    });
  };

  const getDayName = (dayOfWeek: number) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek];
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getSessionName = (sessionId: number | null) => {
    if (!sessionId) return 'Unassigned';
    if (registrationWindow?.session.id === sessionId) return registrationWindow.session.name;
    return registrationSessions.find((session) => session.id === sessionId)?.name ?? `Session ${sessionId}`;
  };

  // Helper to format date for display, handling timezone offset
  const formatDateDisplay = (dateString: string) => {
    if (!dateString) return '';
    // Create date object and adjust for timezone offset to display correct local date
    const date = new Date(dateString);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
    return adjustedDate.toLocaleDateString();
  };

  const removeException = (dateStr: string) => {
    setFormData((prev) => ({
      ...prev,
      exceptions: prev.exceptions.filter((d) => d !== dateStr),
    }));
  };

  const addExtraDraw = () => {
    const date = extraDrawToAdd.date;
    const time = extraDrawToAdd.time.slice(0, 5);
    if (!date || !time) return;
    const key = extraDrawKey({ date, time });
    setFormData((prev) => {
      if (prev.extraDraws.some((d) => extraDrawKey(d) === key)) return prev;
      return {
        ...prev,
        extraDraws: [...prev.extraDraws, { date, time }].sort(
          (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
        ),
      };
    });
    setExtraDrawToAdd({ date: '', time: '' });
  };

  const removeExtraDraw = (draw: LeagueExtraDraw) => {
    const key = extraDrawKey(draw);
    setFormData((prev) => ({
      ...prev,
      extraDraws: prev.extraDraws.filter((d) => extraDrawKey(d) !== key),
    }));
  };

  const currentWindowSessionId = registrationWindow?.session.id ?? null;

  const sessionsForHistSeason = useMemo(() => {
    if (histSeasonId == null) return [];
    return registrationSessions
      .filter((s) => s.seasonId === histSeasonId)
      .sort((a, b) => compareIsoDate(a.startDate, b.startDate) || a.id - b.id);
  }, [registrationSessions, histSeasonId]);

  const historicalSeasonOptions: ChoiceOption<number>[] = useMemo(
    () =>
      [...registrationSeasons]
        .sort((a, b) => compareIsoDate(a.startDate, b.startDate) || a.id - b.id)
        .map((s) => ({ value: s.id, label: s.name })),
    [registrationSeasons]
  );

  const historicalSessionOptions: ChoiceOption<number>[] = useMemo(
    () => sessionsForHistSeason.map((s) => ({ value: s.id, label: s.name })),
    [sessionsForHistSeason]
  );

  useEffect(() => {
    if (!historicalMode || histSessionId == null || histSeasonId == null) return;
    const s = registrationSessions.find((x) => x.id === histSessionId);
    if (!s || s.seasonId !== histSeasonId) setHistSessionId(null);
  }, [historicalMode, histSeasonId, histSessionId, registrationSessions]);

  const filteredLeagues = useMemo(() => {
    if (historicalMode) {
      if (histSeasonId == null || histSessionId == null) return [];
      return leagues.filter((l) => l.sessionId === histSessionId);
    }
    if (currentWindowSessionId == null) return [];
    return leagues.filter((l) => l.sessionId === currentWindowSessionId);
  }, [leagues, historicalMode, histSeasonId, histSessionId, currentWindowSessionId]);

  const { myLeagues, otherLeagues } = useMemo(() => {
    const onRoster = new Set(myRosterLeagueIds);
    const my: League[] = [];
    const other: League[] = [];
    for (const l of filteredLeagues) {
      if (onRoster.has(l.id)) my.push(l);
      else other.push(l);
    }
    return { myLeagues: my, otherLeagues: other };
  }, [filteredLeagues, myRosterLeagueIds]);

  const emptyFilteredMessage = useMemo(() => {
    if (historicalMode) {
      if (histSeasonId == null || histSessionId == null) {
        return {
          title: 'Select a season and session',
          detail:
            'Choose both dropdowns below to load leagues for that registration session.',
        };
      }
      return {
        title: 'No leagues for this session',
        detail: 'This session has no leagues assigned.',
      };
    }
    if (currentWindowSessionId == null) {
      return {
        title: 'No current registration session',
        detail:
          'Set the active registration window under Admin → Registration → Periods, or use View historical leagues if you have access.',
      };
    }
    return {
      title: 'No leagues for the current session',
      detail: `There are no leagues assigned to ${registrationWindow?.session.name ?? 'the current registration session'} yet.`,
    };
  }, [
    historicalMode,
    histSeasonId,
    histSessionId,
    currentWindowSessionId,
    registrationWindow,
  ]);

  const canManageLeagueDetails = Boolean(
    member?.isAdmin || member?.isServerAdmin || member?.isLeagueAdministratorGlobal
  );

  const historicalLeaguesControls =
    canManageLeagueDetails &&
    (historicalMode ? (
      <div className="flex flex-wrap items-end gap-2">
        <FormField
          label="Season"
          htmlFor={histSeasonFieldId}
          className="min-w-[10rem]"
          helperText={historicalSeasonOptions.length === 0 ? 'No seasons loaded.' : undefined}
        >
          <ChoiceInput<number>
            inputId={histSeasonFieldId}
            options={historicalSeasonOptions}
            value={histSeasonId}
            onChange={(next) => {
              if (next != null && !Array.isArray(next)) {
                setHistSeasonId(next);
                setHistSessionId(null);
              } else {
                setHistSeasonId(null);
                setHistSessionId(null);
              }
            }}
            listboxLabel="Historical season"
            placeholder={historicalSeasonOptions.length === 0 ? 'No seasons' : 'Season…'}
            disabled={historicalSeasonOptions.length === 0}
            inputClassName="app-input min-w-[10rem]"
          />
        </FormField>
        <FormField label="Session" htmlFor={histSessionFieldId} className="min-w-[10rem]">
          <ChoiceInput<number>
            inputId={histSessionFieldId}
            options={historicalSessionOptions}
            value={histSessionId}
            onChange={(next) => {
              if (next != null && !Array.isArray(next)) setHistSessionId(next);
              else setHistSessionId(null);
            }}
            listboxLabel="Historical session"
            placeholder={
              histSeasonId == null
                ? 'Pick a season first'
                : historicalSessionOptions.length === 0
                  ? 'No sessions'
                  : 'Session…'
            }
            disabled={histSeasonId == null || historicalSessionOptions.length === 0}
            inputClassName="app-input min-w-[10rem]"
          />
        </FormField>
        <Button
          type="button"
          variant="secondary"
          className="!h-10 shrink-0"
          onClick={() => {
            setHistoricalMode(false);
            setHistSeasonId(null);
            setHistSessionId(null);
          }}
        >
          Current session
        </Button>
      </div>
    ) : (
      <Button type="button" variant="secondary" className="!h-10 shrink-0" onClick={() => setHistoricalMode(true)}>
        View historical leagues
      </Button>
    ));

  const renderLeagueGrid = (list: League[]) => (
    <div className="grid gap-4">
      {list.map((league) => (
        <div key={league.id} className="app-card p-6">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <Link
                to={`/leagues/${league.id}`}
                className="mb-2 inline-block text-left text-xl font-semibold text-primary-teal hover:underline"
              >
                {league.name}
              </Link>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <p>
                  <span className="font-medium dark:text-gray-300">Day:</span> {getDayName(league.dayOfWeek)}
                </p>
                <p>
                  <span className="font-medium dark:text-gray-300">Times:</span>{' '}
                  {league.drawTimes.map(formatTime).join(', ')}
                </p>
                <p>
                  <span className="font-medium dark:text-gray-300">Draw duration:</span>{' '}
                  {league.drawDurationMinutes ?? defaultDrawDurationMinutes(league.format)} minutes
                </p>
                <p>
                  <span className="font-medium dark:text-gray-300">Format:</span>{' '}
                  {leagueFormatCardLabel(league.format)}
                </p>
                <p>
                  <span className="font-medium dark:text-gray-300">Season:</span>{' '}
                  {formatDateDisplay(league.startDate)} – {formatDateDisplay(league.endDate)}
                </p>
                {league.waitlistId ? (
                  <p>
                    <span className="font-medium dark:text-gray-300">Waitlist:</span> #{league.waitlistId}
                  </p>
                ) : null}
                <p>
                  <span className="font-medium dark:text-gray-300">Registration:</span>{' '}
                  {getSessionName(league.sessionId)} -{' '}
                  {league.leagueType === 'bring_your_own_team' ? 'BYOT' : 'Standard'} - {league.capacityValue}{' '}
                  {league.capacityType}
                </p>
                {league.exceptions?.length > 0 && (
                  <p>
                    <span className="font-medium dark:text-gray-300">Exceptions:</span>{' '}
                    {league.exceptions.length} date(s)
                  </p>
                )}
                {league.extraDraws?.length > 0 && (
                  <p>
                    <span className="font-medium dark:text-gray-300">One-off draws:</span>{' '}
                    {league.extraDraws.length}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Leagues"
          actions={
            <>
              {canManageLeagueDetails && (
              <div className="relative inline-flex rounded-lg" ref={addLeagueMenuRef}>
                <Button
                  type="button"
                  onClick={() => handleOpenModal()}
                  className="!h-10 !min-h-10 !py-0 rounded-r-none pr-3"
                >
                  Add league
                </Button>
                <button
                  type="button"
                  className="box-border flex h-10 min-h-10 shrink-0 items-center justify-center rounded-l-none rounded-r-lg bg-primary-teal-solid px-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-teal-solid/90 focus:outline-none focus:ring-2 focus:ring-primary-teal/40 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-haspopup="menu"
                  aria-expanded={addLeagueMenuOpen}
                  aria-label="More league actions"
                  onClick={() => setAddLeagueMenuOpen((open) => !open)}
                >
                  <HiChevronDown
                    className={`h-5 w-5 transition-transform ${addLeagueMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {addLeagueMenuOpen ? (
                  <ul
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 min-w-[16rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
                  >
                    <li role="none">
                      <Link
                        to="/leagues/copy-to-session"
                        role="menuitem"
                        className="block w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setAddLeagueMenuOpen(false)}
                      >
                        Copy leagues to next session
                      </Link>
                    </li>
                  </ul>
                ) : null}
              </div>
              )}
            </>
          }
        />

        {loading ? (
          <AppStateCard title="Loading leagues..." />
        ) : leagues.length === 0 ? (
          <AppStateCard
            title="No leagues configured yet."
            action={canManageLeagueDetails ? <Button onClick={() => handleOpenModal()}>Create your first league</Button> : undefined}
          />
        ) : filteredLeagues.length === 0 ? (
          <AppStateCard title={emptyFilteredMessage.title} description={emptyFilteredMessage.detail} />
        ) : (
          <div className="space-y-10">
            {myLeagues.length > 0 ? (
              <section className="space-y-4" aria-labelledby="leagues-my-heading">
                <h2 id="leagues-my-heading" className="app-section-title">
                  My leagues
                </h2>
                {renderLeagueGrid(myLeagues)}
              </section>
            ) : null}
            {otherLeagues.length > 0 ? (
              <section
                className="space-y-4"
                aria-labelledby={myLeagues.length > 0 ? 'leagues-other-heading' : undefined}
                aria-label={myLeagues.length > 0 ? undefined : 'Leagues'}
              >
                {myLeagues.length > 0 ? (
                  <h2 id="leagues-other-heading" className="app-section-title">
                    Other leagues
                  </h2>
                ) : null}
                {renderLeagueGrid(otherLeagues)}
              </section>
            ) : null}
          </div>
        )}

        {!loading && historicalLeaguesControls ? (
          <div className="mt-10 border-t border-gray-200 pt-8 dark:border-gray-700">{historicalLeaguesControls}</div>
        ) : null}
      </AppPage>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title="Add league"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="app-label"
            >
              League name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="app-input"
              required
            />
          </div>

          <div>
            <label
              htmlFor="dayOfWeek"
              className="app-label"
            >
              Day of week <span className="text-red-500">*</span>
            </label>
            <ChoiceInput<number>
              inputId="dayOfWeek"
              options={WEEKDAY_CHOICES}
              value={formData.dayOfWeek}
              onChange={(next) => {
                if (next != null && !Array.isArray(next))
                  setFormData({ ...formData, dayOfWeek: next });
              }}
              listboxLabel="Day of week"
              required
            />
          </div>

          <div>
            <label className="app-label">
              Draw times <span className="text-red-500">*</span>
            </label>
            {formData.drawTimes.map((time, index) => (
              <div key={index} className="flex space-x-2 mb-2">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => updateDrawTime(index, e.target.value)}
                  className="app-input flex-1"
                  required
                />
                {formData.drawTimes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDrawTime(index)}
                    className="px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addDrawTime}
              className="text-sm text-primary-teal hover:text-opacity-80"
            >
              + Add draw time
            </button>
          </div>

          <div>
            <label
              htmlFor="format"
              className="app-label"
            >
              Format <span className="text-red-500">*</span>
            </label>
            <ChoiceInput<LeagueListPlayFormat>
              inputId="format"
              options={LEAGUE_FORMAT_CHOICES}
              value={formData.format}
              onChange={(next) => {
                if (next == null || Array.isArray(next)) return;
                setFormData((prev) => {
                  const prevDefault = defaultDrawDurationMinutes(prev.format);
                  const nextDefault = defaultDrawDurationMinutes(next);
                  return {
                    ...prev,
                    format: next,
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

          <div>
            <label htmlFor="drawDurationMinutes" className="app-label">
              Draw duration (minutes) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="drawDurationMinutes"
              min={15}
              max={1440}
              step={15}
              value={formData.drawDurationMinutes}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  drawDurationMinutes: Number.parseInt(e.target.value, 10) || defaultDrawDurationMinutes(formData.format),
                })
              }
              className="app-input"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="startDate"
                className="app-label"
              >
                Start date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="startDate"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="endDate"
                className="app-label"
              >
                End date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                id="endDate"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="app-input"
                required
              />
            </div>
          </div>

          <div>
            <label className="app-label">
              Exceptions (dates the league does not run)
            </label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowExceptionPicker((v) => !v)}
                disabled={!formData.startDate || !formData.endDate}
              >
                Add exception
              </Button>

              {showExceptionPicker && (
                <ChoiceInput<string>
                  ariaLabel="Add league exception date"
                  options={availableExceptionDates.map((d) => ({
                    value: d,
                    label: formatDateDisplay(d),
                  }))}
                  value={exceptionToAdd || null}
                  onChange={(next) => {
                    const selected = next == null || Array.isArray(next) ? '' : next;
                    setExceptionToAdd(selected);
                    if (!selected) return;
                    if (!formData.exceptions.includes(selected)) {
                      setFormData((prev) => ({
                        ...prev,
                        exceptions: [...prev.exceptions, selected].sort(),
                      }));
                    }
                    setExceptionToAdd('');
                  }}
                  placeholder={
                    availableExceptionDates.length === 0
                      ? 'No dates available'
                      : 'Select a date...'
                  }
                  listboxLabel="Exception date"
                  disabled={availableExceptionDates.length === 0}
                  inputClassName="app-input w-full sm:w-auto"
                />
              )}
            </div>

            {formData.exceptions.length > 0 && (
              <div className="mt-3 space-y-2">
                {formData.exceptions.map((d) => (
                  <div
                    key={d}
                    className="flex items-center justify-between px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {formatDateDisplay(d)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeException(d)}
                      className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="app-label">One-off draws (additional date and time)</label>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <div className="flex-1">
                <label htmlFor="extraDrawDate" className="sr-only">
                  One-off draw date
                </label>
                <input
                  type="date"
                  id="extraDrawDate"
                  value={extraDrawToAdd.date}
                  onChange={(e) => setExtraDrawToAdd((prev) => ({ ...prev, date: e.target.value }))}
                  className="app-input"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="extraDrawTime" className="sr-only">
                  One-off draw time
                </label>
                <input
                  type="time"
                  id="extraDrawTime"
                  value={extraDrawToAdd.time}
                  onChange={(e) => setExtraDrawToAdd((prev) => ({ ...prev, time: e.target.value }))}
                  className="app-input"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={addExtraDraw}
                disabled={!extraDrawToAdd.date || !extraDrawToAdd.time}
              >
                Add one-off draw
              </Button>
            </div>

            {formData.extraDraws.length > 0 && (
              <div className="mt-3 space-y-2">
                {formData.extraDraws.map((draw) => (
                  <div
                    key={extraDrawKey(draw)}
                    className="flex items-center justify-between px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {formatDateDisplay(draw.date)} · {formatTime(draw.time)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExtraDraw(draw)}
                      className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseModal}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
