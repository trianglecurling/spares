export type VolunteerCredentialSummary = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
};

export type VolunteerHubCredential = VolunteerCredentialSummary & {
  held: boolean;
  expiresAt: string | null;
};

export type VolunteerMemberSummary = {
  id: number;
  name: string;
  email: string | null;
};

export type VolunteerSignupView = {
  id: number;
  memberId: number | null;
  memberName: string;
  guestName: string | null;
  guestEmail: string | null;
  comments: string | null;
  signedUpByMemberId: number | null;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
};

export type VolunteerShiftRoleView = {
  id: number;
  shiftId: number;
  roleId: number;
  roleName: string;
  roleDescription: string | null;
  volunteersNeeded: number;
  volunteersRegistered: number;
  isFull: boolean;
  requiredCredentials: VolunteerCredentialSummary[];
  callerHasCredentials: boolean;
  callerIsSignedUp: boolean;
  signups: VolunteerSignupView[];
};

export type VolunteerShiftView = {
  id: number;
  programId: number;
  startDt: string;
  endDt: string;
  recurrenceSeriesId: number | null;
  recurrenceRule: string | null;
  recurrenceDate: string | null;
  roles: VolunteerShiftRoleView[];
};

export type VolunteerRoleView = {
  id: number;
  programId: number;
  name: string;
  description: string | null;
  defaultDurationMinutes: number;
  requiredCredentials: VolunteerCredentialSummary[];
};

export type VolunteerProgramView = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  pointOfContact: string;
  location: string | null;
  startDate: string | null;
  published: boolean;
  featureOnDashboard: boolean;
  publicSignups: boolean;
  priority: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  managers: VolunteerMemberSummary[];
  roles: VolunteerRoleView[];
  shifts: VolunteerShiftView[];
  canManage: boolean;
};

export type PublicVolunteerProgramView = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  pointOfContact: string;
  location: string | null;
  shifts: Array<{
    id: number;
    startDt: string;
    endDt: string;
    roles: Array<{
      id: number;
      roleId: number;
      roleName: string;
      roleDescription: string | null;
      volunteersNeeded: number;
      volunteersRegistered: number;
      isFull: boolean;
      requiresCredentials: boolean;
      requiredCredentialNames: string[];
    }>;
  }>;
};

export type PublicVolunteerSignupManageView = {
  programId: number;
  programTitle: string;
  location: string | null;
  roleName: string;
  startDt: string;
  endDt: string;
  guestName: string;
  guestEmail: string;
  comments: string | null;
  status: 'confirmed' | 'cancelled';
  canCancel: boolean;
};

export type DashboardVolunteerOpportunityRole = {
  shiftRoleId: number;
  roleId: number;
  roleName: string;
  volunteersNeeded: number;
  volunteersRegistered: number;
  requiresCredentials: boolean;
  callerIsSignedUp: boolean;
};

export type DashboardVolunteerOpportunityShift = {
  shiftId: number;
  startDt: string;
  endDt: string;
  roles: DashboardVolunteerOpportunityRole[];
};

export type DashboardVolunteerOpportunityProgram = {
  programId: number;
  programSlug: string;
  programTitle: string;
  location: string | null;
  totalShifts: number;
  shifts: DashboardVolunteerOpportunityShift[];
};

export type MyVolunteerSignup = {
  signupId: number;
  shiftRoleId: number;
  programId: number;
  programTitle: string;
  location: string | null;
  roleId: number;
  roleName: string;
  startDt: string;
  endDt: string;
  status: 'confirmed' | 'cancelled';
  comments: string | null;
  canCancel: boolean;
};

/** Sentinel for the club (default) location radio in program editors. */
export const VOLUNTEER_LOCATION_CLUB = '__club__';

export type VolunteerLocationChoice = string | null;

/** Map a stored program location to the editor choice value. */
export function volunteerLocationChoiceFromStored(
  location: string | null | undefined,
  clubName: string
): VolunteerLocationChoice {
  const trimmed = location?.trim() ?? '';
  if (!trimmed) return VOLUNTEER_LOCATION_CLUB;
  if (trimmed.toLowerCase() === clubName.trim().toLowerCase()) return VOLUNTEER_LOCATION_CLUB;
  return trimmed;
}

/**
 * Map an editor choice to the stored location.
 * Club default and empty Other both persist as null (location is only shown for custom Other).
 */
export function volunteerLocationStoredFromChoice(
  choice: VolunteerLocationChoice,
  clubName: string
): string | null {
  if (choice == null || choice === VOLUNTEER_LOCATION_CLUB) return null;
  const trimmed = choice.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === clubName.trim().toLowerCase()) return null;
  return trimmed;
}

export function formatVolunteerRange(startDt: string, endDt: string): string {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    };
    const timeOpts: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
    };
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
      return `${start.toLocaleDateString('en-US', dateOpts)}, ${start.toLocaleTimeString('en-US', timeOpts)} – ${end.toLocaleTimeString('en-US', timeOpts)}`;
    }
    return `${start.toLocaleString('en-US', { ...dateOpts, ...timeOpts })} – ${end.toLocaleString('en-US', { ...dateOpts, ...timeOpts })}`;
  } catch {
    return `${startDt} – ${endDt}`;
  }
}

