import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { parseISO } from 'date-fns';
import { useClubTimeZone } from '../../contexts/ClubTimeZoneContext';
import api, { formatApiError } from '../../utils/api';
import { instantToFloatingDate } from '../../utils/clubTime';
import { ICE_DURATION_MIN_MINUTES, ICE_DURATION_STEP_MINUTES } from '../../utils/iceDuration';
import {
  refitSlotsToDuration,
  startsWithinDay,
  suggestShorterDuration,
  type ShorterDurationSuggestion,
} from '../../utils/bookingStartOccupancy';
import type { BookingDayEvent, BookingDaySlot } from './BookingDayGrid';
import {
  ICE_EARLIEST_START_HOUR,
  type IceDayAvailability,
  type IceSheet,
  type MyIceBooking,
} from './iceBookingShared';

/** Refetch once the duration slider has been still this long. */
const DURATION_SETTLE_MS = 300;

/** One club-local day of ice, in floating (club wall-clock) dates. */
export type IceDaySchedule = {
  date: Date;
  slotMinutes: number;
  sheets: IceSheet[];
  events: BookingDayEvent[];
  /** Starts members may book on this day, fitted to the duration on the slider. */
  slots: BookingDaySlot[];
  /** Set when the chosen duration fits nowhere ahead but a shorter one does. */
  shorterDuration: ShorterDurationSuggestion | null;
};

function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);
  return settled;
}

/**
 * Availability for `date`, or null until a response for that date arrives.
 * A response for an earlier duration on the same date stays in place while the
 * next one loads, so the day grid does not unmount under the slider.
 */
function useIceDayAvailability(enabled: boolean, date: string, durationMinutes: number) {
  const settledDuration = useSettledValue(durationMinutes, DURATION_SETTLE_MS);
  const [availability, setAvailability] = useState<IceDayAvailability | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setFetching(true);
    setError(null);
    api
      .get<IceDayAvailability>('/ice-bookings/availability', {
        params: { date, durationMinutes: settledDuration },
        signal: controller.signal,
      })
      .then(({ data }) => setAvailability(data))
      .catch((err: unknown) => {
        if (!axios.isCancel(err)) setError(formatApiError(err, 'Could not load ice availability'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false);
      });
    return () => controller.abort();
  }, [enabled, date, settledDuration, reloadKey]);

  const current = availability?.date === date ? availability : null;
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  return { availability: current, refreshing: fetching && current != null, error, reload };
}

/**
 * The day grid's data: what is on the ice and which starts can take a booking of
 * `durationMinutes`.
 *
 * The slider can move before the next availability response. Starts are refitted
 * against the events already on the grid so a shorter booking opens immediately.
 * The server checks the sheet again on submit.
 */
export function useIceDaySchedule({
  enabled,
  date,
  durationMinutes,
  memberBookings,
}: {
  enabled: boolean;
  /** Club-local `YYYY-MM-DD`. */
  date: string;
  durationMinutes: number;
  memberBookings: MyIceBooking[];
}) {
  const timeZone = useClubTimeZone();
  const { availability, refreshing, error, reload } = useIceDayAvailability(
    enabled,
    date,
    durationMinutes
  );

  const fetched = useMemo(() => {
    if (!availability) return null;
    return {
      date: parseISO(availability.date),
      slotMinutes: availability.slotMinutes,
      sheets: availability.sheets,
      events: availability.events.map((event) => ({
        ...event,
        start: instantToFloatingDate(event.start, timeZone),
        end: instantToFloatingDate(event.end, timeZone),
      })),
      slots: availability.slots.map((slot) => ({
        ...slot,
        start: instantToFloatingDate(slot.start, timeZone),
        end: instantToFloatingDate(slot.end, timeZone),
      })),
    };
  }, [availability, timeZone]);

  const memberSpans = useMemo(
    () =>
      memberBookings.map((booking) => ({
        start: instantToFloatingDate(booking.start, timeZone),
        end: instantToFloatingDate(booking.end, timeZone),
      })),
    [memberBookings, timeZone]
  );

  const schedule = useMemo<IceDaySchedule | null>(() => {
    if (!fetched) return null;
    const sheetIds = fetched.sheets.map((sheet) => sheet.id);
    const slots = refitSlotsToDuration(
      startsWithinDay(fetched.slots, fetched.date, ICE_EARLIEST_START_HOUR, durationMinutes),
      durationMinutes,
      sheetIds,
      fetched.events,
      memberSpans
    );
    const shorterDuration = suggestShorterDuration({
      slots,
      durationMinutes,
      sheetIds,
      events: fetched.events,
      minMinutes: ICE_DURATION_MIN_MINUTES,
      stepMinutes: ICE_DURATION_STEP_MINUTES,
      memberBookings: memberSpans,
    });
    return { ...fetched, slots, shorterDuration };
  }, [fetched, durationMinutes, memberSpans]);

  return { schedule, refreshing, error, reload };
}
