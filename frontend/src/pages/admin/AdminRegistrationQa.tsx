import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../../api/client';
import type { paths } from '../../api/generated/types';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn, TableSort } from '../../components/table/tableTypes';
import api, { getApiErrorMessage } from '../../utils/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RETURNING_PLAYER_QA_STATUSES = [
  'not_yet_registered',
  'guaranteed_return',
  'guaranteed_fallback',
  'dropped',
  'third_or_higher',
  'sabbatical',
] as const;

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type ReturningPlayerQaPayload =
  paths['/registration/staff/qa/returning-players']['get']['responses']['200']['content']['application/json'];
type ReturningPlayerQaLeague = ReturningPlayerQaPayload['leagues'][number];
type ReturningPlayerQaPlayer = ReturningPlayerQaPayload['players'][number];
type ReturningPlayerQaStatus = ReturningPlayerQaPlayer['status'];

const STATUS_LABEL: Record<ReturningPlayerQaStatus, string> = {
  not_yet_registered: 'Not yet registered',
  guaranteed_return: 'Registered w/ guaranteed return',
  guaranteed_fallback: 'Registered w/ guaranteed fallback',
  dropped: 'Registered, but dropped league',
  third_or_higher: 'Registered as 3rd (or higher) league choice',
  sabbatical: 'Registered sabbatical',
};

const STATUS_CHIP_CLASS: Record<ReturningPlayerQaStatus, string> = {
  not_yet_registered: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
  guaranteed_return: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  guaranteed_fallback: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
  dropped: 'bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200',
  third_or_higher: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
  sabbatical: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
};

const STATUS_SORT_ORDER: Record<ReturningPlayerQaStatus, number> = {
  not_yet_registered: 0,
  dropped: 1,
  third_or_higher: 2,
  sabbatical: 3,
  guaranteed_fallback: 4,
  guaranteed_return: 5,
};

type QaSortKey = 'name' | 'status' | 'priority';

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function statusLabel(status: ReturningPlayerQaStatus, priorityRank: number | null): string {
  if (status === 'third_or_higher' && priorityRank != null) {
    return `Registered as ${ordinal(priorityRank)} league choice`;
  }
  return STATUS_LABEL[status];
}

function registrationStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (
    status === 'identity_incomplete' ||
    status === 'policies_incomplete' ||
    status === 'demographics_incomplete' ||
    status === 'shell_complete'
  ) {
    return 'In progress';
  }
  if (status === 'cancelled') return 'Canceled';
  return status.replace(/_/g, ' ');
}

