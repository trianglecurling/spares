import type { CSSProperties } from 'react';
import Button from './Button';
import {
  ICE_DURATION_MAX_MINUTES,
  ICE_DURATION_MIN_MINUTES,
  ICE_DURATION_STEP_MINUTES,
  formatIceDuration,
  isIceDurationMinutes,
  snapIceDurationMinutes,
} from '../utils/iceDuration';

type IceDurationFieldProps = {
  value: number;
  onChange: (minutes: number) => void;
  /** Visible FormField label id. Names the slider. */
  labelledBy: string;
  describedBy?: string;
};

/**
 * Stepped duration for member ice bookings.
 * Large plus and minus buttons change one 15-minute step; the slider jumps across the range.
 * Both are sized for a thumb, which matters more than a list of twelve options on a phone.
 */
export default function IceDurationField({
  value,
  onChange,
  labelledBy,
  describedBy,
}: IceDurationFieldProps) {
  const atMin = value <= ICE_DURATION_MIN_MINUTES;
  const atMax = value >= ICE_DURATION_MAX_MINUTES;
  const span = ICE_DURATION_MAX_MINUTES - ICE_DURATION_MIN_MINUTES;
  const pct = span === 0 ? 0 : ((value - ICE_DURATION_MIN_MINUTES) / span) * 100;
  const label = formatIceDuration(value);

  const commit = (minutes: number) => {
    const next = snapIceDurationMinutes(minutes);
    if (next !== value) onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          className="h-14 w-14 shrink-0 px-0 text-2xl leading-none touch-manipulation"
          aria-label="Shorten by 15 minutes"
          title={atMin ? '15 minutes is the shortest booking' : 'Shorten by 15 minutes'}
          disabled={atMin}
          onClick={() => commit(value - ICE_DURATION_STEP_MINUTES)}
        >
          <span aria-hidden="true">−</span>
        </Button>
        <p
          className="min-w-0 flex-1 text-center text-xl font-semibold leading-tight text-gray-900 dark:text-gray-100"
          aria-hidden="true"
        >
          {label}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="h-14 w-14 shrink-0 px-0 text-2xl leading-none touch-manipulation"
          aria-label="Lengthen by 15 minutes"
          title={atMax ? '3 hours is the longest booking' : 'Lengthen by 15 minutes'}
          disabled={atMax}
          onClick={() => commit(value + ICE_DURATION_STEP_MINUTES)}
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>
      <input
        type="range"
        className="app-range touch-manipulation"
        min={ICE_DURATION_MIN_MINUTES}
        max={ICE_DURATION_MAX_MINUTES}
        step={ICE_DURATION_STEP_MINUTES}
        value={value}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-valuetext={label}
        style={{ '--ice-duration-pct': `${pct}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (isIceDurationMinutes(next)) onChange(next);
        }}
      />
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400" aria-hidden="true">
        <span>{formatIceDuration(ICE_DURATION_MIN_MINUTES)}</span>
        <span>{formatIceDuration(ICE_DURATION_MAX_MINUTES)}</span>
      </div>
    </div>
  );
}
