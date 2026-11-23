import type { ChoiceOption } from '../ChoiceInput';
import type { BookingSlotUnavailableReason } from '../../utils/bookingStartOccupancy';

/** Members may book today through this many days ahead; mirrors the server window. */
export const ICE_MAX_ADVANCE_DAYS = 7;

/** Members may not start a booking before this club-local hour. */
export const ICE_EARLIEST_START_HOUR = 6;

export type IcePurpose = 'practice' | 'makeup_game' | 'other';

/** Legacy bookings may still carry retired guest purposes; they are read-only now. */
type StoredIcePurpose = IcePurpose | 'guests_new' | 'guests_experienced';

export type IceSheet = { id: number; name: string };

/** `GET /ice-bookings` row. */
export type MyIceBooking = {
  id: number;
  sheetId: number;
  sheetName: string;
  start: string;
  end: string;
  purpose: StoredIcePurpose;
  purposeOther?: string;
  guestNames?: string;
};

/** `POST /ice-bookings` response. */
export type CreatedIceBooking = {
  id: number;
  sheetName: string;
  start: string;
  end: string;
  purpose: IcePurpose;
  purposeOther?: string;
};

/** `GET /ice-bookings/availability` response. Times are ISO instants. */
export type IceDayAvailability = {
  date: string;
  durationMinutes: number;
  slotMinutes: number;
  sheets: IceSheet[];
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
    unavailableReason?: BookingSlotUnavailableReason;
  }>;
};

export const ICE_PURPOSE_OPTIONS: ChoiceOption<IcePurpose>[] = [
  { value: 'practice', label: 'Practice' },
  { value: 'makeup_game', label: 'Make-up game' },
  { value: 'other', label: 'Other' },
];

const STORED_PURPOSE_LABELS: Record<StoredIcePurpose, string> = {
  practice: 'Practice',
  makeup_game: 'Make-up game',
  other: 'Other',
  guests_new: 'Bringing guests: new curlers',
  guests_experienced: 'Bringing guests: experienced',
};

export function icePurposeLabel(booking: {
  purpose: StoredIcePurpose;
  purposeOther?: string;
  guestNames?: string;
}): string {
  const base = STORED_PURPOSE_LABELS[booking.purpose] ?? booking.purpose;
  if (booking.purpose === 'other' && booking.purposeOther) return `${base}: ${booking.purposeOther}`;
  if (booking.guestNames) return `${base} (${booking.guestNames})`;
  return base;
}

/**
 * Daytime window, in minutes from midnight, when a later Group Event might bump a
 * member booking: weekdays 10am–4pm, Saturdays 2:30pm–5pm.
 */
function groupEventRiskWindow(weekday: number): [number, number] | null {
  if (weekday >= 1 && weekday <= 5) return [10 * 60, 16 * 60];
  if (weekday === 6) return [14 * 60 + 30, 17 * 60];
  return null;
}

/** `start` and `end` are club wall-clock (floating) dates on the same day. */
export function overlapsGroupEventRiskWindow(start: Date, end: Date): boolean {
  const window = groupEventRiskWindow(start.getDay());
  if (!window) return false;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  // A booking that runs to midnight ends at 0 minutes.
  const bookingEnd = endMinutes <= startMinutes ? 24 * 60 : endMinutes;
  return startMinutes < window[1] && bookingEnd > window[0];
}
