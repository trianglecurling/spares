import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post } from '../../api/client';
import type { paths } from '../../api/generated/types';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import IssueRegistrationRefundModal from '../../components/registration/IssueRegistrationRefundModal';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn, TableSort } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { getApiErrorMessage } from '../../utils/api';

type RegistrationSession = {
  id: number;
  seasonId: number;
  seasonName: string;
  name: string;
  isDefault: boolean;
};

type BillingPayload = paths['/registration/staff/billing']['get']['responses']['200']['content']['application/json'];
type BillingRow = BillingPayload['registrations'][number];

type BalanceFilter = 'all' | 'due' | 'credit' | 'settled';
type BillingSortKey = 'name' | 'owed' | 'paid' | 'balance';

const PAGE_SIZE = 50;
const DEFAULT_REFUND_NOTE = 'Registration overpayment refund';

const BALANCE_FILTER_OPTIONS: Array<{ value: BalanceFilter; label: string }> = [
  { value: 'all', label: 'All balances' },
  { value: 'due', label: 'Owes payment' },
  { value: 'credit', label: 'Overpaid' },
  { value: 'settled', label: 'Settled' },
];

function registrationStatusLabel(value: string) {
  if (value === 'cancelled') return 'Canceled';
  return value.replace(/_/g, ' ');
}

