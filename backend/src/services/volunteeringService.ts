import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { isVolunteerManager } from '../utils/auth.js';
import type { Member } from '../types.js';
import { config } from '../config.js';
import {
  calendarDaysBetween,
  formatDateInTimeZone,
  shiftInstantByCalendarDays,
} from '../utils/timeZone.js';
import { VolunteeringServiceError } from './volunteeringServiceError.js';
import {
  sendVolunteerSignupConfirmationEmail,
  sendVolunteerCancellationEmails,
} from './email.js';

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

export type VolunteerMemberSummary = {
  id: number;
  name: string;
  email: string | null;
};

export type VolunteerCredentialSummary = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
};

export type VolunteerHubCredential = VolunteerCredentialSummary & {
  held: boolean;
};

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

export type DashboardOpportunity = {
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
  status: 'confirmed' | 'cancelled';
  comments: string | null;
  canCancel: boolean;
};

export type CredentialAdminView = VolunteerCredentialSummary & {
  managers: VolunteerMemberSummary[];
  grants: Array<{
    id: number;
    memberId: number;
    memberName: string;
    memberEmail: string | null;
    grantedAt: string;
    grantedByMemberId: number | null;
  }>;
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

async function isCredentialManager(credentialId: number, memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.volunteerCredentialManagers.id })
    .from(schema.volunteerCredentialManagers)
    .where(
      and(
        eq(schema.volunteerCredentialManagers.credential_id, credentialId),
        eq(schema.volunteerCredentialManagers.member_id, memberId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function canManageProgram(member: Member, programId?: number): Promise<boolean> {
  if (isVolunteerManager(member)) return true;
  if (programId && member.id) return isProgramManager(programId, member.id);
  return false;
}

export async function canManageCredential(member: Member, credentialId?: number): Promise<boolean> {
  if (isVolunteerManager(member)) return true;
  if (credentialId && member.id) return isCredentialManager(credentialId, member.id);
  return false;
}

export async function listManagedProgramIds(member: Member): Promise<number[] | 'all'> {
  if (isVolunteerManager(member)) return 'all';
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ programId: schema.volunteerProgramManagers.program_id })
    .from(schema.volunteerProgramManagers)
    .where(eq(schema.volunteerProgramManagers.member_id, member.id));
  return rows.map((r) => r.programId);
}

export async function listManagedCredentialIds(member: Member): Promise<number[] | 'all'> {
  if (isVolunteerManager(member)) return 'all';
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ credentialId: schema.volunteerCredentialManagers.credential_id })
    .from(schema.volunteerCredentialManagers)
    .where(eq(schema.volunteerCredentialManagers.member_id, member.id));
  return rows.map((r) => r.credentialId);
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

async function replaceCredentialManagers(credentialId: number, managerIds: number[]): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.volunteerCredentialManagers)
    .where(eq(schema.volunteerCredentialManagers.credential_id, credentialId));
  const unique = [...new Set(managerIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return;
  await db.insert(schema.volunteerCredentialManagers).values(
    unique.map((memberId) => ({
      credential_id: credentialId,
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

async function getMemberCredentials(memberId: number): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ credentialId: schema.memberVolunteerCredentials.credential_id })
    .from(schema.memberVolunteerCredentials)
    .where(eq(schema.memberVolunteerCredentials.member_id, memberId));
  return new Set(rows.map((r) => r.credentialId));
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
    });
    map.set(row.roleId, list);
  }
  return map;
}

function memberHasAllCredentials(
  held: Set<number>,
  required: VolunteerCredentialSummary[]
): boolean {
  return required.every((c) => held.has(c.id));
}

