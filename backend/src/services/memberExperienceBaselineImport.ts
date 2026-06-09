import { eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  normalizeHalfYearExperienceValue,
  validateHalfYearExperienceValue,
} from '../registration/curlingExperienceYears.js';
import { normalizeEmail } from '../utils/auth.js';
import {
  memberNameMatchKeyFromFullName,
  memberNamePartsFromStored,
  memberNameMatchKey,
} from '../utils/memberName.js';

export type MemberExperienceBaselineImportRow = {
  email?: string;
  baselineOtherClubExperienceYears: number;
  baselineClubExperienceYears: number;
  name?: string;
};

export type MemberExperienceBaselineImportResultStatus =
  | 'updated'
  | 'unchanged'
  | 'not_found'
  | 'ambiguous_email'
  | 'ambiguous_name'
  | 'invalid';

export type MemberExperienceBaselineImportResult = {
  email?: string;
  name?: string;
  status: MemberExperienceBaselineImportResultStatus;
  memberId?: number;
  memberName?: string;
  message?: string;
};

export type MemberExperienceBaselineImportResponse = {
  success: boolean;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  results: MemberExperienceBaselineImportResult[];
};

type MemberLookupRow = {
  id: number;
  name: string;
  email: string;
  nameKey: string;
};

function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function validateMemberExperienceBaselineImportRow(
  row: MemberExperienceBaselineImportRow,
  rowLabel: string,
): string | null {
  const email = row.email?.trim() ?? '';
  const name = row.name?.trim() ?? '';
  if (!email && !name) {
    return `${rowLabel}: Email or name is required.`;
  }
  if (email && !isValidEmail(email)) {
    return `${rowLabel}: Email is invalid.`;
  }
  if (!email && !memberNameMatchKeyFromFullName(name)) {
    return `${rowLabel}: Name must include a first name for name-based matching.`;
  }
  const otherError = validateHalfYearExperienceValue(
    row.baselineOtherClubExperienceYears,
    'Years at another club',
  );
  if (otherError) return `${rowLabel}: ${otherError}`;
  const ourError = validateHalfYearExperienceValue(
    row.baselineClubExperienceYears,
    'Baseline years at this club',
  );
  if (ourError) return `${rowLabel}: ${ourError}`;
  return null;
}

async function loadMemberLookupIndexes(): Promise<{
  byEmail: Map<string, MemberLookupRow[]>;
  byName: Map<string, MemberLookupRow[]>;
}> {
  const { db, schema } = getDrizzleDb();
  const members = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
    })
    .from(schema.members);

  const byEmail = new Map<string, MemberLookupRow[]>();
  const byName = new Map<string, MemberLookupRow[]>();

  for (const member of members) {
    const nameParts = memberNamePartsFromStored(member);
    const nameKey = memberNameMatchKey(nameParts.firstName, nameParts.lastName);
    const lookupRow: MemberLookupRow = {
      id: member.id,
      name: member.name,
      email: member.email,
      nameKey,
    };

    if (member.email?.trim()) {
      const normalized = normalizeEmail(member.email);
      const emailBucket = byEmail.get(normalized) ?? [];
      emailBucket.push(lookupRow);
      byEmail.set(normalized, emailBucket);
    }
    const nameBucket = byName.get(nameKey) ?? [];
    nameBucket.push(lookupRow);
    byName.set(nameKey, nameBucket);
  }

  return { byEmail, byName };
}

export function resolveMemberExperienceBaselineImportRowMatch(
  row: MemberExperienceBaselineImportRow,
  indexes: {
    byEmail: Map<string, MemberLookupRow[]>;
    byName: Map<string, MemberLookupRow[]>;
  },
): { match?: MemberLookupRow; status?: MemberExperienceBaselineImportResultStatus; message?: string } {
  const email = row.email?.trim() ?? '';
  const name = row.name?.trim() ?? '';

  if (email) {
    const matches = indexes.byEmail.get(normalizeEmail(email)) ?? [];
    if (matches.length === 1) {
      return { match: matches[0] };
    }
    if (matches.length > 1) {
      const rowNameKey = memberNameMatchKeyFromFullName(name);
      if (rowNameKey) {
        const narrowed = matches.filter((match) => match.nameKey === rowNameKey);
        if (narrowed.length === 1) {
          return { match: narrowed[0] };
        }
        if (narrowed.length > 1) {
          return {
            status: 'ambiguous_name',
            message: `Multiple members share this email and first and last name (${narrowed.length} matches).`,
          };
        }
        return {
          status: 'not_found',
          message: 'No member with this email matches the provided name.',
        };
      }
      return {
        status: 'ambiguous_email',
        message: `Multiple members share this email (${matches.length} matches). Add a name to disambiguate.`,
      };
    }
    return {
      status: 'not_found',
      message: 'No member found with this email.',
    };
  }

  const nameKey = memberNameMatchKeyFromFullName(name);
  if (!nameKey) {
    return {
      status: 'invalid',
      message: 'Name must include a first name for name-based matching.',
    };
  }

  const matches = indexes.byName.get(nameKey) ?? [];
  if (matches.length === 1) {
    return { match: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous_name',
      message: `Multiple members share this first and last name (${matches.length} matches).`,
    };
  }
  return {
    status: 'not_found',
    message: 'No member found with this first and last name.',
  };
}

