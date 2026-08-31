import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppStateCard from '../AppStateCard';
import InlineStateMessage from '../InlineStateMessage';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import {
  formatVolunteerHoursLabel,
  type VolunteerStatsView,
} from '../../utils/volunteering';
import VolunteerSeasonLedgerDialog from './VolunteerSeasonLedgerDialog';

const APPRECIATION_COPY =
  "Volunteers are the backbone of Triangle Curling. Each individual that contributes to our Mission is appreciated and cherished. Many members volunteer their time in ways that aren't tracked by this system, but their contributions are no less valuable. Even though they don't show up here, their efforts are greatly appreciated.";

export default function VolunteerStatsPanel() {
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<VolunteerStatsView | null>(null);
  const [ledgerMember, setLedgerMember] = useState<{ memberId: number; name: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<VolunteerStatsView>('/volunteering/stats');
      setStats(data);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load volunteering stats'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <AppStateCard
        title="Loading volunteering stats"
        description="Fetching club and personal volunteer totals."
      />
    );
  }

  if (!stats) {
    return (
      <AppStateCard
        title="Unable to load stats"
        description="Volunteer statistics could not be loaded. Try again in a moment."
      />
    );
  }

  const seasonLabel = stats.season
    ? `Season totals use the ${stats.season.name} season.`
    : 'There is no season 30 days from now, so season totals are empty.';

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">{seasonLabel}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="app-card space-y-5 p-5" aria-labelledby="volunteer-stats-club">
          <h2 id="volunteer-stats-club" className="app-section-title">
            Club
          </h2>
          <PeriodStats
            hours={stats.club.hours}
            shifts={stats.club.shifts}
            hoursHeadingId="volunteer-stats-club-hours"
            shiftsHeadingId="volunteer-stats-club-shifts"
          />
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Unique volunteers this season
            </h3>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {stats.club.uniqueVolunteersSeason}
              {stats.club.uniqueVolunteerPercentSeason != null && stats.club.membershipCountSeason > 0
                ? ` (${formatPercent(stats.club.uniqueVolunteerPercentSeason)} of ${stats.club.membershipCountSeason} members)`
                : null}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Hours per member</h3>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {stats.club.hoursPerMemberSeason != null
                ? formatVolunteerHoursLabel(stats.club.hoursPerMemberSeason)
                : '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Current season, across all members</p>
          </div>
        </section>

        <section className="app-card space-y-5 p-5" aria-labelledby="volunteer-stats-you">
          <h2 id="volunteer-stats-you" className="app-section-title">
            You
          </h2>
          <PeriodStats
            hours={stats.me.hours}
            shifts={stats.me.shifts}
            hoursHeadingId="volunteer-stats-you-hours"
            shiftsHeadingId="volunteer-stats-you-shifts"
          />
          {stats.me.seasonRank != null ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You are {formatOrdinal(stats.me.seasonRank)} this season
              {stats.me.seasonRank > 10 ? ' (outside the top 10)' : ''}.
            </p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Log volunteering or complete a shift to appear on this season’s leaderboard.
            </p>
          )}
        </section>
      </div>

      <div className="app-card space-y-3 p-5">
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{APPRECIATION_COPY}</p>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          If you{' '}
          <Link to="/volunteering?tab=hours" className="text-primary-teal-link hover:underline">
            log volunteering
          </Link>{' '}
          outside of a sign-up, those hours will count on this page too.
        </p>
      </div>

      <section className="app-card space-y-3 p-5" aria-labelledby="volunteer-stats-leaderboard">
        <div>
          <h2 id="volunteer-stats-leaderboard" className="app-section-title">
            {stats.season
              ? `${stats.season.name} volunteer leaderboard`
              : 'Volunteer leaderboard'}
          </h2>
          <p className="app-section-subtitle mt-1">Top 10 by completed hours this season</p>
        </div>
        {stats.leaderboard.length === 0 ? (
          <InlineStateMessage title="No completed volunteer hours this season yet." />
        ) : (
          <div className="app-table-shell">
            <table className="app-table">
              <caption className="sr-only">Top volunteers by hours this season</caption>
              <thead className="app-table-head">
                <tr>
                  <th className="app-table-th w-16" scope="col">
                    Rank
                  </th>
                  <th className="app-table-th" scope="col">
                    Volunteer
                  </th>
                  <th className="app-table-th text-right" scope="col">
                    Hours
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {stats.leaderboard.map((entry) => (
                  <tr
                    key={entry.memberId}
                    className={
                      entry.isViewer ? 'bg-primary-teal/5 dark:bg-primary-teal/10' : undefined
                    }
                  >
                    <td className="app-table-td font-medium text-gray-900 dark:text-gray-100">
                      {entry.rank}
                    </td>
                    <td className="app-table-td">
                      <button
                        type="button"
                        className="text-primary-teal-link hover:underline"
                        onClick={() => setLedgerMember({ memberId: entry.memberId, name: entry.name })}
                        aria-label={`View ${entry.name}’s volunteer activities`}
                      >
                        {entry.name}
                      </button>
                      {entry.isViewer ? (
                        <span className="ml-2 text-xs font-medium text-primary-teal">You</span>
                      ) : null}
                    </td>
                    <td className="app-table-td text-right tabular-nums">
                      {formatVolunteerHoursLabel(entry.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ledgerMember ? (
        <VolunteerSeasonLedgerDialog
          memberId={ledgerMember.memberId}
          memberName={ledgerMember.name}
          onClose={() => setLedgerMember(null)}
        />
      ) : null}
    </div>
  );
}

function PeriodStats({
  hours,
  shifts,
  hoursHeadingId,
  shiftsHeadingId,
}: {
  hours: { month: number; season: number; lifetime: number };
  shifts: { month: number; season: number; lifetime: number };
  hoursHeadingId: string;
  shiftsHeadingId: string;
}) {
  return (
    <>
      <div>
        <h3 id={hoursHeadingId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Volunteer hours
        </h3>
        <dl className="mt-2 grid grid-cols-3 gap-3" aria-labelledby={hoursHeadingId}>
          <PeriodStat label="This month" value={formatVolunteerHoursLabel(hours.month)} />
          <PeriodStat label="This season" value={formatVolunteerHoursLabel(hours.season)} />
          <PeriodStat label="Since Aug 2026" value={formatVolunteerHoursLabel(hours.lifetime)} />
        </dl>
      </div>
      <div>
        <h3 id={shiftsHeadingId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Shifts
        </h3>
        <dl className="mt-2 grid grid-cols-3 gap-3" aria-labelledby={shiftsHeadingId}>
          <PeriodStat label="This month" value={formatShiftCount(shifts.month)} />
          <PeriodStat label="This season" value={formatShiftCount(shifts.season)} />
          <PeriodStat label="Since Aug 2026" value={formatShiftCount(shifts.lifetime)} />
        </dl>
      </div>
    </>
  );
}

function PeriodStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

function formatShiftCount(count: number): string {
  return count === 1 ? '1 shift' : `${count} shifts`;
}

function formatPercent(value: number): string {
  return `${value}%`;
}

function formatOrdinal(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
