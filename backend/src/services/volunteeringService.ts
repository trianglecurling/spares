import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { isVolunteerManager } from '../utils/auth.js';
import type { Member } from '../types.js';
import { config } from '../config.js';
import {
  addCalendarDays,
  calendarDaysBetween,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  localDateTimeToIso,
  shiftInstantByCalendarDays,
} from '../utils/timeZone.js';
import { fetchDirectCalendarEventsForRange } from './calendarExpansion.js';
import {
  applyCalendarExceptionsAndOverrides,
  pickDirectCalendarEventsOverlappingRange,
  planCalendarSyncedShiftChanges,
  type CalendarOccurrence,
  type DirectCalendarEventChoice,
} from '../utils/volunteerCalendarAttach.js';
import {
  composeRecurrenceRule,
  expandAllRecurrenceInstances,
  MAX_MATERIALIZED_RECURRENCE_INSTANCES,
  recurrenceRulesEquivalent,
  shiftRecurrenceRuleByDays,
  type CalendarRecurrenceInput,
} from '../utils/calendarRecurrence.js';
import { DEFAULT_SITE_NAME } from './spaDocumentMeta.js';
import { VolunteeringServiceError } from './volunteeringServiceError.js';
import { isUniqueConstraintViolation } from '../api/errors.js';
import { normalizePersonName } from '../utils/memberName.js';
import {
  sendVolunteerSignupConfirmationEmail,
  sendVolunteerCancellationEmails,
} from './email.js';
import { ensureUniqueVolunteerProgramSlug } from './volunteerProgramSlugs.js';
import { compareVolunteerProgramsForDiscovery } from '../utils/volunteerProgramSort.js';
import {
  VOLUNTEER_REMINDER_WINDOW_MS,
  volunteerSignupQualifiesForReminder,
} from '../utils/volunteerReminders.js';
import {
  aggregateVolunteerStats,
  buildSeasonVolunteerLedger,
  defaultVolunteerCreditHours,
  parseVolunteerCreditHours,
  parseVolunteerSignupKind,
  VOLUNTEER_SEASON_LEDGER_UNAVAILABLE,
  type VolunteerSeasonLedger,
  type VolunteerSignupKind,
  type VolunteerStatsCompletedSignup,
  type VolunteerStatsHourLog,
  type VolunteerStatsResult,
} from '../utils/volunteerStats.js';
import { listHourLogsForStats } from './volunteerHourLogService.js';
import { resolveSeasonAttachedToDate } from './curlingSessionService.js';
import {
  heldVolunteerCredentialIdsOn,
  memberHasAllVolunteerCredentials,
  volunteerProgramVisibleGivenCredentials,
} from '../utils/volunteerCredentials.js';
import { parseSystemCredentialKey } from '../utils/systemCredentials.js';
import { getMemberCredentialGrants, listHubCredentials, listMyCredentials } from './credentialService.js';
import type { CredentialSummary, HubCredential } from './credentialService.js';

/**
 * Club is the default volunteer location and is not shown in UI/email.
 * Only custom "Other" locations are persisted/returned as non-null.
 */
function normalizeVolunteerLocation(
  location: string | null | undefined,
  clubName: string
): string | null {
  const trimmed = location?.trim() || null;
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === clubName.trim().toLowerCase()) return null;
  return trimmed;
}

async function getConfiguredClubName(): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ clubName: schema.siteConfig.club_name })
    .from(schema.siteConfig)
    .where(eq(schema.siteConfig.id, 1))
    .limit(1);
  const trimmed = rows[0]?.clubName?.trim();
  return trimmed || DEFAULT_SITE_NAME;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function requireIso(value: string | Date | null | undefined, label: string): string {
  const iso = toIso(value);
  if (!iso) throw new VolunteeringServiceError(`${label} is required`);
  return iso;
}

function parseDateInput(value: string, label: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new VolunteeringServiceError(`Invalid ${label}`);
  }
  return d.toISOString();
}

/** Normalize optional calendar date to YYYY-MM-DD, or null when cleared. */
function parseOptionalDateOnly(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new VolunteeringServiceError(`Invalid ${label}`);
  }
  const d = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new VolunteeringServiceError(`Invalid ${label}`);
  }
  return trimmed;
}

/** Optional whole-number sort key. Null/empty means no priority (sorted last). */
function parseOptionalPriority(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new VolunteeringServiceError('Priority must be a whole number');
  }
  return value;
}

async function nextPriorityForSignupKind(signupKind: VolunteerSignupKind): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ priority: schema.volunteerPrograms.priority })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.signup_kind, signupKind));
  let max = -1;
  for (const row of rows) {
    const current = normalizePriority(row.priority);
    if (current != null && current > max) max = current;
  }
  return max + 1;
}

function normalizePriority(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function clubDateOnly(instant: Date): string {
  return formatDateInTimeZone(instant, config.timeZone) ?? instant.toISOString().slice(0, 10);
}

function shiftDateOnly(startDt: string): string {
  const parsed = new Date(startDt);
  if (Number.isNaN(parsed.getTime())) return startDt.slice(0, 10);
  return clubDateOnly(parsed);
}

function normalizeDurationMinutes(value: number | undefined): number {
  const minutes = value === undefined ? 180 : Math.round(value);
  if (!Number.isFinite(minutes) || minutes < 15) {
    throw new VolunteeringServiceError('Default duration must be at least 15 minutes');
  }
  if (minutes > 24 * 60) {
    throw new VolunteeringServiceError('Default duration cannot exceed 24 hours');
  }
  return minutes;
}

export type VolunteerShiftRecurrenceInput = CalendarRecurrenceInput;

type ShiftRoleInput = { roleId: number; volunteersNeeded: number };

function requireRecurrenceLimit(recurrence: VolunteerShiftRecurrenceInput): void {
  const hasEnd = Boolean(recurrence.endDate?.trim());
  const hasCount =
    typeof recurrence.count === 'number' && Number.isFinite(recurrence.count) && recurrence.count > 0;
  if (hasEnd || hasCount) return;
  const rule = recurrence.rrule.toUpperCase();
  if (/UNTIL=/.test(rule) || /COUNT=/.test(rule)) return;
  throw new VolunteeringServiceError('Recurring shifts need an end date or a count');
}

function expandBoundedShiftRecurrence(
  startDt: string,
  endDt: string,
  recurrence: VolunteerShiftRecurrenceInput
) {
  const rrule = recurrence.rrule.trim();
  if (!rrule) throw new VolunteeringServiceError('Recurrence rule is required');
  requireRecurrenceLimit(recurrence);
  const composed = composeRecurrenceRule(recurrence);
  const instances = expandAllRecurrenceInstances(
    startDt,
    endDt,
    composed,
    config.timeZone,
    recurrence.endDate,
    recurrence.count
  );
  if (instances.length === 0) {
    throw new VolunteeringServiceError('Recurrence did not produce any shifts');
  }
  if (instances.length > MAX_MATERIALIZED_RECURRENCE_INSTANCES) {
    throw new VolunteeringServiceError(
      `Recurring shifts cannot create more than ${MAX_MATERIALIZED_RECURRENCE_INSTANCES} instances`
    );
  }
  return { composed, instances };
}

function validateShiftRoles(
  roles: ShiftRoleInput[],
  validRoleIds: Set<number>
): void {
  if (!roles.length) {
    throw new VolunteeringServiceError('Each shift needs at least one role');
  }
  const seenRoles = new Set<number>();
  for (const role of roles) {
    if (!validRoleIds.has(role.roleId)) {
      throw new VolunteeringServiceError(`Role ${role.roleId} does not belong to this program`);
    }
    if (seenRoles.has(role.roleId)) {
      throw new VolunteeringServiceError('Duplicate role on the same shift');
    }
    seenRoles.add(role.roleId);
    if (!Number.isFinite(role.volunteersNeeded) || role.volunteersNeeded < 1) {
      throw new VolunteeringServiceError('Volunteers needed must be at least 1');
    }
  }
}

function requireCreditHours(value: unknown, startDt: string, endDt: string, signupKind: VolunteerSignupKind): number {
  const parsed = parseVolunteerCreditHours(value);
  if (parsed != null) return parsed;
  return defaultVolunteerCreditHours(signupKind, startDt, endDt);
}

async function insertShiftRow(input: {
  programId: number;
  startDt: string;
  endDt: string;
  creditHours: number;
  roles: ShiftRoleInput[];
  recurrenceSeriesId?: number | null;
  recurrenceRule?: string | null;
  recurrenceDate?: string | null;
  sourceCalendarEventId?: number | null;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [created] = await db
    .insert(schema.volunteerShifts)
    .values({
      program_id: input.programId,
      start_dt: input.startDt,
      end_dt: input.endDt,
      credit_hours: input.creditHours,
      recurrence_series_id: input.recurrenceSeriesId ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      recurrence_date: input.recurrenceDate ?? null,
      source_calendar_event_id: input.sourceCalendarEventId ?? null,
    } as any)
    .returning({ id: schema.volunteerShifts.id });
  await db.insert(schema.volunteerShiftRoles).values(
    input.roles.map((role) => ({
      shift_id: created.id,
      role_id: role.roleId,
      volunteers_needed: role.volunteersNeeded,
    }))
  );
  return created.id;
}

async function syncShiftRoles(
  shiftId: number,
  programId: number,
  roles: ShiftRoleInput[]
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const programRoles = await db
    .select({ id: schema.volunteerRoles.id })
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.program_id, programId));
  const validRoleIds = new Set(programRoles.map((r) => r.id));
  validateShiftRoles(roles, validRoleIds);

  const current = await db
    .select()
    .from(schema.volunteerShiftRoles)
    .where(eq(schema.volunteerShiftRoles.shift_id, shiftId));
  const currentByRole = new Map(current.map((r) => [r.role_id, r]));
  const nextRoleIds = new Set(roles.map((r) => r.roleId));

  for (const role of roles) {
    const existingRole = currentByRole.get(role.roleId);
    if (existingRole) {
      await db
        .update(schema.volunteerShiftRoles)
        .set({
          volunteers_needed: role.volunteersNeeded,
          updated_at: new Date(),
        } as any)
        .where(eq(schema.volunteerShiftRoles.id, existingRole.id));
    } else {
      await db.insert(schema.volunteerShiftRoles).values({
        shift_id: shiftId,
        role_id: role.roleId,
        volunteers_needed: role.volunteersNeeded,
      });
    }
  }

  for (const row of current) {
    if (!nextRoleIds.has(row.role_id)) {
      await db.delete(schema.volunteerShiftRoles).where(eq(schema.volunteerShiftRoles.id, row.id));
    }
  }
}

async function addShiftException(seriesId: number, exceptionDate: string): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.volunteerShiftExceptions.id })
    .from(schema.volunteerShiftExceptions)
    .where(
      and(
        eq(schema.volunteerShiftExceptions.recurrence_series_id, seriesId),
        eq(schema.volunteerShiftExceptions.exception_date, exceptionDate)
      )
    )
    .limit(1);
  if (existing[0]) return;
  await db.insert(schema.volunteerShiftExceptions).values({
    recurrence_series_id: seriesId,
    exception_date: exceptionDate,
  });
}

async function listSeriesExceptionDates(seriesId: number): Promise<Set<string>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ exceptionDate: schema.volunteerShiftExceptions.exception_date })
    .from(schema.volunteerShiftExceptions)
    .where(eq(schema.volunteerShiftExceptions.recurrence_series_id, seriesId));
  return new Set(rows.map((r) => r.exceptionDate));
}

async function detachShiftFromSeries(shift: {
  id: number;
  recurrence_series_id: number | null;
  recurrence_date: string | null;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  if (shift.recurrence_series_id != null && shift.recurrence_date) {
    await addShiftException(shift.recurrence_series_id, shift.recurrence_date);
  }
  await db
    .update(schema.volunteerShifts)
    .set({
      recurrence_series_id: null,
      recurrence_rule: null,
      recurrence_date: null,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerShifts.id, shift.id));
}

async function deleteShiftRow(shiftId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.volunteerShifts).where(eq(schema.volunteerShifts.id, shiftId));
}

export type VolunteerMemberSummary = {
  id: number;
  name: string;
  email: string | null;
};

export type VolunteerCredentialSummary = CredentialSummary;
export type VolunteerHubCredential = HubCredential;

export type VolunteerRoleView = {
  id: number;
  programId: number;
  name: string;
  description: string | null;
  requiredCredentials: VolunteerCredentialSummary[];
  defaultDurationMinutes: number;
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
  occurrenceCount: number;
};

export type CalendarEventSignupLink = {
  slug: string;
  title: string;
  publicSignups: boolean;
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

export type DashboardOpportunityRole = {
  shiftRoleId: number;
  roleId: number;
  roleName: string;
  volunteersNeeded: number;
  volunteersRegistered: number;
  requiresCredentials: boolean;
  callerIsSignedUp: boolean;
};

export type DashboardOpportunityShift = {
  shiftId: number;
  startDt: string;
  endDt: string;
  roles: DashboardOpportunityRole[];
};

export type DashboardOpportunityProgram = {
  programId: number;
  programSlug: string;
  programTitle: string;
  description: string | null;
  location: string | null;
  totalShifts: number;
  shifts: DashboardOpportunityShift[];
};

export type MySignupView = {
  signupId: number;
  shiftRoleId: number;
  programId: number;
  programTitle: string;
  location: string | null;
  roleId: number;
  roleName: string;
  startDt: string;
  endDt: string;
  creditHours: number;
  status: 'confirmed' | 'cancelled';
  comments: string | null;
  canCancel: boolean;
};

async function isProgramManager(programId: number, memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.volunteerProgramManagers.id })
    .from(schema.volunteerProgramManagers)
    .where(
      and(
        eq(schema.volunteerProgramManagers.program_id, programId),
        eq(schema.volunteerProgramManagers.member_id, memberId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function resolveDirectCalendarEventId(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.calendarEvents.id,
      source: schema.calendarEvents.source,
      parentEventId: schema.calendarEvents.parent_event_id,
    })
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, eventId))
    .limit(1);
  if (!row) throw new VolunteeringServiceError('Calendar event not found', 404);
  if (row.source !== 'direct') {
    throw new VolunteeringServiceError('Only free-form calendar events can be attached', 400);
  }
  return row.parentEventId ?? row.id;
}

