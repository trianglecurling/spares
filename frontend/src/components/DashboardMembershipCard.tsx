import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import InlineStateMessage from './InlineStateMessage';
import { useAuth } from '../contexts/AuthContext';
import api, { getApiErrorMessage } from '../utils/api';

type MembershipCardPayload = {
  name: string;
  membershipStatus: {
    kind: 'regular' | 'social' | 'former' | 'non_member';
    validThrough: string | null;
  };
  icePrivilegesValidThrough: string | null;
  leagues: Array<{
    leagueId: number;
    leagueName: string;
    participation: 'roster' | 'sabbatical' | 'waitlist';
  }>;
};

function memberInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatDateDisplay(dateString: string) {
  const date = new Date(dateString);
  const userTimezoneOffset = date.getTimezoneOffset() * 60000;
  const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
  return adjustedDate.toLocaleDateString();
}

function membershipStatusLabel(kind: MembershipCardPayload['membershipStatus']['kind']) {
  if (kind === 'former') return 'Former member';
  if (kind === 'non_member') return 'Non-member';
  if (kind === 'social') return 'Social member';
  return 'Regular member';
}

function membershipStatusLine(status: MembershipCardPayload['membershipStatus']) {
  const label = membershipStatusLabel(status.kind);
  if (status.validThrough) {
    return `${label} through ${formatDateDisplay(status.validThrough)}`;
  }
  return label;
}

function participationLabel(participation: MembershipCardPayload['leagues'][number]['participation']) {
  if (participation === 'sabbatical') return 'Sabbatical';
  if (participation === 'waitlist') return 'Waitlist';
  return null;
}

export default function DashboardMembershipCard() {
  const { member } = useAuth();
  const [data, setData] = useState<MembershipCardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await api.get<MembershipCardPayload>('/members/me/membership-card');
        if (!cancelled) setData(response.data);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(getApiErrorMessage(err, 'Unable to load membership card.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

  const initials = useMemo(() => memberInitials(data?.name ?? ''), [data?.name]);

  const cardClassName =
    'h-full w-full rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm';

  if (loading) {
    return (
      <div className={cardClassName}>
        <InlineStateMessage title="Loading membership card..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cardClassName}>
        <InlineStateMessage
          tone="error"
          title={error ?? 'Membership card unavailable.'}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-primary-teal/20 dark:border-primary-teal/30 bg-gradient-to-br from-white via-teal-50/70 to-orange-50/40 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 p-5 shadow-sm">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary-teal/10 dark:bg-primary-teal/15"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-primary-orange/10 dark:bg-primary-orange/15"
      />

      <div className="relative flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-teal text-lg font-semibold text-white shadow-sm ring-4 ring-white/80 dark:ring-gray-800/80">
          {initials || '?'}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-teal/80 dark:text-primary-teal">
              Membership card
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{data.name}</h2>
          </div>

          <div className="space-y-1 text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {membershipStatusLine(data.membershipStatus)}
            </p>
            {data.icePrivilegesValidThrough ? (
              <p className="font-medium text-gray-900 dark:text-gray-100">
                Ice privileges through {formatDateDisplay(data.icePrivilegesValidThrough)}
              </p>
            ) : null}
          </div>

          {data.leagues.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Leagues</h3>
              <ul className="mt-2 space-y-1.5">
                {data.leagues.map((league) => {
                  const badge = participationLabel(league.participation);
                  return (
                    <li key={league.leagueId} className="flex items-center gap-2 text-sm">
                      <Link
                        to={`/leagues/${league.leagueId}`}
                        className="truncate font-medium text-primary-teal hover:underline"
                      >
                        {league.leagueName}
                      </Link>
                      {badge ? (
                        <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900/70 dark:text-gray-300 dark:ring-gray-600">
                          {badge}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
