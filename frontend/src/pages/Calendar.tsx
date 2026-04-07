/**
 * Calendar page - Day, Week, Month views with configurable event types.
 * Events support color-coding, icons, timed or all-day, and multi-day spanning.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import type { IconType } from 'react-icons';
import {
  HiAcademicCap,
  HiCalendar,
  HiCalendarDays,
  HiChevronLeft,
  HiChevronRight,
  HiClipboardDocumentList,
  HiOutlineCalendar,
  HiOutlineCalendarDays,
  HiOutlineCalendarDays as HiOutlineDay,
  HiPencil,
  HiPlus,
  HiStar,
  HiSun,
  HiTrash,
  HiUserGroup,
  HiWrench,
} from 'react-icons/hi2';
import api from '../utils/api';
import Button from '../components/Button';
import Layout from '../components/Layout';
import PublicLayout from '../components/PublicLayout';
import Modal from '../components/Modal';
import type { ArticleOption } from '../components/ArticleAutocomplete';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../contexts/AuthContext';

export type CalendarView = 'day' | 'week' | 'month';

interface CalendarProps {
  publicMode?: boolean;
}

/** Event type definition - eventually user/admin-configurable */
export interface CalendarEventType {
  id: string;
  label: string;
  color: string; // Tailwind classes: bg + text for light/dark, e.g. 'bg-slate-100 text-gray-900 dark:bg-slate-600 dark:text-white'
  icon: IconType;
}

/** Event location: configured sheet (on-ice) or fixed off-ice locations */
export type EventLocation =
  | { type: 'sheet'; sheetId: number; sheetName?: string }
  | { type: 'warm-room' }
  | { type: 'exterior' }
  | { type: 'offsite' }
  | { type: 'virtual' };

/** Calendar event - supports timed, all-day, and multi-day spanning */
export interface CalendarEvent {
  id: string;
  typeId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Markdown description - supports formatting */
  description?: string;
  locations?: EventLocation[];
  /** RRULE string when event is part of a recurring series (for edit form) */
  recurrenceRrule?: string;
  /** Display name of the member who created the event */
  createdBy?: string;
  /** Optional linked article for "More info" */
  article?: ArticleOption;
  /** Event source: 'direct' | 'leagues' | 'ice-booking' (read-only for leagues & ice) */
  source?: string;
}

/** True if event is from the leagues schedule (read-only) */
function isLeagueEvent(ev: CalendarEvent): boolean {
  return ev.source === 'leagues' || ev.id.startsWith('league:');
}

/** True if event is a member ice reservation (read-only on calendar) */
function isIceBookingEvent(ev: CalendarEvent): boolean {
  return ev.source === 'ice-booking' || ev.id.startsWith('ice-booking:');
}

/** True if event is from the events system (read-only on calendar) */
function isRegistrableEvent(ev: CalendarEvent): boolean {
  return ev.source === 'events' || ev.id.startsWith('event:');
}

/** Events that cannot be edited or deleted via calendar admin UI */
export function isReadOnlyCalendarEvent(ev: CalendarEvent): boolean {
  return isLeagueEvent(ev) || isIceBookingEvent(ev) || isRegistrableEvent(ev);
}

/** True if event takes place on a sheet (on-ice) */
function isOnIceEvent(ev: CalendarEvent): boolean {
  return (ev.locations ?? []).some((loc) => loc.type === 'sheet');
}

const LOCATION_LABELS: Record<string, string> = {
  'warm-room': 'Warm room',
  exterior: 'Exterior',
  offsite: 'Offsite',
  virtual: 'Virtual',
};

function getLocationLabel(loc: EventLocation, sheetNameById?: Map<number, string>): string {
  if (loc.type === 'sheet') {
    return sheetNameById?.get(loc.sheetId) ?? loc.sheetName ?? `Sheet ${loc.sheetId}`;
  }
  return LOCATION_LABELS[loc.type] ?? loc.type;
}

function formatNaturalList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatEventLocationsSummary(
  locations: EventLocation[],
  sheetNameById: Map<number, string>,
  totalSheetCount: number
): string {
  const sortedLocations = [...locations].sort((a, b) =>
    getLocationLabel(a, sheetNameById).localeCompare(getLocationLabel(b, sheetNameById))
  );
  const sheetNames = sortedLocations
    .filter((loc): loc is Extract<EventLocation, { type: 'sheet' }> => loc.type === 'sheet')
    .map((loc) => getLocationLabel(loc, sheetNameById));
  const otherNames = sortedLocations
    .filter((loc) => loc.type !== 'sheet')
    .map((loc) => getLocationLabel(loc, sheetNameById));

  const uniqueSheetNames = [...new Set(sheetNames)];
  const uniqueOtherNames = [...new Set(otherNames)];
  const hasAllSheets = totalSheetCount > 0 && uniqueSheetNames.length === totalSheetCount;
  const hasWarmRoom = sortedLocations.some((loc) => loc.type === 'warm-room');

  if (hasAllSheets) {
    const remainingOtherNames = hasWarmRoom
      ? uniqueOtherNames.filter((name) => name !== LOCATION_LABELS['warm-room'])
      : uniqueOtherNames;
    const allSheetsLabel = hasWarmRoom ? 'Entire facility' : 'All sheets';

    if (remainingOtherNames.length === 0) {
      return allSheetsLabel;
    }

    return formatNaturalList([allSheetsLabel, ...remainingOtherNames]);
  }

  if (uniqueOtherNames.length === 0 && uniqueSheetNames.length === 1) {
    return `Sheet ${uniqueSheetNames[0]}`;
  }
  if (uniqueOtherNames.length === 0 && uniqueSheetNames.length > 1) {
    return `Sheets ${formatNaturalList(uniqueSheetNames)}`;
  }

  // Mixed/non-sheet locations: keep a readable fallback list.
  const parts: string[] = [];
  if (uniqueSheetNames.length === 1) {
    parts.push(`Sheet ${uniqueSheetNames[0]}`);
  } else if (uniqueSheetNames.length > 1) {
    parts.push(`Sheets ${formatNaturalList(uniqueSheetNames)}`);
  }
  if (uniqueOtherNames.length > 0) {
    parts.push(formatNaturalList(uniqueOtherNames));
  }
  return formatNaturalList(parts);
}

function eventSpansSingleCalendarDay(ev: CalendarEvent): boolean {
  return isSameDay(startOfDay(ev.start), startOfDay(ev.end));
}

/** Time segment for compact bands; omit when the event spans more than one calendar day. */
function eventBandTimeLabel(ev: CalendarEvent): string | null {
  if (!eventSpansSingleCalendarDay(ev)) return null;
  if (ev.allDay) return 'All day';
  return formatCompactTimeRange(ev.start, ev.end);
}

function getEventBandLocationSummary(
  ev: CalendarEvent,
  sheetNameById: Map<number, string>
): string | null {
  const locs = ev.locations;
  if (!locs?.length) return null;
  const s = formatEventLocationsSummary(locs, sheetNameById, sheetNameById.size);
  return s || null;
}

/** Horizontal band chips: type icon, title, optional location text, optional time (single calendar day only). */
function EventBandRowContent({
  ev,
  type,
  sheetNameById,
  iconClassName,
  layout = 'truncate',
}: {
  ev: CalendarEvent;
  type: CalendarEventType;
  sheetNameById: Map<number, string>;
  iconClassName: string;
  /** `wrap` breaks long text within narrow week all-day cells so grid columns stay aligned. */
  layout?: 'truncate' | 'wrap';
}) {
  const Icon = type.icon;
  const loc = getEventBandLocationSummary(ev, sheetNameById);
  const timeLabel = eventBandTimeLabel(ev);
  const titleClass =
    layout === 'wrap'
      ? 'min-w-0 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]'
      : 'truncate min-w-0';
  const locClass =
    layout === 'wrap'
      ? 'min-w-0 break-words text-sm leading-snug [overflow-wrap:anywhere]'
      : 'shrink-0 truncate min-w-0';
  return (
    <>
      {layout === 'wrap' ? (
        <span className="inline-flex h-[1.25rem] shrink-0 items-center justify-center">
          <Icon className={iconClassName} />
        </span>
      ) : (
        <Icon className={`${iconClassName} shrink-0`} />
      )}
      <span className={titleClass}>{ev.title}</span>
      {loc && (
        <>
          <span className="shrink-0 leading-snug">·</span>
          <span className={locClass}>{loc}</span>
        </>
      )}
      {timeLabel && (
        <>
          <span className="shrink-0 leading-snug">·</span>
          <span
            className={
              layout === 'wrap' ? 'shrink-0 text-xs leading-snug opacity-90' : 'shrink-0'
            }
          >
            {timeLabel}
          </span>
        </>
      )}
    </>
  );
}

