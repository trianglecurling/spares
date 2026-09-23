import { and, eq, sql } from 'drizzle-orm';
import type { OrgRosterConfirmationEmailResponse, OrgRostersResponse } from '../api/types.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getDatabaseConfig } from '../db/config.js';
import { sendParentOrgConfirmationEmail } from './email.js';
import { ACCOUNT_KIND_PERSON } from '../utils/accountKind.js';
import { isValidDateOnly } from '../utils/memberAge.js';
import { memberNamePartsFromStored, normalizePersonName } from '../utils/memberName.js';
import { parentEmailForMinor } from '../utils/memberParentEmail.js';
import { absoluteFrontendUrl } from '../utils/frontendUrl.js';
import {
  buildUsaCurlingRosterTsv,
  buildUswcaRosterTsv,
  usaCurlingFromAnotherClub,
  usaCurlingMembershipType,
  type UsaCurlingRosterRow,
  type UswcaRosterRow,
} from '../utils/orgRosterFormat.js';
import {
  booleanFromSqliteFlag,
  resolveUsaCurlingMembershipOptIn,
  resolveUswcaMembershipOptIn,
} from '../utils/parentAssociationMemberships.js';
import { memberHasActiveMembershipCondition } from './memberMembershipStatusService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { toIsoTimestamp } from '../utils/clubOperatingDay.js';

const SINGLETON_SCOPE = 'singleton';

function normalizeDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.split('T')[0] || null;
  if (value instanceof Date) return value.toISOString().split('T')[0] || null;
  return String(value).split('T')[0] || null;
}

function timestampBindValue(date: Date): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return date;
  }
  return date.toISOString();
}

function competitionGender(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || 'Unspecified';
}

export class OrgRosterValidationError extends Error {
  details: Record<string, string>;

  constructor(details: Record<string, string>) {
    super('Validation failed');
    this.details = details;
  }
}

async function loadLastConfirmationEmailSend(): Promise<{
  lastConfirmationEmailsQueuedAt: string | null;
  lastConfirmationEmailsQueuedCount: number | null;
  lastConfirmationEmailsSkippedNoEmail: number | null;
  lastConfirmationEmailsConfirmByDate: string | null;
}> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      lastQueuedAt: schema.parentOrgConfirmationEmailState.last_queued_at,
      lastQueuedCount: schema.parentOrgConfirmationEmailState.last_queued_count,
      lastSkippedNoEmail: schema.parentOrgConfirmationEmailState.last_skipped_no_email,
      lastConfirmByDate: schema.parentOrgConfirmationEmailState.last_confirm_by_date,
    })
    .from(schema.parentOrgConfirmationEmailState)
    .where(eq(schema.parentOrgConfirmationEmailState.scope, SINGLETON_SCOPE))
    .limit(1);
  if (!row?.lastQueuedAt) {
    return {
      lastConfirmationEmailsQueuedAt: null,
      lastConfirmationEmailsQueuedCount: null,
      lastConfirmationEmailsSkippedNoEmail: null,
      lastConfirmationEmailsConfirmByDate: null,
    };
  }
  return {
    lastConfirmationEmailsQueuedAt: toIsoTimestamp(row.lastQueuedAt),
    lastConfirmationEmailsQueuedCount: row.lastQueuedCount,
    lastConfirmationEmailsSkippedNoEmail: row.lastSkippedNoEmail,
    lastConfirmationEmailsConfirmByDate: row.lastConfirmByDate,
  };
}

async function recordConfirmationEmailSend(input: {
  queued: number;
  skippedNoEmail: number;
  confirmByDate: string;
  actorMemberId: number;
}): Promise<void> {
  const now = new Date();
  const queuedAtValue = timestampBindValue(now);
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ scope: schema.parentOrgConfirmationEmailState.scope })
    .from(schema.parentOrgConfirmationEmailState)
    .where(eq(schema.parentOrgConfirmationEmailState.scope, SINGLETON_SCOPE))
    .limit(1);
  if (!existing) {
    await db.insert(schema.parentOrgConfirmationEmailState).values({
      scope: SINGLETON_SCOPE,
      last_queued_at: queuedAtValue as never,
      last_queued_count: input.queued,
      last_skipped_no_email: input.skippedNoEmail,
      last_confirm_by_date: input.confirmByDate,
      last_actor_member_id: input.actorMemberId,
    });
    return;
  }
  await db
    .update(schema.parentOrgConfirmationEmailState)
    .set({
      last_queued_at: queuedAtValue as never,
      last_queued_count: input.queued,
      last_skipped_no_email: input.skippedNoEmail,
      last_confirm_by_date: input.confirmByDate,
      last_actor_member_id: input.actorMemberId,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.parentOrgConfirmationEmailState.scope, SINGLETON_SCOPE));
}

