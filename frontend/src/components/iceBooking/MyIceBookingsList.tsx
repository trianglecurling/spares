import { format, isSameDay } from 'date-fns';
import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import { useClubTimeZone } from '../../contexts/ClubTimeZoneContext';
import { clubCalendarDate, instantToFloatingDate } from '../../utils/clubTime';
import { icePurposeLabel, type MyIceBooking } from './iceBookingShared';

type MyIceBookingsListProps = {
  bookings: MyIceBooking[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  cancelingId: number | null;
  onCancel: (id: number) => void;
};

export default function MyIceBookingsList({
  bookings,
  loading,
  error,
  onRetry,
  cancelingId,
  onCancel,
}: MyIceBookingsListProps) {
  const timeZone = useClubTimeZone();
  const today = clubCalendarDate(new Date(), timeZone);

  return (
    <section aria-labelledby="upcoming-ice-bookings-heading">
      <h2 id="upcoming-ice-bookings-heading" className="app-section-title mb-4">
        My upcoming ice bookings
      </h2>
      {error ? (
        <div className="app-card">
          <InlineStateMessage
            tone="error"
            title="Could not load your ice bookings"
            description={error}
            action={
              <Button type="button" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : loading || bookings.length === 0 ? (
        <div className="app-card">
          <InlineStateMessage
            title={loading ? 'Loading your bookings...' : 'You have no upcoming ice bookings.'}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const start = instantToFloatingDate(booking.start, timeZone);
            const end = instantToFloatingDate(booking.end, timeZone);
            const canceling = cancelingId === booking.id;
            return (
              <div
                key={booking.id}
                className="app-card flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-900 dark:text-gray-100">
                  <span className="font-medium">
                    {isSameDay(start, today) ? 'Today' : format(start, 'EEE, MMM d')}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">Sheet {booking.sheetName}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {icePurposeLabel(booking)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  disabled={canceling}
                  onClick={() => onCancel(booking.id)}
                >
                  {canceling ? 'Canceling…' : 'Cancel booking'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
