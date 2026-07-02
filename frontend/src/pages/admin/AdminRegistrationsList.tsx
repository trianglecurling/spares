import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import api, { getApiErrorMessage } from '../../utils/api';

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

const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'awaiting_staff_review', label: 'Awaiting staff review' },
  { value: 'awaiting_placement', label: 'Awaiting placement' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'payment_started', label: 'Payment started' },
  { value: 'paid', label: 'Paid' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Canceled' },
];

function label(value: string | null | undefined) {
  if (!value) return 'Not available';
  if (value === 'cancelled') return 'Canceled';
  return value.replace(/_/g, ' ');
}

function money(minor: number | null) {
  if (minor == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

export default function AdminRegistrationsList() {
  const sessionFieldId = useId();
  const statusFieldId = useId();
  const searchFieldId = useId();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';

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

  const loadRegistrations = useCallback(async () => {
    if (!sessionId) return;
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
  }, [sessionId, search, status, page]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

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
          <Link to={`/admin/registrations/${row.id}`} className="font-medium text-primary-teal hover:underline">
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
        left={
          <>
            <FormField label="Session" htmlFor={sessionFieldId}>
              <ChoiceInput
                inputId={sessionFieldId}
                layout="popover"
                value={sessionId ? String(sessionId) : ''}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (next) setQuery({ sessionId: next, page: '1' });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField label="Status" htmlFor={statusFieldId}>
              <ChoiceInput
                inputId={statusFieldId}
                layout="popover"
                value={status}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setQuery({ status: next ?? '', page: '1' });
                }}
                options={STATUS_OPTIONS}
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={search}
                onChange={(event) => setQuery({ search: event.target.value, page: '1' })}
                placeholder="Name, email, or registration ID"
              />
            </FormField>
          </>
        }
      />

      {loading ? <AppStateCard title="Loading registrations" description="Gathering session registrations." /> : null}
      {error ? (
        <AppStateCard
          title="Unable to load registrations"
          description={error}
          action={<Button onClick={() => void loadRegistrations()}>Try again</Button>}
        />
      ) : null}

      {!loading && !error ? (
        <DataTable
          columns={columns}
          rows={registrations}
          rowKey={(row) => row.id}
          emptyState={
            <AppStateCard
              compact
              title="No registrations found"
              description="Try another session, status filter, or search term."
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
    </>
  );
}
