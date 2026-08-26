import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import useTableQueryState from '../../hooks/useTableQueryState';
import { get } from '../../api/client';
import { getApiErrorMessage } from '../../utils/api';

const PAGE_SIZE = 50;
const SORT_KEYS = ['createdAt'] as const;
const EMPTY_FILTER_CONFIG = {} as const;

type OutboundEmailRow = {
  id: number;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  createdAt: string;
};

function formatSentAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AdminObservabilityEmails() {
  const navigate = useNavigate();
  const { page, setPage } = useTableQueryState<(typeof SORT_KEYS)[number], Record<string, never>>({
    defaultSort: { key: 'createdAt', direction: 'desc' },
    sortKeys: SORT_KEYS,
    filterConfig: EMPTY_FILTER_CONFIG,
  });
  const [rows, setRows] = useState<OutboundEmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await get('/observability/emails', { page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setRows(response.items);
        setTotal(response.total);
      } catch (caught) {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setError(getApiErrorMessage(caught, 'Could not load sent emails'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const columns: Array<DataTableColumn<OutboundEmailRow>> = useMemo(
    () => [
      {
        id: 'recipient',
        header: 'Recipient',
        renderCell: (row) => (
          <>
            <div className="font-medium text-gray-900 dark:text-gray-100">{row.recipientEmail}</div>
            {row.recipientName ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">{row.recipientName}</div>
            ) : null}
          </>
        ),
      },
      {
        id: 'subject',
        header: 'Subject',
        renderCell: (row) => (
          <Link
            to={`/admin/observability/emails/${row.id}`}
            className="text-primary-teal-link hover:underline"
          >
            {row.subject}
          </Link>
        ),
      },
      {
        id: 'sent',
        header: 'Sent',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => formatSentAt(row.createdAt),
      },
    ],
    []
  );

  return (
    <AppPage>
      <AppPageHeader
        title="Sent emails"
        description="Outbound mail from the last 30 days, excluding login codes."
        actions={<BackButton label="Observability" to="/admin/observability" />}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        loading={loading}
        error={error ? <div className="app-alert-error">{error}</div> : undefined}
        emptyState={<AppStateCard compact title="No sent emails in the last 30 days." />}
        onRowClick={(row) => navigate(`/admin/observability/emails/${row.id}`)}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalRecords: total,
          currentCount: rows.length,
          onPageChange: setPage,
        }}
      />
    </AppPage>
  );
}
