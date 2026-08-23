import { desc, eq, inArray } from 'drizzle-orm';
import type { Member } from '../types.js';
import { isDraftRegistrationStatus } from './registrationDraftProgress.js';
import { registrationAmountDueMinor } from './registrationMemberService.js';
import { parseTeamRosterPlacements, waitlistRosterEntries } from './waitlistTeamRoster.js';
import {
  RegistrationStaffValidationError,
  assertStaffAccess,
  buildStaffRegistrationListWhere,
} from './registrationStaffService.js';

export const LEAGUE_PRIORITIES_EXPORT_KEY = 'leaguePriorities';

export type RegistrationExportColumn = {
  key: string;
  label: string;
  group: string;
  kind: 'value' | 'leaguePriorities';
};

type ExportRow = {
  values: Record<string, string>;
  leaguePriorities: string[];
};

const STATUS_LABELS: Record<string, string> = {
  identity_incomplete: 'Identity incomplete',
  policies_incomplete: 'Policies incomplete',
  demographics_incomplete: 'Demographics incomplete',
  shell_complete: 'Shell complete',
  submitted: 'Submitted',
  awaiting_staff_review: 'Awaiting staff review',
  awaiting_placement: 'Awaiting placement',
  awaiting_payment: 'Awaiting payment',
  payment_started: 'Payment started',
  paid: 'Paid',
  confirmed: 'Confirmed',
  cancelled: 'Canceled',
};

const MEMBERSHIP_LABELS: Record<string, string> = {
  regular: 'Regular membership',
  regular_spare_only: 'Regular membership, spare-only ice',
  social: 'Social membership',
  junior_recreational: 'Junior recreational membership',
  none: 'No membership',
};

const ICE_LABELS: Record<string, string> = {
  league_play: 'League play',
  basic_ice: 'Basic ice',
  none: 'None',
};

const EXPERIENCE_LABELS: Record<string, string> = {
  none_or_minimal: 'None or minimal',
  specified_years: 'Specified years',
  known_existing: 'Already on file',
};

const PAYMENT_LABELS: Record<string, string> = {
  draft: 'Draft',
  deferred: 'Deferred',
  awaiting_payment: 'Awaiting payment',
  checkout_started: 'Checkout started',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Canceled',
  refunded: 'Refunded',
};

const ASSISTANCE_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially approved',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
};

const POLICY_LABELS: Record<string, string> = {
  code_of_conduct: 'Code of conduct',
  maapp: 'MAAPP',
  privacy: 'Privacy',
};

const SELECTION_LABELS: Record<string, string> = {
  sabbatical: 'Sabbatical',
  drop: 'Drop',
  junior_recreational: 'Junior recreational',
  spare_only: 'Spare only',
};