function leagueLabel(league: Pick<ReturningPlayerQaLeague, 'name' | 'dayOfWeek'>): string {
  const day = DAY_NAMES[league.dayOfWeek];
  return day ? `${league.name} (${day})` : league.name;
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function AdminRegistrationQa() {
  const sessionFieldId = useId();
  const leagueFieldId = useId();
  const searchFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<ReturningPlayerQaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSort<QaSortKey>>({ key: 'status', direction: 'asc' });

  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const leagueId = Number(searchParams.get('leagueId')) || null;
  const returnStatusParam = searchParams.get('returnStatus');
  const returnStatus = RETURNING_PLAYER_QA_STATUSES.find((status) => status === returnStatusParam) ?? null;

  const setQuery = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const loadSessions = useCallback(async () => {
    const response = await api.get<{ sessions: RegistrationSession[]; defaultSessionId: number | null }>(
      '/registration/staff/sessions',
    );
    setSessions(response.data.sessions);
    setDefaultSessionId(response.data.defaultSessionId);
    if (!searchParams.get('sessionId') && response.data.defaultSessionId) {
      setQuery({ sessionId: String(response.data.defaultSessionId) });
    }
  }, [searchParams, setQuery]);

  const loadQa = useCallback(async () => {
    if (!sessionId) {
      setPayload(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await get('/registration/staff/qa/returning-players', {
        sessionId,
        leagueId: leagueId || undefined,
      });
      setPayload(data);
      if (leagueId && !data.leagues.some((league) => league.id === leagueId)) {
        setQuery({ leagueId: '' });
      }
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load returning-player checks.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, leagueId, setQuery]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadQa();
  }, [loadQa]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  const leagueOptions = useMemo(
    () =>
      (payload?.leagues ?? []).map((league) => ({
        value: String(league.id),
        label: leagueLabel(league),
      })),
    [payload?.leagues],
  );

  const filteredPlayers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const players = (payload?.players ?? []).filter((player) => {
      if (returnStatus && player.status !== returnStatus) return false;
      if (!needle) return true;
      return (
        player.memberName.toLowerCase().includes(needle) || (player.memberEmail ?? '').toLowerCase().includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...players].sort((a, b) => {
      if (sort.key === 'status') {
        const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
        if (statusDiff !== 0) return statusDiff * direction;
      }
      if (sort.key === 'priority') {
        const aRank = a.priorityRank ?? Number.POSITIVE_INFINITY;
        const bRank = b.priorityRank ?? Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return (aRank - bRank) * direction;
      }
      const nameDiff = a.memberName.localeCompare(b.memberName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.memberId - b.memberId;
    });
  }, [payload?.players, returnStatus, search, sort]);

  const columns: Array<DataTableColumn<ReturningPlayerQaPlayer, QaSortKey>> = [
    {
      id: 'name',
      header: 'Curler',
      sortable: true,
      sortKey: 'name',
      renderCell: (row) => (
        <div>
          {row.registrationId ? (
            <Link
              to={`/admin/registrations/${row.registrationId}`}
              className="font-medium text-primary-teal-link hover:underline"
            >
              {row.memberName}
            </Link>
          ) : (
            <div className="font-medium text-gray-900 dark:text-gray-100">{row.memberName}</div>
          )}
          {row.memberEmail ? <div className="text-xs text-gray-500 dark:text-gray-400">{row.memberEmail}</div> : null}
          {row.isTemporarySabbaticalFill ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">Temporary sabbatical fill last session</div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Return status',
      sortable: true,
      sortKey: 'status',
      renderCell: (row) => (
        <span className={joinClasses('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CHIP_CLASS[row.status])}>
          {statusLabel(row.status, row.priorityRank)}
        </span>
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      sortable: true,
      sortKey: 'priority',
      renderCell: (row) => (row.priorityRank != null ? ordinal(row.priorityRank) : '—'),
    },
    {
      id: 'registration',
      header: 'Registration',
      renderCell: (row) =>
        row.registrationId ? (
          <Link
            to={`/admin/registrations/${row.registrationId}`}
            className="text-primary-teal-link hover:underline"
          >
            {registrationStatusLabel(row.registrationStatus)}
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  const emptyTitle = !sessionId
    ? 'Select a session'
    : !leagueId
      ? 'Select a league'
      : payload && !payload.predecessor
        ? 'No previous session roster'
        : payload && payload.players.length === 0
          ? 'No rostered players'
          : 'No matching players';

  const emptyDescription = !sessionId
    ? 'Select a session to review returning players.'
    : !leagueId
      ? 'Select a league to see who from last session has registered to return.'
      : payload && !payload.predecessor
        ? `${payload.league?.name ?? 'This league'} has no predecessor, so there is no previous-session roster to check.`
        : payload && payload.players.length === 0
          ? `No rostered players were found for ${payload.predecessor?.name ?? 'the previous session'}.`
          : returnStatus || search.trim()
            ? 'No returning players match the current filters.'
            : 'No rostered players were found for this league last session.';

  return (
    <>
      <AppPageControlsRow
        left={
          <>
            <FormField label="Session" htmlFor={sessionFieldId}>
              <ChoiceInput
                inputId={sessionFieldId}
                layout="popover"
                value={sessionId ? String(sessionId) : ''}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next) return;
                  setQuery({ sessionId: next, leagueId: '', returnStatus: '' });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField
              label="League"
              htmlFor={leagueFieldId}
              state={!sessionId || leagueOptions.length === 0 ? 'disabled' : 'default'}
              stateMessage={
                !sessionId
                  ? 'Select a session first.'
                  : sessionId && leagueOptions.length === 0 && !loading
                    ? 'No leagues are assigned to this session.'
                    : undefined
              }
            >
              <ChoiceInput
                inputId={leagueFieldId}
                layout="popover"
                value={leagueId ? String(leagueId) : ''}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setQuery({ leagueId: next ? String(next) : '', returnStatus: '' });
                }}
                options={leagueOptions}
                placeholder={sessionId ? 'Select league' : 'Select a session first'}
                disabled={!sessionId || leagueOptions.length === 0}
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or email"
              />
            </FormField>
          </>
        }
      />

      <section className="space-y-4">
        <div>
          <h2 className="app-section-title">Returning players</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Rostered players from this league last session, and how they registered for the current session.
          </p>
        </div>

        {error ? (
          <AppStateCard
            title="Unable to load returning-player checks"
            description={error}
            action={
              <Button type="button" onClick={() => void loadQa()}>
                Try again
              </Button>
            }
          />
        ) : null}

        {!error && loading && !payload ? (
          <AppStateCard title="Loading returning players" description="Checking last session’s roster against current registrations." />
        ) : null}

        {!error && payload && leagueId && payload.players.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by return status">
            <button
              type="button"
              aria-pressed={returnStatus == null}
              className={joinClasses(
                'rounded-full px-3 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30',
                returnStatus == null
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
              )}
              onClick={() => setQuery({ returnStatus: '' })}
            >
              All ({payload.players.length})
            </button>
            {RETURNING_PLAYER_QA_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={returnStatus === status}
                className={joinClasses(
                  'rounded-full px-3 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30',
                  returnStatus === status ? STATUS_CHIP_CLASS[status] : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
                )}
                onClick={() => setQuery({ returnStatus: returnStatus === status ? '' : status })}
              >
                {STATUS_LABEL[status]} ({payload.counts[status]})
              </button>
            ))}
          </div>
        ) : null}

        {!error && (!loading || payload) ? (
          !sessionId || !leagueId || !payload || payload.players.length === 0 || filteredPlayers.length === 0 ? (
            <AppStateCard title={emptyTitle} description={emptyDescription} />
          ) : (
            <DataTable
              rows={filteredPlayers}
              rowKey={(row) => row.memberId}
              columns={columns}
              sort={sort}
              onSortChange={setSort}
              loading={loading}
              emptyState={<InlineStateMessage title="No matching players" description={emptyDescription} />}
            />
          )
        ) : null}
      </section>
    </>
  );
}
