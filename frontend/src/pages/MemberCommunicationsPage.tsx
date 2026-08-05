import { useEffect, useState } from 'react';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import { useAuth } from '../contexts/AuthContext';
import api, { formatApiError } from '../utils/api';
import { memberHasScope } from '../utils/permissions';

type MemberCommsEmail = {
  id: number;
  name: string;
  subject: string;
  sortDate: string | null;
  previewUrl: string;
};

type MemberCommsSeasonGroup = {
  seasonId: number | null;
  seasonName: string;
  emails: MemberCommsEmail[];
};

type MemberCommunicationsResponse = {
  seasons: MemberCommsSeasonGroup[];
};

function formatEmailDate(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function MemberCommunicationsPage() {
  const { member } = useAuth();
  const isActiveMember = memberHasScope(member, 'member.active');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<MemberCommsSeasonGroup[]>([]);

  useEffect(() => {
    if (!isActiveMember) {
      setLoading(false);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .get<MemberCommunicationsResponse>('/member-communications')
      .then((res) => {
        if (canceled) return;
        setSeasons(Array.isArray(res.data?.seasons) ? res.data.seasons : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (canceled) return;
        setError(formatApiError(err, 'Unable to load member communications.'));
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [isActiveMember]);

  if (!isActiveMember) {
    return (
      <AppPage>
        <AppPageHeader title="Member communications" />
        <AppStateCard
          title="Current membership required"
          description="Member communications are available only to members with a membership for the current season."
        />
      </AppPage>
    );
  }

  if (loading) {
    return (
      <AppPage>
        <AppPageHeader title="Member communications" />
        <AppStateCard title="Loading member communications..." />
      </AppPage>
    );
  }

  if (error) {
    return (
      <AppPage>
        <AppPageHeader title="Member communications" />
        <AppStateCard title="Unable to load member communications" description={error} />
      </AppPage>
    );
  }

  const totalEmails = seasons.reduce((sum, group) => sum + group.emails.length, 0);

  return (
    <AppPage>
      <AppPageHeader
        title="Member communications"
        description="Past emails sent to club members, organized by season. Open a link to view the email preview."
      />

      {totalEmails === 0 ? (
        <AppStateCard
          title="No member communications yet"
          description="When member emails are published with public previews in Mautic, they will appear here."
        />
      ) : (
        <div className="space-y-6">
          {seasons.map((group) => (
            <section key={group.seasonId ?? 'other'} className="app-card p-6">
              <h2 className="app-section-title mb-4">{group.seasonName}</h2>
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {group.emails.map((email) => {
                  const dateLabel = formatEmailDate(email.sortDate);
                  return (
                    <li key={email.id} className="py-3 first:pt-0 last:pb-0">
                      <a
                        href={email.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                      >
                        <span className="text-sm font-medium text-primary-teal-link group-hover:underline">
                          {email.name}
                        </span>
                        {dateLabel ? (
                          <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
                            {dateLabel}
                          </span>
                        ) : null}
                      </a>
                      {email.subject && email.subject !== email.name ? (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{email.subject}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppPage>
  );
}
