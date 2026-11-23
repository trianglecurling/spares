/**
 * Day view used to pick an ice booking start time.
 *
 * Shares its geometry and event colors with the calendar day view so the two surfaces read
 * as the same calendar. Hovering (or arrowing through) a start time draws an outline the
 * size of the chosen duration; clicking locks it in.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  computeEventLayout,
  formatHourLabel,
  getVisibleHours,
  HOUR_HEIGHT,
} from '../../utils/calendarDayGrid';
import {
  blockedStartRanges,
  slotIsOpen,
  type BookingSlotUnavailableReason,
  type StartSlotOccupancy,
  type TimeSpan,
} from '../../utils/bookingStartOccupancy';
import { getCalendarEventType } from '../../utils/calendarEventTypeRegistry';
import type { IceSheet } from './iceBookingShared';

const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** Keep a quarter-hour row at least as tall as the old half-hour row. */
const MIN_SLOT_HEIGHT_PX = 30;
const MIN_EVENT_HEIGHT_PX = 22;
const EVENT_GUTTER_PX = 4;

/** Diagonal hatch marking start times that cannot fit the chosen duration. */
const UNAVAILABLE_HATCH =
  'repeating-linear-gradient(135deg, rgba(100,116,139,0.16) 0, rgba(100,116,139,0.16) 4px, transparent 4px, transparent 9px)';

export type BookingDaySlot = StartSlotOccupancy;

export type BookingDayEvent = TimeSpan & {
  id: string;
  typeId: string;
  title: string;
  sheetIds: number[];
};

type BookingDayGridProps = {
  /** Club-local midnight of the day shown. */
  date: Date;
  /** Minutes between offered starts. */
  stepMinutes: number;
  slots: BookingDaySlot[];
  events: BookingDayEvent[];
  sheets: IceSheet[];
  selectedStart: Date | null;
  onSelect: (slot: BookingDaySlot) => void;
  /** Id of the visible label describing the picker. */
  labelledBy: string;
};

function minutesFromMidnight(day: Date, value: Date): number {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  return (value.getTime() - midnight.getTime()) / 60_000;
}

function formatNaturalList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatSheetSummary(sheetIds: number[], sheetNameById: Map<number, string>): string | null {
  const names = [...new Set(sheetIds)].map((id) => sheetNameById.get(id) ?? String(id));
  if (names.length === 0) return null;
  if (sheetNameById.size > 0 && names.length >= sheetNameById.size) return 'All sheets';
  if (names.length === 1) return `Sheet ${names[0]}`;
  return `Sheets ${formatNaturalList(names)}`;
}

function formatTimeRange(span: TimeSpan): string {
  return `${format(span.start, 'h:mm a')} – ${format(span.end, 'h:mm a')}`;
}

function formatSheetsFree(count: number): string {
  return `${count} ${count === 1 ? 'sheet' : 'sheets'} free`;
}

function unavailableDescription(reason: BookingSlotUnavailableReason): string {
  if (reason === 'past') return 'already started';
  if (reason === 'member_conflict') return 'overlaps one of your bookings';
  return 'no sheet free for the full time';
}

function slotLabel(slot: BookingDaySlot): string {
  const range = formatTimeRange(slot);
  return slotIsOpen(slot)
    ? `${range}, ${formatSheetsFree(slot.availableSheetIds.length)}`
    : `${range}, unavailable: ${unavailableDescription(slot.unavailableReason ?? 'sheets_busy')}`;
}