export async function createProgram(input: {
  title: string;
  description?: string | null;
  pointOfContact: string;
  location?: string | null;
  startDate?: string | null;
  managerIds?: number[];
  createdByMemberId: number;
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const title = input.title.trim();
  const pointOfContact = input.pointOfContact.trim();
  if (!title) throw new VolunteeringServiceError('Title is required');
  if (!pointOfContact) throw new VolunteeringServiceError('Point of contact is required');
  const startDate = parseOptionalDateOnly(input.startDate, 'start date');

  const [row] = await db
    .insert(schema.volunteerPrograms)
    .values({
      title,
      description: input.description?.trim() || null,
      point_of_contact: pointOfContact,
      location: input.location?.trim() || null,
      start_date: startDate,
      created_by_member_id: input.createdByMemberId,
    } as any)
    .returning({ id: schema.volunteerPrograms.id });

  await replaceProgramManagers(row.id, input.managerIds ?? []);
  return { id: row.id };
}

export async function updateProgram(
  programId: number,
  input: {
    title?: string;
    description?: string | null;
    pointOfContact?: string;
    location?: string | null;
    startDate?: string | null;
    managerIds?: number[];
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
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.pointOfContact !== undefined) {
    const poc = input.pointOfContact.trim();
    if (!poc) throw new VolunteeringServiceError('Point of contact is required');
    patch.point_of_contact = poc;
  }
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.startDate !== undefined) {
    patch.start_date = parseOptionalDateOnly(input.startDate, 'start date');
  }

  await db.update(schema.volunteerPrograms).set(patch as any).where(eq(schema.volunteerPrograms.id, programId));

  if (input.managerIds !== undefined) {
    await replaceProgramManagers(programId, input.managerIds);
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
): Promise<{ id: number }> {
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
      normalizeDateOnly(source.start_date) ??
      formatDateInTimeZone(new Date(requireIso(sourceShifts[0].start_dt as any, 'start datetime')), timeZone);
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

    const shiftsPayload = sourceShifts.map((shift) => {
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
      const roles = sourceShiftRoles
        .filter((sr) => sr.shift_id === shift.id)
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
      return { startDt, endDt, roles };
    });

    await createShiftsBulk({ programId: created.id, shifts: shiftsPayload });
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
    roles: Array<{ roleId: number; volunteersNeeded: number }>;
  }>;
}): Promise<{ shiftIds: number[] }> {
  const { db, schema } = getDrizzleDb();
  if (!input.shifts.length) throw new VolunteeringServiceError('At least one shift is required');

  const program = await db
    .select({ id: schema.volunteerPrograms.id })
    .from(schema.volunteerPrograms)
    .where(eq(schema.volunteerPrograms.id, input.programId))
    .limit(1);
  if (!program[0]) throw new VolunteeringServiceError('Program not found', 404);

  const programRoles = await db
    .select({ id: schema.volunteerRoles.id })
    .from(schema.volunteerRoles)
    .where(eq(schema.volunteerRoles.program_id, input.programId));
  const validRoleIds = new Set(programRoles.map((r) => r.id));

  const shiftIds: number[] = [];
  for (const shift of input.shifts) {
    const startDt = parseDateInput(shift.startDt, 'start datetime');
    const endDt = parseDateInput(shift.endDt, 'end datetime');
    if (new Date(endDt) <= new Date(startDt)) {
      throw new VolunteeringServiceError('Shift end must be after start');
    }
    if (!shift.roles.length) {
      throw new VolunteeringServiceError('Each shift needs at least one role');
    }

    const [created] = await db
      .insert(schema.volunteerShifts)
      .values({
        program_id: input.programId,
        start_dt: startDt,
        end_dt: endDt,
      } as any)
      .returning({ id: schema.volunteerShifts.id });

    shiftIds.push(created.id);

    const seenRoles = new Set<number>();
    for (const role of shift.roles) {
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

    await db.insert(schema.volunteerShiftRoles).values(
      shift.roles.map((role) => ({
        shift_id: created.id,
        role_id: role.roleId,
        volunteers_needed: role.volunteersNeeded,
      }))
    );
  }

  return { shiftIds };
}

export async function updateShift(
  shiftId: number,
  input: {
    startDt?: string;
    endDt?: string;
    roles?: Array<{ roleId: number; volunteersNeeded: number }>;
  }
): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.id, shiftId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Shift not found', 404);

  const startDt = input.startDt
    ? parseDateInput(input.startDt, 'start datetime')
    : requireIso(existing[0].start_dt as any, 'start datetime');
  const endDt = input.endDt
    ? parseDateInput(input.endDt, 'end datetime')
    : requireIso(existing[0].end_dt as any, 'end datetime');
  if (new Date(endDt) <= new Date(startDt)) {
    throw new VolunteeringServiceError('Shift end must be after start');
  }

  await db
    .update(schema.volunteerShifts)
    .set({
      start_dt: startDt,
      end_dt: endDt,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerShifts.id, shiftId));

  if (input.roles !== undefined) {
    if (!input.roles.length) throw new VolunteeringServiceError('Each shift needs at least one role');
    const programRoles = await db
      .select({ id: schema.volunteerRoles.id })
      .from(schema.volunteerRoles)
      .where(eq(schema.volunteerRoles.program_id, existing[0].program_id));
    const validRoleIds = new Set(programRoles.map((r) => r.id));

    const current = await db
      .select()
      .from(schema.volunteerShiftRoles)
      .where(eq(schema.volunteerShiftRoles.shift_id, shiftId));
    const currentByRole = new Map(current.map((r) => [r.role_id, r]));
    const nextRoleIds = new Set(input.roles.map((r) => r.roleId));

    for (const role of input.roles) {
      if (!validRoleIds.has(role.roleId)) {
        throw new VolunteeringServiceError(`Role ${role.roleId} does not belong to this program`);
      }
      if (!Number.isFinite(role.volunteersNeeded) || role.volunteersNeeded < 1) {
        throw new VolunteeringServiceError('Volunteers needed must be at least 1');
      }
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

  return { programId: existing[0].program_id };
}

export async function deleteShift(shiftId: number): Promise<{ programId: number }> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerShifts)
    .where(eq(schema.volunteerShifts.id, shiftId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Shift not found', 404);
  await db.delete(schema.volunteerShifts).where(eq(schema.volunteerShifts.id, shiftId));
  return { programId: existing[0].program_id };
}

export async function createCredential(input: {
  name: string;
  description?: string | null;
  pointOfContactEmail: string;
  managerIds?: number[];
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const name = input.name.trim();
  const email = input.pointOfContactEmail.trim();
  if (!name) throw new VolunteeringServiceError('Credential name is required');
  if (!email) throw new VolunteeringServiceError('Point of contact email is required');

  const [row] = await db
    .insert(schema.volunteerCredentials)
    .values({
      name,
      description: input.description?.trim() || null,
      point_of_contact_email: email,
    } as any)
    .returning({ id: schema.volunteerCredentials.id });

  await replaceCredentialManagers(row.id, input.managerIds ?? []);
  return { id: row.id };
}

export async function updateCredential(
  credentialId: number,
  input: {
    name?: string;
    description?: string | null;
    pointOfContactEmail?: string;
    managerIds?: number[];
  }
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, credentialId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Credential not found', 404);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new VolunteeringServiceError('Credential name is required');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.pointOfContactEmail !== undefined) {
    const email = input.pointOfContactEmail.trim();
    if (!email) throw new VolunteeringServiceError('Point of contact email is required');
    patch.point_of_contact_email = email;
  }

  await db
    .update(schema.volunteerCredentials)
    .set(patch as any)
    .where(eq(schema.volunteerCredentials.id, credentialId));

  if (input.managerIds !== undefined) {
    await replaceCredentialManagers(credentialId, input.managerIds);
  }
}

export async function deleteCredential(credentialId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.volunteerCredentials.id })
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, credentialId))
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Credential not found', 404);
  await db.delete(schema.volunteerCredentials).where(eq(schema.volunteerCredentials.id, credentialId));
}

