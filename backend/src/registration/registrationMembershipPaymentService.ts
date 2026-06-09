import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  CurlingExperienceTypeSqlite,
  CurlingIcePrivilegesChoiceSqlite,
  CurlingMembershipOptionSqlite,
  RegistrationInvoiceLineKindSqlite,
  WaitlistAuditActionSqlite,
} from '../db/drizzle-schema.js';
import { createPaymentService, PaymentServiceError } from '../services/paymentService.js';
import { paymentDetailsUrl } from '../utils/paymentDetailsUrl.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { effectiveExperienceYears, isJuniorRecreationalEligible } from './registrationAgeExperience.js';
import { memberExperienceBaselinesFromRow, type MemberExperienceBaselines } from './curlingExperienceYears.js';
import { effectiveLeagueRegistrationFeeMinor } from './registrationConfigValidation.js';
import { calculateRegistrationFees, type RegistrationFeeLineItem, type RegistrationFeePreview } from './registrationFeeCalculator.js';
import { evaluateExistingWaitlistPreferences, evaluateWaitlistCleanup } from './registrationLeagueSelections.js';
import { decideRegistrationPayment, type RegistrationPaymentDecision } from './registrationPaymentDecision.js';
import type { LeagueConfig, RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';
import { sendRegistrationEmailForDashboard, type RegistrationEmailPayload, type RegistrationMessageType, type RegistrationReceiptLineItem } from './registrationEmailService.js';
import {
  assertStaffEditableRegistration,
  isPriorityEditableRegistrationStatus,
  isStaffEditableRegistrationStatus,
} from './registrationPriorityEdit.js';
import { canViewOrEditRegistration, getEffectiveRegistrationWindow, getRegistrationById, getRegistrationShellPayload } from './registrationShellService.js';
import {
  removeOrphanedRegistrationRosterPlacements,
  syncRegistrationRosterPlacements,
} from './registrationRosterService.js';
import { removeExistingWaitlistsMarkedForRemoval, removeOrphanedRegistrationWaitlistEntries } from './registrationWaitlistCleanup.js';
import { getWaitlistQueuePosition, insertWaitlistAuditEvent } from './waitlistAudit.js';
import { loadExistingWaitlistEntriesForMember, waitlistEntryIncludesMember } from './waitlistMemberMembership.js';
import { offerPreferenceFromSelectionType } from './waitlistOfferPreference.js';
import { sendWaitlistEntryJoinedNotifications } from './waitlistJoinedNotificationService.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import { sendManualRegistrationUpdateEmail } from './registrationStaffCommunicationService.js';

export const REGISTRATION_IMMEDIATE_PAYMENT_CONFIRMATION_MESSAGE =
  'After making these changes to your registration, your league placements no longer rely on waitlists, so payment can be taken immediately. Click continue to proceed to checkout. Your registration updates will be confirmed after payment is received.';

const DEFERRED_REGISTRATION_STATUSES = new Set([
  'awaiting_placement',
  'awaiting_staff_review',
  'awaiting_payment',
]);

function registrationPreviouslyDeferred(
  registration: { status: string },
  invoice: { status: string; deferred?: number | null } | null | undefined
): boolean {
  if (invoice?.status === 'deferred' || invoice?.deferred === 1) return true;
  return DEFERRED_REGISTRATION_STATUSES.has(registration.status);
}

export class RegistrationMembershipPaymentValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration membership payment validation failed');
  }
}

type RegistrationMembershipPaymentSelection = {
  membershipOption: CurlingMembershipOptionSqlite;
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  experienceType: CurlingExperienceTypeSqlite | null;
  experienceSelfReportedYears: number | null;
};

type RegistrationMembershipPaymentRowFields = {
  status: string;
  membership_option: CurlingMembershipOptionSqlite;
  student_discount_claimed: number;
  student_institution: string | null;
  reciprocal_discount_claimed: number;
  reciprocal_club_name: string | null;
  experience_type: CurlingExperienceTypeSqlite | null;
  experience_self_reported_years: number | null;
};

export type RegistrationMembershipPaymentPayload = {
  selection: RegistrationMembershipPaymentSelection;
  icePrivilegesChoice: CurlingIcePrivilegesChoiceSqlite;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  spareOnlyIcePrivilegeFeeMinor: number;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
};

type UpdateMembershipInput = {
  membershipOption: 'regular' | 'social' | 'junior_recreational';
  basicIcePrivileges?: boolean;
  juniorAssistancePercent?: number | null;
};

type UpdateIcePrivilegesInput = {
  choice: CurlingIcePrivilegesChoiceSqlite;
};

type UpdateDiscountsInput = {
  studentDiscountClaimed?: boolean;
  studentInstitution?: string | null;
  reciprocalDiscountClaimed?: boolean;
  reciprocalClubName?: string | null;
};

type UpdateExperienceInput =
  | {
      experienceType: 'none_or_minimal';
      experienceSelfReportedYears?: null;
    }
  | {
      experienceType: 'specified_years';
      experienceSelfReportedYears: number;
    }
  | {
      experienceType: 'known_existing';
      experienceSelfReportedYears?: null;
    };

type SubmitRegistrationInput = {
  registrationId: number;
  actor: Member;
  confirmImmediatePayment?: boolean;
  staffEdit?: boolean;
  changedSummary?: string;
};

export type RegistrationPaymentAdjustmentResult = {
  kind: 'none' | 'refund' | 'balance_due';
  priorPaidMinor: number;
  newTotalMinor: number;
  adjustmentMinor: number;
  refundIssued?: boolean;
  refundError?: string | null;
  checkoutUrl?: string | null;
};

type SubmitRegistrationResult =
  | {
      outcome: 'immediate_payment';
      registrationId: number;
      invoiceId: number;
      checkoutUrl: string;
      orderToken: string;
      totalDueMinor: number;
    }
  | {
      outcome: 'immediate_payment';
      registrationId: number;
      requiresCheckoutConfirmation: true;
      totalDueMinor: number;
      message: string;
    }
  | {
      outcome: 'deferred_payment' | 'no_payment_required';
      registrationId: number;
      invoiceId: number;
      totalDueMinor: number;
      deferralReasons: string[];
    }
  | ({
      outcome: 'deferred_payment' | 'no_payment_required' | 'immediate_payment';
      registrationId: number;
      invoiceId?: number;
      totalDueMinor: number;
      deferralReasons?: string[];
      checkoutUrl?: string;
      orderToken?: string;
      paymentAdjustment?: RegistrationPaymentAdjustmentResult;
    });

export type RegistrationPaymentStatusPayload = {
  registrationId: number | null;
  paymentStatus: 'confirming' | 'confirmed' | 'failed' | 'deferred' | 'no_payment_due' | 'unknown';
  registrationStatus: string | null;
  invoiceStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
};

export function resolveRegistrationPaymentStatus(input: {
  invoiceStatus: string | null;
  registrationStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
}): RegistrationPaymentStatusPayload['paymentStatus'] {
  if (input.invoiceStatus === 'paid' || input.registrationStatus === 'confirmed') return 'confirmed';
  if (input.invoiceStatus === 'failed' || input.paymentOrderStatus === 'failed') return 'failed';
  if (input.invoiceStatus === 'deferred') return 'deferred';
  if (input.totalDueMinor === 0) return 'no_payment_due';
  return 'confirming';
}

export function shouldMarkCheckoutCancelled(input: {
  invoiceStatus: string | null;
  registrationStatus: string | null;
}): boolean {
  if (input.invoiceStatus !== 'checkout_started' && input.invoiceStatus !== 'awaiting_payment') return false;
  return input.registrationStatus !== 'paid' && input.registrationStatus !== 'confirmed' && input.registrationStatus !== 'cancelled';
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}

function mapLeagueConfig(
  row: {
    id: number;
    session_id: number | null;
    name: string;
    day_of_week: number;
    league_type: 'standard' | 'bring_your_own_team';
    capacity_type: 'individual' | 'team';
    capacity_value: number;
    registration_fee_minor: number;
    registration_fee_override_minor?: number | null;
    requires_club_membership: number;
    format: 'teams' | 'doubles' | 'instructional';
    min_experience_years: number | null;
    max_experience_years?: number | null;
    min_age: number | null;
    max_age: number | null;
    start_date: unknown;
    end_date: unknown;
    first_day_of_play: unknown;
    last_day_of_play: unknown;
    allows_waitlist: number;
    waitlist_id: number | null;
    is_play_in_based?: number;
    allows_sabbatical: number;
    predecessor_league_id: number | null;
    successor_league_id: number | null;
  },
  defaultLeagueFeeMinor: number
): LeagueConfig {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    dayOfWeek: row.day_of_week,
    leagueType: row.league_type,
    capacityType: row.capacity_type,
    capacityValue: row.capacity_value,
    registrationFeeMinor: effectiveLeagueRegistrationFeeMinor(row.registration_fee_override_minor, defaultLeagueFeeMinor),
    requiresClubMembership: row.requires_club_membership === 1,
    format: row.format,
    minExperienceYears: row.min_experience_years,
    maxExperienceYears: row.max_experience_years ?? null,
    minAge: row.min_age,
    maxAge: row.max_age,
    startDate: normalizeDate(row.start_date),
    endDate: normalizeDate(row.end_date),
    firstDayOfPlay: row.first_day_of_play ? normalizeDate(row.first_day_of_play) : null,
    lastDayOfPlay: row.last_day_of_play ? normalizeDate(row.last_day_of_play) : null,
    allowsWaitlist: row.waitlist_id != null,
    waitlistId: row.waitlist_id,
    isPlayInBased: row.is_play_in_based === 1,
    allowsSabbatical: row.allows_sabbatical === 1,
    predecessorLeagueId: row.predecessor_league_id,
    successorLeagueId: row.successor_league_id,
    discountEligible: true,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function jsonStorageValue(value: unknown): unknown {
  return getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value);
}

function dbValue(value: unknown): never {
  return value as never;
}

function timestampColumnValue(value: Date): never {
  return dbValue(getDatabaseConfig()?.type === 'postgres' ? value : value.toISOString());
}

function dateColumnValue(value: unknown): never {
  const normalized = normalizeDate(value);
  if (getDatabaseConfig()?.type === 'postgres') {
    return dbValue(new Date(`${normalized}T00:00:00`));
  }
  return dbValue(normalized);
}

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

function memberDisplayName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'there';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'there';
}

function registrationSummaryLines(context: RegistrationContext): string[] {
  const lines: string[] = [];
  if (context.membershipOption && context.membershipOption !== 'none') {
    lines.push(`${context.membershipOption.replace(/_/g, ' ')} membership`);
  }
  for (const selection of context.selections) {
    const leagueName = selection.leagueId ? context.leagues[selection.leagueId]?.name : null;
    const label = selection.selectionType.replace(/_/g, ' ');
    lines.push(leagueName ? `${label}: ${leagueName}` : label);
  }
  return lines;
}

const MEMBERSHIP_OPTION_LABELS: Record<string, string> = {
  regular: 'Regular membership',
  social: 'Social membership',
  regular_spare_only: 'Regular membership with spare-only ice privileges',
  junior_recreational: 'Junior recreational program',
  none: 'No membership fee',
};

const SELECTION_TYPE_LABELS: Record<string, string> = {
  guaranteed_return: 'Guaranteed return',
  return_subject_to_availability: 'Return subject to availability',
  waitlist_add: 'Waitlist (add)',
  waitlist_replace: 'Waitlist (replace)',
  waitlist_add_auto_decline: 'Waitlist (add, auto-decline offers)',
  waitlist_replace_auto_decline: 'Waitlist (replace, auto-decline offers)',
  waitlist_keep_auto_accept: 'Stay on waitlist (auto-accept offers)',
  waitlist_keep_auto_decline: 'Stay on waitlist (auto-decline offers)',
  waitlist_remove: 'Remove from waitlist',
  byot_request: 'BYOT request',
  play_in_request: 'Play-in request',
  instructional_join: 'Instructional join',
  sabbatical: 'Sabbatical',
  third_league_interest: 'Third-league interest',
  spare_only: 'Spare only',
  drop: 'Drop league',
};

