/** Member ice bookings: 15 minutes through 3 hours, in 15-minute steps. */

export const ICE_DURATION_MIN_MINUTES = 15;
export const ICE_DURATION_MAX_MINUTES = 180;
export const ICE_DURATION_STEP_MINUTES = 15;
export const ICE_DURATION_DEFAULT_MINUTES = 120;

export const ICE_DURATION_INVALID_MESSAGE =
  'Duration must be between 15 minutes and 3 hours, in 15-minute steps';

export function isIceDurationMinutes(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= ICE_DURATION_MIN_MINUTES &&
    value <= ICE_DURATION_MAX_MINUTES &&
    value % ICE_DURATION_STEP_MINUTES === 0
  );
}

/** Nearest allowed duration. Non-finite input falls back to 2 hours. */
export function snapIceDurationMinutes(value: number): number {
  if (!Number.isFinite(value)) return ICE_DURATION_DEFAULT_MINUTES;
  const stepped = Math.round(value / ICE_DURATION_STEP_MINUTES) * ICE_DURATION_STEP_MINUTES;
  return Math.min(ICE_DURATION_MAX_MINUTES, Math.max(ICE_DURATION_MIN_MINUTES, stepped));
}

/** Sentence-case label such as "45 minutes" or "1 hour 15 minutes". */
export function formatIceDuration(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes - hours * 60;
  if (hours <= 0) return remainder === 1 ? '1 minute' : `${remainder} minutes`;
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  if (remainder === 0) return hourLabel;
  const minuteLabel = remainder === 1 ? '1 minute' : `${remainder} minutes`;
  return `${hourLabel} ${minuteLabel}`;
}
