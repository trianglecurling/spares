/**
 * Calendar page - Day, Week, Month views with configurable event types.
 * Events support color-coding, icons, timed or all-day, and multi-day spanning.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
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
  HiChevronLeft,
  HiChevronRight,
  HiClipboardDocumentList,
  HiFunnel,
  HiOutlineCalendar,
  HiOutlineCalendarDays,
  HiOutlineCalendarDays as HiOutlineDay,
  HiPencil,
  HiPlus,
  HiRectangleGroup,
  HiSparkles,
  HiStar,
  HiSun,
  HiTrash,
  HiUserGroup,
  HiWrench,
} from 'react-icons/hi2';
import { IoTrophyOutline } from 'react-icons/io5';
import api from '../utils/api';
import Button from '../components/Button';
import PublicLayout from '../components/PublicLayout';
import Modal from '../components/Modal';
import PageTabs from '../components/PageTabs';
import FormCheckbox from '../components/FormCheckbox';
import FormField from '../components/FormField';
import type { ArticleOption } from '../components/ArticleAutocomplete';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import { useAuth } from '../contexts/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  calendarRangeCacheKey,
  getCachedCalendarRange,
  invalidateCalendarEventsCache,
  isCalendarRangeFresh,
  setCachedCalendarRange,
} from '../utils/calendarEventsCache';

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
  /** Event source: 'direct' | 'leagues' | 'ice-booking' | 'events' (read-only for leagues, ice & events) */
  source?: string;
  /** Public event slug when source is 'events' */
  slug?: string;
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
      'bg-red-100 text-red-900 border-red-900/50 dark:bg-red-600 dark:text-white dark:border-white/25',
    icon: HiWrench,
  },
  {
    id: 'leagues',
    label: 'Leagues',
    color:
      'bg-cyan-100 text-cyan-950 border-cyan-900/40 dark:bg-cyan-700 dark:text-white dark:border-white/25',
    icon: HiRectangleGroup,
  },
  {
    id: 'bonspiel',
    label: 'Bonspiel',
    color:
      'bg-violet-200 text-violet-900 border-violet-900/50 dark:bg-violet-500 dark:text-white dark:border-white/25',
    icon: IoTrophyOutline,
  },
  {
    id: 'juniors',
    label: 'Juniors',
    color:
      'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-900/50 dark:bg-fuchsia-600 dark:text-white dark:border-white/25',
    icon: HiSparkles,
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
      'bg-orange-100 text-orange-900 border-orange-900/50 dark:bg-orange-500 dark:text-white dark:border-white/25',
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
      'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-primary-teal-solid dark:text-white dark:border-white/25',
    icon: HiStar,
  },
];

/** Solid dot colors for compact mobile month cells (paired with DEFAULT_EVENT_TYPES). */
const EVENT_TYPE_DOT_CLASS: Record<string, string> = {
  maintenance: 'bg-red-500 dark:bg-red-400',
  leagues: 'bg-cyan-600 dark:bg-cyan-400',
  bonspiel: 'bg-violet-600 dark:bg-violet-400',
  'bonspiel-fours': 'bg-violet-600 dark:bg-violet-400',
  'bonspiel-doubles': 'bg-violet-600 dark:bg-violet-400',
  juniors: 'bg-fuchsia-600 dark:bg-fuchsia-400',
  practice: 'bg-amber-500 dark:bg-amber-400',
  'group-event': 'bg-orange-500 dark:bg-orange-400',
  clinic: 'bg-sky-500 dark:bg-sky-400',
  social: 'bg-rose-500 dark:bg-rose-400',
  'board-committee': 'bg-indigo-600 dark:bg-indigo-400',
  'learn-to-curl': 'bg-teal-600 dark:bg-teal-400',
  'off-season': 'bg-orange-500 dark:bg-orange-400',
  other: 'bg-gray-500 dark:bg-gray-400',
  'member-ice': 'bg-teal-600 dark:bg-teal-400',
};

function eventTypeDotClass(typeId: string): string {
  return EVENT_TYPE_DOT_CLASS[typeId] ?? EVENT_TYPE_DOT_CLASS.other;
}

