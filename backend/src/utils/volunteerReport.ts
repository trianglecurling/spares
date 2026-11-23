import { toCsv } from './csv.js';
import { normalizePersonName } from './memberName.js';
import { parseVolunteerSignupKind, roundVolunteerHours } from './volunteerStats.js';

export const VOLUNTEER_REPORT_HEADERS = ['Name', 'Date', 'Role name', 'Volunteer hours'] as const;

export type VolunteerReportFieldErrors = {
  from?: string;
  to?: string;
};

export class VolunteerReportValidationError extends Error {
  constructor(
    message: string,
    public details: VolunteerReportFieldErrors
  ) {
    super(message);
    this.name = 'VolunteerReportValidationError';
  }
}

export type VolunteerReportSignupSource = {
  signupId: number;
  memberId: number | null;
  memberName: string | null;
  shiftId: number;
  startDt: string;
  date: string;
  roleName: string | null;
  creditHours: number;
  signupKind: string;
  status: string;
};

export type VolunteerReportHourLogSource = {
  id: number;
  memberId: number;
  memberName: string | null;
  date: string;
  hours: number;
  description: string | null;
};

export type VolunteerReportActivity = {
  memberId: number;
  memberName: string;
  date: string;
  roleName: string;
  /** Null when this row is an extra role on a shift whose hours are already listed. */
  hours: number | null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

export function parseVolunteerReportRange(
  from: unknown,
  to: unknown
): { from: string; to: string } {
  const details: VolunteerReportFieldErrors = {};
  const fromDate = parseDateField(from, 'from', details);
  const toDate = parseDateField(to, 'to', details);
  if (!fromDate || !toDate) {
    throw new VolunteerReportValidationError('Choose a valid date range.', details);
  }
  if (fromDate > toDate) {
    throw new VolunteerReportValidationError('Choose a valid date range.', {
      to: 'End date must be on or after the start date.',
    });
  }
  return { from: fromDate, to: toDate };
}

function parseDateField(
  value: unknown,
  field: keyof VolunteerReportFieldErrors,
  details: VolunteerReportFieldErrors
): string {
  const label = field === 'from' ? 'start date' : 'end date';
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    details[field] = `Enter a ${label}.`;
    return '';
  }
  if (!isRealDateOnly(trimmed)) {
    details[field] = 'Enter a valid date.';
    return '';
  }
  return trimmed;
}

function displayMemberName(value: string | null | undefined): string {
  return normalizePersonName(value) || 'Member';
}

function roleLabel(roleName: string | null | undefined): string {
  const trimmed = roleName?.trim();
  return trimmed || 'Volunteer role';
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function shiftHasStarted(startDt: string, nowIso: string): boolean {
  const start = new Date(startDt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(now)) return startDt <= nowIso;
  return start <= now;
}

/**
 * One row per completed volunteer role and per self-reported hours entry.
 * Shift credit is listed on the first role when a member filled several roles
 * on the same shift, so a sum of the hours column is not doubled.
 */
export function collectVolunteerReportActivities(input: {
  from: string;
  to: string;
  today: string;
  nowIso: string;
  signups: VolunteerReportSignupSource[];
  hourLogs: VolunteerReportHourLogSource[];
}): VolunteerReportActivity[] {
  const byShift = new Map<string, VolunteerReportSignupSource[]>();
  for (const signup of input.signups) {
    if (signup.status !== 'confirmed') continue;
    if (parseVolunteerSignupKind(signup.signupKind) !== 'volunteering') continue;
    if (signup.memberId == null) continue;
    if (!shiftHasStarted(signup.startDt, input.nowIso)) continue;
    if (!inRange(signup.date, input.from, input.to) || signup.date > input.today) continue;
    const key = `${signup.memberId}:${signup.shiftId}`;
    const group = byShift.get(key) ?? [];
    group.push(signup);
    byShift.set(key, group);
  }

  const activities: VolunteerReportActivity[] = [];
  for (const group of byShift.values()) {
    const sorted = [...group].sort((a, b) => {
      const role = roleLabel(a.roleName).localeCompare(roleLabel(b.roleName), 'en', {
        sensitivity: 'base',
      });
      if (role !== 0) return role;
      return a.signupId - b.signupId;
    });
    sorted.forEach((signup, index) => {
      const hours = Number(signup.creditHours);
      const listedHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
      activities.push({
        memberId: signup.memberId as number,
        memberName: displayMemberName(signup.memberName),
        date: signup.date,
        roleName: roleLabel(signup.roleName),
        hours: index === 0 ? roundVolunteerHours(listedHours) : null,
      });
    });
  }

  for (const log of input.hourLogs) {
    if (!inRange(log.date, input.from, input.to) || log.date > input.today) continue;
    const hours = Number(log.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    activities.push({
      memberId: log.memberId,
      memberName: displayMemberName(log.memberName),
      date: log.date,
      roleName: log.description?.trim() || 'Self-reported hours',
      hours: roundVolunteerHours(hours),
    });
  }

  activities.sort((a, b) => {
    const name = a.memberName.localeCompare(b.memberName, 'en', { sensitivity: 'base' });
    if (name !== 0) return name;
    if (a.memberId !== b.memberId) return a.memberId - b.memberId;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const role = a.roleName.localeCompare(b.roleName, 'en', { sensitivity: 'base' });
    if (role !== 0) return role;
    if (a.hours == null && b.hours != null) return 1;
    if (a.hours != null && b.hours == null) return -1;
    return 0;
  });

  return activities;
}

/** Spreadsheet date, matching M/D/YYYY without leading zeros. */
export function formatVolunteerReportDate(dateOnly: string): string {
  const match = DATE_ONLY.exec(dateOnly);
  if (!match) return dateOnly;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export function formatVolunteerReportHours(hours: number): string {
  return String(roundVolunteerHours(hours));
}

export function volunteerReportFilename(from: string, to: string): string {
  return `volunteer-report-${from}-to-${to}.csv`;
}

export function buildVolunteerReportCsv(activities: VolunteerReportActivity[]): string {
  let previousMemberId: number | null = null;
  const rows = activities.map((activity) => {
    const showName = activity.memberId !== previousMemberId;
    previousMemberId = activity.memberId;
    return [
      showName ? activity.memberName : '',
      formatVolunteerReportDate(activity.date),
      activity.roleName,
      activity.hours == null ? '' : formatVolunteerReportHours(activity.hours),
    ];
  });
  return toCsv([...VOLUNTEER_REPORT_HEADERS], rows);
}
