import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import QueryBuilder, { type QueryBuilderField } from '../../components/QueryBuilder';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import api, { getApiErrorMessage } from '../../utils/api';
import AdminRegistrationsExportDialog from './AdminRegistrationsExportDialog';
import AdminRegistrationSessionStats, {
  type AdminRegistrationSessionStatsPayload,
} from './AdminRegistrationSessionStats';
import {
  parseRegistrationStaffQueryParam,
  serializeRegistrationStaffQuery,
  type RegistrationStaffQuery,
} from './registrationStaffQuery';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type RegistrationSummary = {
  id: number;
  curlerId: number | null;
  curlerName: string;
  curlerEmail: string | null;
  seasonName: string;
  sessionName: string;
  registrationStatus: string;
  membershipOption: string;
  paymentStatus: string | null;
  amountDueMinor: number | null;
  submittedAt: string | null;
  updatedAt: string | null;
};

type RegistrationFilterFieldsResponse = {
  matchOperators: Array<{ value: 'all' | 'any'; label: string }>;
  operators: Array<{ value: string; label: string }>;
  fields: QueryBuilderField[];
};

const PAGE_SIZE = 50;

function label(value: string | null | undefined) {
  if (!value) return 'Not available';
  if (value === 'cancelled') return 'Canceled';
  return value.replace(/_/g, ' ');
}