// Event type colors: light pastels with dark text for light theme, saturated with white text for dark theme
export const DEFAULT_EVENT_TYPES: CalendarEventType[] = [
  {
    id: 'maintenance',
    label: 'Maintenance',
    color:
      'bg-slate-200 text-gray-900 border-gray-900/50 dark:bg-slate-600 dark:text-white dark:border-white/25',
    icon: HiWrench,
  },
  {
    id: 'leagues',
    label: 'Leagues',
    color:
      'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-primary-teal dark:text-white dark:border-white/25',
    icon: HiCalendar,
  },
  {
    id: 'bonspiel',
    label: 'Bonspiel',
    color:
      'bg-violet-200 text-violet-900 border-violet-900/50 dark:bg-violet-500 dark:text-white dark:border-white/25',
    icon: HiCalendarDays,
  },
  {
    id: 'practice',
    label: 'Practice',
    color:
      'bg-amber-100 text-amber-900 border-amber-900/50 dark:bg-amber-500 dark:text-white dark:border-white/25',
    icon: HiOutlineCalendar,
  },
  {
    id: 'group-event',
    label: 'Group Event',
    color:
      'bg-emerald-100 text-emerald-900 border-emerald-900/50 dark:bg-emerald-600 dark:text-white dark:border-white/25',
    icon: HiUserGroup,
  },
  {
    id: 'clinic',
    label: 'Clinic',
    color:
      'bg-sky-100 text-sky-900 border-sky-900/50 dark:bg-sky-500 dark:text-white dark:border-white/25',
    icon: HiAcademicCap,
  },
  {
    id: 'social',
    label: 'Social',
    color:
      'bg-rose-100 text-rose-900 border-rose-900/50 dark:bg-rose-500 dark:text-white dark:border-white/25',
    icon: HiUserGroup,
  },
  {
    id: 'board-committee',
    label: 'Board & Committee',
    color:
      'bg-indigo-100 text-indigo-900 border-indigo-900/50 dark:bg-indigo-600 dark:text-white dark:border-white/25',
    icon: HiClipboardDocumentList,
  },
  {
    id: 'learn-to-curl',
    label: 'Learn to Curl',
    color:
      'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-teal-600 dark:text-white dark:border-white/25',
    icon: HiAcademicCap,
  },
  {
    id: 'off-season',
    label: 'Off-Season',
    color:
      'bg-orange-100 text-orange-900 border-orange-900/50 dark:bg-orange-500 dark:text-white dark:border-white/25',
    icon: HiSun,
  },
  {
    id: 'other',
    label: 'Other',
    color:
      'bg-gray-200 text-gray-900 border-gray-900/50 dark:bg-gray-500 dark:text-white dark:border-white/25',
    icon: HiOutlineCalendarDays,
  },
  {
    id: 'member-ice',
    label: 'Member booking',
    color:
      'bg-cyan-100 text-cyan-950 border-cyan-900/40 dark:bg-cyan-700 dark:text-white dark:border-white/25',
    icon: HiStar,
  },
];

/**
 * Subtle wash behind week-view time columns when that day has an all-day (or equivalent) event.
 * Used for both authenticated `/calendar` and public `/calendar/public` (same `WeekView`).
 * Light + `dark:` variants so the tint reads on `bg-white dark:bg-gray-800` calendar cards.
 */
const WEEK_ALL_DAY_COLUMN_TINT: Record<string, string> = {
  maintenance: 'bg-slate-100/40 dark:bg-slate-900/35',
  leagues: 'bg-teal-50/50 dark:bg-teal-950/35',
  bonspiel: 'bg-violet-50/50 dark:bg-violet-950/35',
  practice: 'bg-amber-50/50 dark:bg-amber-950/35',
  'group-event': 'bg-emerald-50/50 dark:bg-emerald-950/35',
  clinic: 'bg-sky-50/50 dark:bg-sky-950/35',
  social: 'bg-rose-50/50 dark:bg-rose-950/35',
  'board-committee': 'bg-indigo-50/50 dark:bg-indigo-950/35',
  'learn-to-curl': 'bg-teal-50/50 dark:bg-teal-950/35',
  'off-season': 'bg-orange-50/50 dark:bg-orange-950/35',
  other: 'bg-gray-100/45 dark:bg-gray-900/35',
  'member-ice': 'bg-cyan-50/50 dark:bg-cyan-950/35',
};

function getWeekAllDayColumnTintClass(typeId: string): string {
  return WEEK_ALL_DAY_COLUMN_TINT[typeId] ?? 'bg-gray-50/45 dark:bg-gray-900/35';
}

