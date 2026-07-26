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
} from '../utils/calendarDayGrid';
import { getCalendarEventType } from '../utils/calendarEventTypeRegistry';

const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const DEFAULT_STEP_MINUTES = 30;
const EVENT_GUTTER_PX = 4;

/** Diagonal hatch marking start times that cannot fit the chosen duration. */
const UNAVAILABLE_HATCH =
  'repeating-linear-gradient(135deg, rgba(100,116,139,0.16) 0, rgba(100,116,139,0.16) 4px, transparent 4px, transparent 9px)';

export type BookingSlotUnavailableReason = 'past' | 'member_conflict' | 'sheets_busy';

export type BookingDaySlot = {
  start: Date;
  end: Date;
  availableSheetIds: number[];
  unavailableReason?: BookingSlotUnavailableReason;
};

export type BookingDayEvent = {
  id: string;
  typeId: string;
  title: string;
  start: Date;
  end: Date;
  sheetIds: number[];
};

type BookingDayGridProps = {
  date: Date;
  slots: BookingDaySlot[];
  events: BookingDayEvent[];
  sheetNameById: Map<number, string>;
  totalSheetCount: number;
  selectedStart: Date | null;
  onSelect: (slot: BookingDaySlot) => void;
  /** Id of the visible label describing the picker. */
  labelledBy: string;
  describedBy?: string;
};

function isSelectable(slot: BookingDaySlot): boolean {
  return !slot.unavailableReason && slot.availableSheetIds.length > 0;
}

/** Merge contiguous unavailable start slots into continuous vertical ranges for one hatch paint. */
function mergeUnavailableRanges(
  slots: BookingDaySlot[],
  slotHeightPx: number,
  topFor: (value: Date) => number
): Array<{ top: number; height: number }> {
  const ranges: Array<{ top: number; height: number }> = [];
  for (const slot of slots) {
    if (isSelectable(slot)) continue;
    const top = topFor(slot.start);
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last.top + last.height - top) < 0.5) {
      last.height += slotHeightPx;
    } else {
      ranges.push({ top, height: slotHeightPx });
    }
  }
  return ranges;
}

function minutesFromMidnight(day: Date, value: Date): number {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  return (value.getTime() - midnight.getTime()) / 60_000;
}

function formatNaturalList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatSheetSummary(
  sheetIds: number[],
  sheetNameById: Map<number, string>,
  totalSheetCount: number
): string | null {
  const names = [...new Set(sheetIds)].map((id) => sheetNameById.get(id) ?? String(id));
  if (names.length === 0) return null;
  if (totalSheetCount > 0 && names.length >= totalSheetCount) return 'All sheets';
  if (names.length === 1) return `Sheet ${names[0]}`;
  return `Sheets ${formatNaturalList(names)}`;
}