export async function grantCredential(input: {
  credentialId: number;
  memberId: number;
  grantedByMemberId: number;
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const credential = await db
    .select({ id: schema.volunteerCredentials.id })
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, input.credentialId))
    .limit(1);
  if (!credential[0]) throw new VolunteeringServiceError('Credential not found', 404);

  const member = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member[0]) throw new VolunteeringServiceError('Member not found', 404);

  const existing = await db
    .select({ id: schema.memberVolunteerCredentials.id })
    .from(schema.memberVolunteerCredentials)
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, input.memberId),
        eq(schema.memberVolunteerCredentials.credential_id, input.credentialId)
      )
    )
    .limit(1);
  if (existing[0]) throw new VolunteeringServiceError('Member already has this credential', 409);

  const [row] = await db
    .insert(schema.memberVolunteerCredentials)
    .values({
      member_id: input.memberId,
      credential_id: input.credentialId,
      granted_by_member_id: input.grantedByMemberId,
    } as any)
    .returning({ id: schema.memberVolunteerCredentials.id });

  return { id: row.id };
}

export async function revokeCredential(credentialId: number, memberId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.memberVolunteerCredentials.id })
    .from(schema.memberVolunteerCredentials)
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, memberId),
        eq(schema.memberVolunteerCredentials.credential_id, credentialId)
      )
    )
    .limit(1);
  if (!existing[0]) throw new VolunteeringServiceError('Credential grant not found', 404);
  await db
    .delete(schema.memberVolunteerCredentials)
    .where(eq(schema.memberVolunteerCredentials.id, existing[0].id));
}

