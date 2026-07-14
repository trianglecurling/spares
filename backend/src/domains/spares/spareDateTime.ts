export function normalizeDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }
  return String(value);
}

export function normalizeTimeString(value: unknown): string {
  if (value instanceof Date) {
    const timePart = value.toISOString().split('T')[1];
    return timePart ? timePart.slice(0, 5) : '';
  }
  if (typeof value === 'string') {
    if (value.includes('T')) {
      const timePart = value.split('T')[1] || '';
      return timePart.slice(0, 5);
    }
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value);
}
