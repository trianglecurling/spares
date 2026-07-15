export type VolunteerCredentialSummary = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
};

export type VolunteerHubCredential = VolunteerCredentialSummary & {
  held: boolean;
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
  description: string | null;
  pointOfContact: string;
  location: string | null;
  startDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  managers: VolunteerMemberSummary[];
  roles: VolunteerRoleView[];
  shifts: VolunteerShiftView[];
  canManage: boolean;
};

export type DashboardVolunteerOpportunity = {
  shiftRoleId: number;
  programId: number;
  programTitle: string;
  location: string | null;
  roleId: number;
  roleName: string;
  startDt: string;
  endDt: string;
  volunteersNeeded: number;
  volunteersRegistered: number;
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
