import {
  addMinutesToDateTimeLocal as addMinutesToClubDateTimeLocal,
  dateTimeLocalToIso,
  formatClubDate,
  formatClubDateTime,
  formatClubTime,
  formatDateInTimeZone,
  instantToFloatingDate,
  isoToDateTimeLocal,
} from './clubTime';

export type VolunteerCredentialSummary = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
  systemKey?: string | null;
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
  memberEmail: string | null;
  memberPhone: string | null;
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

export type VolunteerSignupKind = 'volunteering' | 'general';

export function parseVolunteerSignupKind(value: unknown): VolunteerSignupKind {
  return value === 'general' ? 'general' : 'volunteering';
}

/** Product-facing labels for program roles/shifts. General sign-ups use lists/times. */
export type VolunteerProgramUiTerms = {
  roleSingular: string;
  rolePlural: string;
  roleTitle: string;
  roleTab: string;
  shiftSingular: string;
  shiftPlural: string;
  shiftTitle: string;
  shiftTab: string;
  peopleSingular: string;
  peoplePlural: string;
  addPeople: string;
  peopleFieldLabel: string;
  commentsPlaceholder: string;
  noneSignedUp: string;
  signedUpCountLabel: string;
  selectAtLeastOne: string;
  addingAsOwnerHelp: string;
};

export function volunteerProgramUiTerms(kind: VolunteerSignupKind): VolunteerProgramUiTerms {
  if (kind === 'general') {
    return {
      roleSingular: 'list',
      rolePlural: 'lists',
      roleTitle: 'List',
      roleTab: 'Lists',
      shiftSingular: 'time',
      shiftPlural: 'times',
      shiftTitle: 'Time',
      shiftTab: 'Times',
      peopleSingular: 'person',
      peoplePlural: 'people',
      addPeople: 'Add sign-ups',
      peopleFieldLabel: 'People',
      commentsPlaceholder: 'Anything others or program owners should know',
      noneSignedUp: 'No one signed up yet.',
      signedUpCountLabel: 'Signed up',
      selectAtLeastOne: 'Select at least one person.',
      addingAsOwnerHelp:
        "You're adding people as a program owner. Confirmation emails are sent to selected members.",
    };
  }
  return {
    roleSingular: 'role',
    rolePlural: 'roles',
    roleTitle: 'Role',
    roleTab: 'Roles',
    shiftSingular: 'shift',
    shiftPlural: 'shifts',
    shiftTitle: 'Shift',
    shiftTab: 'Shifts',
    peopleSingular: 'volunteer',
    peoplePlural: 'volunteers',
    addPeople: 'Add volunteers',
    peopleFieldLabel: 'Volunteers',
    commentsPlaceholder: 'Anything other volunteers or program owners should know',
    noneSignedUp: 'No volunteers signed up yet.',
    signedUpCountLabel: 'Volunteers',
    selectAtLeastOne: 'Select at least one volunteer.',
    addingAsOwnerHelp:
      "You're adding volunteers as a program owner. Confirmation emails are sent to selected members.",
  };
}

export type VolunteerShiftView = {
  id: number;
  programId: number;
  startDt: string;
  endDt: string;
  creditHours: number;
  recurrenceSeriesId: number | null;
  recurrenceRule: string | null;
  recurrenceDate: string | null;
  sourceCalendarEventId: number | null;
  roles: VolunteerShiftRoleView[];
};

export type VolunteerAttachedCalendarEvent = {
  id: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  isRecurring: boolean;
  occurrenceCount?: number;
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
  signupKind: VolunteerSignupKind;
  priority: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  managers: VolunteerMemberSummary[];
  roles: VolunteerRoleView[];
  shifts: VolunteerShiftView[];
  canManage: boolean;
  calendarEvent: VolunteerAttachedCalendarEvent | null;
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
  description: string | null;
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
  creditHours?: number;
  status: 'confirmed' | 'cancelled';
  comments: string | null;
  canCancel: boolean;
};

export type VolunteerStatsView = {
  season: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  } | null;
  club: {
    hours: { month: number; season: number; lifetime: number };
    shifts: { month: number; season: number; lifetime: number };
    uniqueVolunteersSeason: number;
    membershipCountSeason: number;
    uniqueVolunteerPercentSeason: number | null;
    hoursPerMemberSeason: number | null;
  };
  me: {
    hours: { month: number; season: number; lifetime: number };
    shifts: { month: number; season: number; lifetime: number };
    seasonRank: number | null;
  };
  leaderboard: Array<{
    rank: number;
    memberId: number;
    name: string;
    hours: number;
    isViewer: boolean;
  }>;
};

