export type FormattedEventWhen = {
  text: string;
  html: string;
};

type EventTimespanLike = {
  start_dt?: string;
  end_dt?: string;
  startDt?: string;
  endDt?: string;
  sort_order?: number;
  sortOrder?: number;
};

const LONG_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

function sameCalendarDay(start: Date, end: Date): boolean {
  return (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  );
}

function formatOneTimespan(startDt: string, endDt: string): { text: string; html: string } {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);

    if (sameCalendarDay(start, end)) {
      const date = start.toLocaleDateString('en-US', LONG_DATE_FORMAT);
      const timeRange = `${start.toLocaleTimeString('en-US', TIME_FORMAT)} to ${end.toLocaleTimeString('en-US', TIME_FORMAT)}`;
      return {
        text: `${date}\n${timeRange}`,
        html: `${date}<br>${timeRange}`,
      };
    }

    const startDate = start.toLocaleDateString('en-US', LONG_DATE_FORMAT);
    const endDate = end.toLocaleDateString('en-US', LONG_DATE_FORMAT);
    return {
      text: `Start: ${startDate}\nEnd: ${endDate}`,
      html: `Start: ${startDate}<br>End: ${endDate}`,
    };
  } catch {
    return { text: startDt, html: startDt };
  }
}

/** Matches public event detail page timespan display (all spans, single- vs multi-day). */
export function formatEventTimespansForDisplay(
  timespans: EventTimespanLike[] | null | undefined,
): FormattedEventWhen {
  if (!timespans?.length) {
    return { text: 'TBD', html: 'TBD' };
  }

  const normalized = timespans
    .map((ts) => ({
      start: ts.start_dt ?? ts.startDt ?? '',
      end: ts.end_dt ?? ts.endDt ?? ts.start_dt ?? ts.startDt ?? '',
      sortOrder: ts.sort_order ?? ts.sortOrder ?? 0,
    }))
    .filter((ts) => ts.start.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.start.localeCompare(b.start));

  if (normalized.length === 0) {
    return { text: 'TBD', html: 'TBD' };
  }

  const formatted = normalized.map((ts) => formatOneTimespan(ts.start, ts.end));
  return {
    text: formatted.map((part) => part.text).join('\n\n'),
    html: formatted.map((part) => part.html).join('<br><br>'),
  };
}
