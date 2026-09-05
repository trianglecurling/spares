import { useEffect, useState } from 'react';
import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import api, { getApiErrorMessage } from '../../utils/api';

export type WaitlistStaffPriorityWaitlist = {
  waitlistId: number;
  waitlistName: string;
  priorityRank: number;
};

export type WaitlistStaffPriorityLeague = {
  leagueId: number;
  leagueName: string;
  priorityRank: number;
};

export type WaitlistStaffMemberPriorityDetails = {
  memberId: number;
  memberName: string;
  waitlists: WaitlistStaffPriorityWaitlist[];
  registration: {
    id: number;
    desiredLeagueCount: number | null;
    leaguePriorities: WaitlistStaffPriorityLeague[];
  } | null;
};

export type WaitlistStaffPriorityDetails = {
  entryId: number;
  waitlistId: number;
  members: WaitlistStaffMemberPriorityDetails[];
};

function desiredLeagueCountCopy(count: number | null): string {
  if (count == null) return 'Desired league count is not set on their most recent registration.';
  return `Wants ${count} ${count === 1 ? 'league' : 'leagues'}.`;
}

function PriorityList({
  items,
  emptyTitle,
}: {
  items: Array<{ key: number; rank: number; label: string; current?: boolean }>;
  emptyTitle: string;
}) {
  if (items.length === 0) {
    return <InlineStateMessage title={emptyTitle} />;
  }
  return (
    <ol className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
      {items.map((item) => (
        <li key={item.key} className="flex gap-2">
          <span className="w-6 shrink-0 tabular-nums text-gray-500">{item.rank}.</span>
          <span>
            {item.label}
            {item.current ? <span className="ml-2 text-xs text-gray-500">This waitlist</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MemberPrioritySections({
  member,
  currentWaitlistId,
}: {
  member: WaitlistStaffMemberPriorityDetails;
  currentWaitlistId: number;
}) {
  return (
    <div className="space-y-5">
      <section>
        <h4 className="app-section-title">Waitlists</h4>
        <div className="mt-2">
          <PriorityList
            emptyTitle="Not on any waitlists."
            items={member.waitlists.map((waitlist) => ({
              key: waitlist.waitlistId,
              rank: waitlist.priorityRank,
              label: waitlist.waitlistName,
              current: waitlist.waitlistId === currentWaitlistId,
            }))}
          />
        </div>
      </section>
      <section>
        <h4 className="app-section-title">League priority</h4>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {member.registration
            ? desiredLeagueCountCopy(member.registration.desiredLeagueCount)
            : 'No submitted registration.'}
        </p>
        <div className="mt-2">
          {member.registration ? (
            <PriorityList
              emptyTitle="No leagues on their most recent registration priority list."
              items={member.registration.leaguePriorities.map((league) => ({
                key: league.leagueId,
                rank: league.priorityRank,
                label: league.leagueName,
              }))}
            />
          ) : (
            <InlineStateMessage title="League priority is unavailable until they submit a registration." />
          )}
        </div>
      </section>
    </div>
  );
}

export default function WaitlistEntryPriorityDialog({
  entryId,
  title,
  onClose,
}: {
  entryId: number | null;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<WaitlistStaffPriorityDetails | null>(null);

  useEffect(() => {
    if (entryId == null) {
      setDetails(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetails(null);
    void api
      .get<WaitlistStaffPriorityDetails>(`/waitlists/entries/${entryId}/priority-details`)
      .then((response) => {
        if (!cancelled) setDetails(response.data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(loadError, 'Unable to load waitlist priorities.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const multiMember = (details?.members.length ?? 0) > 1;

  return (
    <Modal isOpen={entryId != null} onClose={onClose} title={title} size={multiMember ? 'lg' : 'md'}>
      <div className="space-y-5">
        {loading ? <InlineStateMessage title="Loading priorities…" /> : null}
        {error ? <InlineStateMessage title={error} tone="error" /> : null}
        {!loading && !error && details && details.members.length === 0 ? (
          <InlineStateMessage title="No members are linked to this waitlist entry." />
        ) : null}
        {!loading && !error && details
          ? details.members.map((member) => (
              <section key={member.memberId} className={multiMember ? 'rounded-lg border border-gray-200 p-4 dark:border-gray-700' : undefined}>
                {multiMember ? (
                  <h3 className="mb-4 text-base font-medium text-gray-900 dark:text-white">{member.memberName}</h3>
                ) : null}
                <MemberPrioritySections member={member} currentWaitlistId={details.waitlistId} />
              </section>
            ))
          : null}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