function humanizeRegistrationToken(value: string | null | undefined): string {
  if (!value?.trim()) return 'Not available';
  return value.trim().replace(/_/g, ' ');
}

function formatPaidAt(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }).format(date);
}

function formatRegistrationSelectionDetailLine(input: {
  selectionType: string;
  status: string;
  leagueName: string | null;
  replacesLeagueId: number | null;
  replacedLeagueName: string | null;
  isTemporarySabbaticalFill: boolean;
  byotTeammateText: string | null;
  rank: number | null;
}): string {
  const typeLabel = SELECTION_TYPE_LABELS[input.selectionType] ?? humanizeRegistrationToken(input.selectionType);
  const leagueSuffix = input.leagueName ? `: ${input.leagueName}` : '';
  const rankPrefix = input.rank != null && input.selectionType === 'third_league_interest' ? `${input.rank}. ` : '';
  const parts = [`${rankPrefix}${typeLabel}${leagueSuffix} (${humanizeRegistrationToken(input.status)})`];
  if (input.selectionType === 'waitlist_replace' && input.replacedLeagueName) {
    parts.push(`Would replace ${input.replacedLeagueName}`);
  }
  if (input.isTemporarySabbaticalFill) {
    parts.push('Temporary sabbatical-fill spot');
  }
  if (
    (input.selectionType === 'byot_request' || input.selectionType === 'play_in_request') &&
    input.byotTeammateText?.trim()
  ) {
    parts.push(`Teammates: ${input.byotTeammateText.trim()}`);
  }
  return parts.join(' · ');
}

async function buildRegistrationPaymentConfirmationEmailPayload(input: {
  registrationId: number;
  invoice: {
    id: number;
    subtotal_minor: number;
    discount_minor: number;
    total_minor: number;
    paid_at?: string | Date | null;
  };
  orderId: number;
  orderToken: string;
  amountPaidMinor: number;
}): Promise<RegistrationEmailPayload> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, input.registrationId))
    .limit(1);
  if (!registration) {
    return {
      amountPaidMinor: input.amountPaidMinor,
      paymentReference: `Payment order ${input.orderId}`,
    };
  }

  const [season] = await db
    .select()
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, registration.season_id))
    .limit(1);
  const [session] = await db
    .select()
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, registration.session_id))
    .limit(1);
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const selections = await db
    .select({
      selectionType: schema.registrationSelections.selection_type,
      status: schema.registrationSelections.status,
      rank: schema.registrationSelections.rank,
      leagueId: schema.registrationSelections.league_id,
      replacesLeagueId: schema.registrationSelections.replaces_league_id,
      isTemporarySabbaticalFill: schema.registrationSelections.is_temporary_sabbatical_fill,
      byotTeammateText: schema.registrationSelections.byot_teammate_text,
      leagueName: schema.leagues.name,
    })
    .from(schema.registrationSelections)
    .leftJoin(schema.leagues, eq(schema.registrationSelections.league_id, schema.leagues.id))
    .where(eq(schema.registrationSelections.registration_id, input.registrationId))
    .orderBy(asc(schema.registrationSelections.rank), asc(schema.registrationSelections.id));
  const replacedLeagueIds = [...new Set(
    selections
      .map((selection) => selection.replacesLeagueId)
      .filter((leagueId): leagueId is number => leagueId != null)
  )];
  const replacedLeagues = replacedLeagueIds.length > 0
    ? await db
        .select({ id: schema.leagues.id, name: schema.leagues.name })
        .from(schema.leagues)
        .where(inArray(schema.leagues.id, replacedLeagueIds))
    : [];
  const replacedLeagueNames = new Map(replacedLeagues.map((league) => [league.id, league.name]));
  const lineItems = await db
    .select({
      description: schema.registrationInvoiceLineItems.description,
      amountMinor: schema.registrationInvoiceLineItems.amount_minor,
    })
    .from(schema.registrationInvoiceLineItems)
    .where(eq(schema.registrationInvoiceLineItems.invoice_id, input.invoice.id))
    .orderBy(asc(schema.registrationInvoiceLineItems.sort_order), asc(schema.registrationInvoiceLineItems.id));

  const registrationDetailLines = [
    `Season: ${season?.name ?? 'Not available'}`,
    `Session: ${session?.name ?? 'Not available'}`,
    `Membership/program: ${MEMBERSHIP_OPTION_LABELS[registration.membership_option ?? 'none'] ?? humanizeRegistrationToken(registration.membership_option)}`,
    `Registration status: ${humanizeRegistrationToken(registration.status)}`,
  ];
  if (registration.student_discount_claimed === 1) {
    registrationDetailLines.push('Student discount claimed');
  }
  if (registration.reciprocal_discount_claimed === 1) {
    registrationDetailLines.push('Reciprocal club discount claimed');
  }
  if (selections.length > 0) {
    registrationDetailLines.push('League and program choices:');
    for (const selection of selections) {
      registrationDetailLines.push(
        formatRegistrationSelectionDetailLine({
          selectionType: selection.selectionType,
          status: selection.status,
          leagueName: selection.leagueName,
          replacesLeagueId: selection.replacesLeagueId,
          replacedLeagueName: selection.replacesLeagueId ? replacedLeagueNames.get(selection.replacesLeagueId) ?? null : null,
          isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill === 1,
          byotTeammateText: selection.byotTeammateText,
          rank: selection.rank,
        })
      );
    }
  } else {
    registrationDetailLines.push('League and program choices: none listed');
  }

  return {
    curlerName: memberDisplayName(curler),
    seasonName: season?.name ?? null,
    sessionName: session?.name ?? null,
    amountPaidMinor: input.amountPaidMinor,
    registrationDetailLines,
    receiptLineItems: lineItems.map((line): RegistrationReceiptLineItem => ({
      description: line.description,
      amountMinor: line.amountMinor,
    })),
    receiptSubtotalMinor: input.invoice.subtotal_minor,
    receiptDiscountMinor: input.invoice.discount_minor,
    paymentReference: `Payment order ${input.orderId}`,
    paymentDetailsUrl: paymentDetailsUrl(input.orderToken),
    paidAt: formatPaidAt(input.invoice.paid_at),
  };
}

async function loadRegistrationEmailBase(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, registrationId)).limit(1);
  if (!registration) return null;
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const [season] = await db.select().from(schema.curlingSeasons).where(eq(schema.curlingSeasons.id, registration.season_id)).limit(1);
  const [session] = await db.select().from(schema.curlingSessions).where(eq(schema.curlingSessions.id, registration.session_id)).limit(1);
  return { registration, curler, season, session };
}

async function hasSentRegistrationMessage(registrationId: number, messageType: RegistrationMessageType): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.registrationOutboundMessages.id })
    .from(schema.registrationOutboundMessages)
    .where(and(
      eq(schema.registrationOutboundMessages.registration_id, registrationId),
      eq(schema.registrationOutboundMessages.message_type, messageType)
    ))
    .limit(1);
  return Boolean(existing);
}

async function safeSendRegistrationEmail(input: {
  registrationId: number;
  messageType: RegistrationMessageType;
  payload: RegistrationEmailPayload;
  recipientMemberId?: number | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
}): Promise<void> {
  try {
    const base = await loadRegistrationEmailBase(input.registrationId);
    const recipientEmail = input.recipientEmail ?? base?.curler?.email;
    if (!recipientEmail) return;
    await sendRegistrationEmailForDashboard({
      messageType: input.messageType,
      recipientEmail,
      recipientName: input.recipientName ?? memberDisplayName(base?.curler),
      recipientMemberId: input.recipientMemberId ?? base?.curler?.id ?? null,
      registrationId: input.registrationId,
      payload: {
        curlerName: memberDisplayName(base?.curler),
        seasonName: base?.season?.name,
        sessionName: base?.session?.name,
        ...input.payload,
      },
    });
  } catch (error) {
    console.error('[Registration Email] Failed to send registration email:', error);
  }
}

function membershipPaymentFieldsFromRegistrationRow(row: RegistrationMembershipPaymentRowFields): RegistrationMembershipPaymentSelection {
  return {
    membershipOption: (row.membership_option ?? 'none') as CurlingMembershipOptionSqlite,
    studentDiscountClaimed: row.student_discount_claimed === 1,
    studentInstitution: row.student_institution ?? null,
    reciprocalDiscountClaimed: row.reciprocal_discount_claimed === 1,
    reciprocalClubName: row.reciprocal_club_name ?? null,
    experienceType: (row.experience_type ?? null) as CurlingExperienceTypeSqlite | null,
    experienceSelfReportedYears:
      row.experience_self_reported_years === null || row.experience_self_reported_years === undefined
        ? null
        : Number(row.experience_self_reported_years),
  };
}

async function requireRegistrationAccess(registrationId: number, actor: Member) {
  const registration = await getRegistrationById(registrationId);
  if (!registration) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'You do not have access to this registration.' });
  }
  return registration;
}

async function loadFullRegistration(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  if (!registration) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  return registration;
}

export async function isFirstSessionOfSeason(seasonId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [firstSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.season_id, seasonId))
    .orderBy(asc(schema.curlingSessions.start_date), asc(schema.curlingSessions.id))
    .limit(1);
  return firstSession?.id === sessionId;
}

async function loadCompletedSessions(memberId: number): Promise<RegistrationContext['experience']['completedSessions']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      seasonKey: schema.curlingSeasons.name,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(
      eq(schema.leagueRoster.member_id, memberId)
    );

  return rows.map((row) => ({
    leagueId: row.leagueId,
    seasonKey: row.seasonKey,
  }));
}

async function loadLeaguesForSession(sessionId: number, defaultLeagueFeeMinor: number): Promise<Record<number, LeagueConfig>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.leagues).where(eq(schema.leagues.session_id, sessionId));
  return Object.fromEntries(rows.map((row) => [row.id, mapLeagueConfig(row, defaultLeagueFeeMinor)]));
}

async function loadRegistrationSelections(registrationId: number): Promise<RegistrationSelectionInput[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.registrationSelections)
    .where(eq(schema.registrationSelections.registration_id, registrationId))
    .orderBy(asc(schema.registrationSelections.rank), asc(schema.registrationSelections.id));

  const { parseTeamRosterPlacements } = await import('./waitlistTeamRoster.js');
  return rows.map((row) => ({
    selectionType: row.selection_type,
    leagueId: row.league_id,
    rank: row.rank,
    replacesLeagueId: row.replaces_league_id,
    byotTeammateText: row.byot_teammate_text,
    teamRosterPlacements: parseTeamRosterPlacements(row.team_roster_placements),
    isTemporarySabbaticalFill: row.is_temporary_sabbatical_fill === 1,
  }));
}

async function loadActiveLeagueIds(memberId: number, sessionId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ leagueId: schema.leagueRoster.league_id })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, sessionId)
      )
    );
  return rows.map((row) => row.leagueId);
}

async function loadExistingSabbaticals(memberId: number): Promise<RegistrationContext['existingSabbaticals']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.curlingLeagueSabbaticals)
    .where(eq(schema.curlingLeagueSabbaticals.member_id, memberId));
  return rows.map((row) => ({
    id: row.id,
    originalLeagueId: row.original_league_id,
    currentLeagueId: row.current_league_id,
    firstSabbaticalLeagueId: row.first_sabbatical_league_id,
    firstSabbaticalStartDate: normalizeDate(row.first_sabbatical_start_date),
    status: row.status,
    staffOverride: row.staff_override === 1,
  }));
}

async function loadJuniorAssistance(registrationId: number): Promise<RegistrationContext['juniorAssistance'] | undefined> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.financialAssistanceRequests)
    .where(eq(schema.financialAssistanceRequests.registration_id, registrationId))
    .limit(1);
  if (!row) return undefined;
  return {
    requestedPercent: row.requested_percentage,
    approvedPercent: row.approved_percentage,
    status: row.status,
  };
}

