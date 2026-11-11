import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiCalendarDays, HiCurrencyDollar, HiMapPin, HiOutlineEnvelope, HiUserGroup } from 'react-icons/hi2';
import { waitlistEntryCountLabel } from './registration/registrationViewEditShared';
import {
  clubCalendarDate,
  formatClubDate,
  formatClubTime,
  formatDateInTimeZone,
  getClubTimeZone,
} from '../utils/clubTime';

export type PublicEventInfoEvent = {
  slug: string;
  timespans: Array<{ id: number; start_dt: string; end_dt: string }>;
  locations: Array<{ location_type: string; sheet_id?: number | null }>;
  feeMinor: number;
  memberFeeMinor?: number | null;
  currency: string;
  registrationStart: string | null;
  registrationCutoff: string | null;
  pointOfContact?: string;
  capacity?: number | null;
  confirmedCount?: number;
  waitlistedCount?: number;
  openSpots?: number | null;
  enableWaitlist?: number;
};

type PublicEventInfoPanelProps = {
  event: PublicEventInfoEvent;
  serverOffsetMs: number;
  /**
   * `featured` is the homepage card: same schedule and location, with the price and register
   * button only while registration is open and a spot can be confirmed.
   */
  variant?: 'page' | 'featured';
};

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_WEEK = 7 * MS_DAY;
const MS_HOUR = 60 * 60 * 1000;

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

type TimespanDisplay =
  | { kind: 'single-day'; date: string; timeRange: string }
  | { kind: 'multi-day'; startDate: string; endDate: string };

function formatTimespanDisplay(startDt: string, endDt: string): TimespanDisplay {
  try {
    const startDay = formatDateInTimeZone(new Date(startDt));
    const endDay = formatDateInTimeZone(new Date(endDt));
    const sameCalendarDay = Boolean(startDay && startDay === endDay);

    if (sameCalendarDay) {
      return {
        kind: 'single-day',
        date: formatClubDate(startDt, LONG_DATE_FORMAT),
        timeRange: `${formatClubTime(startDt, TIME_FORMAT)} to ${formatClubTime(endDt, TIME_FORMAT)}`,
      };
    }

    return {
      kind: 'multi-day',
      startDate: `${formatClubDate(startDt, LONG_DATE_FORMAT)}, ${formatClubTime(startDt, TIME_FORMAT)}`,
      endDate: `${formatClubDate(endDt, LONG_DATE_FORMAT)}, ${formatClubTime(endDt, TIME_FORMAT)}`,
    };
  } catch {
    return { kind: 'single-day', date: startDt, timeRange: '' };
  }
}

function formatFee(feeMinor: number, currency: string): string {
  if (feeMinor <= 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'usd',
  }).format(feeMinor / 100);
}

/** Public display: club default, or Offsite when any location is offsite. */
function formatPublicLocation(locations: PublicEventInfoEvent['locations']): string {
  if (locations?.some((location) => location.location_type === 'offsite')) {
    return 'Offsite';
  }
  return 'Triangle Curling Club';
}

function effectiveRegistrationCutoff(event: PublicEventInfoEvent): string | null {
  return event.registrationCutoff || event.timespans?.[0]?.start_dt || null;
}

/** Next club calendar date (midnight) on or after `fromTimeMs` whose weekday matches `targetDow` (0–6). */
function nextLocalDateWithWeekday(fromTimeMs: number, targetDow: number): Date {
  const date = clubCalendarDate(new Date(fromTimeMs));
  const add = (targetDow - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + add);
  return date;
}

function sameLocalCalendarDate(a: Date, b: Date): boolean {
  return formatDateInTimeZone(a) === formatDateInTimeZone(b);
}

/**
 * When >24h and <1 week: "Registration opens here on \<weekday\> at \<time\>".
 * When ≥1 week: weekday-only if registration falls on the next occurrence of that weekday; else full date/time.
 * Otherwise hours or mm:ss for the "Registration opens in …" pattern.
 */
