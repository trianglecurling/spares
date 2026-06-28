import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import api from '../utils/api';

type PublicLeagueRow = {
  id: number;
  name: string;
  leagueTypeText: string;
  capacityText: string;
  datesText: string;
  drawTimesText: string;
  coordinators: string[];
  costText: string;
  publicNotes: string | null;
};

type PublicLeaguesResponse = {
  session: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  previousSession: { id: number; name: string } | null;
  nextSession: { id: number; name: string } | null;
  leagues: PublicLeagueRow[];
};

const HEADER_COLORS = ['bg-primary-orange', 'bg-primary-teal'] as const;

function sessionLeaguesHref(sessionId: number): string {
  return `/leagues/public?sessionId=${sessionId}`;
}

export default function PublicLeaguesPage() {
  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('sessionId');
  const sessionId =
    sessionIdParam != null && sessionIdParam !== '' ? Number.parseInt(sessionIdParam, 10) : null;

  const [data, setData] = useState<PublicLeaguesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const query = sessionId != null && Number.isFinite(sessionId) ? `?sessionId=${sessionId}` : '';
    api
      .get<PublicLeaguesResponse>(`/public/leagues${query}`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg || 'Failed to load leagues');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const pageTitle = useMemo(() => {
    if (!data) return 'Leagues';
    return `${data.session.name} Leagues`;
  }, [data]);

  if (loading) {
    return (
      <PublicLayout>
        <SeoMeta title="Leagues | Triangle Curling Club" description="League schedules and information." canonicalPath="/leagues/public" />
        <section className="public-section">
          <div className="public-container">
            <PublicStateCard title="Loading leagues" description="Gathering league information for this session." />
          </div>
        </section>
      </PublicLayout>
    );
  }

  if (error || !data) {
    return (
      <PublicLayout>
        <SeoMeta title="Leagues | Triangle Curling Club" description="League schedules and information." canonicalPath="/leagues/public" />
        <section className="public-section">
          <div className="public-container">
            <PublicStateCard title="Unable to load leagues" description={error || 'No league information is available.'} tone="warning" />
          </div>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title={`${pageTitle} | Triangle Curling Club`}
        description={`League formats, dates, draw times, and registration information for ${data.session.name}.`}
        canonicalPath="/leagues/public"
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            <article>
              <div className="public-page-title-rule">
                <h1 className="public-heading text-balance">{pageTitle}</h1>
              </div>

              <div className="mb-6 flex items-center justify-between gap-4">
                {data.previousSession ? (
                  <Link
                    to={sessionLeaguesHref(data.previousSession.id)}
                    className="text-sm font-medium text-primary-teal-link hover:underline"
                  >
                    ← {data.previousSession.name} Leagues
                  </Link>
                ) : (
                  <span />
                )}
                {data.nextSession ? (
                  <Link
                    to={sessionLeaguesHref(data.nextSession.id)}
                    className="text-sm font-medium text-primary-teal-link hover:underline"
                  >
                    {data.nextSession.name} Leagues →
                  </Link>
                ) : (
                  <span />
                )}
              </div>

              <p className="mb-8 text-gray-700">
                See the{' '}
                <Link to="/articles/membership" className="text-primary-teal-link underline">
                  membership page
                </Link>{' '}
                for membership options and pricing.
              </p>

              {data.leagues.length === 0 ? (
                <PublicStateCard
                  title="No leagues configured"
                  description="This session does not have any leagues yet."
                  tone="neutral"
                />
              ) : (
                <div className="space-y-8">
                  {data.leagues.map((league, index) => {
                    const headerColor = HEADER_COLORS[index % HEADER_COLORS.length];
                    const drawLabel = league.drawTimesText.includes(' and ') ? 'Draw times' : 'Draw time';
                    return (
                      <table key={league.id} className="w-full border-collapse border border-gray-300">
                        <tbody>
                          <tr>
                            <th
                              colSpan={2}
                              className={`${headerColor} px-3 py-2 text-left text-lg font-semibold text-white`}
                            >
                              {league.name}
                            </th>
                          </tr>
                          <LeagueInfoRow label="League type" value={league.leagueTypeText} />
                          <LeagueInfoRow label="Capacity" value={league.capacityText} />
                          <LeagueInfoRow label="Dates" value={league.datesText} />
                          {league.drawTimesText ? (
                            <LeagueInfoRow label={drawLabel} value={league.drawTimesText} />
                          ) : null}
                          <LeagueInfoRow label="Cost" value={league.costText} />
                          {league.coordinators.length > 0 ? (
                            <LeagueInfoRow label="Coordinator" value={league.coordinators.join(' and ')} />
                          ) : null}
                          {league.publicNotes ? <LeagueInfoRow label="Note" value={league.publicNotes} /> : null}
                        </tbody>
                      </table>
                    );
                  })}
                </div>
              )}

              <p className="mt-8 text-sm text-gray-600">Leagues subject to change based on registrations and other factors.</p>
            </article>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function LeagueInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-300">
      <td className="w-1/4 border-r border-gray-300 bg-gray-50 px-3 py-2 font-medium">{label}:</td>
      <td className="px-3 py-2 text-gray-800">{value}</td>
    </tr>
  );
}
