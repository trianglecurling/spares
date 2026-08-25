import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../../api/client';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import DataTable from '../../components/table/DataTable';
import FormField from '../../components/FormField';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';
import { formatApiError } from '../../utils/api';
import {
  expenseKindLabel,
  formatExpenseMoney,
  formatSubmittedAt,
  EXPENSE_STATUS_OPTIONS,
  type ExpenseAdminSummary,
  type ExpenseReportListItem,
} from '../../utils/expenseReports';

const SORT_KEYS = ['submittedAt'] as const;

export default function AdminExpenses() {
  const navigate = useNavigate();
  const statusId = useId();
  const searchId = useId();
  const {
    page,
    filters,
    draftFilters,
    setPage,
    setFilter,
    setDraftFilter,
  } = useTableQueryState<(typeof SORT_KEYS)[number], { status: string; search: string }>({
    defaultSort: { key: 'submittedAt', direction: 'desc' },
    sortKeys: SORT_KEYS,
    filterConfig: {
      status: { queryKey: 'status', defaultValue: 'all' },
      search: { queryKey: 'q', defaultValue: '', debounceMs: 300 },
    },
  });
  const [items, setItems] = useState<ExpenseReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ExpenseAdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/admin/expenses', {
          page,
          pageSize,
          status: filters.status && filters.status !== 'all' ? filters.status : undefined,
          search: filters.search || undefined,
        });
        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
      } catch (err) {
        setError(formatApiError(err, 'Failed to load expense reports'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [filters.search, filters.status, page]);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        setSummary(await get('/admin/expenses/summary'));
      } catch {
        setSummary(null);
      }
    };
    void loadSummary();
  }, []);

  const columns: Array<DataTableColumn<ExpenseReportListItem>> = useMemo(
    () => [
      {
        id: 'submitted',
        header: 'Submitted',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => formatSubmittedAt(row.submittedAt),
      },
      {
        id: 'submitter',
        header: 'Submitter',
        renderCell: (row) => (
          <>
            <div className="font-medium">{row.submitterName}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{row.submitterEmail}</div>
          </>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        renderCell: (row) => expenseKindLabel(row.kind),
      },
      {
        id: 'amount',
        header: 'Amount',
        renderCell: (row) => formatExpenseMoney(row.requestedAmountMinor, row.requestedCurrency),
      },
      {
        id: 'status',
        header: 'Status',
        renderCell: (row) => row.statusLabel,
      },
    ],
    []
  );

  const statusOptions: ChoiceOption<string>[] = [
    { value: 'all', label: 'All statuses' },
    ...EXPENSE_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <AppPage>
      <AppPageHeader
        title="Manage expense reports"
        description="Review submitted expense and mileage reimbursement reports."
      />
      {summary ? (
        <div className="app-card">
          <h2 className="app-section-title">Summary</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="app-card-subtle">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Unprocessed expense reports
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {summary.unprocessedCount}
              </div>
            </div>
            <div className="app-card-subtle">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Awaiting reimbursement
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {summary.awaitingReimbursementCount}
              </div>
            </div>
            <div className="app-card-subtle">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Month-to-date expenses
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatExpenseMoney(summary.monthToDateAmountMinor)}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <AppPageControlsRow
        left={
          <>
            <FormField label="Search" htmlFor={searchId}>
              <input
                id={searchId}
                className="app-input"
                value={draftFilters.search}
                onChange={(event) => setDraftFilter('search', event.target.value)}
                placeholder="Name or email"
              />
            </FormField>
            <FormField label="Status" htmlFor={statusId}>
              <ChoiceInput
                inputId={statusId}
                layout="popover"
                value={filters.status}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setFilter('status', typeof next === 'string' ? next : '');
                  setPage(1);
                }}
                options={statusOptions}
              />
            </FormField>
          </>
        }
      />
      {loading ? (
        <AppStateCard title="Loading" description="Loading expense reports." />
      ) : error ? (
        <AppStateCard title="Could not load reports" description={error} />
      ) : (
        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          onRowClick={(row) => navigate(`/admin/expenses/${row.id}`)}
          pagination={{
            page,
            pageSize,
            totalRecords: total,
            currentCount: items.length,
            onPageChange: setPage,
          }}
          emptyState={<AppStateCard compact title="No expense reports" description="No reports match these filters." />}
          actions={{
            header: 'View',
            renderActions: (row) => (
              <Button type="button" variant="secondary" onClick={() => navigate(`/admin/expenses/${row.id}`)}>
                View
              </Button>
            ),
          }}
        />
      )}
    </AppPage>
  );
}
