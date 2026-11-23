import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { config } from '../config.js';
import type { Member } from '../types.js';
import { isVolunteerManager } from '../utils/auth.js';
import { addCalendarDays, formatDateInTimeZone } from '../utils/timeZone.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { normalizePersonName } from '../utils/memberName.js';
import {
  parseVolunteerCreditHours,
  volunteerCreditHoursForSignup,
} from '../utils/volunteerStats.js';
import {
  buildVolunteerReportCsv,
  collectVolunteerReportActivities,
  volunteerReportFilename,
  type VolunteerReportHourLogSource,
  type VolunteerReportSignupSource,
} from '../utils/volunteerReport.js';
import { VolunteeringServiceError } from './volunteeringServiceError.js';

function clubDateOnly(instant: Date): string {
  return formatDateInTimeZone(instant, config.timeZone) ?? instant.toISOString().slice(0, 10);
}

function toIso(value: string | Date | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function shiftDateOnly(startDt: string): string {
  const parsed = new Date(startDt);
  if (Number.isNaN(parsed.getTime())) return startDt.slice(0, 10);
  return clubDateOnly(parsed);
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

export async function exportVolunteerReport(
  member: Member,
  range: { from: string; to: string }
): Promise<{ csv: string; filename: string }> {
  if (!isVolunteerManager(member)) {
    throw new VolunteeringServiceError('Forbidden', 403);
  }

  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowIso = now.toISOString();
  const today = clubDateOnly(now);
  const startLower = `${addCalendarDays(range.from, -2)}T00:00:00.000Z`;
  const startUpper = `${addCalendarDays(range.to, 2)}T23:59:59.999Z`;

  const [signupRows, hourLogRows] = await Promise.all([
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
        roleName: schema.volunteerRoles.name,
        status: schema.volunteerSignups.status,
      })
      .from(schema.volunteerSignups)
      .innerJoin(
        schema.volunteerShiftRoles,
        eq(schema.volunteerShiftRoles.id, schema.volunteerSignups.shift_role_id)
      )
      .innerJoin(schema.volunteerShifts, eq(schema.volunteerShifts.id, schema.volunteerShiftRoles.shift_id))
      .innerJoin(schema.volunteerPrograms, eq(schema.volunteerPrograms.id, schema.volunteerShifts.program_id))
      .innerJoin(schema.volunteerRoles, eq(schema.volunteerRoles.id, schema.volunteerShiftRoles.role_id))
      .innerJoin(schema.members, eq(schema.members.id, schema.volunteerSignups.member_id))
      .where(
        and(
          eq(schema.volunteerSignups.status, 'confirmed'),
          isNotNull(schema.volunteerSignups.member_id),
          eq(schema.volunteerPrograms.signup_kind, 'volunteering'),
          gte(schema.volunteerShifts.start_dt, startLower),
          lte(schema.volunteerShifts.start_dt, startUpper),
          lte(schema.volunteerShifts.start_dt, nowIso)
        )
      ),
    db
      .select({
        id: schema.volunteerHourLogs.id,
        memberId: schema.volunteerHourLogs.member_id,
        memberName: schema.members.name,
        volunteerDate: schema.volunteerHourLogs.volunteer_date,
        hours: schema.volunteerHourLogs.hours,
        description: schema.volunteerHourLogs.description,
      })
      .from(schema.volunteerHourLogs)
      .innerJoin(schema.members, eq(schema.members.id, schema.volunteerHourLogs.member_id))
      .where(
        and(
          gte(schema.volunteerHourLogs.volunteer_date, range.from),
          lte(schema.volunteerHourLogs.volunteer_date, range.to)
        )
      ),
  ]);

  const signups: VolunteerReportSignupSource[] = signupRows.map((row) => {
    const startDt = toIso(row.startDt as string | Date);
    const endDt = toIso(row.endDt as string | Date);
    return {
      signupId: row.signupId,
      memberId: row.memberId,
      memberName: row.memberName ? normalizePersonName(row.memberName) || row.memberName : null,
      shiftId: row.shiftId,
      startDt,
      date: shiftDateOnly(startDt),
      roleName: row.roleName,
      creditHours: volunteerCreditHoursForSignup({
        creditHours: parseVolunteerCreditHours(row.creditHours),
        startDt,
        endDt,
      }),
      signupKind: row.signupKind,
      status: row.status,
    };
  });

  const hourLogs: VolunteerReportHourLogSource[] = hourLogRows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName ? normalizePersonName(row.memberName) || row.memberName : null,
    date: normalizeDateOnly(row.volunteerDate),
    hours: Number(row.hours),
    description: row.description,
  }));

  const activities = collectVolunteerReportActivities({
    from: range.from,
    to: range.to,
    today,
    nowIso,
    signups,
    hourLogs,
  });

  return {
    csv: buildVolunteerReportCsv(activities),
    filename: volunteerReportFilename(range.from, range.to),
  };
}