async function loadRegistrationSettings(): Promise<{
  priceConfig: RegistrationContext['priceConfig'];
  discountSettings: RegistrationContext['discountSettings'];
}> {
  const { db, schema } = getDrizzleDb();
  const [price] = await db.select().from(schema.registrationPriceSettings).limit(1);
  const [discount] = await db.select().from(schema.registrationDiscountSettings).limit(1);

  return {
    priceConfig: {
      regularMembershipFeeMinor: price?.regular_membership_fee_minor ?? 0,
      socialMembershipFeeMinor: price?.social_membership_fee_minor ?? 0,
      spareOnlyIcePrivilegeFeeMinor: price?.spare_only_ice_privilege_fee_minor ?? 0,
      sabbaticalFeeMinor: price?.sabbatical_fee_minor ?? 0,
      juniorRecreationalFeeMinor: price?.junior_recreational_fee_minor ?? 0,
      defaultLeagueFeeMinor: price?.default_league_fee_minor ?? 0,
    },
    discountSettings: {
      student: {
        amountType: discount?.student_discount_amount_type ?? 'dollar',
        amountValue: discount?.student_discount_amount_value ?? 0,
      },
      reciprocal: {
        amountType: discount?.reciprocal_discount_amount_type ?? 'dollar',
        amountValue: discount?.reciprocal_discount_amount_value ?? 0,
      },
      winterOnly: {
        amountType: discount?.winter_only_discount_amount_type ?? 'dollar',
        amountValue: discount?.winter_only_discount_amount_value ?? 0,
      },
    },
  };
}

export type RegistrationPublicDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

function mapDiscountSlotForPublic(slot: { amountType: 'dollar' | 'percent'; amountValue: number }): RegistrationPublicDiscountSlot {
  if (slot.amountType === 'dollar') {
    return { amountType: 'dollar', value: slot.amountValue / 100 };
  }
  return { amountType: 'percent', value: slot.amountValue };
}

export async function getPublicRegistrationDiscountSettings(): Promise<{
  student: RegistrationPublicDiscountSlot;
  reciprocal: RegistrationPublicDiscountSlot;
}> {
  const { discountSettings } = await loadRegistrationSettings();
  return {
    student: mapDiscountSlotForPublic(discountSettings.student),
    reciprocal: mapDiscountSlotForPublic(discountSettings.reciprocal),
  };
}

type RegistrationMembershipPaymentSourceRow = {
  season_id: number;
  session_id: number;
  curler_member_id: number | null;
  returning_member_answer: number | null;
  submitted_by_member_id: number | null;
  status: string;
  membership_option: CurlingMembershipOptionSqlite;
  student_discount_claimed: number;
  student_institution: string | null;
  reciprocal_discount_claimed: number;
  reciprocal_club_name: string | null;
  experience_type: CurlingExperienceTypeSqlite | null;
  experience_self_reported_years: number | null;
  desired_add_waitlist_league_count?: number | null;
};

async function buildRegistrationContextFromSourceRow(
  registration: RegistrationMembershipPaymentSourceRow,
  options: {
    registrationId?: number;
    curlerDateOfBirth: string | null | undefined;
    completedSessions: RegistrationContext['experience']['completedSessions'];
    experienceBaselines?: MemberExperienceBaselines;
  },
): Promise<RegistrationContext> {
  const window = await getEffectiveRegistrationWindow(registration.season_id, registration.session_id);
  if (!window) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration window not found.' });
  }

  const settings = await loadRegistrationSettings();
  const defaultLeagueFeeMinor = settings.priceConfig.defaultLeagueFeeMinor;
  const selected = membershipPaymentFieldsFromRegistrationRow(registration);
  const membershipOption = selected.membershipOption;
  const experienceBaselines: MemberExperienceBaselines = {
    baselineOtherClubExperienceYears: options.experienceBaselines?.baselineOtherClubExperienceYears ?? 0,
    baselineClubExperienceYears: options.experienceBaselines?.baselineClubExperienceYears ?? 0,
  };
  const hasBaselineExperience =
    experienceBaselines.baselineOtherClubExperienceYears > 0 || experienceBaselines.baselineClubExperienceYears > 0;
  const useKnownExperience =
    selected.experienceType === null && (options.completedSessions.length > 0 || hasBaselineExperience);
  const experienceType = (selected.experienceType ?? (useKnownExperience ? 'known_existing' : 'none_or_minimal')) as CurlingExperienceTypeSqlite;
  const memberId = registration.curler_member_id ?? null;
  const emptyContextState: [
    Record<number, LeagueConfig>,
    RegistrationSelectionInput[],
    number[],
    RegistrationContext['existingSabbaticals'],
    RegistrationContext['existingWaitlistEntries'],
    RegistrationContext['juniorAssistance'] | undefined,
  ] = [{}, [], [], [], [], undefined];
  const [leagues, selections, activeLeagueIds, existingSabbaticals, existingWaitlistEntries, juniorAssistance] = options.registrationId
    ? await Promise.all([
        loadLeaguesForSession(registration.session_id, defaultLeagueFeeMinor),
        loadRegistrationSelections(options.registrationId),
        memberId ? loadActiveLeagueIds(memberId, registration.session_id) : Promise.resolve([]),
        memberId ? loadExistingSabbaticals(memberId) : Promise.resolve([]),
        memberId ? loadExistingWaitlistEntriesForMember(memberId, registration.session_id) : Promise.resolve([]),
        loadJuniorAssistance(options.registrationId),
      ])
    : emptyContextState;
  const participatedLeagueIds = Array.from(
    new Set([...options.completedSessions.map((session) => session.leagueId), ...activeLeagueIds])
  );

  return {
    season: {
      id: window.season.id,
      name: window.season.name ?? '',
      startDate: window.season.startDate ?? '',
      endDate: window.season.endDate ?? '',
    },
    session: {
      id: window.session.id,
      seasonId: window.session.seasonId,
      name: window.session.name ?? '',
      startDate: window.session.startDate ?? '',
      endDate: window.session.endDate ?? '',
    },
    registrationState: window.state,
    isFirstSessionOfSeason: await isFirstSessionOfSeason(registration.season_id, registration.session_id),
    registrant: {
      memberId: registration.curler_member_id,
      hasUserAccount: Boolean(registration.curler_member_id),
      isReturningMember: registration.returning_member_answer === 1,
      dateOfBirth: normalizeDate(options.curlerDateOfBirth),
    },
    submittedByMemberId: registration.submitted_by_member_id,
    membershipOption,
    experience: {
      type: experienceType,
      selfReportedYears: selected.experienceSelfReportedYears,
      baselineOtherClubExperienceYears: experienceBaselines.baselineOtherClubExperienceYears,
      baselineClubExperienceYears: experienceBaselines.baselineClubExperienceYears,
      completedSessions: options.completedSessions,
    },
    activeLeagueIds,
    participatedLeagueIds,
    existingSabbaticals,
    existingWaitlistEntries,
    leagues,
    selections,
    discountClaims:
      membershipOption === 'social'
        ? {}
        : {
            student: {
              claimed: selected.studentDiscountClaimed,
              institution: selected.studentInstitution,
            },
            reciprocal: {
              claimed: selected.reciprocalDiscountClaimed,
              clubName: selected.reciprocalClubName,
            },
            winterOnly: {},
          },
    ...settings,
    juniorAssistance,
    sabbaticalDurationLimitYears: 3,
    desiredAddWaitlistLeagueCount: registration.desired_add_waitlist_league_count ?? null,
  };
}

export async function buildRegistrationContextForDraft(registrationId: number): Promise<RegistrationContext> {
  const { db, schema } = getDrizzleDb();
  const registration = await loadFullRegistration(registrationId);
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const completedSessions = registration.curler_member_id ? await loadCompletedSessions(registration.curler_member_id) : [];
  const experienceBaselines = curler ? memberExperienceBaselinesFromRow(curler) : undefined;
  return buildRegistrationContextFromSourceRow(registration, {
    registrationId,
    curlerDateOfBirth: curler?.date_of_birth,
    completedSessions,
    experienceBaselines,
  });
}

export type GuestMembershipPaymentPreviewInput = {
  seasonId: number;
  sessionId: number;
  curlerDateOfBirth: string;
  membershipChoice: 'regular' | 'social';
  basicIcePrivileges: boolean;
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceSelfReportedYears: number | null;
};

export async function getGuestMembershipPaymentPreview(input: GuestMembershipPaymentPreviewInput): Promise<RegistrationMembershipPaymentPayload> {
  const window = await getEffectiveRegistrationWindow(input.seasonId, input.sessionId);
  if (!window) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration window not found.' });
  }
  const membershipOption: CurlingMembershipOptionSqlite =
    input.membershipChoice === 'social' ? 'social' : input.basicIcePrivileges ? 'regular_spare_only' : 'regular';
  const experienceTypeResolved: CurlingExperienceTypeSqlite | null =
    input.membershipChoice === 'social'
      ? null
      : input.experienceType === 'known_existing'
        ? 'none_or_minimal'
        : input.experienceType;
  const experienceYears =
    input.membershipChoice === 'social' || input.experienceType !== 'specified_years' ? null : input.experienceSelfReportedYears;

  const synthetic: RegistrationMembershipPaymentSourceRow = {
    season_id: input.seasonId,
    session_id: input.sessionId,
    curler_member_id: null,
    returning_member_answer: 0,
    submitted_by_member_id: null,
    status: 'shell_complete',
    membership_option: membershipOption,
    student_discount_claimed: input.membershipChoice === 'social' ? 0 : input.studentDiscountClaimed ? 1 : 0,
    student_institution: input.membershipChoice === 'social' ? null : input.studentInstitution,
    reciprocal_discount_claimed: input.membershipChoice === 'social' ? 0 : input.reciprocalDiscountClaimed ? 1 : 0,
    reciprocal_club_name: input.membershipChoice === 'social' ? null : input.reciprocalClubName,
    experience_type: experienceTypeResolved,
    experience_self_reported_years: experienceYears,
  };

  const context = await buildRegistrationContextFromSourceRow(synthetic, {
    curlerDateOfBirth: input.curlerDateOfBirth,
    completedSessions: [],
  });
  const evaluation = evaluateRegistrationDraft(context);

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(synthetic),
    icePrivilegesChoice: input.basicIcePrivileges ? 'basic_ice' : 'none',
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: effectiveExperienceYears(context),
    spareOnlyIcePrivilegeFeeMinor: context.priceConfig.spareOnlyIcePrivilegeFeeMinor,
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
  };
}

export async function getRegistrationMembershipPaymentPayload(
  registrationId: number,
  actor: Member,
): Promise<RegistrationMembershipPaymentPayload> {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  const context = await buildRegistrationContextForDraft(registrationId);
  const evaluation = evaluateRegistrationDraft(context);

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(registration),
    icePrivilegesChoice: (registration.ice_privileges_choice ?? 'none') as CurlingIcePrivilegesChoiceSqlite,
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: effectiveExperienceYears(context),
    spareOnlyIcePrivilegeFeeMinor: context.priceConfig.spareOnlyIcePrivilegeFeeMinor,
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
  };
}

async function assertEditableForMembershipPayment(
  registration: {
    status: string;
    season_id: number;
    session_id: number;
    submitted_at?: string | Date | null;
  },
  actor?: Member,
): Promise<void> {
  if (actor && memberCanManageRegistrations(actor) && isStaffEditableRegistrationStatus(registration.status)) {
    if (registration.status === 'cancelled') {
      throw new RegistrationMembershipPaymentValidationError({
        registration: 'Cancelled registrations cannot be edited.',
      });
    }
    return;
  }
  if (registration.status === 'shell_complete' || registration.status === 'submitted' || registration.status === 'awaiting_payment') {
    return;
  }
  if (isPriorityEditableRegistrationStatus(registration.status)) {
    const window = await getEffectiveRegistrationWindow(registration.season_id, registration.session_id);
    if (window?.state === 'priority') {
      return;
    }
  }
  throw new RegistrationMembershipPaymentValidationError({ registration: 'Complete the registration shell before choosing membership.' });
}