/**
 * Subtle wash behind week-view time columns when that day has an all-day (or equivalent) event.
 * Used for both authenticated `/calendar` and public `/calendar/public` (same `WeekView`).
 * Light + `dark:` variants so the tint reads on `bg-white dark:bg-gray-800` calendar cards.
 */
const WEEK_ALL_DAY_COLUMN_TINT: Record<string, string> = {
  maintenance: 'bg-red-50/50 dark:bg-red-950/35',
  leagues: 'bg-cyan-50/50 dark:bg-cyan-950/35',
  bonspiel: 'bg-violet-50/50 dark:bg-violet-950/35',
  'bonspiel-fours': 'bg-violet-50/50 dark:bg-violet-950/35',
  'bonspiel-doubles': 'bg-violet-50/50 dark:bg-violet-950/35',
  juniors: 'bg-fuchsia-50/50 dark:bg-fuchsia-950/35',
  practice: 'bg-amber-50/50 dark:bg-amber-950/35',
  'group-event': 'bg-orange-50/50 dark:bg-orange-950/35',
  clinic: 'bg-sky-50/50 dark:bg-sky-950/35',
  social: 'bg-rose-50/50 dark:bg-rose-950/35',
  'board-committee': 'bg-indigo-50/50 dark:bg-indigo-950/35',
  'learn-to-curl': 'bg-teal-50/50 dark:bg-teal-950/35',
  'off-season': 'bg-orange-50/50 dark:bg-orange-950/35',
  other: 'bg-gray-100/45 dark:bg-gray-900/35',
  'member-ice': 'bg-teal-50/50 dark:bg-teal-950/35',
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
  slug?: string;
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
    slug: ev.slug,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [goToDateOpen, setGoToDateOpen] = useState(false);
  const [sheets, setSheets] = useState<Array<{ id: number; name: string }>>([]);
  const eventTypes = DEFAULT_EVENT_TYPES;
  const isCompactLayout = useMediaQuery('(max-width: 767px)');
  const jumpDateFieldId = useId();
  const activeFilterCount = (!showLeagues ? 1 : 0) + (!showEvents ? 1 : 0) + (onIceOnly ? 1 : 0);

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
    if (publicMode) return;
    api
      .get<Array<{ id: number; name: string; isActive?: boolean }>>('/sheets')
      .then((res) => {
        const active = (res.data ?? []).filter((s) => s.isActive !== false);
        setSheets(active.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, [publicMode]);

  useEffect(() => {
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
      slug?: string;
    };
    type PublicCalendarBundle = {
      events: EventPayload[];
      sheets: Array<{ id: number; name: string }>;
      leagueEvents: EventPayload[];
    };

    const cacheKey = calendarRangeCacheKey(publicMode, rangeStart, rangeEnd);
    const cached = getCachedCalendarRange<CalendarEvent>(cacheKey);
    if (cached) {
      setEvents(cached.events);
      if (cached.sheets) setSheets(cached.sheets);
      if (isCalendarRangeFresh(cached)) {
        setEventsLoading(false);
        return;
      }
      // Stale-while-revalidate: keep showing cached events without a blocking overlay.
      setEventsLoading(false);
    } else {
      setEventsLoading(true);
    }

    const abortController = new AbortController();
    const { signal } = abortController;
    const rangeQuery = `start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`;

    const applyLoaded = (nextEvents: CalendarEvent[], nextSheets?: Array<{ id: number; name: string }>) => {
      if (signal.aborted) return;
      setCachedCalendarRange(cacheKey, { events: nextEvents, sheets: nextSheets });
      setEvents(nextEvents);
      if (nextSheets) setSheets(nextSheets);
      setEventsLoading(false);
    };

    if (publicMode) {
      api
        .get<PublicCalendarBundle>(`/public/calendar/events?${rangeQuery}`, { signal })
        .then((res) => {
          const bundle = res.data;
          if (!bundle) {
            applyLoaded([]);
            return;
          }
          const nextSheets = bundle.sheets.map((s) => ({ id: s.id, name: s.name }));
          const calendarEvents = bundle.events.map(apiEventToCalendar);
          const leagueEvents = (bundle.leagueEvents ?? []).map(apiEventToCalendar);
          applyLoaded([...calendarEvents, ...leagueEvents], nextSheets);
        })
        .catch((err) => {
          if (signal.aborted || axios.isCancel(err)) return;
          if (!cached) {
            setEvents([]);
            setEventsLoading(false);
          }
        });
      return () => abortController.abort();
    }

    Promise.allSettled([
      api.get<EventPayload[]>(`/calendar/events?${rangeQuery}`, { signal }),
      api.get<EventPayload[]>(`/calendar/league-events?${rangeQuery}`, { signal }),
    ])
      .then(([eventsRes, leagueRes]) => {
        if (signal.aborted) return;
        const calendarEvents =
          eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []).map(apiEventToCalendar) : [];
        const leagueEvents =
          leagueRes.status === 'fulfilled' ? (leagueRes.value.data ?? []).map(apiEventToCalendar) : [];
        applyLoaded([...calendarEvents, ...leagueEvents]);
      })
      .catch((err) => {
        if (signal.aborted || axios.isCancel(err)) return;
        if (!cached) {
          setEvents([]);
          setEventsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [rangeStart, rangeEnd, publicMode]);

  const refreshEvents = () => {
    invalidateCalendarEventsCache();
    const rangeQuery = `start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`;
    const cacheKey = calendarRangeCacheKey(publicMode, rangeStart, rangeEnd);
    type EventPayload = Parameters<typeof apiEventToCalendar>[0];
    type PublicCalendarBundle = {
      events: EventPayload[];
      sheets: Array<{ id: number; name: string }>;
      leagueEvents: EventPayload[];
    };

    if (publicMode) {
      api
        .get<PublicCalendarBundle>(`/public/calendar/events?${rangeQuery}`)
        .then((res) => {
          const bundle = res.data;
          if (!bundle) return;
          const nextSheets = bundle.sheets.map((s) => ({ id: s.id, name: s.name }));
          const calendarEvents = bundle.events.map(apiEventToCalendar);
          const leagueEvents = (bundle.leagueEvents ?? []).map(apiEventToCalendar);
          const nextEvents = [...calendarEvents, ...leagueEvents];
          setCachedCalendarRange(cacheKey, { events: nextEvents, sheets: nextSheets });
          setSheets(nextSheets);
          setEvents(nextEvents);
        })
        .catch(() => {});
      return;
    }

    Promise.allSettled([
      api.get<EventPayload[]>(`/calendar/events?${rangeQuery}`),
      api.get<EventPayload[]>(`/calendar/league-events?${rangeQuery}`),
    ])
      .then(([eventsRes, leagueRes]) => {
        const calendarEvents =
          eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []).map(apiEventToCalendar) : [];
        const leagueEvents =
          leagueRes.status === 'fulfilled' ? (leagueRes.value.data ?? []).map(apiEventToCalendar) : [];
        const nextEvents = [...calendarEvents, ...leagueEvents];
        setCachedCalendarRange(cacheKey, { events: nextEvents });
        setEvents(nextEvents);
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

  const legendEventTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of filteredEvents) {
      counts.set(ev.typeId, (counts.get(ev.typeId) ?? 0) + 1);
    }
    return [...eventTypes].sort((a, b) => {
      const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      return eventTypes.indexOf(a) - eventTypes.indexOf(b);
    });
  }, [filteredEvents, eventTypes]);

  const getEventType = (typeId: string) => {
    const resolved =
      typeId === 'bonspiel-fours' || typeId === 'bonspiel-doubles' ? 'bonspiel' : typeId;
    return (
      eventTypes.find((t) => t.id === resolved) ??
      eventTypes.find((t) => t.id === 'other') ??
      eventTypes[0]
    );
  };

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
  /** Stay in week view while changing the focused day (mobile week day-strip). */
  const selectDayInWeek = (date: Date) => updateUrl(date, 'week');
  const openNewEventForDate = (date: Date) => {
    navigate(`/calendar/events/new?date=${format(date, 'yyyy-MM-dd')}`);
  };

  const openEditEvent = (ev: CalendarEvent) => {
    navigate(`/calendar/events/edit/${encodeURIComponent(ev.id)}`, { state: { calendarEvent: ev } });
  };

  const calendarContent = (
    <>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {/* Toolbar — compact on mobile, full controls from md up */}
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {/* Mobile compact header */}
          <div className="flex flex-col gap-3 px-3 py-3 md:hidden">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrev}
                className="p-2.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                aria-label="Previous"
              >
                <HiChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0 text-center">
                <div className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {headerLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={goNext}
                className="p-2.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                aria-label="Next"
              >
                <HiChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={goToday}
                className="px-3 py-2 text-sm font-medium rounded-md bg-primary-teal-solid text-white hover:opacity-90"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                aria-haspopup="dialog"
              >
                <HiFunnel className="w-4 h-4 shrink-0" aria-hidden />
                Filters
                {activeFilterCount > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-teal-solid px-1.5 text-xs font-semibold text-white">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setGoToDateOpen(true)}
                className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              >
                Go to date
              </button>
              {canEditCalendar && (
                <Button
                  variant="primary"
                  onClick={() => navigate(`/calendar/events/new?date=${format(currentDate, 'yyyy-MM-dd')}`)}
                  className="ml-auto inline-flex items-center justify-center p-2.5"
                  aria-label="New event"
                >
                  <HiPlus className="w-5 h-5" />
                </Button>
              )}
            </div>

            <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
              {(['day', 'week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onViewChange(v)}
                  className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-2.5 text-sm font-medium capitalize ${
                    view === v
                      ? 'bg-primary-teal-solid text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {v === 'day' && <HiOutlineDay className="w-4 h-4 shrink-0" aria-hidden />}
                  {v === 'week' && <HiOutlineCalendarDays className="w-4 h-4 shrink-0" aria-hidden />}
                  {v === 'month' && <HiCalendar className="w-4 h-4 shrink-0" aria-hidden />}
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop / tablet toolbar */}
          <div className="hidden md:flex flex-col gap-4 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                aria-label="Previous"
              >
                <HiChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                aria-label="Next"
              >
                <HiChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goToday}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary-teal-solid text-white hover:opacity-90"
              >
                Today
              </button>
              <span className="ml-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {headerLabel}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
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

              <label className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                Jump to:
                <input
                  type="date"
                  value={jumpTarget}
                  onChange={onJumpDate}
                  className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                />
              </label>

              <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                {(['day', 'week', 'month'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onViewChange(v)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium capitalize ${
                      view === v
                        ? 'bg-primary-teal-solid text-white'
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
        </div>

        {/* Calendar grid — day/compact week scroll inside the view; month/desktop week may scroll here */}
        <div
          className={`flex-1 min-h-0 flex flex-col relative ${
            view === 'day' || (view === 'week' && isCompactLayout)
              ? 'overflow-hidden'
              : 'overflow-auto'
          }`}
        >
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
              compact={isCompactLayout}
              onEventClick={setSelectedEvent}
              onDayClick={goToDayView}
              onEmptyCellClick={canEditCalendar ? openNewEventForDate : undefined}
            />
          )}
          {view === 'week' && (
            <WeekView
              rangeStart={rangeStart}
              selectedDate={currentDate}
              events={filteredEvents}
              getEventType={getEventType}
              sheetNameById={sheetNameById}
              compact={isCompactLayout}
              onEventClick={setSelectedEvent}
              onDayClick={goToDayView}
              onSelectDay={selectDayInWeek}
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
        <div className="shrink-0 px-3 py-2 md:px-4 md:py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:gap-x-4 md:gap-y-2">
            {legendEventTypes.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.id} className="flex items-center gap-1.5 md:gap-2">
                  <span
                    className={`md:hidden block w-2 h-2 rounded-full shrink-0 ${eventTypeDotClass(t.id)}`}
                    aria-hidden
                  />
                  <span
                    className={`hidden md:inline-flex items-center justify-center w-8 h-8 rounded ${t.color}`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400">
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Calendar filters"
        size="sm"
        verticalAlign="start"
      >
        <div className="space-y-4">
          <FormCheckbox label="Leagues" checked={showLeagues} onChange={setShowLeagues} />
          <FormCheckbox label="Events" checked={showEvents} onChange={setShowEvents} />
          <FormCheckbox label="On-ice only" checked={onIceOnly} onChange={setOnIceOnly} />
          <div className="pt-2 flex justify-end">
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={goToDateOpen}
        onClose={() => setGoToDateOpen(false)}
        title="Go to date"
        size="sm"
        verticalAlign="start"
      >
        <div className="space-y-4">
          <FormField label="Date" htmlFor={jumpDateFieldId}>
            <input
              id={jumpDateFieldId}
              type="date"
              value={jumpTarget}
              onChange={(e) => {
                onJumpDate(e);
                if (e.target.value) setGoToDateOpen(false);
              }}
              className="app-input w-full"
            />
          </FormField>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setGoToDateOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
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
                  <PageTabs
                    className="mb-2 shrink-0"
                    items={[
                      {
                        key: 'details',
                        label: 'Event details',
                        isActive: viewEventActiveTab === 'details',
                        onClick: () => setViewEventActiveTab('details'),
                      },
                      {
                        key: 'description',
                        label: 'Description',
                        isActive: viewEventActiveTab === 'description',
                        onClick: () => setViewEventActiveTab('description'),
                      },
                    ]}
                  />
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
                          {isRegistrableEvent(selectedEvent) && selectedEvent.slug && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">Event page</dt>
                              <dd>
                                <Link
                                  to={`/events/${selectedEvent.slug}`}
                                  className="text-primary-teal-link underline hover:opacity-80"
                                  onClick={() => setSelectedEvent(null)}
                                >
                                  View event
                                </Link>
                              </dd>
                            </>
                          )}
                          {selectedEvent.article && (
                            <>
                              <dt className="text-gray-500 dark:text-gray-400">More info</dt>
                              <dd>
                                <a
                                  href={`/articles/${selectedEvent.article.slug}`}
                                  className="text-primary-teal-link underline hover:opacity-80"
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
                            <div className="text-sm text-gray-800 dark:text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:text-primary-teal-link [&_a]:underline hover:[&_a]:opacity-80">
                              <ArticleMarkdown markdown={descriptionText} className="markdown-content max-w-none" />
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
                  <div className="text-sm text-gray-800 dark:text-gray-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:text-primary-teal-link [&_a]:underline hover:[&_a]:opacity-80 min-h-[120px] flex-1">
                    <ArticleMarkdown markdown={descriptionText} className="markdown-content max-w-none" />
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
    <PublicLayout fillViewport>
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-8 flex-1 min-h-0 flex flex-col overflow-hidden">
        {calendarContent}
      </div>
    </PublicLayout>
  ) : (
    calendarContent
  );
}

const ESTIMATED_EVENT_HEIGHT = 26;
/** Slot height = event + space-y-0.5 gap, matches MonthDayEvents layout */
const SLOT_HEIGHT = 28;
/** Compact mobile month: thin multi-day bars under the date number */
const COMPACT_DATE_OFFSET_PX = 36;
const COMPACT_BAND_HEIGHT_PX = 4;
const COMPACT_BAND_GAP_PX = 2;
/** Room for ~2 wrapped rows of 6px dots + gaps under the date / multi-day bars */
const COMPACT_DOTS_AREA_PX = 20;

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
          if (e.defaultPrevented) return;
          if (e.target === e.currentTarget) onEmptyCellClick?.(day);
        }}
        role={onEmptyCellClick ? 'button' : undefined}
        tabIndex={onEmptyCellClick ? 0 : undefined}
        onKeyDown={
          onEmptyCellClick
            ? (e) => {
                if (e.defaultPrevented || e.key !== 'Enter') return;
                onEmptyCellClick(day);
              }
            : undefined
        }
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
                e.preventDefault();
                onEventClick?.(ev);
              }}
              onKeyDown={(e) => {
                if (e.defaultPrevented || e.key !== 'Enter') return;
                onEventClick?.(ev);
              }}
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
            e.preventDefault();
            onDayClick?.(day);
          }}
          className="shrink-0 text-xs text-gray-500 dark:text-gray-400 py-0.5 hover:text-primary-teal-link dark:hover:opacity-90 cursor-pointer underline-offset-2 hover:underline text-left w-full"
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
  compact = false,
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
  compact?: boolean;
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
    if (compact) return;
    const el = measureRef.current;
    if (!el || maxBandsPerWeek === 0) return;
    const dateBtn = el.querySelector('button');
    const eventsWrap = el.querySelector('[data-events-area]');
    if (!dateBtn || !eventsWrap) return;
    const dateOffset = dateBtn.offsetHeight + 4; // mt-1
    const firstSlot = eventsWrap.querySelector('[data-slot]') as HTMLElement | null;
    const slotHeight = firstSlot ? firstSlot.offsetHeight + 2 : SLOT_HEIGHT; // +space-y-0.5
    setSlotMetrics({ dateOffset, slotHeight });
  }, [maxBandsPerWeek, weeks.length, compact]);

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

  const weekdayLabels = compact ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : WEEKDAYS;
  const compactBandStackPx =
    maxBandsPerWeek > 0
      ? maxBandsPerWeek * COMPACT_BAND_HEIGHT_PX + Math.max(0, maxBandsPerWeek - 1) * COMPACT_BAND_GAP_PX
      : 0;
  const compactMinRowPx = Math.max(
    72,
    COMPACT_DATE_OFFSET_PX + compactBandStackPx + COMPACT_DOTS_AREA_PX
  );
  const compactHeaderRef = useRef<HTMLDivElement>(null);
  const [compactHeaderHeight, setCompactHeaderHeight] = useState(28);

  useEffect(() => {
    if (!compact) return;
    const el = compactHeaderRef.current;
    if (!el) return;
    setCompactHeaderHeight(el.offsetHeight);
  }, [compact, weeks.length]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      {/* Single grid: header row + week rows */}
      <div
        className="flex-1 grid min-h-0 overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(7, 1fr)',
          gridTemplateRows: compact
            ? `auto repeat(${weeks.length}, minmax(${compactMinRowPx}px, 1fr))`
            : `auto repeat(${weeks.length}, minmax(106px, 1fr))`,
        }}
      >
        {/* Weekday headers */}
        {weekdayLabels.map((d, i) => (
          <div
            key={`${d}-${i}`}
            ref={compact && i === 0 ? compactHeaderRef : undefined}
            className={`px-1 py-2 text-center font-semibold text-gray-600 dark:text-gray-400 uppercase border-b border-gray-300 dark:border-gray-600 ${
              compact ? 'text-[10px]' : 'px-2 text-xs'
            }`}
          >
            {d}
          </div>
        ))}
        {/* Day cells */}
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            const allDayEvents = getEventsForDay(day);
            const dayEvents = allDayEvents.filter((e) => !isMultiDay(e));
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isToday = isSameDay(day, new Date());
            const sortedEvents = [...dayEvents].sort(
              (a, b) => a.start.getTime() - b.start.getTime()
            );
            const isFirstCell = wi === 0 && di === 0;

            if (compact) {
              const totalCount = allDayEvents.length;
              const countLabel =
                totalCount === 0 ? 'No events' : totalCount === 1 ? '1 event' : `${totalCount} events`;

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => onDayClick?.(day)}
                  aria-label={`${format(day, 'EEEE, MMMM d')}, ${countLabel}`}
                  className={`border-r border-b border-gray-200 dark:border-gray-600/60 px-0.5 pt-1 pb-1.5 flex flex-col items-center min-h-0 ${
                    !isCurrentMonth ? 'bg-gray-50 dark:bg-gray-900/50' : 'bg-white dark:bg-gray-800'
                  } hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium shrink-0 ${
                      isToday
                        ? 'bg-primary-teal-solid text-white'
                        : isCurrentMonth
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {format(day, 'd')}
                  </span>
                  <span
                    className="flex w-full flex-col items-center justify-start"
                    style={{
                      paddingTop: compactBandStackPx > 0 ? compactBandStackPx + 2 : 2,
                      minHeight: COMPACT_DOTS_AREA_PX,
                    }}
                    aria-hidden
                  >
                    {sortedEvents.length > 0 ? (
                      <span className="flex flex-wrap content-start items-center justify-center gap-0.5 px-0.5">
                        {sortedEvents.map((ev) => (
                          <span
                            key={ev.id}
                            className={`block w-1.5 h-1.5 rounded-full ${eventTypeDotClass(ev.typeId)}`}
                          />
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            }

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
                      ? 'bg-primary-teal-solid text-white'
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
      {/* Compact multi-day bars — one row per week, bars span columns */}
      {compact && multiDaySegments.length > 0 && maxBandsPerWeek > 0 && (
        <div
          className="absolute left-0 right-0 bottom-0 pointer-events-none"
          style={{ top: compactHeaderHeight }}
        >
          <div
            className="h-full grid"
            style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(${compactMinRowPx}px, 1fr))` }}
          >
            {weeks.map((_, wi) => (
              <div key={`compact-week-bands-${wi}`} className="relative min-h-0">
                {multiDaySegments
                  .filter((seg) => seg.weekIndex === wi)
                  .map((seg) => {
                    const roundClass =
                      seg.roundLeft && seg.roundRight
                        ? 'rounded-full'
                        : seg.roundLeft
                          ? 'rounded-l-full'
                          : seg.roundRight
                            ? 'rounded-r-full'
                            : '';
                    const spanDays = seg.endCol - seg.startCol + 1;
                    return (
                      <button
                        key={`compact-${seg.ev.id}-${seg.weekIndex}-${seg.bandIndex}`}
                        type="button"
                        className={`pointer-events-auto absolute h-1 border-0 cursor-pointer hover:opacity-90 z-[1] ${eventTypeDotClass(seg.ev.typeId)} ${roundClass}`}
                        style={{
                          top:
                            COMPACT_DATE_OFFSET_PX +
                            seg.bandIndex * (COMPACT_BAND_HEIGHT_PX + COMPACT_BAND_GAP_PX),
                          left: `calc(${(seg.startCol / 7) * 100}% + 2px)`,
                          width: `calc(${(spanDays / 7) * 100}% - 4px)`,
                        }}
                        aria-label={seg.ev.title}
                        title={seg.ev.title}
                        onClick={(e) => {
                          e.preventDefault();
                          onEventClick?.(seg.ev);
                        }}
                      />
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Multi-day event overlay - bands align with single-day event slots */}
      {!compact && multiDaySegments.length > 0 && maxBandsPerWeek > 0 && (
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
                  e.preventDefault();
                  onEventClick?.(seg.ev);
                }}
                onKeyDown={(e) => {
                  if (e.defaultPrevented || e.key !== 'Enter') return;
                  onEventClick?.(seg.ev);
                }}
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
  selectedDate,
  events,
  getEventType,
  sheetNameById,
  compact = false,
  onEventClick,
  onDayClick,
  onSelectDay,
  onEmptySlotClick,
}: {
  rangeStart: Date;
  selectedDate: Date;
  events: CalendarEvent[];
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  compact?: boolean;
  onEventClick?: (ev: CalendarEvent) => void;
  onDayClick?: (day: Date) => void;
  /** Mobile week: change focused day while remaining in week view */
  onSelectDay?: (day: Date) => void;
  onEmptySlotClick?: (date: Date) => void;
}) {
  if (compact) {
    return (
      <CompactWeekView
        rangeStart={rangeStart}
        selectedDate={selectedDate}
        events={events}
        getEventType={getEventType}
        sheetNameById={sheetNameById}
        onEventClick={onEventClick}
        onSelectDay={onSelectDay}
        onEmptySlotClick={onEmptySlotClick}
      />
    );
  }

  return (
    <DesktopWeekView
      rangeStart={rangeStart}
      events={events}
      getEventType={getEventType}
      sheetNameById={sheetNameById}
      onEventClick={onEventClick}
      onDayClick={onDayClick}
      onEmptySlotClick={onEmptySlotClick}
    />
  );
}

/** Mobile week: day strip + shared DayView body (no horizontal scroll). */
function CompactWeekView({
  rangeStart,
  selectedDate,
  events,
  getEventType,
  sheetNameById,
  onEventClick,
  onSelectDay,
  onEmptySlotClick,
}: {
  rangeStart: Date;
  selectedDate: Date;
  events: CalendarEvent[];
  getEventType: (id: string) => CalendarEventType;
  sheetNameById: Map<number, string>;
  onEventClick?: (ev: CalendarEvent) => void;
  onSelectDay?: (day: Date) => void;
  onEmptySlotClick?: (date: Date) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i)),
    [rangeStart]
  );

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

  const focusedDay = days.find((d) => isSameDay(d, selectedDate)) ?? days[0]!;

  return (
    <div className="flex flex-col min-w-0 flex-1 min-h-0 overflow-hidden">
      <div
        className="shrink-0 grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
        role="tablist"
        aria-label="Days of the week"
      >
        {days.map((day) => {
          const isSelected = isSameDay(day, focusedDay);
          const isToday = isSameDay(day, new Date());
          const dayEventCount = getEventsForDay(day).length;
          return (
            <button
              key={day.toISOString()}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${format(day, 'EEEE, MMMM d')}${
                dayEventCount === 0
                  ? ', no events'
                  : dayEventCount === 1
                    ? ', 1 event'
                    : `, ${dayEventCount} events`
              }`}
              onClick={() => onSelectDay?.(day)}
              className={`flex flex-col items-center gap-0.5 px-1 py-2.5 min-w-0 border-r border-gray-200 dark:border-gray-600/60 last:border-r-0 transition-colors ${
                isSelected
                  ? 'bg-primary-teal/15 dark:bg-primary-teal/25'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}
            >
              <span
                className={`text-[10px] font-semibold uppercase ${
                  isSelected ? 'text-primary-teal' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {format(day, 'EEE')}
              </span>
              <span
                className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  isToday
                    ? 'bg-primary-teal-solid text-white'
                    : isSelected
                      ? 'text-primary-teal'
                      : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {format(day, 'd')}
              </span>
              <span className="flex items-center justify-center gap-0.5 min-h-1.5" aria-hidden>
                {dayEventCount > 0 ? (
                  <span className="block w-1 h-1 rounded-full bg-primary-teal-solid" />
                ) : (
                  <span className="block w-1 h-1" />
                )}
              </span>
            </button>
          );
        })}
      </div>
      <DayView
        date={focusedDay}
        events={events}
        getEventType={getEventType}
        sheetNameById={sheetNameById}
        onEventClick={onEventClick}
        onEmptySlotClick={onEmptySlotClick}
      />
    </div>
  );
}

function DesktopWeekView({
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
                  ? (e) => {
                      if (e.defaultPrevented) return;
                      onEmptySlotClick(
                        new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)
                      );
                    }
                  : undefined
              }
              onKeyDown={
                onEmptySlotClick
                  ? (e) => {
                      if (e.defaultPrevented || e.key !== 'Enter') return;
                      onEmptySlotClick(
                        new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)
                      );
                    }
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
                        e.preventDefault();
                        onEventClick?.(ev);
                      }}
                      onKeyDown={(e) => {
                        if (e.defaultPrevented || e.key !== 'Enter') return;
                        onEventClick?.(ev);
                      }}
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
                  e.preventDefault();
                  onEventClick?.(seg.ev);
                }}
                onKeyDown={(e) => {
                  if (e.defaultPrevented || e.key !== 'Enter') return;
                  onEventClick?.(seg.ev);
                }}
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