export type VolunteerSeasonActivityView = {
  id: string;
  kind: 'shift' | 'self_report';
  date: string;
  hours: number;
  summary: string;
  detail: string | null;
};

export type VolunteerSeasonLedgerView = {
  memberId: number;
  memberName: string;
  season: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  totalHours: number;
  activities: VolunteerSeasonActivityView[];
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
    const startDay = formatDateInTimeZone(new Date(startDt));
    const endDay = formatDateInTimeZone(new Date(endDt));
    if (startDay && startDay === endDay) {
      return `${formatClubDate(startDt, dateOpts)}, ${formatClubTime(startDt, timeOpts)} – ${formatClubTime(endDt, timeOpts)}`;
    }
    return `${formatClubDateTime(startDt, { ...dateOpts, ...timeOpts, dateStyle: undefined, timeStyle: undefined })} – ${formatClubDateTime(endDt, { ...dateOpts, ...timeOpts, dateStyle: undefined, timeStyle: undefined })}`;
  } catch {
    return `${startDt} – ${endDt}`;
  }
}

export function formatAttachedCalendarEventWhen(event: {
  start: string;
  end: string;
  allDay: boolean;
  isRecurring?: boolean;
}): string {
  const when = event.allDay
    ? `${formatClubDate(event.start)} · All day`
    : formatVolunteerRange(event.start, event.end);
  return event.isRecurring ? `${when} · Recurring` : when;
}

export function volunteerHoursFromRange(startDt: string, endDt: string): number {
  try {
    const ms = new Date(endDt).getTime() - new Date(startDt).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
  } catch {
    return 0;
  }
}

export const VOLUNTEER_CREDIT_HOURS_STEP = 0.5;

/** Largest 0.5-hour increment that does not exceed the shift duration. */
export function maxVolunteerCreditHoursOnStep(durationHours: number): number {
  if (!Number.isFinite(durationHours) || durationHours <= 0) return 0;
  return Math.floor((durationHours + 1e-9) / VOLUNTEER_CREDIT_HOURS_STEP) * VOLUNTEER_CREDIT_HOURS_STEP;
}

/** Snap to 0.5-hour increments and clamp to [0, durationHours]. */
export function snapVolunteerCreditHours(hours: number, durationHours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const snapped =
    Math.round(hours / VOLUNTEER_CREDIT_HOURS_STEP) * VOLUNTEER_CREDIT_HOURS_STEP;
  const rounded = Math.round(snapped * 10) / 10;
  const cap = maxVolunteerCreditHoursOnStep(durationHours);
  if (cap <= 0) return Math.max(0, rounded);
  return Math.min(Math.max(0, rounded), cap);
}

export function defaultVolunteerCreditHours(
  signupKind: VolunteerSignupKind,
  startDt: string,
  endDt: string
): number {
  if (signupKind === 'general') return 0;
  return volunteerHoursFromRange(startDt, endDt);
}

export function volunteerCreditHoursFromShift(shift: {
  creditHours?: number | null;
  startDt: string;
  endDt: string;
}): number {
  if (shift.creditHours != null && Number.isFinite(shift.creditHours) && shift.creditHours >= 0) {
    return shift.creditHours;
  }
  return volunteerHoursFromRange(shift.startDt, shift.endDt);
}

export function formatVolunteerDuration(startDt: string, endDt: string): string {
  const hours = volunteerHoursFromRange(startDt, endDt);
  if (hours <= 0) return '';
  return formatVolunteerHoursLabel(hours);
}

export function formatVolunteerHoursLabel(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  if (rounded === 1) return '1 hour';
  if (Number.isInteger(rounded)) return `${rounded} hours`;
  return `${rounded} hours`;
}

export function formatVolunteerShiftCount(count: number): string {
  return count === 1 ? '1 shift' : `${count} shifts`;
}

export type PastVolunteeringItem =
  | { kind: 'shift'; sortDate: string; signup: MyVolunteerSignup }
  | { kind: 'self_report'; sortDate: string; log: VolunteerHourLogView };

