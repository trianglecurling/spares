export const LOCATION_OPTIONS = [
  { type: 'warm-room' as const, label: 'Warm room' },
  { type: 'exterior' as const, label: 'Exterior' },
  { type: 'offsite' as const, label: 'Offsite' },
  { type: 'virtual' as const, label: 'Virtual' },
];

export const RECURRENCE_PRESETS: Array<{ value: string; label: string; rrule: string }> = [
  { value: 'none', label: 'None', rrule: '' },
  { value: 'daily', label: 'Daily', rrule: 'FREQ=DAILY' },
  { value: 'weekly', label: 'Weekly', rrule: 'FREQ=WEEKLY' },
  { value: 'biweekly', label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { value: 'monthly', label: 'Monthly', rrule: 'FREQ=MONTHLY' },
  { value: 'yearly', label: 'Yearly', rrule: 'FREQ=YEARLY' },
  { value: 'custom', label: 'Custom (RRULE)', rrule: '' },
];

export const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export const RRULE_DAY_LABELS: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

export function getWeekdayFromDate(date: Date): (typeof RRULE_DAYS)[number] {
  const d = date.getDay();
  const rruleOrder = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  return rruleOrder[d] as (typeof RRULE_DAYS)[number];
}

export function parseByDayFromRrule(rrule: string): (typeof RRULE_DAYS)[number][] | null {
  const match = rrule.match(/BYDAY=([\w,-]+)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => p.trim());
  const days = parts.map((p) => {
    const s = p.toUpperCase();
    return s.length > 2 ? s.slice(-2) : s;
  });
  return days.filter((d): d is (typeof RRULE_DAYS)[number] =>
    RRULE_DAYS.includes(d as (typeof RRULE_DAYS)[number])
  );
}

export function matchRecurrencePreset(rrule: string): {
  preset: string;
  custom: string;
  weeklyDays?: (typeof RRULE_DAYS)[number][];
} {
  if (!rrule || !rrule.trim()) return { preset: 'none', custom: '' };
  const normalized = rrule.trim();
  const exact = RECURRENCE_PRESETS.find((p) => p.rrule && normalized === p.rrule);
  if (exact) return { preset: exact.value, custom: '' };
  if (normalized.startsWith('FREQ=WEEKLY')) {
    const hasInterval2 = /INTERVAL=2/.test(normalized);
    if (hasInterval2) return { preset: 'biweekly', custom: '' };
    const byDay = parseByDayFromRrule(normalized);
    return {
      preset: 'weekly',
      custom: '',
      weeklyDays: byDay && byDay.length > 0 ? byDay : undefined,
    };
  }
  return { preset: 'custom', custom: normalized };
}
