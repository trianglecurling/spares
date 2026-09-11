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
import MemberEmail from '../../components/MemberEmail';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn, TableSort } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import api, { getApiErrorMessage } from '../../utils/api';
import { namedCopyEmailEntries } from '../../utils/memberParentEmail';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type RequestedLeaguesQaPayload =
  paths['/registration/staff/qa/requested-leagues']['get']['responses']['200']['content']['application/json'];
type RequestedLeaguesQaRow = RequestedLeaguesQaPayload['members'][number];

type QaSortKey = 'name' | 'status' | 'requested' | 'rostered';
type RequestedLeaguesMismatch = 'over' | 'short';

function leagueLabel(league: Pick<RequestedLeaguesQaRow['rosteredLeagues'][number], 'name' | 'dayOfWeek'>): string {
  const day = DAY_NAMES[league.dayOfWeek];
  return day ? `${league.name} (${day})` : league.name;
}

function requestedLeaguesMismatch(row: Pick<RequestedLeaguesQaRow, 'requestedLeagueCount' | 'rosteredLeagueCount'>): RequestedLeaguesMismatch {
  return row.rosteredLeagueCount > row.requestedLeagueCount ? 'over' : 'short';
}

const MISMATCH_LABEL: Record<RequestedLeaguesMismatch, string> = {
  over: 'Over requested',
  short: 'Short',
};

const MISMATCH_CHIP_CLASS: Record<RequestedLeaguesMismatch, string> = {
  over: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  short: 'bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200',
};

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function requestedLeaguesSummary(total: number, overCount: number, shortCount: number): string {
  if (total === 0) return 'Everyone is rostered in exactly as many leagues as they requested.';
  if (overCount > 0 && shortCount > 0) {
    return `${countLabel(overCount, 'member is', 'members are')} rostered in more leagues than they requested, and ${countLabel(shortCount, 'is', 'are')} short. Over-requested members are listed first.`;
  }
  if (overCount > 0) {
    return `${countLabel(overCount, 'member is', 'members are')} rostered in more leagues than they requested.`;
  }
  return `${countLabel(shortCount, 'member is', 'members are')} rostered in fewer leagues than they requested.`;
}

function emailEntriesForRequestedLeagues(members: RequestedLeaguesQaRow[]): string[] {
  return namedCopyEmailEntries(
    members.map((member) => ({
      name: member.memberName,
      email: member.memberEmail,
      parentEmail: member.parentEmail,
    })),
  );
}