export async function updateMembership(registrationId: number, actor: Member, input: UpdateMembershipInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  await assertEditableForMembershipPayment(registration, actor);

  if (input.membershipOption === 'junior_recreational') {
    const payload = await getRegistrationShellPayload(registrationId);
    if (!isJuniorRecreationalEligible(payload?.curler?.dateOfBirth ?? null)) {
      throw new RegistrationMembershipPaymentValidationError({
        membershipOption: 'Junior Recreational is only available for curlers age 21 or younger.',
      });
    }
  }

  const membershipOption: CurlingMembershipOptionSqlite =
    input.membershipOption === 'social'
      ? 'social'
      : input.membershipOption === 'junior_recreational'
        ? 'junior_recreational'
        : input.basicIcePrivileges
          ? 'regular_spare_only'
          : 'regular';
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        membership_option: membershipOption,
        student_discount_claimed:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? 0 : registration.student_discount_claimed,
        student_institution:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.student_institution,
        reciprocal_discount_claimed:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? 0 : registration.reciprocal_discount_claimed,
        reciprocal_club_name:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.reciprocal_club_name,
        experience_type:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.experience_type,
        experience_self_reported_years:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.experience_self_reported_years,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));

    await tx
      .delete(schema.financialAssistanceRequests)
      .where(eq(schema.financialAssistanceRequests.registration_id, registrationId));
    const requestedPercent = input.juniorAssistancePercent ?? 0;
    if (membershipOption === 'junior_recreational' && requestedPercent > 0) {
      if (![25, 50, 75].includes(requestedPercent)) {
        throw new RegistrationMembershipPaymentValidationError({
          juniorAssistancePercent: 'Junior Recreational assistance must be 25%, 50%, or 75%.',
        });
      }
      await tx.insert(schema.financialAssistanceRequests).values({
        registration_id: registrationId,
        member_id: registration.curler_member_id ?? actor.id,
        requested_percentage: requestedPercent,
        status: 'pending',
        updated_at: sql`CURRENT_TIMESTAMP`,
      });
    }
  });
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

export async function updateIcePrivileges(registrationId: number, actor: Member, input: UpdateIcePrivilegesInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  await assertEditableForMembershipPayment(registration, actor);
  if (registration.membership_option === 'social' || registration.membership_option === 'junior_recreational') {
    throw new RegistrationMembershipPaymentValidationError({
      icePrivileges: 'Ice privileges only apply to regular membership.',
    });
  }

  const membershipOption: CurlingMembershipOptionSqlite = input.choice === 'basic_ice' ? 'regular_spare_only' : 'regular';
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        membership_option: membershipOption,
        ice_privileges_choice: input.choice,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));
    if (input.choice === 'none') {
      await tx.delete(schema.registrationSelections).where(eq(schema.registrationSelections.registration_id, registrationId));
    }
  });
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