function money(minor: number | null) {
  if (minor == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

type AdminRegistrationsListProps = {
  mode: 'summary' | 'list';
};

export default function AdminRegistrationsList({ mode }: AdminRegistrationsListProps) {
  const navigate = useNavigate();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(mode === 'list');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminRegistrationSessionStatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [fields, setFields] = useState<QueryBuilderField[]>([]);
  const [matchOptions, setMatchOptions] = useState<Array<{ value: 'all' | 'any'; label: string }>>([]);
  const [operatorLabels, setOperatorLabels] = useState<Array<{ value: string; label: string }>>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const q = searchParams.get('q') ?? '';
  const query = useMemo(() => parseRegistrationStaffQueryParam(q), [q]);

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

  const [searchDraft, setSearchDraft] = useState(search);
  const [searchDraftSource, setSearchDraftSource] = useState(search);
  if (searchDraftSource !== search) {
    setSearchDraft(search);
    setSearchDraftSource(search);
  }

  const applyQuery = useCallback(
    (nextQuery: RegistrationStaffQuery) => {
      setQuery({
        q: serializeRegistrationStaffQuery(nextQuery),
        search: searchDraft,
        status: '',
        page: '1',
      });
    },
    [searchDraft, setQuery],
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

  const loadStats = useCallback(async () => {
    if (!sessionId) return;
    setStats(null);
    setStatsLoading(true);
    setStatsError(null);
    try {
      const response = await api.get<AdminRegistrationSessionStatsPayload>('/registration/staff/stats', {
        params: { sessionId },
      });
      setStats(response.data);
    } catch (err) {
      setStatsError(getApiErrorMessage(err, 'Unable to load session summary.'));
    } finally {
      setStatsLoading(false);
    }
  }, [sessionId]);

  const loadFilterFields = useCallback(async () => {
    if (!sessionId) return;
    setFieldsLoading(true);
    setFieldsError(null);
    try {
      const response = await api.get<RegistrationFilterFieldsResponse>('/registration/staff/filter-fields', {
        params: { sessionId },
      });
      setFields(response.data.fields);
      setMatchOptions(response.data.matchOperators);
      setOperatorLabels(response.data.operators);
    } catch (err) {
      setFields([]);
      setFieldsError(getApiErrorMessage(err, 'Unable to load filter fields.'));
    } finally {
      setFieldsLoading(false);
    }
  }, [sessionId]);

  const loadRegistrations = useCallback(async () => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{
        registrations: RegistrationSummary[];
        total: number;
        page: number;
        pageSize: number;
      }>('/registration/staff/registrations', {
        params: {
          sessionId,
          search: search || undefined,
          status: status || undefined,
          q: q || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      });
      setRegistrations(response.data.registrations);
      setTotal(response.data.total);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load registrations.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, search, status, q, page]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    if (mode !== 'list' || !status || q) return;
    applyQuery({
      match: 'all',
      rules: [{ field: 'status', operator: 'eq', value: status }],
    });
  }, [applyQuery, mode, q, status]);

  useEffect(() => {
    if (mode !== 'list') return;
    void loadRegistrations();
  }, [mode, loadRegistrations]);

  useEffect(() => {
    if (mode !== 'list') return;
    if (!sessionId) {
      setFields([]);
      setFieldsError(null);
      return;
    }
    void loadFilterFields();
  }, [mode, sessionId, loadFilterFields]);

  useEffect(() => {
    if (mode !== 'summary') return;
    if (!sessionId) {
      setStats(null);
      setStatsError(null);
      return;
    }
    void loadStats();
  }, [mode, sessionId, loadStats]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  const columns: Array<DataTableColumn<RegistrationSummary>> = [
    {
      id: 'curler',
      header: 'Curler',
      renderCell: (row) => (
        <div>
          <Link to={`/admin/registrations/${row.id}`} className="font-medium text-primary-teal-link hover:underline">
            {row.curlerName}
          </Link>
          {row.curlerEmail ? <div className="text-xs text-gray-500 dark:text-gray-400">{row.curlerEmail}</div> : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Registration status',
      renderCell: (row) => label(row.registrationStatus),
    },
    {
      id: 'payment',
      header: 'Payment',
      renderCell: (row) => (
        <div>
          <div>{label(row.paymentStatus)}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{money(row.amountDueMinor)}</div>
        </div>
      ),
    },
    {
      id: 'membership',
      header: 'Membership',
      renderCell: (row) => label(row.membershipOption),
    },
    {
      id: 'updated',
      header: 'Updated',
      renderCell: (row) => (row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'),
    },
  ];

  return (
    <>
      <AppPageControlsRow
        right={
          mode === 'list' ? (
            <>
              <span title={!sessionId ? 'Select a session to export' : undefined}>
                <Button type="button" variant="secondary" onClick={() => setExportOpen(true)} disabled={!sessionId}>
                  Export
                </Button>
              </span>
              <Button
                type="button"
                onClick={() =>
                  navigate(sessionId ? `/admin/registrations/new?sessionId=${sessionId}` : '/admin/registrations/new')
                }
              >
                Create registration
              </Button>
            </>
          ) : undefined
        }
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
                  if (mode === 'list') setQuery({ sessionId: next, page: '1', q: '', status: '' });
                  else setQuery({ sessionId: next });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            {mode === 'list' ? (
              <FormField label="Search" htmlFor={searchFieldId}>
                <input
                  id={searchFieldId}
                  className="app-input"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    applyQuery(query);
                  }}
                  placeholder="Name, email, or registration ID"
                />
              </FormField>
            ) : null}
          </>
        }
      />

      {mode === 'summary' && error ? (
        <AppStateCard
          title="Unable to load sessions"
          description={error}
          action={
            <Button
              onClick={() =>
                void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')))
              }
            >
              Try again
            </Button>
          }
        />
      ) : null}

      {mode === 'summary' && sessionId ? (
        <AdminRegistrationSessionStats
          stats={stats}
          loading={statsLoading}
          error={statsError}
          onRetry={() => void loadStats()}
        />
      ) : null}

      {mode === 'list' && sessionId ? (
        <>
          {fieldsError ? (
            <AppStateCard
              compact
              title="Unable to load filter fields"
              description={fieldsError}
              action={<Button onClick={() => void loadFilterFields()}>Try again</Button>}
            />
          ) : null}
          <QueryBuilder
            query={query}
            onChange={applyQuery}
            fields={fields}
            matchOptions={matchOptions}
            operatorLabels={operatorLabels}
            disabled={!sessionId}
            loading={fieldsLoading}
          />
        </>
      ) : null}

      {mode === 'list' && loading ? (
        <AppStateCard title="Loading registrations" description="Gathering session registrations." />
      ) : null}
      {mode === 'list' && error ? (
        <AppStateCard
          title="Unable to load registrations"
          description={error}
          action={<Button onClick={() => void loadRegistrations()}>Try again</Button>}
        />
      ) : null}

      {mode === 'list' && !loading && !error ? (
        <DataTable
          columns={columns}
          rows={registrations}
          rowKey={(row) => row.id}
          emptyState={
            <AppStateCard
              compact
              title="No registrations found"
              description="Try another session, filter, or search term."
            />
          }
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            totalRecords: total,
            currentCount: registrations.length,
            onPageChange: (nextPage) => setQuery({ page: String(nextPage) }),
          }}
        />
      ) : null}

      <AdminRegistrationsExportDialog
        isOpen={exportOpen}
        sessionId={sessionId}
        search={search}
        status={status}
        q={q}
        onClose={() => setExportOpen(false)}
      />
    </>
  );
}
