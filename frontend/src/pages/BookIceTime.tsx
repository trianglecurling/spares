import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, startOfDay } from 'date-fns';
import Button from '../components/Button';
import { AppPage, AppPageHeader } from '../components/AppPage';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import FormField from '../components/FormField';
import FormSection from '../components/FormSection';
import IceDurationField from '../components/IceDurationField';
import type { BookingDaySlot } from '../components/iceBooking/BookingDayGrid';
import IceBookingConfirmation from '../components/iceBooking/IceBookingConfirmation';
import IceStartTimePicker from '../components/iceBooking/IceStartTimePicker';
import MyIceBookingsList from '../components/iceBooking/MyIceBookingsList';
import {
  ICE_MAX_ADVANCE_DAYS,
  ICE_PURPOSE_OPTIONS,
  overlapsGroupEventRiskWindow,
  type CreatedIceBooking,
  type IcePurpose,
} from '../components/iceBooking/iceBookingShared';
import { useIceDaySchedule } from '../components/iceBooking/useIceDaySchedule';
import { useMyIceBookings } from '../components/iceBooking/useMyIceBookings';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useClubTimeZone } from '../contexts/ClubTimeZoneContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { formatApiError, getApiErrorMessage } from '../utils/api';
import { slotIsOpen, type ShorterDurationSuggestion } from '../utils/bookingStartOccupancy';
import { clubCalendarDate, floatingDateToIso, formatDateInTimeZone } from '../utils/clubTime';
import { ICE_DURATION_DEFAULT_MINUTES } from '../utils/iceDuration';

type BookingKind = 'ice' | 'member_event';

const BOOKING_KIND_OPTIONS: ChoiceOption<BookingKind>[] = [
  {
    value: 'ice',
    label: 'Book ice time',
    description: 'Intended for practice and make-up games. Free for all members.',
  },
  {
    value: 'member_event',
    label: 'Member rental',
    description: 'Reserve the ice for an event with guests.',
  },
];

function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export default function BookIceTime() {
  const { member } = useAuth();
  const isSocialMember = member?.socialMember ?? false;

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

  return <BookIceTimeForm email={member?.email} />;
}

