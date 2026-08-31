import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { isVolunteerManager } from '../utils/auth.js';
import { config } from '../config.js';
import { formatDateInTimeZone } from '../utils/timeZone.js';
import { normalizePersonName } from '../utils/memberName.js';
import type { Member } from '../types.js';
import { VolunteeringServiceError } from './volunteeringServiceError.js';
import {
  parseAdditionalMemberIds,
  parseVolunteerHourLogInput,
  VolunteerHourLogValidationError,
} from '../utils/volunteerHourLogs.js';

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

export type VolunteerHourLogWriteInput = {
  volunteerDate: unknown;
  hours: unknown;
  description: unknown;
  additionalMemberIds?: unknown;
};

export type VolunteerHourLogAdminWriteInput = VolunteerHourLogWriteInput & {
  memberId: unknown;
};

export type VolunteerHourLogListResult = {
  items: VolunteerHourLogView[];
  page: number;
  pageSize: number;
  total: number;
  totalHours: number;
};

const ADMIN_SORT_KEYS = ['volunteerDate', 'hours', 'memberName', 'createdAt'] as const;
type AdminSortKey = (typeof ADMIN_SORT_KEYS)[number];

type HourLogRow = {
  id: number;
  memberId: number;
  memberName: string | null;
  volunteerDate: unknown;
  hours: unknown;
  description: string;
  createdByMemberId: number | null;
  createdAt: unknown;
  updatedAt: unknown;
};

function clubDateOnly(instant: Date): string {
  return formatDateInTimeZone(instant, config.timeZone) ?? instant.toISOString().slice(0, 10);
}

function toIso(value: string | Date | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || raw.endsWith('Z')) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function normalizeDateOnly(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function requireVolunteerAdmin(member: Member): void {
  if (!isVolunteerManager(member)) {
    throw new VolunteeringServiceError('Forbidden', 403);
  }
}

function parseMemberId(value: unknown): number {
  const memberId = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw new VolunteerHourLogValidationError('Select a member.', {
      memberId: 'Select a member.',
    });
  }
  return memberId;
}

function displayName(value: string | null | undefined): string {
  return normalizePersonName(value) || value || 'Member';
}

async function createdByNameMap(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(ids.filter((id): id is number => typeof id === 'number' && id > 0))];
  if (uniqueIds.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, displayName(row.name)]));
}

function mapHourLog(row: HourLogRow, createdByNames: Map<number, string>): VolunteerHourLogView {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: displayName(row.memberName),
    volunteerDate: normalizeDateOnly(row.volunteerDate),
    hours: Math.round(Number(row.hours) * 10) / 10,
    description: row.description,
    createdByMemberId: row.createdByMemberId,
    createdByMemberName:
      row.createdByMemberId != null ? createdByNames.get(row.createdByMemberId) ?? null : null,
    createdAt: toIso(row.createdAt as string | Date),
    updatedAt: toIso(row.updatedAt as string | Date),
  };
}

async function mapHourLogs(rows: HourLogRow[]): Promise<VolunteerHourLogView[]> {
  const createdByNames = await createdByNameMap(rows.map((row) => row.createdByMemberId));
  return rows.map((row) => mapHourLog(row, createdByNames));
}

async function todayClubDate(): Promise<string> {
  return clubDateOnly(await getCurrentTimeAsync());
}

async function assertMemberExists(memberId: number): Promise<void> {
  await assertMembersExist([memberId], 'memberId');
}

async function assertMembersExist(
  memberIds: number[],
  field: 'memberId' | 'additionalMemberIds' = 'memberId'
): Promise<void> {
  if (memberIds.length === 0) return;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  if (rows.length !== memberIds.length) {
    throw new VolunteerHourLogValidationError(
      field === 'additionalMemberIds' ? 'One or more members could not be found.' : 'Member not found.',
      {
        [field]: field === 'additionalMemberIds' ? 'Select valid members.' : 'Select a member.',
      }
    );
  }
}

function hourLogColumns() {
  const { schema } = getDrizzleDb();
  return {
    id: schema.volunteerHourLogs.id,
    memberId: schema.volunteerHourLogs.member_id,
    memberName: schema.members.name,
    volunteerDate: schema.volunteerHourLogs.volunteer_date,
    hours: schema.volunteerHourLogs.hours,
    description: schema.volunteerHourLogs.description,
    createdByMemberId: schema.volunteerHourLogs.created_by_member_id,
    createdAt: schema.volunteerHourLogs.created_at,
    updatedAt: schema.volunteerHourLogs.updated_at,
  };
}

