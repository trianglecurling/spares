import { formatClubDateTime } from './clubTime';

type EventTimespanLike = {
  start_dt?: string;
  end_dt?: string;
  startDt?: string;
  endDt?: string;
  sort_order?: number;
  sortOrder?: number;
};

function timespanStart(timespan: EventTimespanLike): string {
  return timespan.start_dt || timespan.startDt || '';
}

function timespanSortKey(timespan: EventTimespanLike): number {
  return timespan.sort_order ?? timespan.sortOrder ?? 0;
}

/** First timespan start, for sorting linked sessions chronologically. */
export function linkedSessionSortKey(timespans: EventTimespanLike[] | null | undefined): string {
  if (!timespans?.length) return '';
  const sorted = [...timespans].sort((a, b) => timespanSortKey(a) - timespanSortKey(b));
  return timespanStart(sorted[0]);
}

/** Short date/time for disambiguating same-titled linked sessions. */
export function formatLinkedSessionWhen(timespans: EventTimespanLike[] | null | undefined): string {
  if (!timespans?.length) return 'Schedule TBD';
  const sorted = [...timespans].sort((a, b) => timespanSortKey(a) - timespanSortKey(b));
  const startRaw = timespanStart(sorted[0]);
  if (!startRaw) return 'Schedule TBD';
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return startRaw;
  return formatClubDateTime(start, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    dateStyle: undefined,
    timeStyle: undefined,
  });
}

/** Title plus schedule, e.g. "Learn to Curl — Mon, Mar 3, 2026, 6:00 PM". */
export function formatLinkedSessionEventLabel(
  title: string,
  timespans: EventTimespanLike[] | null | undefined,
): string {
  return `${title} — ${formatLinkedSessionWhen(timespans)}`;
}
