import {
  canReorderWaitlistPreferenceDrop,
  clampWaitlistPreferenceOrder,
  insertWaitlistInPreferenceOrder,
  isWaitlistPreferenceOrderClamped,
  ROSTERED_WAITLIST_ORDER_TOOLTIP,
} from '../../../../backend/src/registration/waitlistPreferenceOrder';

export {
  canReorderWaitlistPreferenceDrop,
  clampWaitlistPreferenceOrder,
  insertWaitlistInPreferenceOrder,
  isWaitlistPreferenceOrderClamped,
  ROSTERED_WAITLIST_ORDER_TOOLTIP,
};

export type MemberWaitlistChangeEntry = {
  waitlistId: number;
  waitlistName: string;
  requiresByotRoster?: boolean;
};

export type MemberWaitlistChangeSummary = {
  joined: MemberWaitlistChangeEntry[];
  left: MemberWaitlistChangeEntry[];
  reordered: boolean;
  hasChanges: boolean;
  message: string;
};

export function summarizeMemberWaitlistChanges(
  previous: MemberWaitlistChangeEntry[],
  next: MemberWaitlistChangeEntry[],
): MemberWaitlistChangeSummary {
  const previousIds = previous.map((entry) => entry.waitlistId);
  const nextIds = next.map((entry) => entry.waitlistId);
  const previousById = new Map(previous.map((entry) => [entry.waitlistId, entry]));
  const nextById = new Map(next.map((entry) => [entry.waitlistId, entry]));

  const joined = next.filter((entry) => !previousById.has(entry.waitlistId));
  const left = previous.filter((entry) => !nextById.has(entry.waitlistId));
  const remainingPrevious = previousIds.filter((id) => nextById.has(id));
  const remainingNext = nextIds.filter((id) => previousById.has(id));
  const reordered =
    remainingPrevious.length > 1 && remainingPrevious.some((id, index) => remainingNext[index] !== id);
  const hasChanges = joined.length > 0 || left.length > 0 || reordered;

  const lines: string[] = [];
  if (joined.length > 0) {
    lines.push('Join:');
    for (const entry of joined) {
      lines.push(`- ${entry.waitlistName}`);
    }
  }
  if (left.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      left.some((entry) => entry.requiresByotRoster)
        ? 'Leave (team waitlists remove the whole roster and email everyone):'
        : 'Leave (you will lose your queue position):',
    );
    for (const entry of left) {
      lines.push(`- ${entry.waitlistName}`);
    }
  }
  if (reordered || joined.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Your waitlist preference will be:');
    next.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.waitlistName}`);
    });
  } else if (left.length > 0 && next.length > 0) {
    lines.push('');
    lines.push('Remaining waitlists, in preference order:');
    next.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.waitlistName}`);
    });
  }

  return {
    joined,
    left,
    reordered,
    hasChanges,
    message: hasChanges ? lines.join('\n') : 'No waitlist changes to save.',
  };
}

export function formatWaitlistQueuePosition(position: number | null, total: number | null): string | null {
  if (position == null || total == null) return null;
  return `Position ${position} of ${total}`;
}

export function formatAttachedLeagueNames(
  leagues: Array<{ name: string; sessionName?: string | null }>,
): string {
  if (leagues.length === 0) return '';
  return leagues
    .map((league) => (league.sessionName ? `${league.name} (${league.sessionName})` : league.name))
    .join(', ');
}