async function assertCalendarEventAvailableForProgram(
  eventId: number,
  excludeProgramId?: number
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.calendar_event_id, eventId))
    .limit(1);
  if (existing && existing.id !== excludeProgramId) {
    throw new VolunteeringServiceError('That calendar event is already attached to another sign-up', 409);
  }
}

export async function canManageProgram(member: Member, programId?: number): Promise<boolean> {
  if (isVolunteerManager(member)) return true;
  if (programId && member.id) return isProgramManager(programId, member.id);
  return false;
}

export async function listManagedVolunteerProgramIds(memberId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ programId: schema.volunteerProgramManagers.program_id })
    .from(schema.volunteerProgramManagers)
    .where(eq(schema.volunteerProgramManagers.member_id, memberId));
  return rows.map((r) => r.programId);
}

export async function listManagedProgramIds(member: Member): Promise<number[] | 'all'> {
  if (isVolunteerManager(member)) return 'all';
  return listManagedVolunteerProgramIds(member.id);
}

async function replaceProgramManagers(programId: number, managerIds: number[]): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.volunteerProgramManagers)
    .where(eq(schema.volunteerProgramManagers.program_id, programId));
  const unique = [...new Set(managerIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return;
  await db.insert(schema.volunteerProgramManagers).values(
    unique.map((memberId) => ({
      program_id: programId,
      member_id: memberId,
    }))
  );
}

async function replaceRoleCredentials(roleId: number, credentialIds: number[]): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.volunteerRoleCredentials)
    .where(eq(schema.volunteerRoleCredentials.role_id, roleId));
  const unique = [...new Set(credentialIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return;
  await db.insert(schema.volunteerRoleCredentials).values(
    unique.map((credentialId) => ({
      role_id: roleId,
      credential_id: credentialId,
    }))
  );
}

async function getMemberCredentials(memberId: number, asOfDate: string): Promise<Set<number>> {
  const grants = await getMemberCredentialGrants(memberId);
  return heldVolunteerCredentialIdsOn(grants, asOfDate);
}

async function getRoleRequiredCredentialMap(
  roleIds: number[]
): Promise<Map<number, VolunteerCredentialSummary[]>> {
  const map = new Map<number, VolunteerCredentialSummary[]>();
  if (roleIds.length === 0) return map;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      roleId: schema.volunteerRoleCredentials.role_id,
      id: schema.volunteerCredentials.id,
      name: schema.volunteerCredentials.name,
      description: schema.volunteerCredentials.description,
      pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
      systemKey: schema.volunteerCredentials.system_key,
    })
    .from(schema.volunteerRoleCredentials)
    .innerJoin(
      schema.volunteerCredentials,
      eq(schema.volunteerCredentials.id, schema.volunteerRoleCredentials.credential_id)
    )
    .where(inArray(schema.volunteerRoleCredentials.role_id, roleIds));

  for (const row of rows) {
    const list = map.get(row.roleId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      description: row.description,
      pointOfContactEmail: row.pointOfContactEmail,
      systemKey: parseSystemCredentialKey(row.systemKey),
    });
    map.set(row.roleId, list);
  }
  return map;
}

export async function createProgram(input: {
  title: string;
  slug?: string | null;
  description?: string | null;
  pointOfContact: string;
  location?: string | null;
  startDate?: string | null;
  published?: boolean;
  featureOnDashboard?: boolean;
  publicSignups?: boolean;
  signupKind?: VolunteerSignupKind;
  priority?: number | null;
  managerIds?: number[];
  calendarEventId?: number | null;
  createdByMemberId: number;
}): Promise<{ id: number; slug: string }> {
  const { db, schema } = getDrizzleDb();
  const title = input.title.trim();
  const pointOfContact = input.pointOfContact.trim();
  if (!title) throw new VolunteeringServiceError('Title is required');
  if (!pointOfContact) throw new VolunteeringServiceError('Point of contact is required');
  const startDate = parseOptionalDateOnly(input.startDate, 'start date');
  const clubName = await getConfiguredClubName();
  const slug = await ensureUniqueVolunteerProgramSlug(input.slug?.trim() || title);
  const signupKind = parseVolunteerSignupKind(input.signupKind);
  const priority =
    input.priority !== undefined
      ? parseOptionalPriority(input.priority)
      : await nextPriorityForSignupKind(signupKind);
  const canFeature = signupKind === 'volunteering';
  let calendarEventId: number | null = null;
  if (input.calendarEventId != null) {
    calendarEventId = await resolveDirectCalendarEventId(input.calendarEventId);
    await assertCalendarEventAvailableForProgram(calendarEventId);
  }

  let row: { id: number; slug: string };
  try {
    const inserted = await db
      .insert(schema.volunteerPrograms)
      .values({
        title,
        slug,
        description: input.description?.trim() || null,
        point_of_contact: pointOfContact,
        location: normalizeVolunteerLocation(input.location, clubName),
        start_date: startDate,
        published: input.published ? 1 : 0,
        // Default on so volunteering programs surface on dashboards unless explicitly opted out.
        feature_on_dashboard: canFeature && input.featureOnDashboard !== false ? 1 : 0,
        public_signups: input.publicSignups ? 1 : 0,
        signup_kind: signupKind,
        priority,
        calendar_event_id: calendarEventId,
        created_by_member_id: input.createdByMemberId,
      } as any)
      .returning({ id: schema.volunteerPrograms.id, slug: schema.volunteerPrograms.slug });
    row = inserted[0];
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new VolunteeringServiceError('That calendar event is already attached to another sign-up', 409);
    }
    throw err;
  }

  await replaceProgramManagers(row.id, input.managerIds ?? []);
  return { id: row.id, slug: row.slug };
}

export async function updateProgram(
  programId: number,
  input: {
    title?: string;
    slug?: string | null;
    description?: string | null;
    pointOfContact?: string;
    location?: string | null;
    startDate?: string | null;
    published?: boolean;
    featureOnDashboard?: boolean;
    publicSignups?: boolean;
    signupKind?: VolunteerSignupKind;
    priority?: number | null;
    managerIds?: number[];
    calendarEventId?: number | null;
  }
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, programId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Program not found', 404);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new VolunteeringServiceError('Title is required');
    patch.title = title;
  }
  if (input.slug !== undefined) {
    const rawSlug = input.slug?.trim() || String(input.title ?? existing[0].title);
    patch.slug = await ensureUniqueVolunteerProgramSlug(rawSlug, programId);
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.pointOfContact !== undefined) {
    const poc = input.pointOfContact.trim();
    if (!poc) throw new VolunteeringServiceError('Point of contact is required');
    patch.point_of_contact = poc;
  }
  if (input.location !== undefined) {
    const clubName = await getConfiguredClubName();
    patch.location = normalizeVolunteerLocation(input.location, clubName);
  }
  if (input.startDate !== undefined) {
    patch.start_date = parseOptionalDateOnly(input.startDate, 'start date');
  }
  if (input.published !== undefined) {
    patch.published = input.published ? 1 : 0;
  }
  const nextSignupKind =
    input.signupKind !== undefined
      ? parseVolunteerSignupKind(input.signupKind)
      : parseVolunteerSignupKind(existing[0].signup_kind);
  if (input.signupKind !== undefined) {
    patch.signup_kind = nextSignupKind;
  }
  if (nextSignupKind === 'general') {
    patch.feature_on_dashboard = 0;
  } else if (input.featureOnDashboard !== undefined) {
    patch.feature_on_dashboard = input.featureOnDashboard ? 1 : 0;
  }
  if (input.publicSignups !== undefined) {
    patch.public_signups = input.publicSignups ? 1 : 0;
  }
  if (input.priority !== undefined) {
    patch.priority = parseOptionalPriority(input.priority);
  }
  if (input.calendarEventId !== undefined) {
    if (input.calendarEventId == null) {
      patch.calendar_event_id = null;
    } else {
      const resolved = await resolveDirectCalendarEventId(input.calendarEventId);
      await assertCalendarEventAvailableForProgram(resolved, programId);
      patch.calendar_event_id = resolved;
    }
  }

  try {
    await db.update(schema.volunteerPrograms).set(patch as any).where(eq(schema.volunteerPrograms.id, programId));
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new VolunteeringServiceError('That calendar event is already attached to another sign-up', 409);
    }
    throw err;
  }

  if (input.calendarEventId !== undefined) {
    const previous = existing[0].calendar_event_id ?? null;
    const next = (patch.calendar_event_id as number | null | undefined) ?? null;
    if (previous != null && previous !== next) {
      await unlinkCalendarSyncedShifts(programId, previous);
    }
  }

  if (input.managerIds !== undefined) {
    await replaceProgramManagers(programId, input.managerIds);
  }
}

export async function reorderPrograms(input: {
  programIds: number[];
  signupKind: VolunteerSignupKind;
}): Promise<void> {
  if (input.programIds.length === 0) return;
  const seen = new Set<number>();
  for (const id of input.programIds) {
    if (seen.has(id)) throw new VolunteeringServiceError('Program order contains duplicates', 400);
    seen.add(id);
  }

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerPrograms.id,
      signupKind: schema.volunteerPrograms.signup_kind,
    })
    .from(schema.volunteerPrograms)
    .where(inArray(schema.volunteerPrograms.id, input.programIds));
  if (rows.length !== input.programIds.length) {
    throw new VolunteeringServiceError('One or more programs were not found', 404);
  }
  for (const row of rows) {
    if (parseVolunteerSignupKind(row.signupKind) !== input.signupKind) {
      throw new VolunteeringServiceError('All programs must match the list type', 400);
    }
  }

  for (let index = 0; index < input.programIds.length; index += 1) {
    await db
      .update(schema.volunteerPrograms)
      .set({ priority: index, updated_at: new Date() } as any)
      .where(eq(schema.volunteerPrograms.id, input.programIds[index]));
  }
}

export async function archiveProgram(programId: number, archive: boolean): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, programId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Program not found', 404);

  await db
    .update(schema.volunteerPrograms)
    .set({
      archived_at: archive ? new Date() : null,
      // Match events: archiving also unpublishes so restore does not reappear on the hub.
      ...(archive ? { published: 0 } : {}),
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerPrograms.id, programId));
}

export async function deleteProgram(programId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, programId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Program not found', 404);
  await db.delete(schema.volunteerPrograms).where(eq(schema.volunteerPrograms.id, programId));
}

export type DuplicateProgramInput = {
  title: string;
  pointOfContact: string;
  location?: string | null;
  startDate: string | null;
  managerIds?: number[];
  createdByMemberId: number;
};

/**
 * Copy a program with its roles and shifts. Sign-ups are not copied.
 * Shift datetimes move by the calendar-day delta between the source program
 * start date (or earliest shift day) and the new start date, keeping wall-clock
 * times in the club timezone.
 */
