import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { get } from '../../api/client';
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

  return (
    <Layout>
      <AppPage>
        <AppPageHeader title="Feedback" />

        {loading && <div className="text-gray-500 dark:text-gray-400">Loading...</div>}

        {error && (
          <div className="app-alert-error">{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-gray-500 dark:text-gray-400">No feedback yet.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="app-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead className="app-table-head">
                  <tr>
                    <th className="app-table-th">Date</th>
                    <th className="app-table-th">Category</th>
                    <th className="app-table-th">From</th>
                    <th className="app-table-th">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="app-table-td whitespace-nowrap">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                      </td>
                      <td className="app-table-td whitespace-nowrap">
                        {categoryLabel(r.category)}
                      </td>
                      <td className="app-table-td">
                        <div className="font-medium">{r.memberName || r.email || 'Anonymous'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.memberEmail || (r.memberId ? `Member #${r.memberId}` : null)}
                        </div>
                        {r.pagePath && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Page: <span className="font-mono">{r.pagePath}</span>
                          </div>
                        )}
                      </td>
                      <td className="app-table-td whitespace-pre-wrap">
                        {r.body}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </AppPage>
    </Layout>
  );
}