function formatTimeRange(start: Date, end: Date): string {
  return `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
}

function unavailableDescription(reason: BookingSlotUnavailableReason): string {
  if (reason === 'past') return 'already started';
  if (reason === 'member_conflict') return 'overlaps one of your bookings';
  return 'no sheet free for the full time';
}

export default function BookingDayGrid({
  date,
  slots,
  events,
  sheetNameById,
  totalSheetCount,
  selectedStart,
  onSelect,
  labelledBy,
  describedBy,
}: BookingDayGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const visibleHours = useMemo(() => getVisibleHours(events), [events]);
  const gridStartMinutes = (visibleHours[0] ?? 0) * 60;
  const gridEndMinutes = gridStartMinutes + visibleHours.length * 60;

  const stepMinutes =
    slots.length > 1
      ? Math.max(1, (slots[1]!.start.getTime() - slots[0]!.start.getTime()) / 60_000)
      : DEFAULT_STEP_MINUTES;

  const visibleSlots = useMemo(
    () =>
      slots.filter((slot) => {
        const startMinutes = minutesFromMidnight(date, slot.start);
        const endMinutes = minutesFromMidnight(date, slot.end);
        return startMinutes >= gridStartMinutes && endMinutes <= gridEndMinutes;
      }),
    [slots, date, gridStartMinutes, gridEndMinutes]
  );

  const selectedIndex = selectedStart
    ? visibleSlots.findIndex((slot) => slot.start.getTime() === selectedStart.getTime())
    : -1;
  const firstSelectableIndex = visibleSlots.findIndex(isSelectable);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : firstSelectableIndex;

  const topFor = (value: Date) =>
    (minutesFromMidnight(date, value) - gridStartMinutes) * PX_PER_MINUTE;

  const dayKey = format(date, 'yyyy-MM-dd');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = selectedIndex >= 0 ? selectedIndex : firstSelectableIndex;
    const slot = target >= 0 ? visibleSlots[target] : undefined;
    el.scrollTop = slot ? Math.max(0, topFor(slot.start) - HOUR_HEIGHT) : 0;
    // Re-anchor only when the day changes; scrolling on every selection would fight the user.
  }, [dayKey]);

  const focusSlot = (index: number) => {
    slotRefs.current[index]?.focus();
    onSelect(visibleSlots[index]!);
  };

  const nextSelectable = (from: number, direction: 1 | -1): number | null => {
    for (let i = from + direction; i >= 0 && i < visibleSlots.length; i += direction) {
      if (isSelectable(visibleSlots[i]!)) return i;
    }
    return null;
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = nextSelectable(index, 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = nextSelectable(index, -1);
    } else if (event.key === 'Home') {
      next = nextSelectable(-1, 1);
    } else if (event.key === 'End') {
      next = nextSelectable(visibleSlots.length, -1);
    } else {
      return;
    }
    event.preventDefault();
    if (next != null) focusSlot(next);
  };

  const eventLayout = useMemo(() => computeEventLayout(events), [events]);

  const slotHeightPx = stepMinutes * PX_PER_MINUTE;
  const unavailableRanges = useMemo(
    () =>
      mergeUnavailableRanges(visibleSlots, slotHeightPx, (value) =>
        (minutesFromMidnight(date, value) - gridStartMinutes) * PX_PER_MINUTE
      ),
    [visibleSlots, slotHeightPx, date, gridStartMinutes]
  );
  const unavailableMask = useMemo(() => {
    if (unavailableRanges.length === 0) return undefined;
    return {
      WebkitMaskImage: unavailableRanges.map(() => 'linear-gradient(#000 0 0)').join(', '),
      WebkitMaskSize: unavailableRanges.map((range) => `100% ${range.height}px`).join(', '),
      WebkitMaskPosition: unavailableRanges.map((range) => `0 ${range.top}px`).join(', '),
      WebkitMaskRepeat: 'no-repeat',
      maskImage: unavailableRanges.map(() => 'linear-gradient(#000 0 0)').join(', '),
      maskSize: unavailableRanges.map((range) => `100% ${range.height}px`).join(', '),
      maskPosition: unavailableRanges.map((range) => `0 ${range.top}px`).join(', '),
      maskRepeat: 'no-repeat',
    } as const;
  }, [unavailableRanges]);

  const previewSlot =
    previewIndex != null && previewIndex !== selectedIndex ? visibleSlots[previewIndex] : undefined;
  const selectedSlot = selectedIndex >= 0 ? visibleSlots[selectedIndex] : undefined;

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
              style={{ height: HOUR_HEIGHT }}
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
              style={{ height: HOUR_HEIGHT }}
            >
              <div className="absolute inset-x-0 top-1/2 border-b border-dashed border-gray-100 dark:border-gray-700/60" />
            </div>
          ))}

          {/* One continuous hatch, masked to unavailable ranges so stripes align hour-to-hour. */}
          {unavailableMask && (
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                backgroundImage: UNAVAILABLE_HATCH,
                ...unavailableMask,
              }}
            />
          )}

          <div className="pointer-events-none absolute inset-0 z-20">
            {events.map((event) => {
              const top = Math.max(0, topFor(event.start));
              const bottom = Math.min(
                (gridEndMinutes - gridStartMinutes) * PX_PER_MINUTE,
                topFor(event.end)
              );
              if (bottom <= top) return null;
              const type = getCalendarEventType(event.typeId);
              const Icon = type.icon;
              const { column, numColumns } = eventLayout.get(event.id) ?? {
                column: 0,
                numColumns: 1,
              };
              const widthPct = 100 / numColumns;
              const sheetSummary = formatSheetSummary(
                event.sheetIds,
                sheetNameById,
                totalSheetCount
              );
              return (
                <div
                  key={event.id}
                  className="absolute"
                  style={{
                    top,
                    height: Math.max(bottom - top, 22),
                    left: `calc(${column * widthPct}% + ${EVENT_GUTTER_PX}px)`,
                    width: `calc(${widthPct}% - ${EVENT_GUTTER_PX * 2}px)`,
                  }}
                >
                  <div
                    className={`flex h-full min-w-0 flex-col justify-center overflow-hidden rounded-md border px-2 py-1 text-xs ${type.color}`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate font-medium">{event.title}</span>
                    </div>
                    {sheetSummary && (
                      <span className="truncate opacity-90">
                        {sheetSummary} · {formatTimeRange(event.start, event.end)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0 z-30">
            {previewSlot && (
              <div
                className="absolute inset-x-1 rounded-lg border-2 border-dashed border-primary-teal bg-primary-teal/10"
                style={{
                  top: topFor(previewSlot.start),
                  height:
                    (minutesFromMidnight(date, previewSlot.end) -
                      minutesFromMidnight(date, previewSlot.start)) *
                    PX_PER_MINUTE,
                }}
              />
            )}
            {selectedSlot && (
              <div
                className="absolute inset-x-1 flex items-center justify-center rounded-lg border-2 border-primary-teal-solid bg-primary-teal/15 shadow-sm"
                style={{
                  top: topFor(selectedSlot.start),
                  height:
                    (minutesFromMidnight(date, selectedSlot.end) -
                      minutesFromMidnight(date, selectedSlot.start)) *
                    PX_PER_MINUTE,
                }}
              >
                <span className="max-w-full truncate rounded-full bg-white/95 px-2.5 py-0.5 text-xs font-semibold text-primary-teal-on-tint shadow-sm dark:bg-gray-900/95 dark:text-white">
                  {formatTimeRange(selectedSlot.start, selectedSlot.end)} ·{' '}
                  {selectedSlot.availableSheetIds.length}{' '}
                  {selectedSlot.availableSheetIds.length === 1 ? 'sheet' : 'sheets'} free
                </span>
              </div>
            )}
          </div>

          <div
            role="radiogroup"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className="absolute inset-0 z-40"
          >
            {visibleSlots.map((slot, index) => {
              const selectable = isSelectable(slot);
              const selected = index === selectedIndex;
              const label = selectable
                ? `${formatTimeRange(slot.start, slot.end)}, ${slot.availableSheetIds.length} ${
                    slot.availableSheetIds.length === 1 ? 'sheet' : 'sheets'
                  } free`
                : `${formatTimeRange(slot.start, slot.end)}, unavailable: ${unavailableDescription(
                    slot.unavailableReason ?? 'sheets_busy'
                  )}`;
              return (
                <button
                  key={slot.start.getTime()}
                  ref={(el) => {
                    slotRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  disabled={!selectable}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => onSelect(slot)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  onMouseEnter={() => setPreviewIndex(index)}
                  onMouseLeave={() => setPreviewIndex((current) => (current === index ? null : current))}
                  onFocus={() => setPreviewIndex(index)}
                  onBlur={() => setPreviewIndex((current) => (current === index ? null : current))}
                  className={`absolute inset-x-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-teal ${
                    selectable ? 'cursor-pointer' : 'cursor-not-allowed'
                  }`}
                  style={{ top: topFor(slot.start), height: stepMinutes * PX_PER_MINUTE }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
