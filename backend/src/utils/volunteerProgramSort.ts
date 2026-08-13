/**
 * Discovery sort for volunteer programs on the hub and member dashboard.
 * Lower priority numbers come first. Missing priority is treated as infinity.
 * Programs with the same priority are ordered by the next upcoming shift start.
 */
export function compareVolunteerProgramsForDiscovery(a: {
  priority: number | null;
  nextShiftStart: string | null;
  title: string;
}, b: {
  priority: number | null;
  nextShiftStart: string | null;
  title: string;
}): number {
  const aPriority = a.priority ?? Number.POSITIVE_INFINITY;
  const bPriority = b.priority ?? Number.POSITIVE_INFINITY;
  if (aPriority !== bPriority) return aPriority - bPriority;

  const aFirst = a.nextShiftStart;
  const bFirst = b.nextShiftStart;
  if (aFirst && bFirst) {
    const byShift = aFirst.localeCompare(bFirst);
    if (byShift !== 0) return byShift;
  } else if (aFirst) {
    return -1;
  } else if (bFirst) {
    return 1;
  }

  return a.title.localeCompare(b.title);
}