export function buildPastVolunteeringItems(
  signups: MyVolunteerSignup[],
  hourLogs: VolunteerHourLogView[]
): PastVolunteeringItem[] {
  const items: PastVolunteeringItem[] = [
    ...signups.map((signup) => ({
      kind: 'shift' as const,
      sortDate: volunteerShiftDayKey(signup.startDt),
      signup,
    })),
    ...hourLogs.map((log) => ({
      kind: 'self_report' as const,
      sortDate: log.volunteerDate,
      log,
    })),
  ];
  items.sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? 1 : -1;
    if (a.kind !== b.kind) return a.kind === 'shift' ? -1 : 1;
    const aId = a.kind === 'shift' ? a.signup.signupId : a.log.id;
    const bId = b.kind === 'shift' ? b.signup.signupId : b.log.id;
    return bId - aId;
  });
  return items;
}

export function summarizePastVolunteering(items: PastVolunteeringItem[]): {
  shifts: number;
  hours: number;
} {
  let shifts = 0;
  let hours = 0;
  for (const item of items) {
    if (item.kind === 'shift') {
      shifts += 1;
      hours += volunteerCreditHoursFromShift(item.signup);
    } else {
      hours += item.log.hours;
    }
  }
  return { shifts, hours: Math.round(hours * 10) / 10 };
}

export function volunteerProgramHasOpenShifts(program: {
  shifts: Array<{ roles: unknown[] }>;
}): boolean {
  return program.shifts.some((shift) => shift.roles.length > 0);
}

function volunteerRoleHiddenByCredentials(role: {
  callerHasCredentials: boolean;
  callerIsSignedUp?: boolean;
}): boolean {
  return !role.callerHasCredentials && !role.callerIsSignedUp;
}

export function volunteerProgramHasIneligibleCredentialRoles(program: {
  shifts: Array<{ roles: Array<{ callerHasCredentials: boolean; callerIsSignedUp?: boolean }> }>;
}): boolean {
  return program.shifts.some((shift) => shift.roles.some(volunteerRoleHiddenByCredentials));
}

/**
 * Names of credentials the caller does not hold that gate hidden shift roles.
 * Credentials required by a role they already qualify for are omitted.
 */