export async function duplicateProgram(
  sourceProgramId: number,
  input: DuplicateProgramInput
): Promise<{ id: number; slug: string }> {
  const { db, schema } = getDrizzleDb();
  const sourceRows = await db
    .select()
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, sourceProgramId))
    .limit(1);
  const source = sourceRows[0];
  if (!source) throw new VolunteeringServiceError('Program not found', 404);

  const title = input.title.trim();
  const pointOfContact = input.pointOfContact.trim();
  if (!title) throw new VolunteeringServiceError('Title is required');
  if (!pointOfContact) throw new VolunteeringServiceError('Point of contact is required');
  const newStartDate = parseOptionalDateOnly(input.startDate, 'start date');

  const sourceShifts = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.program_id, sourceProgramId))
    .orderBy(asc(schema.volunteerShifts.start_dt));

  if (sourceShifts.length > 0 && !newStartDate) {
    throw new VolunteeringServiceError('Start date is required when the program has shifts');
  }

  const timeZone = config.timeZone;
  let dayDelta = 0;
  if (sourceShifts.length > 0 && newStartDate) {
    const sourceStartDate =
      formatDateInTimeZone(new Date(requireIso(sourceShifts[0].start_dt as any, 'start datetime')), timeZone) ||
      normalizeDateOnly(source.start_date);
    if (!sourceStartDate) {
      throw new VolunteeringServiceError('Could not determine source program start date for shift shifting');
    }
    dayDelta = calendarDaysBetween(sourceStartDate, newStartDate);
    if (!Number.isFinite(dayDelta)) {
      throw new VolunteeringServiceError('Invalid start date for shift shifting');
    }
  }

  const created = await createProgram({
    title,
    description: source.description,
    pointOfContact,
    location: input.location !== undefined ? input.location : source.location,
    startDate: newStartDate,
    featureOnDashboard: Number(source.feature_on_dashboard) === 1,
    publicSignups: Number(source.public_signups) === 1,
    signupKind: parseVolunteerSignupKind(source.signup_kind),
    priority: normalizePriority(source.priority),
    managerIds: input.managerIds,
    createdByMemberId: input.createdByMemberId,
  });

  const sourceRoles = await db
    .select()
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.program_id, sourceProgramId))
    .orderBy(asc(schema.volunteerRoles.id));

  const roleIdMap = new Map<number, number>();
  for (const role of sourceRoles) {
    const creds = await db
      .select({ credentialId: schema.volunteerRoleCredentials.credential_id })
      .from(schema.volunteerRoleCredentials)
      .where(eq(schema.volunteerRoleCredentials.role_id, role.id));
    const createdRole = await createRole({
      programId: created.id,
      name: role.name,
      description: role.description,
      defaultDurationMinutes: role.default_duration_minutes ?? 180,
      requiredCredentialIds: creds.map((c) => c.credentialId),
    });
    roleIdMap.set(role.id, createdRole.id);
  }

  if (sourceShifts.length > 0) {
    const sourceShiftIds = sourceShifts.map((s) => s.id);
    const sourceShiftRoles = await db
      .select()
      .from(schema.volunteerShiftRoles)
      .where(inArray(schema.volunteerShiftRoles.shift_id, sourceShiftIds));

    const mappedRolesFor = (shiftId: number): ShiftRoleInput[] => {
      const roles = sourceShiftRoles
        .filter((sr) => sr.shift_id === shiftId)
        .map((sr) => {
          const newRoleId = roleIdMap.get(sr.role_id);
          if (newRoleId == null) {
            throw new VolunteeringServiceError(`Missing mapped role for shift role ${sr.id}`);
          }
          return { roleId: newRoleId, volunteersNeeded: sr.volunteers_needed };
        });
      if (roles.length === 0) {
        throw new VolunteeringServiceError('Each shift needs at least one role');
      }
      return roles;
    };

    const seriesIds = [
      ...new Set(
        sourceShifts
          .map((s) => s.recurrence_series_id)
          .filter((id): id is number => id != null)
      ),
    ];
    const sourceExceptions =
      seriesIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.volunteerShiftExceptions)
            .where(inArray(schema.volunteerShiftExceptions.recurrence_series_id, seriesIds));

    const copiedSeries = new Set<number>();
    for (const shift of sourceShifts) {
      const seriesId = shift.recurrence_series_id;
      if (seriesId != null) {
        if (copiedSeries.has(seriesId)) continue;
        copiedSeries.add(seriesId);
        const members = sourceShifts.filter((s) => s.recurrence_series_id === seriesId);
        let newSeriesId: number | null = null;
        for (const memberShift of members) {
          const startDt = shiftInstantByCalendarDays(
            requireIso(memberShift.start_dt as any, 'start datetime'),
            dayDelta,
            timeZone
          );
          const endDt = shiftInstantByCalendarDays(
            requireIso(memberShift.end_dt as any, 'end datetime'),
            dayDelta,
            timeZone
          );
          const recurrenceDate = memberShift.recurrence_date
            ? addCalendarDays(memberShift.recurrence_date, dayDelta)
            : formatDateInTimeZone(new Date(startDt), timeZone);
          const recurrenceRule = memberShift.recurrence_rule
            ? shiftRecurrenceRuleByDays(memberShift.recurrence_rule, dayDelta)
            : null;
          const createdId = await insertShiftRow({
            programId: created.id,
            startDt,
            endDt,
            creditHours: requireCreditHours(
              (memberShift as { credit_hours?: unknown }).credit_hours,
              startDt,
              endDt,
              parseVolunteerSignupKind(source.signup_kind)
            ),
            roles: mappedRolesFor(memberShift.id),
            recurrenceSeriesId: newSeriesId,
            recurrenceRule,
            recurrenceDate,
          });
          if (newSeriesId == null) {
            newSeriesId = createdId;
            await db
              .update(schema.volunteerShifts)
              .set({ recurrence_series_id: newSeriesId, updated_at: new Date() } as any)
              .where(eq(schema.volunteerShifts.id, createdId));
          }
        }
        if (newSeriesId != null) {
          const exceptions = sourceExceptions.filter((ex) => ex.recurrence_series_id === seriesId);
          for (const ex of exceptions) {
            const shiftedDate = addCalendarDays(ex.exception_date, dayDelta);
            await addShiftException(newSeriesId, shiftedDate);
          }
        }
        continue;
      }

      const startDt = shiftInstantByCalendarDays(
        requireIso(shift.start_dt as any, 'start datetime'),
        dayDelta,
        timeZone
      );
      const endDt = shiftInstantByCalendarDays(
        requireIso(shift.end_dt as any, 'end datetime'),
        dayDelta,
        timeZone
      );
      await insertShiftRow({
        programId: created.id,
        startDt,
        endDt,
        creditHours: requireCreditHours(
          (shift as { credit_hours?: unknown }).credit_hours,
          startDt,
          endDt,
          parseVolunteerSignupKind(source.signup_kind)
        ),
        roles: mappedRolesFor(shift.id),
      });
    }
  }

  return created;
}

export async function createRole(input: {
  programId: number;
  name: string;
  description?: string | null;
  defaultDurationMinutes?: number;
  requiredCredentialIds?: number[];
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const name = input.name.trim();
  if (!name) throw new VolunteeringServiceError('Role name is required');
  const defaultDurationMinutes = normalizeDurationMinutes(input.defaultDurationMinutes);

  const program = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, input.programId))
    .limit(1);
  if (!program[0]) throw new VolunteeringServiceError('Program not found', 404);

  const [row] = await db
    .insert(schema.volunteerRoles)
    .values({
      program_id: input.programId,
      name,
      description: input.description?.trim() || null,
      default_duration_minutes: defaultDurationMinutes,
    } as any)
    .returning({ id: schema.volunteerRoles.id });

  await replaceRoleCredentials(row.id, input.requiredCredentialIds ?? []);
  return { id: row.id };
}

export async function updateRole(
  roleId: number,
  input: {
    name?: string;
    description?: string | null;
    defaultDurationMinutes?: number;
    requiredCredentialIds?: number[];
  }
): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.id, roleId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Role not found', 404);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new VolunteeringServiceError('Role name is required');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.defaultDurationMinutes !== undefined) {
    patch.default_duration_minutes = normalizeDurationMinutes(input.defaultDurationMinutes);
  }

  await db.update(schema.volunteerRoles).set(patch as any).where(eq(schema.volunteerRoles.id, roleId));
  if (input.requiredCredentialIds !== undefined) {
    await replaceRoleCredentials(roleId, input.requiredCredentialIds);
  }
  return { programId: existing[0].program_id };
}

export async function deleteRole(roleId: number): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.id, roleId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Role not found', 404);
  await db.delete(schema.volunteerRoles).where(eq(schema.volunteerRoles.id, roleId));
  return { programId: existing[0].program_id };
}

export async function createShiftsBulk(input: {
  programId: number;
  shifts: Array<{
    startDt: string;
    endDt: string;
    creditHours?: number | null;
    roles: Array<{ roleId: number; volunteersNeeded: number }>;
  }>;
  recurrence?: VolunteerShiftRecurrenceInput;
}): Promise<{ shiftIds: number[] }> {
  const { db, schema } = getDrizzleDb();
  if (!input.shifts.length) throw new VolunteeringServiceError('At least one shift is required');
  if (input.recurrence && input.shifts.length !== 1) {
    throw new VolunteeringServiceError('Recurring shifts cannot be combined with additional shifts');
  }

  const program = await db
    .select({ id: schema.volunteerPrograms.id, signupKind: schema.volunteerPrograms.signup_kind })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, input.programId))
    .limit(1);
  if (!program[0]) throw new VolunteeringServiceError('Program not found', 404);
  const signupKind = parseVolunteerSignupKind(program[0].signupKind);

  const programRoles = await db
    .select({ id: schema.volunteerRoles.id })
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.program_id, input.programId));
  const validRoleIds = new Set(programRoles.map((r) => r.id));

  const templates = input.recurrence
    ? (() => {
        const shift = input.shifts[0];
        const startDt = parseDateInput(shift.startDt, 'start datetime');
        const endDt = parseDateInput(shift.endDt, 'end datetime');
        if (new Date(endDt) <= new Date(startDt)) {
          throw new VolunteeringServiceError('Shift end must be after start');
        }
        validateShiftRoles(shift.roles, validRoleIds);
        const { composed, instances } = expandBoundedShiftRecurrence(startDt, endDt, input.recurrence!);
        const creditHours = requireCreditHours(shift.creditHours, startDt, endDt, signupKind);
        return instances.map((inst) => ({
          startDt: inst.start,
          endDt: inst.end,
          creditHours,
          roles: shift.roles,
          recurrenceRule: composed,
          recurrenceDate: inst.recurrenceDate,
        }));
      })()
    : input.shifts.map((shift) => {
        const startDt = parseDateInput(shift.startDt, 'start datetime');
        const endDt = parseDateInput(shift.endDt, 'end datetime');
        if (new Date(endDt) <= new Date(startDt)) {
          throw new VolunteeringServiceError('Shift end must be after start');
        }
        validateShiftRoles(shift.roles, validRoleIds);
        return {
          startDt,
          endDt,
          creditHours: requireCreditHours(shift.creditHours, startDt, endDt, signupKind),
          roles: shift.roles,
          recurrenceRule: null as string | null,
          recurrenceDate: null as string | null,
        };
      });

  const shiftIds: number[] = [];
  let seriesId: number | null = null;
  for (const template of templates) {
    const createdId = await insertShiftRow({
      programId: input.programId,
      startDt: template.startDt,
      endDt: template.endDt,
      creditHours: template.creditHours,
      roles: template.roles,
      recurrenceSeriesId: seriesId,
      recurrenceRule: template.recurrenceRule,
      recurrenceDate: template.recurrenceDate,
    });
    shiftIds.push(createdId);
    if (input.recurrence && seriesId == null) {
      seriesId = createdId;
      await db
        .update(schema.volunteerShifts)
        .set({ recurrence_series_id: seriesId, updated_at: new Date() } as any)
        .where(eq(schema.volunteerShifts.id, createdId));
    }
  }

  return { shiftIds };
}

async function applyTimesToSeriesMember(input: {
  shiftId: number;
  recurrenceDate: string;
  startTime: string;
  endTime: string;
  daySpan: number;
  recurrenceRule: string;
  creditHours?: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const timeZone = config.timeZone;
  const startDt = localDateTimeToIso(input.recurrenceDate, input.startTime, timeZone);
  const endDt = localDateTimeToIso(addCalendarDays(input.recurrenceDate, input.daySpan), input.endTime, timeZone);
  if (new Date(endDt) <= new Date(startDt)) {
    throw new VolunteeringServiceError('Shift end must be after start');
  }
  const patch: Record<string, unknown> = {
    start_dt: startDt,
    end_dt: endDt,
    recurrence_rule: input.recurrenceRule,
    recurrence_date: input.recurrenceDate,
    updated_at: new Date(),
  };
  if (input.creditHours != null) patch.credit_hours = input.creditHours;
  await db
    .update(schema.volunteerShifts)
    .set(patch as any)
    .where(eq(schema.volunteerShifts.id, input.shiftId));
}

async function reconcileShiftSeries(input: {
  seriesId: number;
  programId: number;
  startDt: string;
  endDt: string;
  creditHours?: number;
  roles?: ShiftRoleInput[];
  recurrence: VolunteerShiftRecurrenceInput;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { composed, instances } = expandBoundedShiftRecurrence(input.startDt, input.endDt, input.recurrence);
  const exceptions = await listSeriesExceptionDates(input.seriesId);
  const kept = instances.filter((inst) => !exceptions.has(inst.recurrenceDate));
  if (kept.length === 0) {
    throw new VolunteeringServiceError('Recurrence did not produce any remaining shifts');
  }

  const existing = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.recurrence_series_id, input.seriesId));
  const byDate = new Map(
    existing
      .filter((row) => row.recurrence_date)
      .map((row) => [row.recurrence_date as string, row])
  );
  const keepDates = new Set(kept.map((inst) => inst.recurrenceDate));

  for (const inst of kept) {
    const current = byDate.get(inst.recurrenceDate);
    if (current) {
      const patch: Record<string, unknown> = {
        start_dt: inst.start,
        end_dt: inst.end,
        recurrence_rule: composed,
        recurrence_date: inst.recurrenceDate,
        updated_at: new Date(),
      };
      if (input.creditHours != null) patch.credit_hours = input.creditHours;
      await db
        .update(schema.volunteerShifts)
        .set(patch as any)
        .where(eq(schema.volunteerShifts.id, current.id));
      if (input.roles) {
        await syncShiftRoles(current.id, input.programId, input.roles);
      }
    } else {
      const roles =
        input.roles ??
        (
          await db
            .select()
            .from(schema.volunteerShiftRoles)
            .where(eq(schema.volunteerShiftRoles.shift_id, existing[0]?.id ?? input.seriesId))
        ).map((r) => ({ roleId: r.role_id, volunteersNeeded: r.volunteers_needed }));
      if (!roles.length) {
        throw new VolunteeringServiceError('Each shift needs at least one role');
      }
      await insertShiftRow({
        programId: input.programId,
        startDt: inst.start,
        endDt: inst.end,
        creditHours:
          input.creditHours ??
          (existing[0] ? Number((existing[0] as { credit_hours?: unknown }).credit_hours) || 0 : 0),
        roles,
        recurrenceSeriesId: input.seriesId,
        recurrenceRule: composed,
        recurrenceDate: inst.recurrenceDate,
      });
    }
  }

  for (const row of existing) {
    if (!row.recurrence_date || !keepDates.has(row.recurrence_date)) {
      await deleteShiftRow(row.id);
    }
  }
}