async function loadHourLogById(id: number): Promise<VolunteerHourLogView | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select(hourLogColumns())
    .from(schema.volunteerHourLogs)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id))
    .where(eq(schema.volunteerHourLogs.id, id))
    .limit(1);
  if (!row) return null;
  const [mapped] = await mapHourLogs([row]);
  return mapped ?? null;
}

async function insertHourLog(input: {
  memberId: number;
  volunteerDate: string;
  hours: number;
  description: string;
  actorMemberId: number;
}): Promise<VolunteerHourLogView> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .insert(schema.volunteerHourLogs)
    .values({
      member_id: input.memberId,
      volunteer_date: input.volunteerDate,
      hours: input.hours,
      description: input.description,
      created_by_member_id: input.actorMemberId,
      updated_by_member_id: input.actorMemberId,
    } as any)
    .returning({ id: schema.volunteerHourLogs.id });
  const created = await loadHourLogById(row.id);
  if (!created) throw new VolunteeringServiceError('Failed to save volunteer hours', 500);
  return created;
}

export async function listMyHourLogs(memberId: number): Promise<VolunteerHourLogListResult> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select(hourLogColumns())
    .from(schema.volunteerHourLogs)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id))
    .where(eq(schema.volunteerHourLogs.member_id, memberId))
    .orderBy(desc(schema.volunteerHourLogs.volunteer_date), desc(schema.volunteerHourLogs.id));

  const items = await mapHourLogs(rows);
  const totalHours = Math.round(items.reduce((sum, item) => sum + item.hours, 0) * 10) / 10;
  return {
    items,
    page: 1,
    pageSize: items.length,
    total: items.length,
    totalHours,
  };
}

export async function createMyHourLog(
  member: Member,
  input: VolunteerHourLogWriteInput
): Promise<VolunteerHourLogView> {
  const parsed = parseVolunteerHourLogInput(input, await todayClubDate());
  const additionalMemberIds = parseAdditionalMemberIds(input.additionalMemberIds, member.id);
  await assertMembersExist(additionalMemberIds, 'additionalMemberIds');

  if (additionalMemberIds.length === 0) {
    return insertHourLog({
      memberId: member.id,
      volunteerDate: parsed.volunteerDate,
      hours: parsed.hours,
      description: parsed.description,
      actorMemberId: member.id,
    });
  }

  const { db, schema } = getDrizzleDb();
  const memberIds = [member.id, ...additionalMemberIds];
  const inserted = await db.transaction(async (tx) => {
    return tx
      .insert(schema.volunteerHourLogs)
      .values(
        memberIds.map((memberId) => ({
          member_id: memberId,
          volunteer_date: parsed.volunteerDate,
          hours: parsed.hours,
          description: parsed.description,
          created_by_member_id: member.id,
          updated_by_member_id: member.id,
        })) as any
      )
      .returning({
        id: schema.volunteerHourLogs.id,
        memberId: schema.volunteerHourLogs.member_id,
      });
  });

  const actorRow = inserted.find((row) => row.memberId === member.id) ?? inserted[0];
  if (!actorRow) throw new VolunteeringServiceError('Failed to save volunteer hours', 500);
  const created = await loadHourLogById(actorRow.id);
  if (!created) throw new VolunteeringServiceError('Failed to save volunteer hours', 500);
  return created;
}

export async function updateMyHourLog(
  member: Member,
  id: number,
  input: VolunteerHourLogWriteInput
): Promise<VolunteerHourLogView> {
  const existing = await loadHourLogById(id);
  if (!existing || existing.memberId !== member.id) {
    throw new VolunteeringServiceError('Volunteer hours not found', 404);
  }
  const parsed = parseVolunteerHourLogInput(input, await todayClubDate());
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.volunteerHourLogs)
    .set({
      volunteer_date: parsed.volunteerDate,
      hours: parsed.hours,
      description: parsed.description,
      updated_by_member_id: member.id,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerHourLogs.id, id));
  const updated = await loadHourLogById(id);
  if (!updated) throw new VolunteeringServiceError('Volunteer hours not found', 404);
  return updated;
}

export async function deleteMyHourLog(member: Member, id: number): Promise<void> {
  const existing = await loadHourLogById(id);
  if (!existing || existing.memberId !== member.id) {
    throw new VolunteeringServiceError('Volunteer hours not found', 404);
  }
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.volunteerHourLogs).where(eq(schema.volunteerHourLogs.id, id));
}

