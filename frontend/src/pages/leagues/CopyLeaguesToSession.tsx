import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import BackButton from '../../components/BackButton';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import { get, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';

interface LeagueRow {
  id: number;
  name: string;
  dayOfWeek: number;
  sessionId: number | null;
}

interface RegistrationSeason {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

interface RegistrationSession {
  id: number;
  seasonId: number;
  name: string;
  startDate: string;
  endDate: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

function firstDowOnOrAfterUtc(anchorStart: string, dayOfWeek: number): string {
  const anchor = new Date(`${anchorStart}T00:00:00Z`);
  const anchorDow = anchor.getUTCDay();
  const delta = (dayOfWeek - anchorDow + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return anchor.toISOString().slice(0, 10);
}

function lastDowOnOrBeforeUtc(anchorEnd: string, dayOfWeek: number): string {
  const end = new Date(`${anchorEnd}T00:00:00Z`);
  const endDow = end.getUTCDay();
  const delta = (endDow - dayOfWeek + 7) % 7;
  end.setUTCDate(end.getUTCDate() - delta);
  return end.toISOString().slice(0, 10);
}

/** Inclusive count of occurrences of the league weekday from start through end (both ISO yyyy-mm-dd, UTC). */
function countWeeklyLeagueDaysInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

export default function CopyLeaguesToSession() {
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const { member } = useAuth();
  const baseId = useId();

  const seasonFieldId = `${baseId}-season`;
  const sessionFieldId = `${baseId}-session`;
  const leaguesFieldId = `${baseId}-leagues`;
  const anchorStartId = `${baseId}-anchor-start`;
  const anchorEndId = `${baseId}-anchor-end`;

  const canManage = Boolean(
    member?.isAdmin || member?.isServerAdmin || member?.isLeagueAdministratorGlobal
  );

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [seasons, setSeasons] = useState<RegistrationSeason[]>([]);
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [anchorStartDate, setAnchorStartDate] = useState('');
  const [anchorEndDate, setAnchorEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) {
      setLoadingMeta(false);
      return;
    }

    let canceled = false;

    async function load() {
      setLoadingMeta(true);
      try {
        const [leagueRes, seasonRes, sessionRes] = await Promise.all([
          get('/leagues'),
          get('/registration-config/seasons'),
          get('/registration-config/sessions'),
        ]);
        if (canceled) return;
        const leagueList = leagueRes as Array<{
          id: number;
          name: string;
          dayOfWeek: number;
          sessionId: number | null;
        }>;
        setLeagues(
          leagueList.map((l) => ({
            id: l.id,
            name: l.name,
            dayOfWeek: l.dayOfWeek,
            sessionId: l.sessionId,
          }))
        );
        setSeasons(seasonRes as RegistrationSeason[]);
        setSessions(sessionRes as RegistrationSession[]);
      } catch (error: unknown) {
        if (!canceled) {
          showAlert(formatApiError(error, 'Failed to load seasons and leagues'), 'error');
        }
      } finally {
        if (!canceled) setLoadingMeta(false);
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, [canManage, showAlert]);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  /** Seasons ordered by start date (same basis as registration config). */
  const seasonsOrdered = useMemo(
    () => [...seasons].sort((a, b) => compareIsoDate(a.startDate, b.startDate) || a.id - b.id),
    [seasons]
  );

  /** Sessions per season, each list sorted by start date. */
  const sessionsBySeasonId = useMemo(() => {
    const m = new Map<number, RegistrationSession[]>();
    for (const s of sessions) {
      const list = m.get(s.seasonId) ?? [];
      list.push(s);
      m.set(s.seasonId, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => compareIsoDate(a.startDate, b.startDate) || a.id - b.id);
    }
    return m;
  }, [sessions]);

  const sessionsForSeason = useMemo(() => {
    if (selectedSeasonId == null) return [];
    const list = sessions.filter((s) => s.seasonId === selectedSeasonId);
    return [...list].sort((a, b) => compareIsoDate(a.startDate, b.startDate) || a.id - b.id);
  }, [sessions, selectedSeasonId]);

  /**
   * Session immediately before the destination: previous session in the same season, or
   * if the destination is the first session of the season, the last session of the chronologically prior season.
   */
  const previousSessionId = useMemo((): number | null => {
    if (selectedSessionId == null) return null;
    const current = sessionById.get(selectedSessionId);
    if (!current) return null;
    const seasonSessions = sessionsBySeasonId.get(current.seasonId) ?? [];
    if (seasonSessions.length === 0) return null;
    const idx = seasonSessions.findIndex((s) => s.id === selectedSessionId);
    if (idx < 0) return null;
    if (idx > 0) {
      return seasonSessions[idx - 1]!.id;
    }
    const seasonIdx = seasonsOrdered.findIndex((se) => se.id === current.seasonId);
    if (seasonIdx <= 0) return null;
    const prevSeason = seasonsOrdered[seasonIdx - 1]!;
    const prevSeasonSessions = sessionsBySeasonId.get(prevSeason.id) ?? [];
    if (prevSeasonSessions.length === 0) return null;
    return prevSeasonSessions[prevSeasonSessions.length - 1]!.id;
  }, [selectedSessionId, sessionById, sessionsBySeasonId, seasonsOrdered]);

  const previousSession = previousSessionId != null ? sessionById.get(previousSessionId) : undefined;

  const sessionOptions: ChoiceOption<number>[] = useMemo(
    () =>
      sessionsForSeason.map((s) => ({
        value: s.id,
        label: s.name,
      })),
    [sessionsForSeason]
  );

  const seasonOptions: ChoiceOption<number>[] = useMemo(
    () =>
      seasons.map((season) => ({
        value: season.id,
        label: season.name,
      })),
    [seasons]
  );

  useEffect(() => {
    if (selectedSessionId == null) return;
    const s = sessionById.get(selectedSessionId);
    if (!s || s.seasonId !== selectedSeasonId) {
      setSelectedSessionId(null);
    }
  }, [selectedSeasonId, selectedSessionId, sessionById]);

  useEffect(() => {
    if (previousSessionId == null) {
      setSelectedLeagueIds([]);
      return;
    }
    setSelectedLeagueIds((prev) =>
      prev.filter((id) => leagues.some((l) => l.id === id && l.sessionId === previousSessionId))
    );
  }, [previousSessionId, leagues, selectedSessionId]);

  const leaguesInPreviousSession = useMemo(
    () => leagues.filter((l) => l.sessionId === previousSessionId),
    [leagues, previousSessionId]
  );

  const leagueOptions: ChoiceOption<number>[] = useMemo(
    () =>
      leaguesInPreviousSession.map((l) => ({
        value: l.id,
        label: `${l.name} (${DAY_NAMES[l.dayOfWeek]})`,
      })),
    [leaguesInPreviousSession]
  );

  const selectedLeagueRows = useMemo(
    () => leagues.filter((l) => selectedLeagueIds.includes(l.id)),
    [leagues, selectedLeagueIds]
  );

  const targetSession = selectedSessionId != null ? sessionById.get(selectedSessionId) : undefined;

  const anchorRangeInvalid =
    Boolean(anchorStartDate && anchorEndDate && anchorStartDate > anchorEndDate);

  const previewRows = useMemo(() => {
    if (!anchorStartDate || !anchorEndDate || !targetSession || anchorRangeInvalid) return [];
    return selectedLeagueRows.map((l) => {
      const start = firstDowOnOrAfterUtc(anchorStartDate, l.dayOfWeek);
      const end = lastDowOnOrBeforeUtc(anchorEndDate, l.dayOfWeek);
      const rangeOk = start <= end;
      const inSession =
        rangeOk && start >= targetSession.startDate && end <= targetSession.endDate;
      const leagueDayCount = rangeOk ? countWeeklyLeagueDaysInclusive(start, end) : 0;
      return {
        league: l,
        computedStart: start,
        computedEnd: end,
        inSession,
        rangeOk,
        leagueDayCount,
      };
    });
  }, [anchorStartDate, anchorEndDate, anchorRangeInvalid, selectedLeagueRows, targetSession]);

  const previewHasErrors = previewRows.some((r) => !r.rangeOk || !r.inSession);

  const submitDisabled =
    submitting ||
    selectedLeagueIds.length === 0 ||
    selectedSeasonId == null ||
    selectedSessionId == null ||
    !anchorStartDate ||
    !anchorEndDate ||
    anchorRangeInvalid ||
    previewRows.length === 0 ||
    previewHasErrors;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled || selectedSeasonId == null || selectedSessionId == null) return;

    setSubmitting(true);
    try {
      await post('/leagues/bulk-copy-to-session', {
        sourceLeagueIds: selectedLeagueIds,
        seasonId: selectedSeasonId,
        targetSessionId: selectedSessionId,
        anchorStartDate,
        anchorEndDate,
      });
      showAlert('Leagues copied successfully.', 'success');
      navigate('/leagues');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to copy leagues'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage) {
    return (
      <>
        <AppPage>
          <BackButton label="Back to leagues" to="/leagues" className="mb-4" />
          <AppStateCard title="You do not have permission to copy leagues." />
        </AppPage>
      </>
    );
  }

  if (loadingMeta) {
    return (
      <>
        <AppPage>
          <BackButton label="Back to leagues" to="/leagues" className="mb-4" />
          <AppStateCard title="Loading…" />
        </AppPage>
      </>
    );
  }

  return (
    <>
      <AppPage>
        <div className="mb-4">
          <BackButton label="Back to leagues" to="/leagues" />
        </div>
        <AppPageHeader title="Copy leagues to another session" />

        <div className="app-card space-y-6 p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Selected settings are copied to new leagues: name, schedule day, draw times, format, league
            type, capacity, league fee, experience and age limits, registration options, league managers,
            and divisions. Sheet availability, scheduled games, teams, roster members, and exception dates
            are not copied. Each new league lists the source league as its predecessor.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <FormField
              label="Season"
              htmlFor={seasonFieldId}
              required
              helperText="Season that contains the destination session."
            >
              <ChoiceInput<number>
                inputId={seasonFieldId}
                options={seasonOptions}
                value={selectedSeasonId}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) setSelectedSeasonId(next);
                  if (next === null) setSelectedSeasonId(null);
                }}
                listboxLabel="Season"
                placeholder={seasonOptions.length === 0 ? 'No seasons' : 'Select season…'}
                disabled={seasonOptions.length === 0}
              />
            </FormField>

            <FormField
              label="Session"
              htmlFor={sessionFieldId}
              required
              helperText="Registration session where the new leagues will be assigned."
            >
              <ChoiceInput<number>
                inputId={sessionFieldId}
                options={sessionOptions}
                value={selectedSessionId}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) setSelectedSessionId(next);
                  if (next === null) setSelectedSessionId(null);
                }}
                listboxLabel="Session"
                placeholder={
                  selectedSeasonId == null
                    ? 'Select a season first'
                    : sessionOptions.length === 0
                      ? 'No sessions in this season'
                      : 'Select session…'
                }
                disabled={selectedSeasonId == null || sessionOptions.length === 0}
              />
            </FormField>

            <FormField
              label="Leagues to copy"
              htmlFor={leaguesFieldId}
              required
              helperText={
                selectedSessionId == null
                  ? 'Select a destination session to see source leagues.'
                  : previousSessionId == null
                    ? 'There is no earlier registration session to copy from for this destination (for example, the first session of the first season).'
                    : previousSession
                      ? `Only leagues assigned to the previous session — ${previousSession.name} (${previousSession.startDate} – ${previousSession.endDate}) — are listed.`
                      : 'Only leagues from the previous session are listed.'
              }
            >
              <ChoiceInput<number>
                inputId={leaguesFieldId}
                options={leagueOptions}
                value={selectedLeagueIds}
                onChange={(next) => {
                  setSelectedLeagueIds(Array.isArray(next) ? next : next != null ? [next] : []);
                }}
                maxSelectedItems={null}
                listboxLabel="Leagues to copy"
                placeholder={
                  selectedSessionId == null
                    ? 'Select destination session first'
                    : previousSessionId == null
                      ? 'No previous session'
                      : leagueOptions.length === 0
                        ? 'No leagues in previous session'
                        : 'Select leagues…'
                }
                disabled={
                  selectedSessionId == null || previousSessionId == null || leagueOptions.length === 0
                }
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Anchor start date"
                htmlFor={anchorStartId}
                required
                helperText="Each new league starts on the first matching weekday on or after this date."
                error={anchorRangeInvalid ? 'Must be on or before anchor end date.' : undefined}
              >
                <input
                  id={anchorStartId}
                  type="date"
                  className="app-input w-full"
                  value={anchorStartDate}
                  onChange={(e) => setAnchorStartDate(e.target.value)}
                  required
                />
              </FormField>

              <FormField
                label="Anchor end date"
                htmlFor={anchorEndId}
                required
                helperText="Each new league ends on the last matching weekday on or before this date."
              >
                <input
                  id={anchorEndId}
                  type="date"
                  className="app-input w-full"
                  value={anchorEndDate}
                  onChange={(e) => setAnchorEndDate(e.target.value)}
                  required
                />
              </FormField>
            </div>

            {selectedLeagueRows.length > 0 && anchorStartDate && anchorEndDate && targetSession && (
              <div className="space-y-2">
                <h2 className="app-section-title">Computed schedule</h2>
                {previewHasErrors && (
                  <InlineStateMessage
                    tone="warning"
                    title="Fix the anchors or session"
                    description="Every selected league needs at least one matching weekday between the anchors, and the computed range must fall entirely within the destination session."
                  />
                )}
                <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
                  <table className="app-table w-full min-w-[32rem]">
                    <thead className="app-table-head">
                      <tr>
                        <th className="app-table-th text-left">League</th>
                        <th className="app-table-th text-left">Day</th>
                        <th className="app-table-th text-left">Start</th>
                        <th className="app-table-th text-left">End</th>
                        <th className="app-table-th text-right">League days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r) => (
                        <tr key={r.league.id} className="app-table-row">
                          <td className="app-table-td">{r.league.name}</td>
                          <td className="app-table-td">{DAY_NAMES[r.league.dayOfWeek]}</td>
                          <td
                            className={`app-table-td ${!r.rangeOk || !r.inSession ? 'text-red-600 dark:text-red-400' : ''}`}
                          >
                            {r.computedStart}
                          </td>
                          <td
                            className={`app-table-td ${!r.rangeOk || !r.inSession ? 'text-red-600 dark:text-red-400' : ''}`}
                          >
                            {r.computedEnd}
                          </td>
                          <td
                            className={`app-table-td text-right tabular-nums ${!r.rangeOk || !r.inSession ? 'text-red-600 dark:text-red-400' : ''}`}
                          >
                            {r.rangeOk ? r.leagueDayCount : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="submit" disabled={submitDisabled}>
                {submitting ? 'Copying…' : 'Copy leagues'}
              </Button>
            </div>
          </form>
        </div>
      </AppPage>
    </>
  );
}