export async function listCredentialsAdmin(member: Member): Promise<CredentialAdminView[]> {
  const { db, schema } = getDrizzleDb();
  const managedIds = await listManagedCredentialIds(member);

  let credentials = await db.select().from(schema.volunteerCredentials).orderBy(asc(schema.volunteerCredentials.name));
  if (managedIds !== 'all') {
    const idSet = new Set(managedIds);
    credentials = credentials.filter((c) => idSet.has(c.id));
  }

  if (credentials.length === 0) return [];

  const credentialIds = credentials.map((c) => c.id);
  const managers = await db
    .select({
      credentialId: schema.volunteerCredentialManagers.credential_id,
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.volunteerCredentialManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerCredentialManagers.member_id))
    .where(inArray(schema.volunteerCredentialManagers.credential_id, credentialIds));

  const grants = await db
    .select({
      id: schema.memberVolunteerCredentials.id,
      credentialId: schema.memberVolunteerCredentials.credential_id,
      memberId: schema.members.id,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
      grantedAt: schema.memberVolunteerCredentials.granted_at,
      grantedByMemberId: schema.memberVolunteerCredentials.granted_by_member_id,
    })
    .from(schema.memberVolunteerCredentials)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberVolunteerCredentials.member_id))
    .where(inArray(schema.memberVolunteerCredentials.credential_id, credentialIds));

  return credentials.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    pointOfContactEmail: c.point_of_contact_email,
    managers: managers
      .filter((m) => m.credentialId === c.id)
      .map((m) => ({ id: m.id, name: m.name, email: m.email })),
    grants: grants
      .filter((g) => g.credentialId === c.id)
      .map((g) => ({
        id: g.id,
        memberId: g.memberId,
        memberName: g.memberName,
        memberEmail: g.memberEmail,
        grantedAt: requireIso(g.grantedAt as any, 'grantedAt'),
        grantedByMemberId: g.grantedByMemberId,
      })),
  }));
}

export async function listMyCredentials(memberId: number): Promise<VolunteerCredentialSummary[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerCredentials.id,
      name: schema.volunteerCredentials.name,
      description: schema.volunteerCredentials.description,
      pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
    })
    .from(schema.memberVolunteerCredentials)
    .innerJoin(
      schema.volunteerCredentials,
      eq(schema.volunteerCredentials.id, schema.memberVolunteerCredentials.credential_id)
    )
    .where(eq(schema.memberVolunteerCredentials.member_id, memberId))
    .orderBy(asc(schema.volunteerCredentials.name));
  return rows;
}

