import { useEffect, useState } from 'react';
import { get } from '../../api/client';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';

const OBS_RANGE_OPTIONS: ChoiceOption<number>[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

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
      const response = await get('/config/observability', { rangeDays });
      setObservability(response);
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
    <>
      <AppPage>
        <AppPageHeader
          title="Observability"
          actions={
            <BackButton label="Server config" to="/admin/config" />
          }
        />

        <div className="app-card p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <a
              href="https://observability.tccnc.club"
              target="_blank"
              rel="noreferrer"
              className="text-primary-teal hover:underline text-sm font-medium"
            >
              Grafana dashboard ↗
            </a>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ChoiceInput<number>
                ariaLabel="Observability date range"
                options={OBS_RANGE_OPTIONS}
                value={obsRangeDays}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) loadObservability(next);
                }}
                listboxLabel="Date range"
                inputClassName="app-input w-auto min-w-[10rem]"
              />
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
                    sent: {observability.totals.emailsSentToday}, logged:{' '}
                    {observability.totals.emailsLoggedToday}
                  </div>
                </div>
                <div className="p-4 rounded border border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Spare requests (today)
                  </div>
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
                    {observability.totals.avgTimeToFillMinutes === null
                      ? '—'
                      : `${observability.totals.avgTimeToFillMinutes}m`}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">for fills in range</div>
                </div>
              </div>

              <div className="app-table-shell">
                <table className="app-table">
                  <thead className="app-table-head">
                    <tr>
                      <th className="app-table-th">Date</th>
                      <th className="app-table-th">DAU</th>
                      <th className="app-table-th">Emails</th>
                      <th className="app-table-th">SMS</th>
                      <th className="app-table-th">Spare created</th>
                      <th className="app-table-th">Spare filled</th>
                      <th className="app-table-th">Offer cancels</th>
                      <th className="app-table-th">Logins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {observability.series.map((d) => (
                      <tr key={d.date}>
                        <td className="app-table-td whitespace-nowrap">{d.date}</td>
                        <td className="app-table-td">{d.dau}</td>
                        <td className="app-table-td">
                          {d.emailsSent + d.emailsLogged}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {' '}
                            (sent {d.emailsSent}, logged {d.emailsLogged})
                          </span>
                        </td>
                        <td className="app-table-td">
                          {d.smsSent + d.smsLogged}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {' '}
                            (sent {d.smsSent}, logged {d.smsLogged})
                          </span>
                        </td>
                        <td className="app-table-td">{d.spareRequestsCreated}</td>
                        <td className="app-table-td">{d.spareRequestsFilled}</td>
                        <td className="app-table-td">{d.spareOffersCancelled}</td>
                        <td className="app-table-td">{d.logins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Date range: {observability.startDate} – {observability.endDate} · Members total:{' '}
                {observability.totals.membersTotal}
              </div>
            </>
          )}

          {!obsLoading && !observability && (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Metrics aren’t available yet.
            </div>
          )}
        </div>
      </AppPage>
    </>
  );
}