export function volunteerProgramMissingCredentialNames(
  program: {
    canManage?: boolean;
    shifts: Array<{
      roles: Array<{
        callerHasCredentials: boolean;
        callerIsSignedUp?: boolean;
        requiredCredentials: Array<{ id: number; name: string }>;
      }>;
    }>;
  },
  heldCredentialIds?: Iterable<number>
): string[] {
  if (program.canManage) return [];
  const held = new Set(heldCredentialIds ?? []);
  if (heldCredentialIds == null) {
    for (const shift of program.shifts) {
      for (const role of shift.roles) {
        if (!role.callerHasCredentials) continue;
        for (const credential of role.requiredCredentials) {
          held.add(credential.id);
        }
      }
    }
  }
  const names = new Map<number, string>();
  for (const shift of program.shifts) {
    for (const role of shift.roles) {
      if (!volunteerRoleHiddenByCredentials(role)) continue;
      for (const credential of role.requiredCredentials) {
        if (held.has(credential.id)) continue;
        names.set(credential.id, credential.name);
      }
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Shifts and roles the caller can see. Credential-gated roles they cannot take
 * are omitted unless they already signed up, they asked to show them, or they
 * manage the program (owners still need to add others).
 */
export function volunteerProgramShiftsForCaller<
  TRole extends { callerHasCredentials: boolean; callerIsSignedUp?: boolean },
  TShift extends { roles: TRole[] },
>(
  program: { canManage?: boolean; shifts: TShift[] },
  options?: { includeIneligible?: boolean }
): TShift[] {
  if (program.canManage || options?.includeIneligible) {
    return program.shifts.filter((shift) => shift.roles.length > 0);
  }
  return program.shifts
    .map((shift) => ({
      ...shift,
      roles: shift.roles.filter((role) => !volunteerRoleHiddenByCredentials(role)),
    }))
    .filter((shift) => shift.roles.length > 0);
}

/** Distinct role ids across shifts (same role on many shifts counts once). */
export function volunteerShiftsDistinctRoleCount(
  shifts: Array<{ roles: Array<{ roleId: number }> }>
): number {
  const ids = new Set<number>();
  for (const shift of shifts) {
    for (const role of shift.roles) {
      ids.add(role.roleId);
    }
  }
  return ids.size;
}

/** A shift is past once its end date/time is before now. */
export function volunteerShiftHasEnded(endDt: string, nowIso: string): boolean {
  return endDt < nowIso;
}

/**
 * True when the program has shifts and the last one has already ended.
 * Used as a derived archive (no job writes archived_at).
 */
export function volunteerProgramLastShiftHasEnded(
  program: { shifts: Array<{ endDt: string }> },
  nowIso: string
): boolean {
  if (program.shifts.length === 0) return false;
  let lastEnd = program.shifts[0].endDt;
  for (const shift of program.shifts) {
    if (shift.endDt > lastEnd) lastEnd = shift.endDt;
  }
  return volunteerShiftHasEnded(lastEnd, nowIso);
}

/**
 * Confirmed sign-ups and seats needed across shift roles.
 * Ended shifts are omitted while any later shift remains; fully past programs
 * keep historical totals so archived rows still show x/y.
 */
export function volunteerProgramSignupTotals(
  program: {
    shifts: Array<{
      endDt?: string;
      roles: Array<{ volunteersRegistered: number; volunteersNeeded: number }>;
    }>;
  },
  nowIso: string = new Date().toISOString()
): { signedUp: number; needed: number } {
  const openShifts = program.shifts.filter(
    (shift) => !shift.endDt || !volunteerShiftHasEnded(shift.endDt, nowIso)
  );
  const shifts = openShifts.length > 0 ? openShifts : program.shifts;
  let signedUp = 0;
  let needed = 0;
  for (const shift of shifts) {
    for (const role of shift.roles) {
      signedUp += role.volunteersRegistered;
      needed += role.volunteersNeeded;
    }
  }
  return { signedUp, needed };
}

export type VolunteerSpotCounts = {
  remaining: number;
  needed: number;
};

export function volunteerSpotsTotals(
  roles: Array<{ volunteersRegistered: number; volunteersNeeded: number }>
): VolunteerSpotCounts {
  let registered = 0;
  let needed = 0;
  for (const role of roles) {
    registered += role.volunteersRegistered;
    needed += role.volunteersNeeded;
  }
  return { remaining: Math.max(0, needed - registered), needed };
}

export function volunteerSpotsStatusLabel(remaining: number, needed: number): string {
  if (remaining <= 0) return 'Full';
  if (remaining === 1 && needed > 1) return '1 spot left!';
  if (remaining === 2 && needed > 2) return '2 spots left!';
  return remaining === 1 ? '1 open spot' : `${remaining} open spots`;
}

/** Local calendar date (YYYY-MM-DD) of the earliest shift, if any. */
export function volunteerProgramFirstShiftDate(program: {
  shifts: Array<{ startDt: string }>;
}): string | null {
  if (program.shifts.length === 0) return null;
  let earliest = program.shifts[0].startDt;
  for (const shift of program.shifts) {
    if (shift.startDt < earliest) earliest = shift.startDt;
  }
  return volunteerShiftDayKey(earliest);
}

/** Admin and hub list order: lower priority first, then earliest shift, then title. */
export function compareVolunteerProgramsForList(
  a: { priority: number | null; title: string; shifts: Array<{ startDt: string }> },
  b: { priority: number | null; title: string; shifts: Array<{ startDt: string }> }
): number {
  const aPriority = a.priority ?? Number.POSITIVE_INFINITY;
  const bPriority = b.priority ?? Number.POSITIVE_INFINITY;
  if (aPriority !== bPriority) return aPriority - bPriority;
  const aFirst = volunteerProgramFirstShiftDate(a);
  const bFirst = volunteerProgramFirstShiftDate(b);
  if (aFirst && bFirst) {
    const byShift = aFirst.localeCompare(bFirst);
    if (byShift !== 0) return byShift;
  } else if (aFirst) {
    return -1;
  } else if (bFirst) {
    return 1;
  }
  return a.title.localeCompare(b.title);
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

/**
 * Hub discovery: a program appears only if the member qualifies for at least
 * one of its roles (holds every credential that role requires). Roles with no
 * credential requirement always qualify. Programs with no roles stay visible.
 */
export function volunteerProgramVisibleGivenCredentials(
  program: { roles: Array<{ requiredCredentials: Array<{ id: number }> }> },
  heldCredentialIds: Iterable<number>
): boolean {
  const roles = program.roles;
  if (roles.length === 0) return true;
  const held = heldCredentialIds instanceof Set ? heldCredentialIds : new Set(heldCredentialIds);
  return roles.some((role) =>
    role.requiredCredentials.every((credential) => held.has(credential.id))
  );
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

/** Club-local calendar day key (YYYY-MM-DD) for grouping shifts. */
export function volunteerShiftDayKey(startDt: string): string {
  const d = new Date(startDt);
  if (Number.isNaN(d.getTime())) return startDt.slice(0, 10);
  return formatDateInTimeZone(d) ?? startDt.slice(0, 10);
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
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    return `${formatClubTime(startDt, timeOpts)} – ${formatClubTime(endDt, timeOpts)}`;
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
  const start = instantToFloatingDate(startDt);
  const end = instantToFloatingDate(endDt);
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

/** Convert an ISO string to a value suitable for datetime-local inputs (club wall clock). */
export function toDateTimeLocal(iso: string): string {
  return isoToDateTimeLocal(iso);
}

export function fromDateTimeLocal(value: string): string {
  return dateTimeLocalToIso(value) || value;
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
  return addMinutesToClubDateTimeLocal(startLocal, minutes);
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

export const VOLUNTEER_HOUR_LOG_MIN = 0.5;
export const VOLUNTEER_HOUR_LOG_MAX = 8;
export const VOLUNTEER_HOUR_LOG_STEP = 0.5;
export const VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX = 2000;
export const VOLUNTEER_HOUR_LOG_ADDITIONAL_MEMBERS_MAX = 25;
export const VOLUNTEER_HOUR_LOG_MAX_MESSAGE =
  'The maximum number of hours per report is 8. If you need to log more time, create an additional report.';

export type VolunteerHourLogView = {
  id: number;
  memberId: number;
  memberName: string;
  volunteerDate: string;
  hours: number;
  description: string;
  createdByMemberId: number | null;
  createdByMemberName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerHourLogListResponse = {
  items: VolunteerHourLogView[];
  page: number;
  pageSize: number;
  total: number;
  totalHours: number;
};

export type VolunteerHourLogFormValues = {
  volunteerDate: string;
  hours: number | '';
  description: string;
};

export type VolunteerHourLogFieldErrors = {
  volunteerDate?: string;
  hours?: string;
  description?: string;
  memberId?: string;
  additionalMemberIds?: string;
};

/** Round up to the next 0.5-hour increment (1.1 → 1.5, 1.5 → 1.5). */
export function roundVolunteerHoursUp(hours: number): number {
  return Math.ceil(hours * 2 - 1e-9) / 2;
}

export function commitVolunteerHourLogHours(value: unknown): { hours: number | ''; error?: string } {
  if (value === '' || value == null) {
    return { hours: '', error: 'Enter the number of hours.' };
  }
  const hours = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { hours: Number.isFinite(hours) ? hours : '', error: 'Enter the number of hours.' };
  }
  if (hours > VOLUNTEER_HOUR_LOG_MAX) {
    return { hours, error: VOLUNTEER_HOUR_LOG_MAX_MESSAGE };
  }
  const rounded = Math.round(roundVolunteerHoursUp(hours) * 10) / 10;
  if (rounded < VOLUNTEER_HOUR_LOG_MIN || rounded > VOLUNTEER_HOUR_LOG_MAX) {
    return { hours, error: VOLUNTEER_HOUR_LOG_MAX_MESSAGE };
  }
  return { hours: rounded };
}

export function volunteerHourLogHoursForSubmit(
  hours: VolunteerHourLogFormValues['hours']
): { hours: number } | { error: string } {
  const next = commitVolunteerHourLogHours(hours);
  if (next.error || next.hours === '') {
    return { error: next.error || 'Enter the number of hours.' };
  }
  return { hours: next.hours };
}

export function emptyVolunteerHourLogFormValues(todayDateOnly: string): VolunteerHourLogFormValues {
  return {
    volunteerDate: todayDateOnly,
    hours: 1,
    description: '',
  };
}

export function volunteerHourLogFieldErrorsFromUnknown(err: unknown): VolunteerHourLogFieldErrors {
  const details =
    typeof err === 'object' && err != null && 'response' in err
      ? (err as { response?: { data?: { details?: unknown } } }).response?.data?.details
      : undefined;
  if (!details || typeof details !== 'object') return {};

  const out: VolunteerHourLogFieldErrors = {};
  const source = details as Record<string, unknown>;
  const keys = ['volunteerDate', 'hours', 'description', 'memberId', 'additionalMemberIds'] as const;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  if (Object.keys(out).length > 0) return out;

  const fieldErrors = source.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    for (const key of keys) {
      const value = (fieldErrors as Record<string, unknown>)[key];
      if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
    }
  }
  return out;
}
