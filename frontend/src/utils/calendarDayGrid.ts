/**
 * Geometry shared by every hour-grid calendar surface (calendar day/week views and
 * the ice booking picker) so they stay visually aligned.
 */

/** Row height for one hour, in pixels. One pixel per minute. */
export const HOUR_HEIGHT = 60;

/** Hours before this are hidden unless something is scheduled in them. */
export const EARLY_HOURS_END = 6;

export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

type TimeSpan = { start: Date; end: Date };

/** Returns hours to display: 0–23 if anything falls before 6am, else 6–23. */
export function getVisibleHours(timedEvents: TimeSpan[]): number[] {
  const hasEarlyEvents = timedEvents.some((e) => {
    const startH = e.start.getHours() + e.start.getMinutes() / 60;
    const endH = e.end.getHours() + e.end.getMinutes() / 60;
    return startH < EARLY_HOURS_END || endH < EARLY_HOURS_END;
  });
  return hasEarlyEvents ? ALL_HOURS : ALL_HOURS.slice(EARLY_HOURS_END);
}

/** Hour label matching the calendar time gutter, e.g. `12 am`, `7 pm`. */
export function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 am';
  if (hour < 12) return `${hour} am`;
  if (hour === 12) return '12 pm';
  return `${hour - 12} pm`;
}

/** Layout per event: { column, numColumns }. Overlap = share non-zero time: X.start < Y.end && Y.start < X.end */
export function computeEventLayout<T extends { id: string; start: Date; end: Date }>(
  events: T[]
): Map<string, { column: number; numColumns: number }> {
  const result = new Map<string, { column: number; numColumns: number }>();
  if (events.length === 0) return result;

  // Step 1: Sort by start asc, then by end desc (longer first)
  const sorted = [...events].sort((a, b) => {
    const d = a.start.getTime() - b.start.getTime();
    if (d !== 0) return d;
    return b.end.getTime() - a.end.getTime();
  });

  // Step 2: Identify overlap groups (connected components)
  const groups: T[][] = [];
  let currentGroup: T[] = [];
  let latestEnd = -1;

  for (const ev of sorted) {
    const start = ev.start.getTime();
    const end = ev.end.getTime();
    if (start >= latestEnd) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      latestEnd = end;
      currentGroup.push(ev);
    } else {
      latestEnd = Math.max(latestEnd, end);
      currentGroup.push(ev);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Step 3 & 4 & 5: For each group, compute numColumns, assign columns, store layout
  for (const group of groups) {
    // Step 3: Max concurrency via sweep
    const sweep: { t: number; delta: number }[] = [];
    for (const ev of group) {
      sweep.push({ t: ev.start.getTime(), delta: 1 });
      sweep.push({ t: ev.end.getTime(), delta: -1 });
    }
    sweep.sort((a, b) => a.t - b.t || a.delta - b.delta); // ends before starts at same time
    let count = 0;
    let numColumns = 0;
    for (const { delta } of sweep) {
      count += delta;
      numColumns = Math.max(numColumns, count);
    }
    numColumns = Math.max(1, numColumns);

    // Step 4: Assign column to each event (columns 0..numColumns-1, use "lowest available")
    const columnEnds: number[] = [];
    for (const ev of group) {
      const start = ev.start.getTime();
      const end = ev.end.getTime();
      let col = 0;
      while (col < columnEnds.length && columnEnds[col]! > start) col++;
      if (col === columnEnds.length) columnEnds.push(end);
      else columnEnds[col] = Math.max(columnEnds[col]!, end);
      result.set(ev.id, { column: col, numColumns });
    }
  }

  return result;
}
