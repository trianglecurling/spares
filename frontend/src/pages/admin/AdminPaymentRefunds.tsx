import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';
import api, { formatApiError } from '../../utils/api';
import { formatClubDateTime } from '../../utils/clubTime';
import { paymentProcessorDisplayName, type PaymentProvider } from '../../utils/paymentProcessorCopy';

type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed';
type PaymentSubjectType = 'donation' | 'membership' | 'event_registration' | 'curling_registration';
type RefundDateRange = 'this_month' | 'last_month' | 'this_fiscal_year' | 'custom';
type RefundSortKey = 'issuedAt' | 'amount' | 'status' | 'recipient' | 'subject' | 'provider' | 'issuedBy';

type AdminRefundRow = {
  id: number;
  paymentOrderId: number;
  orderToken: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: RefundStatus;
  subjectType: PaymentSubjectType;
  subjectId: number | null;
  subjectLabel: string;
  recipientName: string | null;
  recipientEmail: string | null;
  issuedByName: string | null;
  providerRefundId: string | null;
  processedAt: string | null;
  createdAt: string;
  issuedAt: string;
};

type AdminRefundsResponse = {
  total: number;
  limit: number;
  offset: number;
  summary: {
    succeededAmountByCurrency: Array<{ currency: string; amountMinor: number }>;
  };
  refunds: AdminRefundRow[];
};

type RefundFilters = {
  search: string;
  provider: '' | PaymentProvider;
  subjectType: '' | PaymentSubjectType;
  status: '' | RefundStatus;
  range: '' | RefundDateRange;
  from: string;
  to: string;
};

const REFUNDS_PAGE_SIZE = 50;
const REFUND_SORT_KEYS = ['issuedAt', 'amount', 'status', 'recipient', 'subject', 'provider', 'issuedBy'] as const;
const REFUND_DATE_RANGES = ['this_month', 'last_month', 'this_fiscal_year', 'custom'] as const;

const PROVIDER_OPTIONS: ChoiceOption<PaymentProvider>[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'square', label: 'Square' },
];

const SUBJECT_OPTIONS: ChoiceOption<PaymentSubjectType>[] = [
  { value: 'donation', label: 'Donation' },
  { value: 'membership', label: 'Membership' },
  { value: 'event_registration', label: 'Event registration' },
  { value: 'curling_registration', label: 'Curling registration' },
];

const STATUS_OPTIONS: ChoiceOption<RefundStatus>[] = [
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
];

const DATE_RANGE_OPTIONS: ChoiceOption<RefundDateRange>[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_fiscal_year', label: 'This fiscal year' },
  { value: 'custom', label: 'Custom range' },
];

function parseProvider(raw: string | null): '' | PaymentProvider {
  if (raw === 'stripe' || raw === 'paypal' || raw === 'square') return raw;
  return '';
}

function parseSubjectType(raw: string | null): '' | PaymentSubjectType {
  if (
    raw === 'donation' ||
    raw === 'membership' ||
    raw === 'event_registration' ||
    raw === 'curling_registration'
  ) {
    return raw;
  }
  return '';
}

function parseStatus(raw: string | null): '' | RefundStatus {
  if (
    raw === 'requested' ||
    raw === 'approved' ||
    raw === 'rejected' ||
    raw === 'processing' ||
    raw === 'succeeded' ||
    raw === 'failed'
  ) {
    return raw;
  }
  return '';
}

function parseRange(raw: string | null): '' | RefundDateRange {
  if ((REFUND_DATE_RANGES as readonly string[]).includes(raw ?? '')) return raw as RefundDateRange;
  return '';
}

function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return formatClubDateTime(value) || value;
}

