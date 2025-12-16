/**
 * Formats a date string (YYYY-MM-DD) to a friendly format
 * Example: "2025-12-10" -> "Wednesday, December 10, 2025"
 */
export function formatDateForEmail(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  
  return date.toLocaleDateString('en-US', options);
}

/**
 * Formats a time string (HH:MM in 24-hour format) to 12-hour format with A.M./P.M.
 * Example: "18:15" -> "6:15 P.M."
 */
export function formatTimeForEmail(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const hour = hours % 12 || 12; // Convert to 12-hour format (0 becomes 12)
  const ampm = hours >= 12 ? 'P.M.' : 'A.M.';
  const minutesStr = minutes.toString().padStart(2, '0');
  
  return `${hour}:${minutesStr} ${ampm}`;
}