export const REGISTRATION_EXPORT_COLUMNS: RegistrationExportColumn[] = [
  { key: 'id', label: 'Registration ID', group: 'Registration', kind: 'value' },
  { key: 'seasonName', label: 'Season', group: 'Registration', kind: 'value' },
  { key: 'sessionName', label: 'Session', group: 'Registration', kind: 'value' },
  { key: 'status', label: 'Registration status', group: 'Registration', kind: 'value' },
  { key: 'isDraft', label: 'In-progress draft', group: 'Registration', kind: 'value' },
  { key: 'submittedAt', label: 'Submitted date', group: 'Registration', kind: 'value' },
  { key: 'cancelledAt', label: 'Canceled date', group: 'Registration', kind: 'value' },
  { key: 'createdAt', label: 'Created date', group: 'Registration', kind: 'value' },
  { key: 'updatedAt', label: 'Updated date', group: 'Registration', kind: 'value' },
  { key: 'submittedByName', label: 'Submitted by', group: 'Registration', kind: 'value' },
  { key: 'submittedByEmail', label: 'Submitted by email', group: 'Registration', kind: 'value' },
  { key: 'acceptedPolicies', label: 'Accepted policies', group: 'Registration', kind: 'value' },
  { key: 'membershipOption', label: 'Membership option', group: 'Membership', kind: 'value' },
  { key: 'icePrivilegesChoice', label: 'Ice privileges', group: 'Membership', kind: 'value' },
  { key: 'returningMember', label: 'Returning member', group: 'Membership', kind: 'value' },
  { key: 'registeringForSelf', label: 'Registering for self', group: 'Membership', kind: 'value' },
  { key: 'lifetimeMember', label: 'Lifetime member', group: 'Membership', kind: 'value' },
  { key: 'studentDiscountClaimed', label: 'Student discount claimed', group: 'Discounts and assistance', kind: 'value' },
  { key: 'studentInstitution', label: 'Student institution', group: 'Discounts and assistance', kind: 'value' },
  { key: 'reciprocalDiscountClaimed', label: 'Reciprocal discount claimed', group: 'Discounts and assistance', kind: 'value' },
  { key: 'reciprocalClubName', label: 'Reciprocal club', group: 'Discounts and assistance', kind: 'value' },
  { key: 'usaCurlingMembershipOptIn', label: 'USA Curling membership opt-in', group: 'Discounts and assistance', kind: 'value' },
  { key: 'uswcaMembershipOptIn', label: 'USWCA membership opt-in', group: 'Discounts and assistance', kind: 'value' },
  { key: 'hasFinancialAssistance', label: 'Has financial assistance request', group: 'Discounts and assistance', kind: 'value' },
  { key: 'financialAssistanceStatus', label: 'Financial assistance status', group: 'Discounts and assistance', kind: 'value' },
  { key: 'financialAssistanceRequestedPercent', label: 'Financial assistance requested %', group: 'Discounts and assistance', kind: 'value' },
  { key: 'financialAssistanceApprovedPercent', label: 'Financial assistance approved %', group: 'Discounts and assistance', kind: 'value' },
  { key: 'experienceType', label: 'Curling experience', group: 'Experience and ice', kind: 'value' },
  { key: 'experienceYears', label: 'Self-reported experience years', group: 'Experience and ice', kind: 'value' },
  { key: 'desiredLeagueCount', label: 'Desired league count', group: 'Experience and ice', kind: 'value' },
  { key: 'basicIceFallbackInterest', label: 'Basic ice fallback interest', group: 'Experience and ice', kind: 'value' },
  { key: 'membershipCommitteeComments', label: 'Membership committee comments', group: 'Experience and ice', kind: 'value' },
  { key: LEAGUE_PRIORITIES_EXPORT_KEY, label: 'League priorities', group: 'Leagues', kind: 'leaguePriorities' },
  { key: 'selectionType', label: 'Non-league selection', group: 'Leagues', kind: 'value' },
  { key: 'placedLeagues', label: 'Placed leagues', group: 'Leagues', kind: 'value' },
  { key: 'waitlistedLeagues', label: 'Waitlisted leagues', group: 'Leagues', kind: 'value' },
  { key: 'offeredLeagues', label: 'Pending offer leagues', group: 'Leagues', kind: 'value' },
  { key: 'hasWaitlist', label: 'On a waitlist', group: 'Leagues', kind: 'value' },
  { key: 'hasPendingOffer', label: 'Has a pending waitlist offer', group: 'Leagues', kind: 'value' },
  { key: 'curlerId', label: 'Curler ID', group: 'Curler', kind: 'value' },
  { key: 'firstName', label: 'First name', group: 'Curler', kind: 'value' },
  { key: 'lastName', label: 'Last name', group: 'Curler', kind: 'value' },
  { key: 'email', label: 'Email', group: 'Curler', kind: 'value' },
  { key: 'phone', label: 'Phone', group: 'Curler', kind: 'value' },
  { key: 'dateOfBirth', label: 'Date of birth', group: 'Curler', kind: 'value' },
  { key: 'age', label: 'Age', group: 'Curler', kind: 'value' },
  { key: 'mailingAddress', label: 'Mailing address', group: 'Curler', kind: 'value' },
  { key: 'emergencyContactName', label: 'Emergency contact name', group: 'Curler', kind: 'value' },
  { key: 'emergencyContactPhone', label: 'Emergency contact phone', group: 'Curler', kind: 'value' },
  { key: 'preferredPronouns', label: 'Preferred pronouns', group: 'Curler', kind: 'value' },
  { key: 'usaCurlingCompetitionGender', label: 'USA Curling competition gender', group: 'Curler', kind: 'value' },
  { key: 'demographicsCurrentConfirmed', label: 'Confirmed current demographics', group: 'Curler', kind: 'value' },
  { key: 'guardianFirstName', label: 'Guardian first name', group: 'Guardian', kind: 'value' },
  { key: 'guardianLastName', label: 'Guardian last name', group: 'Guardian', kind: 'value' },
  { key: 'guardianEmail', label: 'Guardian email', group: 'Guardian', kind: 'value' },
  { key: 'guardianPhone', label: 'Guardian phone', group: 'Guardian', kind: 'value' },
  { key: 'nameTagName', label: 'Name tag name', group: 'Name tag', kind: 'value' },
  { key: 'nameTagIncludePronouns', label: 'Name tag includes pronouns', group: 'Name tag', kind: 'value' },
  { key: 'nameTagReplacementQuantity', label: 'Name tag replacements', group: 'Name tag', kind: 'value' },
  { key: 'paymentStatus', label: 'Invoice status', group: 'Payment', kind: 'value' },
  { key: 'paymentDeferred', label: 'Payment deferred', group: 'Payment', kind: 'value' },
  { key: 'hasInvoice', label: 'Has an invoice', group: 'Payment', kind: 'value' },
  { key: 'invoiceSubtotal', label: 'Invoice subtotal', group: 'Payment', kind: 'value' },
  { key: 'invoiceDiscount', label: 'Invoice discount', group: 'Payment', kind: 'value' },
  { key: 'invoiceTotal', label: 'Invoice total', group: 'Payment', kind: 'value' },
  { key: 'amountDue', label: 'Amount due', group: 'Payment', kind: 'value' },
  { key: 'paidAt', label: 'Paid date', group: 'Payment', kind: 'value' },
  { key: 'deferredReason', label: 'Deferred reason', group: 'Payment', kind: 'value' },
  { key: 'offlinePaymentNote', label: 'Offline payment note', group: 'Payment', kind: 'value' },
];