export async function updateShift(
  shiftId: number,
  input: {
    startDt?: string;
    endDt?: string;
    creditHours?: number | null;
    roles?: Array<{ roleId: number; volunteersNeeded: number }>;
    scope?: 'this' | 'all';
    recurrence?: VolunteerShiftRecurrenceInput;
  }
): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.id, shiftId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Shift not found', 404);

  if (existing[0].source_calendar_event_id != null) {
    const seriesId = existing[0].recurrence_series_id;
    const scope = input.scope ?? 'this';
    const creditHours = parseVolunteerCreditHours(input.creditHours);
    const targetIds =
      seriesId != null && scope === 'all'
        ? (
            await db
              .select({ id: schema.volunteerShifts.id })
              .from(schema.volunteerShifts)
              .where(eq(schema.volunteerShifts.recurrence_series_id, seriesId))
          ).map((row) => row.id)
        : [shiftId];
    if (creditHours != null) {
      await db
        .update(schema.volunteerShifts)
        .set({ credit_hours: creditHours, updated_at: new Date() } as any)
        .where(inArray(schema.volunteerShifts.id, targetIds));
    }
    if (input.roles !== undefined) {
      for (const id of targetIds) {
        await syncShiftRoles(id, existing[0].program_id, input.roles);
      }
    }
    return { programId: existing[0].program_id };
  }

  const startDt = input.startDt
    ? parseDateInput(input.startDt, 'start datetime')
    : requireIso(existing[0].start_dt as any, 'start datetime');
  const endDt = input.endDt
    ? parseDateInput(input.endDt, 'end datetime')
    : requireIso(existing[0].end_dt as any, 'end datetime');
  if (new Date(endDt) <= new Date(startDt)) {
    throw new VolunteeringServiceError('Shift end must be after start');
  }

  const seriesId = existing[0].recurrence_series_id;
  const scope = input.scope ?? 'this';
  const isSeriesEdit = seriesId != null && scope === 'all';

  if (isSeriesEdit) {
    const timeZone = config.timeZone;
    const startDate = formatDateInTimeZone(new Date(startDt), timeZone);
    const existingDate = existing[0].recurrence_date;
    const dateChanged = Boolean(startDate && existingDate && startDate !== existingDate);
    const nextRecurrence: VolunteerShiftRecurrenceInput | null = input.recurrence
      ? {
          rrule: input.recurrence.rrule,
          endDate: input.recurrence.endDate,
          count: input.recurrence.count,
        }
      : existing[0].recurrence_rule
        ? { rrule: existing[0].recurrence_rule }
        : null;
    const composedNext = nextRecurrence ? composeRecurrenceRule(nextRecurrence) : null;
    const storedComposed = existing[0].recurrence_rule ?? null;
    const ruleChanged = Boolean(
      composedNext && storedComposed && !recurrenceRulesEquivalent(composedNext, storedComposed)
    );

    if (nextRecurrence && (dateChanged || ruleChanged)) {
      await reconcileShiftSeries({
        seriesId,
        programId: existing[0].program_id,
        startDt,
        endDt,
        creditHours: parseVolunteerCreditHours(input.creditHours) ?? undefined,
        roles: input.roles,
        recurrence: nextRecurrence,
      });
      return { programId: existing[0].program_id };
    }

    const startTime = formatTimeInTimeZone(new Date(startDt), timeZone);
    const endTime = formatTimeInTimeZone(new Date(endDt), timeZone);
    const startDateStr = formatDateInTimeZone(new Date(startDt), timeZone);
    const endDateStr = formatDateInTimeZone(new Date(endDt), timeZone);
    if (!startTime || !endTime || !startDateStr || !endDateStr) {
      throw new VolunteeringServiceError('Invalid shift datetime');
    }
    const daySpan = calendarDaysBetween(startDateStr, endDateStr);
    const members = await db
      .select()
      .from(schema.volunteerShifts)
      .where(eq(schema.volunteerShifts.recurrence_series_id, seriesId));
    const rule = composedNext ?? existing[0].recurrence_rule ?? '';
    for (const member of members) {
      const recurrenceDate =
        member.recurrence_date || formatDateInTimeZone(new Date(requireIso(member.start_dt as any, 'start datetime')), timeZone);
      if (!recurrenceDate) continue;
      await applyTimesToSeriesMember({
        shiftId: member.id,
        recurrenceDate,
        startTime,
        endTime,
        daySpan,
        recurrenceRule: rule,
        creditHours: parseVolunteerCreditHours(input.creditHours) ?? undefined,
      });
      if (input.roles) {
        await syncShiftRoles(member.id, existing[0].program_id, input.roles);
      }
    }
    return { programId: existing[0].program_id };
  }

  const singlePatch: Record<string, unknown> = {
    start_dt: startDt,
    end_dt: endDt,
    updated_at: new Date(),
  };
  const creditHours = parseVolunteerCreditHours(input.creditHours);
  if (creditHours != null) singlePatch.credit_hours = creditHours;
  await db
    .update(schema.volunteerShifts)
    .set(singlePatch as any)
    .where(eq(schema.volunteerShifts.id, shiftId));

  if (input.roles !== undefined) {
    await syncShiftRoles(shiftId, existing[0].program_id, input.roles);
  }

  if (seriesId != null && scope === 'this') {
    await detachShiftFromSeries(existing[0]);
  }

  return { programId: existing[0].program_id };
}

export async function deleteShift(
  shiftId: number,
  scope: 'this' | 'all' = 'this'
): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.id, shiftId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Shift not found', 404);

  const seriesId = existing[0].recurrence_series_id;
  if (seriesId != null && scope === 'all') {
    await db.delete(schema.volunteerShifts).where(eq(schema.volunteerShifts.recurrence_series_id, seriesId));
    await db
      .delete(schema.volunteerShiftExceptions)
      .where(eq(schema.volunteerShiftExceptions.recurrence_series_id, seriesId));
    return { programId: existing[0].program_id };
  }

  if (seriesId != null && existing[0].recurrence_date) {
    await addShiftException(seriesId, existing[0].recurrence_date);
  }
  await deleteShiftRow(shiftId);
  return { programId: existing[0].program_id };
}


async function buildProgramViews(options: {
  member: Member;
  includeArchived: boolean;
  programIds?: number[] | 'all';
  upcomingOnly?: boolean;
  forHub?: boolean;
}): Promise<VolunteerProgramView[]> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const [heldGrants, clubName] = await Promise.all([
    getMemberCredentialGrants(options.member.id),
    getConfiguredClubName(),
  ]);

  let programs = await db.select().from(schema.volunteerPrograms).orderBy(asc(schema.volunteerPrograms.title));
  if (!options.includeArchived) {
    programs = programs.filter((p) => !p.archived_at);
  }
  if (options.forHub) {
    programs = programs.filter((p) => Number(p.published) === 1);
  }
  if (options.programIds !== undefined && options.programIds !== 'all') {
    const idSet = new Set(options.programIds);
    programs = programs.filter((p) => idSet.has(p.id));
  }
  if (programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);
  const globalManager = isVolunteerManager(options.member);

  const calendarEventIds = [
    ...new Set(
      programs
        .map((program) => program.calendar_event_id)
        .filter((id): id is number => id != null)
    ),
  ];
  const calendarEventById = new Map<number, VolunteerAttachedCalendarEvent>();
  if (calendarEventIds.length > 0) {
    const eventRows = await db
      .select({
        id: schema.calendarEvents.id,
        title: schema.calendarEvents.title,
        startDt: schema.calendarEvents.start_dt,
        endDt: schema.calendarEvents.end_dt,
        allDay: schema.calendarEvents.all_day,
        recurrenceRule: schema.calendarEvents.recurrence_rule,
        parentEventId: schema.calendarEvents.parent_event_id,
      })
      .from(schema.calendarEvents)
      .where(inArray(schema.calendarEvents.id, calendarEventIds));
    for (const [eventId, detail] of await describeDirectCalendarEvents(calendarEventIds)) {
      calendarEventById.set(eventId, detail.event);
    }
  }

  const managers = await db
    .select({
      programId: schema.volunteerProgramManagers.program_id,
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.volunteerProgramManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerProgramManagers.member_id))
    .where(inArray(schema.volunteerProgramManagers.program_id, programIds));

  const roles = await db
    .select()
    .from(schema.volunteerRoles)
    .where(inArray(schema.volunteerRoles.program_id, programIds))
    .orderBy(asc(schema.volunteerRoles.name));
  const roleIds = roles.map((r) => r.id);
  const roleCredMap = await getRoleRequiredCredentialMap(roleIds);

  let shiftsQuery = db
    .select()
    .from(schema.volunteerShifts)
    .where(inArray(schema.volunteerShifts.program_id, programIds))
    .orderBy(asc(schema.volunteerShifts.start_dt));
  let shifts = await shiftsQuery;
  if (options.upcomingOnly) {
    shifts = shifts.filter((s) => requireIso(s.start_dt as any, 'start') >= nowIso);
  }

  const shiftIds = shifts.map((s) => s.id);
  const shiftRoles =
    shiftIds.length === 0
      ? []
      : await db
          .select({
            id: schema.volunteerShiftRoles.id,
            shiftId: schema.volunteerShiftRoles.shift_id,
            roleId: schema.volunteerShiftRoles.role_id,
            volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
            roleName: schema.volunteerRoles.name,
            roleDescription: schema.volunteerRoles.description,
          })
          .from(schema.volunteerShiftRoles)
          .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
          .where(inArray(schema.volunteerShiftRoles.shift_id, shiftIds));

  const shiftRoleIds = shiftRoles.map((sr) => sr.id);
  const signups =
    shiftRoleIds.length === 0
      ? []
      : await db
          .select({
            id: schema.volunteerSignups.id,
            shiftRoleId: schema.volunteerSignups.shift_role_id,
            memberId: schema.volunteerSignups.member_id,
            memberName: schema.members.name,
            memberEmail: schema.members.email,
            memberPhone: schema.members.phone,
            guestName: schema.volunteerSignups.guest_name,
            guestEmail: schema.volunteerSignups.guest_email,
            comments: schema.volunteerSignups.comments,
            signedUpByMemberId: schema.volunteerSignups.signed_up_by_member_id,
            status: schema.volunteerSignups.status,
            createdAt: schema.volunteerSignups.created_at,
          })
          .from(schema.volunteerSignups)
          .leftJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
          .where(
            and(
              inArray(schema.volunteerSignups.shift_role_id, shiftRoleIds),
              eq(schema.volunteerSignups.status, 'confirmed')
            )
          );

  return programs.map((program) => {
    const programManagers = managers
      .filter((m) => m.programId === program.id)
      .map((m) => ({ id: m.id, name: m.name, email: m.email }));
    const canManage =
      globalManager || programManagers.some((m) => m.id === options.member.id);

    const programRoles: VolunteerRoleView[] = roles
      .filter((r) => r.program_id === program.id)
      .map((r) => ({
        id: r.id,
        programId: r.program_id,
        name: r.name,
        description: r.description,
        defaultDurationMinutes: r.default_duration_minutes ?? 180,
        requiredCredentials: roleCredMap.get(r.id) ?? [],
      }));

    const programShifts: VolunteerShiftView[] = shifts
      .filter((s) => s.program_id === program.id)
      .map((shift) => {
        const shiftStart = requireIso(shift.start_dt as any, 'startDt');
        const heldCredentials = heldVolunteerCredentialIdsOn(heldGrants, shiftDateOnly(shiftStart));
        const rolesForShift: VolunteerShiftRoleView[] = shiftRoles
          .filter((sr) => sr.shiftId === shift.id)
          .map((sr) => {
            const required = roleCredMap.get(sr.roleId) ?? [];
            const roleSignups = signups
              .filter((su) => su.shiftRoleId === sr.id)
              .map((su) => {
                const displayName =
                  normalizePersonName(su.memberName) ||
                  normalizePersonName(su.guestName) ||
                  'Volunteer';
                return {
                  id: su.id,
                  memberId: su.memberId ?? null,
                  memberName: displayName,
                  guestName: su.guestName ?? null,
                  guestEmail: su.guestEmail ?? null,
                  memberEmail: options.forHub ? null : su.memberEmail ?? null,
                  memberPhone: options.forHub ? null : su.memberPhone ?? null,
                  comments: su.comments ?? null,
                  signedUpByMemberId: su.signedUpByMemberId ?? null,
                  status: su.status as 'confirmed' | 'cancelled',
                  createdAt: requireIso(su.createdAt as any, 'createdAt'),
                };
              });
            return {
              id: sr.id,
              shiftId: sr.shiftId,
              roleId: sr.roleId,
              roleName: sr.roleName,
              roleDescription: sr.roleDescription,
              volunteersNeeded: sr.volunteersNeeded,
              volunteersRegistered: roleSignups.length,
              isFull: roleSignups.length >= sr.volunteersNeeded,
              requiredCredentials: required,
              callerHasCredentials: memberHasAllVolunteerCredentials(heldCredentials, required),
              callerIsSignedUp: roleSignups.some((su) => su.memberId === options.member.id),
              signups: roleSignups,
            };
          });

        return {
          id: shift.id,
          programId: shift.program_id,
          startDt: shiftStart,
          endDt: requireIso(shift.end_dt as any, 'endDt'),
          creditHours: requireCreditHours(
            (shift as { credit_hours?: unknown }).credit_hours,
            shiftStart,
            requireIso(shift.end_dt as any, 'endDt'),
            parseVolunteerSignupKind(program.signup_kind)
          ),
          recurrenceSeriesId: shift.recurrence_series_id ?? null,
          recurrenceRule: shift.recurrence_rule ?? null,
          recurrenceDate: shift.recurrence_date ?? null,
          sourceCalendarEventId: shift.source_calendar_event_id ?? null,
          roles: rolesForShift,
        };
      });

    return {
      id: program.id,
      title: program.title,
      slug: String(program.slug),
      description: program.description,
      pointOfContact: program.point_of_contact,
      location: normalizeVolunteerLocation(program.location, clubName),
      startDate: normalizeDateOnly(program.start_date as any),
      published: Number(program.published) === 1,
      featureOnDashboard: Number(program.feature_on_dashboard) === 1,
      publicSignups: Number(program.public_signups) === 1,
      signupKind: parseVolunteerSignupKind(program.signup_kind),
      priority: normalizePriority(program.priority),
      archivedAt: toIso(program.archived_at as any),
      createdAt: requireIso(program.created_at as any, 'createdAt'),
      updatedAt: requireIso(program.updated_at as any, 'updatedAt'),
      managers: programManagers,
      roles: programRoles,
      shifts: programShifts,
      canManage,
      calendarEvent: program.calendar_event_id != null
        ? calendarEventById.get(program.calendar_event_id) ?? null
        : null,
    };
  });
}