export async function updateDiscounts(registrationId: number, actor: Member, input: UpdateDiscountsInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  await assertEditableForMembershipPayment(registration, actor);
  if (registration.membership_option === 'social') {
    throw new RegistrationMembershipPaymentValidationError({ discounts: 'Social membership cannot receive discounts.' });
  }
  if (registration.membership_option === 'junior_recreational') {
    throw new RegistrationMembershipPaymentValidationError({ discounts: 'Junior Recreational cannot receive standard discounts.' });
  }

  const studentClaimed = input.studentDiscountClaimed === true;
  const reciprocalClaimed = input.reciprocalDiscountClaimed === true;
  if (studentClaimed && !trimOrNull(input.studentInstitution)) {
    throw new RegistrationMembershipPaymentValidationError({ studentInstitution: 'Student discount requires an institution.' });
  }
  if (reciprocalClaimed && !trimOrNull(input.reciprocalClubName)) {
    throw new RegistrationMembershipPaymentValidationError({ reciprocalClubName: 'Reciprocal discount requires another curling club.' });
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      student_discount_claimed: studentClaimed ? 1 : 0,
      student_institution: studentClaimed ? trimOrNull(input.studentInstitution) : null,
      reciprocal_discount_claimed: reciprocalClaimed ? 1 : 0,
      reciprocal_club_name: reciprocalClaimed ? trimOrNull(input.reciprocalClubName) : null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

export async function updateExperience(registrationId: number, actor: Member, input: UpdateExperienceInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  await assertEditableForMembershipPayment(registration, actor);
  if (registration.membership_option === 'social') {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Social membership does not require curling experience.' });
  }
  if (registration.membership_option === 'junior_recreational') {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Junior Recreational does not use normal league experience.' });
  }
  if (input.experienceType === 'specified_years') {
    if (!Number.isFinite(input.experienceSelfReportedYears) || input.experienceSelfReportedYears < 0) {
      throw new RegistrationMembershipPaymentValidationError({ experienceSelfReportedYears: 'Experience must be a non-negative number.' });
    }
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      experience_type: input.experienceType,
      experience_self_reported_years: input.experienceType === 'specified_years' ? input.experienceSelfReportedYears : null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

async function assertShellStillComplete(registrationId: number): Promise<void> {
  const payload = await getRegistrationShellPayload(registrationId);
  if (!payload) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  const { registration, curler, policiesComplete, isMinor } = payload;
  const details: Record<string, string> = {};
  if (!registration.submitted_by_member_id) details.submitter = 'The submitting user is required.';
  if (!registration.curler_member_id) details.curler = 'The curler is required.';
  if (!policiesComplete) details.policies = 'All required policies must be accepted.';
  if (
    !curler?.firstName ||
    !curler.lastName ||
    !curler.dateOfBirth ||
    !curler.email ||
    !curler.phone ||
    !curler.mailingAddress ||
    !curler.emergencyContactName ||
    !curler.emergencyContactPhone
  ) {
    details.demographics = 'Required curler demographic information is incomplete.';
  }
  if (isMinor && (!registration.guardian_first_name || !registration.guardian_last_name || !registration.guardian_email || !registration.guardian_phone)) {
    details.guardian = 'Parent/guardian information is required for minors.';
  }
  if (Object.keys(details).length > 0) {
    throw new RegistrationMembershipPaymentValidationError(details);
  }
}

function collectDecisionErrors(
  keyPrefix: string,
  errors: Array<{ code: string; message: string }>,
  details: Record<string, string>
): void {
  for (const [index, error] of errors.entries()) {
    details[`${keyPrefix}.${index}.${error.code}`] = error.message;
  }
}

const REAL_LEAGUE_SELECTION_TYPES_FOR_SUBMIT = new Set([
  'guaranteed_return',
  'return_subject_to_availability',
  'third_league_interest',
  'waitlist_add',
  'waitlist_replace',
  'waitlist_add_auto_decline',
  'waitlist_replace_auto_decline',
  'waitlist_keep_auto_accept',
  'waitlist_keep_auto_decline',
  'byot_request',
  'play_in_request',
  'instructional_join',
]);

function assertReadyToSubmit(
  registration: { status: string; ice_privileges_choice?: CurlingIcePrivilegesChoiceSqlite | null },
  context: RegistrationContext,
  evaluation: ReturnType<typeof evaluateRegistrationDraft>
): void {
  if (
    registration.status !== 'shell_complete' &&
    registration.status !== 'submitted' &&
    registration.status !== 'awaiting_payment' &&
    registration.status !== 'awaiting_placement' &&
    registration.status !== 'awaiting_staff_review' &&
    registration.status !== 'payment_started' &&
    registration.status !== 'paid' &&
    registration.status !== 'confirmed'
  ) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration is not ready to submit.' });
  }
  if (registration.status === 'confirmed' || registration.status === 'paid') {
    return;
  }
  if (context.registrationState === 'closed') {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration is closed.' });
  }
  if (
    context.membershipOption !== 'regular' &&
    context.membershipOption !== 'regular_spare_only' &&
    context.membershipOption !== 'social' &&
    context.membershipOption !== 'junior_recreational'
  ) {
    throw new RegistrationMembershipPaymentValidationError({ membershipOption: 'Choose regular, social, or Junior Recreational membership.' });
  }
  const details: Record<string, string> = {};
  if (registration.ice_privileges_choice === 'league_play') {
    const hasLeagueSelection = context.selections.some(
      (selection) => selection.leagueId != null && REAL_LEAGUE_SELECTION_TYPES_FOR_SUBMIT.has(selection.selectionType)
    );
    if (!hasLeagueSelection) {
      details.iceLeagues = 'Select at least one league to continue with league play.';
    }
  }
  if (evaluation.feePreview.blockingErrors.length > 0) {
    collectDecisionErrors('fees', evaluation.feePreview.blockingErrors, details);
  }
  if (evaluation.selectionValidation.blockingErrors.length > 0) {
    collectDecisionErrors('selection', evaluation.selectionValidation.blockingErrors, details);
  }
  const waitlistCleanup = evaluateWaitlistCleanup(context);
  if (waitlistCleanup.blockingErrors.length > 0) {
    collectDecisionErrors('waitlistCleanup', waitlistCleanup.blockingErrors, details);
  }
  const existingWaitlistPreferences = evaluateExistingWaitlistPreferences(context);
  if (existingWaitlistPreferences.blockingErrors.length > 0) {
    collectDecisionErrors('existingWaitlist', existingWaitlistPreferences.blockingErrors, details);
  }
  if (Object.keys(details).length > 0) {
    throw new RegistrationMembershipPaymentValidationError(details);
  }
  if (context.membershipOption === 'social' || context.membershipOption === 'junior_recreational') return;
  if (!context.experience.type) {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Curling experience is required.' });
  }
  if (context.experience.type === 'specified_years' && (context.experience.selfReportedYears ?? -1) < 0) {
    throw new RegistrationMembershipPaymentValidationError({ experienceSelfReportedYears: 'Experience must be a non-negative number.' });
  }
}

async function createInvoiceSnapshot(input: {
  registrationId: number;
  payerMemberId: number;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
  tx?: any;
  existingInvoiceId?: number | null;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const status =
    input.paymentDecision.outcome === 'deferred_payment'
      ? 'deferred'
      : input.paymentDecision.outcome === 'immediate_payment'
        ? 'awaiting_payment'
        : 'paid';
  const invoiceValues = {
    registration_id: input.registrationId,
    payer_member_id: input.payerMemberId,
    status,
    subtotal_minor: input.feePreview.subtotalMinor,
    discount_minor: input.feePreview.discountTotalMinor,
    total_minor: input.feePreview.totalDueMinor,
    currency: 'usd',
    deferred: input.paymentDecision.outcome === 'deferred_payment' ? 1 : 0,
    deferred_reason: input.paymentDecision.deferralReasons.join(',') || null,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };

  const invoiceId = input.existingInvoiceId ?? null;
  const invoice = invoiceId
    ? (
        await executor
          .update(schema.registrationInvoices)
          .set(invoiceValues)
          .where(eq(schema.registrationInvoices.id, invoiceId))
          .returning({ id: schema.registrationInvoices.id })
      )[0]
    : (
        await executor
          .insert(schema.registrationInvoices)
          .values(invoiceValues)
          .returning({ id: schema.registrationInvoices.id })
      )[0];

  const lineItems = [...input.feePreview.lineItems, ...input.feePreview.discountLineItems];
  await executor.delete(schema.registrationInvoiceLineItems).where(eq(schema.registrationInvoiceLineItems.invoice_id, invoice.id));
  if (lineItems.length > 0) {
    await executor.insert(schema.registrationInvoiceLineItems).values(
      lineItems.map((lineItem: RegistrationFeeLineItem, index: number) => ({
        invoice_id: invoice.id,
        line_type: lineItem.lineType as RegistrationInvoiceLineKindSqlite,
        description: lineItem.description,
        related_league_id: lineItem.relatedLeagueId ?? null,
        amount_minor: lineItem.amountMinor,
        discount_eligible: lineItem.discountEligible ? 1 : 0,
        sort_order: index,
      }))
    );
  }
  return invoice.id;
}

async function loadLatestRegistrationInvoice(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  return invoice ?? null;
}

function waitlistPositionSortKey(registrationId: number, leagueId: number): string {
  return `${Date.now().toString().padStart(13, '0')}:${registrationId}:${leagueId}`;
}

function isFutureTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function waitlistReason(selectionType: RegistrationSelectionInput['selectionType']): string {
  return selectionType === 'waitlist_replace' ? 'WAITLIST_REPLACE_CREATED' : 'WAITLIST_ADD_CREATED';
}

async function persistRegistrationWaitlists(input: {
  tx: any;
  registrationId: number;
  actorMemberId: number;
  curlerMemberId: number;
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount?: number | null;
  notifications?: Array<{
    entryId: number;
    waitlistId: number;
    leagueId: number;
    entryType: 'add' | 'replace';
    replacesLeagueId: number | null;
  }>;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const { replacementLineageFromLeagueId } = await import('./waitlistEntityService.js');
  const waitlistSelections = input.selections.filter((selection) =>
    ['waitlist_add', 'waitlist_replace', 'waitlist_add_auto_decline', 'waitlist_replace_auto_decline'].includes(
      selection.selectionType,
    ),
  );
  for (const selection of waitlistSelections) {
    if (!selection.leagueId) continue;
    const normalizedSelection: RegistrationSelectionInput = {
      ...selection,
      selectionType:
        selection.selectionType === 'waitlist_add_auto_decline'
          ? 'waitlist_add'
          : selection.selectionType === 'waitlist_replace_auto_decline'
            ? 'waitlist_replace'
            : selection.selectionType,
    };
    const [league] = await input.tx
      .select({
        waitlistId: schema.leagues.waitlist_id,
        leagueType: schema.leagues.league_type,
        format: schema.leagues.format,
        sessionId: schema.leagues.session_id,
      })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, selection.leagueId))
      .limit(1);
    if (!league?.waitlistId || league.sessionId == null) continue;

    const activeEntries = await input.tx
      .select()
      .from(schema.waitlistEntries)
      .where(
        and(
          eq(schema.waitlistEntries.waitlist_id, league.waitlistId),
          eq(schema.waitlistEntries.status, 'active'),
        ),
      );
    const { waitlistEntryIncludesMember } = await import('./waitlistMemberMembership.js');
    const existingParticipation = activeEntries.find((entry: (typeof activeEntries)[number]) =>
      waitlistEntryIncludesMember(input.curlerMemberId, entry),
    );
    if (existingParticipation && existingParticipation.member_id !== input.curlerMemberId) {
      continue;
    }
    const existing = existingParticipation ?? null;

    const fallbackEntryType = normalizedSelection.selectionType === 'waitlist_replace' ? 'replace' : 'add';
    let entryType = fallbackEntryType;
    let replacesLeagueId = normalizedSelection.replacesLeagueId ?? null;
    let teamRosterText = normalizedSelection.teamRosterText?.trim() || normalizedSelection.byotTeammateText?.trim() || null;
    let teamRosterPlacements: string | null = null;

    if (league.leagueType === 'bring_your_own_team') {
      const { normalizeAndValidateTeamRosterPlacements, serializeTeamRosterPlacements } = await import(
        './waitlistTeamRoster.js'
      );
      const normalized = await normalizeAndValidateTeamRosterPlacements({
        league: { league_type: league.leagueType, format: league.format },
        primaryMemberId: input.curlerMemberId,
        sessionId: league.sessionId,
        placements: normalizedSelection.teamRosterPlacements,
        fallbackEntryType,
        fallbackReplacesLeagueId: normalizedSelection.replacesLeagueId ?? null,
        teamRosterText,
        pendingRosterText: normalizedSelection.byotTeammateText,
        enforceMemberPlacementRules: true,
      });
      entryType = normalized.entryType;
      replacesLeagueId = normalized.replacesLeagueId;
      teamRosterText = normalized.teamRosterText;
      teamRosterPlacements = serializeTeamRosterPlacements(normalized.placements);
    }

    const replacement =
      entryType === 'replace' && replacesLeagueId
        ? await replacementLineageFromLeagueId(replacesLeagueId)
        : null;

    const offerResponsePreference = offerPreferenceFromSelectionType(selection.selectionType) ?? 'ask';
    const addWaitlistPriorityRank =
      entryType === 'add' && normalizedSelection.rank != null ? normalizedSelection.rank : null;
    const desiredAddWaitlistLeagueCount =
      entryType === 'add' ? (input.desiredAddWaitlistLeagueCount ?? null) : null;

    const nextEntry = {
      member_id: input.curlerMemberId,
      waitlist_id: league.waitlistId,
      source_registration_id: input.registrationId,
      entry_type: entryType,
      replaces_lineage_start_league_id: replacement?.lineageStartLeagueId ?? null,
      original_replaces_league_id: replacement?.originalReplacesLeagueId ?? null,
      team_roster_text: teamRosterText,
      team_roster_placements: teamRosterPlacements,
      offer_response_preference: offerResponsePreference,
      desired_add_waitlist_league_count: desiredAddWaitlistLeagueCount,
      add_waitlist_priority_rank: addWaitlistPriorityRank,
      status: 'active',
      updated_at: sql`CURRENT_TIMESTAMP`,
    };

    let entryId: number;
    let before: unknown = null;
    let after: unknown = nextEntry;
    let action: WaitlistAuditActionSqlite = 'entry_created';
    if (existing) {
      entryId = existing.id;
      before = {
        entryType: existing.entry_type,
        replacesLineageStartLeagueId: existing.replaces_lineage_start_league_id,
        teamRosterText: existing.team_roster_text,
        teamRosterPlacements: existing.team_roster_placements,
        sourceRegistrationId: existing.source_registration_id,
        offerResponsePreference: existing.offer_response_preference,
        status: existing.status,
      };
      const entryTypeChanged = existing.entry_type !== nextEntry.entry_type;
      const replacementChanged = existing.replaces_lineage_start_league_id !== nextEntry.replaces_lineage_start_league_id;
      const rosterChanged = existing.team_roster_text !== nextEntry.team_roster_text;
      const placementsChanged = existing.team_roster_placements !== nextEntry.team_roster_placements;
      const sourceChanged = existing.source_registration_id !== input.registrationId;
      const preferenceChanged = existing.offer_response_preference !== nextEntry.offer_response_preference;
      if (
        !entryTypeChanged &&
        !replacementChanged &&
        !rosterChanged &&
        !placementsChanged &&
        !sourceChanged &&
        !preferenceChanged
      ) {
        continue;
      }
      action = entryTypeChanged
        ? nextEntry.entry_type === 'replace'
          ? 'entry_converted_add_to_replace'
          : 'entry_converted_replace_to_add'
        : preferenceChanged && !entryTypeChanged && !replacementChanged && !rosterChanged && !placementsChanged && !sourceChanged
          ? 'offer_preference_changed'
          : replacementChanged
            ? 'replacement_league_changed'
            : 'staff_correction';
      await input.tx.update(schema.waitlistEntries).set(nextEntry).where(eq(schema.waitlistEntries.id, entryId));
    } else {
      const joinedAt = new Date();
      const [inserted] = await input.tx
        .insert(schema.waitlistEntries)
        .values({
          ...nextEntry,
          position_sort_key: waitlistPositionSortKey(input.registrationId, selection.leagueId),
          joined_at: dbValue(joinedAt),
        })
        .returning({ id: schema.waitlistEntries.id });
      entryId = inserted.id;
      after = { ...nextEntry, id: entryId };
      input.notifications?.push({
        entryId,
        waitlistId: league.waitlistId,
        leagueId: selection.leagueId,
        entryType: nextEntry.entry_type as 'add' | 'replace',
        replacesLeagueId: selection.replacesLeagueId ?? null,
      });
    }

    const queuePosition =
      league?.waitlistId != null ? await getWaitlistQueuePosition(input.tx, league.waitlistId, entryId) : null;
    await insertWaitlistAuditEvent(input.tx, {
      waitlistEntryId: entryId,
      leagueId: selection.leagueId,
      memberId: input.curlerMemberId,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      action,
      reason: existing ? 'WAITLIST_ENTRY_UPDATED_FROM_REGISTRATION' : waitlistReason(normalizedSelection.selectionType),
      before: before ?? null,
      after,
      metadata: { sourceRegistrationId: input.registrationId, reason: 'REGISTRATION_SUBMITTED' },
      position: queuePosition?.position ?? null,
      queueTotal: queuePosition?.total ?? null,
    });
  }
}

async function persistWaitlistOfferPreferences(input: {
  tx: any;
  registrationId: number;
  actorMemberId: number;
  curlerMemberId: number;
  selections: RegistrationSelectionInput[];
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const keepSelections = input.selections.filter(
    (selection) =>
      selection.leagueId != null &&
      (selection.selectionType === 'waitlist_keep_auto_accept' || selection.selectionType === 'waitlist_keep_auto_decline'),
  );
  if (keepSelections.length === 0) return;

  for (const selection of keepSelections) {
    const leagueId = selection.leagueId!;
    const offerResponsePreference = offerPreferenceFromSelectionType(selection.selectionType);
    if (!offerResponsePreference) continue;

    const [league] = await input.tx
      .select({ waitlistId: schema.leagues.waitlist_id })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    if (!league?.waitlistId) continue;

    const activeEntries = await input.tx
      .select()
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.waitlist_id, league.waitlistId), eq(schema.waitlistEntries.status, 'active')));

    const existing = activeEntries.find((entry: (typeof activeEntries)[number]) =>
      waitlistEntryIncludesMember(input.curlerMemberId, entry),
    );
    if (!existing || existing.offer_response_preference === offerResponsePreference) continue;

    const before = { offerResponsePreference: existing.offer_response_preference };
    const after = { offerResponsePreference };
    await input.tx
      .update(schema.waitlistEntries)
      .set({
        offer_response_preference: offerResponsePreference,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.waitlistEntries.id, existing.id));

    const queuePosition = await getWaitlistQueuePosition(input.tx, league.waitlistId, existing.id);
    await insertWaitlistAuditEvent(input.tx, {
      waitlistEntryId: existing.id,
      leagueId,
      memberId: existing.member_id,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      action: 'offer_preference_changed',
      reason: 'WAITLIST_OFFER_PREFERENCE_SET_FROM_REGISTRATION',
      before,
      after,
      metadata: { sourceRegistrationId: input.registrationId, reason: 'REGISTRATION_SUBMITTED' },
      position: queuePosition?.position ?? null,
      queueTotal: queuePosition?.total ?? null,
    });
  }
}

function sabbaticalFeeForLeague(feePreview: RegistrationFeePreview, leagueId: number): number {
  return feePreview.lineItems.find((item) => item.lineType === 'sabbatical_fee' && item.relatedLeagueId === leagueId)?.amountMinor ?? 0;
}

async function persistRegistrationSabbaticals(input: {
  tx: any;
  registrationId: number;
  curlerMemberId: number;
  context: RegistrationContext;
  feePreview: RegistrationFeePreview;
  notifications?: Array<{
    leagueId: number;
    leagueName: string;
    feeAmountMinor: number;
  }>;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const sabbaticalSelections = input.context.selections.filter(
    (selection) => selection.selectionType === 'sabbatical' && selection.leagueId
  );
  for (const selection of sabbaticalSelections) {
    const leagueId = selection.leagueId!;
    const league = input.context.leagues[leagueId];
    if (!league) continue;
    const startDate = league.firstDayOfPlay ?? league.startDate;
    const endDate = league.lastDayOfPlay ?? league.endDate;
    const [existing] = await input.tx
      .select()
      .from(schema.curlingLeagueSabbaticals)
      .where(
        and(
          eq(schema.curlingLeagueSabbaticals.member_id, input.curlerMemberId),
          eq(schema.curlingLeagueSabbaticals.current_league_id, leagueId),
          eq(schema.curlingLeagueSabbaticals.source_registration_id, input.registrationId)
        )
      )
      .limit(1);
    const sabbaticalId = existing?.id ?? (
      await input.tx
        .insert(schema.curlingLeagueSabbaticals)
        .values({
          member_id: input.curlerMemberId,
          lineage_key: `${input.curlerMemberId}:${leagueId}`,
          original_league_id: leagueId,
          current_league_id: leagueId,
          source_registration_id: input.registrationId,
          first_sabbatical_league_id: leagueId,
          first_sabbatical_start_date: dateColumnValue(startDate),
          status: 'active',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .returning({ id: schema.curlingLeagueSabbaticals.id })
    )[0].id;

    const [existingSession] = await input.tx
      .select({ id: schema.curlingSabbaticalSessions.id })
      .from(schema.curlingSabbaticalSessions)
      .where(
        and(
          eq(schema.curlingSabbaticalSessions.sabbatical_id, sabbaticalId),
          eq(schema.curlingSabbaticalSessions.registration_id, input.registrationId),
          eq(schema.curlingSabbaticalSessions.league_id, leagueId)
        )
      )
      .limit(1);
    const sessionValues = {
      sabbatical_id: sabbaticalId,
      league_id: leagueId,
      registration_id: input.registrationId,
      fee_amount_minor: sabbaticalFeeForLeague(input.feePreview, leagueId),
      payment_status: 'unpaid',
      starts_at: dateColumnValue(startDate),
      ends_at: dateColumnValue(endDate),
      updated_at: sql`CURRENT_TIMESTAMP`,
    };
    if (existingSession) {
      await input.tx
        .update(schema.curlingSabbaticalSessions)
        .set(sessionValues)
        .where(eq(schema.curlingSabbaticalSessions.id, existingSession.id));
    } else {
      await input.tx.insert(schema.curlingSabbaticalSessions).values(sessionValues);
      input.notifications?.push({
        leagueId,
        leagueName: league.name,
        feeAmountMinor: sessionValues.fee_amount_minor,
      });
    }

    await input.tx
      .update(schema.registrationSelections)
      .set({
        related_sabbatical_id: sabbaticalId,
        status: 'confirmed',
        fee_amount_minor_snapshot: sabbaticalFeeForLeague(input.feePreview, leagueId),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.registrationSelections.registration_id, input.registrationId),
          eq(schema.registrationSelections.league_id, leagueId),
          eq(schema.registrationSelections.selection_type, 'sabbatical')
        )
      );
  }
}

async function setSubmittedSelectionStatuses(tx: any, registrationId: number): Promise<void> {
  const { schema } = getDrizzleDb();
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'confirmed', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('guaranteed_return', 'byot_request', 'play_in_request', 'instructional_join', 'spare_only', 'junior_recreational')`
      )
    );
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'pending', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('return_subject_to_availability', 'third_league_interest')`
      )
    );
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'waitlisted', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('waitlist_add', 'waitlist_replace', 'waitlist_add_auto_decline', 'waitlist_replace_auto_decline', 'waitlist_keep_auto_accept', 'waitlist_keep_auto_decline')`
      )
    );
}

export async function submitStaffRegistrationEdits(input: SubmitRegistrationInput & { changedSummary?: string }): Promise<SubmitRegistrationResult> {
  if (!memberCanManageRegistrations(input.actor)) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'You do not have permission to manage registrations.' });
  }
  const shellRegistration = await getRegistrationById(input.registrationId);
  if (!shellRegistration) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration was not found.' });
  }
  await assertStaffEditableRegistration(input.actor, shellRegistration);
  return submitRegistrationMembershipPayment({ ...input, staffEdit: true });
}

export async function submitRegistrationMembershipPayment(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult> {
  await requireRegistrationAccess(input.registrationId, input.actor);
  const registration = await loadFullRegistration(input.registrationId);
  await assertShellStillComplete(input.registrationId);
  if (registration.curler_member_id) {
    const initialContext = await buildRegistrationContextForDraft(input.registrationId);
    await removeOrphanedRegistrationWaitlistEntries({
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      selections: initialContext.selections,
    });
    await removeOrphanedRegistrationRosterPlacements({
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      selections: initialContext.selections,
    });
  }
  const context = await buildRegistrationContextForDraft(input.registrationId);
  const evaluation = evaluateRegistrationDraft(context);
  assertReadyToSubmit(registration, context, evaluation);

  const payerMemberId = registration.submitted_by_member_id ?? input.actor.id;
  const { db, schema } = getDrizzleDb();
  const existingInvoice = await loadLatestRegistrationInvoice(input.registrationId);
  const priorPaidMinor =
    input.staffEdit && existingInvoice?.status === 'paid' ? existingInvoice.total_minor : 0;
  const requiresCheckoutConfirmation =
    !input.staffEdit &&
    evaluation.paymentDecision.outcome === 'immediate_payment' &&
    registrationPreviouslyDeferred(registration, existingInvoice) &&
    !input.confirmImmediatePayment;
  if (requiresCheckoutConfirmation) {
    return {
      outcome: 'immediate_payment',
      registrationId: input.registrationId,
      requiresCheckoutConfirmation: true,
      totalDueMinor: evaluation.feePreview.totalDueMinor,
      message: REGISTRATION_IMMEDIATE_PAYMENT_CONFIRMATION_MESSAGE,
    };
  }
  if (
    evaluation.paymentDecision.outcome === 'immediate_payment' &&
    existingInvoice?.payment_order_id &&
    existingInvoice.status === 'checkout_started'
  ) {
    const existingOrder = await createPaymentService().getPaymentOrderById(existingInvoice.payment_order_id);
    const hostedCheckoutUrl = typeof existingOrder?.metadata.hostedCheckoutUrl === 'string' ? existingOrder.metadata.hostedCheckoutUrl : null;
    if (
      existingOrder &&
      existingOrder.status === 'pending' &&
      hostedCheckoutUrl &&
      isFutureTimestamp(existingOrder.metadata.hostedCheckoutExpiresAt)
    ) {
      return {
        outcome: 'immediate_payment',
        registrationId: input.registrationId,
        invoiceId: existingInvoice.id,
        checkoutUrl: hostedCheckoutUrl,
        orderToken: existingOrder.orderToken,
        totalDueMinor: existingInvoice.total_minor,
      };
    }
  }
  if (!input.staffEdit && existingInvoice?.status === 'paid' && registration.status === 'confirmed') {
    return {
      outcome: evaluation.paymentDecision.outcome,
      registrationId: input.registrationId,
      invoiceId: existingInvoice.id,
      totalDueMinor: existingInvoice.total_minor,
      deferralReasons: evaluation.paymentDecision.deferralReasons,
    } as SubmitRegistrationResult;
  }

  const reusableInvoiceId =
    existingInvoice && !['failed', 'cancelled', 'refunded'].includes(existingInvoice.status) ? existingInvoice.id : null;
  const waitlistNotifications: Array<{
    entryId: number;
    waitlistId: number;
    leagueId: number;
    entryType: 'add' | 'replace';
    replacesLeagueId: number | null;
  }> = [];
  const sabbaticalNotifications: Array<{ leagueId: number; leagueName: string; feeAmountMinor: number }> = [];
  const invoiceId = await db.transaction(async (tx) => {
    if (!registration.curler_member_id) {
      throw new RegistrationMembershipPaymentValidationError({ curler: 'The curler is required.' });
    }
    await removeExistingWaitlistsMarkedForRemoval({
      tx,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      selections: context.selections,
    });
    await removeOrphanedRegistrationWaitlistEntries({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      selections: context.selections,
    });
    await persistRegistrationWaitlists({
      tx,
      registrationId: input.registrationId,
      actorMemberId: input.actor.id,
      curlerMemberId: registration.curler_member_id,
      selections: context.selections,
      desiredAddWaitlistLeagueCount: context.desiredAddWaitlistLeagueCount ?? null,
      notifications: waitlistNotifications,
    });
    await persistWaitlistOfferPreferences({
      tx,
      registrationId: input.registrationId,
      actorMemberId: input.actor.id,
      curlerMemberId: registration.curler_member_id,
      selections: context.selections,
    });
    await persistRegistrationSabbaticals({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      context,
      feePreview: evaluation.feePreview,
      notifications: sabbaticalNotifications,
    });
    await setSubmittedSelectionStatuses(tx, input.registrationId);
    const snapshotId = await createInvoiceSnapshot({
      registrationId: input.registrationId,
      payerMemberId,
      feePreview: evaluation.feePreview,
      paymentDecision: evaluation.paymentDecision,
      tx,
      existingInvoiceId: reusableInvoiceId,
    });
    const newTotalMinor = evaluation.feePreview.totalDueMinor;
    const balanceDueMinor = input.staffEdit && priorPaidMinor > 0 ? Math.max(0, newTotalMinor - priorPaidMinor) : 0;
    const submittedStatus = input.staffEdit && priorPaidMinor > 0
      ? balanceDueMinor > 0
        ? 'awaiting_payment'
        : registration.status === 'paid'
          ? 'paid'
          : 'confirmed'
      : evaluation.paymentDecision.outcome === 'immediate_payment'
        ? 'awaiting_payment'
        : evaluation.paymentDecision.outcome === 'deferred_payment'
          ? evaluation.paymentDecision.requiresStaffReview
            ? 'awaiting_staff_review'
            : 'awaiting_placement'
          : 'confirmed';
    if (input.staffEdit && priorPaidMinor > 0) {
      await tx
        .update(schema.registrationInvoices)
        .set({
          status: balanceDueMinor > 0 ? 'awaiting_payment' : 'paid',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, snapshotId));
    }
    await tx
      .update(schema.curlingRegistrations)
      .set({
        status: submittedStatus,
        submitted_at: dbValue(registration.submitted_at ?? new Date()),
        last_fee_preview_json: dbValue(jsonStorageValue(evaluation.feePreview)),
        payment_decision_json: dbValue(jsonStorageValue(evaluation.paymentDecision)),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
    await syncRegistrationRosterPlacements({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      selections: context.selections,
      registrationStatus: submittedStatus,
    });
    return snapshotId;
  });

  if (input.staffEdit && priorPaidMinor > 0) {
    const newTotalMinor = evaluation.feePreview.totalDueMinor;
    const adjustmentMinor = newTotalMinor - priorPaidMinor;
    let paymentAdjustment: RegistrationPaymentAdjustmentResult = {
      kind: 'none',
      priorPaidMinor,
      newTotalMinor,
      adjustmentMinor,
    };
    if (adjustmentMinor < 0) {
      const refundAmountMinor = Math.abs(adjustmentMinor);
      if (existingInvoice?.payment_order_id) {
        try {
          await createPaymentService().createRefundForOrder({
            orderId: existingInvoice.payment_order_id,
            amountMinor: refundAmountMinor,
            reason: 'Registration updated by staff',
            requestedByMemberId: input.actor.id,
          });
          paymentAdjustment = { ...paymentAdjustment, kind: 'refund', refundIssued: true };
        } catch (error) {
          paymentAdjustment = {
            ...paymentAdjustment,
            kind: 'refund',
            refundIssued: false,
            refundError: error instanceof PaymentServiceError ? error.message : 'Failed to issue refund',
          };
        }
      }
    } else if (adjustmentMinor > 0) {
      try {
        const paymentService = createPaymentService();
        const order = await paymentService.createPaymentOrder({
          provider: 'stripe',
          subjectType: 'curling_registration',
          subjectId: input.registrationId,
          amountMinor: adjustmentMinor,
          currency: 'usd',
          createdByMemberId: registration.submitted_by_member_id ?? input.actor.id,
          metadata: {
            registrationId: input.registrationId,
            invoiceId,
            paymentKind: 'registration_balance',
            priorPaidMinor,
            newTotalMinor,
            seasonId: registration.season_id,
            sessionId: registration.session_id,
            curlerMemberId: registration.curler_member_id,
            submittedByMemberId: registration.submitted_by_member_id,
            adjustedByStaffMemberId: input.actor.id,
          },
        });
        const checkout = await paymentService.createHostedCheckoutForOrder({
          orderId: order.id,
          successUrl: `${frontendBaseUrl()}/registration/success?registration_id=${input.registrationId}&order_token=${order.orderToken}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontendBaseUrl()}/registration/cancel?registration_id=${input.registrationId}`,
        });
        await db
          .update(schema.registrationInvoices)
          .set({
            status: 'checkout_started',
            payment_order_id: order.id,
            stripe_checkout_session_id: checkout.providerOrderId,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.registrationInvoices.id, invoiceId));
        await db
          .update(schema.curlingRegistrations)
          .set({ status: 'payment_started', updated_at: sql`CURRENT_TIMESTAMP` })
          .where(eq(schema.curlingRegistrations.id, input.registrationId));
        paymentAdjustment = {
          ...paymentAdjustment,
          kind: 'balance_due',
          checkoutUrl: checkout.checkoutUrl,
        };
        await safeSendRegistrationEmail({
          registrationId: input.registrationId,
          messageType: 'deferred_registration_payment_link',
          payload: {
            amountDueMinor: adjustmentMinor,
            paymentUrl: checkout.checkoutUrl,
            summaryLines: registrationSummaryLines(context),
          },
        });
      } catch (error) {
        throw new RegistrationMembershipPaymentValidationError({
          payment: error instanceof PaymentServiceError ? error.message : 'Unable to create balance payment.',
        });
      }
    }
    if (input.changedSummary?.trim()) {
      const paymentImpact =
        paymentAdjustment.kind === 'refund'
          ? paymentAdjustment.refundIssued
            ? `A refund of ${(Math.abs(adjustmentMinor) / 100).toFixed(2)} USD has been issued.`
            : `A refund of ${(Math.abs(adjustmentMinor) / 100).toFixed(2)} USD is required but could not be issued automatically.`
          : paymentAdjustment.kind === 'balance_due'
            ? `An additional payment of ${(adjustmentMinor / 100).toFixed(2)} USD is now due.`
            : 'Payment amount unchanged.';
      await sendManualRegistrationUpdateEmail({
        registrationId: input.registrationId,
        changedSummary: input.changedSummary.trim(),
        paymentImpact,
      });
    }
    return {
      outcome: paymentAdjustment.kind === 'balance_due' ? 'immediate_payment' : evaluation.paymentDecision.outcome,
      registrationId: input.registrationId,
      invoiceId,
      totalDueMinor: newTotalMinor,
      deferralReasons: evaluation.paymentDecision.deferralReasons,
      checkoutUrl: paymentAdjustment.checkoutUrl ?? undefined,
      paymentAdjustment,
    };
  }

  if (input.staffEdit && input.changedSummary?.trim()) {
    await sendManualRegistrationUpdateEmail({
      registrationId: input.registrationId,
      changedSummary: input.changedSummary.trim(),
      paymentImpact: 'Payment amount unchanged.',
    });
  }

  for (const notification of waitlistNotifications) {
    const league = context.leagues[notification.leagueId];
    await sendWaitlistEntryJoinedNotifications({
      waitlistId: notification.waitlistId,
      entryId: notification.entryId,
      leagueName: league?.name ?? `League #${notification.leagueId}`,
      addedByMemberId: input.actor.id,
      addedBySource: 'registration_submission',
      registrationId: input.registrationId,
    });
  }

  for (const notification of sabbaticalNotifications) {
    if (!(await hasSentRegistrationMessage(input.registrationId, 'sabbatical_confirmation'))) {
      await safeSendRegistrationEmail({
        registrationId: input.registrationId,
        messageType: 'sabbatical_confirmation',
        payload: {
          leagueName: notification.leagueName,
          sabbaticalFeeStatus: notification.feeAmountMinor > 0 ? 'unpaid' : 'no payment required',
          summaryLines: registrationSummaryLines(context),
        },
      });
    }
  }

  if (evaluation.paymentDecision.outcome === 'immediate_payment') {
    try {
      const paymentService = createPaymentService();
      const order = await paymentService.createPaymentOrder({
        provider: 'stripe',
        subjectType: 'curling_registration',
        subjectId: input.registrationId,
        amountMinor: evaluation.feePreview.totalDueMinor,
        currency: 'usd',
        createdByMemberId: payerMemberId,
        metadata: {
          registrationId: input.registrationId,
          invoiceId,
          seasonId: registration.season_id,
          sessionId: registration.session_id,
          curlerUserId: registration.curler_member_id,
          curlerMemberId: registration.curler_member_id,
          submittedByUserId: registration.submitted_by_member_id,
          submittedByMemberId: registration.submitted_by_member_id,
        },
      });
      const checkout = await paymentService.createHostedCheckoutForOrder({
        orderId: order.id,
        successUrl: `${frontendBaseUrl()}/registration/success?registration_id=${input.registrationId}&order_token=${order.orderToken}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontendBaseUrl()}/registration/cancel?registration_id=${input.registrationId}`,
      });
      await db
        .update(schema.registrationInvoices)
        .set({
          status: 'checkout_started',
          payment_order_id: order.id,
          stripe_checkout_session_id: checkout.providerOrderId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, invoiceId));
      await db
        .update(schema.curlingRegistrations)
        .set({
          status: 'payment_started',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.curlingRegistrations.id, input.registrationId));

      for (const selection of context.selections.filter(
        (item) => item.selectionType === 'byot_request' || item.selectionType === 'play_in_request',
      )) {
        if (!selection.leagueId || await hasSentRegistrationMessage(input.registrationId, 'byot_registration_confirmation')) continue;
        await safeSendRegistrationEmail({
          registrationId: input.registrationId,
          messageType: 'byot_registration_confirmation',
          payload: {
            leagueName: context.leagues[selection.leagueId]?.name,
            teammateText: selection.byotTeammateText,
          },
        });
      }

      return {
        outcome: 'immediate_payment',
        registrationId: input.registrationId,
        invoiceId,
        checkoutUrl: checkout.checkoutUrl,
        orderToken: order.orderToken,
        totalDueMinor: evaluation.feePreview.totalDueMinor,
      };
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        throw new RegistrationMembershipPaymentValidationError({ payment: error.message });
      }
      const message = error instanceof Error ? error.message : 'Unable to start checkout.';
      throw new RegistrationMembershipPaymentValidationError({ payment: message });
    }
  }

  await safeSendRegistrationEmail({
    registrationId: input.registrationId,
    messageType: 'registration_submitted_deferred_payment',
    payload: {
      amountDueMinor: evaluation.feePreview.totalDueMinor,
      deferralReasons: evaluation.paymentDecision.deferralReasons,
      summaryLines: registrationSummaryLines(context),
    },
  });

  if (context.juniorAssistance?.requestedPercent && context.juniorAssistance.status === 'pending') {
    await safeSendRegistrationEmail({
      registrationId: input.registrationId,
      messageType: 'junior_assistance_pending',
      payload: {
        requestedAssistancePercent: context.juniorAssistance.requestedPercent,
      },
    });
  }

  for (const selection of context.selections.filter(
    (item) => item.selectionType === 'byot_request' || item.selectionType === 'play_in_request',
  )) {
    if (!selection.leagueId || await hasSentRegistrationMessage(input.registrationId, 'byot_registration_confirmation')) continue;
    await safeSendRegistrationEmail({
      registrationId: input.registrationId,
      messageType: 'byot_registration_confirmation',
      payload: {
        leagueName: context.leagues[selection.leagueId]?.name,
        teammateText: selection.byotTeammateText,
      },
    });
  }

  return {
    outcome: evaluation.paymentDecision.outcome,
    registrationId: input.registrationId,
    invoiceId,
    totalDueMinor: evaluation.feePreview.totalDueMinor,
    deferralReasons: evaluation.paymentDecision.deferralReasons,
  };
}

