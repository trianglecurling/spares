/**
 * Calendar page - Day, Week, Month views with configurable event types.
 * Events support color-coding, icons, timed or all-day, and multi-day spanning.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInDays,
  differenceInMinutes,
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
  HiPhone,
  HiPlus,
  HiSun,
  HiTrash,
  HiUserGroup,
  HiWrench,
} from 'react-icons/hi2';
import { LuMapPin, LuTreePine } from 'react-icons/lu';
import { PiArmchair } from 'react-icons/pi';
import api from '../utils/api';
import Button from '../components/Button';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';

export type CalendarView = 'day' | 'week' | 'month';

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
  locations?: EventLocation[];
  /** RRULE string when event is part of a recurring series (for edit form) */
  recurrenceRrule?: string;
  /** Display name of the member who created the event */
  createdBy?: string;
}

/** True if event takes place on a sheet (on-ice) */
function isOnIceEvent(ev: CalendarEvent): boolean {
  return (ev.locations ?? []).some((loc) => loc.type === 'sheet');
}

const LOCATION_LABELS: Record<string, string> = {
  'warm-room': 'Warm Room',
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

function SingleLocationIcon({
  loc,
  sheetNameById,
  className,
}: {
  loc: EventLocation;
  sheetNameById: Map<number, string>;
  className: string;
}) {
  const wrapperClass = 'inline-flex items-center justify-center shrink-0';
  if (loc.type === 'sheet') {
    const name = sheetNameById.get(loc.sheetId) ?? loc.sheetName ?? String(loc.sheetId);
    return (
      <span className={`${wrapperClass} ${className} font-semibold min-w-[1em] leading-none -translate-y-px`}>
        {name}
      </span>
    );
  }
  const Icon =
    loc.type === 'warm-room' ? PiArmchair
    : loc.type === 'exterior' ? LuTreePine
    : loc.type === 'virtual' ? HiPhone
    : loc.type === 'offsite' ? LuMapPin
    : HiCalendar;
  return (
    <span className={`${wrapperClass} ${className}`}>
      <Icon className="size-full" />
    </span>
  );
}

/** Icons for event band - one per location when set, else event type icon. */
function EventBandIcon({
  ev,
  type,
  sheetNameById,
  className,
}: {
  ev: CalendarEvent;
  type: CalendarEventType;
  sheetNameById: Map<number, string>;
  className: string;
}) {
  const locs = ev.locations;
  if (!locs || locs.length === 0) {
    const Icon = type.icon;
    return <Icon className={className} />;
  }
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {locs.map((loc, i) => (
        <SingleLocationIcon key={i} loc={loc} sheetNameById={sheetNameById} className={className} />
      ))}
    </span>
  );
}

// Event type colors: light pastels with dark text for light theme, saturated with white text for dark theme
const DEFAULT_EVENT_TYPES: CalendarEventType[] = [
  { id: 'maintenance', label: 'Maintenance', color: 'bg-slate-200 text-gray-900 border-gray-900/50 dark:bg-slate-600 dark:text-white dark:border-white/25', icon: HiWrench },
  { id: 'leagues', label: 'Leagues', color: 'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-primary-teal dark:text-white dark:border-white/25', icon: HiCalendar },
  { id: 'bonspiel', label: 'Bonspiel', color: 'bg-violet-200 text-violet-900 border-violet-900/50 dark:bg-violet-500 dark:text-white dark:border-white/25', icon: HiCalendarDays },
  { id: 'practice', label: 'Practice', color: 'bg-amber-100 text-amber-900 border-amber-900/50 dark:bg-amber-500 dark:text-white dark:border-white/25', icon: HiOutlineCalendar },
  { id: 'group-event', label: 'Group Event', color: 'bg-emerald-100 text-emerald-900 border-emerald-900/50 dark:bg-emerald-600 dark:text-white dark:border-white/25', icon: HiUserGroup },
  { id: 'clinic', label: 'Clinic', color: 'bg-sky-100 text-sky-900 border-sky-900/50 dark:bg-sky-500 dark:text-white dark:border-white/25', icon: HiAcademicCap },
  { id: 'social', label: 'Social', color: 'bg-rose-100 text-rose-900 border-rose-900/50 dark:bg-rose-500 dark:text-white dark:border-white/25', icon: HiUserGroup },
  { id: 'board-committee', label: 'Board & Committee', color: 'bg-indigo-100 text-indigo-900 border-indigo-900/50 dark:bg-indigo-600 dark:text-white dark:border-white/25', icon: HiClipboardDocumentList },
  { id: 'learn-to-curl', label: 'Learn to Curl', color: 'bg-teal-100 text-teal-900 border-teal-900/50 dark:bg-teal-600 dark:text-white dark:border-white/25', icon: HiAcademicCap },
  { id: 'off-season', label: 'Off-Season', color: 'bg-orange-100 text-orange-900 border-orange-900/50 dark:bg-orange-500 dark:text-white dark:border-white/25', icon: HiSun },
  { id: 'other', label: 'Other', color: 'bg-gray-200 text-gray-900 border-gray-900/50 dark:bg-gray-500 dark:text-white dark:border-white/25', icon: HiOutlineCalendarDays },
];