export default function BookingDayGrid({
  date,
  stepMinutes,
  slots,
  events,
  sheets,
  selectedStart,
  onSelect,
  labelledBy,
}: BookingDayGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const sheetNameById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet.name])),
    [sheets]
  );
  const eventLayout = useMemo(() => computeEventLayout(events), [events]);

  const visibleHours = useMemo(() => getVisibleHours(events), [events]);
  const gridStartMinutes = visibleHours[0]! * 60;
  const gridEndMinutes = gridStartMinutes + visibleHours.length * 60;

  const slotHeightPx = Math.max(stepMinutes * PX_PER_MINUTE, MIN_SLOT_HEIGHT_PX);
  const pxPerMinute = slotHeightPx / stepMinutes;
  const hourHeightPx = pxPerMinute * 60;
  const gridHeightPx = (gridEndMinutes - gridStartMinutes) * pxPerMinute;
  const topFor = (value: Date) => (minutesFromMidnight(date, value) - gridStartMinutes) * pxPerMinute;
  const heightFor = (span: TimeSpan) => topFor(span.end) - topFor(span.start);

  const visibleSlots = useMemo(
    () =>
      slots.filter((slot) => {
        const startMinutes = minutesFromMidnight(date, slot.start);
        return startMinutes >= gridStartMinutes && startMinutes < gridEndMinutes;
      }),
    [slots, date, gridStartMinutes, gridEndMinutes]
  );
  const blockedRanges = useMemo(
    () => blockedStartRanges(visibleSlots, stepMinutes),
    [visibleSlots, stepMinutes]
  );

  const selectedIndex = selectedStart
    ? visibleSlots.findIndex((slot) => slot.start.getTime() === selectedStart.getTime())
    : -1;
  const selectedSlot = selectedIndex >= 0 ? visibleSlots[selectedIndex] : undefined;
  const previewSlot =
    previewIndex != null && previewIndex !== selectedIndex ? visibleSlots[previewIndex] : undefined;
  /** The one radio in the tab order: the selection, else the first open start. */
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : visibleSlots.findIndex(slotIsOpen);

  // Re-anchor only when the day changes; scrolling on every selection would fight the user.
  const dayKey = format(date, 'yyyy-MM-dd');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = visibleSlots[tabStopIndex];
    el.scrollTop = anchor ? Math.max(0, topFor(anchor.start) - hourHeightPx) : 0;
  }, [dayKey]);

  const nextOpenIndex = (from: number, direction: 1 | -1): number | null => {
    for (let i = from + direction; i >= 0 && i < visibleSlots.length; i += direction) {
      if (slotIsOpen(visibleSlots[i]!)) return i;
    }
    return null;
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next: number | null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = nextOpenIndex(index, 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = nextOpenIndex(index, -1);
    else if (event.key === 'Home') next = nextOpenIndex(-1, 1);
    else if (event.key === 'End') next = nextOpenIndex(visibleSlots.length, -1);
    else return;
    event.preventDefault();
    if (next == null) return;
    slotRefs.current[next]?.focus();
    onSelect(visibleSlots[next]!);
  };

  const clearPreview = (index: number) =>
    setPreviewIndex((current) => (current === index ? null : current));

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {format(date, 'EEEE, MMMM d')}
        </p>
        <p className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span
            aria-hidden="true"
            className="h-3 w-6 rounded-sm border border-gray-300 dark:border-gray-600"
            style={{ backgroundImage: UNAVAILABLE_HATCH }}
          />
          Can&apos;t start here
        </p>
      </div>

      <div ref={scrollRef} className="flex max-h-[28rem] overflow-y-auto">
        <div className="w-16 shrink-0 border-r border-gray-200 dark:border-gray-700">
          {visibleHours.map((hour) => (
            <div
              key={hour}
              className="px-1 text-xs text-gray-500 dark:text-gray-400"
              style={{ height: hourHeightPx }}
            >
              {formatHourLabel(hour)}
            </div>
          ))}
        </div>

        <div className="relative flex-1">
          {visibleHours.map((hour) => (
            <div
              key={hour}
              className="relative border-b border-gray-200 dark:border-gray-600/60"
              style={{ height: hourHeightPx }}
            >
              <div className="absolute inset-x-0 top-1/2 border-b border-dashed border-gray-200 dark:border-gray-600/70" />
              {stepMinutes <= 15 && (
                <>
                  <div className="absolute inset-x-0 top-1/4 border-b border-dotted border-gray-100 dark:border-gray-700/80" />
                  <div className="absolute inset-x-0 top-3/4 border-b border-dotted border-gray-100 dark:border-gray-700/80" />
                </>
              )}
            </div>
          ))}

          {/* Painted rectangles, not a CSS mask: mask-position was clipping the last 30 minutes. */}
          {blockedRanges.map((range) => (
            <div
              key={range.start.getTime()}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-10"
              style={{
                top: topFor(range.start),
                height: heightFor(range),
                backgroundImage: UNAVAILABLE_HATCH,
              }}
            />
          ))}

          <div className="pointer-events-none absolute inset-0 z-20">
            {events.map((event) => {
              const top = Math.max(0, topFor(event.start));
              const bottom = Math.min(gridHeightPx, topFor(event.end));
              if (bottom <= top) return null;
              const { column, numColumns } = eventLayout.get(event.id) ?? { column: 0, numColumns: 1 };
              const widthPct = 100 / numColumns;
              return (
                <EventBlock
                  key={event.id}
                  event={event}
                  sheetSummary={formatSheetSummary(event.sheetIds, sheetNameById)}
                  style={{
                    top,
                    height: Math.max(bottom - top, MIN_EVENT_HEIGHT_PX),
                    left: `calc(${column * widthPct}% + ${EVENT_GUTTER_PX}px)`,
                    width: `calc(${widthPct}% - ${EVENT_GUTTER_PX * 2}px)`,
                  }}
                />
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0 z-30">
            {previewSlot && (
              <div
                className="absolute inset-x-1 rounded-lg border-2 border-dashed border-primary-teal bg-primary-teal/10"
                style={{ top: topFor(previewSlot.start), height: heightFor(previewSlot) }}
              />
            )}
            {selectedSlot && (
              <div
                className="absolute inset-x-1 flex items-center justify-center rounded-lg border-2 border-primary-teal-solid bg-primary-teal/15 shadow-sm"
                style={{ top: topFor(selectedSlot.start), height: heightFor(selectedSlot) }}
              >
                <span className="max-w-full truncate rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-semibold text-primary-teal-on-tint shadow-sm dark:bg-gray-900/95 dark:text-white">
                  {formatTimeRange(selectedSlot)} ·{' '}
                  {formatSheetsFree(selectedSlot.availableSheetIds.length)}
                </span>
              </div>
            )}
          </div>

          <div role="radiogroup" aria-labelledby={labelledBy} className="absolute inset-0 z-40">
            {visibleSlots.map((slot, index) => {
              const open = slotIsOpen(slot);
              return (
                <button
                  key={slot.start.getTime()}
                  ref={(el) => {
                    slotRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={index === selectedIndex}
                  aria-label={slotLabel(slot)}
                  disabled={!open}
                  tabIndex={index === tabStopIndex ? 0 : -1}
                  onClick={() => onSelect(slot)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  onMouseEnter={() => setPreviewIndex(index)}
                  onMouseLeave={() => clearPreview(index)}
                  onFocus={() => setPreviewIndex(index)}
                  onBlur={() => clearPreview(index)}
                  className={`absolute inset-x-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal ${
                    open ? 'cursor-pointer' : 'cursor-not-allowed'
                  }`}
                  style={{ top: topFor(slot.start), height: slotHeightPx }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventBlock({
  event,
  sheetSummary,
  style,
}: {
  event: BookingDayEvent;
  sheetSummary: string | null;
  style: React.CSSProperties;
}) {
  const type = getCalendarEventType(event.typeId);
  const Icon = type.icon;
  return (
    <div className="absolute" style={style}>
      <div
        className={`flex h-full min-w-0 flex-col justify-center overflow-hidden rounded-md border px-2 py-1 text-xs ${type.color}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium">{event.title}</span>
        </div>
        {sheetSummary && (
          <span className="truncate opacity-90">
            {sheetSummary} · {formatTimeRange(event)}
          </span>
        )}
      </div>
    </div>
  );
}