export async function triggerDeferredRegistrationPayment(input: {
  registrationId: number;
  actorMemberId: number;
}): Promise<SubmitRegistrationResult> {
  const registration = await loadFullRegistration(input.registrationId);
  if (!registration.curler_member_id) {
    throw new RegistrationMembershipPaymentValidationError({ curler: 'The curler is required.' });
  }
  const context = await buildRegistrationContextForDraft(input.registrationId);
  const { db, schema } = getDrizzleDb();
  const selectionRows = await db
    .select({
      selectionType: schema.registrationSelections.selection_type,
      leagueId: schema.registrationSelections.league_id,
      status: schema.registrationSelections.status,
    })
    .from(schema.registrationSelections)
    .where(eq(schema.registrationSelections.registration_id, input.registrationId));
  const placedWaitlistLeagues = new Set(
    selectionRows
      .filter(
        (selection) =>
          (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace') &&
          (selection.status === 'placed' || selection.status === 'accepted')
      )
      .map((selection) => selection.leagueId)
      .filter((leagueId): leagueId is number => leagueId !== null && leagueId !== undefined)
  );
  const paymentContext: RegistrationContext = {
    ...context,
    selections: context.selections
      .filter((selection) => {
        if (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace') {
          return selection.leagueId != null && placedWaitlistLeagues.has(selection.leagueId);
        }
        return true;
      })
      .map((selection) =>
        selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace'
          ? { ...selection, selectionType: 'guaranteed_return' as const }
          : selection
      ),
  };
  const feePreview = calculateRegistrationFees(paymentContext);
  const paymentDecision = decideRegistrationPayment({ context: paymentContext, feePreview });
  if (paymentDecision.outcome !== 'immediate_payment') {
    const existingInvoice = await loadLatestRegistrationInvoice(input.registrationId);
    const invoiceId = await createInvoiceSnapshot({
      registrationId: input.registrationId,
      payerMemberId: registration.submitted_by_member_id ?? input.actorMemberId,
      feePreview,
      paymentDecision,
      existingInvoiceId: existingInvoice?.id ?? null,
    });
    return {
      outcome: paymentDecision.outcome,
      registrationId: input.registrationId,
      invoiceId,
      totalDueMinor: feePreview.totalDueMinor,
      deferralReasons: paymentDecision.deferralReasons,
    };
  }

  const reusableInvoice = await loadLatestRegistrationInvoice(input.registrationId);
  const invoiceId = await createInvoiceSnapshot({
    registrationId: input.registrationId,
    payerMemberId: registration.submitted_by_member_id ?? input.actorMemberId,
    feePreview,
    paymentDecision,
    existingInvoiceId: reusableInvoice && !['failed', 'cancelled', 'refunded'].includes(reusableInvoice.status) ? reusableInvoice.id : null,
  });
  try {
    const paymentService = createPaymentService();
    const order = await paymentService.createPaymentOrder({
      provider: 'stripe',
      subjectType: 'curling_registration',
      subjectId: input.registrationId,
      amountMinor: feePreview.totalDueMinor,
      currency: 'usd',
      createdByMemberId: registration.submitted_by_member_id ?? input.actorMemberId,
      metadata: {
        registrationId: input.registrationId,
        invoiceId,
        seasonId: registration.season_id,
        sessionId: registration.session_id,
        curlerUserId: registration.curler_member_id,
        curlerMemberId: registration.curler_member_id,
        submittedByUserId: registration.submitted_by_member_id,
        submittedByMemberId: registration.submitted_by_member_id,
        triggeredByStaffMemberId: input.actorMemberId,
      },
    });
    const checkout = await paymentService.createHostedCheckoutForOrder({
      orderId: order.id,
      successUrl: `${frontendBaseUrl()}/registration/success?registration_id=${input.registrationId}&order_token=${order.orderToken}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendBaseUrl()}/registration/cancel?registration_id=${input.registrationId}`,
    });
    await db
      .update(schema.registrationInvoices)
      .set({
        status: 'checkout_started',
        payment_order_id: order.id,
        stripe_checkout_session_id: checkout.providerOrderId,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.registrationInvoices.id, invoiceId));
    await db
      .update(schema.curlingRegistrations)
      .set({
        status: 'payment_started',
        last_fee_preview_json: dbValue(jsonStorageValue(feePreview)),
        payment_decision_json: dbValue(jsonStorageValue(paymentDecision)),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
    await safeSendRegistrationEmail({
      registrationId: input.registrationId,
      messageType: 'deferred_registration_payment_link',
      payload: {
        amountDueMinor: feePreview.totalDueMinor,
        paymentUrl: checkout.checkoutUrl,
        summaryLines: registrationSummaryLines(paymentContext),
      },
    });
    return {
      outcome: 'immediate_payment',
      registrationId: input.registrationId,
      invoiceId,
      checkoutUrl: checkout.checkoutUrl,
      orderToken: order.orderToken,
      totalDueMinor: feePreview.totalDueMinor,
    };
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      throw new RegistrationMembershipPaymentValidationError({ payment: error.message });
    }
    throw error;
  }
}

const UNCONFIRMED_REGISTRATION_INVOICE_STATUSES = ['checkout_started', 'awaiting_payment'] as const;

export async function confirmCurlingRegistrationForPaymentOrder(orderId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      order_token: schema.paymentOrders.order_token,
      subject_type: schema.paymentOrders.subject_type,
      subject_id: schema.paymentOrders.subject_id,
      status: schema.paymentOrders.status,
      amount_minor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
      metadata: schema.paymentOrders.metadata,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, orderId))
    .limit(1);
  if (!order || order.subject_type !== 'curling_registration' || order.status !== 'succeeded') {
    return;
  }
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, order.id))
    .limit(1);
  if (!invoice) {
    throw new RegistrationMembershipPaymentValidationError({ payment: 'No registration invoice was found for this payment.' });
  }
  const registrationId = order.subject_id ?? invoice.registration_id;
  if (!registrationId) return;

  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  if (!registration || !registration.curler_member_id) return;
  if (invoice.status === 'paid') return;
  const curlerMemberId = registration.curler_member_id;
  const orderMetadata =
    typeof order.metadata === 'string'
      ? (() => {
          try {
            return JSON.parse(order.metadata) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : (order.metadata && typeof order.metadata === 'object' ? (order.metadata as Record<string, unknown>) : {});
  const isBalancePayment = orderMetadata.paymentKind === 'registration_balance';
  const priorPaidMinor =
    typeof orderMetadata.priorPaidMinor === 'number' ? orderMetadata.priorPaidMinor : 0;
  if (!isBalancePayment && (invoice.total_minor !== order.amount_minor || invoice.currency.toLowerCase() !== order.currency.toLowerCase())) {
    throw new RegistrationMembershipPaymentValidationError({ payment: 'Payment amount did not match the registration invoice.' });
  }
  if (isBalancePayment && priorPaidMinor + order.amount_minor < invoice.total_minor) {
    throw new RegistrationMembershipPaymentValidationError({ payment: 'Balance payment did not cover the updated registration total.' });
  }
  const [season] = await db
    .select()
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, registration.season_id))
    .limit(1);
  if (!season) return;

  const paidAt = new Date();
  let confirmedNow = false;
  await db.transaction(async (tx) => {
    const [updatedInvoice] = await tx
      .update(schema.registrationInvoices)
      .set({
        status: 'paid',
        paid_at: timestampColumnValue(paidAt),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(
        eq(schema.registrationInvoices.id, invoice.id),
        inArray(schema.registrationInvoices.status, [...UNCONFIRMED_REGISTRATION_INVOICE_STATUSES])
      ))
      .returning({ id: schema.registrationInvoices.id });
    if (!updatedInvoice) {
      return;
    }
    confirmedNow = true;
    await tx
      .update(schema.curlingRegistrations)
      .set({
        status: 'confirmed',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));
    await tx
      .update(schema.registrationSelections)
      .set({
        status: 'confirmed',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.registrationSelections.registration_id, registrationId),
          sql`${schema.registrationSelections.selection_type} IN ('guaranteed_return', 'byot_request', 'play_in_request', 'instructional_join', 'sabbatical', 'spare_only', 'junior_recreational')`
        )
      );
    await tx
      .update(schema.curlingSabbaticalSessions)
      .set({ payment_status: 'paid', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingSabbaticalSessions.registration_id, registration.id));

    const [existingMembership] = await tx
      .select({ id: schema.seasonMemberships.id })
      .from(schema.seasonMemberships)
      .where(eq(schema.seasonMemberships.source_registration_id, registration.id))
      .limit(1);
    if (!existingMembership && registration.membership_option !== 'none') {
      const membershipType = registration.membership_option === 'social' ? 'social' : 'regular';
      await tx.insert(schema.seasonMemberships).values({
        member_id: curlerMemberId,
        season_id: registration.season_id,
        membership_type: membershipType,
        starts_at: dateColumnValue(season.start_date),
        ends_at: dateColumnValue(season.end_date),
        source_registration_id: registration.id,
        payment_order_id: order.id,
        status: 'active',
      } as any);
    }

    const [spareOnlyLineItem] = await tx
      .select({ id: schema.registrationInvoiceLineItems.id })
      .from(schema.registrationInvoiceLineItems)
      .where(
        and(
          eq(schema.registrationInvoiceLineItems.invoice_id, invoice.id),
          eq(schema.registrationInvoiceLineItems.line_type, 'spare_only_fee')
        )
      )
      .limit(1);
    const grantsSpareOnlyIce = registration.membership_option === 'regular_spare_only' || Boolean(spareOnlyLineItem);
    if (grantsSpareOnlyIce) {
      const [existingPrivilege] = await tx
        .select({ id: schema.curlingIcePrivileges.id })
        .from(schema.curlingIcePrivileges)
        .where(eq(schema.curlingIcePrivileges.source_registration_id, registration.id))
        .limit(1);
      if (!existingPrivilege) {
        await tx.insert(schema.curlingIcePrivileges).values({
          member_id: curlerMemberId,
          season_id: registration.season_id,
          session_id: registration.session_id,
          source_type: 'spare_only',
          source_registration_id: registration.id,
          status: 'active',
        } as any);
      }
    }

    const selectionRows = await tx
      .select({
        leagueId: schema.registrationSelections.league_id,
        selectionType: schema.registrationSelections.selection_type,
      })
      .from(schema.registrationSelections)
      .where(eq(schema.registrationSelections.registration_id, registrationId));
    await syncRegistrationRosterPlacements({
      tx,
      registrationId,
      curlerMemberId,
      selections: selectionRows
        .filter((row) => row.leagueId != null)
        .map((row) => ({
          leagueId: row.leagueId,
          selectionType: row.selectionType,
        })),
      registrationStatus: 'confirmed',
    });
  });
  if (!confirmedNow) return;

  if (!(await hasSentRegistrationMessage(registrationId, 'registration_payment_received'))) {
    const emailPayload = await buildRegistrationPaymentConfirmationEmailPayload({
      registrationId,
      invoice: {
        id: invoice.id,
        subtotal_minor: invoice.subtotal_minor,
        discount_minor: invoice.discount_minor,
        total_minor: invoice.total_minor,
        paid_at: paidAt,
      },
      orderId: order.id,
      orderToken: order.order_token,
      amountPaidMinor: order.amount_minor,
    });
    await safeSendRegistrationEmail({
      registrationId,
      messageType: 'registration_payment_received',
      payload: emailPayload,
    });
  }
  if (
    registration.membership_option === 'social'
    && !(await hasSentRegistrationMessage(registrationId, 'social_membership_confirmation'))
  ) {
    await safeSendRegistrationEmail({
      registrationId,
      messageType: 'social_membership_confirmation',
      payload: {},
    });
  }
}

