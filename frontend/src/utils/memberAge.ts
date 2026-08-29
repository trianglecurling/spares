export {
  DATE_OF_BIRTH_FUTURE_MESSAGE,
  DATE_OF_BIRTH_INVALID_MESSAGE,
  dateOfBirthValidationMessage,
  isMemberMinor,
} from '../../../backend/src/utils/memberAge';

/** Local calendar date as YYYY-MM-DD, for date-of-birth input `max`. */
export function localDateOnly(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
