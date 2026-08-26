/**
 * Rostered waitlist entries must outrank every individual waitlist, the same
 * way play-in leagues must outrank every other league on the registration
 * priority list. Relative order within each block is preserved.
 */
export type WaitlistPreferenceFlag = {
  requiresByotRoster: boolean;
};

export const ROSTERED_WAITLIST_ORDER_TOOLTIP =
  'Team waitlists must be prioritized higher than individual waitlists.';

export function clampWaitlistPreferenceOrder<T extends WaitlistPreferenceFlag>(entries: T[]): T[] {
  const rostered = entries.filter((entry) => entry.requiresByotRoster);
  const other = entries.filter((entry) => !entry.requiresByotRoster);
  return [...rostered, ...other];
}

export function isWaitlistPreferenceOrderClamped<T extends WaitlistPreferenceFlag>(entries: T[]): boolean {
  let seenOther = false;
  for (const entry of entries) {
    if (entry.requiresByotRoster) {
      if (seenOther) return false;
    } else {
      seenOther = true;
    }
  }
  return true;
}

/**
 * Used by drag-and-drop so the live preview cannot cross the rostered /
 * individual boundary.
 */
export function canReorderWaitlistPreferenceDrop(
  active: WaitlistPreferenceFlag,
  over: WaitlistPreferenceFlag,
): boolean {
  return active.requiresByotRoster === over.requiresByotRoster;
}

/** Insert a newly joined waitlist at the end of its preference block. */
export function insertWaitlistInPreferenceOrder<T extends WaitlistPreferenceFlag>(
  entries: T[],
  added: T,
): T[] {
  if (!added.requiresByotRoster) {
    return [...entries, added];
  }
  const lastRosteredIndex = entries.reduce(
    (last, entry, index) => (entry.requiresByotRoster ? index : last),
    -1,
  );
  const next = [...entries];
  next.splice(lastRosteredIndex + 1, 0, added);
  return next;
}