export async function syncCurlingRegistrationPaymentConfirmationForOrder(orderId: number): Promise<boolean> {
  const paymentService = createPaymentService();
  let order = await paymentService.getPaymentOrderById(orderId);
  if (!order || order.subjectType !== 'curling_registration') {
    return false;
  }

  if (order.status === 'pending' || order.status === 'created') {
    await paymentService.reconcilePaymentOrder(orderId, 'registration-payment-sync');
    order = await paymentService.getPaymentOrderById(orderId);
    if (!order) return false;
  }

  if (order.status !== 'succeeded') {
    return false;
  }

  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, orderId))
    .limit(1);
  if (
    !invoice
    || invoice.status === 'paid'
    || !(UNCONFIRMED_REGISTRATION_INVOICE_STATUSES as readonly string[]).includes(invoice.status)
  ) {
    return false;
  }

  await confirmCurlingRegistrationForPaymentOrder(orderId);
  return true;
}

export async function markCurlingRegistrationPaymentFailedForOrder(orderId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, orderId))
    .limit(1);
  if (!invoice) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.registrationInvoices)
      .set({ status: 'failed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.registrationInvoices.id, invoice.id));
    await tx
      .update(schema.curlingRegistrations)
      .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingRegistrations.id, invoice.registration_id));
  });
}

