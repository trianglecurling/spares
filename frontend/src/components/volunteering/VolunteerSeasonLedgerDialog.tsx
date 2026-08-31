import { useCallback, useEffect, useState } from 'react';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import api, { formatApiError } from '../../utils/api';
import {
  formatVolunteerDateOnly,
  formatVolunteerHoursLabel,
  type VolunteerSeasonLedgerView,
} from '../../utils/volunteering';

type VolunteerSeasonLedgerDialogProps = {
  memberId: number;
  memberName: string;
  onClose: () => void;
};

export default function VolunteerSeasonLedgerDialog({
  memberId,
  memberName,
  onClose,
}: VolunteerSeasonLedgerDialogProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<VolunteerSeasonLedgerView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<VolunteerSeasonLedgerView>(
        `/volunteering/stats/leaderboard/${memberId}`
      );
      setLedger(data);
    } catch (err) {
      setLedger(null);
      setError(formatApiError(err, 'Volunteer activity is only available for the current season top 10.'));
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = ledger?.memberName || memberName;
  const seasonName = ledger?.season.name;

  return (
    <Modal isOpen onClose={onClose} title={`${displayName}'s volunteering`} size="lg">
      <div className="space-y-4">
        {seasonName ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {seasonName} season
            {ledger ? ` · ${formatVolunteerHoursLabel(ledger.totalHours)}` : ''}
          </p>
        ) : null}

        {loading ? (
          <InlineStateMessage title="Loading volunteer activity" description="Fetching this season’s ledger." />
        ) : null}

        {!loading && error ? <InlineStateMessage title={error} tone="error" /> : null}

        {!loading && !error && ledger && ledger.activities.length === 0 ? (
          <InlineStateMessage title="No volunteer activity recorded this season." />
        ) : null}

        {!loading && !error && ledger && ledger.activities.length > 0 ? (
          <div className="app-table-shell">
            <table className="app-table">
              <caption className="sr-only">
                {displayName}’s volunteer activities
                {seasonName ? ` in the ${seasonName} season` : ''}
              </caption>
              <thead className="app-table-head">
                <tr>
                  <th className="app-table-th" scope="col">
                    Date
                  </th>
                  <th className="app-table-th" scope="col">
                    Activity
                  </th>
                  <th className="app-table-th text-right" scope="col">
                    Hours
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {ledger.activities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="app-table-td whitespace-nowrap">
                      {formatVolunteerDateOnly(activity.date)}
                    </td>
                    <td className="app-table-td">
                      <div>{activity.summary}</div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {activity.kind === 'self_report' ? 'Self-reported' : 'Shift'}
                        {activity.detail ? ` · ${activity.detail}` : ''}
                      </div>
                    </td>
                    <td className="app-table-td text-right tabular-nums">
                      {formatVolunteerHoursLabel(activity.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
