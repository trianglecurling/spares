import { Link } from 'react-router-dom';
import Button from '../Button';
import { AppPage, AppPageHeader } from '../AppPage';
import { formatClubDate, formatClubTime } from '../../utils/clubTime';
import { icePurposeLabel, type CreatedIceBooking } from './iceBookingShared';

type IceBookingConfirmationProps = {
  booking: CreatedIceBooking;
  email?: string | null;
  onBookAnother: () => void;
};

function formatWhen(start: string, end: string): string {
  const day = formatClubDate(start, { weekday: 'long', month: 'long', day: 'numeric', year: undefined });
  return `${day} · ${formatClubTime(start)} – ${formatClubTime(end)}`;
}

export default function IceBookingConfirmation({
  booking,
  email,
  onBookAnother,
}: IceBookingConfirmationProps) {
  return (
    <AppPage narrow>
      <div className="app-card">
        <AppPageHeader
          title="You're booked"
          description={`We sent a confirmation email${email ? ` to ${email}` : ''}. Please remember:`}
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
        <dl className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
          <SummaryRow label="When" value={formatWhen(booking.start, booking.end)} />
          <SummaryRow label="Sheet" value={booking.sheetName} />
          <SummaryRow label="Purpose" value={icePurposeLabel(booking)} />
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-primary-teal-solid px-4 py-2 font-medium text-white transition-colors hover:bg-opacity-90"
          >
            Back to dashboard
          </Link>
          <Button type="button" variant="secondary" onClick={onBookAnother}>
            Book another slot
          </Button>
        </div>
      </div>
    </AppPage>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-gray-900 dark:text-gray-100">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