const COLUMN_BY_KEY = new Map(REGISTRATION_EXPORT_COLUMNS.map((column) => [column.key, column]));

export function registrationExportColumnCatalog(): RegistrationExportColumn[] {
  return REGISTRATION_EXPORT_COLUMNS.map((column) => ({ ...column }));
}

export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((line) => line.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function leaguePriorityHeader(rank: number): string {
  return `League priority ${rank}`;
}

export function resolveRegistrationExportColumns(selectedKeys: string[]): RegistrationExportColumn[] {
  const seen = new Set<string>();
  const resolved: RegistrationExportColumn[] = [];
  for (const key of selectedKeys) {
    const column = COLUMN_BY_KEY.get(key);
    if (!column || seen.has(column.key)) continue;
    seen.add(column.key);
    resolved.push(column);
  }
  return resolved;
}

export function buildRegistrationExportTable(
  selectedKeys: string[],
  rows: ExportRow[],
): { headers: string[]; records: string[][] } {
  const columns = resolveRegistrationExportColumns(selectedKeys);
  if (columns.length === 0) {
    throw new RegistrationStaffValidationError({ columns: 'Select at least one column.' });
  }
  const maxPriorities = columns.some((column) => column.kind === 'leaguePriorities')
    ? rows.reduce((max, row) => Math.max(max, row.leaguePriorities.length), 0)
    : 0;

  const headers: string[] = [];
  for (const column of columns) {
    if (column.kind === 'leaguePriorities') {
      for (let rank = 1; rank <= maxPriorities; rank += 1) headers.push(leaguePriorityHeader(rank));
    } else {
      headers.push(column.label);
    }
  }

  const records = rows.map((row) => {
    const cells: string[] = [];
    for (const column of columns) {
      if (column.kind === 'leaguePriorities') {
        for (let index = 0; index < maxPriorities; index += 1) cells.push(row.leaguePriorities[index] ?? '');
      } else {
        cells.push(row.values[column.key] ?? '');
      }
    }
    return cells;
  });

  return { headers, records };
}

function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (value == null || value === '') return '';
  return map[value] ?? value.replaceAll('_', ' ');
}

function formatFlag(value: unknown, nullable = false): string {
  if (value == null) return nullable ? '' : 'No';
  if (value === true || value === 1 || value === '1' || value === 'true') return 'Yes';
  if (value === false || value === 0 || value === '0' || value === 'false') return 'No';
  return '';
}