export function apiEventToCalendar(ev: {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  locations?: Array<{ type: string; sheetId?: number; sheetName?: string }>;
  recurrenceRrule?: string;
  createdBy?: string;
  article?: ArticleOption;
  source?: string;
}): CalendarEvent {
  const locs: EventLocation[] = (ev.locations ?? []).map((l) => {
    if (l.type === 'sheet' && l.sheetId != null) {
      return { type: 'sheet', sheetId: l.sheetId, sheetName: l.sheetName };
    }
    return l as EventLocation;
  });
  return {
    id: ev.id,
    typeId: ev.typeId,
    title: ev.title,
    start: new Date(ev.start),
    end: new Date(ev.end),
    allDay: ev.allDay,
    description: ev.description,
    locations: locs.length > 0 ? locs : undefined,
    recurrenceRrule: ev.recurrenceRrule,
    source: ev.source,
    createdBy: ev.createdBy,
    article: ev.article,
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EARLY_HOURS_END = 6; // Hide 12am–6am unless there are events

/** Layout per event: { column, numColumns }. Overlap = share non-zero time: X.start < Y.end && Y.start < X.end */
function computeEventLayout(
  events: CalendarEvent[]
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
  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [];
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

/** Compact time: "3a" or "3:30a". Minutes only when not on the hour. */
function formatCompactTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const period = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${m.toString().padStart(2, '0')}${period}`;
}

/** Compact range: "3–5p" (same period) or "11:30a–12p" (diff period). Uses endash. */
function formatCompactTimeRange(start: Date, end: Date): string {
  const startPeriod = start.getHours() < 12 ? 'a' : 'p';
  const endPeriod = end.getHours() < 12 ? 'a' : 'p';
  if (startPeriod === endPeriod) {
    const sh = start.getHours();
    const sm = start.getMinutes();
    const eh = end.getHours();
    const em = end.getMinutes();
    const startPart =
      sm === 0 ? `${sh % 12 || 12}` : `${sh % 12 || 12}:${sm.toString().padStart(2, '0')}`;
    const endPart =
      em === 0 ? `${eh % 12 || 12}` : `${eh % 12 || 12}:${em.toString().padStart(2, '0')}`;
    return `${startPart}–${endPart}${endPeriod}`;
  }
  return `${formatCompactTime(start)}–${formatCompactTime(end)}`;
}

/** Returns hours to display: 0–23 if any event is before 6am, else 6–23 */
function getVisibleHours(timedEvents: CalendarEvent[]): number[] {
  const hasEarlyEvents = timedEvents.some((e) => {
    const startH = e.start.getHours() + e.start.getMinutes() / 60;
    const endH = e.end.getHours() + e.end.getMinutes() / 60;
    return startH < EARLY_HOURS_END || endH < EARLY_HOURS_END;
  });
  return hasEarlyEvents ? HOURS : HOURS.slice(EARLY_HOURS_END);
}

function parseDateParam(value: string | null): Date {
  if (!value) return new Date();
  try {
    const d = parseISO(value);
    return isNaN(d.getTime()) ? new Date() : d;
  } catch {
    return new Date();
  }
}

function parseViewParam(value: string | null): CalendarView {
  if (value === 'day' || value === 'week' || value === 'month') return value;
  return 'month';
}

export default function Calendar({ publicMode = false }: CalendarProps) {
  const { member } = useAuth();
  const navigate = useNavigate();
  const canEditCalendar =
    !publicMode && (member?.isCalendarAdmin ?? member?.isAdmin ?? member?.isServerAdmin ?? false);

  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const viewParam = searchParams.get('view');

  const currentDate = useMemo(() => parseDateParam(dateParam), [dateParam]);
  const view = parseViewParam(viewParam);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [viewEventActiveTab, setViewEventActiveTab] = useState<'details' | 'description'>(
    'details'
  );
  useEffect(() => {
    if (selectedEvent) setViewEventActiveTab('details');
  }, [selectedEvent]);
  const [deleteEvent, setDeleteEvent] = useState<CalendarEvent | null>(null);
  const [onIceOnly, setOnIceOnly] = useState(false);
  const [showLeagues, setShowLeagues] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [sheets, setSheets] = useState<Array<{ id: number; name: string }>>([]);
  const eventTypes = DEFAULT_EVENT_TYPES;

  const { rangeStart, rangeEnd, headerLabel } = useMemo(() => {
    if (view === 'day') {
      return {
        rangeStart: startOfDay(currentDate),
        rangeEnd: endOfDay(currentDate),
        headerLabel: format(currentDate, 'EEEE, MMMM d, yyyy'),
      };
    }
    if (view === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 });
      const end = endOfWeek(currentDate, { weekStartsOn: 0 });
      return {
        rangeStart: start,
        rangeEnd: end,
        headerLabel: `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`,
      };
    }
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    return {
      rangeStart: start,
      rangeEnd: end,
      headerLabel: format(currentDate, 'MMMM yyyy'),
    };
  }, [view, currentDate]);

  useEffect(() => {
    api
      .get<Array<{ id: number; name: string; isActive?: boolean }>>('/sheets')
      .then((res) => {
        const active = (res.data ?? []).filter((s) => s.isActive !== false);
        setSheets(active.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setEventsLoading(true);
    type EventPayload = {
      id: string;
      typeId: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      description?: string;
      locations?: Array<{ type: string; sheetId?: number; sheetName?: string }>;
      recurrenceRrule?: string;
      createdBy?: string;
      article?: ArticleOption;
      source?: string;
    };
    const rangeQuery = `start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`;
    const directCalendarPath = publicMode ? '/public/calendar/events' : '/calendar/events';
    Promise.allSettled([
      api.get<EventPayload[]>(`${directCalendarPath}?${rangeQuery}`),
      api.get<EventPayload[]>(`/calendar/league-events?${rangeQuery}`),
    ])
      .then(([eventsRes, leagueRes]) => {
        const calendarEvents =
          eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []).map(apiEventToCalendar) : [];
        const leagueEvents =
          leagueRes.status === 'fulfilled' ? (leagueRes.value.data ?? []).map(apiEventToCalendar) : [];
        setEvents([...calendarEvents, ...leagueEvents]);
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [rangeStart, rangeEnd, publicMode]);

  const refreshEvents = () => {
    const rangeQuery = `start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`;
    const directCalendarPath = publicMode ? '/public/calendar/events' : '/calendar/events';
    type EventPayload = Parameters<typeof apiEventToCalendar>[0];
    Promise.allSettled([
      api.get<EventPayload[]>(`${directCalendarPath}?${rangeQuery}`),
      api.get<EventPayload[]>(`/calendar/league-events?${rangeQuery}`),
    ])
      .then(([eventsRes, leagueRes]) => {
        const calendarEvents =
          eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []).map(apiEventToCalendar) : [];
        const leagueEvents =
          leagueRes.status === 'fulfilled' ? (leagueRes.value.data ?? []).map(apiEventToCalendar) : [];
        setEvents([...calendarEvents, ...leagueEvents]);
      })
      .catch(() => {});
  };

  const sheetNameById = useMemo(() => new Map(sheets.map((s) => [s.id, s.name])), [sheets]);
  const filteredEvents = useMemo(() => {
    let list = events;
    if (!showLeagues) list = list.filter((e) => !isLeagueEvent(e));
    if (!showEvents) list = list.filter((e) => !isRegistrableEvent(e));
    if (onIceOnly) list = list.filter(isOnIceEvent);
    return list;
  }, [events, showLeagues, showEvents, onIceOnly]);

  const getEventType = (typeId: string) =>
    eventTypes.find((t) => t.id === typeId) ??
    eventTypes.find((t) => t.id === 'other') ??
    eventTypes[0];

  const updateUrl = (date: Date, v: CalendarView) => {
    setSearchParams({ date: format(date, 'yyyy-MM-dd'), view: v });
  };

  // Navigation helpers
  const goPrev = () => {
    const next =
      view === 'day'
        ? subDays(currentDate, 1)
        : view === 'week'
          ? subWeeks(currentDate, 1)
          : subMonths(currentDate, 1);
    updateUrl(next, view);
  };
  const goNext = () => {
    const next =
      view === 'day'
        ? addDays(currentDate, 1)
        : view === 'week'
          ? addWeeks(currentDate, 1)
          : addMonths(currentDate, 1);
    updateUrl(next, view);
  };
  const goToday = () => updateUrl(new Date(), view);

  // Jump-to-date inputs
  const jumpTarget = format(currentDate, 'yyyy-MM-dd');
  const onJumpDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v) updateUrl(parseISO(v), view);
  };

  const onViewChange = (v: CalendarView) => updateUrl(currentDate, v);
  const goToDayView = (date: Date) => updateUrl(date, 'day');
  const openNewEventForDate = (date: Date) => {
    navigate(`/calendar/events/new?date=${format(date, 'yyyy-MM-dd')}`);
  };

  const openEditEvent = (ev: CalendarEvent) => {
    navigate(`/calendar/events/edit/${encodeURIComponent(ev.id)}`, { state: { calendarEvent: ev } });
  };

  const calendarContent = (
    <>
      <div className="flex flex-col flex-1 min-h-[400px] overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={goPrev}
              className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              aria-label="Previous"
            >
              <HiChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goNext}
              className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              aria-label="Next"
            >
              <HiChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary-teal text-white hover:opacity-90"
            >
              Today
            </button>
            <span className="ml-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {headerLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            {/* Event source filters */}
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showLeagues}
                onChange={(e) => setShowLeagues(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Leagues
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showEvents}
                onChange={(e) => setShowEvents(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Events
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={onIceOnly}
                onChange={(e) => setOnIceOnly(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              On-ice only
            </label>

            {/* Jump to date */}
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              Jump to:
              <input
                type="date"
                value={jumpTarget}
                onChange={onJumpDate}
                className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
              />
            </label>

            {/* View switcher */}
            <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
              {(['day', 'week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => onViewChange(v)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium capitalize ${
                    view === v
                      ? 'bg-primary-teal text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  {v === 'day' && <HiOutlineDay className="w-4 h-4 shrink-0" />}
                  {v === 'week' && <HiOutlineCalendarDays className="w-4 h-4 shrink-0" />}
                  {v === 'month' && <HiCalendar className="w-4 h-4 shrink-0" />}
                  {v}
                </button>
              ))}
            </div>

            {canEditCalendar && (
              <>
                <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" aria-hidden />
                <Button
                  variant="primary"
                  onClick={() => navigate(`/calendar/events/new?date=${format(currentDate, 'yyyy-MM-dd')}`)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm"
                >
                  <HiPlus className="w-4 h-4" />
                  New event
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Calendar grid - single scroll container */}
        <div className="flex-1 min-h-0 overflow-auto flex flex-col relative">
          {eventsLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 dark:bg-gray-800/80">
              <span className="text-sm text-gray-600 dark:text-gray-400">Loading…</span>
            </div>
          )}
          {view === 'month' && (
            <MonthView
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              currentDate={currentDate}
              events={filteredEvents}
              getEventType={getEventType}
              sheetNameById={sheetNameById}
              onEventClick={setSelectedEvent}
              onDayClick={goToDayView}
              onEmptyCellClick={canEditCalendar ? openNewEventForDate : undefined}
            />
          )}
          {view === 'week' && (
            <WeekView
              rangeStart={rangeStart}
              events={filteredEvents}
              getEventType={getEventType}
              sheetNameById={sheetNameById}
              onEventClick={setSelectedEvent}
              onDayClick={goToDayView}
              onEmptySlotClick={canEditCalendar ? openNewEventForDate : undefined}
            />
          )}
          {view === 'day' && (
            <DayView
              date={currentDate}
              events={filteredEvents}
              getEventType={getEventType}
              sheetNameById={sheetNameById}
              onEventClick={setSelectedEvent}
              onEmptySlotClick={canEditCalendar ? openNewEventForDate : undefined}
            />
          )}
        </div>

        {/* Event type legend */}
        <div className="shrink-0 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {eventTypes.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.id} className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded ${t.color}`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title ?? 'Event details'}
        size="lg"
        contentOverflow="auto"
      >
        {selectedEvent &&
          (() => {
            const descriptionText = selectedEvent.description?.trim() ?? '';
            const hasDescription = Boolean(descriptionText);
            const isIceBooking = isIceBookingEvent(selectedEvent);
            const showDescriptionTab = hasDescription && !isIceBooking;
            return (
              <div className="flex flex-col min-h-[680px] space-y-3">
                {showDescriptionTab && (
                  <div className="flex border-b border-gray-200 dark:border-gray-600 mb-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewEventActiveTab('details')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        viewEventActiveTab === 'details'
                          ? 'border-primary-teal text-primary-teal dark:text-primary-teal'
                          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      Event details
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewEventActiveTab('description')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        viewEventActiveTab === 'description'
                          ? 'border-primary-teal text-primary-teal dark:text-primary-teal'
                          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }`}
                    >
                      Description
                    </button>
                  </div>
                )}

                {(viewEventActiveTab === 'details' || !showDescriptionTab) && (
                  <>
                    <div className="flex flex-1">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const type = getEventType(selectedEvent.typeId);
                            const Icon = type.icon;
                            return (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm ${type.color}`}
                              >
                                <Icon className="w-4 h-4" />
                                {type.label}
                              </span>
                            );
                          })()}
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                          {!isSameDay(
                            startOfDay(selectedEvent.start),
                            startOfDay(selectedEvent.end)
                          ) ? (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">Start</dt>
                              <dd>
                                {selectedEvent.allDay
                                  ? format(selectedEvent.start, 'MMM d, yyyy')
                                  : format(selectedEvent.start, 'MMM d, yyyy, h:mm a')}
                              </dd>
                              <dt className="text-gray-500 dark:text-gray-400">End</dt>
                              <dd>
                                {selectedEvent.allDay
                                  ? format(selectedEvent.end, 'MMM d, yyyy')
                                  : format(selectedEvent.end, 'MMM d, yyyy, h:mm a')}
                              </dd>
                            </>
                          ) : (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">Date</dt>
                              <dd>{format(selectedEvent.start, 'EEEE, MMMM d, yyyy')}</dd>
                              <dt className="text-gray-500 dark:text-gray-400">Time</dt>
                              <dd>
                                {selectedEvent.allDay
                                  ? 'All day'
                                  : `${format(selectedEvent.start, 'h:mm a')} – ${format(selectedEvent.end, 'h:mm a')}`}
                              </dd>
                            </>
                          )}
                          {selectedEvent.locations && selectedEvent.locations.length > 0 && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">
                                Location{selectedEvent.locations.length > 1 ? 's' : ''}
                              </dt>
                              <dd>
                                {formatEventLocationsSummary(
                                  selectedEvent.locations,
                                  sheetNameById,
                                  sheets.length
                                )}
                              </dd>
                            </>
                          )}
                          {selectedEvent.article && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">More info</dt>
                              <dd>
                                <a
                                  href={`/articles/${selectedEvent.article.slug}`}
                                  className="text-primary-teal underline hover:opacity-80"
                                >
                                  {selectedEvent.article.title}
                                </a>
                              </dd>
                            </>
                          )}
                          {!publicMode && selectedEvent.createdBy && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">Created by</dt>
                              <dd>{selectedEvent.createdBy}</dd>
                            </>
                          )}
                        </dl>
                        {isIceBooking && hasDescription && (
                          <div className="pt-2 border-t border-gray-200 dark:border-gray-600 mt-3">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                              Booking details
                            </div>
                            <div className="text-sm text-gray-800 dark:text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:text-primary-teal [&_a]:underline hover:[&_a]:opacity-80">
                              <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]}>
                                {descriptionText}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                      {canEditCalendar && !isReadOnlyCalendarEvent(selectedEvent) && (
                        <div className="flex justify-end gap-2 mb-2">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              const ev = selectedEvent;
                              setSelectedEvent(null);
                              openEditEvent(ev);
                            }}
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-3"
                          >
                            <HiPencil className="w-4 h-4" />
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => setDeleteEvent(selectedEvent)}
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-3"
                          >
                            <HiTrash className="w-4 h-4" />
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {showDescriptionTab && viewEventActiveTab === 'description' && (
                  <div className="text-sm text-gray-800 dark:text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:text-primary-teal [&_a]:underline hover:[&_a]:opacity-80 min-h-[120px] flex-1">
                    <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]}>
                      {descriptionText}
                    </ReactMarkdown>
                  </div>
                )}
                <div className="pt-4 mt-auto flex justify-end shrink-0">
                  <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
                    Close
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      <Modal isOpen={!!deleteEvent} onClose={() => setDeleteEvent(null)} title="Delete event">
        {deleteEvent && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {deleteEvent.id.split(':').length === 3
                ? 'This is a recurring event. Delete this instance only, or all instances in the series?'
                : 'Are you sure you want to delete this event?'}
            </p>
            <div className="flex gap-2">
              {deleteEvent.id.split(':').length === 3 ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await api.delete(
                          `/calendar/events/${encodeURIComponent(deleteEvent.id)}?scope=this`
                        );
                        refreshEvents();
                        setSelectedEvent(null);
                        setDeleteEvent(null);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    This instance only
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      try {
                        await api.delete(
                          `/calendar/events/${encodeURIComponent(deleteEvent.id)}?scope=all`
                        );
                        refreshEvents();
                        setSelectedEvent(null);
                        setDeleteEvent(null);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    All instances
                  </Button>
                </>
              ) : (
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await api.delete(`/calendar/events/${encodeURIComponent(deleteEvent.id)}`);
                      refreshEvents();
                      setSelectedEvent(null);
                      setDeleteEvent(null);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  Delete
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDeleteEvent(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );

  return publicMode ? (
    <PublicLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8 flex-1 min-h-0 flex flex-col">{calendarContent}</div>
    </PublicLayout>
  ) : (
    <Layout fullWidth>{calendarContent}</Layout>
  );
}

const ESTIMATED_EVENT_HEIGHT = 26;
/** Slot height = event + space-y-0.5 gap, matches MonthDayEvents layout */
const SLOT_HEIGHT = 28;

/** Multi-day event segment for one week row. */
interface MultiDaySegment {
  ev: CalendarEvent;
  weekIndex: number;
  bandIndex: number;
  startCol: number;
  endCol: number;
  roundLeft: boolean;
  roundRight: boolean;
}

function getMultiDaySegments(events: CalendarEvent[], weeks: Date[][]): MultiDaySegment[] {
  const raw: Omit<MultiDaySegment, 'bandIndex'>[] = [];
  for (const ev of events) {
    const evStart = startOfDay(ev.start);
    const evEnd = startOfDay(ev.end);
    if (isSameDay(evStart, evEnd)) continue;
    const evStartT = evStart.getTime();
    const evEndT = evEnd.getTime();
    for (let wi = 0; wi < weeks.length; wi++) {
      const week = weeks[wi]!;
      const firstDay = startOfDay(week[0]!);
      const lastDay = startOfDay(week[6]!);
      const firstT = firstDay.getTime();
      const lastT = lastDay.getTime() + 86400000;
      if (evEndT < firstT || evStartT >= lastT) continue;
      const startCol = evStartT <= firstT ? 0 : week.findIndex((d) => isSameDay(d, ev.start));
      const endCol = evEndT >= lastT ? 6 : week.findIndex((d) => isSameDay(d, ev.end));
      if (startCol < 0 || endCol < 0) continue;
      const segStartDate = week[Math.max(0, startCol)]!;
      const segEndDate = week[Math.min(6, endCol)]!;
      const roundLeft = isSameDay(segStartDate, ev.start);
      const roundRight = isSameDay(segEndDate, ev.end);
      raw.push({ ev, weekIndex: wi, startCol, endCol, roundLeft, roundRight });
    }
  }
  // Assign band indices so overlapping segments get separate rows (greedy)
  const byWeek = new Map<number, typeof raw>();
  for (const s of raw) {
    const list = byWeek.get(s.weekIndex) ?? [];
    list.push(s);
    byWeek.set(s.weekIndex, list);
  }
  const segments: MultiDaySegment[] = [];
  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi]!;
    const firstT = startOfDay(week[0]!).getTime();
    const continuesFromPrev = (s: { ev: CalendarEvent }) =>
      startOfDay(s.ev.start).getTime() < firstT;
    const list = (byWeek.get(wi) ?? []).sort((a, b) => {
      const aContinues = continuesFromPrev(a);
      const bContinues = continuesFromPrev(b);
      if (aContinues && !bContinues) return -1;
      if (!aContinues && bContinues) return 1;
      if (aContinues && bContinues) {
        return startOfDay(b.ev.end).getTime() - startOfDay(a.ev.end).getTime();
      }
      return startOfDay(a.ev.start).getTime() - startOfDay(b.ev.start).getTime();
    });
    const bands: { startCol: number; endCol: number }[] = [];
    for (const s of list) {
      let band = 0;
      while (band < bands.length) {
        const b = bands[band]!;
        const overlaps = b.startCol <= s.endCol && b.endCol >= s.startCol;
        if (!overlaps) break;
        band++;
      }
      if (band >= bands.length) {
        bands.push({ startCol: s.startCol, endCol: s.endCol });
      } else {
        const b = bands[band]!;
        b.startCol = Math.min(b.startCol, s.startCol);
        b.endCol = Math.max(b.endCol, s.endCol);
      }
      segments.push({ ...s, bandIndex: band });
    }
  }
  return segments;
}