export async function listDirectCalendarEventsOnDate(
  dateYmd: string
): Promise<DirectCalendarEventChoice[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new VolunteeringServiceError('Date must be YYYY-MM-DD', 400);
  }
  const timeZone = config.timeZone;
  const rangeStartIso = localDateTimeToIso(dateYmd, '00:00:00', timeZone);
  const rangeEndIso = localDateTimeToIso(addCalendarDays(dateYmd, 1), '00:00:00', timeZone);
  const padStart = new Date(localDateTimeToIso(addCalendarDays(dateYmd, -1), '00:00:00', timeZone));
  const padEnd = new Date(localDateTimeToIso(addCalendarDays(dateYmd, 2), '00:00:00', timeZone));
  const events = await fetchDirectCalendarEventsForRange(padStart, padEnd);
  return pickDirectCalendarEventsOverlappingRange(events, rangeStartIso, rangeEndIso);
}

type DirectCalendarEventDetail = {
  event: VolunteerAttachedCalendarEvent;
  occurrences: CalendarOccurrence[];
  recurrenceRule: string | null;
};

async function describeDirectCalendarEvents(
  eventIds: number[]
): Promise<Map<number, DirectCalendarEventDetail>> {
  const result = new Map<number, DirectCalendarEventDetail>();
  if (eventIds.length === 0) return result;
  const { db, schema } = getDrizzleDb();
  const uniqueIds = [...new Set(eventIds)];
  const eventRows = await db
    .select({
      id: schema.calendarEvents.id,
      source: schema.calendarEvents.source,
      title: schema.calendarEvents.title,
      startDt: schema.calendarEvents.start_dt,
      endDt: schema.calendarEvents.end_dt,
      allDay: schema.calendarEvents.all_day,
      recurrenceRule: schema.calendarEvents.recurrence_rule,
      parentEventId: schema.calendarEvents.parent_event_id,
    })
    .from(schema.calendarEvents)
    .where(inArray(schema.calendarEvents.id, uniqueIds));

  const rootIds = [
    ...new Set(eventRows.map((row) => row.parentEventId ?? row.id)),
  ];
  const rootRows =
    rootIds.length === 0
      ? []
      : await db
          .select({
            id: schema.calendarEvents.id,
            source: schema.calendarEvents.source,
            title: schema.calendarEvents.title,
            startDt: schema.calendarEvents.start_dt,
            endDt: schema.calendarEvents.end_dt,
            allDay: schema.calendarEvents.all_day,
            recurrenceRule: schema.calendarEvents.recurrence_rule,
            parentEventId: schema.calendarEvents.parent_event_id,
          })
          .from(schema.calendarEvents)
          .where(inArray(schema.calendarEvents.id, rootIds));
  const rootById = new Map(rootRows.map((row) => [row.id, row]));

  const exceptions =
    rootIds.length === 0
      ? []
      : await db
          .select({
            parentEventId: schema.calendarEventExceptions.parent_event_id,
            exceptionDate: schema.calendarEventExceptions.exception_date,
          })
          .from(schema.calendarEventExceptions)
          .where(inArray(schema.calendarEventExceptions.parent_event_id, rootIds));
  const exceptionsByParent = new Map<number, Set<string>>();
  for (const row of exceptions) {
    const set = exceptionsByParent.get(row.parentEventId) ?? new Set<string>();
    set.add(row.exceptionDate);
    exceptionsByParent.set(row.parentEventId, set);
  }

  const overrides =
    rootIds.length === 0
      ? []
      : await db
          .select({
            parentEventId: schema.calendarEvents.parent_event_id,
            recurrenceDate: schema.calendarEvents.recurrence_date,
            startDt: schema.calendarEvents.start_dt,
            endDt: schema.calendarEvents.end_dt,
            allDay: schema.calendarEvents.all_day,
          })
          .from(schema.calendarEvents)
          .where(inArray(schema.calendarEvents.parent_event_id, rootIds));
  const overridesByParent = new Map<number, Map<string, { start: string; end: string; allDay: boolean }>>();
  for (const row of overrides) {
    if (row.parentEventId == null || !row.recurrenceDate) continue;
    const map = overridesByParent.get(row.parentEventId) ?? new Map();
    map.set(row.recurrenceDate, {
      start: requireIso(row.startDt as any, 'override start'),
      end: requireIso(row.endDt as any, 'override end'),
      allDay: Number(row.allDay) === 1,
    });
    overridesByParent.set(row.parentEventId, map);
  }

  for (const requested of eventRows) {
    const root = rootById.get(requested.parentEventId ?? requested.id) ?? requested;
    if (root.source !== 'direct') continue;
    const start = requireIso(root.startDt as any, 'calendar event start');
    const end = requireIso(root.endDt as any, 'calendar event end');
    const allDay = Number(root.allDay) === 1;
    const recurrenceRule = root.recurrenceRule ?? null;
    const startDate = formatDateInTimeZone(new Date(start), config.timeZone) ?? start.slice(0, 10);
    let instances: Array<{ start: string; end: string; recurrenceDate: string }> = [
      { start, end, recurrenceDate: startDate },
    ];
    if (recurrenceRule) {
      instances = expandAllRecurrenceInstances(start, end, recurrenceRule, config.timeZone);
      if (instances.length > MAX_MATERIALIZED_RECURRENCE_INSTANCES) {
        instances = instances.slice(0, MAX_MATERIALIZED_RECURRENCE_INSTANCES);
      }
    }
    const occurrences = applyCalendarExceptionsAndOverrides(
      instances,
      allDay,
      exceptionsByParent.get(root.id) ?? new Set(),
      overridesByParent.get(root.id) ?? new Map()
    );
    const event: VolunteerAttachedCalendarEvent = {
      id: root.id,
      title: root.title,
      start,
      end,
      allDay,
      isRecurring: Boolean(recurrenceRule),
      occurrenceCount: occurrences.length,
    };
    result.set(requested.id, { event, occurrences, recurrenceRule });
    result.set(root.id, { event, occurrences, recurrenceRule });
  }
  return result;
}

export async function getDirectCalendarEventForSignup(eventId: number): Promise<
  VolunteerAttachedCalendarEvent & { occurrences: CalendarOccurrence[] }
> {
  const resolved = await resolveDirectCalendarEventId(eventId);
  const details = await describeDirectCalendarEvents([resolved]);
  const detail = details.get(resolved);
  if (!detail) throw new VolunteeringServiceError('Calendar event not found', 404);
  return { ...detail.event, occurrences: detail.occurrences };
}

export async function createShiftsFromCalendarEvent(input: {
  programId: number;
  roleId: number;
  volunteersNeeded: number;
  creditHours?: number | null;
}): Promise<{ shiftIds: number[] }> {
  const { db, schema } = getDrizzleDb();
  const [program] = await db
    .select({
      id: schema.volunteerPrograms.id,
      signupKind: schema.volunteerPrograms.signup_kind,
      calendarEventId: schema.volunteerPrograms.calendar_event_id,
    })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, input.programId))
    .limit(1);
  if (!program) throw new VolunteeringServiceError('Program not found', 404);
  if (program.calendarEventId == null) {
    throw new VolunteeringServiceError('Attach a calendar event before creating times from it', 400);
  }

  const details = await describeDirectCalendarEvents([program.calendarEventId]);
  const detail = details.get(program.calendarEventId);
  if (!detail || detail.occurrences.length === 0) {
    throw new VolunteeringServiceError('The attached calendar event has no times to copy', 400);
  }

  const programRoles = await db
    .select({ id: schema.volunteerRoles.id })
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.program_id, input.programId));
  const validRoleIds = new Set(programRoles.map((role) => role.id));
  const roles = [{ roleId: input.roleId, volunteersNeeded: input.volunteersNeeded }];
  validateShiftRoles(roles, validRoleIds);

  const signupKind = parseVolunteerSignupKind(program.signupKind);
  const first = detail.occurrences[0];
  const creditHours = requireCreditHours(input.creditHours, first.start, first.end, signupKind);
  const recurrenceRule = detail.occurrences.length > 1 ? detail.recurrenceRule : null;

  const shiftIds: number[] = [];
  let seriesId: number | null = null;
  for (const occurrence of detail.occurrences) {
    const createdId = await insertShiftRow({
      programId: input.programId,
      startDt: occurrence.start,
      endDt: occurrence.end,
      creditHours,
      roles,
      recurrenceSeriesId: seriesId,
      recurrenceRule,
      recurrenceDate: occurrence.recurrenceDate,
      sourceCalendarEventId: program.calendarEventId,
    });
    shiftIds.push(createdId);
    if (detail.occurrences.length > 1 && seriesId == null) {
      seriesId = createdId;
      await db
        .update(schema.volunteerShifts)
        .set({ recurrence_series_id: seriesId, updated_at: new Date() } as any)
        .where(eq(schema.volunteerShifts.id, createdId));
    }
  }
  return { shiftIds };
}

async function unlinkCalendarSyncedShifts(programId: number, calendarEventId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.volunteerShifts)
    .set({ source_calendar_event_id: null, updated_at: new Date() } as any)
    .where(
      and(
        eq(schema.volunteerShifts.program_id, programId),
        eq(schema.volunteerShifts.source_calendar_event_id, calendarEventId)
      )
    );
}

export async function deleteVolunteerShiftsSyncedToCalendarEvent(calendarEventId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerShifts.id,
      seriesId: schema.volunteerShifts.recurrence_series_id,
    })
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.source_calendar_event_id, calendarEventId));
  if (rows.length === 0) return;
  const seriesIds = [...new Set(rows.map((row) => row.seriesId).filter((id): id is number => id != null))];
  await db.delete(schema.volunteerShifts).where(eq(schema.volunteerShifts.source_calendar_event_id, calendarEventId));
  if (seriesIds.length > 0) {
    await db
      .delete(schema.volunteerShiftExceptions)
      .where(inArray(schema.volunteerShiftExceptions.recurrence_series_id, seriesIds));
  }
}