function formatRefundStatus(status: RefundStatus): string {
  switch (status) {
    case 'requested':
      return 'Requested';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'processing':
      return 'Processing';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function refundStatusClassName(status: RefundStatus): string {
  switch (status) {
    case 'succeeded':
    case 'approved':
      return 'text-green-700 dark:text-emerald-300';
    case 'requested':
    case 'processing':
      return 'text-amber-700 dark:text-amber-300';
    case 'failed':
    case 'rejected':
      return 'text-red-700 dark:text-red-300';
    default:
      return 'text-gray-700 dark:text-gray-200';
  }
}

function formatSucceededAmounts(rows: Array<{ currency: string; amountMinor: number }>): string {
  if (rows.length === 0) return formatMoney(0, 'usd');
  return rows.map((row) => formatMoney(row.amountMinor, row.currency)).join(', ');
}

export default function AdminPaymentRefunds() {
  const fieldId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminRefundsResponse | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const filterConfig = useMemo(
    () => ({
      search: { queryKey: 'search', defaultValue: '', debounceMs: 250 },
      provider: { queryKey: 'provider', defaultValue: '' as const, parse: parseProvider },
      subjectType: { queryKey: 'subjectType', defaultValue: '' as const, parse: parseSubjectType },
      status: { queryKey: 'status', defaultValue: '' as const, parse: parseStatus },
      range: { queryKey: 'range', defaultValue: '' as const, parse: parseRange },
      from: { queryKey: 'from', defaultValue: '', debounceMs: 400 },
      to: { queryKey: 'to', defaultValue: '', debounceMs: 400 },
    }),
    []
  );

  const { page, sort, filters, draftFilters, setPage, setSort, setFilter, setDraftFilter } = useTableQueryState<
    RefundSortKey,
    RefundFilters
  >({
    defaultSort: { key: 'issuedAt', direction: 'desc' },
    sortKeys: REFUND_SORT_KEYS,
    filterConfig,
  });

  const isCustomRange = filters.range === 'custom';
  const dateRangeError =
    isCustomRange && filters.from && filters.to && filters.from > filters.to
      ? 'End date must be on or after the start date.'
      : null;

  const loadRefunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {
        limit: REFUNDS_PAGE_SIZE,
        offset: (page - 1) * REFUNDS_PAGE_SIZE,
        sort: sort.key,
        order: sort.direction,
      };
      if (filters.search.trim()) params.search = filters.search.trim();
      if (filters.provider) params.provider = filters.provider;
      if (filters.subjectType) params.subjectType = filters.subjectType;
      if (filters.status) params.status = filters.status;
      if (filters.range) params.range = filters.range;
      if (isCustomRange && filters.from) params.from = filters.from;
      if (isCustomRange && filters.to) params.to = filters.to;
      const { data: next } = await api.get<AdminRefundsResponse>('/payments/refunds', { params });
      setData(next);
      const maxPage = Math.max(1, Math.ceil(next.total / REFUNDS_PAGE_SIZE));
      if (next.total > 0 && next.refunds.length === 0 && page > maxPage) {
        setPage(maxPage, { replace: true });
      }
    } catch (loadError) {
      setData(null);
      setError(formatApiError(loadError, 'Failed to load refunds'));
    } finally {
      setLoading(false);
    }
  }, [
    filters.from,
    filters.provider,
    filters.range,
    filters.search,
    filters.status,
    filters.subjectType,
    filters.to,
    isCustomRange,
    page,
    setPage,
    sort.direction,
    sort.key,
  ]);

  useEffect(() => {
    if (dateRangeError) {
      setLoading(false);
      return;
    }
    void loadRefunds();
  }, [dateRangeError, loadRefunds, refreshToken]);

  const columns: Array<DataTableColumn<AdminRefundRow, RefundSortKey>> = useMemo(
    () => [
      {
        id: 'issued',
        header: 'Issued',
        sortable: true,
        sortKey: 'issuedAt',
        defaultSortDirection: 'desc',
        renderCell: (row) => (
          <div>
            <div className="text-gray-900 dark:text-gray-100">{formatDate(row.issuedAt)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Refund #{row.id}</div>
          </div>
        ),
      },
      {
        id: 'recipient',
        header: 'Recipient',
        sortable: true,
        sortKey: 'recipient',
        defaultSortDirection: 'asc',
        renderCell: (row) => (
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{row.recipientName || '—'}</div>
            {row.recipientEmail ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">{row.recipientEmail}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'subject',
        header: 'For',
        sortable: true,
        sortKey: 'subject',
        defaultSortDirection: 'asc',
        cellClassName: 'min-w-[16rem]',
        renderCell: (row) => (
          <div>
            <div className="text-gray-900 dark:text-gray-100">{row.subjectLabel}</div>
            {row.reason ? <div className="text-xs text-gray-600 dark:text-gray-300">{row.reason}</div> : null}
            <div className="text-xs text-gray-500 dark:text-gray-400">Order #{row.paymentOrderId}</div>
          </div>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        sortable: true,
        sortKey: 'amount',
        defaultSortDirection: 'desc',
        align: 'right',
        renderCell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-gray-100">
            −{formatMoney(row.amountMinor, row.currency)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortable: true,
        sortKey: 'status',
        defaultSortDirection: 'asc',
        renderCell: (row) => <span className={refundStatusClassName(row.status)}>{formatRefundStatus(row.status)}</span>,
      },
      {
        id: 'provider',
        header: 'Provider',
        sortable: true,
        sortKey: 'provider',
        defaultSortDirection: 'asc',
        renderCell: (row) => (
          <div>
            <div>{paymentProcessorDisplayName(row.provider)}</div>
            {row.providerRefundId ? (
              <div className="max-w-[12rem] break-all text-xs text-gray-500 dark:text-gray-400">{row.providerRefundId}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'issuedBy',
        header: 'Issued by',
        sortable: true,
        sortKey: 'issuedBy',
        defaultSortDirection: 'asc',
        renderCell: (row) => row.issuedByName || '—',
      },
    ],
    []
  );

  const hasActiveFilters = Boolean(
    filters.search.trim() || filters.provider || filters.subjectType || filters.status || filters.range
  );

  return (
    <div className="app-card">
      <h2 className="app-section-title">Refunds</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="app-card-subtle">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Matching refunds</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {data ? data.total : '—'}
          </div>
        </div>
        <div className="app-card-subtle">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Succeeded amount</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {data ? formatSucceededAmounts(data.summary.succeededAmountByCurrency) : '—'}
          </div>
        </div>
      </div>

      <AppPageControlsRow
        className="mt-4"
        left={
          <>
            <FormField label="Search" htmlFor={`${fieldId}-search`} className="min-w-[16rem] flex-1">
              <input
                id={`${fieldId}-search`}
                type="search"
                className="app-input"
                value={draftFilters.search}
                onChange={(event) => setDraftFilter('search', event.target.value)}
                placeholder="Name, email, reason, or order"
              />
            </FormField>
            <FormField label="Provider" htmlFor={`${fieldId}-provider`}>
              <ChoiceInput<PaymentProvider>
                inputId={`${fieldId}-provider`}
                options={PROVIDER_OPTIONS}
                value={filters.provider === '' ? null : filters.provider}
                onChange={(next) => setFilter('provider', next == null || Array.isArray(next) ? '' : next)}
                placeholder="All providers"
                listboxLabel="Provider"
                inputClassName="app-input"
              />
            </FormField>
            <FormField label="For" htmlFor={`${fieldId}-subject`}>
              <ChoiceInput<PaymentSubjectType>
                inputId={`${fieldId}-subject`}
                options={SUBJECT_OPTIONS}
                value={filters.subjectType === '' ? null : filters.subjectType}
                onChange={(next) => setFilter('subjectType', next == null || Array.isArray(next) ? '' : next)}
                placeholder="All subjects"
                listboxLabel="What the refund was for"
                inputClassName="app-input"
              />
            </FormField>
            <FormField label="Status" htmlFor={`${fieldId}-status`}>
              <ChoiceInput<RefundStatus>
                inputId={`${fieldId}-status`}
                options={STATUS_OPTIONS}
                value={filters.status === '' ? null : filters.status}
                onChange={(next) => setFilter('status', next == null || Array.isArray(next) ? '' : next)}
                placeholder="All statuses"
                listboxLabel="Refund status"
                inputClassName="app-input"
              />
            </FormField>
            <FormField label="Issued" htmlFor={`${fieldId}-range`} helperText="Club local time.">
              {({ describedBy }) => (
                <ChoiceInput<RefundDateRange>
                  inputId={`${fieldId}-range`}
                  options={DATE_RANGE_OPTIONS}
                  value={filters.range === '' ? null : filters.range}
                  onChange={(next) => setFilter('range', next == null || Array.isArray(next) ? '' : next)}
                  placeholder="All dates"
                  listboxLabel="Issued date"
                  ariaDescribedBy={describedBy}
                  inputClassName="app-input"
                />
              )}
            </FormField>
            {isCustomRange ? (
              <>
                <FormField label="From" htmlFor={`${fieldId}-from`}>
                  <input
                    id={`${fieldId}-from`}
                    type="date"
                    className="app-input"
                    value={draftFilters.from}
                    max={draftFilters.to || undefined}
                    onChange={(event) => setDraftFilter('from', event.target.value)}
                  />
                </FormField>
                <FormField label="To" htmlFor={`${fieldId}-to`} error={dateRangeError}>
                  {({ describedBy, invalid }) => (
                    <input
                      id={`${fieldId}-to`}
                      type="date"
                      className="app-input"
                      value={draftFilters.to}
                      min={draftFilters.from || undefined}
                      aria-describedby={describedBy}
                      aria-invalid={invalid || undefined}
                      onChange={(event) => setDraftFilter('to', event.target.value)}
                    />
                  )}
                </FormField>
              </>
            ) : null}
          </>
        }
        right={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRefreshToken((current) => current + 1)}
            disabled={loading || Boolean(dateRangeError)}
          >
            Refresh
          </Button>
        }
      />

      {dateRangeError ? (
        <AppStateCard compact className="mt-4" title="Check the date range" description={dateRangeError} />
      ) : (
        <DataTable
          className="mt-4"
          rows={data?.refunds ?? []}
          rowKey={(row) => row.id}
          columns={columns}
          sort={sort}
          onSortChange={setSort}
          loading={loading}
          error={error ? <AppStateCard compact title="Could not load refunds" description={error} /> : undefined}
          pagination={{
            page,
            pageSize: REFUNDS_PAGE_SIZE,
            totalRecords: data?.total ?? 0,
            currentCount: data?.refunds.length ?? 0,
            onPageChange: setPage,
          }}
          emptyState={
            <AppStateCard
              compact
              title={hasActiveFilters ? 'No refunds found for current filters.' : 'No refunds have been issued yet.'}
            />
          }
          actions={{
            header: 'Receipt',
            widthClassName: 'w-44',
            renderActions: (row) =>
              row.orderToken ? (
                <a
                  href={`/payments/${encodeURIComponent(row.orderToken)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap text-primary-teal-link hover:underline"
                >
                  View refund receipt
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">—</span>
              ),
          }}
        />
      )}
    </div>
  );
}