export async function listAdminHourLogs(
  member: Member,
  query: {
    page?: number;
    pageSize?: number;
    search?: string;
    sort?: string;
    order?: string;
  }
): Promise<VolunteerHourLogListResult> {
  requireVolunteerAdmin(member);
  const { db, schema } = getDrizzleDb();
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const sortKey: AdminSortKey = ADMIN_SORT_KEYS.includes(query.sort as AdminSortKey)
    ? (query.sort as AdminSortKey)
    : 'volunteerDate';
  const order = query.order === 'asc' ? 'asc' : 'desc';
  const filters = [];
  const search = query.search?.trim();
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    filters.push(
      sql`(
        lower(${schema.members.name}) like ${like}
        or lower(coalesce(${schema.members.email}, '')) like ${like}
        or lower(${schema.volunteerHourLogs.description}) like ${like}
      )`
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const sortColumn =
    sortKey === 'hours'
      ? schema.volunteerHourLogs.hours
      : sortKey === 'memberName'
        ? schema.members.name
        : sortKey === 'createdAt'
          ? schema.volunteerHourLogs.created_at
          : schema.volunteerHourLogs.volunteer_date;
  const sortExpr = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const [countRow] = await db
    .select({
      count: sql<number>`count(*)`,
      totalHours: sql<number>`coalesce(sum(${schema.volunteerHourLogs.hours}), 0)`,
    })
    .from(schema.volunteerHourLogs)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id))
    .where(where);

  const rows = await db
    .select(hourLogColumns())
    .from(schema.volunteerHourLogs)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id))
    .where(where)
    .orderBy(sortExpr, desc(schema.volunteerHourLogs.id))
    .limit(pageSize)
    .offset(offset);

  return {
    items: await mapHourLogs(rows),
    page,
    pageSize,
    total: Number(countRow?.count ?? 0),
    totalHours: Math.round(Number(countRow?.totalHours ?? 0) * 10) / 10,
  };
}

export async function createAdminHourLog(
  member: Member,
  input: VolunteerHourLogAdminWriteInput
): Promise<VolunteerHourLogView> {
  requireVolunteerAdmin(member);
  const memberId = parseMemberId(input.memberId);
  await assertMemberExists(memberId);
  const parsed = parseVolunteerHourLogInput(input, await todayClubDate());
  return insertHourLog({
    memberId,
    volunteerDate: parsed.volunteerDate,
    hours: parsed.hours,
    description: parsed.description,
    actorMemberId: member.id,
  });
}

export async function updateAdminHourLog(
  member: Member,
  id: number,
  input: VolunteerHourLogAdminWriteInput
): Promise<VolunteerHourLogView> {
  requireVolunteerAdmin(member);
  const existing = await loadHourLogById(id);
  if (!existing) throw new VolunteeringServiceError('Volunteer hours not found', 404);
  const memberId = parseMemberId(input.memberId);
  await assertMemberExists(memberId);
  const parsed = parseVolunteerHourLogInput(input, await todayClubDate());
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.volunteerHourLogs)
    .set({
      member_id: memberId,
      volunteer_date: parsed.volunteerDate,
      hours: parsed.hours,
      description: parsed.description,
      updated_by_member_id: member.id,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerHourLogs.id, id));
  const updated = await loadHourLogById(id);
  if (!updated) throw new VolunteeringServiceError('Volunteer hours not found', 404);
  return updated;
}

export async function deleteAdminHourLog(member: Member, id: number): Promise<void> {
  requireVolunteerAdmin(member);
  const existing = await loadHourLogById(id);
  if (!existing) throw new VolunteeringServiceError('Volunteer hours not found', 404);
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.volunteerHourLogs).where(eq(schema.volunteerHourLogs.id, id));
}

export async function listHourLogsForStats(): Promise<
  Array<{
    id: number;
    memberId: number;
    memberName: string | null;
    volunteerDate: string;
    hours: number;
    description: string | null;
  }>
> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerHourLogs.id,
      memberId: schema.volunteerHourLogs.member_id,
      memberName: schema.members.name,
      volunteerDate: schema.volunteerHourLogs.volunteer_date,
      hours: schema.volunteerHourLogs.hours,
      description: schema.volunteerHourLogs.description,
    })
    .from(schema.volunteerHourLogs)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id));
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName ? normalizePersonName(row.memberName) || row.memberName : null,
    volunteerDate: normalizeDateOnly(row.volunteerDate),
    hours: Number(row.hours),
    description: row.description?.trim() || null,
  }));
}