export async function syncVolunteerShiftsForCalendarEvent(calendarEventId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  let resolved = calendarEventId;
  try {
    resolved = await resolveDirectCalendarEventId(calendarEventId);
  } catch {
    await deleteVolunteerShiftsSyncedToCalendarEvent(calendarEventId);
    return;
  }

  const rows = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.source_calendar_event_id, resolved));
  if (rows.length === 0) return;

  const details = await describeDirectCalendarEvents([resolved]);
  const detail = details.get(resolved);
  if (!detail || detail.occurrences.length === 0) {
    await deleteVolunteerShiftsSyncedToCalendarEvent(resolved);
    return;
  }

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.recurrence_series_id != null ? `series:${row.recurrence_series_id}` : `shift:${row.id}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    const template = group[0];
    const seriesId = template.recurrence_series_id;
    const skipDates = seriesId != null ? await listSeriesExceptionDates(seriesId) : new Set<string>();
    const plan = planCalendarSyncedShiftChanges(
      group.map((row) => ({ id: row.id, recurrenceDate: row.recurrence_date })),
      detail.occurrences,
      skipDates
    );
    const recurrenceRule = detail.occurrences.length > 1 ? detail.recurrenceRule : null;
    let nextSeriesId = seriesId;

    for (const update of plan.updates) {
      await db
        .update(schema.volunteerShifts)
        .set({
          start_dt: update.start,
          end_dt: update.end,
          recurrence_date: update.recurrenceDate,
          recurrence_rule: recurrenceRule,
          updated_at: new Date(),
        } as any)
        .where(eq(schema.volunteerShifts.id, update.id));
    }

    const templateRoles = await db
      .select({
        roleId: schema.volunteerShiftRoles.role_id,
        volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
      })
      .from(schema.volunteerShiftRoles)
      .where(eq(schema.volunteerShiftRoles.shift_id, template.id));
    const creditHours = Number((template as { credit_hours?: unknown }).credit_hours) || 0;

    for (const create of plan.creates) {
      const createdId = await insertShiftRow({
        programId: template.program_id,
        startDt: create.start,
        endDt: create.end,
        creditHours,
        roles: templateRoles,
        recurrenceSeriesId: nextSeriesId,
        recurrenceRule,
        recurrenceDate: create.recurrenceDate,
        sourceCalendarEventId: resolved,
      });
      if (detail.occurrences.length > 1 && nextSeriesId == null) {
        nextSeriesId = createdId;
        const idsToSeries = [createdId, ...plan.updates.map((row) => row.id)];
        await db
          .update(schema.volunteerShifts)
          .set({ recurrence_series_id: nextSeriesId, updated_at: new Date() } as any)
          .where(inArray(schema.volunteerShifts.id, idsToSeries));
      }
    }

    for (const id of plan.deleteIds) {
      await deleteShiftRow(id);
    }
  }
}

export async function calendarSignupsByDirectEventId(options: {
  forPublic: boolean;
}): Promise<Map<number, CalendarEventSignupLink>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      calendarEventId: schema.volunteerPrograms.calendar_event_id,
      slug: schema.volunteerPrograms.slug,
      title: schema.volunteerPrograms.title,
      publicSignups: schema.volunteerPrograms.public_signups,
      published: schema.volunteerPrograms.published,
      archivedAt: schema.volunteerPrograms.archived_at,
    })
    .from(schema.volunteerPrograms)
    .where(isNotNull(schema.volunteerPrograms.calendar_event_id));

  const map = new Map<number, CalendarEventSignupLink>();
  for (const row of rows) {
    if (row.calendarEventId == null) continue;
    if (row.archivedAt) continue;
    if (Number(row.published) !== 1) continue;
    if (options.forPublic && Number(row.publicSignups) !== 1) continue;
    map.set(row.calendarEventId, {
      slug: String(row.slug),
      title: row.title,
      publicSignups: Number(row.publicSignups) === 1,
    });
  }
  return map;
}

export async function listHubPrograms(member: Member): Promise<{
  programs: VolunteerProgramView[];
  myCredentials: VolunteerCredentialSummary[];
  credentials: VolunteerHubCredential[];
}> {
  const [programs, myCredentials, credentials] = await Promise.all([
    buildProgramViews({ member, includeArchived: false, upcomingOnly: true, forHub: true }),
    listMyCredentials(member.id),
    listHubCredentials(member.id),
  ]);
  const heldCredentialIds = new Set(myCredentials.map((credential) => credential.id));
  const visiblePrograms = programs.filter((program) =>
    volunteerProgramVisibleGivenCredentials(program, heldCredentialIds)
  );
  // Discover opportunities: priority (lower first; missing = last), then earliest upcoming shift, then title.
  const sortedPrograms = [...visiblePrograms].sort((a, b) =>
    compareVolunteerProgramsForDiscovery(
      { priority: a.priority, nextShiftStart: a.shifts[0]?.startDt ?? null, title: a.title },
      { priority: b.priority, nextShiftStart: b.shifts[0]?.startDt ?? null, title: b.title }
    )
  );
  return { programs: sortedPrograms, myCredentials, credentials };
}

export async function listAdminPrograms(
  member: Member,
  includeArchived: boolean
): Promise<VolunteerProgramView[]> {
  const managed = await listManagedProgramIds(member);
  if (managed !== 'all' && managed.length === 0) return [];
  return buildProgramViews({
    member,
    includeArchived,
    programIds: managed,
    upcomingOnly: false,
  });
}

async function resolveVolunteerProgramId(slugOrId: string): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const key = slugOrId.trim();
  if (!key) return null;
  const [bySlug] = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.slug, key))
    .limit(1);
  if (bySlug) return bySlug.id;
  if (/^\d+$/.test(key)) {
    const programId = Number.parseInt(key, 10);
    if (!Number.isFinite(programId)) return null;
    const [byId] = await db
      .select({ id: schema.volunteerPrograms.id })
      .from(schema.volunteerPrograms)
      .where(eq(schema.volunteerPrograms.id, programId))
      .limit(1);
    return byId?.id ?? null;
  }
  return null;
}

export async function getHubProgram(member: Member, slugOrId: string): Promise<VolunteerProgramView> {
  const programId = await resolveVolunteerProgramId(slugOrId);
  if (programId == null) throw new VolunteeringServiceError('Program not found', 404);
  const programs = await buildProgramViews({
    member,
    includeArchived: false,
    programIds: [programId],
    upcomingOnly: true,
    forHub: true,
  });
  if (!programs[0]) throw new VolunteeringServiceError('Program not found', 404);
  return programs[0];
}

export async function getAdminProgram(
  member: Member,
  programId: number,
  includeArchived = true
): Promise<VolunteerProgramView> {
  const canManage = await canManageProgram(member, programId);
  if (!canManage && !isVolunteerManager(member)) {
    // Still allow read if they manage it; otherwise 403
    const managed = await listManagedProgramIds(member);
    if (managed !== 'all' && !managed.includes(programId)) {
      throw new VolunteeringServiceError('Forbidden', 403);
    }
  }
  const programs = await buildProgramViews({
    member,
    includeArchived,
    programIds: [programId],
    upcomingOnly: false,
  });
  if (!programs[0]) throw new VolunteeringServiceError('Program not found', 404);
  return programs[0];
}

export async function listDashboardOpportunities(memberId: number): Promise<DashboardOpportunityProgram[]> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const { getDashboardSectionConfig } = await import('../domains/content/dashboardSections.js');
  const sectionConfig = await getDashboardSectionConfig('volunteer_opportunities');
  const lookAheadDays = sectionConfig.lookAheadDays ?? 30;
  const maxPrograms = sectionConfig.maxPrograms ?? 3;
  const maxShiftsPerProgram = sectionConfig.maxShiftsPerProgram ?? 4;
  const horizon = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000).toISOString();
  const [heldGrants, clubName] = await Promise.all([getMemberCredentialGrants(memberId), getConfiguredClubName()]);

  const shifts = await db
    .select({
      shiftId: schema.volunteerShifts.id,
      programId: schema.volunteerPrograms.id,
      programSlug: schema.volunteerPrograms.slug,
      programTitle: schema.volunteerPrograms.title,
      description: schema.volunteerPrograms.description,
      location: schema.volunteerPrograms.location,
      priority: schema.volunteerPrograms.priority,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      archivedAt: schema.volunteerPrograms.archived_at,
    })
    .from(schema.volunteerShifts)
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(
      and(
        isNull(schema.volunteerPrograms.archived_at),
        eq(schema.volunteerPrograms.published, 1),
        eq(schema.volunteerPrograms.feature_on_dashboard, 1),
        eq(schema.volunteerPrograms.signup_kind, 'volunteering'),
        gte(schema.volunteerShifts.start_dt, nowIso),
        lte(schema.volunteerShifts.start_dt, horizon)
      )
    )
    .orderBy(asc(schema.volunteerShifts.start_dt));

  if (shifts.length === 0) return [];

  const shiftIds = shifts.map((s) => s.shiftId);
  const shiftRoles = await db
    .select({
      id: schema.volunteerShiftRoles.id,
      shiftId: schema.volunteerShiftRoles.shift_id,
      roleId: schema.volunteerShiftRoles.role_id,
      volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
      roleName: schema.volunteerRoles.name,
    })
    .from(schema.volunteerShiftRoles)
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .where(inArray(schema.volunteerShiftRoles.shift_id, shiftIds));

  const roleIds = [...new Set(shiftRoles.map((sr) => sr.roleId))];
  const roleCredMap = await getRoleRequiredCredentialMap(roleIds);
  const shiftRoleIds = shiftRoles.map((sr) => sr.id);
  const signupCounts =
    shiftRoleIds.length === 0
      ? []
      : await db
          .select({
            shiftRoleId: schema.volunteerSignups.shift_role_id,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(schema.volunteerSignups)
          .where(
            and(
              inArray(schema.volunteerSignups.shift_role_id, shiftRoleIds),
              eq(schema.volunteerSignups.status, 'confirmed')
            )
          )
          .groupBy(schema.volunteerSignups.shift_role_id);

  const countMap = new Map(signupCounts.map((r) => [r.shiftRoleId, r.count]));
  const mySignupRows =
    shiftRoleIds.length === 0
      ? []
      : await db
          .select({ shiftRoleId: schema.volunteerSignups.shift_role_id })
          .from(schema.volunteerSignups)
          .where(
            and(
              inArray(schema.volunteerSignups.shift_role_id, shiftRoleIds),
              eq(schema.volunteerSignups.status, 'confirmed'),
              eq(schema.volunteerSignups.member_id, memberId)
            )
          );
  const mySignupSet = new Set(mySignupRows.map((row) => row.shiftRoleId));
  const shiftMap = new Map(shifts.map((s) => [s.shiftId, s]));

  type ProgramDraft = {
    programId: number;
    programSlug: string;
    programTitle: string;
    description: string | null;
    location: string | null;
    priority: number | null;
    shifts: Map<
      number,
      {
        shiftId: number;
        startDt: string;
        endDt: string;
        roles: DashboardOpportunityRole[];
      }
    >;
  };

  const programsById = new Map<number, ProgramDraft>();
  for (const sr of shiftRoles) {
    const shift = shiftMap.get(sr.shiftId);
    if (!shift) continue;
    const startDt = requireIso(shift.startDt as any, 'startDt');
    const held = heldVolunteerCredentialIdsOn(heldGrants, shiftDateOnly(startDt));
    const required = roleCredMap.get(sr.roleId) ?? [];
    if (!memberHasAllVolunteerCredentials(held, required)) continue;
    const registered = countMap.get(sr.id) ?? 0;
    if (registered >= sr.volunteersNeeded) continue;

    let program = programsById.get(shift.programId);
    if (!program) {
      program = {
        programId: shift.programId,
        programSlug: shift.programSlug,
        programTitle: shift.programTitle,
        description: shift.description?.trim() || null,
        location: normalizeVolunteerLocation(shift.location, clubName),
        priority: normalizePriority(shift.priority),
        shifts: new Map(),
      };
      programsById.set(shift.programId, program);
    }

    let shiftDraft = program.shifts.get(sr.shiftId);
    if (!shiftDraft) {
      shiftDraft = {
        shiftId: sr.shiftId,
        startDt,
        endDt: requireIso(shift.endDt as any, 'endDt'),
        roles: [],
      };
      program.shifts.set(sr.shiftId, shiftDraft);
    }
    shiftDraft.roles.push({
      shiftRoleId: sr.id,
      roleId: sr.roleId,
      roleName: sr.roleName,
      volunteersNeeded: sr.volunteersNeeded,
      volunteersRegistered: registered,
      requiresCredentials: required.length > 0,
      callerIsSignedUp: mySignupSet.has(sr.id),
    });
  }

  const programs: DashboardOpportunityProgram[] = [...programsById.values()]
    .map((program) => {
      const sortedShifts = [...program.shifts.values()].sort(
        (a, b) =>
          new Date(a.startDt).getTime() - new Date(b.startDt).getTime() || a.shiftId - b.shiftId,
      );
      for (const shift of sortedShifts) {
        shift.roles.sort((a, b) => a.roleName.localeCompare(b.roleName) || a.shiftRoleId - b.shiftRoleId);
      }
      return {
        programId: program.programId,
        programSlug: program.programSlug,
        programTitle: program.programTitle,
        description: program.description,
        location: program.location,
        priority: program.priority,
        totalShifts: sortedShifts.length,
        shifts: sortedShifts.slice(0, maxShiftsPerProgram),
      };
    })
    .sort((a, b) =>
      compareVolunteerProgramsForDiscovery(
        { priority: a.priority, nextShiftStart: a.shifts[0]?.startDt ?? null, title: a.programTitle },
        { priority: b.priority, nextShiftStart: b.shifts[0]?.startDt ?? null, title: b.programTitle }
      )
    )
    .slice(0, maxPrograms)
    .map(({ priority: _priority, ...program }) => program);

  return programs;
}

export async function listMySignups(memberId: number): Promise<{
  upcoming: MySignupView[];
  past: MySignupView[];
}> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const clubName = await getConfiguredClubName();

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      shiftRoleId: schema.volunteerSignups.shift_role_id,
      status: schema.volunteerSignups.status,
      comments: schema.volunteerSignups.comments,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      signupKind: schema.volunteerPrograms.signup_kind,
      roleId: schema.volunteerRoles.id,
      roleName: schema.volunteerRoles.name,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      creditHours: schema.volunteerShifts.credit_hours,
    })
    .from(schema.volunteerSignups)
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(
      and(
        eq(schema.volunteerSignups.member_id, memberId),
        eq(schema.volunteerSignups.status, 'confirmed')
      )
    )
    .orderBy(asc(schema.volunteerShifts.start_dt));

  const upcoming: MySignupView[] = [];
  const past: MySignupView[] = [];
  for (const row of rows) {
    const startDt = requireIso(row.startDt as any, 'startDt');
    const endDt = requireIso(row.endDt as any, 'endDt');
    const view: MySignupView = {
      signupId: row.signupId,
      shiftRoleId: row.shiftRoleId,
      programId: row.programId,
      programTitle: row.programTitle,
      location: normalizeVolunteerLocation(row.location, clubName),
      roleId: row.roleId,
      roleName: row.roleName,
      startDt,
      endDt,
      creditHours: requireCreditHours(
        row.creditHours,
        startDt,
        endDt,
        parseVolunteerSignupKind(row.signupKind)
      ),
      status: row.status as 'confirmed' | 'cancelled',
      comments: row.comments ?? null,
      canCancel: startDt > nowIso,
    };
    if (startDt >= nowIso) upcoming.push(view);
    else past.push(view);
  }
  past.reverse();
  return { upcoming, past };
}

export type SignUpForShiftRoleInput = {
  comments?: string | null;
  memberIds?: number[];
  guestNames?: string[];
};

export async function signUpForShiftRole(
  actor: Member,
  shiftRoleId: number,
  input: SignUpForShiftRoleInput = {}
): Promise<{ ids: number[]; count: number }> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();

  const requestedMemberIds = [...new Set((input.memberIds ?? []).filter((id) => Number.isFinite(id) && id > 0))];
  const guestNames = [...new Set(
    (input.guestNames ?? [])
      .map((name) => normalizePersonName(String(name ?? '')))
      .filter((name) => name.length > 0)
  )];
  const commentsRaw = input.comments == null ? null : String(input.comments).trim();
  const comments = commentsRaw && commentsRaw.length > 0 ? commentsRaw : null;

  const memberIds =
    requestedMemberIds.length === 0 && guestNames.length === 0 ? [actor.id] : requestedMemberIds;

  const volunteerCount = memberIds.length + guestNames.length;
  if (volunteerCount < 1) {
    throw new VolunteeringServiceError('Select at least one volunteer', 400);
  }

  const rows = await db
    .select({
      shiftRoleId: schema.volunteerShiftRoles.id,
      volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
      roleId: schema.volunteerShiftRoles.role_id,
      roleName: schema.volunteerRoles.name,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      pointOfContact: schema.volunteerPrograms.point_of_contact,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      published: schema.volunteerPrograms.published,
      archivedAt: schema.volunteerPrograms.archived_at,
    })
    .from(schema.volunteerShiftRoles)
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(eq(schema.volunteerShiftRoles.id, shiftRoleId))
    .limit(1);

  const target = rows[0];
  if (!target || target.archivedAt) {
    throw new VolunteeringServiceError('Opportunity not found', 404);
  }

  const actorCanManage = await canManageProgram(actor, target.programId);
  if (Number(target.published) !== 1 && !actorCanManage) {
    throw new VolunteeringServiceError('Opportunity not found', 404);
  }

  const startDt = requireIso(target.startDt as any, 'startDt');
  const endDt = requireIso(target.endDt as any, 'endDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('This shift has already started', 409);
  }

  const requiredMap = await getRoleRequiredCredentialMap([target.roleId]);
  const required = requiredMap.get(target.roleId) ?? [];
  const asOfDate = shiftDateOnly(startDt);
  const actorHeld = await getMemberCredentials(actor.id, asOfDate);
  if (!actorCanManage && !memberHasAllVolunteerCredentials(actorHeld, required)) {
    throw new VolunteeringServiceError('Missing required credentials for this role', 403);
  }
  if (guestNames.length > 0 && required.length > 0) {
    throw new VolunteeringServiceError(
      'This role requires credentials, so only club members with those credentials can be signed up',
      403
    );
  }

  for (const memberId of memberIds) {
    const held = memberId === actor.id ? actorHeld : await getMemberCredentials(memberId, asOfDate);
    if (!memberHasAllVolunteerCredentials(held, required)) {
      throw new VolunteeringServiceError(
        'One or more selected members are missing required credentials for this role',
        403
      );
    }
  }

  const existingSignups = await db
    .select({
      id: schema.volunteerSignups.id,
      memberId: schema.volunteerSignups.member_id,
      status: schema.volunteerSignups.status,
    })
    .from(schema.volunteerSignups)
    .where(eq(schema.volunteerSignups.shift_role_id, shiftRoleId));

  const active = existingSignups.filter((s) => s.status === 'confirmed');
  const alreadyConfirmedMemberIds = new Set(
    active.filter((s) => s.memberId != null).map((s) => s.memberId as number)
  );
  for (const memberId of memberIds) {
    if (alreadyConfirmedMemberIds.has(memberId)) {
      throw new VolunteeringServiceError('One or more selected members are already signed up', 409);
    }
  }

  const remaining = target.volunteersNeeded - active.length;
  if (volunteerCount > remaining) {
    throw new VolunteeringServiceError(
      remaining <= 0
        ? 'This role is full'
        : `Only ${remaining} spot${remaining === 1 ? '' : 's'} remaining for this role`,
      409
    );
  }

  const membersToEmail =
    memberIds.length === 0
      ? []
      : await db
          .select({
            id: schema.members.id,
            name: schema.members.name,
            email: schema.members.email,
          })
          .from(schema.members)
          .where(inArray(schema.members.id, memberIds));
  const memberById = new Map(membersToEmail.map((m) => [m.id, m]));
  for (const memberId of memberIds) {
    if (!memberById.has(memberId)) {
      throw new VolunteeringServiceError('One or more selected members were not found', 400);
    }
  }

  const createdIds: number[] = [];

  for (const memberId of memberIds) {
    const existingForMember = existingSignups.find((s) => s.memberId === memberId);
    if (existingForMember) {
      await db
        .update(schema.volunteerSignups)
        .set({
          status: 'confirmed',
          cancelled_at: null,
          reminder_sent_at: null,
          comments,
          guest_name: null,
          signed_up_by_member_id: actor.id,
          updated_at: new Date(),
        } as any)
        .where(eq(schema.volunteerSignups.id, existingForMember.id));
      createdIds.push(existingForMember.id);
    } else {
      const [created] = await db
        .insert(schema.volunteerSignups)
        .values({
          shift_role_id: shiftRoleId,
          member_id: memberId,
          guest_name: null,
          comments,
          signed_up_by_member_id: actor.id,
          status: 'confirmed',
        } as any)
        .returning({ id: schema.volunteerSignups.id });
      createdIds.push(created.id);
    }
  }

  for (const guestName of guestNames) {
    const [created] = await db
      .insert(schema.volunteerSignups)
      .values({
        shift_role_id: shiftRoleId,
        member_id: null,
        guest_name: guestName,
        comments,
        signed_up_by_member_id: actor.id,
        status: 'confirmed',
      } as any)
      .returning({ id: schema.volunteerSignups.id });
    createdIds.push(created.id);
  }

  const clubName = await getConfiguredClubName();
  const emailLocation = normalizeVolunteerLocation(target.location, clubName);
  for (const memberId of memberIds) {
    const targetMember = memberById.get(memberId);
    if (!targetMember?.email) continue;
    try {
      await sendVolunteerSignupConfirmationEmail({
        to: targetMember.email,
        recipientName: targetMember.name,
        programTitle: target.programTitle,
        roleName: target.roleName,
        startDt,
        endDt,
        location: emailLocation,
      });
    } catch (err) {
      console.error('Failed to send volunteer signup confirmation:', err);
    }
  }

  return { ids: createdIds, count: createdIds.length };
}

export async function cancelOwnSignup(member: Member, shiftRoleId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      status: schema.volunteerSignups.status,
      roleName: schema.volunteerRoles.name,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
    })
    .from(schema.volunteerSignups)
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(
      and(
        eq(schema.volunteerSignups.shift_role_id, shiftRoleId),
        eq(schema.volunteerSignups.member_id, member.id),
        eq(schema.volunteerSignups.status, 'confirmed')
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new VolunteeringServiceError('Signup not found', 404);

  const startDt = requireIso(row.startDt as any, 'startDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('Cannot cancel after the shift has started', 409);
  }

  await db
    .update(schema.volunteerSignups)
    .set({
      status: 'cancelled',
      cancelled_at: new Date(),
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerSignups.id, row.signupId));

  const managerEmails = await db
    .select({
      email: schema.members.email,
      name: schema.members.name,
    })
    .from(schema.volunteerProgramManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerProgramManagers.member_id))
    .where(eq(schema.volunteerProgramManagers.program_id, row.programId));

  try {
    const clubName = await getConfiguredClubName();
    await sendVolunteerCancellationEmails({
      memberEmail: member.email,
      memberName: member.name,
      managerEmails: managerEmails
        .filter((m) => m.email)
        .map((m) => ({ email: m.email!, name: m.name })),
      programTitle: row.programTitle,
      roleName: row.roleName,
      startDt,
      endDt: requireIso(row.endDt as any, 'endDt'),
      location: normalizeVolunteerLocation(row.location, clubName),
    });
  } catch (err) {
    console.error('Failed to send volunteer cancellation emails:', err);
  }
}

export async function updateOwnSignupComments(
  member: Member,
  shiftRoleId: number,
  commentsInput: string | null | undefined
): Promise<{ comments: string | null }> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();

  const commentsRaw = commentsInput == null ? null : String(commentsInput).trim();
  const comments = commentsRaw && commentsRaw.length > 0 ? commentsRaw : null;
  if (comments && comments.length > 2000) {
    throw new VolunteeringServiceError('Comments must be 2000 characters or fewer', 400);
  }

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      startDt: schema.volunteerShifts.start_dt,
    })
    .from(schema.volunteerSignups)
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .where(
      and(
        eq(schema.volunteerSignups.shift_role_id, shiftRoleId),
        eq(schema.volunteerSignups.member_id, member.id),
        eq(schema.volunteerSignups.status, 'confirmed')
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new VolunteeringServiceError('Signup not found', 404);

  const startDt = requireIso(row.startDt as any, 'startDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('Cannot edit comments after the shift has started', 409);
  }

  await db
    .update(schema.volunteerSignups)
    .set({
      comments,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerSignups.id, row.signupId));

  return { comments };
}

export async function removeSignupAsManager(signupId: number, actor: Member): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      memberId: schema.volunteerSignups.member_id,
      memberName: schema.members.name,
      guestName: schema.volunteerSignups.guest_name,
      guestEmail: schema.volunteerSignups.guest_email,
      memberEmail: schema.members.email,
      status: schema.volunteerSignups.status,
      roleName: schema.volunteerRoles.name,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
    })
    .from(schema.volunteerSignups)
    .leftJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(eq(schema.volunteerSignups.id, signupId))
    .limit(1);

  const row = rows[0];
  if (!row || row.status !== 'confirmed') {
    throw new VolunteeringServiceError('Signup not found', 404);
  }

  if (!(await canManageProgram(actor, row.programId))) {
    throw new VolunteeringServiceError('Forbidden', 403);
  }

  await db
    .update(schema.volunteerSignups)
    .set({
      status: 'cancelled',
      cancelled_at: new Date(),
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerSignups.id, row.signupId));

  const managerEmails = await db
    .select({
      email: schema.members.email,
      name: schema.members.name,
    })
    .from(schema.volunteerProgramManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerProgramManagers.member_id))
    .where(eq(schema.volunteerProgramManagers.program_id, row.programId));

  try {
    const clubName = await getConfiguredClubName();
    await sendVolunteerCancellationEmails({
      memberEmail: row.memberEmail || row.guestEmail,
      memberName: row.memberName || row.guestName || 'Volunteer',
      managerEmails: managerEmails
        .filter((m) => m.email)
        .map((m) => ({ email: m.email!, name: m.name })),
      programTitle: row.programTitle,
      roleName: row.roleName,
      startDt: requireIso(row.startDt as any, 'startDt'),
      endDt: requireIso(row.endDt as any, 'endDt'),
      location: normalizeVolunteerLocation(row.location, clubName),
      cancelledByManager: true,
    });
  } catch (err) {
    console.error('Failed to send volunteer cancellation emails:', err);
  }

  return { programId: row.programId };
}

export async function getPublicProgram(slugOrId: string): Promise<PublicVolunteerProgramView> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const clubName = await getConfiguredClubName();
  const programId = await resolveVolunteerProgramId(slugOrId);
  if (programId == null) throw new VolunteeringServiceError('Program not found', 404);

  const programs = await db
    .select()
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, programId))
    .limit(1);
  const program = programs[0];
  if (
    !program ||
    program.archived_at ||
    Number(program.published) !== 1 ||
    Number(program.public_signups) !== 1
  ) {
    throw new VolunteeringServiceError('Program not found', 404);
  }

  const shifts = await db
    .select()
    .from(schema.volunteerShifts)
    .where(
      and(eq(schema.volunteerShifts.program_id, programId), gte(schema.volunteerShifts.start_dt, nowIso))
    )
    .orderBy(asc(schema.volunteerShifts.start_dt));

  if (shifts.length === 0) {
    return {
      id: program.id,
      title: program.title,
      slug: String(program.slug),
      description: program.description,
      pointOfContact: program.point_of_contact,
      location: normalizeVolunteerLocation(program.location, clubName),
      shifts: [],
    };
  }

  const shiftIds = shifts.map((s) => s.id);
  const shiftRoles = await db
    .select({
      id: schema.volunteerShiftRoles.id,
      shiftId: schema.volunteerShiftRoles.shift_id,
      roleId: schema.volunteerShiftRoles.role_id,
      volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
      roleName: schema.volunteerRoles.name,
      roleDescription: schema.volunteerRoles.description,
    })
    .from(schema.volunteerShiftRoles)
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .where(inArray(schema.volunteerShiftRoles.shift_id, shiftIds));

  const roleIds = [...new Set(shiftRoles.map((sr) => sr.roleId))];
  const roleCredMap = await getRoleRequiredCredentialMap(roleIds);
  const shiftRoleIds = shiftRoles.map((sr) => sr.id);
  const signupCounts =
    shiftRoleIds.length === 0
      ? []
      : await db
          .select({
            shiftRoleId: schema.volunteerSignups.shift_role_id,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(schema.volunteerSignups)
          .where(
            and(
              inArray(schema.volunteerSignups.shift_role_id, shiftRoleIds),
              eq(schema.volunteerSignups.status, 'confirmed')
            )
          )
          .groupBy(schema.volunteerSignups.shift_role_id);
  const countMap = new Map(signupCounts.map((r) => [r.shiftRoleId, r.count]));

  return {
    id: program.id,
    title: program.title,
    slug: String(program.slug),
    description: program.description,
    pointOfContact: program.point_of_contact,
    location: normalizeVolunteerLocation(program.location, clubName),
    shifts: shifts.map((shift) => ({
      id: shift.id,
      startDt: requireIso(shift.start_dt as any, 'startDt'),
      endDt: requireIso(shift.end_dt as any, 'endDt'),
      roles: shiftRoles
        .filter((sr) => sr.shiftId === shift.id)
        .map((sr) => {
          const required = roleCredMap.get(sr.roleId) ?? [];
          const registered = countMap.get(sr.id) ?? 0;
          return {
            id: sr.id,
            roleId: sr.roleId,
            roleName: sr.roleName,
            roleDescription: sr.roleDescription,
            volunteersNeeded: sr.volunteersNeeded,
            volunteersRegistered: registered,
            isFull: registered >= sr.volunteersNeeded,
            requiresCredentials: required.length > 0,
            requiredCredentialNames: required.map((c) => c.name),
          };
        })
        .sort((a, b) => a.roleName.localeCompare(b.roleName) || a.id - b.id),
    })),
  };
}

export async function signUpPublicGuest(
  shiftRoleId: number,
  input: { name: string; email: string; comments?: string | null }
): Promise<{ manageUrl: string }> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const { normalizeEmail } = await import('../utils/auth.js');
  const { generateVolunteerSignupAccessToken } = await import('../utils/volunteerSignupAccessToken.js');
  const { volunteerSignupManageUrl } = await import('../utils/volunteerSignupManageUrl.js');

  const name = normalizePersonName(input.name);
  const email = normalizeEmail(input.email);
  if (!name) throw new VolunteeringServiceError('Name is required', 400);
  if (!email) throw new VolunteeringServiceError('Email is required', 400);
  const commentsRaw = input.comments == null ? null : String(input.comments).trim();
  const comments = commentsRaw && commentsRaw.length > 0 ? commentsRaw : null;
  if (comments && comments.length > 2000) {
    throw new VolunteeringServiceError('Comments must be 2000 characters or fewer', 400);
  }

  const rows = await db
    .select({
      shiftRoleId: schema.volunteerShiftRoles.id,
      roleId: schema.volunteerShiftRoles.role_id,
      roleName: schema.volunteerRoles.name,
      volunteersNeeded: schema.volunteerShiftRoles.volunteers_needed,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      published: schema.volunteerPrograms.published,
      publicSignups: schema.volunteerPrograms.public_signups,
      archivedAt: schema.volunteerPrograms.archived_at,
    })
    .from(schema.volunteerShiftRoles)
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(eq(schema.volunteerShiftRoles.id, shiftRoleId))
    .limit(1);

  const target = rows[0];
  if (
    !target ||
    target.archivedAt ||
    Number(target.published) !== 1 ||
    Number(target.publicSignups) !== 1
  ) {
    throw new VolunteeringServiceError('Opportunity not found', 404);
  }

  const startDt = requireIso(target.startDt as any, 'startDt');
  const endDt = requireIso(target.endDt as any, 'endDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('This shift has already started', 409);
  }

  const requiredMap = await getRoleRequiredCredentialMap([target.roleId]);
  const required = requiredMap.get(target.roleId) ?? [];
  if (required.length > 0) {
    throw new VolunteeringServiceError(
      'This role requires club credentials. Please sign in as a member to sign up.',
      403
    );
  }

  const existingSignups = await db
    .select({
      id: schema.volunteerSignups.id,
      status: schema.volunteerSignups.status,
    })
    .from(schema.volunteerSignups)
    .where(eq(schema.volunteerSignups.shift_role_id, shiftRoleId));
  const activeCount = existingSignups.filter((s) => s.status === 'confirmed').length;
  if (activeCount >= target.volunteersNeeded) {
    throw new VolunteeringServiceError('This role is full', 409);
  }

  const accessToken = generateVolunteerSignupAccessToken();
  const [created] = await db
    .insert(schema.volunteerSignups)
    .values({
      shift_role_id: shiftRoleId,
      member_id: null,
      guest_name: name,
      guest_email: email,
      access_token: accessToken,
      comments,
      signed_up_by_member_id: null,
      status: 'confirmed',
    } as any)
    .returning({ id: schema.volunteerSignups.id });

  if (!created) throw new VolunteeringServiceError('Failed to create signup', 500);

  const manageUrl = volunteerSignupManageUrl(accessToken);
  const clubName = await getConfiguredClubName();
  try {
    await sendVolunteerSignupConfirmationEmail({
      to: email,
      recipientName: name,
      programTitle: target.programTitle,
      roleName: target.roleName,
      startDt,
      endDt,
      location: normalizeVolunteerLocation(target.location, clubName),
      manageUrl,
    });
  } catch (err) {
    console.error('Failed to send public volunteer signup confirmation:', err);
  }

  return { manageUrl };
}

export async function getPublicSignupByAccessToken(
  accessToken: string
): Promise<PublicVolunteerSignupManageView> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const token = accessToken.trim();
  if (!token) throw new VolunteeringServiceError('Signup not found', 404);

  const rows = await db
    .select({
      status: schema.volunteerSignups.status,
      guestName: schema.volunteerSignups.guest_name,
      guestEmail: schema.volunteerSignups.guest_email,
      comments: schema.volunteerSignups.comments,
      roleName: schema.volunteerRoles.name,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
    })
    .from(schema.volunteerSignups)
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(eq(schema.volunteerSignups.access_token, token))
    .limit(1);

  const row = rows[0];
  if (!row || !row.guestName || !row.guestEmail) {
    throw new VolunteeringServiceError('Signup not found', 404);
  }

  const startDt = requireIso(row.startDt as any, 'startDt');
  const endDt = requireIso(row.endDt as any, 'endDt');
  const clubName = await getConfiguredClubName();
  const status = row.status as 'confirmed' | 'cancelled';

  return {
    programId: row.programId,
    programTitle: row.programTitle,
    location: normalizeVolunteerLocation(row.location, clubName),
    roleName: row.roleName,
    startDt,
    endDt,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    comments: row.comments ?? null,
    status,
    canCancel: status === 'confirmed' && startDt > now.toISOString(),
  };
}

export async function cancelPublicSignupByAccessToken(accessToken: string): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const token = accessToken.trim();
  if (!token) throw new VolunteeringServiceError('Signup not found', 404);

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      status: schema.volunteerSignups.status,
      guestName: schema.volunteerSignups.guest_name,
      guestEmail: schema.volunteerSignups.guest_email,
      roleName: schema.volunteerRoles.name,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
    })
    .from(schema.volunteerSignups)
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(eq(schema.volunteerSignups.access_token, token))
    .limit(1);

  const row = rows[0];
  if (!row || !row.guestName || !row.guestEmail) {
    throw new VolunteeringServiceError('Signup not found', 404);
  }
  if (row.status !== 'confirmed') {
    throw new VolunteeringServiceError('Signup is already cancelled', 409);
  }

  const startDt = requireIso(row.startDt as any, 'startDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('Cannot cancel after the shift has started', 409);
  }

  await db
    .update(schema.volunteerSignups)
    .set({
      status: 'cancelled',
      cancelled_at: new Date(),
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerSignups.id, row.signupId));

  const managerEmails = await db
    .select({
      email: schema.members.email,
      name: schema.members.name,
    })
    .from(schema.volunteerProgramManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerProgramManagers.member_id))
    .where(eq(schema.volunteerProgramManagers.program_id, row.programId));

  try {
    const clubName = await getConfiguredClubName();
    await sendVolunteerCancellationEmails({
      memberEmail: row.guestEmail,
      memberName: row.guestName,
      managerEmails: managerEmails
        .filter((m) => m.email)
        .map((m) => ({ email: m.email!, name: m.name })),
      programTitle: row.programTitle,
      roleName: row.roleName,
      startDt,
      endDt: requireIso(row.endDt as any, 'endDt'),
      location: normalizeVolunteerLocation(row.location, clubName),
    });
  } catch (err) {
    console.error('Failed to send public volunteer cancellation emails:', err);
  }
}

export async function processVolunteerReminders(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + VOLUNTEER_REMINDER_WINDOW_MS).toISOString();
  const { volunteerSignupManageUrl } = await import('../utils/volunteerSignupManageUrl.js');

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      memberEmail: schema.members.email,
      memberName: schema.members.name,
      guestName: schema.volunteerSignups.guest_name,
      guestEmail: schema.volunteerSignups.guest_email,
      accessToken: schema.volunteerSignups.access_token,
      roleName: schema.volunteerRoles.name,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      signedUpAt: schema.volunteerSignups.created_at,
      reminderSentAt: schema.volunteerSignups.reminder_sent_at,
    })
    .from(schema.volunteerSignups)
    .leftJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
    .innerJoin(
      schema.volunteerShiftRoles,
      eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
    )
    .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
    .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
    .innerJoin(
      schema.volunteerPrograms,
      eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id)
    )
    .where(
      and(
        eq(schema.volunteerSignups.status, 'confirmed'),
        isNull(schema.volunteerSignups.reminder_sent_at),
        gte(schema.volunteerShifts.start_dt, nowIso),
        lte(schema.volunteerShifts.start_dt, horizon)
      )
    );

  let sent = 0;
  const clubName = await getConfiguredClubName();
  const { sendVolunteerReminderEmail } = await import('./email.js');
  for (const row of rows) {
    if (
      !volunteerSignupQualifiesForReminder({
        signedUpAt: row.signedUpAt,
        shiftStartDt: row.startDt,
      })
    ) {
      continue;
    }
    const to = row.memberEmail || row.guestEmail;
    const recipientName = row.memberName || row.guestName;
    if (!to || !recipientName) continue;
    try {
      await sendVolunteerReminderEmail({
        to,
        recipientName,
        programTitle: row.programTitle,
        roleName: row.roleName,
        startDt: requireIso(row.startDt as any, 'startDt'),
        endDt: requireIso(row.endDt as any, 'endDt'),
        location: normalizeVolunteerLocation(row.location, clubName),
        manageUrl: row.accessToken ? volunteerSignupManageUrl(row.accessToken) : null,
      });
      await db
        .update(schema.volunteerSignups)
        .set({
          reminder_sent_at: new Date(),
          updated_at: new Date(),
        } as any)
        .where(eq(schema.volunteerSignups.id, row.signupId));
      sent += 1;
    } catch (err) {
      console.error(`Failed to send volunteer reminder for signup ${row.signupId}:`, err);
    }
  }
  return sent;
}

const SEASON_MEMBERSHIP_STATUSES_FOR_COUNT = ['active', 'pending'] as const;

type VolunteerStatsSeason = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
};

type VolunteerStatsContext = {
  nowIso: string;
  today: string;
  monthPrefix: string;
  season: VolunteerStatsSeason | null;
  signups: VolunteerStatsCompletedSignup[];
  hourLogs: VolunteerStatsHourLog[];
};

async function loadVolunteerStatsContext(): Promise<VolunteerStatsContext> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const today = clubDateOnly(now);

  const [sessionSeason, signupRows, hourLogs] = await Promise.all([
    resolveSeasonAttachedToDate(addCalendarDays(today, 30)),
    db
      .select({
        signupId: schema.volunteerSignups.id,
        memberId: schema.volunteerSignups.member_id,
        memberName: schema.members.name,
        shiftId: schema.volunteerShifts.id,
        startDt: schema.volunteerShifts.start_dt,
        endDt: schema.volunteerShifts.end_dt,
        creditHours: schema.volunteerShifts.credit_hours,
        signupKind: schema.volunteerPrograms.signup_kind,
        programTitle: schema.volunteerPrograms.title,
        roleName: schema.volunteerRoles.name,
      })
      .from(schema.volunteerSignups)
      .innerJoin(
        schema.volunteerShiftRoles,
        eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
      )
      .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
      .innerJoin(schema.volunteerPrograms, eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id))
      .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
      .leftJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
      .where(eq(schema.volunteerSignups.status, 'confirmed')),
    listHourLogsForStats(),
  ]);

  const signups = signupRows.map((row) => {
    const startDt = requireIso(row.startDt as any, 'startDt');
    const endDt = requireIso(row.endDt as any, 'endDt');
    const signupKind = parseVolunteerSignupKind(row.signupKind);
    return {
      signupId: row.signupId,
      memberId: row.memberId ?? null,
      memberName: row.memberName ? normalizePersonName(row.memberName) || row.memberName : null,
      shiftId: row.shiftId,
      startDt,
      endDt,
      startDateOnly: shiftDateOnly(startDt),
      creditHours: requireCreditHours(row.creditHours, startDt, endDt, signupKind),
      signupKind,
      programTitle: row.programTitle?.trim() || null,
      roleName: row.roleName?.trim() || null,
    };
  });

  return {
    nowIso,
    today,
    monthPrefix: today.slice(0, 7),
    season: sessionSeason
      ? {
          id: sessionSeason.seasonId,
          name: sessionSeason.seasonName,
          startDate: sessionSeason.seasonStartDate,
          endDate: sessionSeason.seasonEndDate,
        }
      : null,
    signups,
    hourLogs,
  };
}

export async function listVolunteerStats(memberId: number): Promise<VolunteerStatsResult> {
  const { db, schema } = getDrizzleDb();
  const ctx = await loadVolunteerStatsContext();

  let membershipCount = 0;
  if (ctx.season) {
    const [countRow] = await db
      .select({
        n: sql<number>`count(distinct ${schema.seasonMemberships.member_id})`,
      })
      .from(schema.seasonMemberships)
      .where(
        and(
          eq(schema.seasonMemberships.season_id, ctx.season.id),
          inArray(schema.seasonMemberships.status, [...SEASON_MEMBERSHIP_STATUSES_FOR_COUNT])
        )
      );
    membershipCount = Number(countRow?.n ?? 0);
  }

  return aggregateVolunteerStats(ctx.signups, {
    viewerMemberId: memberId,
    nowIso: ctx.nowIso,
    monthPrefix: ctx.monthPrefix,
    todayDateOnly: ctx.today,
    season: ctx.season,
    membershipCount,
    hourLogs: ctx.hourLogs,
  });
}

export async function getSeasonVolunteerLedger(
  viewerMemberId: number,
  targetMemberId: number
): Promise<VolunteerSeasonLedger> {
  const ctx = await loadVolunteerStatsContext();
  if (!ctx.season) {
    throw new VolunteeringServiceError(VOLUNTEER_SEASON_LEDGER_UNAVAILABLE, 404);
  }

  const stats = aggregateVolunteerStats(ctx.signups, {
    viewerMemberId,
    nowIso: ctx.nowIso,
    monthPrefix: ctx.monthPrefix,
    todayDateOnly: ctx.today,
    season: ctx.season,
    membershipCount: 0,
    hourLogs: ctx.hourLogs,
  });
  if (!stats.leaderboard.some((entry) => entry.memberId === targetMemberId)) {
    throw new VolunteeringServiceError(VOLUNTEER_SEASON_LEDGER_UNAVAILABLE, 404);
  }

  return buildSeasonVolunteerLedger(targetMemberId, {
    nowIso: ctx.nowIso,
    todayDateOnly: ctx.today,
    season: ctx.season,
    signups: ctx.signups,
    hourLogs: ctx.hourLogs,
  });
}
