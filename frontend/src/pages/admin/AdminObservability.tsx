import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import api from '../../utils/api';
import Button from '../../components/Button';

interface ObservabilityTotals {
  membersTotal: number;
  dauToday: number;
  dau7DayAvg: number;
  emailsToday: number;
  emailsSentToday: number;
  emailsLoggedToday: number;
  spareRequestsCreatedToday: number;
  spareRequestsFilledToday: number;
  avgTimeToFillMinutes: number | null;
}

interface ObservabilityDay {
  date: string;
  dau: number;
  emailsSent: number;
  emailsLogged: number;
  smsSent: number;
  smsLogged: number;
  spareRequestsCreated: number;
  spareRequestsFilled: number;
  spareOffersCancelled: number;
  spareRequestsCancelled: number;
  logins: number;
  authCodesRequested: number;
}

interface ObservabilityResponse {
  rangeDays: number;
  startDate: string;
  endDate: string;
  totals: ObservabilityTotals;
  series: ObservabilityDay[];
}

export default function AdminObservability() {
  const [obsLoading, setObsLoading] = useState(true);
  const [observability, setObservability] = useState<ObservabilityResponse | null>(null);
  const [obsRangeDays, setObsRangeDays] = useState<number>(30);

  const loadObservability = async (rangeDays: number) => {
    setObsLoading(true);
    try {
      const response = await api.get(`/config/observability?rangeDays=${rangeDays}`);
      setObservability(response.data);
      setObsRangeDays(rangeDays);
    } catch (error) {
      console.error('Failed to load observability:', error);
      setObservability(null);
    } finally {
      setObsLoading(false);
    }
  };

  useEffect(() => {
    loadObservability(30);
  }, []);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#121033] dark:text-gray-100">
              Observability
            </h1>
            <div className="mt-1">
              <Link
                to="/admin/config"
                className="text-primary-teal hover:text-opacity-80 text-sm font-medium"
              >
                ← Back to Server Config
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://observability.tccnc.club"
              target="_blank"
              rel="noreferrer"
              className="text-primary-teal hover:text-opacity-80 text-sm font-medium"
            >
              Grafana dashboard ↗
            </a>
            <select
              value={obsRangeDays}
              onChange={(e) => loadObservability(parseInt(e.target.value, 10))}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md text-sm"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button
              type="button"
              variant="secondary"
              onClick={() => loadObservability(obsRangeDays)}
              disabled={obsLoading}
            >
              {obsLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          {obsLoading && (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading metrics…</div>
          )}

          {!obsLoading && observability && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded border border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-500 dark:text-gray-400">DAU (today)</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {observability.totals.dauToday}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    7-day avg: {observability.totals.dau7DayAvg}
                  </div>
                </div>
                <div className="p-4 rounded border border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Emails (today)</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {observability.totals.emailsToday}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    sent: {observability.totals.emailsSentToday}, logged: {observability.totals.emailsLoggedToday}
                  </div>
                </div>
                <div className="p-4 rounded border border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Spare requests (today)</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {observability.totals.spareRequestsCreatedToday}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    filled today: {observability.totals.spareRequestsFilledToday}
                  </div>
                </div>
                <div className="p-4 rounded border border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-500 dark:text-gray-400">Avg time-to-fill</div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {observability.totals.avgTimeToFillMinutes === null ? '—' : `${observability.totals.avgTimeToFillMinutes}m`}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">for fills in range</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">DAU</th>
                      <th className="py-2 pr-4 font-medium">Emails</th>
                      <th className="py-2 pr-4 font-medium">SMS</th>
                      <th className="py-2 pr-4 font-medium">Spare created</th>
                      <th className="py-2 pr-4 font-medium">Spare filled</th>
                      <th className="py-2 pr-4 font-medium">Offer cancels</th>
                      <th className="py-2 pr-4 font-medium">Logins</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800 dark:text-gray-100">
                    {observability.series.map((d) => (
                      <tr key={d.date} className="border-b dark:border-gray-700">
                        <td className="py-2 pr-4 whitespace-nowrap">{d.date}</td>
                        <td className="py-2 pr-4">{d.dau}</td>
                        <td className="py-2 pr-4">
                          {d.emailsSent + d.emailsLogged}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {' '}
                            (sent {d.emailsSent}, logged {d.emailsLogged})
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {d.smsSent + d.smsLogged}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {' '}
                            (sent {d.smsSent}, logged {d.smsLogged})
                          </span>
                        </td>
                        <td className="py-2 pr-4">{d.spareRequestsCreated}</td>
                        <td className="py-2 pr-4">{d.spareRequestsFilled}</td>
                        <td className="py-2 pr-4">{d.spareOffersCancelled}</td>
                        <td className="py-2 pr-4">{d.logins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Date range: {observability.startDate} → {observability.endDate} · Members total: {observability.totals.membersTotal}
              </div>
            </>
          )}

          {!obsLoading && !observability && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Metrics aren’t available yet.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