export async function listHubCredentials(memberId: number): Promise<VolunteerHubCredential[]> {
  const { db, schema } = getDrizzleDb();
  const [credentials, held] = await Promise.all([
    db
      .select({
        id: schema.volunteerCredentials.id,
        name: schema.volunteerCredentials.name,
        description: schema.volunteerCredentials.description,
        pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
      })
      .from(schema.volunteerCredentials)
      .orderBy(asc(schema.volunteerCredentials.name)),
    getMemberCredentials(memberId),
  ]);
  return credentials.map((c) => ({
    ...c,
    held: held.has(c.id),
  }));
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
  const heldCredentials = await getMemberCredentials(options.member.id);

  let programs = await db.select().from(schema.volunteerPrograms).orderBy(asc(schema.volunteerPrograms.title));
  if (!options.includeArchived) {
    programs = programs.filter((p) => !p.archived_at);
  }
  if (options.programIds !== undefined && options.programIds !== 'all') {
    const idSet = new Set(options.programIds);
    programs = programs.filter((p) => idSet.has(p.id));
  }
  if (programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);
  const globalManager = isVolunteerManager(options.member);

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
            guestName: schema.volunteerSignups.guest_name,
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
        const rolesForShift: VolunteerShiftRoleView[] = shiftRoles
          .filter((sr) => sr.shiftId === shift.id)
          .map((sr) => {
            const required = roleCredMap.get(sr.roleId) ?? [];
            const roleSignups = signups
              .filter((su) => su.shiftRoleId === sr.id)
              .map((su) => {
                const displayName =
                  (su.memberName && String(su.memberName).trim()) ||
                  (su.guestName && String(su.guestName).trim()) ||
                  'Volunteer';
                return {
                  id: su.id,
                  memberId: su.memberId ?? null,
                  memberName: displayName,
                  guestName: su.guestName ?? null,
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
              callerHasCredentials: memberHasAllCredentials(heldCredentials, required),
              callerIsSignedUp: roleSignups.some((su) => su.memberId === options.member.id),
              signups: roleSignups,
            };
          });

        return {
          id: shift.id,
          programId: shift.program_id,
          startDt: requireIso(shift.start_dt as any, 'startDt'),
          endDt: requireIso(shift.end_dt as any, 'endDt'),
          roles: rolesForShift,
        };
      });

    return {
      id: program.id,
      title: program.title,
      description: program.description,
      pointOfContact: program.point_of_contact,
      location: program.location,
      startDate: normalizeDateOnly(program.start_date as any),
      archivedAt: toIso(program.archived_at as any),
      createdAt: requireIso(program.created_at as any, 'createdAt'),
      updatedAt: requireIso(program.updated_at as any, 'updatedAt'),
      managers: programManagers,
      roles: programRoles,
      shifts: programShifts,
      canManage,
    };
  });
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
  return { programs, myCredentials, credentials };
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

