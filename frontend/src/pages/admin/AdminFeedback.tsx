import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { get } from '../../api/client';
import AppStateCard from '../../components/AppStateCard';
import DataTable from '../../components/table/DataTable';
import type { DataTableColumn } from '../../components/table/tableTypes';
import { formatApiError } from '../../utils/api';

type FeedbackRow = {
  id: number;
  category: 'suggestion' | 'problem' | 'question' | 'general' | string;
  body: string;
  email?: string | null;
  memberId?: number | null;
  pagePath?: string | null;
  userAgent?: string | null;
  createdAt: string;
  memberName?: string | null;
  memberEmail?: string | null;
};

function categoryLabel(value: FeedbackRow['category']): string {
  switch (value) {
    case 'suggestion':
      return 'Suggestion';
    case 'problem':
      return 'Problem';
    case 'question':
      return 'Question';
    case 'general':
      return 'General';
    default:
      return value;
  }
}

export default function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await get('/feedback');
        setRows(res || []);
      } catch (e: unknown) {
        setError(formatApiError(e, 'Failed to load feedback'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const columns: Array<DataTableColumn<FeedbackRow>> = useMemo(
    () => [
      {
        id: 'date',
        header: 'Date',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => (row.createdAt ? new Date(row.createdAt).toLocaleString() : ''),
      },
      {
        id: 'category',
        header: 'Category',
        cellClassName: 'whitespace-nowrap',
        renderCell: (row) => categoryLabel(row.category),
      },
      {
        id: 'from',
        header: 'From',
        renderCell: (row) => (
          <>
            <div className="font-medium">{row.memberName || row.email || 'Anonymous'}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {row.memberEmail || (row.memberId ? `Member #${row.memberId}` : null)}
            </div>
            {row.pagePath ? (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Page: <span className="font-mono">{row.pagePath}</span>
              </div>
            ) : null}
          </>
        ),
      },
      {
        id: 'details',
        header: 'Details',
        cellClassName: 'whitespace-pre-wrap',
        renderCell: (row) => row.body,
      },
    ],
    []
  );

  return (
    <Layout>
      <AppPage>
        <AppPageHeader title="Feedback" />
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={loading}
          error={error ? <div className="app-alert-error">{error}</div> : undefined}
          emptyState={<AppStateCard compact title="No feedback yet." />}
        />
      </AppPage>
    </Layout>
  );
}