function money(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function matchesBalanceFilter(balanceMinor: number, filter: BalanceFilter): boolean {
  if (filter === 'due') return balanceMinor > 0;
  if (filter === 'credit') return balanceMinor < 0;
  if (filter === 'settled') return balanceMinor === 0;
  return true;
}

export default function AdminRegistrationBilling() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const sessionFieldId = useId();
  const searchFieldId = useId();
  const balanceFieldId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RegistrationSession[]>([]);
  const [defaultSessionId, setDefaultSessionId] = useState<number | null>(null);
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [refundRow, setRefundRow] = useState<BillingRow | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const sessionId = Number(searchParams.get('sessionId')) || defaultSessionId;
  const search = searchParams.get('search') ?? '';
  const balanceFilter = (searchParams.get('balance') as BalanceFilter) || 'all';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortKey = (['name', 'owed', 'paid', 'balance'] as const).includes(
    searchParams.get('sort') as BillingSortKey,
  )
    ? (searchParams.get('sort') as BillingSortKey)
    : 'balance';
  const defaultOrder = sortKey === 'balance' ? 'desc' : 'asc';
  const rawOrder = searchParams.get('order');
  const sortDirection = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : defaultOrder;
  const sort: TableSort<BillingSortKey> = { key: sortKey, direction: sortDirection };

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

  const loadBilling = useCallback(async () => {
    if (!sessionId) {
      setLoading(false);
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await get('/registration/staff/billing', { sessionId });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(getApiErrorMessage(err, 'Unable to load registration billing.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSessions().catch((err) => setError(getApiErrorMessage(err, 'Unable to load sessions.')));
  }, [loadSessions]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: String(session.id),
        label: `${session.seasonName} / ${session.name}`,
      })),
    [sessions],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (payload?.registrations ?? []).filter((row) => {
      if (!matchesBalanceFilter(row.balanceMinor, ['all', 'due', 'credit', 'settled'].includes(balanceFilter) ? balanceFilter : 'all')) {
        return false;
      }
      if (!needle) return true;
      return (
        row.curlerName.toLowerCase().includes(needle) ||
        (row.curlerEmail ?? '').toLowerCase().includes(needle) ||
        String(row.registrationId).includes(needle)
      );
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === 'owed') {
        const diff = a.owedMinor - b.owedMinor;
        if (diff !== 0) return diff * direction;
      }
      if (sort.key === 'paid') {
        const diff = a.paidMinor - b.paidMinor;
        if (diff !== 0) return diff * direction;
      }
      if (sort.key === 'balance') {
        const diff = a.balanceMinor - b.balanceMinor;
        if (diff !== 0) return diff * direction;
      }
      const nameDiff = a.curlerName.localeCompare(b.curlerName);
      if (nameDiff !== 0) return nameDiff * (sort.key === 'name' ? direction : 1);
      return a.registrationId - b.registrationId;
    });
  }, [balanceFilter, payload?.registrations, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const dueCount = payload?.registrations.filter((row) => row.balanceMinor > 0).length ?? 0;
  const creditCount = payload?.registrations.filter((row) => row.balanceMinor < 0).length ?? 0;

  async function requestPayment(row: BillingRow) {
    const ok = await confirm({
      title: 'Request payment?',
      message: `Send ${row.curlerName} a payment link for ${money(row.balanceMinor)}? The link lists the current membership, rostered leagues, sabbaticals, discounts, and name tags, with credit for amounts already paid.`,
      confirmText: 'Request payment',
      cancelText: 'Not now',
    });
    if (!ok) return;
    setBusyId(row.registrationId);
    try {
      const result = await post('/registration/staff/registrations/{id}/request-payment', { collectBalance: true }, {
        id: String(row.registrationId),
      });
      if (result.outcome === 'immediate_payment' && result.checkoutUrl) {
        showAlert(`Payment link sent for ${money(result.totalDueMinor ?? row.balanceMinor)}.`, 'success', 'Payment requested');
      } else {
        showAlert('No remaining payment is due for this registration.', 'info', 'Payment requested');
      }
      await loadBilling();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to request payment.'), 'error', 'Request failed');
    } finally {
      setBusyId(null);
    }
  }

  async function issueRefund(note: string) {
    if (!refundRow) return;
    setRefundSaving(true);
    setRefundError(null);
    try {
      const result = await post(
        '/registration/staff/registrations/{id}/issue-refund',
        { note },
        { id: String(refundRow.registrationId) },
      );
      setRefundRow(null);
      showAlert(`Refund of ${money(result.amountRefundedMinor)} issued.`, 'success', 'Refund issued');
      await loadBilling();
    } catch (err) {
      setRefundError(getApiErrorMessage(err, 'Unable to issue refund.'));
    } finally {
      setRefundSaving(false);
    }
  }

  const columns: Array<DataTableColumn<BillingRow, BillingSortKey>> = [
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
            {row.curlerName}
          </Link>
          {row.curlerEmail ? <div className="text-xs text-gray-500 dark:text-gray-400">{row.curlerEmail}</div> : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Registration status',
      renderCell: (row) => registrationStatusLabel(row.registrationStatus),
    },
    {
      id: 'owed',
      header: 'Owed',
      sortable: true,
      sortKey: 'owed',
      align: 'right',
      renderCell: (row) => <span className="tabular-nums">{money(row.owedMinor)}</span>,
    },
    {
      id: 'paid',
      header: 'Paid',
      sortable: true,
      sortKey: 'paid',
      align: 'right',
      renderCell: (row) => <span className="tabular-nums">{money(row.paidMinor)}</span>,
    },
    {
      id: 'balance',
      header: 'Balance',
      sortable: true,
      sortKey: 'balance',
      align: 'right',
      defaultSortDirection: 'desc',
      renderCell: (row) => {
        const tone =
          row.balanceMinor > 0
            ? 'text-amber-800 dark:text-amber-300'
            : row.balanceMinor < 0
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-emerald-700 dark:text-emerald-400';
        return <span className={`tabular-nums font-medium ${tone}`}>{money(row.balanceMinor)}</span>;
      },
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
                  if (!next) return;
                  setQuery({ sessionId: next, page: '', search: searchDraft });
                }}
                options={sessionOptions}
                placeholder="Select session"
              />
            </FormField>
            <FormField label="Search" htmlFor={searchFieldId}>
              <input
                id={searchFieldId}
                className="app-input"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  setQuery({ search: searchDraft, page: '' });
                }}
                placeholder="Name, email, or registration ID"
              />
            </FormField>
            <FormField label="Balance" htmlFor={balanceFieldId}>
              <ChoiceInput
                inputId={balanceFieldId}
                layout="popover"
                value={BALANCE_FILTER_OPTIONS.some((option) => option.value === balanceFilter) ? balanceFilter : 'all'}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  if (!next || next === 'all') {
                    setQuery({ balance: '', page: '', search: searchDraft });
                    return;
                  }
                  setQuery({ balance: next, page: '', search: searchDraft });
                }}
                options={BALANCE_FILTER_OPTIONS}
              />
            </FormField>
          </>
        }
      />

      {loading ? (
        <AppStateCard title="Loading billing" description="Comparing rostered fees with payments for this session." />
      ) : null}

      {error ? (
        <AppStateCard
          title="Unable to load billing"
          description={error}
          action={<Button onClick={() => void loadBilling()}>Try again</Button>}
        />
      ) : null}

      {!loading && !error && sessionId ? (
        <section className="space-y-4">
          <div>
            <h2 className="app-section-title">Registration billing</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {payload
                ? `${payload.registrations.length} non-canceled ${payload.registrations.length === 1 ? 'registration' : 'registrations'}. ${dueCount} owe payment, ${creditCount} overpaid.`
                : 'Compare what each registration owes with what has been paid.'}
            </p>
            {payload?.leagueProcessingActive ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                League processing is on, so payment links cannot be sent until it is turned off.
              </p>
            ) : null}
          </div>
          <DataTable
            columns={columns}
            rows={pagedRows}
            rowKey={(row) => row.registrationId}
            sort={sort}
            onSortChange={(nextSort) => {
              const defaultNextOrder = nextSort.key === 'balance' ? 'desc' : 'asc';
              setQuery({
                sort: nextSort.key === 'balance' ? '' : nextSort.key,
                order: nextSort.direction === defaultNextOrder ? '' : nextSort.direction,
                page: '',
              });
            }}
            emptyState={
              <AppStateCard
                compact
                title="No registrations found"
                description="Try another session, search, or balance filter."
              />
            }
            pagination={{
              page: currentPage,
              pageSize: PAGE_SIZE,
              totalRecords: filteredRows.length,
              currentCount: pagedRows.length,
              onPageChange: (nextPage) => setQuery({ page: nextPage <= 1 ? '' : String(nextPage) }),
            }}
            actions={{
              header: 'Actions',
              widthClassName: 'w-[12.5rem]',
              renderActions: (row) => (
                <div className="flex flex-wrap justify-end gap-2">
                  {row.canRequestPayment ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="!px-3 !py-1.5"
                      disabled={busyId === row.registrationId}
                      onClick={() => void requestPayment(row)}
                    >
                      {busyId === row.registrationId ? 'Sending…' : 'Request payment'}
                    </Button>
                  ) : null}
                  {row.canIssueRefund ? (
                    <Button
                      type="button"
                      variant="outline-danger"
                      className="!px-3 !py-1.5"
                      disabled={busyId === row.registrationId}
                      onClick={() => {
                        setRefundError(null);
                        setRefundRow(row);
                      }}
                    >
                      Issue refund
                    </Button>
                  ) : null}
                </div>
              ),
            }}
          />
        </section>
      ) : null}

      <IssueRegistrationRefundModal
        isOpen={refundRow != null}
        saving={refundSaving}
        defaultNote={DEFAULT_REFUND_NOTE}
        description={
          refundRow
            ? `Issue a ${money(Math.abs(refundRow.balanceMinor))} refund to ${refundRow.curlerName}? Edit the note before sending.`
            : ''
        }
        error={refundError}
        onClose={() => {
          if (refundSaving) return;
          setRefundRow(null);
          setRefundError(null);
        }}
        onSubmit={(note) => void issueRefund(note)}
      />
    </>
  );
}
