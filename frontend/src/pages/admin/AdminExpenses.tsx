import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { HiCreditCard } from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { get, post } from '../../api/client';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import DataTable from '../../components/table/DataTable';
import FormField from '../../components/FormField';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import useTableQueryState from '../../hooks/useTableQueryState';
import api, { formatApiError } from '../../utils/api';
import { downloadBlob, filenameFromDisposition, messageFromBlobError } from '../../utils/fileDownload';
import {
  expenseKindLabel,
  formatExpenseMoney,
  formatSubmittedAt,
  EXPENSE_STATUS_OPTIONS,
  type ExpenseAdminSummary,
  type ExpenseReportListItem,
  type ExpenseReportStatus,
} from '../../utils/expenseReports';
import { memberHasScope } from '../../utils/permissions';

const SORT_KEYS = ['submittedAt'] as const;

const DATE_RANGES = ['this_month', 'last_month', 'this_fiscal_year', 'custom'] as const;
type ExpenseDateRange = (typeof DATE_RANGES)[number];

const DATE_RANGE_OPTIONS: ChoiceOption<string>[] = [
  { value: 'all', label: 'All dates' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_fiscal_year', label: 'This fiscal year' },
  { value: 'custom', label: 'Custom range' },
];

function asDateRange(value: string): ExpenseDateRange | undefined {
  return (DATE_RANGES as readonly string[]).includes(value) ? (value as ExpenseDateRange) : undefined;
}

function reportCountLabel(count: number): string {
  return count === 1 ? '1 expense report' : `${count} expense reports`;
}

export default function AdminExpenses() {
  const statusId = useId();
  const searchId = useId();
  const rangeId = useId();
  const fromId = useId();
  const toId = useId();
  const bulkStatusId = useId();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const canManage = memberHasScope(member, 'expenses.manage');
  const {
    page,
    filters,
    draftFilters,
    setPage,
    setFilter,
    setDraftFilter,
  } = useTableQueryState<
    (typeof SORT_KEYS)[number],
    { status: string; search: string; range: string; from: string; to: string }
  >({
    defaultSort: { key: 'submittedAt', direction: 'desc' },
    sortKeys: SORT_KEYS,
    filterConfig: {
      status: { queryKey: 'status', defaultValue: 'all' },
      search: { queryKey: 'q', defaultValue: '', debounceMs: 300 },
      range: { queryKey: 'range', defaultValue: 'all' },
      from: { queryKey: 'from', defaultValue: '', debounceMs: 400 },
      to: { queryKey: 'to', defaultValue: '', debounceMs: 400 },
    },
  });
  const [items, setItems] = useState<ExpenseReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ExpenseAdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [downloadingDocuments, setDownloadingDocuments] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const pageSize = 25;

  const range = asDateRange(filters.range);
  const isCustomRange = range === 'custom';
  const dateRangeError =
    isCustomRange && filters.from && filters.to && filters.from > filters.to
      ? 'End date must be on or after the start date.'
      : null;

  const filterParams = useMemo(
    () => ({
      status: filters.status && filters.status !== 'all' ? filters.status : undefined,
      search: filters.search || undefined,
      range,
      from: range === 'custom' ? filters.from || undefined : undefined,
      to: range === 'custom' ? filters.to || undefined : undefined,
    }),
    [filters.from, filters.search, filters.status, filters.to, range]
  );

  useEffect(() => {
    if (dateRangeError) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/admin/expenses', { page, pageSize, ...filterParams });
        if (cancelled) return;
        setItems(response.items ?? []);
        setTotal(response.total ?? 0);
      } catch (err) {
        if (!cancelled) setError(formatApiError(err, 'Failed to load expense reports'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [dateRangeError, filterParams, page, refreshToken]);

  const filterKey = JSON.stringify(filterParams);
  const [selectionFilterKey, setSelectionFilterKey] = useState(filterKey);
  if (selectionFilterKey !== filterKey) {
    setSelectionFilterKey(filterKey);
    setSelectedIds([]);
  }

  const downloadParams = selectedIds.length > 0 ? { ids: selectedIds.join(',') } : filterParams;

  const handleExport = async () => {
    if (exporting || downloadingDocuments) return;
    setExporting(true);
    try {
      const response = await api.get('/admin/expenses/export', {
        params: downloadParams,
        responseType: 'blob',
      });
      downloadBlob(
        new Blob([response.data], { type: 'text/csv;charset=utf-8' }),
        filenameFromDisposition(response.headers['content-disposition'], 'expense-reports.csv')
      );
      showAlert('Expense report export downloaded.', 'success');
    } catch (err) {
      showAlert(await messageFromBlobError(err, 'Unable to export expense reports.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadDocuments = async () => {
    if (exporting || downloadingDocuments) return;
    setDownloadingDocuments(true);
    try {
      const response = await api.get('/admin/expenses/documents', {
        params: downloadParams,
        responseType: 'blob',
      });
      downloadBlob(
        new Blob([response.data], { type: 'application/zip' }),
        filenameFromDisposition(response.headers['content-disposition'], 'expense-documents.zip')
      );
      showAlert('Expense documents downloaded.', 'success');
    } catch (err) {
      showAlert(await messageFromBlobError(err, 'Unable to download expense documents.'), 'error');
    } finally {
      setDownloadingDocuments(false);
    }
  };

  const handleBulkStatus = async (nextStatus: string) => {
    const option = EXPENSE_STATUS_OPTIONS.find((item) => item.value === nextStatus);
    if (!option || selectedIds.length === 0 || updatingStatus) return;
    const emailNote =
      option.value === 'check_mailed'
        ? ' Submitters whose reports are not already check mailed will receive an email.'
        : '';
    const confirmed = await confirm({
      title: 'Update status',
      message: `Update ${reportCountLabel(selectedIds.length)} to ${option.label}?${emailNote}`,
      confirmText: 'Update status',
      variant: option.value === 'check_mailed' ? 'warning' : 'info',
    });
    if (!confirmed) return;
    setUpdatingStatus(true);
    try {
      const result = await post('/admin/expenses/status', {
        ids: selectedIds,
        status: option.value as ExpenseReportStatus,
      });
      if (result.updatedCount === 0) {
        showAlert('Those reports already had that status.', 'success');
      } else if (result.unchangedCount > 0) {
        showAlert(
          `Updated ${reportCountLabel(result.updatedCount)}. ${result.unchangedCount} already had that status.`,
          'success'
        );
      } else {
        showAlert(`Updated ${reportCountLabel(result.updatedCount)}.`, 'success');
      }
      setRefreshToken((current) => current + 1);
    } catch (err) {
      showAlert(formatApiError(err, 'Unable to update expense report statuses.'), 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const exportUnavailableReason = dateRangeError
    ? 'Fix the date range to export'
    : loading
      ? undefined
      : error
        ? 'Reports could not be loaded'
        : selectedIds.length === 0 && total === 0
          ? 'No reports match these filters'
          : undefined;
  const actionTitle =
    exportUnavailableReason ??
    (selectedIds.length > 0 ? `${reportCountLabel(selectedIds.length)} selected` : undefined);

  const handleToggleRow = useCallback((row: ExpenseReportListItem, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, row.id]))
        : current.filter((id) => id !== row.id)
    );
  }, []);

  const handleTogglePage = useCallback((rows: ExpenseReportListItem[], checked: boolean) => {
    const rowIds = rows.map((row) => row.id);
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, ...rowIds]))
        : current.filter((id) => !rowIds.includes(id))
    );
  }, []);

  const selectionConfig = useMemo(
    () => ({
      selectedIds,
      getRowLabel: (row: ExpenseReportListItem) =>
        `expense report ${row.id} from ${row.submitterName}`,
      onToggleRow: handleToggleRow,
      onTogglePage: handleTogglePage,
    }),
    [handleTogglePage, handleToggleRow, selectedIds]
  );

  useEffect(() => {
    const loadSummary = async () => {
      try {
        setSummary(await get('/admin/expenses/summary'));
      } catch {
        setSummary(null);
      }
    };
    void loadSummary();
  }, [refreshToken]);

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
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => (
          <span className="inline-flex items-center gap-1.5">
            {row.usedClubCreditCard ? (
              <span
                className="inline-flex text-gray-500 dark:text-gray-400"
                title="Charged to a club credit card"
              >
                <HiCreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">Charged to a club credit card</span>
              </span>
            ) : null}
            {formatExpenseMoney(row.totalAmountMinor, row.requestedCurrency)}
          </span>
        ),
      },
      {
        id: 'toReimburse',
        header: 'To reimburse',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) =>
          formatExpenseMoney(row.requestedAmountMinor, row.requestedCurrency),
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
            <FormField label="Submitted" htmlFor={rangeId}>
              <ChoiceInput
                inputId={rangeId}
                layout="popover"
                value={filters.range}
                onChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setFilter('range', typeof next === 'string' ? next : 'all');
                }}
                options={DATE_RANGE_OPTIONS}
              />
            </FormField>
            {isCustomRange ? (
              <>
                <FormField label="From" htmlFor={fromId}>
                  <input
                    id={fromId}
                    type="date"
                    className="app-input"
                    value={draftFilters.from}
                    max={draftFilters.to || undefined}
                    onChange={(event) => setDraftFilter('from', event.target.value)}
                  />
                </FormField>
                <FormField label="To" htmlFor={toId} error={dateRangeError}>
                  {({ describedBy, invalid }) => (
                    <input
                      id={toId}
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
          <div className="flex flex-wrap items-end justify-end gap-3">
            {canManage && selectedIds.length > 0 ? (
              <FormField
                label="Update status"
                htmlFor={bulkStatusId}
                className="w-56"
                labelAccessory={
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {selectedIds.length} selected
                  </span>
                }
              >
                <ChoiceInput
                  inputId={bulkStatusId}
                  layout="popover"
                  value={null}
                  placeholder={updatingStatus ? 'Updating…' : 'Choose a status'}
                  disabled={updatingStatus || exporting || downloadingDocuments || loading}
                  onChange={(value) => {
                    const next = Array.isArray(value) ? value[0] : value;
                    if (typeof next === 'string' && next) void handleBulkStatus(next);
                  }}
                  options={EXPENSE_STATUS_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  inputClassName="app-input max-w-none"
                />
              </FormField>
            ) : null}
            <span title={actionTitle}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleDownloadDocuments()}
                disabled={
                  downloadingDocuments || exporting || loading || Boolean(exportUnavailableReason)
                }
              >
                {downloadingDocuments ? 'Downloading…' : 'Download receipts'}
              </Button>
            </span>
            <span title={actionTitle}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleExport()}
                disabled={exporting || downloadingDocuments || loading || Boolean(exportUnavailableReason)}
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </span>
          </div>
        }
      />
      {dateRangeError ? (
        <AppStateCard title="Check the date range" description={dateRangeError} />
      ) : loading ? (
        <AppStateCard title="Loading" description="Loading expense reports." />
      ) : error ? (
        <AppStateCard title="Could not load reports" description={error} />
      ) : (
        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          selection={selectionConfig}
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
              <Link
                to={`/admin/expenses/${row.id}`}
                className="font-medium text-primary-teal-link hover:underline"
              >
                View
              </Link>
            ),
          }}
        />
      )}
    </AppPage>
  );
}