function registrationStatusLabel(status: string): string {
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

export default function AdminRegistrationQaRequestedLeagues() {
  const { showAlert } = useAlert();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<RequestedLeaguesQaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSort<QaSortKey>>({ key: 'status', direction: 'asc' });

  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;

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
      const data = await get('/registration/staff/qa/requested-leagues', { sessionId });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load requested leagues.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

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

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const members = (payload?.members ?? []).filter((member) => {
      if (!needle) return true;
      const requestedText = member.requestedLeagues.map((league) => leagueLabel(league)).join(' ').toLowerCase();
      const rosteredText = member.rosteredLeagues.map((league) => leagueLabel(league)).join(' ').toLowerCase();
      const statusText = MISMATCH_LABEL[requestedLeaguesMismatch(member)].toLowerCase();
      return (
        member.memberName.toLowerCase().includes(needle) ||
        (member.memberEmail ?? '').toLowerCase().includes(needle) ||
        (member.parentEmail ?? '').toLowerCase().includes(needle) ||
        requestedText.includes(needle) ||
        rosteredText.includes(needle) ||
        statusText.includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...members].sort((a, b) => {
      if (sort.key === 'status') {
        const aOver = requestedLeaguesMismatch(a) === 'over';
        const bOver = requestedLeaguesMismatch(b) === 'over';
        if (aOver !== bOver) return (aOver ? -1 : 1) * direction;
        if (aOver) {
          const surplusDiff =
            b.rosteredLeagueCount - b.requestedLeagueCount - (a.rosteredLeagueCount - a.requestedLeagueCount);
          if (surplusDiff !== 0) return surplusDiff * direction;
        } else if (a.rosteredLeagueCount !== b.rosteredLeagueCount) {
          return (a.rosteredLeagueCount - b.rosteredLeagueCount) * direction;
        }
      }
      if (sort.key === 'rostered' && a.rosteredLeagueCount !== b.rosteredLeagueCount) {
        return (a.rosteredLeagueCount - b.rosteredLeagueCount) * direction;
      }
      if (sort.key === 'requested' && a.requestedLeagueCount !== b.requestedLeagueCount) {
        return (a.requestedLeagueCount - b.requestedLeagueCount) * direction;
      }
      const aFirst = a.memberFirstName.trim() || a.memberName;
      const bFirst = b.memberFirstName.trim() || b.memberName;
      const firstNameDiff = aFirst.localeCompare(bFirst);
      if (firstNameDiff !== 0) return firstNameDiff * (sort.key === 'name' ? direction : 1);
      const nameDiff = a.memberName.localeCompare(b.memberName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.memberId - b.memberId;
    });
  }, [payload?.members, search, sort]);

  const mismatchCounts = useMemo(() => {
    let overCount = 0;
    let shortCount = 0;
    for (const member of payload?.members ?? []) {
      if (requestedLeaguesMismatch(member) === 'over') overCount += 1;
      else shortCount += 1;
    }
    return { overCount, shortCount };
  }, [payload?.members]);

  const handleCopyEmails = async () => {
    const entries = emailEntriesForRequestedLeagues(filteredMembers);
    if (entries.length === 0) {
      showAlert('No emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Requested league emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const columns: Array<DataTableColumn<RequestedLeaguesQaRow, QaSortKey>> = [
    {
      id: 'name',
      header: 'Curler',
      sortable: true,
      sortKey: 'name',
      renderCell: (row) => (
        <div>
          <Link
            to={`/admin/registrations/${row.registrationId}`}
            className="font-medium text-primary-teal-link hover:underline"
          >
            {row.memberName}
          </Link>
          {row.memberEmail ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <MemberEmail email={row.memberEmail} parentEmail={row.parentEmail} />
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      sortKey: 'status',
      defaultSortDirection: 'asc',
      cellClassName: 'align-top',
      renderCell: (row) => {
        const mismatch = requestedLeaguesMismatch(row);
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MISMATCH_CHIP_CLASS[mismatch]}`}>
            {MISMATCH_LABEL[mismatch]}
          </span>
        );
      },
    },
    {
      id: 'requested',
      header: 'Requested',
      sortable: true,
      sortKey: 'requested',
      cellClassName: 'align-top',
      renderCell: (row) => (
        <div>
          <div className="tabular-nums">{row.requestedLeagueCount}</div>
          {row.requestedLeagues.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              {row.requestedLeagues.map((league) => (
                <div key={league.id}>{leagueLabel(league)}</div>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'rostered',
      header: 'Rostered',
      sortable: true,
      sortKey: 'rostered',
      defaultSortDirection: 'asc',
      cellClassName: 'align-top',
      renderCell: (row) => (
        <div>
          <div className="tabular-nums">{row.rosteredLeagueCount}</div>
          {row.rosteredLeagues.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              {row.rosteredLeagues.map((league) => (
                <div key={league.id}>{leagueLabel(league)}</div>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'registration',
      header: 'Registration',
      renderCell: (row) => (
        <Link to={`/admin/registrations/${row.registrationId}`} className="text-primary-teal-link hover:underline">
          {registrationStatusLabel(row.registrationStatus)}
        </Link>
      ),
    },
  ];

  const summary = payload
    ? requestedLeaguesSummary(payload.members.length, mismatchCounts.overCount, mismatchCounts.shortCount)
    : 'Members whose current roster count does not match the number of leagues they requested.';

  const emptyTitle = !sessionId
    ? 'Select a session'
    : payload && payload.members.length === 0
      ? 'Everyone matches their requested leagues'
      : 'No matching members';
  const emptyDescription = !sessionId
    ? 'Select a session to see whose roster count does not match the leagues they requested.'
    : payload && payload.members.length === 0
      ? `Every submitted registration for ${payload.sessionName} is rostered in exactly as many leagues as they requested.`
      : 'No members match the current search.';

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
                  setQuery({ sessionId: next });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email, league, or status"
              />
            </FormField>
          </>
        }
        right={
          <Button type="button" variant="secondary" onClick={() => void handleCopyEmails()} disabled={loading}>
            Copy emails
          </Button>
        }
      />

      <section className="space-y-4">
        <div>
          <h2 className="app-section-title">Requested leagues</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {summary}
          </p>
        </div>

        {error ? (
          <AppStateCard
            title="Unable to load requested leagues"
            description={error}
            action={
              <Button type="button" onClick={() => void loadQa()}>
                Try again
              </Button>
            }
          />
        ) : null}

        {!error && loading && !payload ? (
          <AppStateCard
            title="Loading requested leagues"
            description="Comparing requested league counts with current rosters."
          />
        ) : null}

        {!error && (!loading || payload) ? (
          !sessionId || !payload || payload.members.length === 0 || filteredMembers.length === 0 ? (
            <AppStateCard title={emptyTitle} description={emptyDescription} />
          ) : (
            <DataTable
              rows={filteredMembers}
              rowKey={(row) => row.memberId}
              columns={columns}
              sort={sort}
              onSortChange={setSort}
              loading={loading}
              emptyState={<InlineStateMessage title="No matching members" description={emptyDescription} />}
            />
          )
        ) : null}
      </section>
    </>
  );
}
