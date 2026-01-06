import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import api from '../../utils/api';

type FeedbackRow = {
  id: number;
  category: 'suggestion' | 'problem' | 'question' | 'general';
  body: string;
  email: string | null;
  memberId: number | null;
  pagePath: string | null;
  userAgent: string | null;
  createdAt: string;
  memberName: string | null;
  memberEmail: string | null;
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
        const res = await api.get('/feedback');
        setRows(res.data || []);
      } catch (e: any) {
        const msg = e.response?.data?.error || 'Failed to load feedback';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">Feedback</h1>
        </div>

        {loading && <div className="text-gray-500 dark:text-gray-400">Loading...</div>}

        {error && (
          <div className="mb-6 p-4 rounded bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-gray-500 dark:text-gray-400">No feedback yet.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      From
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {categoryLabel(r.category)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        <div className="font-medium">
                          {r.memberName || r.email || 'Anonymous'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.memberEmail || (r.memberId ? `Member #${r.memberId}` : null)}
                        </div>
                        {r.pagePath && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Page: <span className="font-mono">{r.pagePath}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {r.body}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