function getRegistrationOpensCopy(
  registrationStartIso: string,
  serverNowMs: number,
  msUntilOpen: number,
):
  | { kind: 'datePhrase'; phrase: string }
  | { kind: 'hours'; hours: number }
  | { kind: 'mmss'; value: string } {
  if (msUntilOpen <= 0) {
    return { kind: 'mmss', value: '00:00' };
  }
  if (msUntilOpen > MS_DAY) {
    const reg = new Date(registrationStartIso);
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: getClubTimeZone(),
    }).format(reg);
    const timeStr = formatClubTime(reg, { hour: 'numeric', minute: '2-digit' });

    if (msUntilOpen < MS_WEEK) {
      return {
        kind: 'datePhrase',
        phrase: `Registration opens here this ${weekday} at ${timeStr}`,
      };
    }

    const nextSlot = nextLocalDateWithWeekday(serverNowMs, clubCalendarDate(reg).getDay());
    if (sameLocalCalendarDate(nextSlot, reg)) {
      return { kind: 'datePhrase', phrase: `Registration opens here this ${weekday}` };
    }
    const dateOnly = formatClubDate(reg, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return {
      kind: 'datePhrase',
      phrase: `Registration opens here on ${weekday}, ${dateOnly} at ${timeStr}`,
    };
  }
  if (msUntilOpen > MS_HOUR) {
    return { kind: 'hours', hours: Math.floor(msUntilOpen / MS_HOUR) };
  }
  const totalSec = Math.max(0, Math.floor(msUntilOpen / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return {
    kind: 'mmss',
    value: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
  };
}

/** Registration is open and a new registration can be confirmed. */
export function isPublicRegistrationAvailable(event: PublicEventInfoEvent, serverNowMs: number): boolean {
  const registrationStartMs = event.registrationStart ? new Date(event.registrationStart).getTime() : null;
  const cutoffIso = effectiveRegistrationCutoff(event);
  const registrationCutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
  const hasNotOpenedYet = registrationStartMs !== null && serverNowMs < registrationStartMs;
  const isPastCutoff = registrationCutoffMs !== null && serverNowMs > registrationCutoffMs;
  const isRegistrationOpen = !hasNotOpenedYet && !isPastCutoff;
  const spotsRemaining =
    event.openSpots != null
      ? event.openSpots
      : event.capacity != null
        ? Math.max(0, event.capacity - (event.confirmedCount ?? 0) - (event.waitlistedCount ?? 0))
        : null;
  return isRegistrationOpen && !(spotsRemaining !== null && spotsRemaining <= 0);
}

function formatRegistrationClosedAt(iso: string): { date: string; time: string } {
  return {
    date: formatClubDate(iso, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    time: formatClubTime(iso, { hour: 'numeric', minute: '2-digit' }),
  };
}

function DetailRow({ icon: Icon, children }: { icon: typeof HiCalendarDays; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-5 w-5 shrink-0 text-gray-400 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function PublicEventInfoPanel({
  event,
  serverOffsetMs,
  variant = 'page',
}: PublicEventInfoPanelProps) {
  const featured = variant === 'featured';
  const [tick, setTick] = useState(0);
  const serverNowMs = useMemo(() => Date.now() + serverOffsetMs, [serverOffsetMs, tick]);

  useEffect(() => {
    if (!event.registrationStart) return;
    const startMs = new Date(event.registrationStart).getTime();
    if (Date.now() + serverOffsetMs >= startMs) return;
    const id = window.setInterval(() => {
      setTick((value) => value + 1);
      if (Date.now() + serverOffsetMs >= startMs) {
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [event.registrationStart, serverOffsetMs]);

  const registrationStartMs = event.registrationStart ? new Date(event.registrationStart).getTime() : null;
  const cutoffIso = effectiveRegistrationCutoff(event);
  const registrationCutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
  const hasNotOpenedYet = registrationStartMs !== null && serverNowMs < registrationStartMs;
  const isPastCutoff = registrationCutoffMs !== null && serverNowMs > registrationCutoffMs;
  const isRegistrationOpen = !hasNotOpenedYet && !isPastCutoff;
  const msUntilOpen = registrationStartMs !== null ? registrationStartMs - serverNowMs : -1;
  const spotsRemaining =
    event.openSpots != null
      ? event.openSpots
      : event.capacity != null
        ? Math.max(0, event.capacity - (event.confirmedCount ?? 0) - (event.waitlistedCount ?? 0))
        : null;
  const isFull = spotsRemaining !== null && spotsRemaining <= 0;
  const waitlistedCount = event.waitlistedCount ?? 0;
  const opensCopy =
    event.registrationStart && hasNotOpenedYet && msUntilOpen > 0
      ? getRegistrationOpensCopy(event.registrationStart, serverNowMs, msUntilOpen)
      : null;
  const closedAtFormatted =
    cutoffIso && isPastCutoff && !hasNotOpenedYet ? formatRegistrationClosedAt(cutoffIso) : null;
  const showRegister = isPublicRegistrationAvailable(event, serverNowMs);
  const showWaitlist = !featured && isRegistrationOpen && isFull && event.enableWaitlist === 1;
  const showPrefill = !featured && opensCopy?.kind === 'mmss' && hasNotOpenedYet && msUntilOpen > 0;
  const showFooter = Boolean(opensCopy) || Boolean(closedAtFormatted) || showPrefill || showRegister || showWaitlist;
  const showPrice = !featured || isRegistrationOpen;

  return (
    <div className="bg-gray-50 rounded-lg p-6 space-y-4">
      {event.timespans.map((timespan) => {
        const display = formatTimespanDisplay(timespan.start_dt, timespan.end_dt);
        return (
          <DetailRow key={timespan.id} icon={HiCalendarDays}>
            {display.kind === 'single-day' ? (
              <div className="text-gray-900 font-medium">
                <p>{display.date}</p>
                {display.timeRange ? <p className="mt-0.5">{display.timeRange}</p> : null}
              </div>
            ) : (
              <div className="space-y-1 text-gray-900 font-medium">
                <p>
                  <span className="text-gray-600 font-normal">Start:</span> {display.startDate}
                </p>
                <p>
                  <span className="text-gray-600 font-normal">End:</span> {display.endDate}
                </p>
              </div>
            )}
          </DetailRow>
        );
      })}

      <DetailRow icon={HiMapPin}>
        <p className="text-gray-700">{formatPublicLocation(event.locations)}</p>
      </DetailRow>

      {showPrice ? (
        <DetailRow icon={HiCurrencyDollar}>
          <div className="text-gray-700">
            {event.memberFeeMinor != null && event.memberFeeMinor !== event.feeMinor ? (
              <>
                <p>{formatFee(event.feeMinor, event.currency)} general</p>
                <p className="text-sm text-gray-600 mt-0.5">
                  {formatFee(event.memberFeeMinor, event.currency)} for members when logged in
                </p>
              </>
            ) : (
              <p>{formatFee(event.feeMinor, event.currency)}</p>
            )}
          </div>
        </DetailRow>
      ) : null}

      {!featured && event.pointOfContact?.trim() ? (
        <DetailRow icon={HiOutlineEnvelope}>
          <a
            href={`mailto:${event.pointOfContact}`}
            className="text-primary-teal-link hover:underline break-all"
          >
            {event.pointOfContact}
          </a>
        </DetailRow>
      ) : null}

      {!featured && event.capacity != null ? (
        <DetailRow icon={HiUserGroup}>
          <div className="text-gray-700 space-y-1">
            <p>
              {event.confirmedCount ?? 0} of {event.capacity} registered
            </p>
            {isFull ? (
              <p className="text-sm">
                {isRegistrationOpen && event.enableWaitlist === 1
                  ? 'Event is full – waitlist available'
                  : 'Event is full'}
              </p>
            ) : null}
            {!isFull && spotsRemaining !== null ? (
              <p className="text-sm text-gray-600">{spotsRemaining} spots remaining</p>
            ) : null}
            {event.enableWaitlist === 1 && waitlistedCount > 0 ? (
              <p className="text-sm text-gray-600">{waitlistEntryCountLabel(waitlistedCount)}</p>
            ) : null}
          </div>
        </DetailRow>
      ) : null}

      {variant === 'page' || showFooter ? (
        <div className="border-t border-gray-200 pt-4 mt-1 space-y-4">
          {opensCopy && opensCopy.kind === 'datePhrase' ? (
            <p className="text-sm text-gray-700">{opensCopy.phrase}</p>
          ) : null}
          {opensCopy && opensCopy.kind !== 'datePhrase' ? (
            <p className="text-sm text-gray-700">
              Registration opens in{' '}
              <span
                className="font-medium text-gray-900 tabular-nums"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {opensCopy.kind === 'hours'
                  ? `${opensCopy.hours} ${opensCopy.hours === 1 ? 'hour' : 'hours'}`
                  : opensCopy.value}
              </span>
            </p>
          ) : null}

          {showPrefill ? (
            <div className="space-y-2">
              <Link
                to={`/events/${event.slug}/register`}
                className="block w-full text-center px-4 py-3 bg-white border-2 border-primary-teal text-primary-teal-link font-medium rounded-lg hover:bg-teal-50 transition-colors"
              >
                Prefill registration form
              </Link>
              <p className="text-xs text-gray-600">
                You may prefill your registration form. As soon as registration opens, you will be able to
                submit your registration
                {event.feeMinor > 0 ? ' and pay the registration fee' : ''}.
              </p>
            </div>
          ) : null}

          {isPastCutoff && !hasNotOpenedYet && closedAtFormatted ? (
            <p className="text-sm text-gray-700">
              Registration closed on {closedAtFormatted.date} at {closedAtFormatted.time}
            </p>
          ) : null}

          {showRegister ? (
            <Link
              to={`/events/${event.slug}/register`}
              className="block w-full text-center px-4 py-3 bg-primary-teal-solid text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              Register Now
            </Link>
          ) : null}

          {showWaitlist ? (
            <Link
              to={`/events/${event.slug}/register`}
              className="block w-full text-center px-4 py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
            >
              Join Waitlist
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
