/**
 * Formats a phone number as (123) 456-7890
 * Assumes US-based 10-digit phone numbers
 * @param phone - Phone number string (can be formatted or unformatted)
 * @returns Formatted phone number string or null if invalid
 */
export function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Must be exactly 10 digits
  if (digits.length !== 10) return phone; // Return original if invalid

  // Format as (123) 456-7890
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
