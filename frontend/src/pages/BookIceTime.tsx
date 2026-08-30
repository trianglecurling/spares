import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { addDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import Button from '../components/Button';
import { AppPage, AppPageHeader } from '../components/AppPage';
import BookingDayGrid, { type BookingDaySlot } from '../components/BookingDayGrid';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import FormField from '../components/FormField';
import FormSection from '../components/FormSection';
import InlineStateMessage from '../components/InlineStateMessage';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { formatApiError } from '../utils/api';
import {
  clubCalendarDate,
  formatDateInTimeZone,
  formatClubDate,
  formatClubTime,
  floatingDateToIso,
  instantToFloatingDate,
} from '../utils/clubTime';
import { useClubTimeZone } from '../contexts/ClubTimeZoneContext';

/** Members may book today through this many days ahead; mirrors the server window. */
const MAX_ADVANCE_DAYS = 7;

type BookingKind = 'ice' | 'member_event';

type Purpose = 'practice' | 'makeup_game' | 'other';

/** Legacy bookings may still carry retired guest purposes; they are read-only now. */
type StoredPurpose = Purpose | 'guests_new' | 'guests_experienced';

type DurationHours = 1 | 2;

type MyIceBooking = {
  id: number;
  sheetId: number;
  sheetName: string;
  start: string;
  end: string;
  purpose: StoredPurpose;
  purposeOther?: string;
  guestNames?: string;
};

type AvailabilityResponse = {
  date: string;
  durationHours: DurationHours;
  slotMinutes: number;
  sheets: Array<{ id: number; name: string }>;
  events: Array<{
    id: string;
    typeId: string;
    title: string;
    start: string;
    end: string;
    sheetIds: number[];
  }>;
  slots: Array<{
    start: string;
    end: string;
    availableSheetIds: number[];
    unavailableReason?: 'past' | 'member_conflict' | 'sheets_busy';
  }>;
};

const BOOKING_KIND_OPTIONS: ChoiceOption<BookingKind>[] = [
  {
    value: 'ice',
    label: 'Book ice time',
    description: 'Intended for practice and make-up games. Free for all members.',
  },
  {
    value: 'member_event',
    label: 'Member event',
    description: 'Reserve the ice for an event with guests.',
  },
];

const PURPOSE_OPTIONS: Array<{ value: Purpose; label: string }> = [
  { value: 'practice', label: 'Practice' },
  { value: 'makeup_game', label: 'Make-up game' },
  { value: 'other', label: 'Other' },
];

const DURATION_OPTIONS: ChoiceOption<DurationHours>[] = [
  { value: 1, label: '1 hour' },
  { value: 2, label: '2 hours' },
];

const STORED_PURPOSE_LABELS: Record<StoredPurpose, string> = {
  practice: 'Practice',
  makeup_game: 'Make-up game',
  other: 'Other',
  guests_new: 'Bringing guests: new curlers',
  guests_experienced: 'Bringing guests: experienced',
};

function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function bookingPurposeLabel(booking: MyIceBooking): string {
  const base = STORED_PURPOSE_LABELS[booking.purpose] ?? booking.purpose;
  if (booking.purpose === 'other' && booking.purposeOther) return `${base}: ${booking.purposeOther}`;
  if (booking.guestNames) return `${base} (${booking.guestNames})`;
  return base;
}

function formatWhen(start: Date, end: Date): string {
  return `${formatClubDate(start, { weekday: 'long', month: 'long', day: 'numeric', year: undefined })} · ${formatClubTime(start)} – ${formatClubTime(end)}`;
}

/** Minutes from local midnight. */
function minutesOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

/**
 * Daytime windows when a later Group Event might bump a member booking:
 * weekdays 10am–4pm, Saturdays 2:30pm–5pm.
 */
function bookingOverlapsGroupEventRiskWindow(start: Date, end: Date): boolean {
  const day = start.getDay(); // 0 Sun … 6 Sat
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  if (day >= 1 && day <= 5) {
    windowStart = 10 * 60;
    windowEnd = 16 * 60;
  } else if (day === 6) {
    windowStart = 14 * 60 + 30;
    windowEnd = 17 * 60;
  }
  if (windowStart == null || windowEnd == null) return false;
  const bookingStart = minutesOfDay(start);
  const bookingEnd = minutesOfDay(end);
  // Same-day bookings only; end-before-start would mean midnight crossover (not used for ice).
  if (bookingEnd <= bookingStart) return bookingStart < windowEnd && windowStart < 24 * 60;
  return bookingStart < windowEnd && bookingEnd > windowStart;
}

export default function BookIceTime() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const timeZone = useClubTimeZone();

  const bookingKindFieldId = useId();
  const dateFieldId = useId();
  const durationFieldId = useId();
  const timeFieldId = useId();
  const sheetFieldId = useId();
  const purposeFieldId = useId();
  const purposeOtherId = useId();

  const [bookingKind, setBookingKind] = useState<BookingKind | null>(null);
  const [dateParam, setDateParam] = useState(() => formatDateInTimeZone(new Date()) ?? toDateParam(new Date()));
  const [durationHours, setDurationHours] = useState<DurationHours>(1);
  const [selectedStartIso, setSelectedStartIso] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<Purpose>('practice');
  const [purposeOther, setPurposeOther] = useState('');

  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityReloadKey, setAvailabilityReloadKey] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [confirmedSummary, setConfirmedSummary] = useState<{
    sheetName: string;
    start: string;
    end: string;
    purpose: Purpose;
    purposeOther?: string;
  } | null>(null);

  const [iceBookings, setIceBookings] = useState<MyIceBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<number | null>(null);

  const isSocialMember = member?.socialMember ?? false;
  const selectedDate = useMemo(() => parseISO(dateParam), [dateParam]);

  const dateOptions = useMemo<ChoiceOption<string>[]>(() => {
    const today = startOfDay(clubCalendarDate(new Date(), timeZone));
    return Array.from({ length: MAX_ADVANCE_DAYS + 1 }, (_, offset) => {
      const day = addDays(today, offset);
      const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : format(day, 'EEE MMM d');
      return { value: toDateParam(day), label };
    });
  }, [timeZone]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const { data } = await api.get<MyIceBooking[]>('/ice-bookings');
      setIceBookings(data ?? []);
    } catch {
      setIceBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSocialMember) return;
    void loadBookings();
  }, [isSocialMember, loadBookings]);

  useEffect(() => {
    if (isSocialMember || bookingKind !== 'ice') return;
    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    api
      .get<AvailabilityResponse>('/ice-bookings/availability', {
        params: { date: dateParam, durationHours },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setAvailability(data);
        // Keep the chosen time across a duration change when it still fits.
        setSelectedStartIso((current) => {
          if (!current) return null;
          const match = data.slots.find((slot) => slot.start === current);
          return match && !match.unavailableReason && match.availableSheetIds.length > 0
            ? current
            : null;
        });
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return;
        setAvailability(null);
        setAvailabilityError(formatApiError(err, 'Could not load ice availability'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });
    return () => controller.abort();
  }, [bookingKind, dateParam, durationHours, isSocialMember, availabilityReloadKey]);

  const sheets = availability?.sheets ?? [];
  const sheetNameById = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.id, sheet.name])),
    [sheets]
  );

  const slots = useMemo<BookingDaySlot[]>(
    () =>
      (availability?.slots ?? []).map((slot) => ({
        start: instantToFloatingDate(slot.start, timeZone),
        end: instantToFloatingDate(slot.end, timeZone),
        availableSheetIds: slot.availableSheetIds,
        unavailableReason: slot.unavailableReason,
      })),
    [availability, timeZone]
  );

  const events = useMemo(
    () =>
      (availability?.events ?? []).map((event) => ({
        ...event,
        start: instantToFloatingDate(event.start, timeZone),
        end: instantToFloatingDate(event.end, timeZone),
      })),
    [availability, timeZone]
  );

  const selectedSlot = useMemo(
    () => slots.find((slot) => floatingDateToIso(slot.start, timeZone) === selectedStartIso) ?? null,
    [slots, selectedStartIso, timeZone]
  );
  // While availability is refetching, the slot in hand may not match the new duration yet.
  const confirmedSlot = availabilityLoading || availabilityError ? null : selectedSlot;

  const hasOpenSlots = slots.some(
    (slot) => !slot.unavailableReason && slot.availableSheetIds.length > 0
  );

  const sheetOptions = useMemo<ChoiceOption<number>[]>(() => {
    const available = new Set(selectedSlot?.availableSheetIds ?? []);
    return sheets.map((sheet) => ({
      value: sheet.id,
      label: `Sheet ${sheet.name}`,
      disabled: !available.has(sheet.id),
      ...(available.has(sheet.id) ? {} : { description: 'In use at this time' }),
    }));
  }, [sheets, selectedSlot]);

  const handleSelectSlot = (slot: BookingDaySlot) => {
    setSelectedStartIso(floatingDateToIso(slot.start, timeZone));
    setSheetId((current) => (current != null && slot.availableSheetIds.includes(current) ? current : null));
  };

  const upcomingBookings = useMemo(
    () =>
      iceBookings
        .filter((b) => new Date(b.end).getTime() > Date.now())
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [iceBookings]
  );

  const resetForm = () => {
    setConfirmedSummary(null);
    setBookingKind('ice');
    setSelectedStartIso(null);
    setSheetId(null);
    setPurposeOther('');
    setAvailabilityReloadKey((key) => key + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSocialMember || bookingKind !== 'ice') return;

    if (!selectedSlot) {
      showAlert('Choose a start time on the calendar.', 'warning');
      return;
    }
    if (sheetId == null) {
      showAlert('Choose an available sheet.', 'warning');
      return;
    }
    if (purpose === 'other' && !purposeOther.trim()) {
      showAlert('Please describe your purpose.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<{
        id: number;
        sheetName: string;
        start: string;
        end: string;
        purpose: Purpose;
        purposeOther?: string;
      }>('/ice-bookings', {
        sheetId,
        start: floatingDateToIso(selectedSlot.start, timeZone),
        durationHours,
        purpose,
        purposeOther: purpose === 'other' ? purposeOther.trim() : undefined,
      });
      setConfirmedSummary({
        sheetName: data.sheetName,
        start: data.start,
        end: data.end,
        purpose: data.purpose,
        purposeOther: data.purposeOther,
      });
      void loadBookings();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      showAlert(msg || formatApiError(err, 'Could not complete booking'), 'error');
      // Someone may have taken the slot while the form was open.
      setAvailabilityReloadKey((key) => key + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (id: number) => {
    const go = await confirm({
      title: 'Cancel this ice booking?',
      message: 'The sheet will be freed for that time. You can book another slot if you need to.',
      confirmText: 'Cancel booking',
      cancelText: 'Keep booking',
      variant: 'danger',
    });
    if (!go) return;

    setCancelingId(id);
    try {
      await api.delete(`/ice-bookings/${id}`);
      showAlert('Your ice booking was canceled.', 'success');
      await loadBookings();
      setAvailabilityReloadKey((key) => key + 1);
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Could not cancel booking'), 'error');
    } finally {
      setCancelingId(null);
    }
  };

  if (isSocialMember) {
    return (
      <AppPage narrow>
        <AppPageHeader title="Book ice time" />
        <div className="app-card">
          <p className="app-page-subtitle">
            Social memberships do not include ice booking. Upgrade to a full membership to reserve
            practice ice.
          </p>
          <Link
            to="/calendar"
            className="mt-5 inline-flex text-sm font-medium text-primary-teal-link hover:underline"
          >
            View full calendar
          </Link>
        </div>
      </AppPage>
    );
  }

  if (confirmedSummary) {
    const purposeLabel =
      PURPOSE_OPTIONS.find((p) => p.value === confirmedSummary.purpose)?.label ??
      confirmedSummary.purpose;
    return (
      <AppPage narrow>
        <div className="app-card">
          <AppPageHeader
            title="You're booked"
            description={`We sent a confirmation email${member?.email ? ` to ${member.email}` : ''}. Please remember:`}
          />
          <ul className="mb-6 list-disc space-y-2 pl-5 text-gray-800 dark:text-gray-200">
            <li>At least one other person must be on premises with you. You may not use the ice alone.</li>
            <li>Do not enter the ice maintenance room without proper training.</li>
            <li>
              Bringing guests? Maximum of 2 (see the full{' '}
              <Link
                to="/go/guests"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-teal-link hover:underline"
              >
                Guest Policy
              </Link>
              ). Guests must sign a{' '}
              <Link
                to="/go/waiver"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-teal-link hover:underline"
              >
                waiver
              </Link>{' '}
              before entering the ice shed.
            </li>
            <li>Clean up properly after you are done (sweep and cover hacks, mop sheet, return stones).</li>
          </ul>
          <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
            <p>
              <span className="font-medium text-gray-900 dark:text-gray-100">When: </span>
              {formatWhen(new Date(confirmedSummary.start), new Date(confirmedSummary.end))}
            </p>
            <p>
              <span className="font-medium text-gray-900 dark:text-gray-100">Sheet: </span>
              {confirmedSummary.sheetName}
            </p>
            <p>
              <span className="font-medium text-gray-900 dark:text-gray-100">Purpose: </span>
              {purposeLabel}
              {confirmedSummary.purpose === 'other' && confirmedSummary.purposeOther
                ? ` — ${confirmedSummary.purposeOther}`
                : ''}
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary-teal-solid px-4 py-2 font-medium text-white transition-colors hover:bg-opacity-90"
            >
              Back to dashboard
            </Link>
            <Button type="button" variant="secondary" onClick={resetForm}>
              Book another slot
            </Button>
          </div>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage narrow>
      <AppPageHeader
        title="Book ice time"
        description={
          bookingKind === 'ice' ? (
            <>
              Reserve 1 or 2 hours on one sheet, up to {MAX_ADVANCE_DAYS} days ahead. Only times with
              a free sheet can be selected. See everything else on the{' '}
              <Link to="/calendar" className="text-primary-teal-link hover:underline">
                club calendar
              </Link>
              .
            </>
          ) : (
            'Choose whether you need free practice ice or a member event with guests.'
          )
        }
      />

      <form onSubmit={handleSubmit} className="app-card space-y-8 p-6">
        <FormSection>
          <FormField
            label="Would you like to book ice time or a member rental?"
            labelId={bookingKindFieldId}
            required
          >
            <ChoiceInput<BookingKind>
              layout="block"
              name="booking-kind"
              ariaLabelledBy={bookingKindFieldId}
              options={BOOKING_KIND_OPTIONS}
              value={bookingKind}
              onChange={(next) => {
                if (next === 'ice' || next === 'member_event') setBookingKind(next);
              }}
            />
          </FormField>
        </FormSection>

        {bookingKind === 'member_event' && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-gray-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-gray-200">
            <p>
              Member events must be booked through our rentals team. Please find more information on
              our{' '}
              <Link
                to="/articles/team-building-group-events"
                className="font-medium text-primary-teal-link hover:underline"
              >
                Group Events
              </Link>{' '}
              page, and contact{' '}
              <a
                href="mailto:rentals@trianglecurling.com"
                className="font-medium text-primary-teal-link hover:underline"
              >
                rentals@trianglecurling.com
              </a>{' '}
              to book your event.
            </p>
          </div>
        )}

        {bookingKind === 'ice' && (
          <>
            <FormSection
              title="When"
              description="Pick a day, then choose a start time on the calendar."
            >
              <FormField label="Date" labelId={dateFieldId} required>
                <ChoiceInput<string>
                  layout="inline"
                  name="ice-date"
                  ariaLabelledBy={dateFieldId}
                  options={dateOptions}
                  value={dateParam}
                  onChange={(next) => {
                    if (typeof next === 'string') {
                      setDateParam(next);
                      setSelectedStartIso(null);
                      setSheetId(null);
                    }
                  }}
                />
              </FormField>

              <FormField label="Duration" labelId={durationFieldId} required>
                <ChoiceInput<DurationHours>
                  layout="inline"
                  name="ice-duration"
                  ariaLabelledBy={durationFieldId}
                  options={DURATION_OPTIONS}
                  value={durationHours}
                  onChange={(next) => {
                    if (next === 1 || next === 2) setDurationHours(next);
                  }}
                />
              </FormField>

              <FormField label="Start time" labelId={timeFieldId} required>
                {availabilityLoading ? (
                  <InlineStateMessage title="Loading the day's schedule..." />
                ) : availabilityError ? (
                  <InlineStateMessage
                    tone="error"
                    title="Could not load ice availability"
                    description={availabilityError}
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setAvailabilityReloadKey((key) => key + 1)}
                      >
                        Try again
                      </Button>
                    }
                  />
                ) : sheets.length === 0 ? (
                  <InlineStateMessage
                    tone="warning"
                    title="No active sheets are configured."
                    description="Ice cannot be booked until an admin sets up the sheets."
                  />
                ) : (
                  <div className="space-y-3">
                    <BookingDayGrid
                      date={selectedDate}
                      slots={slots}
                      events={events}
                      sheetNameById={sheetNameById}
                      totalSheetCount={sheets.length}
                      selectedStart={selectedSlot?.start ?? null}
                      onSelect={handleSelectSlot}
                      labelledBy={timeFieldId}
                    />
                    {!hasOpenSlots && (
                      <InlineStateMessage
                        title="No open ice on this day"
                        description={
                          durationHours === 2
                            ? 'Try a 1-hour booking or a different day.'
                            : 'Try a different day.'
                        }
                      />
                    )}
                  </div>
                )}
              </FormField>
            </FormSection>

            {confirmedSlot &&
              bookingOverlapsGroupEventRiskWindow(confirmedSlot.start, confirmedSlot.end) && (
                <div
                  role="note"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  While unlikely, it&apos;s possible that a Group Event is later scheduled during the
                  time you selected. Your selected sheet may change, or in rare cases, your booking
                  may be canceled to accommodate the event. Any changes will be communicated to you
                  via email.
                </div>
              )}

            {confirmedSlot && (
              <FormSection
                title="Sheet"
                description="Only sheets that are free for your whole booking."
              >
                <FormField label="Sheet" labelId={sheetFieldId} required>
                  <ChoiceInput<number>
                    layout="inline"
                    name="ice-sheet"
                    ariaLabelledBy={sheetFieldId}
                    options={sheetOptions}
                    value={sheetId}
                    onChange={(next) => {
                      if (typeof next === 'number') setSheetId(next);
                    }}
                  />
                </FormField>
              </FormSection>
            )}

            {confirmedSlot && sheetId != null && (
              <FormSection title="Purpose">
                <FormField
                  label="What are you using the ice for?"
                  labelId={purposeFieldId}
                  required
                >
                  <ChoiceInput<Purpose>
                    layout="inline"
                    name="ice-purpose"
                    ariaLabelledBy={purposeFieldId}
                    options={PURPOSE_OPTIONS}
                    value={purpose}
                    onChange={(next) => {
                      if (typeof next === 'string') setPurpose(next as Purpose);
                    }}
                  />
                </FormField>
                {purpose === 'other' && (
                  <FormField label="Describe your purpose" htmlFor={purposeOtherId} required>
                    <textarea
                      id={purposeOtherId}
                      value={purposeOther}
                      onChange={(e) => setPurposeOther(e.target.value)}
                      rows={3}
                      placeholder="Briefly describe what you're using the ice for"
                      className="app-input"
                      required
                    />
                  </FormField>
                )}
              </FormSection>
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !confirmedSlot || sheetId == null}
              >
                {submitting ? 'Booking…' : 'Book now'}
              </Button>
            </div>
          </>
        )}
      </form>

      <section aria-labelledby="upcoming-ice-bookings-heading">
        <h2 id="upcoming-ice-bookings-heading" className="app-section-title mb-4">
          My upcoming ice bookings
        </h2>
        {bookingsLoading ? (
          <div className="app-card">
            <InlineStateMessage title="Loading your bookings..." />
          </div>
        ) : upcomingBookings.length === 0 ? (
          <div className="app-card">
            <InlineStateMessage title="You have no upcoming ice bookings." />
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((b) => {
              const start = instantToFloatingDate(b.start, timeZone);
              const end = instantToFloatingDate(b.end, timeZone);
              return (
                <div
                  key={b.id}
                  className="app-card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-900 dark:text-gray-100">
                    <span className="font-medium">
                      {isSameDay(start, clubCalendarDate(new Date(), timeZone))
                        ? 'Today'
                        : format(start, 'EEE, MMM d')}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">Sheet {b.sheetName}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {bookingPurposeLabel(b)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={cancelingId === b.id}
                    onClick={() => void handleCancelBooking(b.id)}
                  >
                    {cancelingId === b.id ? 'Canceling…' : 'Cancel booking'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppPage>
  );
}
