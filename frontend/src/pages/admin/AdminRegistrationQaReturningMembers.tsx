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
import { useAlert } from '../../contexts/AlertContext';
import api, { getApiErrorMessage } from '../../utils/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type ReturningMembersQaPayload =
  paths['/registration/staff/qa/returning-members']['get']['responses']['200']['content']['application/json'];
type ReturningMemberQaRow = ReturningMembersQaPayload['members'][number];

type QaSortKey = 'name' | 'leagues';

function leagueLabel(league: Pick<ReturningMemberQaRow['previousLeagues'][number], 'name' | 'dayOfWeek'>): string {
  const day = DAY_NAMES[league.dayOfWeek];
  return day ? `${league.name} (${day})` : league.name;
}

function sessionLabel(session: { seasonName: string | null; name: string } | null | undefined): string {
  if (!session) return 'the previous session';
  return session.seasonName ? `${session.seasonName} / ${session.name}` : session.name;
}

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailEntriesForReturningMembers(members: ReturningMemberQaRow[]): string[] {
  const entries: string[] = [];
  const seenEmails = new Set<string>();
  for (const member of members) {
    const email = member.memberEmail?.trim() ?? '';
    if (!email || !EMAIL_ADDRESS_RE.test(email)) continue;
    const emailKey = email.toLowerCase();
    if (seenEmails.has(emailKey)) continue;
    seenEmails.add(emailKey);
    const displayName = member.memberName.trim() || email;
    entries.push(`"${displayName}" <${email}>`);
  }
  return entries;
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

export default function AdminRegistrationQaReturningMembers() {
  const { showAlert } = useAlert();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<ReturningMembersQaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<TableSort<QaSortKey>>({ key: 'name', direction: 'asc' });

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
      const data = await get('/registration/staff/qa/returning-members', { sessionId });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load returning members.'));
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
      const leagueText = member.previousLeagues.map((league) => leagueLabel(league)).join(' ').toLowerCase();
      return (
        member.memberName.toLowerCase().includes(needle) ||
        (member.memberEmail ?? '').toLowerCase().includes(needle) ||
        leagueText.includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...members].sort((a, b) => {
      if (sort.key === 'leagues') {
        const aLeagues = a.previousLeagues.map((league) => leagueLabel(league)).join(', ');
        const bLeagues = b.previousLeagues.map((league) => leagueLabel(league)).join(', ');
        const leagueDiff = aLeagues.localeCompare(bLeagues);
        if (leagueDiff !== 0) return leagueDiff * direction;
      }
      const nameDiff = a.memberName.localeCompare(b.memberName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.memberId - b.memberId;
    });
  }, [payload?.members, search, sort]);

  const handleCopyEmails = async () => {
    const entries = emailEntriesForReturningMembers(filteredMembers);
    if (entries.length === 0) {
      showAlert('No emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Returning member emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const columns: Array<DataTableColumn<ReturningMemberQaRow, QaSortKey>> = [
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
        </div>
      ),
    },
    {
      id: 'leagues',
      header: 'Last session leagues',
      sortable: true,
      sortKey: 'leagues',
      renderCell: (row) =>
        row.previousLeagues.length > 0 ? (
          <div className="space-y-0.5">
            {row.previousLeagues.map((league) => (
              <div key={league.id}>{leagueLabel(league)}</div>
            ))}
          </div>
        ) : (
          '—'
        ),
    },
    {
      id: 'registration',
      header: 'Registration',
      renderCell: (row) =>
        row.registrationId ? (
          <Link to={`/admin/registrations/${row.registrationId}`} className="text-primary-teal-link hover:underline">
            {registrationStatusLabel(row.registrationStatus)}
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  const previousSessionLabel = sessionLabel(payload?.predecessorSession);
  const emptyTitle = !sessionId
    ? 'Select a session'
    : payload && !payload.predecessorSession
      ? 'No previous session'
      : payload && payload.previousRosterCount === 0
        ? 'No rostered players'
        : payload && payload.members.length === 0
          ? 'Everyone registered'
          : 'No matching members';
  const emptyDescription = !sessionId
    ? 'Select a session to see who from last session has not registered yet.'
    : payload && !payload.predecessorSession
      ? `${payload.sessionName} is the earliest session, so there is no previous-session roster to check.`
      : payload && payload.previousRosterCount === 0
        ? `No rostered players were found for ${previousSessionLabel}.`
        : payload && payload.members.length === 0
          ? `Every member rostered in ${previousSessionLabel} has submitted a registration for this session.`
          : 'No returning members match the current search.';

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
                placeholder="Name, email, or league"
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
          <h2 className="app-section-title">Returning members</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {payload?.predecessorSession
              ? `${payload.members.length} ${payload.members.length === 1 ? 'member' : 'members'} rostered in ${sessionLabel(payload.predecessorSession)} who ${payload.members.length === 1 ? 'has' : 'have'} not submitted a registration for this session.`
              : 'Members rostered in the previous session who have not submitted a registration for this session.'}
          </p>
        </div>

        {error ? (
          <AppStateCard
            title="Unable to load returning members"
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
            title="Loading returning members"
            description="Checking last session’s roster against current registrations."
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