export async function getRegistrationPaymentStatusByOrderToken(orderToken: string): Promise<RegistrationPaymentStatusPayload> {
  const paymentService = createPaymentService();
  const order = await paymentService.getPaymentOrderByToken(orderToken);
  if (!order || order.subjectType !== 'curling_registration') {
    return {
      registrationId: null,
      paymentStatus: 'unknown',
      registrationStatus: null,
      invoiceStatus: null,
      paymentOrderStatus: null,
      totalDueMinor: null,
    };
  }
  await syncCurlingRegistrationPaymentConfirmationForOrder(order.id);
  const refreshedOrder = await paymentService.getPaymentOrderByToken(orderToken);
  if (!refreshedOrder) {
    return {
      registrationId: null,
      paymentStatus: 'unknown',
      registrationStatus: null,
      invoiceStatus: null,
      paymentOrderStatus: null,
      totalDueMinor: null,
    };
  }
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, refreshedOrder.id))
    .limit(1);
  const registrationId = refreshedOrder.subjectId ?? invoice?.registration_id ?? null;
  const [registration] = registrationId
    ? await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, registrationId)).limit(1)
    : [];
  const paymentStatus = resolveRegistrationPaymentStatus({
    invoiceStatus: invoice?.status ?? null,
    registrationStatus: registration?.status ?? null,
    paymentOrderStatus: refreshedOrder.status,
    totalDueMinor: invoice?.total_minor ?? refreshedOrder.amountMinor ?? null,
  });
  return {
    registrationId,
    paymentStatus,
    registrationStatus: registration?.status ?? null,
    invoiceStatus: invoice?.status ?? null,
    paymentOrderStatus: refreshedOrder.status,
    totalDueMinor: invoice?.total_minor ?? refreshedOrder.amountMinor ?? null,
  };
}

export async function resolveRegistrationPaymentFromCheckoutReturn(
  orderToken: string,
  sessionId: string,
): Promise<RegistrationPaymentStatusPayload> {
  const paymentService = createPaymentService();
  const order = await paymentService.getPaymentOrderByToken(orderToken);
  if (!order || order.subjectType !== 'curling_registration') {
    throw new PaymentServiceError('Registration payment order not found', 404);
  }
  await paymentService.reconcilePaymentOrderByToken(orderToken, sessionId, 'checkout-return');
  return getRegistrationPaymentStatusByOrderToken(orderToken);
}

export async function markCurlingRegistrationPaymentCancelled(registrationId: number, actor: Member): Promise<void> {
  await requireRegistrationAccess(registrationId, actor);
  const { db, schema } = getDrizzleDb();
  const registration = await loadFullRegistration(registrationId);
  const invoice = await loadLatestRegistrationInvoice(registrationId);
  if (!invoice || !shouldMarkCheckoutCancelled({ invoiceStatus: invoice.status, registrationStatus: registration.status })) {
    return;
  }
  await db
    .update(schema.registrationInvoices)
    .set({ status: 'failed', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.registrationInvoices.id, invoice.id));
  await db
    .update(schema.curlingRegistrations)
    .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}