export async function importMemberExperienceBaselines(
  rows: MemberExperienceBaselineImportRow[],
): Promise<MemberExperienceBaselineImportResponse> {
  const results: MemberExperienceBaselineImportResult[] = [];
  const validUpdates: Array<{
    memberId: number;
    email?: string;
    name?: string;
    memberName: string;
    baselineOtherClubExperienceYears: number;
    baselineClubExperienceYears: number;
  }> = [];

  const indexes = await loadMemberLookupIndexes();

  rows.forEach((row, index) => {
    const rowLabel = `Row ${index + 1}`;
    const validationError = validateMemberExperienceBaselineImportRow(row, rowLabel);
    if (validationError) {
      results.push({
        email: row.email,
        name: row.name,
        status: 'invalid',
        message: validationError,
      });
      return;
    }

    const resolved = resolveMemberExperienceBaselineImportRowMatch(row, indexes);
    if (!resolved.match) {
      results.push({
        email: row.email,
        name: row.name,
        status: resolved.status ?? 'not_found',
        message: resolved.message,
      });
      return;
    }

    const match = resolved.match;
    validUpdates.push({
      memberId: match.id,
      email: row.email,
      name: row.name,
      memberName: match.name,
      baselineOtherClubExperienceYears: normalizeHalfYearExperienceValue(row.baselineOtherClubExperienceYears),
      baselineClubExperienceYears: normalizeHalfYearExperienceValue(row.baselineClubExperienceYears),
    });
  });

  if (validUpdates.length === 0) {
    return {
      success: false,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: results.length,
      results,
    };
  }

  const { db, schema } = getDrizzleDb();
  const memberIds = validUpdates.map((row) => row.memberId);
  const existingRows = await db
    .select({
      id: schema.members.id,
      baseline_other_club_experience_years: schema.members.baseline_other_club_experience_years,
      baseline_club_experience_years: schema.members.baseline_club_experience_years,
    })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  const toWrite = validUpdates.filter((row) => {
    const existing = existingById.get(row.memberId);
    const currentOther = normalizeHalfYearExperienceValue(existing?.baseline_other_club_experience_years ?? 0);
    const currentOur = normalizeHalfYearExperienceValue(existing?.baseline_club_experience_years ?? 0);
    if (
      currentOther === row.baselineOtherClubExperienceYears &&
      currentOur === row.baselineClubExperienceYears
    ) {
      results.push({
        email: row.email,
        name: row.name,
        status: 'unchanged',
        memberId: row.memberId,
        memberName: row.memberName,
      });
      return false;
    }
    return true;
  });

  if (toWrite.length > 0) {
    await db.transaction(async (tx) => {
      for (const row of toWrite) {
        await tx
          .update(schema.members)
          .set({
            baseline_other_club_experience_years: row.baselineOtherClubExperienceYears,
            baseline_club_experience_years: row.baselineClubExperienceYears,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.members.id, row.memberId));
      }
    });
  }

  for (const row of toWrite) {
    results.push({
      email: row.email,
      name: row.name,
      status: 'updated',
      memberId: row.memberId,
      memberName: row.memberName,
    });
  }

  const updatedCount = results.filter((r) => r.status === 'updated').length;
  const unchangedCount = results.filter((r) => r.status === 'unchanged').length;
  const failedCount = results.filter(
    (r) =>
      r.status === 'not_found' ||
      r.status === 'invalid' ||
      r.status === 'ambiguous_email' ||
      r.status === 'ambiguous_name',
  ).length;

  return {
    success: updatedCount > 0 || (failedCount === 0 && unchangedCount > 0),
    updatedCount,
    unchangedCount,
    failedCount,
    results,
  };
}