function BookIceTimeForm({ email }: { email?: string | null }) {
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
  const [durationMinutes, setDurationMinutes] = useState(ICE_DURATION_DEFAULT_MINUTES);
  /** Club wall-clock (floating) start time, in ms. */
  const [selectedStartMs, setSelectedStartMs] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<IcePurpose>('practice');
  const [purposeOther, setPurposeOther] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<CreatedIceBooking | null>(null);
  const [cancelingId, setCancelingId] = useState<number | null>(null);

  const myBookings = useMyIceBookings();
  const { schedule, refreshing, error: scheduleError, reload: reloadSchedule } = useIceDaySchedule({
    enabled: bookingKind === 'ice',
    date: dateParam,
    durationMinutes,
    memberBookings: myBookings.upcoming,
  });

  const dateOptions = useMemo<ChoiceOption<string>[]>(() => {
    const today = startOfDay(clubCalendarDate(new Date(), timeZone));
    return Array.from({ length: ICE_MAX_ADVANCE_DAYS + 1 }, (_, offset) => {
      const day = addDays(today, offset);
      const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : format(day, 'EEE MMM d');
      return { value: toDateParam(day), label };
    });
  }, [timeZone]);

  /** The chosen start, while it is still open for the current duration. */
  const selectedSlot = useMemo(() => {
    const slot = schedule?.slots.find((item) => item.start.getTime() === selectedStartMs);
    return slot && slotIsOpen(slot) ? slot : null;
  }, [schedule, selectedStartMs]);

  /** Selects a start, keeping the chosen sheet only if it is free for that start. */
  const selectStart = (slot: BookingDaySlot | null) => {
    setSelectedStartMs(slot ? slot.start.getTime() : null);
    setSheetId((current) =>
      slot && current != null && slot.availableSheetIds.includes(current) ? current : null
    );
  };

  // The slider or a refresh can close the selected start or its sheet; drop what no longer fits.
  useEffect(() => {
    if (selectedStartMs != null) selectStart(selectedSlot);
  }, [selectedSlot, selectedStartMs]);

  const sheetOptions = useMemo<ChoiceOption<number>[]>(() => {
    const available = new Set(selectedSlot?.availableSheetIds ?? []);
    return (schedule?.sheets ?? []).map((sheet) => ({
      value: sheet.id,
      label: `Sheet ${sheet.name}`,
      disabled: !available.has(sheet.id),
      ...(available.has(sheet.id) ? {} : { description: 'In use at this time' }),
    }));
  }, [schedule, selectedSlot]);

  const applyShorterDuration = (suggestion: ShorterDurationSuggestion) => {
    setDurationMinutes(suggestion.durationMinutes);
    setSelectedStartMs(suggestion.start.getTime());
    setSheetId(null);
  };

  const resetForm = () => {
    setConfirmedBooking(null);
    setBookingKind('ice');
    selectStart(null);
    setPurposeOther('');
    reloadSchedule();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bookingKind !== 'ice') return;
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
      const { data } = await api.post<CreatedIceBooking>('/ice-bookings', {
        sheetId,
        start: floatingDateToIso(selectedSlot.start, timeZone),
        durationMinutes,
        purpose,
        purposeOther: purpose === 'other' ? purposeOther.trim() : undefined,
      });
      setConfirmedBooking(data);
      void myBookings.reload();
    } catch (err: unknown) {
      showAlert(getApiErrorMessage(err, 'Could not complete booking'), 'error');
      // Someone may have taken the slot while the form was open.
      reloadSchedule();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async (id: number) => {
    const confirmed = await confirm({
      title: 'Cancel this ice booking?',
      message: 'The sheet will be freed for that time. You can book another slot if you need to.',
      confirmText: 'Cancel booking',
      cancelText: 'Keep booking',
      variant: 'danger',
    });
    if (!confirmed) return;

    setCancelingId(id);
    try {
      await api.delete(`/ice-bookings/${id}`);
      showAlert('Your ice booking was canceled.', 'success');
      await myBookings.reload();
      reloadSchedule();
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Could not cancel booking'), 'error');
    } finally {
      setCancelingId(null);
    }
  };

  if (confirmedBooking) {
    return <IceBookingConfirmation booking={confirmedBooking} email={email} onBookAnother={resetForm} />;
  }

  return (
    <AppPage narrow>
      <AppPageHeader
        title="Book ice time"
        description={
          bookingKind === 'ice' ? (
            <>
              Reserve 15 minutes to 3 hours on one sheet, up to {ICE_MAX_ADVANCE_DAYS} days ahead. Only
              times with a free sheet can be selected. See everything else on the{' '}
              <Link to="/calendar" className="text-primary-teal-link hover:underline">
                club calendar
              </Link>
              .
            </>
          ) : (
            'Choose whether you need free practice ice or a member rental with guests.'
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
                if (typeof next === 'string') setBookingKind(next);
              }}
            />
          </FormField>
        </FormSection>

        {bookingKind === 'member_event' && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-gray-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-gray-200">
            <p>
              Member rentals must be booked through our rentals team. Please find more information on
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
                    if (typeof next !== 'string') return;
                    setDateParam(next);
                    selectStart(null);
                  }}
                />
              </FormField>

              <FormField label="Duration" labelId={durationFieldId} required>
                <IceDurationField
                  value={durationMinutes}
                  onChange={setDurationMinutes}
                  labelledBy={durationFieldId}
                />
              </FormField>

              <FormField label="Start time" labelId={timeFieldId} required>
                <IceStartTimePicker
                  schedule={schedule}
                  refreshing={refreshing}
                  error={scheduleError}
                  onRetry={reloadSchedule}
                  durationMinutes={durationMinutes}
                  selectedStart={selectedSlot?.start ?? null}
                  onSelect={selectStart}
                  onUseShorterDuration={applyShorterDuration}
                  labelledBy={timeFieldId}
                />
              </FormField>
            </FormSection>

            {selectedSlot && overlapsGroupEventRiskWindow(selectedSlot.start, selectedSlot.end) && (
              <div
                role="note"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              >
                While unlikely, it&apos;s possible that a Group Event is later scheduled during the
                time you selected. Your selected sheet may change, or in rare cases, your booking may
                be canceled to accommodate the event. Any changes will be communicated to you via
                email.
              </div>
            )}

            {selectedSlot && (
              <FormSection title="Sheet" description="Only sheets that are free for your whole booking.">
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

            {selectedSlot && sheetId != null && (
              <FormSection title="Purpose">
                <FormField label="What are you using the ice for?" labelId={purposeFieldId} required>
                  <ChoiceInput<IcePurpose>
                    layout="inline"
                    name="ice-purpose"
                    ariaLabelledBy={purposeFieldId}
                    options={ICE_PURPOSE_OPTIONS}
                    value={purpose}
                    onChange={(next) => {
                      if (typeof next === 'string') setPurpose(next);
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
                disabled={submitting || !selectedSlot || sheetId == null}
              >
                {submitting ? 'Booking…' : 'Book now'}
              </Button>
            </div>
          </>
        )}
      </form>

      <MyIceBookingsList
        bookings={myBookings.upcoming}
        loading={myBookings.loading}
        error={myBookings.error}
        onRetry={() => void myBookings.reload()}
        cancelingId={cancelingId}
        onCancel={(id) => void handleCancelBooking(id)}
      />
    </AppPage>
  );
}
