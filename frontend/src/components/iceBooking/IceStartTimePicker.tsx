import { format } from 'date-fns';
import Button from '../Button';
import InlineStateMessage from '../InlineStateMessage';
import { ICE_DURATION_MIN_MINUTES, formatIceDuration } from '../../utils/iceDuration';
import { slotIsOpen, type ShorterDurationSuggestion } from '../../utils/bookingStartOccupancy';
import BookingDayGrid, { type BookingDaySlot } from './BookingDayGrid';
import type { IceDaySchedule } from './useIceDaySchedule';

type IceStartTimePickerProps = {
  /** Null until the selected day has loaded. */
  schedule: IceDaySchedule | null;
  /** A newer duration is loading behind the grid. */
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
  durationMinutes: number;
  selectedStart: Date | null;
  onSelect: (slot: BookingDaySlot) => void;
  onUseShorterDuration: (suggestion: ShorterDurationSuggestion) => void;
  /** Id of the visible field label. */
  labelledBy: string;
};

export default function IceStartTimePicker({
  schedule,
  refreshing,
  error,
  onRetry,
  durationMinutes,
  selectedStart,
  onSelect,
  onUseShorterDuration,
  labelledBy,
}: IceStartTimePickerProps) {
  const retryButton = (
    <Button type="button" variant="secondary" onClick={onRetry}>
      Try again
    </Button>
  );

  if (!schedule) {
    return error ? (
      <InlineStateMessage
        tone="error"
        title="Could not load ice availability"
        description={error}
        action={retryButton}
      />
    ) : (
      <InlineStateMessage title="Loading the day's schedule..." />
    );
  }

  if (schedule.sheets.length === 0) {
    return (
      <InlineStateMessage
        tone="warning"
        title="No active sheets are configured."
        description="Ice cannot be booked until an admin sets up the sheets."
      />
    );
  }

  const { shorterDuration } = schedule;
  const hasOpenSlots = schedule.slots.some(slotIsOpen);

  return (
    <div className="space-y-3" aria-busy={refreshing}>
      <BookingDayGrid
        date={schedule.date}
        stepMinutes={schedule.slotMinutes}
        slots={schedule.slots}
        events={schedule.events}
        sheets={schedule.sheets}
        selectedStart={selectedStart}
        onSelect={onSelect}
        labelledBy={labelledBy}
      />
      {error && (
        <InlineStateMessage
          tone="error"
          title="Could not refresh ice availability"
          description={error}
          action={retryButton}
        />
      )}
      {shorterDuration && (
        <InlineStateMessage
          tone="warning"
          title={`${formatIceDuration(durationMinutes)} doesn't fit on the open ice`}
          description={`${formatIceDuration(shorterDuration.durationMinutes)} fits at ${format(shorterDuration.start, 'h:mm a')}${
            shorterDuration.beforeTitle ? `, before ${shorterDuration.beforeTitle}` : ''
          }.`}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => onUseShorterDuration(shorterDuration)}
            >
              Use {formatIceDuration(shorterDuration.durationMinutes)}
            </Button>
          }
        />
      )}
      {!hasOpenSlots && !shorterDuration && (
        <InlineStateMessage
          title="No open ice on this day"
          description={
            durationMinutes > ICE_DURATION_MIN_MINUTES
              ? 'Try a shorter booking or a different day.'
              : 'Try a different day.'
          }
        />
      )}
    </div>
  );
}
