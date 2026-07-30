import type { RegistrationPlayInEntrySummary } from './registrationViewEditShared';

const MEMBERSHIP_CONTACT_EMAIL = 'membership@trianglecurling.com';

export const PLAY_IN_RETURNING_UNGUARANTEED_NOTICE =
  'Based on this team roster, you may be required to participate in the play-in event to join this league. In the event that you are unsuccessful entering the league, you can join waitlists on the next page to specify a back-up league.';

export function playInGuaranteeStatusText(
  leagueName: string,
  summary: RegistrationPlayInEntrySummary,
  options?: { isReturning?: boolean },
): string {
  if (summary.guaranteed) {
    return `This team is guaranteed entry into ${leagueName}.`;
  }
  if (options?.isReturning) {
    return PLAY_IN_RETURNING_UNGUARANTEED_NOTICE;
  }
  return `This team may need to play down for a spot in ${leagueName}.`;
}

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function playInEntryTeamMembersText(
  team: NonNullable<RegistrationPlayInEntrySummary['existingTeam']>,
): string {
  return team.members
    .map((member) => (member.pendingName ? `${member.pendingName} (not yet registered)` : member.memberName ?? ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Read-only view of the declared play-in entry team the registrant is already on,
 * shown instead of the team roster editor.
 */
export function RegistrationPlayInExistingTeamNotice({
  leagueName,
  summary,
}: {
  leagueName: string;
  summary: RegistrationPlayInEntrySummary;
}) {
  const team = summary.existingTeam;
  if (!team) return null;
  return (
    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-semibold">
        You've already been added to a {leagueName} team
        {team.createdByName ? ` by ${team.createdByName}` : ''}.
      </p>
      <ul className="mt-2 space-y-1">
        {team.members.map((member, index) => (
          <li key={`${member.memberId ?? member.pendingName ?? index}`}>
            {member.memberName ?? member.pendingName}
            {member.pendingName ? ' (not yet registered)' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-3">
        Not your team? Contact{' '}
        <a className="font-medium underline" href={`mailto:${MEMBERSHIP_CONTACT_EMAIL}`}>
          {MEMBERSHIP_CONTACT_EMAIL}
        </a>{' '}
        ASAP.
      </p>
    </div>
  );
}

/** Shown while live guarantee evaluation runs for a newly completed draft roster. */
export function RegistrationPlayInGuaranteeLoading() {
  return (
    <div
      className="mt-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-primary-teal border-t-transparent motion-reduce:animate-none"
        aria-hidden
      />
      <p>Checking TLINE points…</p>
    </div>
  );
}

/**
 * Guarantee/playdown result for a play-in entry team: guaranteed teams pay
 * immediately, all other teams defer payment until placement.
 */
export function RegistrationPlayInGuaranteeResult({
  leagueName,
  summary,
  isReturning = false,
}: {
  leagueName: string;
  summary: RegistrationPlayInEntrySummary;
  /** Returning competitive players get the waitlist-backup notice when not guaranteed. */
  isReturning?: boolean;
}) {
  if (summary.teamTotalPoints == null) return null;
  const pointsDetail = `Team points: ${formatPoints(summary.teamTotalPoints)}${
    summary.guaranteeThresholdPoints != null
      ? ` · Guaranteed-entry threshold: more than ${formatPoints(summary.guaranteeThresholdPoints)} points`
      : ''
  }`;
  if (summary.guaranteed) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Your team is guaranteed entry into {leagueName}.</p>
        <p className="mt-1">{pointsDetail}</p>
        <p className="mt-1">Payment for this league is due with registration.</p>
      </div>
    );
  }
  if (isReturning) {
    return (
      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p>{PLAY_IN_RETURNING_UNGUARANTEED_NOTICE}</p>
        <p className="mt-2">{pointsDetail}</p>
        {summary.meetsReturningRule === false ? (
          <p className="mt-1">
            Teams need at least two returning {leagueName} curlers to qualify for automatic entry.
          </p>
        ) : null}
        <p className="mt-1">Payment for this league is deferred until after the playdown is complete.</p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      <p className="font-semibold">Your team may need to play down for a spot in {leagueName}.</p>
      <p className="mt-1">{pointsDetail}</p>
      {summary.meetsReturningRule === false ? (
        <p className="mt-1">
          Teams need at least two returning {leagueName} curlers to qualify for automatic entry.
        </p>
      ) : null}
      <p className="mt-1">Payment for this league is deferred until after the playdown is complete.</p>
    </div>
  );
}
