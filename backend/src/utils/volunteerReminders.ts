export const VOLUNTEER_REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;
export const VOLUNTEER_REMINDER_MIN_SIGNUP_LEAD_MS = 72 * 60 * 60 * 1000;

function toEpochMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/** Reminder emails only if the volunteer signed up more than 72 hours before shift start. */
export function volunteerSignupQualifiesForReminder(input: {
  signedUpAt: string | Date | null | undefined;
  shiftStartDt: string | Date | null | undefined;
}): boolean {
  const startMs = toEpochMs(input.shiftStartDt);
  const signedUpMs = toEpochMs(input.signedUpAt);
  if (startMs == null || signedUpMs == null) return false;
  return startMs - signedUpMs > VOLUNTEER_REMINDER_MIN_SIGNUP_LEAD_MS;
}