export async function listDashboardOpportunities(memberId: number): Promise<DashboardOpportunity[]> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const held = await getMemberCredentials(memberId);

  const shifts = await db
    .select({
      shiftId: schema.volunteerShifts.id,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
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
  const shiftMap = new Map(shifts.map((s) => [s.shiftId, s]));

  const opportunities: DashboardOpportunity[] = [];
  for (const sr of shiftRoles) {
    const shift = shiftMap.get(sr.shiftId);
    if (!shift) continue;
    const required = roleCredMap.get(sr.roleId) ?? [];
    if (!memberHasAllCredentials(held, required)) continue;
    const registered = countMap.get(sr.id) ?? 0;
    if (registered >= sr.volunteersNeeded) continue;
    opportunities.push({
      shiftRoleId: sr.id,
      programId: shift.programId,
      programTitle: shift.programTitle,
      location: shift.location,
      roleId: sr.roleId,
      roleName: sr.roleName,
      startDt: requireIso(shift.startDt as any, 'startDt'),
      endDt: requireIso(shift.endDt as any, 'endDt'),
      volunteersNeeded: sr.volunteersNeeded,
      volunteersRegistered: registered,
    });
  }

  return opportunities;
}

export async function listMySignups(memberId: number): Promise<{
  upcoming: MySignupView[];
  past: MySignupView[];
}> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      shiftRoleId: schema.volunteerSignups.shift_role_id,
      status: schema.volunteerSignups.status,
      comments: schema.volunteerSignups.comments,
      programId: schema.volunteerPrograms.id,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      roleId: schema.volunteerRoles.id,
      roleName: schema.volunteerRoles.name,
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
        eq(schema.volunteerSignups.member_id, memberId),
        eq(schema.volunteerSignups.status, 'confirmed')
      )
    )
    .orderBy(asc(schema.volunteerShifts.start_dt));

  const upcoming: MySignupView[] = [];
  const past: MySignupView[] = [];
  for (const row of rows) {
    const startDt = requireIso(row.startDt as any, 'startDt');
    const view: MySignupView = {
      signupId: row.signupId,
      shiftRoleId: row.shiftRoleId,
      programId: row.programId,
      programTitle: row.programTitle,
      location: row.location,
      roleId: row.roleId,
      roleName: row.roleName,
      startDt,
      endDt: requireIso(row.endDt as any, 'endDt'),
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
      .map((name) => String(name ?? '').trim())
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

  const startDt = requireIso(target.startDt as any, 'startDt');
  const endDt = requireIso(target.endDt as any, 'endDt');
  if (startDt <= now.toISOString()) {
    throw new VolunteeringServiceError('This shift has already started', 409);
  }

  const requiredMap = await getRoleRequiredCredentialMap([target.roleId]);
  const required = requiredMap.get(target.roleId) ?? [];
  const actorHeld = await getMemberCredentials(actor.id);
  if (!memberHasAllCredentials(actorHeld, required)) {
    throw new VolunteeringServiceError('Missing required credentials for this role', 403);
  }
  if (guestNames.length > 0 && required.length > 0) {
    throw new VolunteeringServiceError(
      'This role requires credentials, so only club members with those credentials can be signed up',
      403
    );
  }

  for (const memberId of memberIds) {
    const held = memberId === actor.id ? actorHeld : await getMemberCredentials(memberId);
    if (!memberHasAllCredentials(held, required)) {
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
        location: target.location,
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
      location: row.location,
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
    await sendVolunteerCancellationEmails({
      memberEmail: row.memberEmail,
      memberName: row.memberName || row.guestName || 'Volunteer',
      managerEmails: managerEmails
        .filter((m) => m.email)
        .map((m) => ({ email: m.email!, name: m.name })),
      programTitle: row.programTitle,
      roleName: row.roleName,
      startDt: requireIso(row.startDt as any, 'startDt'),
      endDt: requireIso(row.endDt as any, 'endDt'),
      location: row.location,
      cancelledByManager: true,
    });
  } catch (err) {
    console.error('Failed to send volunteer cancellation emails:', err);
  }

  return { programId: row.programId };
}

export async function processVolunteerReminders(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .select({
      signupId: schema.volunteerSignups.id,
      memberEmail: schema.members.email,
      memberName: schema.members.name,
      roleName: schema.volunteerRoles.name,
      programTitle: schema.volunteerPrograms.title,
      location: schema.volunteerPrograms.location,
      startDt: schema.volunteerShifts.start_dt,
      endDt: schema.volunteerShifts.end_dt,
      reminderSentAt: schema.volunteerSignups.reminder_sent_at,
    })
    .from(schema.volunteerSignups)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
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
  const { sendVolunteerReminderEmail } = await import('./email.js');
  for (const row of rows) {
    if (!row.memberEmail) continue;
    try {
      await sendVolunteerReminderEmail({
        to: row.memberEmail,
        recipientName: row.memberName,
        programTitle: row.programTitle,
        roleName: row.roleName,
        startDt: requireIso(row.startDt as any, 'startDt'),
        endDt: requireIso(row.endDt as any, 'endDt'),
        location: row.location,
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