function apiEventToCalendar(ev: {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  locations?: Array<{ type: string; sheetId?: number; sheetName?: string }>;
  recurrenceRrule?: string;
  createdBy?: string;
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
    locations: locs.length > 0 ? locs : undefined,
    recurrenceRrule: ev.recurrenceRrule,
    createdBy: ev.createdBy,
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LOCATION_OPTIONS = [
  { type: 'warm-room' as const, label: 'Warm Room' },
  { type: 'exterior' as const, label: 'Exterior' },
  { type: 'offsite' as const, label: 'Offsite' },
  { type: 'virtual' as const, label: 'Virtual' },
];

const RECURRENCE_PRESETS: Array<{ value: string; label: string; rrule: string }> = [
  { value: 'none', label: 'None', rrule: '' },
  { value: 'daily', label: 'Daily', rrule: 'FREQ=DAILY' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { value: 'weekly', label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { value: 'biweekly', label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { value: 'monthly', label: 'Monthly', rrule: 'FREQ=MONTHLY' },
  { value: 'yearly', label: 'Yearly', rrule: 'FREQ=YEARLY' },
  { value: 'custom', label: 'Custom (RRULE)', rrule: '' },
];

const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const RRULE_DAY_LABELS: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };

function getWeekdayFromDate(date: Date): (typeof RRULE_DAYS)[number] {
  const d = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const rruleOrder = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  return rruleOrder[d] as (typeof RRULE_DAYS)[number];
}

function parseByDayFromRrule(rrule: string): (typeof RRULE_DAYS)[number][] | null {
  const match = rrule.match(/BYDAY=([\w,-]+)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => p.trim());
  const days = parts.map((p) => {
    const s = p.toUpperCase();
    return s.length > 2 ? s.slice(-2) : s;
  });
  return days.filter((d): d is (typeof RRULE_DAYS)[number] =>
    RRULE_DAYS.includes(d as (typeof RRULE_DAYS)[number])
  );
}

/** Match rrule to a preset; returns preset value, custom, and weekly days if applicable */
function matchRecurrencePreset(rrule: string): { preset: string; custom: string; weeklyDays?: (typeof RRULE_DAYS)[number][] } {
  if (!rrule || !rrule.trim()) return { preset: 'none', custom: '' };
  const normalized = rrule.trim();
  const exact = RECURRENCE_PRESETS.find((p) => p.rrule && normalized === p.rrule);
  if (exact) return { preset: exact.value, custom: '' };
  if (normalized.startsWith('FREQ=WEEKLY')) {
    const hasInterval2 = /INTERVAL=2/.test(normalized);
    if (hasInterval2) return { preset: 'biweekly', custom: '' };
    const byDay = parseByDayFromRrule(normalized);
    return { preset: 'weekly', custom: '', weeklyDays: byDay && byDay.length > 0 ? byDay : undefined };
  }
  return { preset: 'custom', custom: normalized };
}

function EventFormModal({
  event,
  sheets,
  eventTypes,
  initialDate,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  sheets: Array<{ id: number; name: string }>;
  eventTypes: CalendarEventType[];
  initialDate: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = event
    ? { start: event.start, end: event.end }
    : (() => {
        const start = new Date(initialDate);
        const hasTime = start.getHours() !== 0 || start.getMinutes() !== 0;
        if (!hasTime) start.setHours(9, 0, 0);
        const end = new Date(start);
        end.setHours(end.getHours() + (hasTime ? 1 : 2), 0, 0);
        return { start, end };
      })();
  const [title, setTitle] = useState(event?.title ?? '');
  const [typeId, setTypeId] = useState(event?.typeId ?? 'other');
  const [startDate, setStartDate] = useState(format(base.start, 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState(format(base.start, 'HH:mm'));
  const [endDate, setEndDate] = useState(format(base.end, 'yyyy-MM-dd'));
  const [endTime, setEndTime] = useState(format(base.end, 'HH:mm'));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [selectedSheets, setSelectedSheets] = useState<number[]>(
    () => (event?.locations ?? []).filter((l): l is { type: 'sheet'; sheetId: number; sheetName?: string } => l.type === 'sheet').map((l) => l.sheetId) ?? []
  );
  const [selectedFixedLocs, setSelectedFixedLocs] = useState<Array<'warm-room' | 'exterior' | 'offsite' | 'virtual'>>(
    () => (event?.locations ?? []).filter((l): l is { type: 'warm-room' | 'exterior' | 'offsite' | 'virtual' } => l.type !== 'sheet').map((l) => l.type) ?? []
  );
  const initialRecurrence = matchRecurrencePreset(event?.recurrenceRrule ?? '');
  const defaultWeeklyDays =
    initialRecurrence.preset === 'weekly' && initialRecurrence.weeklyDays
      ? initialRecurrence.weeklyDays
      : [getWeekdayFromDate(base.start)];
  const [recurrencePreset, setRecurrencePreset] = useState(initialRecurrence.preset);
  const [recurrenceCustom, setRecurrenceCustom] = useState(initialRecurrence.custom);
  const [selectedWeekdays, setSelectedWeekdays] = useState<(typeof RRULE_DAYS)[number][]>(
    initialRecurrence.preset === 'weekly' ? defaultWeeklyDays : []
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [recurrenceCount, setRecurrenceCount] = useState<number | ''>('');
  const [editScope, setEditScope] = useState<'this' | 'all'>('this');
  const [saving, setSaving] = useState(false);

  // Recurring instance ids: direct:parentId:YYYY-MM-DD. Non-recurring: direct:id
  const isRecurringEdit = Boolean(event?.id && event.id.split(':').length === 3);
  const isEditingSingleInstance = isRecurringEdit && editScope === 'this';

  useEffect(() => {
    if (recurrencePreset === 'weekly' && selectedWeekdays.length === 0) {
      const d = new Date(`${startDate}T12:00:00`);
      setSelectedWeekdays([getWeekdayFromDate(d)]);
    }
  }, [recurrencePreset, startDate]);

  const toggleWeekday = (day: (typeof RRULE_DAYS)[number]) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length > 0 ? next : prev;
      }
      return [...prev, day];
    });
  };

  const handleStartDateChange = (v: string) => {
    setStartDate(v);
    if (startDate === endDate) setEndDate(v);
  };

  const handleStartTimeChange = (v: string) => {
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const durationMs = end.getTime() - start.getTime();
    const newStart = new Date(`${startDate}T${v}:00`);
    const newEnd = new Date(newStart.getTime() + durationMs);
    setStartTime(v);
    setEndTime(format(newEnd, 'HH:mm'));
    setEndDate(format(newEnd, 'yyyy-MM-dd'));
  };

  const durationLabel = useMemo(() => {
    if (allDay) {
      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59`);
      const days = differenceInDays(end, start) + 1;
      return days === 1 ? '1 day' : `${days} days`;
    }
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const mins = differenceInMinutes(end, start);
    if (mins < 0) return 'Invalid';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  }, [allDay, startDate, startTime, endDate, endTime]);

  const toggleSheet = (id: number) => {
    setSelectedSheets((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };
  const toggleFixedLoc = (t: 'warm-room' | 'exterior' | 'offsite' | 'virtual') => {
    setSelectedFixedLocs((prev) => (prev.includes(t) ? prev.filter((l) => l !== t) : [...prev, t]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const start = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
    const end = new Date(`${endDate}T${allDay ? '23:59' : endTime}:00`);
    const locations: Array<{ type: 'sheet'; sheetId: number; sheetName?: string } | { type: 'warm-room' | 'exterior' | 'offsite' | 'virtual' }> = [
      ...selectedSheets.map((id) => ({ type: 'sheet' as const, sheetId: id, sheetName: sheets.find((s) => s.id === id)?.name })),
      ...selectedFixedLocs.map((type) => ({ type })),
    ];

    let rrule: string | undefined;
    if (!isEditingSingleInstance) {
      if (recurrencePreset === 'custom' && recurrenceCustom.trim()) {
        rrule = recurrenceCustom.trim();
      } else if (recurrencePreset === 'weekly' && selectedWeekdays.length > 0) {
        rrule = `FREQ=WEEKLY;BYDAY=${selectedWeekdays.join(',')}`;
      } else if (recurrencePreset !== 'none') {
        const preset = RECURRENCE_PRESETS.find((p) => p.value === recurrencePreset);
        rrule = preset?.rrule;
      }
    }

    const payload = {
      typeId,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      locations: locations.length > 0 ? locations : undefined,
      recurrence:
        !isEditingSingleInstance && rrule
          ? {
              rrule,
              endDate: recurrenceEndDate || undefined,
              count: recurrenceCount !== '' ? recurrenceCount : undefined,
            }
          : undefined,
    };

    try {
      if (event) {
        const id = event.id;
        const scope = id.split(':').length === 3 ? editScope : undefined;
        await api.patch(`/calendar/events/${encodeURIComponent(id)}`, { ...payload, scope });
      } else {
        await api.post('/calendar/events', payload);
      }
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={true} title={event ? 'Edit event' : 'New event'} onClose={onClose} size="lg" contentOverflow="auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            {eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              {!allDay && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              {!allDay && (
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              )}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Duration: {durationLabel}
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
          <span className="text-sm text-gray-700 dark:text-gray-300">All day</span>
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Locations</label>
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <label key={s.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 cursor-pointer">
                <input type="checkbox" checked={selectedSheets.includes(s.id)} onChange={() => toggleSheet(s.id)} className="rounded" />
                <span className="text-sm">{s.name}</span>
              </label>
            ))}
            {LOCATION_OPTIONS.map((opt) => (
              <label key={opt.type} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 cursor-pointer">
                <input type="checkbox" checked={selectedFixedLocs.includes(opt.type)} onChange={() => toggleFixedLoc(opt.type)} className="rounded" />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        {isRecurringEdit && (
          <div className="rounded-md border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              This is a recurring event. Apply changes to:
            </p>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="editScope"
                  checked={editScope === 'this'}
                  onChange={() => setEditScope('this')}
                  className="border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">This instance only</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="editScope"
                  checked={editScope === 'all'}
                  onChange={() => setEditScope('all')}
                  className="border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">All instances</span>
              </label>
            </div>
          </div>
        )}
        {!isEditingSingleInstance && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recurrence</label>
            <select
              value={recurrencePreset}
              onChange={(e) => setRecurrencePreset(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mb-2"
            >
              {RECURRENCE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {recurrencePreset !== 'none' && (
              <div className="space-y-2 mt-2">
                {recurrencePreset === 'weekly' && (
                  <div>
                    <span className="text-sm text-gray-600 dark:text-gray-400 mr-2">Repeat on:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {RRULE_DAYS.map((day) => (
                        <label
                          key={day}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedWeekdays.includes(day)}
                            onChange={() => toggleWeekday(day)}
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                          <span className="text-sm">{RRULE_DAY_LABELS[day]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {recurrencePreset === 'custom' && (
                  <input
                    type="text"
                    placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR"
                    value={recurrenceCustom}
                    onChange={(e) => setRecurrenceCustom(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                  />
                )}
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">End date:</span>
                    <input
                      type="date"
                      value={recurrenceEndDate}
                      onChange={(e) => setRecurrenceEndDate(e.target.value)}
                      className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Count:</span>
                    <input
                      type="number"
                      min={1}
                      value={recurrenceCount}
                      onChange={(e) => setRecurrenceCount(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                      className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : event ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
const EARLY_HOURS_END = 6; // Hide 12am–6am unless there are events

/** Layout per event: { column, numColumns }. Overlap = share non-zero time: X.start < Y.end && Y.start < X.end */
function computeEventLayout(events: CalendarEvent[]): Map<string, { column: number; numColumns: number }> {
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
    const startPart = sm === 0 ? `${sh % 12 || 12}` : `${sh % 12 || 12}:${sm.toString().padStart(2, '0')}`;
    const endPart = em === 0 ? `${eh % 12 || 12}` : `${eh % 12 || 12}:${em.toString().padStart(2, '0')}`;
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

export default function Calendar() {
  const { member } = useAuth();
  const canEditCalendar = member?.isCalendarAdmin ?? member?.isAdmin ?? member?.isServerAdmin ?? false;

  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const viewParam = searchParams.get('view');

  const currentDate = useMemo(() => parseDateParam(dateParam), [dateParam]);
  const view = parseViewParam(viewParam);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [_eventsLoading, setEventsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [newEventDate, setNewEventDate] = useState<Date | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<CalendarEvent | null>(null);
  const [onIceOnly, setOnIceOnly] = useState(false);
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
    api
      .get<Array<{ id: string; typeId: string; title: string; start: string; end: string; allDay: boolean; locations?: Array<{ type: string; sheetId?: number; sheetName?: string }> }>>(
        `/calendar/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`
      )
      .then((res) => setEvents((res.data ?? []).map(apiEventToCalendar)))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, [rangeStart.toISOString(), rangeEnd.toISOString()]);

  const refreshEvents = () => {
    api
      .get<Array<{ id: string; typeId: string; title: string; start: string; end: string; allDay: boolean; locations?: Array<{ type: string; sheetId?: number; sheetName?: string }> }>>(
        `/calendar/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`
      )
      .then((res) => setEvents((res.data ?? []).map(apiEventToCalendar)))
      .catch(() => {});
  };

  const sheetNameById = useMemo(() => new Map(sheets.map((s) => [s.id, s.name])), [sheets]);
  const filteredEvents = useMemo(
    () => (onIceOnly ? events.filter(isOnIceEvent) : events),
    [events, onIceOnly]
  );

  const getEventType = (typeId: string) => eventTypes.find((t) => t.id === typeId) ?? eventTypes.find((t) => t.id === 'other') ?? eventTypes[0];

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
    setNewEventDate(date);
    setEditingEvent(null);
    setEventFormOpen(true);
  };

  return (
    <Layout fullWidth>
      <div className="flex flex-col flex-1 min-h-[400px] overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-6">
            {/* On-ice only filter */}
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
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
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
                  onClick={() => {
                    setEditingEvent(null);
                    setNewEventDate(null);
                    setEventFormOpen(true);
                  }}
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
        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
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
                  <span className={`inline-flex items-center justify-center w-8 h-8 rounded ${t.color}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{t.label}</span>
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
      >
        {selectedEvent && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {(() => {
                const type = getEventType(selectedEvent.typeId);
                const Icon = type.icon;
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-sm ${type.color}`}>
                    <Icon className="w-4 h-4" />
                    {type.label}
                  </span>
                );
              })()}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {!isSameDay(startOfDay(selectedEvent.start), startOfDay(selectedEvent.end)) ? (
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
                  <dt className="text-gray-500 dark:text-gray-400">Location{selectedEvent.locations.length > 1 ? 's' : ''}</dt>
                  <dd>
                    {selectedEvent.locations.map((loc, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {getLocationLabel(loc, sheetNameById)}
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {selectedEvent.createdBy && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">Created by</dt>
                  <dd>{selectedEvent.createdBy}</dd>
                </>
              )}
            </dl>
            <div className="pt-2 flex gap-2">
              {canEditCalendar && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingEvent(selectedEvent);
                      setSelectedEvent(null);
                      setEventFormOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5"
                  >
                    <HiPencil className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setDeleteEvent(selectedEvent)}
                    className="inline-flex items-center gap-1.5"
                  >
                    <HiTrash className="w-4 h-4" />
                    Delete
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {eventFormOpen && (
        <EventFormModal
          event={editingEvent}
          sheets={sheets}
          eventTypes={eventTypes}
          initialDate={newEventDate ?? currentDate}
          onClose={() => {
            setEventFormOpen(false);
            setEditingEvent(null);
            setNewEventDate(null);
          }}
          onSaved={() => {
            refreshEvents();
            setEventFormOpen(false);
            setEditingEvent(null);
            setNewEventDate(null);
          }}
        />
      )}

      <Modal
        isOpen={!!deleteEvent}
        onClose={() => setDeleteEvent(null)}
        title="Delete event"
      >
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
                        await api.delete(`/calendar/events/${encodeURIComponent(deleteEvent.id)}?scope=this`);
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
                        await api.delete(`/calendar/events/${encodeURIComponent(deleteEvent.id)}?scope=all`);
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
    </Layout>
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
      if (evEndT <= firstT || evStartT >= lastT) continue;
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
        const overlaps = b.startCol < s.endCol && b.endCol > s.startCol;
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
  const [visibleCount, setVisibleCount] = useState(
    () => Math.min(4, events.length)
  );
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
        onClick={(e) => { if (e.target === e.currentTarget) onEmptyCellClick?.(day); }}
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
          const timeLabel = ev.allDay
            ? 'All day'
            : formatCompactTimeRange(ev.start, ev.end);
          return (
            <div
              key={ev.id}
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
              onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-sm truncate shrink-0 border cursor-pointer hover:opacity-90 ${type.color}`}
              title={ev.title}
            >
              <EventBandIcon ev={ev} type={type} sheetNameById={sheetNameById} className="w-3.5 h-3.5 shrink-0" />
              <span className="shrink-0">{timeLabel}</span>
              <span className="shrink-0">·</span>
              <span className="truncate min-w-0">{ev.title}</span>
            </div>
          );
        })}
      </div>
      {showOverflow && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDayClick?.(day); }}
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
  const days: Date[] = [];
  const d = new Date(rangeStart);
  while (d <= rangeEnd) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const getEventsForDay = (day: Date) =>
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
    });

  const isMultiDay = (e: CalendarEvent) =>
    !isSameDay(startOfDay(e.start), startOfDay(e.end));

  const multiDaySegments = useMemo(
    () => getMultiDaySegments(events.filter(isMultiDay), weeks),
    [events, weeks]
  );

  const maxBandsPerWeek =
    multiDaySegments.length === 0
      ? 0
      : Math.max(...multiDaySegments.map((s) => s.bandIndex)) + 1;

  const [slotMetrics, setSlotMetrics] = useState<{ dateOffset: number; slotHeight: number } | null>(null);
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
            className="px-2 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700"
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
                className={`border-r border-b border-gray-100 dark:border-gray-700/50 p-1 flex flex-col min-h-0 overflow-hidden ${
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
                onClick={(e) => { e.stopPropagation(); onEventClick?.(seg.ev); }}
                onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(seg.ev)}
                title={seg.ev.title}
              >
                <EventBandIcon ev={seg.ev} type={type} sheetNameById={sheetNameById} className="w-3.5 h-3.5 shrink-0" />
                <span className="shrink-0">
                  {seg.ev.allDay ? 'All day' : formatCompactTimeRange(seg.ev.start, seg.ev.end)}
                </span>
                <span className="shrink-0">·</span>
                <span className="truncate min-w-0">{seg.ev.title}</span>
                {seg.ev.start.getTime() !== seg.ev.end.getTime() && (
                  <span className="shrink-0 text-xs opacity-90">
                    {format(seg.ev.start, 'M/d')}–{format(seg.ev.end, 'M/d')}
                  </span>
                )}
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

  const getEventsForDay = (day: Date) =>
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
    });

  const allDayEvents = useMemo(() => {
    const byDay = days.map((day) => getEventsForDay(day).filter((e) => e.allDay));
    const flat = byDay.flat();
    const seen = new Set<string>();
    return flat.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [days, events]);

  const isMultiDayTimedOnMiddleDay = (ev: CalendarEvent, day: Date) => {
    if (ev.allDay) return false;
    const isMultiDay = !isSameDay(startOfDay(ev.start), startOfDay(ev.end));
    if (!isMultiDay) return false;
    return !isSameDay(ev.start, day) && !isSameDay(ev.end, day);
  };

  const hasAllDayEvents = useMemo(() => {
    const hasAllDay = allDayEvents.length > 0;
    const hasMultiDayTimedMiddle = days.some((day) =>
      getEventsForDay(day).some((e) => isMultiDayTimedOnMiddleDay(e, day))
    );
    return hasAllDay || hasMultiDayTimedMiddle;
  }, [allDayEvents.length, days, events]);

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
        if (evEndT <= firstT || evStartT >= lastT) return null;
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

  const allTimedEvents = days.flatMap((day) => getEventsForDay(day).filter((e) => !e.allDay));
  const visibleHours = getVisibleHours(allTimedEvents);
  const totalDayHeight = visibleHours.length * HOUR_HEIGHT;
  const hourStart = visibleHours[0] ?? 0;

  return (
    <div className="flex flex-col min-w-0">
      <div className="grid grid-cols-[60px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] min-w-[800px] shrink-0">
        <div className="sticky top-0 left-0 z-10 bg-gray-50 dark:bg-gray-800/95 border-b border-r border-gray-200 dark:border-gray-700" />
        {days.map((day) => (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onDayClick?.(day)}
            className={`sticky top-0 z-10 w-full px-2 py-2 text-center text-sm font-medium border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 ${
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
      <div className={`grid grid-cols-[60px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] min-w-[800px] shrink-0 ${hasAllDayEvents ? '' : 'hidden'}`}>
        <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          All day
        </div>
        <div
          className="relative col-span-7 grid border-b border-gray-200 dark:border-gray-700 min-h-[40px]"
          style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}
        >
          {days.map((day, di) => (
            <div
              key={day.toISOString()}
              role={onEmptySlotClick ? 'button' : undefined}
              tabIndex={onEmptySlotClick ? 0 : undefined}
              onClick={onEmptySlotClick ? () => onEmptySlotClick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)) : undefined}
              onKeyDown={onEmptySlotClick ? (e) => e.key === 'Enter' && onEmptySlotClick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0)) : undefined}
              className={`border-r border-gray-200 dark:border-gray-700 p-1 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
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
                  const isMultiDayTimed = !ev.allDay && !isSameDay(startOfDay(ev.start), startOfDay(ev.end));
                  return (
                    <div
                      key={`${ev.id}-${day.toISOString()}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
                      onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(ev)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-sm border cursor-pointer hover:opacity-90 ${type.color}`}
                    >
                      <EventBandIcon ev={ev} type={type} sheetNameById={sheetNameById} className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{ev.title}</span>
                      {isMultiDayTimed && (
                        <span className="text-xs opacity-90 shrink-0">
                          {format(ev.start, 'M/d')}–{format(ev.end, 'M/d')}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
          {allDaySegments.map((seg, i) => {
            const type = getEventType(seg.ev.typeId);
            const roundClass =
              seg.roundLeft && seg.roundRight ? 'rounded' : seg.roundLeft ? 'rounded-l' : seg.roundRight ? 'rounded-r' : '';
            return (
              <div
                key={`${seg.ev.id}-${i}`}
                className={`absolute top-1 bottom-1 flex items-center gap-1 px-2 py-1 text-sm border cursor-pointer hover:opacity-90 ${type.color} ${roundClass}`}
                style={{
                  left: `calc(${(seg.startCol / 7) * 100}% + 4px)`,
                  width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - 8px)`,
                }}
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onEventClick?.(seg.ev); }}
                onKeyDown={(e) => e.key === 'Enter' && onEventClick?.(seg.ev)}
              >
                <EventBandIcon ev={seg.ev} type={type} sheetNameById={sheetNameById} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{seg.ev.title}</span>
                <span className="text-xs opacity-90 shrink-0">
                  {format(seg.ev.start, 'M/d')}–{format(seg.ev.end, 'M/d')}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-1 grid grid-cols-[60px_1fr_1fr_1fr_1fr_1fr_1fr_1fr] min-w-[800px] min-h-[600px]">
        {/* Time column */}
        <div className="relative">
          {visibleHours.map((hour) => (
            <div
              key={hour}
              className="border-r border-b border-gray-100 dark:border-gray-700/50 px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400"
              style={{ height: HOUR_HEIGHT }}
            >
              {hour === 0 ? '12 am' : hour < 12 ? `${hour} am` : hour === 12 ? '12 pm' : `${hour - 12} pm`}
            </div>
          ))}
        </div>
        {/* Day columns with events */}
        {days.map((day) => {
          const dayEvents = getEventsForDay(day).filter(
            (e) => !e.allDay && !isMultiDayTimedOnMiddleDay(e, day)
          );
          return (
            <div key={day.toISOString()} className="relative border-r border-gray-100 dark:border-gray-700/50">
              {/* Hour grid */}
              {visibleHours.map((hour) => (
                <div
                  key={hour}
                  role={onEmptySlotClick ? 'button' : undefined}
                  tabIndex={onEmptySlotClick ? 0 : undefined}
                  onClick={onEmptySlotClick ? () => onEmptySlotClick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0)) : undefined}
                  onKeyDown={onEmptySlotClick ? (e) => e.key === 'Enter' && onEmptySlotClick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0)) : undefined}
                  className={`border-b border-gray-100 dark:border-gray-700/50 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
              {/* Events overlay */}
              <div className="absolute inset-0 pointer-events-none">
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
                      const topPx = ((displayStart - hourStart) / visibleHours.length) * totalDayHeight;
                      const totalHeightPx = ((displayEnd - displayStart) / visibleHours.length) * totalDayHeight;
                      const { column, numColumns } = layout.get(ev.id) ?? { column: 0, numColumns: 1 };
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
                            <div className="flex items-center gap-1">
                              <EventBandIcon ev={ev} type={type} sheetNameById={sheetNameById} className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate text-sm font-medium">{ev.title}</span>
                            </div>
                            <span className="text-xs opacity-90 truncate">
                              {format(ev.start, 'h:mm a')} – {format(ev.end, 'h:mm a')}
                            </span>
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

  const allDayEvents = dayEvents.filter(
    (e) => e.allDay || isMultiDayTimedOnMiddleDay(e)
  );
  const timedEvents = dayEvents.filter(
    (e) => !e.allDay && !isMultiDayTimedOnMiddleDay(e)
  );
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
                  <EventBandIcon ev={ev} type={type} sheetNameById={sheetNameById} className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{ev.title}</span>
                  {(ev.start.getTime() !== ev.end.getTime() || isMultiDayTimedOnMiddleDay(ev)) && (
                    <span className="text-sm opacity-90">
                      {format(ev.start, 'MMM d')} – {format(ev.end, 'MMM d')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-auto">
        <div className="w-16 shrink-0 border-r border-gray-200 dark:border-gray-700">
          {visibleHours.map((h) => (
            <div key={h} className="text-xs text-gray-500 dark:text-gray-400 px-1" style={{ height: HOUR_HEIGHT }}>
              {h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`}
            </div>
          ))}
        </div>
        <div
          className="flex-1 relative"
          style={{ minHeight: visibleHours.length * HOUR_HEIGHT }}
        >
          {/* Hour grid */}
          {visibleHours.map((h) => (
            <div
              key={h}
              role={onEmptySlotClick ? 'button' : undefined}
              tabIndex={onEmptySlotClick ? 0 : undefined}
              onClick={onEmptySlotClick ? () => onEmptySlotClick(new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0)) : undefined}
              onKeyDown={onEmptySlotClick ? (e) => e.key === 'Enter' && onEmptySlotClick(new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0)) : undefined}
              className={`border-b border-gray-100 dark:border-gray-700/50 ${onEmptySlotClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors' : ''}`}
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
                    <div className="flex items-center gap-2">
                      <EventBandIcon ev={ev} type={type} sheetNameById={sheetNameById} className="w-4 h-4 shrink-0" />
                      <span className="font-medium truncate">{ev.title}</span>
                    </div>
                    <div className="text-sm opacity-90 mt-0.5">
                      {timeLabel}
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
