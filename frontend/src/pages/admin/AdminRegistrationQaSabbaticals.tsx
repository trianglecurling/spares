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

type SabbaticalsQaPayload =
  paths['/registration/staff/qa/sabbaticals']['get']['responses']['200']['content']['application/json'];
type SabbaticalQaRow = SabbaticalsQaPayload['members'][number];

type QaSortKey = 'name' | 'leagues';

function leagueLabel(league: Pick<SabbaticalQaRow['leagues'][number], 'name' | 'dayOfWeek'>): string {
  const day = DAY_NAMES[league.dayOfWeek];
  return day ? `${league.name} (${day})` : league.name;
}

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailEntriesForSabbaticalMembers(members: SabbaticalQaRow[]): string[] {
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

export default function AdminRegistrationQaSabbaticals() {
  const { showAlert } = useAlert();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<SabbaticalsQaPayload | null>(null);
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
      const data = await get('/registration/staff/qa/sabbaticals', { sessionId });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load sabbaticals.'));
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
      const leagueText = member.leagues.map((league) => leagueLabel(league)).join(' ').toLowerCase();
      return (
        member.memberName.toLowerCase().includes(needle) ||
        (member.memberEmail ?? '').toLowerCase().includes(needle) ||
        leagueText.includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...members].sort((a, b) => {
      if (sort.key === 'leagues') {
        const aLeagues = a.leagues.map((league) => leagueLabel(league)).join(', ');
        const bLeagues = b.leagues.map((league) => leagueLabel(league)).join(', ');
        const leagueDiff = aLeagues.localeCompare(bLeagues);
        if (leagueDiff !== 0) return leagueDiff * direction;
      }
      const nameDiff = a.memberName.localeCompare(b.memberName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.memberId - b.memberId;
    });
  }, [payload?.members, search, sort]);

  const handleCopyEmails = async () => {
    const entries = emailEntriesForSabbaticalMembers(filteredMembers);
    if (entries.length === 0) {
      showAlert('No emails to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(entries.join(', '));
      showAlert('Sabbatical emails copied', 'success');
    } catch {
      showAlert('Failed to copy emails', 'error');
    }
  };

  const columns: Array<DataTableColumn<SabbaticalQaRow, QaSortKey>> = [
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
          {row.memberEmail ? <div className="text-xs text-gray-500 dark:text-gray-400">{row.memberEmail}</div> : null}
        </div>
      ),
    },
    {
      id: 'leagues',
      header: 'Leagues',
      sortable: true,
      sortKey: 'leagues',
      renderCell: (row) =>
        row.leagues.length > 0 ? (
          <div className="space-y-0.5">
            {row.leagues.map((league) => (
              <div key={league.id}>{leagueLabel(league)}</div>
            ))}
          </div>
        ) : (
          '—'
        ),
    },
  ];

  const emptyTitle = !sessionId
    ? 'Select a session'
    : payload && payload.members.length === 0
      ? 'No sabbaticals'
      : 'No matching members';
  const emptyDescription = !sessionId
    ? 'Select a session to see who registered a sabbatical.'
    : payload && payload.members.length === 0
      ? `No members registered a sabbatical for ${payload.sessionName}.`
      : 'No sabbatical registrations match the current search.';

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
          <h2 className="app-section-title">Sabbaticals</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {payload
              ? `${payload.members.length} ${payload.members.length === 1 ? 'member' : 'members'} registered a sabbatical for this session.`
              : 'Members who registered a sabbatical for this session, and the leagues they chose.'}
          </p>
        </div>

        {error ? (
          <AppStateCard
            title="Unable to load sabbaticals"
            description={error}
            action={
              <Button type="button" onClick={() => void loadQa()}>
                Try again
              </Button>
            }
          />
        ) : null}

        {!error && loading && !payload ? (
          <AppStateCard title="Loading sabbaticals" description="Finding members who registered a sabbatical for this session." />
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