export function formatVolunteerDuration(startDt: string, endDt: string): string {
  try {
    const ms = new Date(endDt).getTime() - new Date(startDt).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const hours = Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
    if (hours === 1) return '1 hour';
    if (Number.isInteger(hours)) return `${hours} hours`;
    return `${hours} hours`;
  } catch {
    return '';
  }
}

export function volunteerProgramHasOpenShifts(program: {
  shifts: Array<{ roles: unknown[] }>;
}): boolean {
  return program.shifts.some((shift) => shift.roles.length > 0);
}

/**
 * Published programs with no roles are listed even without shifts.
 * Shift-based programs stay hidden on the hub until they have an upcoming shift.
 */
export function volunteerProgramAppearsInDiscovery(program: {
  roles: unknown[];
  shifts: Array<{ roles: unknown[] }>;
}): boolean {
  return volunteerProgramHasOpenShifts(program) || program.roles.length === 0;
}

/** Format a program date span from its shifts (single day or inclusive range). */
export function formatProgramShiftDateSpan(shifts: Array<{ startDt: string; endDt: string }>): string {
  if (shifts.length === 0) return 'No shifts scheduled';
  const dates = shifts
    .flatMap((s) => [new Date(s.startDt), new Date(s.endDt)])
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })
    .sort();
  if (dates.length === 0) return 'No shifts scheduled';
  const first = dates[0];
  const last = dates[dates.length - 1];
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  const formatDay = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
  };
  if (first === last) return formatDay(first);
  return `${formatDay(first)} – ${formatDay(last)}`;
}

/** Local calendar day key (YYYY-MM-DD) for grouping shifts. */
export function volunteerShiftDayKey(startDt: string): string {
  const d = new Date(startDt);
  if (Number.isNaN(d.getTime())) return startDt.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatVolunteerDayHeading(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatVolunteerTimeRange(startDt: string, endDt: string): string {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    return `${start.toLocaleTimeString('en-US', timeOpts)} – ${end.toLocaleTimeString('en-US', timeOpts)}`;
  } catch {
    return `${startDt} – ${endDt}`;
  }
}

type CompactTimeParts = { clock: string; period: 'am' | 'pm' };

function formatCompactClock(date: Date): CompactTimeParts {
  const minutes = date.getMinutes();
  const hour24 = date.getHours();
  const period: 'am' | 'pm' = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 || 12;
  const clock = minutes === 0 ? String(hour12) : `${hour12}:${String(minutes).padStart(2, '0')}`;
  return { clock, period };
}

/** Compact range like "8–10am" or "11:30am–3pm". */
export function formatCompactVolunteerTimeRange(startDt: string, endDt: string): string {
  const start = new Date(startDt);
  const end = new Date(endDt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDt} – ${endDt}`;
  }
  const s = formatCompactClock(start);
  const e = formatCompactClock(end);
  if (s.period === e.period) {
    return `${s.clock}–${e.clock}${e.period}`;
  }
  return `${s.clock}${s.period}–${e.clock}${e.period}`;
}

function joinNaturalLanguage(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Concise multi-shift preview for role-grouped accordion headers.
 * Example: "Fri, Aug 28 8–10am and 11:30am–3pm"
 * Shows at most 4 shifts, then "and n more".
 */
export function formatVolunteerRoleShiftPreview(
  shifts: Array<{ startDt: string; endDt: string }>
): string {
  const sorted = shifts
    .slice()
    .sort((a, b) => a.startDt.localeCompare(b.startDt) || a.endDt.localeCompare(b.endDt));
  const maxVisible = 4;
  const visible = sorted.slice(0, maxVisible);
  const extra = sorted.length - visible.length;

  const byDay = new Map<string, Array<{ startDt: string; endDt: string }>>();
  for (const shift of visible) {
    const key = volunteerShiftDayKey(shift.startDt);
    const list = byDay.get(key) ?? [];
    list.push(shift);
    byDay.set(key, list);
  }

  const dayParts = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, dayShifts]) => {
      const [y, m, d] = dayKey.split('-').map(Number);
      const dayLabel =
        y && m && d
          ? new Date(y, m - 1, d).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
          : dayKey;

      const times = dayShifts.map((shift) =>
        formatCompactVolunteerTimeRange(shift.startDt, shift.endDt)
      );
      return `${dayLabel} ${joinNaturalLanguage(times)}`;
    });

  const summary = dayParts.join(' · ');
  if (!summary) return '';
  if (extra <= 0) return summary;
  return `${summary} and ${extra} more`;
}

/** Convert an ISO string to a value suitable for datetime-local inputs. */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

export function minutesToHoursInput(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

export function hoursInputToMinutes(value: string): number | null {
  const hours = Number.parseFloat(value);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.round(hours * 60);
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateOnly(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Format a YYYY-MM-DD value without timezone shifting. */
export function formatVolunteerDateOnly(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** A grant is valid through its expiration date (inclusive). Missing expiration does not expire. */
export function volunteerCredentialIsValidOn(
  expiresAt: string | null | undefined,
  asOfDate: string
): boolean {
  if (expiresAt == null || expiresAt === '') return true;
  return expiresAt >= asOfDate;
}

/** Add minutes to a datetime-local string; returns another datetime-local value. */
export function addMinutesToDateTimeLocal(startLocal: string, minutes: number): string {
  const start = new Date(startLocal);
  if (Number.isNaN(start.getTime())) return '';
  return toDateTimeLocal(new Date(start.getTime() + minutes * 60 * 1000).toISOString());
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  return `${hours}h ${mins}m`;
}
