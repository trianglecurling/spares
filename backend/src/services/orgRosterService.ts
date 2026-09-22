import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { OrgRosterConfirmationEmailResponse, OrgRostersResponse } from '../api/types.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
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
import { getDatabaseConfig } from '../db/config.js';

function normalizeDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.split('T')[0] || null;
  if (value instanceof Date) return value.toISOString().split('T')[0] || null;
  return String(value).split('T')[0] || null;
}

function dateColumnBindValue(dateString: string): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return new Date(`${dateString}T00:00:00`);
  }
  return dateString;
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

export async function getOrgRosters(): Promise<OrgRostersResponse> {
  const today = await getCurrentDateStringAsync();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
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

  const memberIds = rows.map((row) => row.id);
  const membershipTypeByMemberId = new Map<number, 'regular' | 'social' | 'junior_recreational'>();
  if (memberIds.length > 0) {
    const todayValue = dateColumnBindValue(today);
    const memberships = await db
      .select({
        memberId: schema.seasonMemberships.member_id,
        membershipType: schema.seasonMemberships.membership_type,
        endsAt: schema.seasonMemberships.ends_at,
      })
      .from(schema.seasonMemberships)
      .where(
        and(
          inArray(schema.seasonMemberships.member_id, memberIds),
          inArray(schema.seasonMemberships.status, ['pending', 'active']),
          gte(schema.seasonMemberships.ends_at, todayValue as never),
        ),
      )
      .orderBy(desc(schema.seasonMemberships.ends_at));
    for (const membership of memberships) {
      if (!membershipTypeByMemberId.has(membership.memberId)) {
        membershipTypeByMemberId.set(membership.memberId, membership.membershipType);
      }
    }
  }

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
      membershipType: membershipTypeByMemberId.get(row.id) ?? null,
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
        fromAnotherClub,
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
    members,
    usaCurlingTsv: buildUsaCurlingRosterTsv(usaCurlingRows),
    uswcaTsv: buildUswcaRosterTsv(uswcaRows),
  };
}

export async function queueOrgRosterConfirmationEmails(input: {
  confirmByDate: string;
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

  void Promise.all(tasks);
  return { queued, skippedNoEmail };
}