/** Shows as many events as fit, then "+N more" if there are more. Uses ResizeObserver. */
function MonthDayEvents({
  day,
  events,
  continuingCount = 0,
  getEventType,
  sheetNameById,
  onEventClick,
  onDayClick,
  onEmptyCellClick,
}: {
  day: Date;
  events: CalendarEvent[];
  continuingCount?: number;
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  onEventClick?: (ev: CalendarEvent) => void;
  onDayClick?: (day: Date) => void;
  onEmptyCellClick?: (day: Date) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(() => Math.min(4, events.length));
  const lastHeightRef = useRef(-1);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateCount = () => {
      const h = el.clientHeight;
      if (h <= 0) return;
      if (Math.abs(h - lastHeightRef.current) < 2) return;
      lastHeightRef.current = h;
      const totalSlots = Math.max(1, Math.floor(h / ESTIMATED_EVENT_HEIGHT));
      const count = Math.max(0, totalSlots - continuingCount);
      setVisibleCount((prev) => (prev !== count ? count : prev));
    };
    updateCount();
    const ro = new ResizeObserver(updateCount);
    ro.observe(el);
    return () => ro.disconnect();
  }, [events.length, continuingCount]);

  const visibleEvents = events.slice(0, visibleCount);
  const overflowCount = events.length - visibleCount;
  const showOverflow = overflowCount > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col mt-1">
      <div
        ref={scrollRef}
        data-events-area
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-0.5 ${onEmptyCellClick ? 'cursor-pointer [&:hover:not(:has(*:hover))]:bg-gray-100 dark:[&:hover:not(:has(*:hover))]:bg-gray-700/50 transition-colors' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onEmptyCellClick?.(day);
        }}
        role={onEmptyCellClick ? 'button' : undefined}
        tabIndex={onEmptyCellClick ? 0 : undefined}
        onKeyDown={onEmptyCellClick ? (e) => e.key === 'Enter' && onEmptyCellClick(day) : undefined}
      >
        {Array.from({ length: continuingCount }, (_, i) => (
          <div
            key={`continuing-${i}`}
            data-slot
            className="shrink-0 invisible"
            style={{ height: ESTIMATED_EVENT_HEIGHT, minHeight: ESTIMATED_EVENT_HEIGHT }}
            aria-hidden
          />
        ))}
        {visibleEvents.map((ev) => {
          const type = getEventType(ev.typeId);
          return (
            <div
              key={ev.id}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onEventClick?.(ev);
              }}
              onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-sm truncate shrink-0 border cursor-pointer hover:opacity-90 ${type.color}`}
              title={ev.title}
            >
              <EventBandRowContent
                ev={ev}
                type={type}
                sheetNameById={sheetNameById}
                iconClassName="w-3.5 h-3.5 shrink-0"
              />
            </div>
          );
        })}
      </div>
      {showOverflow && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDayClick?.(day);
          }}
          className="shrink-0 text-xs text-gray-500 dark:text-gray-400 py-0.5 hover:text-primary-teal dark:hover:text-primary-teal/80 cursor-pointer underline-offset-2 hover:underline text-left w-full"
        >
          +{overflowCount} more
        </button>
      )}
    </div>
  );
}

// --- Month View ---
function MonthView({
  rangeStart,
  rangeEnd,
  currentDate,
  events,
  getEventType,
  sheetNameById,
  onEventClick,
  onDayClick,
  onEmptyCellClick,
}: {
  rangeStart: Date;
  rangeEnd: Date;
  currentDate: Date;
  events: CalendarEvent[];
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  onEventClick?: (ev: CalendarEvent) => void;
  onDayClick?: (day: Date) => void;
  onEmptyCellClick?: (day: Date) => void;
}) {
  const days = useMemo(() => {
    const result: Date[] = [];
    const d = new Date(rangeStart);
    while (d <= rangeEnd) {
      result.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return result;
  }, [rangeStart, rangeEnd]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }
    return result;
  }, [days]);

  const getEventsForDay = useCallback(
    (day: Date) =>
      events.filter((e) => {
        const start = new Date(e.start);
        const end = new Date(e.end);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);
        return start <= dayEnd && end >= dayStart;
      }),
    [events]
  );

  const isMultiDay = (e: CalendarEvent) => !isSameDay(startOfDay(e.start), startOfDay(e.end));

  const multiDaySegments = useMemo(
    () => getMultiDaySegments(events.filter(isMultiDay), weeks),
    [events, weeks]
  );

  const maxBandsPerWeek =
    multiDaySegments.length === 0 ? 0 : Math.max(...multiDaySegments.map((s) => s.bandIndex)) + 1;

  const [slotMetrics, setSlotMetrics] = useState<{ dateOffset: number; slotHeight: number } | null>(
    null
  );
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = measureRef.current;
    if (!el || maxBandsPerWeek === 0) return;
    const dateBtn = el.querySelector('button');
    const eventsWrap = el.querySelector('[data-events-area]');
    if (!dateBtn || !eventsWrap) return;
    const dateOffset = dateBtn.offsetHeight + 4; // mt-1
    const firstSlot = eventsWrap.querySelector('[data-slot]') as HTMLElement | null;
    const slotHeight = firstSlot ? firstSlot.offsetHeight + 2 : SLOT_HEIGHT; // +space-y-0.5
    setSlotMetrics({ dateOffset, slotHeight });
  }, [maxBandsPerWeek, weeks.length]);

  const getReservedSlotCount = (day: Date) => {
    const dayStartD = new Date(day);
    dayStartD.setHours(0, 0, 0, 0);
    const dayEndD = new Date(day);
    dayEndD.setHours(23, 59, 59, 999);
    return events.filter((e) => {
      if (!isMultiDay(e)) return false;
      const start = new Date(e.start);
      const end = new Date(e.end);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      const overlaps = start <= dayEndD && end >= dayStartD;
      return overlaps;
    }).length;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* Single grid: header row + week rows */}
      <div
        className="flex-1 grid min-h-0 overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridTemplateRows: `auto repeat(${weeks.length}, minmax(106px, 1fr))`,
        }}
      >
        {/* Weekday headers */}
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase border-b border-gray-300 dark:border-gray-600"
          >
            {d}
          </div>
        ))}
        {/* Day cells */}
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            const dayEvents = getEventsForDay(day).filter((e) => !isMultiDay(e));
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isToday = isSameDay(day, new Date());
            const sortedEvents = [...dayEvents].sort(
              (a, b) => a.start.getTime() - b.start.getTime()
            );
            const isFirstCell = wi === 0 && di === 0;
            return (
              <div
                key={day.toISOString()}
                ref={isFirstCell ? measureRef : undefined}
                className={`border-r border-b border-gray-200 dark:border-gray-600/60 p-1 flex flex-col min-h-0 overflow-hidden ${
                  !isCurrentMonth ? 'bg-gray-50 dark:bg-gray-900/50' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onDayClick?.(day)}
                  className={`text-sm font-medium shrink-0 p-0 border-0 cursor-pointer hover:opacity-80 text-left inline-flex items-center justify-center w-6 h-6 rounded-full min-w-6 min-h-6 ${
                    isToday
                      ? 'bg-primary-teal text-white'
                      : isCurrentMonth
                        ? 'text-gray-900 dark:text-gray-100 bg-transparent'
                        : 'text-gray-400 dark:text-gray-500 bg-transparent'
                  }`}
                >
                  {format(day, 'd')}
                </button>
                <MonthDayEvents
                  day={day}
                  events={sortedEvents}
                  continuingCount={getReservedSlotCount(day)}
                  getEventType={getEventType}
                  sheetNameById={sheetNameById}
                  onEventClick={onEventClick}
                  onDayClick={onDayClick}
                  onEmptyCellClick={onEmptyCellClick}
                />
              </div>
            );
          })
        )}
      </div>
      {/* Multi-day event overlay - bands align with single-day event slots */}
      {multiDaySegments.length > 0 && maxBandsPerWeek > 0 && (
        <div
          className="absolute left-0 right-0 top-[40px] bottom-0 grid pointer-events-none"
          style={{
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: (() => {
              const dateOffset = slotMetrics?.dateOffset ?? 36;
              const slotHeight = slotMetrics?.slotHeight ?? SLOT_HEIGHT;
              const rows: string[] = [];
              for (let w = 0; w < weeks.length; w++) {
                rows.push(`${dateOffset}px`); // date area - fixed at top
                for (let b = 0; b < maxBandsPerWeek; b++) {
                  rows.push(`${slotHeight}px`);
                }
                rows.push('1fr'); // filler - absorbs remaining space at bottom
              }
              return rows.join(' ');
            })(),
          }}
        >
          {multiDaySegments.map((seg, i) => {
            const type = getEventType(seg.ev.typeId);
            const roundClass =
              seg.roundLeft && seg.roundRight
                ? 'rounded'
                : seg.roundLeft
                  ? 'rounded-l'
                  : seg.roundRight
                    ? 'rounded-r'
                    : '';
            const rowsPerWeek = 2 + maxBandsPerWeek; // date + bands + filler
            const gridRowStart = seg.weekIndex * rowsPerWeek + 2 + seg.bandIndex; // +2: skip date row (1-based)
            return (
              <div
                key={`${seg.ev.id}-${seg.weekIndex}-${seg.bandIndex}-${i}`}
                className={`pointer-events-auto self-start ml-1 mr-0.5 flex items-center gap-1 px-1.5 py-0.5 text-sm truncate cursor-pointer hover:opacity-90 border min-h-0 ${type.color} ${roundClass}`}
                style={{
                  gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                  gridRow: `${gridRowStart} / ${gridRowStart + 1}`,
                }}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick?.(seg.ev);
                }}
                onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(seg.ev)}
                title={seg.ev.title}
              >
                <EventBandRowContent
                  ev={seg.ev}
                  type={type}
                  sheetNameById={sheetNameById}
                  iconClassName="w-3.5 h-3.5 shrink-0"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Week View ---
const HOUR_HEIGHT = 60;

function WeekView({
  rangeStart,
  events,
  getEventType,
  sheetNameById,
  onEventClick,
  onDayClick,
  onEmptySlotClick,
}: {
  rangeStart: Date;
  events: CalendarEvent[];
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  onEventClick?: (ev: CalendarEvent) => void;
  onDayClick?: (day: Date) => void;
  onEmptySlotClick?: (date: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));

  const getEventsForDay = useCallback(
    (day: Date) =>
      events.filter((e) => {
        const start = new Date(e.start);
        const end = new Date(e.end);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);
        return start <= dayEnd && end >= dayStart;
      }),
    [events]
  );

  const allDayEvents = useMemo(() => {
    const byDay = days.map((day) => getEventsForDay(day).filter((e) => e.allDay));
    const flat = byDay.flat();
    const seen = new Set<string>();
    return flat.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [days, getEventsForDay]);

  const isMultiDayTimedOnMiddleDay = useCallback((ev: CalendarEvent, day: Date) => {
    if (ev.allDay) return false;
    const isMultiDay = !isSameDay(startOfDay(ev.start), startOfDay(ev.end));
    if (!isMultiDay) return false;
    return !isSameDay(ev.start, day) && !isSameDay(ev.end, day);
  }, []);

  const hasAllDayEvents = useMemo(() => {
    const hasAllDay = allDayEvents.length > 0;
    const hasMultiDayTimedMiddle = days.some((day) =>
      getEventsForDay(day).some((e) => isMultiDayTimedOnMiddleDay(e, day))
    );
    return hasAllDay || hasMultiDayTimedMiddle;
  }, [allDayEvents.length, days, getEventsForDay]);

  const allDaySegments = useMemo(() => {
    const firstT = startOfDay(days[0]!).getTime();
    const continuesFromPrev = (e: { start: Date }) => startOfDay(e.start).getTime() < firstT;
    const multiDay = allDayEvents
      .filter((e) => !isSameDay(startOfDay(e.start), startOfDay(e.end)))
      .sort((a, b) => {
        const aContinues = continuesFromPrev(a);
        const bContinues = continuesFromPrev(b);
        if (aContinues && !bContinues) return -1;
        if (!aContinues && bContinues) return 1;
        if (aContinues && bContinues) {
          return startOfDay(b.end).getTime() - startOfDay(a.end).getTime();
        }
        return startOfDay(a.start).getTime() - startOfDay(b.start).getTime();
      });
    const lastT = startOfDay(days[6]!).getTime() + 86400000;
    return multiDay
      .map((ev) => {
        const evStartT = startOfDay(ev.start).getTime();
        const evEndT = startOfDay(ev.end).getTime();
        if (evEndT < firstT || evStartT >= lastT) return null;
        const startCol = evStartT <= firstT ? 0 : days.findIndex((d) => isSameDay(d, ev.start));
        const endCol = evEndT >= lastT ? 6 : days.findIndex((d) => isSameDay(d, ev.end));
        if (startCol < 0 || endCol < 0) return null;
        const segStartDate = days[Math.max(0, startCol)]!;
        const segEndDate = days[Math.min(6, endCol)]!;
        return {
          ev,
          startCol: startCol < 0 ? 0 : startCol,
          endCol: endCol < 0 ? 6 : endCol,
          roundLeft: isSameDay(segStartDate, ev.start),
          roundRight: isSameDay(segEndDate, ev.end),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [allDayEvents, days]);

  const weekAllDayColumnTintByDayIndex = useMemo(() => {
    const sortAllDayRowEvents = (a: CalendarEvent, b: CalendarEvent) => {
      const multiA = !isSameDay(startOfDay(a.start), startOfDay(a.end));
      const multiB = !isSameDay(startOfDay(b.start), startOfDay(b.end));
      if (multiA && multiB) {
        const durA = startOfDay(a.end).getTime() - startOfDay(a.start).getTime();
        const durB = startOfDay(b.end).getTime() - startOfDay(b.start).getTime();
        return durB - durA;
      }
      return multiA ? -1 : multiB ? 1 : 0;
    };

    return days.map((day, di) => {
      const cellEvents = [
        ...allDayEvents.filter((ev) => {
          if (isSameDay(startOfDay(ev.start), startOfDay(ev.end))) {
            return isSameDay(day, ev.start);
          }
          return false;
        }),
        ...getEventsForDay(day).filter((ev) => isMultiDayTimedOnMiddleDay(ev, day)),
      ];
      const fromSegments = allDaySegments
        .filter((s) => s.startCol <= di && s.endCol >= di)
        .map((s) => s.ev);
      const combined = [...cellEvents, ...fromSegments];
      const seen = new Set<string>();
      const unique = combined.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      unique.sort(sortAllDayRowEvents);
      if (unique.length === 0) return null;
      return getWeekAllDayColumnTintClass(getEventType(unique[0]!.typeId).id);
    });
  }, [days, allDayEvents, allDaySegments, getEventsForDay, getEventType, isMultiDayTimedOnMiddleDay]);

  const allTimedEvents = days.flatMap((day) => getEventsForDay(day).filter((e) => !e.allDay));
  const visibleHours = getVisibleHours(allTimedEvents);
  const totalDayHeight = visibleHours.length * HOUR_HEIGHT;
  const hourStart = visibleHours[0] ?? 0;
  /** minmax(0,1fr) keeps day columns equal when all-day chips have long text (matches rows below). */
  const weekGridClass = 'grid grid-cols-[60px_repeat(7,minmax(0,1fr))] min-w-[800px]';

  return (
    <div className="flex flex-col min-w-0 w-full">
      <div className={`${weekGridClass} shrink-0`}>
        <div className="sticky top-0 left-0 z-10 bg-gray-50 dark:bg-gray-800/95 border-b border-r border-gray-300 dark:border-gray-600" />
        {days.map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onDayClick?.(day)}
            className={`sticky top-0 z-10 w-full min-w-0 px-2 py-2 text-center text-sm font-medium border-b border-gray-300 dark:border-gray-600 cursor-pointer hover:opacity-80 ${
              isSameDay(day, new Date())
                ? 'bg-primary-teal/10 text-primary-teal dark:bg-primary-teal/20'
                : 'bg-gray-50 dark:bg-gray-800/95 text-gray-900 dark:text-gray-100'
            }`}
          >
            <div className="text-xs text-gray-500 dark:text-gray-400">{format(day, 'EEE')}</div>
            <div>{format(day, 'd')}</div>
          </button>
        ))}
      </div>
      <div className={`${weekGridClass} shrink-0 ${hasAllDayEvents ? '' : 'hidden'}`}>
        <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-r border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
          All day
        </div>
        <div
          className="relative col-span-7 grid min-w-0 border-b border-gray-300 dark:border-gray-600 min-h-[40px]"
          style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        >
          {days.map((day, di) => (
            <div
              key={day.toISOString()}
              role={onEmptySlotClick ? 'button' : undefined}
              tabIndex={onEmptySlotClick ? 0 : undefined}
              onClick={
                onEmptySlotClick
                  ? () =>
                      onEmptySlotClick(
                        new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)
                      )
                  : undefined
              }
              onKeyDown={
                onEmptySlotClick
                  ? (e) =>
                      e.key === 'Enter' &&
                      onEmptySlotClick(
                        new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)
                      )
                  : undefined
              }
              className={`min-w-0 border-r border-gray-300 dark:border-gray-600 p-1 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
              style={{ gridColumn: di + 1 }}
            >
              {[
                ...allDayEvents.filter((ev) => {
                  if (isSameDay(startOfDay(ev.start), startOfDay(ev.end))) {
                    return isSameDay(day, ev.start);
                  }
                  return false;
                }),
                ...getEventsForDay(day).filter((ev) => isMultiDayTimedOnMiddleDay(ev, day)),
              ]
                .sort((a, b) => {
                  const multiA = !isSameDay(startOfDay(a.start), startOfDay(a.end));
                  const multiB = !isSameDay(startOfDay(b.start), startOfDay(b.end));
                  if (multiA && multiB) {
                    const durA = startOfDay(a.end).getTime() - startOfDay(a.start).getTime();
                    const durB = startOfDay(b.end).getTime() - startOfDay(b.start).getTime();
                    return durB - durA; // longest first
                  }
                  return multiA ? -1 : multiB ? 1 : 0; // multi-day before single-day
                })
                .map((ev) => {
                  const type = getEventType(ev.typeId);
                  return (
                    <div
                      key={`${ev.id}-${day.toISOString()}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick?.(ev);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
                      className={`flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 px-2 py-1 rounded text-sm border cursor-pointer hover:opacity-90 ${type.color}`}
                    >
                      <EventBandRowContent
                        ev={ev}
                        type={type}
                        sheetNameById={sheetNameById}
                        iconClassName="w-3.5 h-3.5"
                        layout="wrap"
                      />
                    </div>
                  );
                })}
            </div>
          ))}
          {allDaySegments.map((seg, i) => {
            const type = getEventType(seg.ev.typeId);
            const roundClass =
              seg.roundLeft && seg.roundRight
                ? 'rounded'
                : seg.roundLeft
                  ? 'rounded-l'
                  : seg.roundRight
                    ? 'rounded-r'
                    : '';
            return (
              <div
                key={`${seg.ev.id}-${i}`}
                className={`absolute top-1 bottom-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 px-2 py-1 text-sm border cursor-pointer hover:opacity-90 ${type.color} ${roundClass}`}
                style={{
                  left: `calc(${(seg.startCol / 7) * 100}% + 4px)`,
                  width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - 8px)`,
                }}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onEventClick?.(seg.ev);
                }}
                onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(seg.ev)}
              >
                <EventBandRowContent
                  ev={seg.ev}
                  type={type}
                  sheetNameById={sheetNameById}
                  iconClassName="w-3.5 h-3.5"
                  layout="wrap"
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className={`flex-1 ${weekGridClass} min-h-[600px]`}>
        {/* Time column */}
        <div className="relative">
          {visibleHours.map((hour) => (
            <div
              key={hour}
              className="border-r border-b border-gray-200 dark:border-gray-600/60 px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400"
              style={{ height: HOUR_HEIGHT }}
            >
              {hour === 0
                ? '12 am'
                : hour < 12
                  ? `${hour} am`
                  : hour === 12
                    ? '12 pm'
                    : `${hour - 12} pm`}
            </div>
          ))}
        </div>
        {/* Day columns with events */}
        {days.map((day, di) => {
          const dayEvents = getEventsForDay(day).filter(
            (e) => !e.allDay && !isMultiDayTimedOnMiddleDay(e, day)
          );
          const columnTint = weekAllDayColumnTintByDayIndex[di];
          return (
            <div
              key={day.toISOString()}
              className="relative min-w-0 border-r border-gray-200 dark:border-gray-600/60"
            >
              {columnTint && (
                <div
                  className={`pointer-events-none absolute inset-0 z-0 ${columnTint}`}
                  aria-hidden
                />
              )}
              {/* Hour grid */}
              {visibleHours.map((hour) => (
                <div
                  key={hour}
                  role={onEmptySlotClick ? 'button' : undefined}
                  tabIndex={onEmptySlotClick ? 0 : undefined}
                  onClick={
                    onEmptySlotClick
                      ? () =>
                          onEmptySlotClick(
                            new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0)
                          )
                      : undefined
                  }
                  onKeyDown={
                    onEmptySlotClick
                      ? (e) =>
                          e.key === 'Enter' &&
                          onEmptySlotClick(
                            new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0)
                          )
                      : undefined
                  }
                  className={`relative z-[1] border-b border-gray-200 dark:border-gray-600/60 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
              {/* Events overlay */}
              <div className="pointer-events-none absolute inset-0 z-10">
                <div className="relative" style={{ height: totalDayHeight }}>
                  {(() => {
                    const visibleDayEvents = dayEvents;
                    const layout = computeEventLayout(visibleDayEvents);
                    const pad = 4;
                    const dayStartHour = hourStart;
                    const dayEndHour = hourStart + visibleHours.length;
                    return visibleDayEvents.map((ev) => {
                      const type = getEventType(ev.typeId);
                      let startHour = ev.start.getHours() + ev.start.getMinutes() / 60;
                      let endHour = ev.end.getHours() + ev.end.getMinutes() / 60;
                      if (endHour < startHour) endHour += 24;
                      if (!isSameDay(ev.start, day)) startHour = dayStartHour;
                      if (!isSameDay(ev.end, day)) endHour = dayEndHour;
                      const displayEnd = Math.min(endHour, dayEndHour);
                      const displayStart = Math.max(startHour, dayStartHour);
                      if (displayStart >= displayEnd) return null;
                      const topPx =
                        ((displayStart - hourStart) / visibleHours.length) * totalDayHeight;
                      const totalHeightPx =
                        ((displayEnd - displayStart) / visibleHours.length) * totalDayHeight;
                      const { column, numColumns } = layout.get(ev.id) ?? {
                        column: 0,
                        numColumns: 1,
                      };
                      const colWidth = 100 / numColumns;
                      const leftPct = (column / numColumns) * 100;
                      return (
                        <div
                          key={ev.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onEventClick?.(ev)}
                          onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
                          className="absolute pointer-events-auto cursor-pointer hover:opacity-90 transition-opacity"
                          style={{
                            top: topPx,
                            left: `calc(${leftPct}% + ${pad}px)`,
                            width: `calc(${colWidth}% - ${pad * 2}px)`,
                            height: totalHeightPx,
                            minHeight: 24,
                          }}
                        >
                          <div
                            className={`flex flex-col justify-center px-2 py-1 rounded border ${type.color} h-full min-w-0`}
                          >
                            <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0">
                              {(() => {
                                const Icon = type.icon;
                                const loc = getEventBandLocationSummary(ev, sheetNameById);
                                const showTime = eventSpansSingleCalendarDay(ev);
                                return (
                                  <>
                                    <Icon className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate text-sm font-medium min-w-0">
                                      {ev.title}
                                    </span>
                                    {loc && (
                                      <>
                                        <span className="shrink-0">·</span>
                                        <span className="truncate text-sm min-w-0">{loc}</span>
                                      </>
                                    )}
                                    {showTime && (
                                      <>
                                        <span className="shrink-0">·</span>
                                        <span className="text-xs opacity-90 shrink-0">
                                          {format(ev.start, 'h:mm a')} – {format(ev.end, 'h:mm a')}
                                        </span>
                                      </>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Day View ---
function DayView({
  date,
  events,
  getEventType,
  sheetNameById,
  onEventClick,
  onEmptySlotClick,
}: {
  date: Date;
  events: CalendarEvent[];
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  onEventClick?: (ev: CalendarEvent) => void;
  onEmptySlotClick?: (date: Date) => void;
}) {
  const dayEvents = events.filter((e) => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return start <= dayEnd && end >= dayStart;
  });

  const isMultiDayTimedOnMiddleDay = (e: CalendarEvent) => {
    if (e.allDay) return false;
    const isMultiDay = !isSameDay(startOfDay(e.start), startOfDay(e.end));
    if (!isMultiDay) return false;
    return !isSameDay(e.start, date) && !isSameDay(e.end, date);
  };

  const allDayEvents = dayEvents.filter((e) => e.allDay || isMultiDayTimedOnMiddleDay(e));
  const timedEvents = dayEvents.filter((e) => !e.allDay && !isMultiDayTimedOnMiddleDay(e));
  const visibleHours = getVisibleHours(timedEvents);
  const hourStart = visibleHours[0] ?? 0;

  return (
    <div className="flex flex-col min-w-0 flex-1 min-h-0 overflow-hidden">
      {/* All-day section - fixed at top, always visible when there are all-day events */}
      {allDayEvents.length > 0 && (
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">All day</div>
          <div className="space-y-1">
            {[...allDayEvents]
              .sort((a, b) => {
                const multiA = !isSameDay(startOfDay(a.start), startOfDay(a.end));
                const multiB = !isSameDay(startOfDay(b.start), startOfDay(b.end));
                if (multiA && multiB) {
                  const durA = startOfDay(a.end).getTime() - startOfDay(a.start).getTime();
                  const durB = startOfDay(b.end).getTime() - startOfDay(b.start).getTime();
                  return durB - durA; // longest first
                }
                return multiA ? -1 : multiB ? 1 : 0; // multi-day before single-day
              })
              .map((ev) => {
                const type = getEventType(ev.typeId);
                return (
                  <div
                    key={ev.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onEventClick?.(ev)}
                    onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
                    className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer hover:opacity-90 ${type.color}`}
                  >
                    <EventBandRowContent
                      ev={ev}
                      type={type}
                      sheetNameById={sheetNameById}
                      iconClassName="w-4 h-4 shrink-0"
                    />
                  </div>
                );
              })}
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-auto">
        <div className="w-16 shrink-0 border-r border-gray-200 dark:border-gray-700">
          {visibleHours.map((h) => (
            <div
              key={h}
              className="text-xs text-gray-500 dark:text-gray-400 px-1"
              style={{ height: HOUR_HEIGHT }}
            >
              {h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`}
            </div>
          ))}
        </div>
        <div className="flex-1 relative" style={{ minHeight: visibleHours.length * HOUR_HEIGHT }}>
          {/* Hour grid */}
          {visibleHours.map((h) => (
            <div
              key={h}
              role={onEmptySlotClick ? 'button' : undefined}
              tabIndex={onEmptySlotClick ? 0 : undefined}
              onClick={
                onEmptySlotClick
                  ? () =>
                      onEmptySlotClick(
                        new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0)
                      )
                  : undefined
              }
              onKeyDown={
                onEmptySlotClick
                  ? (e) =>
                      e.key === 'Enter' &&
                      onEmptySlotClick(
                        new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0)
                      )
                  : undefined
              }
                  className={`border-b border-gray-200 dark:border-gray-600/60 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
              style={{ height: HOUR_HEIGHT }}
            />
          ))}
          {/* Timed events */}
          {(() => {
            const layout = computeEventLayout(timedEvents);
            const pad = 8;
            const dayEndHour = hourStart + visibleHours.length;
            return timedEvents.map((ev) => {
              const type = getEventType(ev.typeId);
              const isMultiDay = !isSameDay(startOfDay(ev.start), startOfDay(ev.end));
              let startHour: number;
              let endHour: number;
              let timeLabel: string;
              if (isMultiDay) {
                if (isSameDay(ev.start, date)) {
                  startHour = ev.start.getHours() + ev.start.getMinutes() / 60;
                  endHour = dayEndHour;
                  timeLabel = `${format(ev.start, 'h:mm a')} – end of day`;
                } else {
                  startHour = hourStart;
                  endHour = ev.end.getHours() + ev.end.getMinutes() / 60;
                  timeLabel = `${format(startOfDay(date), 'h:mm a')} – ${format(ev.end, 'h:mm a')}`;
                }
              } else {
                startHour = ev.start.getHours() + ev.start.getMinutes() / 60;
                endHour = ev.end.getHours() + ev.end.getMinutes() / 60;
                if (endHour < startHour) endHour += 24;
                timeLabel = `${format(ev.start, 'h:mm a')} – ${format(ev.end, 'h:mm a')}`;
              }
              const displayEnd = Math.min(endHour, dayEndHour);
              const displayStart = Math.max(startHour, hourStart);
              if (displayStart >= displayEnd) return null;
              const topPct = ((displayStart - hourStart) / visibleHours.length) * 100;
              const heightPct = ((displayEnd - displayStart) / visibleHours.length) * 100;
              const { column, numColumns } = layout.get(ev.id) ?? { column: 0, numColumns: 1 };
              const colWidthPct = 100 / numColumns;
              const leftPct = (column / numColumns) * 100;
              return (
                <div
                  key={ev.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onEventClick?.(ev)}
                  onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
                  className="absolute cursor-pointer hover:opacity-90 transition-opacity"
                  style={{
                    top: `${topPct}%`,
                    left: `calc(${leftPct}% + ${pad}px)`,
                    width: `calc(${colWidthPct}% - ${pad * 2}px)`,
                    height: `${heightPct}%`,
                    minHeight: 48,
                  }}
                >
                  <div
                    className={`flex flex-col justify-center px-3 py-2 rounded-lg border ${type.color} h-full min-w-0 shadow-sm`}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                      {(() => {
                        const Icon = type.icon;
                        const loc = getEventBandLocationSummary(ev, sheetNameById);
                        const showTime = eventSpansSingleCalendarDay(ev);
                        return (
                          <>
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="font-medium truncate min-w-0">{ev.title}</span>
                            {loc && (
                              <>
                                <span className="shrink-0">·</span>
                                <span className="text-sm opacity-90 truncate min-w-0">{loc}</span>
                              </>
                            )}
                            {showTime && (
                              <>
                                <span className="shrink-0">·</span>
                                <span className="text-sm opacity-90 shrink-0">{timeLabel}</span>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
