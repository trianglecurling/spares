/** Parse common query-string boolean forms (`true`, `"true"`, `1`, etc.). */
export function parseQueryBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined || value === '') {
    return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}
