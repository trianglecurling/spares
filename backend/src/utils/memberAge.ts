const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DATE_OF_BIRTH_INVALID_MESSAGE = 'Enter a valid date of birth.';
export const DATE_OF_BIRTH_FUTURE_MESSAGE = 'Date of birth cannot be in the future.';

/** UTC calendar date as YYYY-MM-DD. */
export function utcDateOnly(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** True when value is a real YYYY-MM-DD calendar date (rejects overflow like 2026-02-31). */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** Field message for a supplied date of birth, or null when empty/valid. */
export function dateOfBirthValidationMessage(
  value: string | null | undefined,
  asOf: Date = new Date(),
): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (!isValidDateOnly(trimmed)) return DATE_OF_BIRTH_INVALID_MESSAGE;
  if (trimmed > utcDateOnly(asOf)) return DATE_OF_BIRTH_FUTURE_MESSAGE;
  return null;
}

/** Whole years completed on `asOfDate` (YYYY-MM-DD). Null when either date is missing or invalid. */
export function ageInYearsOnDate(
  dateOfBirth: string | null | undefined,
  asOfDate: string,
): number | null {
  if (!dateOfBirth || !isValidDateOnly(dateOfBirth) || !isValidDateOnly(asOfDate)) return null;
  let age = Number(asOfDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  if (asOfDate.slice(5) < dateOfBirth.slice(5)) {
    age -= 1;
  }
  return age;
}

/** True when date of birth indicates the member is under 18 today (UTC calendar). */
export function isMemberMinor(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age < 18;
}