function formatTimestamp(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function formatMoney(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return '';
  return (minor / 100).toFixed(2);
}

function formatNumber(value: unknown): string {
  if (value == null || value === '') return '';
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? String(amount) : '';
}

function formatDateOnly(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value).slice(0, 10);
}

function ageFromDob(dateOfBirth: string | null | undefined, asOf = new Date()): string {
  const dob = dateOfBirth?.slice(0, 10);
  if (!dob) return '';
  const birth = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return '';
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 ? String(age) : '';
}

function uniqueJoin(values: Array<string | null | undefined>): string {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join(', ');
}

function memberDisplayName(row: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!row) return '';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || '';
}

function returningMemberLabel(value: number | null | undefined): string {
  if (value == null) return '';
  return value === 1 ? 'Returning member' : 'New member';
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function csvFilename(seasonName: string, sessionName: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = [sanitizeFilenamePart(seasonName), sanitizeFilenamePart(sessionName)].filter(Boolean).join('-');
  return `registrations-${slug || 'export'}-${stamp}.csv`;
}

function latestByRegistrationId<T extends { registrationId: number; updatedAt?: unknown; id: number }>(
  rows: T[],
): Map<number, T> {
  const latest = new Map<number, T>();
  for (const row of rows) {
    const current = latest.get(row.registrationId);
    if (!current) {
      latest.set(row.registrationId, row);
      continue;
    }
    const currentUpdated = formatTimestamp(current.updatedAt);
    const nextUpdated = formatTimestamp(row.updatedAt);
    if (nextUpdated > currentUpdated || (nextUpdated === currentUpdated && row.id > current.id)) {
      latest.set(row.registrationId, row);
    }
  }
  return latest;
}

function needsAny(needed: Set<string>, keys: string[]): boolean {
  return keys.some((key) => needed.has(key));
}

export async function exportStaffRegistrations(input: {
  actor: Member;
  sessionId: number;
  search?: string;
  status?: string;
  q?: string;
  columns: string[];
}): Promise<{ csv: string; filename: string; rowCount: number }> {
  assertStaffAccess(input.actor);
  const selectedColumns = resolveRegistrationExportColumns(input.columns);
  if (selectedColumns.length === 0) {
    throw new RegistrationStaffValidationError({ columns: 'Select at least one column.' });
  }

  const { db, schema, where } = buildStaffRegistrationListWhere(input);
  const [session] = await db
    .select({
      sessionName: schema.curlingSessions.name,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);

  const registrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      submittedAt: schema.curlingRegistrations.submitted_at,
      cancelledAt: schema.curlingRegistrations.cancelled_at,
      createdAt: schema.curlingRegistrations.created_at,
      updatedAt: schema.curlingRegistrations.updated_at,
      membershipOption: schema.curlingRegistrations.membership_option,
      icePrivilegesChoice: schema.curlingRegistrations.ice_privileges_choice,
      returningMemberAnswer: schema.curlingRegistrations.returning_member_answer,
      registeringForSelf: schema.curlingRegistrations.registering_for_self,
      studentDiscountClaimed: schema.curlingRegistrations.student_discount_claimed,
      studentInstitution: schema.curlingRegistrations.student_institution,
      reciprocalDiscountClaimed: schema.curlingRegistrations.reciprocal_discount_claimed,
      reciprocalClubName: schema.curlingRegistrations.reciprocal_club_name,
      usaCurlingMembershipOptIn: schema.curlingRegistrations.usa_curling_membership_opt_in,
      uswcaMembershipOptIn: schema.curlingRegistrations.uswca_membership_opt_in,
      experienceType: schema.curlingRegistrations.experience_type,
      experienceYears: schema.curlingRegistrations.experience_self_reported_years,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
      basicIceFallbackInterest: schema.curlingRegistrations.basic_ice_fallback_interest,
      membershipCommitteeComments: schema.curlingRegistrations.membership_committee_comments,
      nameTagReplacementQuantity: schema.curlingRegistrations.name_tag_replacement_quantity,
      demographicsCurrentConfirmed: schema.curlingRegistrations.demographics_current_confirmed,
      guardianFirstName: schema.curlingRegistrations.guardian_first_name,
      guardianLastName: schema.curlingRegistrations.guardian_last_name,
      guardianEmail: schema.curlingRegistrations.guardian_email,
      guardianPhone: schema.curlingRegistrations.guardian_phone,
      submittedByMemberId: schema.curlingRegistrations.submitted_by_member_id,
      curlerId: schema.members.id,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
      phone: schema.members.phone,
      dateOfBirth: schema.members.date_of_birth,
      mailingAddress: schema.members.mailing_address,
      emergencyContactName: schema.members.emergency_contact_name,
      emergencyContactPhone: schema.members.emergency_contact_phone,
      preferredPronouns: schema.members.preferred_pronouns,
      usaCurlingCompetitionGender: schema.members.usa_curling_competition_gender,
      nameTagName: schema.members.name_tag_name,
      nameTagIncludePronouns: schema.members.name_tag_include_pronouns,
      lifetimeMember: schema.members.lifetime_member,
      memberGuardianFirstName: schema.members.guardian_first_name,
      memberGuardianLastName: schema.members.guardian_last_name,
      memberGuardianEmail: schema.members.guardian_email,
      memberGuardianPhone: schema.members.guardian_phone,
      seasonName: schema.curlingSeasons.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.curlingRegistrations)
    .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
    .innerJoin(schema.curlingSessions, eq(schema.curlingRegistrations.session_id, schema.curlingSessions.id))
    .where(where)
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));

  const registrationIds = registrations.map((row) => row.id);
  const needed = new Set(selectedColumns.map((column) => column.key));

  const submitterIds = [
    ...new Set(registrations.map((row) => row.submittedByMemberId).filter((id): id is number => typeof id === 'number' && id > 0)),
  ];
  const submitters =
    submitterIds.length > 0 && needsAny(needed, ['submittedByName', 'submittedByEmail'])
      ? await db
          .select({
            id: schema.members.id,
            name: schema.members.name,
            firstName: schema.members.first_name,
            lastName: schema.members.last_name,
            email: schema.members.email,
          })
          .from(schema.members)
          .where(inArray(schema.members.id, submitterIds))
      : [];
  const submitterById = new Map(submitters.map((row) => [row.id, row]));

  const invoices =
    registrationIds.length > 0 &&
    needsAny(needed, [
      'paymentStatus',
      'paymentDeferred',
      'hasInvoice',
      'invoiceSubtotal',
      'invoiceDiscount',
      'invoiceTotal',
      'amountDue',
      'paidAt',
      'deferredReason',
      'offlinePaymentNote',
    ])
      ? await db
          .select({
            id: schema.registrationInvoices.id,
            registrationId: schema.registrationInvoices.registration_id,
            status: schema.registrationInvoices.status,
            subtotalMinor: schema.registrationInvoices.subtotal_minor,
            discountMinor: schema.registrationInvoices.discount_minor,
            totalMinor: schema.registrationInvoices.total_minor,
            deferred: schema.registrationInvoices.deferred,
            deferredReason: schema.registrationInvoices.deferred_reason,
            paidAt: schema.registrationInvoices.paid_at,
            offlinePaymentNote: schema.registrationInvoices.offline_payment_note,
            updatedAt: schema.registrationInvoices.updated_at,
          })
          .from(schema.registrationInvoices)
          .where(inArray(schema.registrationInvoices.registration_id, registrationIds))
      : [];
  const invoiceByRegistrationId = latestByRegistrationId(invoices);

  const assistanceRows =
    registrationIds.length > 0 &&
    needsAny(needed, [
      'hasFinancialAssistance',
      'financialAssistanceStatus',
      'financialAssistanceRequestedPercent',
      'financialAssistanceApprovedPercent',
    ])
      ? await db
          .select({
            id: schema.financialAssistanceRequests.id,
            registrationId: schema.financialAssistanceRequests.registration_id,
            status: schema.financialAssistanceRequests.status,
            requestedPercent: schema.financialAssistanceRequests.requested_percentage,
            approvedPercent: schema.financialAssistanceRequests.approved_percentage,
            updatedAt: schema.financialAssistanceRequests.updated_at,
          })
          .from(schema.financialAssistanceRequests)
          .where(inArray(schema.financialAssistanceRequests.registration_id, registrationIds))
      : [];
  const assistanceByRegistrationId = latestByRegistrationId(assistanceRows);

  const priorityRows =
    registrationIds.length > 0 && needed.has(LEAGUE_PRIORITIES_EXPORT_KEY)
      ? await db
          .select({
            registrationId: schema.registrationLeaguePriorities.registration_id,
            rank: schema.registrationLeaguePriorities.priority_rank,
            leagueName: schema.leagues.name,
            byotText: schema.registrationLeaguePriorities.byot_teammate_text,
            rosterJson: schema.registrationLeaguePriorities.team_roster_placements,
          })
          .from(schema.registrationLeaguePriorities)
          .innerJoin(schema.leagues, eq(schema.registrationLeaguePriorities.league_id, schema.leagues.id))
          .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds))
          .orderBy(schema.registrationLeaguePriorities.registration_id, schema.registrationLeaguePriorities.priority_rank)
      : [];

  const teammateIds = [
    ...new Set(priorityRows.flatMap((row) => parseTeamRosterPlacements(row.rosterJson).map((placement) => placement.memberId))),
  ];
  const teammateRows =
    teammateIds.length > 0
      ? await db
          .select({
            id: schema.members.id,
            name: schema.members.name,
            firstName: schema.members.first_name,
            lastName: schema.members.last_name,
            email: schema.members.email,
          })
          .from(schema.members)
          .where(inArray(schema.members.id, teammateIds))
      : [];
  const teammateNameById = new Map(
    teammateRows.map((row) => [
      row.id,
      memberDisplayName({ name: row.name, first_name: row.firstName, last_name: row.lastName, email: row.email }),
    ]),
  );

  const prioritiesByRegistrationId = new Map<number, string[]>();
  for (const row of priorityRows) {
    const memberNames = parseTeamRosterPlacements(row.rosterJson)
      .map((placement) => teammateNameById.get(placement.memberId) ?? '')
      .filter(Boolean);
    const extras = [...memberNames, ...waitlistRosterEntries(row.byotText)];
    const cell = extras.length > 0 ? `${row.leagueName} (${extras.join(', ')})` : row.leagueName;
    const list = prioritiesByRegistrationId.get(row.registrationId) ?? [];
    list.push(cell);
    prioritiesByRegistrationId.set(row.registrationId, list);
  }

  const selectionRows =
    registrationIds.length > 0 && needed.has('selectionType')
      ? await db
          .select({
            registrationId: schema.registrationSelections.registration_id,
            selectionType: schema.registrationSelections.selection_type,
            leagueName: schema.leagues.name,
          })
          .from(schema.registrationSelections)
          .leftJoin(schema.leagues, eq(schema.registrationSelections.league_id, schema.leagues.id))
          .where(inArray(schema.registrationSelections.registration_id, registrationIds))
      : [];
  const selectionByRegistrationId = new Map<number, string[]>();
  for (const row of selectionRows) {
    const label = labelOf(SELECTION_LABELS, row.selectionType);
    const value = row.leagueName ? `${label}: ${row.leagueName}` : label;
    const list = selectionByRegistrationId.get(row.registrationId) ?? [];
    list.push(value);
    selectionByRegistrationId.set(row.registrationId, list);
  }

  const policyRows =
    registrationIds.length > 0 && needed.has('acceptedPolicies')
      ? await db
          .select({
            registrationId: schema.registrationPolicyAcceptances.registration_id,
            policyType: schema.registrationPolicyAcceptances.policy_type,
          })
          .from(schema.registrationPolicyAcceptances)
          .where(inArray(schema.registrationPolicyAcceptances.registration_id, registrationIds))
      : [];
  const policiesByRegistrationId = new Map<number, string[]>();
  for (const row of policyRows) {
    const list = policiesByRegistrationId.get(row.registrationId) ?? [];
    list.push(labelOf(POLICY_LABELS, row.policyType));
    policiesByRegistrationId.set(row.registrationId, list);
  }

  const placedRows =
    registrationIds.length > 0 && needed.has('placedLeagues')
      ? await db
          .select({
            registrationId: schema.leagueRoster.source_registration_id,
            leagueName: schema.leagues.name,
          })
          .from(schema.leagueRoster)
          .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
          .where(inArray(schema.leagueRoster.source_registration_id, registrationIds))
      : [];
  const placedByRegistrationId = new Map<number, string[]>();
  for (const row of placedRows) {
    if (row.registrationId == null) continue;
    const list = placedByRegistrationId.get(row.registrationId) ?? [];
    list.push(row.leagueName);
    placedByRegistrationId.set(row.registrationId, list);
  }

  const waitlistRows =
    registrationIds.length > 0 && needsAny(needed, ['waitlistedLeagues', 'hasWaitlist'])
      ? await db
          .select({
            registrationId: schema.waitlistEntries.source_registration_id,
            leagueName: schema.leagues.name,
            status: schema.waitlistEntries.status,
          })
          .from(schema.waitlistEntries)
          .innerJoin(schema.leagues, eq(schema.leagues.waitlist_id, schema.waitlistEntries.waitlist_id))
          .where(inArray(schema.waitlistEntries.source_registration_id, registrationIds))
      : [];
  const waitlistedByRegistrationId = new Map<number, string[]>();
  for (const row of waitlistRows) {
    if (row.registrationId == null || (row.status !== 'active' && row.status !== 'offered')) continue;
    const list = waitlistedByRegistrationId.get(row.registrationId) ?? [];
    list.push(row.leagueName);
    waitlistedByRegistrationId.set(row.registrationId, list);
  }

  const offerRows =
    registrationIds.length > 0 && needsAny(needed, ['offeredLeagues', 'hasPendingOffer'])
      ? await db
          .select({
            registrationId: schema.waitlistOffers.source_registration_id,
            leagueName: schema.leagues.name,
            status: schema.waitlistOffers.status,
          })
          .from(schema.waitlistOffers)
          .innerJoin(schema.leagues, eq(schema.waitlistOffers.league_id, schema.leagues.id))
          .where(inArray(schema.waitlistOffers.source_registration_id, registrationIds))
      : [];
  const offeredByRegistrationId = new Map<number, string[]>();
  for (const row of offerRows) {
    if (row.registrationId == null || row.status !== 'pending') continue;
    const list = offeredByRegistrationId.get(row.registrationId) ?? [];
    list.push(row.leagueName);
    offeredByRegistrationId.set(row.registrationId, list);
  }

  const exportRows: ExportRow[] = registrations.map((row) => {
    const invoice = invoiceByRegistrationId.get(row.id);
    const assistance = assistanceByRegistrationId.get(row.id);
    const submitter = row.submittedByMemberId ? submitterById.get(row.submittedByMemberId) : undefined;
    return {
      leaguePriorities: prioritiesByRegistrationId.get(row.id) ?? [],
      values: {
        id: String(row.id),
        seasonName: row.seasonName ?? '',
        sessionName: row.sessionName ?? '',
        status: labelOf(STATUS_LABELS, row.status),
        isDraft: formatFlag(isDraftRegistrationStatus(row.status)),
        submittedAt: formatTimestamp(row.submittedAt),
        cancelledAt: formatTimestamp(row.cancelledAt),
        createdAt: formatTimestamp(row.createdAt),
        updatedAt: formatTimestamp(row.updatedAt),
        submittedByName: submitter
          ? memberDisplayName({
              name: submitter.name,
              first_name: submitter.firstName,
              last_name: submitter.lastName,
              email: submitter.email,
            })
          : '',
        submittedByEmail: submitter?.email ?? '',
        acceptedPolicies: uniqueJoin(policiesByRegistrationId.get(row.id) ?? []),
        membershipOption: labelOf(MEMBERSHIP_LABELS, row.membershipOption),
        icePrivilegesChoice: labelOf(ICE_LABELS, row.icePrivilegesChoice),
        returningMember: returningMemberLabel(row.returningMemberAnswer),
        registeringForSelf: formatFlag(row.registeringForSelf, true),
        lifetimeMember: formatFlag(row.lifetimeMember),
        studentDiscountClaimed: formatFlag(row.studentDiscountClaimed),
        studentInstitution: row.studentInstitution?.trim() ?? '',
        reciprocalDiscountClaimed: formatFlag(row.reciprocalDiscountClaimed),
        reciprocalClubName: row.reciprocalClubName?.trim() ?? '',
        usaCurlingMembershipOptIn: formatFlag(row.usaCurlingMembershipOptIn, true),
        uswcaMembershipOptIn: formatFlag(row.uswcaMembershipOptIn, true),
        hasFinancialAssistance: formatFlag(Boolean(assistance)),
        financialAssistanceStatus: labelOf(ASSISTANCE_LABELS, assistance?.status),
        financialAssistanceRequestedPercent: formatNumber(assistance?.requestedPercent),
        financialAssistanceApprovedPercent: formatNumber(assistance?.approvedPercent),
        experienceType: labelOf(EXPERIENCE_LABELS, row.experienceType),
        experienceYears: formatNumber(row.experienceYears),
        desiredLeagueCount: formatNumber(row.desiredLeagueCount),
        basicIceFallbackInterest: formatFlag(row.basicIceFallbackInterest, true),
        membershipCommitteeComments: row.membershipCommitteeComments?.trim() ?? '',
        selectionType: uniqueJoin(selectionByRegistrationId.get(row.id) ?? []),
        placedLeagues: uniqueJoin(placedByRegistrationId.get(row.id) ?? []),
        waitlistedLeagues: uniqueJoin(waitlistedByRegistrationId.get(row.id) ?? []),
        offeredLeagues: uniqueJoin(offeredByRegistrationId.get(row.id) ?? []),
        hasWaitlist: formatFlag((waitlistedByRegistrationId.get(row.id) ?? []).length > 0),
        hasPendingOffer: formatFlag((offeredByRegistrationId.get(row.id) ?? []).length > 0),
        curlerId: row.curlerId != null ? String(row.curlerId) : '',
        firstName: row.firstName?.trim() ?? '',
        lastName: row.lastName?.trim() ?? '',
        email: row.email?.trim() ?? '',
        phone: row.phone?.trim() ?? '',
        dateOfBirth: formatDateOnly(row.dateOfBirth),
        age: ageFromDob(typeof row.dateOfBirth === 'string' ? row.dateOfBirth : formatDateOnly(row.dateOfBirth)),
        mailingAddress: row.mailingAddress?.trim() ?? '',
        emergencyContactName: row.emergencyContactName?.trim() ?? '',
        emergencyContactPhone: row.emergencyContactPhone?.trim() ?? '',
        preferredPronouns: row.preferredPronouns?.trim() ?? '',
        usaCurlingCompetitionGender: row.usaCurlingCompetitionGender?.trim() ?? '',
        demographicsCurrentConfirmed: formatFlag(row.demographicsCurrentConfirmed),
        guardianFirstName: (row.guardianFirstName ?? row.memberGuardianFirstName)?.trim() ?? '',
        guardianLastName: (row.guardianLastName ?? row.memberGuardianLastName)?.trim() ?? '',
        guardianEmail: (row.guardianEmail ?? row.memberGuardianEmail)?.trim() ?? '',
        guardianPhone: (row.guardianPhone ?? row.memberGuardianPhone)?.trim() ?? '',
        nameTagName: row.nameTagName?.trim() ?? '',
        nameTagIncludePronouns: formatFlag(row.nameTagIncludePronouns, true),
        nameTagReplacementQuantity: formatNumber(row.nameTagReplacementQuantity),
        paymentStatus: labelOf(PAYMENT_LABELS, invoice?.status),
        paymentDeferred: formatFlag(invoice?.deferred),
        hasInvoice: formatFlag(Boolean(invoice)),
        invoiceSubtotal: formatMoney(invoice?.subtotalMinor),
        invoiceDiscount: formatMoney(invoice?.discountMinor),
        invoiceTotal: formatMoney(invoice?.totalMinor),
        amountDue: formatMoney(
          registrationAmountDueMinor({
            invoiceStatus: invoice?.status,
            invoiceTotalMinor: invoice?.totalMinor ?? null,
            registrationStatus: row.status,
          }),
        ),
        paidAt: formatTimestamp(invoice?.paidAt),
        deferredReason: invoice?.deferredReason?.trim() ?? '',
        offlinePaymentNote: invoice?.offlinePaymentNote?.trim() ?? '',
      },
    };
  });

  const table = buildRegistrationExportTable(
    selectedColumns.map((column) => column.key),
    exportRows,
  );

  return {
    csv: toCsv(table.headers, table.records),
    filename: csvFilename(session?.seasonName ?? '', session?.sessionName ?? ''),
    rowCount: exportRows.length,
  };
}