export async function getOrgRosters(): Promise<OrgRostersResponse> {
  const today = await getCurrentDateStringAsync();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      phone: schema.members.phone,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
      date_of_birth: schema.members.date_of_birth,
      preferred_pronouns: schema.members.preferred_pronouns,
      usa_curling_competition_gender: schema.members.usa_curling_competition_gender,
      usa_curling_membership_opt_in: schema.members.usa_curling_membership_opt_in,
      uswca_membership_opt_in: schema.members.uswca_membership_opt_in,
      usa_curling_membership_number: schema.members.usa_curling_membership_number,
      baseline_other_club_experience_years: schema.members.baseline_other_club_experience_years,
    })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.account_kind, ACCOUNT_KIND_PERSON),
        memberHasActiveMembershipCondition(schema, today),
      ),
    )
    .orderBy(schema.members.last_name, schema.members.first_name, schema.members.name);

  const lastSend = await loadLastConfirmationEmailSend();
  const usaCurlingRows: UsaCurlingRosterRow[] = [];
  const uswcaRows: UswcaRosterRow[] = [];
  const members = rows.map((row) => {
    const names = memberNamePartsFromStored({
      name: row.name,
      first_name: row.first_name,
      last_name: row.last_name,
    });
    const usaCurlingOptIn = resolveUsaCurlingMembershipOptIn(
      booleanFromSqliteFlag(row.usa_curling_membership_opt_in),
    );
    const uswcaOptIn = resolveUswcaMembershipOptIn(
      booleanFromSqliteFlag(row.uswca_membership_opt_in),
      row.preferred_pronouns,
    );
    const membershipNumber = row.usa_curling_membership_number?.trim() || null;
    const membershipType = usaCurlingMembershipType({
      dateOfBirth: normalizeDateString(row.date_of_birth),
      asOfDate: today,
    });
    const fromAnotherClub = usaCurlingFromAnotherClub(row.baseline_other_club_experience_years);
    if (usaCurlingOptIn) {
      usaCurlingRows.push({
        email: row.email?.trim() || '',
        firstName: names.firstName,
        lastName: names.lastName,
        gender: competitionGender(row.usa_curling_competition_gender),
        dateOfBirth: normalizeDateString(row.date_of_birth),
        membershipNumber,
        validFrom: today,
        membershipType,
        primaryContactNumber: row.phone?.trim() || '',
      });
    }
    if (uswcaOptIn) {
      uswcaRows.push({
        lastName: names.lastName,
        firstName: names.firstName,
        email: row.email?.trim() || '',
      });
    }
    return {
      id: row.id,
      name: normalizePersonName(row.name) || row.name,
      firstName: names.firstName,
      lastName: names.lastName,
      email: row.email,
      usaCurlingOptIn,
      uswcaOptIn,
      usaCurlingMembershipNumber: membershipNumber,
      usaCurlingMembershipType: membershipType,
      usaCurlingFromAnotherClub: fromAnotherClub,
      missingUsaCurlingNumber: usaCurlingOptIn && !membershipNumber,
    };
  });

  return {
    generatedOn: today,
    currentMemberCount: members.length,
    usaCurlingCount: usaCurlingRows.length,
    uswcaCount: uswcaRows.length,
    missingUsaCurlingNumberCount: members.filter((member) => member.missingUsaCurlingNumber).length,
    lastConfirmationEmailsQueuedAt: lastSend.lastConfirmationEmailsQueuedAt,
    lastConfirmationEmailsQueuedCount: lastSend.lastConfirmationEmailsQueuedCount,
    lastConfirmationEmailsSkippedNoEmail: lastSend.lastConfirmationEmailsSkippedNoEmail,
    lastConfirmationEmailsConfirmByDate: lastSend.lastConfirmationEmailsConfirmByDate,
    members,
    usaCurlingTsv: buildUsaCurlingRosterTsv(usaCurlingRows),
    uswcaTsv: buildUswcaRosterTsv(uswcaRows),
  };
}

export async function queueOrgRosterConfirmationEmails(input: {
  confirmByDate: string;
  actorMemberId: number;
}): Promise<OrgRosterConfirmationEmailResponse> {
  const today = await getCurrentDateStringAsync();
  const confirmByDate = input.confirmByDate.trim();
  if (!isValidDateOnly(confirmByDate)) {
    throw new OrgRosterValidationError({ confirmByDate: 'Enter a valid confirmation date.' });
  }
  if (confirmByDate < today) {
    throw new OrgRosterValidationError({ confirmByDate: 'Confirmation date cannot be in the past.' });
  }

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      date_of_birth: schema.members.date_of_birth,
      preferred_pronouns: schema.members.preferred_pronouns,
      usa_curling_membership_opt_in: schema.members.usa_curling_membership_opt_in,
      uswca_membership_opt_in: schema.members.uswca_membership_opt_in,
      guardian_email: schema.members.guardian_email,
    })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.account_kind, ACCOUNT_KIND_PERSON),
        memberHasActiveMembershipCondition(schema, today),
      ),
    )
    .orderBy(schema.members.name);

  const profileUrl = absoluteFrontendUrl('/profile/parent-organizations');
  let queued = 0;
  let skippedNoEmail = 0;
  const tasks: Promise<void>[] = [];

  for (const row of rows) {
    const email = row.email?.trim() || '';
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }
    queued += 1;
    const usaCurlingOptIn = resolveUsaCurlingMembershipOptIn(
      booleanFromSqliteFlag(row.usa_curling_membership_opt_in),
    );
    const uswcaOptIn = resolveUswcaMembershipOptIn(
      booleanFromSqliteFlag(row.uswca_membership_opt_in),
      row.preferred_pronouns,
    );
    const cc = parentEmailForMinor({
      email,
      guardianEmail: row.guardian_email,
      dateOfBirth: row.date_of_birth,
    });
    tasks.push(
      sendParentOrgConfirmationEmail({
        email,
        name: normalizePersonName(row.name) || row.name,
        confirmByDate,
        usaCurlingOptIn,
        uswcaOptIn,
        profileUrl,
        cc,
      }).catch((error) => {
        console.error(`[Org rosters] Failed to send confirmation to ${email}:`, error);
      }),
    );
  }

  await recordConfirmationEmailSend({
    queued,
    skippedNoEmail,
    confirmByDate,
    actorMemberId: input.actorMemberId,
  });
  void Promise.all(tasks);
  return { queued, skippedNoEmail };
}
