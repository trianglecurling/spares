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
import { createPaymentService, PaymentServiceError, buildCheckoutSuccessUrl, getDefaultPaymentProvider } from '../services/paymentService.js';
import { queueMembershipGrantSync } from '../services/mauticMembershipSyncService.js';
import { normalizeFrontendBaseUrl } from '../utils/frontendUrl.js';
import {
  booleanFromSqliteFlag,
  defaultUsaCurlingMembershipOptIn,
  defaultUswcaMembershipOptIn,
  sqliteFlagFromBoolean,
} from '../utils/parentAssociationMemberships.js';
import { paymentDetailsUrl } from '../utils/paymentDetailsUrl.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { defaultSabbaticalDurationLimitYears } from './sabbaticalDurationLimit.js';
import { effectiveExperienceYears, isJuniorRecreationalEligible } from './registrationAgeExperience.js';
import { memberExperienceBaselinesFromRow, type MemberExperienceBaselines } from './curlingExperienceYears.js';
import { effectiveLeagueRegistrationFeeMinor } from './registrationConfigValidation.js';
import { calculateRegistrationFees, type RegistrationFeeLineItem, type RegistrationFeePreview } from './registrationFeeCalculator.js';
import { decideRegistrationPayment, type RegistrationPaymentDecision } from './registrationPaymentDecision.js';
import {
  getRegistrationPaymentDeadline,
  registrationPayLaterDuePhrase,
} from './registrationPaymentDeadline.js';
import {
  type LeagueConfig,
  type LeaguePriorityInput,
  type RegistrationContext,
  type RegistrationSelectionInput,
} from './registrationContext.js';
import { evaluateLeaguePriorities, type LeaguePriorityEvaluation } from './leaguePriorityEvaluation.js';
import { formatRegistrationTeammatesDisplay, sendRegistrationEmailForDashboard, type RegistrationEmailPayload, type RegistrationMessageType, type RegistrationReceiptLineItem } from './registrationEmailService.js';
import {
  assertStaffEditableRegistration,
  isPriorityEditableRegistrationStatus,
  isStaffEditableRegistrationStatus,
} from './registrationPriorityEdit.js';
import { canViewOrEditRegistration, getEffectiveRegistrationWindow, getRegistrationById, getRegistrationShellPayload } from './registrationShellService.js';
import {
  removeOrphanedRegistrationRosterPlacements,
  rosterPlacementsForRegistration,
  syncRegistrationRosterPlacements,
} from './registrationRosterService.js';
import {
  canChooseNoMembership,
  isActiveSabbaticalRecord,
  listLeaguesRequiringPriorSessionDecision,
  sabbaticalMatchesLeagueLineage,
} from './registrationSabbaticalContinuity.js';
import {
  removeOrphanedRegistrationWaitlistEntries,
  applyRegistrationWaitlistOfferPreferences,
} from './registrationWaitlistCleanup.js';
import { getWaitlistQueuePosition, insertWaitlistAuditEvent } from './waitlistAudit.js';
import { loadExistingWaitlistEntriesForMember, waitlistEntryIncludesMember } from './waitlistMemberMembership.js';
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
  usaCurlingMembershipOptIn: boolean | null;
  uswcaMembershipOptIn: boolean | null;
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
  usa_curling_membership_opt_in?: number | null;
  uswca_membership_opt_in?: number | null;
};

export type RegistrationMembershipPaymentPayload = {
  selection: RegistrationMembershipPaymentSelection;
  icePrivilegesChoice: CurlingIcePrivilegesChoiceSqlite;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  spareOnlyIcePrivilegeFeeMinor: number;
  noMembershipEligible: boolean;
  hasLifetimeMembership: boolean;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
  paymentDeadlineAt: string | null;
  paymentDeadlineDisplay: string | null;
  payLaterAvailable: boolean;
};

type UpdateMembershipInput = {
  membershipOption: 'regular' | 'social' | 'junior_recreational' | 'none';
  basicIcePrivileges?: boolean;
  juniorAssistancePercent?: number | null;
  usaCurlingMembershipOptIn?: boolean | null;
  uswcaMembershipOptIn?: boolean | null;
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
  /** Voluntary pay later when fees are known (immediate_payment). Creates checkout and emails the link. */
  payLater?: boolean;
  /** Optional comments for the Membership Committee. Empty/whitespace clears any prior value. */
  membershipCommitteeComments?: string | null;
  staffEdit?: boolean;
  changedSummary?: string;
  frontendBaseUrl?: string;
};

const MEMBERSHIP_COMMITTEE_COMMENTS_MAX_LENGTH = 2000;

function normalizeMembershipCommitteeComments(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
      payLater?: boolean;
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
      payLater?: boolean;
      paymentAdjustment?: RegistrationPaymentAdjustmentResult;
    });

export type RegistrationPaymentStatusPayload = {
  registrationId: number | null;
  paymentStatus:
    | 'confirming'
    | 'confirmed'
    | 'failed'
    | 'deferred'
    | 'no_payment_due'
    | 'cancelled'
    | 'payment_unapplied'
    | 'unknown';
  registrationStatus: string | null;
  invoiceStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
};

function isCancelledRegistrationState(input: {
  invoiceStatus: string | null;
  registrationStatus: string | null;
}): boolean {
  return (
    input.registrationStatus === 'cancelled'
    || input.invoiceStatus === 'cancelled'
    || input.invoiceStatus === 'refunded'
  );
}

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

  if (isCancelledRegistrationState(input)) {
    if (input.paymentOrderStatus === 'succeeded' || input.paymentOrderStatus === 'partially_refunded') {
      return 'payment_unapplied';
    }
    return 'cancelled';
  }

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
    is_junior_recreational?: number;
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
    isJuniorRecreational: row.is_junior_recreational === 1,
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

function checkoutFrontendBaseUrl(override?: string): string {
  return normalizeFrontendBaseUrl(override ?? config.frontendUrl);
}

function registrationCheckoutSuccessUrl(registrationId: number, orderToken: string, frontendBaseUrl?: string): string {
  return buildCheckoutSuccessUrl(
    `${checkoutFrontendBaseUrl(frontendBaseUrl)}/registration/success?registration_id=${registrationId}&order_token=${encodeURIComponent(orderToken)}`
  );
}

function memberDisplayName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'there';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'there';
}

async function priorityTeammatesDisplayText(priority: {
  byotTeammateText?: string | null;
  teamRosterPlacements?: LeaguePriorityInput['teamRosterPlacements'];
}): Promise<string | null> {
  const { enrichTeamRosterPlacements, waitlistRosterEntries } = await import('./waitlistTeamRoster.js');
  const placements = priority.teamRosterPlacements ?? [];
  const enriched = placements.length > 0 ? await enrichTeamRosterPlacements(placements) : [];
  return formatRegistrationTeammatesDisplay({
    memberNames: enriched.map((placement) => placement.memberName),
    pendingNames: waitlistRosterEntries(priority.byotTeammateText),
    legacyRosterText: null,
  });
}

async function registrationSummaryLines(context: RegistrationContext): Promise<string[]> {
  const lines: string[] = [];
  if (context.membershipOption && context.membershipOption !== 'none') {
    lines.push(`${context.membershipOption.replace(/_/g, ' ')} membership`);
  }

  const evaluation = evaluateLeaguePriorities(context);
  const labelByLeagueId = new Map(evaluation.entries.map((entry) => [entry.leagueId, entry.label]));
  for (const priority of [...context.priorities].sort((a, b) => a.priorityRank - b.priorityRank)) {
    const league = context.leagues[priority.leagueId];
    const label = GUARANTEE_LABEL_TEXT[labelByLeagueId.get(priority.leagueId) ?? 'subject_to_availability'];
    let line = `${priority.priorityRank}. ${league?.name ?? `League ${priority.leagueId}`} — ${label}`;
    const teammates = await priorityTeammatesDisplayText(priority);
    if (teammates) {
      line += ` · Teammates: ${teammates}`;
    }
    lines.push(line);
  }

  for (const selection of context.selections) {
    const leagueName = selection.leagueId ? context.leagues[selection.leagueId]?.name : null;
    const label = SELECTION_TYPE_LABELS[selection.selectionType] ?? selection.selectionType.replace(/_/g, ' ');
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
  sabbatical: 'Sabbatical',
  drop: 'Drop league',
  junior_recreational: 'Junior recreational program',
  spare_only: 'Spare only',
};

const GUARANTEE_LABEL_TEXT: Record<string, string> = {
  guaranteed_return: 'Guaranteed return',
  awaiting_roster_entry: 'Awaiting roster entry',
  guaranteed_fallback: 'Guaranteed fallback',
  waitlisted: 'Waitlisted',
  subject_to_availability: 'Subject to availability',
  superfluous: 'Superfluous',
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

async function paymentDeadlineFieldsForSeasonSession(
  seasonId: number,
  sessionId: number,
  paymentOutcome: RegistrationPaymentDecision['outcome'],
): Promise<Pick<RegistrationMembershipPaymentPayload, 'paymentDeadlineAt' | 'paymentDeadlineDisplay' | 'payLaterAvailable'>> {
  const deadline = await getRegistrationPaymentDeadline(seasonId, sessionId);
  const paymentDeadlineAt = deadline?.paymentDeadlineAt ?? null;
  return {
    paymentDeadlineAt,
    paymentDeadlineDisplay: registrationPayLaterDuePhrase(paymentDeadlineAt),
    // Pay later is always offered when payment is due now; a configured deadline
    // only changes the due-by copy (otherwise: before leagues begin).
    payLaterAvailable: paymentOutcome === 'immediate_payment',
  };
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
  const summaryLines = await registrationSummaryLines(await buildRegistrationContextForDraft(input.registrationId));
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
  if (summaryLines.length > 0) {
    registrationDetailLines.push('League and program choices:', ...summaryLines);
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
    usaCurlingMembershipOptIn: booleanFromSqliteFlag(row.usa_curling_membership_opt_in),
    uswcaMembershipOptIn: booleanFromSqliteFlag(row.uswca_membership_opt_in),
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

  return rows.map((row) => ({
    selectionType: row.selection_type,
    leagueId: row.league_id,
    isTemporarySabbaticalFill: row.is_temporary_sabbatical_fill === 1,
  }));
}

async function loadRegistrationLeaguePriorities(registrationId: number): Promise<LeaguePriorityInput[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.registrationLeaguePriorities)
    .where(eq(schema.registrationLeaguePriorities.registration_id, registrationId))
    .orderBy(asc(schema.registrationLeaguePriorities.priority_rank), asc(schema.registrationLeaguePriorities.id));

  const { parseTeamRosterPlacements } = await import('./waitlistTeamRoster.js');
  return rows.map((row, index) => ({
    leagueId: row.league_id,
    priorityRank: index + 1,
    byotTeammateText: row.byot_teammate_text,
    teamRosterPlacements: parseTeamRosterPlacements(row.team_roster_placements),
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

/**
 * Members who hold a return right for each bring-your-own-team league: anyone on
 * the predecessor roster, plus anyone with an active sabbatical that matches the
 * league lineage. The priority page uses this to decide whether a declared team
 * earns a guaranteed return.
 */
async function loadReturnEligibleMemberIdsByLeagueId(
  leagues: Record<number, LeagueConfig>,
): Promise<Record<number, number[]>> {
  const byotLeagues = Object.values(leagues).filter(
    (league) => league.leagueType === 'bring_your_own_team' && !league.isPlayInBased && league.predecessorLeagueId != null,
  );
  if (byotLeagues.length === 0) return {};

  const { db, schema } = getDrizzleDb();
  const predecessorIds = [...new Set(byotLeagues.map((league) => league.predecessorLeagueId!))];
  const rosterRows = await db
    .select({
      memberId: schema.leagueRoster.member_id,
      leagueId: schema.leagueRoster.league_id,
    })
    .from(schema.leagueRoster)
    .where(inArray(schema.leagueRoster.league_id, predecessorIds));

  const membersByPredecessor = new Map<number, Set<number>>();
  for (const row of rosterRows) {
    const set = membersByPredecessor.get(row.leagueId) ?? new Set<number>();
    set.add(row.memberId);
    membersByPredecessor.set(row.leagueId, set);
  }

  const sabbaticalRows = await db
    .select({
      memberId: schema.curlingLeagueSabbaticals.member_id,
      originalLeagueId: schema.curlingLeagueSabbaticals.original_league_id,
      currentLeagueId: schema.curlingLeagueSabbaticals.current_league_id,
      status: schema.curlingLeagueSabbaticals.status,
    })
    .from(schema.curlingLeagueSabbaticals)
    .where(inArray(schema.curlingLeagueSabbaticals.status, ['active', 'staff_overridden', 'returning']));

  const result: Record<number, number[]> = {};
  for (const league of byotLeagues) {
    const eligible = new Set(membersByPredecessor.get(league.predecessorLeagueId!) ?? []);
    for (const sabbatical of sabbaticalRows) {
      if (
        sabbatical.currentLeagueId === league.predecessorLeagueId ||
        sabbatical.originalLeagueId === league.predecessorLeagueId ||
        sabbatical.currentLeagueId === league.id ||
        sabbatical.originalLeagueId === league.id
      ) {
        eligible.add(sabbatical.memberId);
      }
    }
    result[league.id] = [...eligible];
  }
  return result;
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
      replacementNameTagFeeMinor: price?.replacement_name_tag_fee_minor ?? 0,
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

export type RegistrationPublicMembershipFees = {
  regularMinor: number;
  socialMinor: number;
  juniorRecreationalMinor: number;
  sabbaticalMinor: number;
  replacementNameTagMinor: number;
};

export async function getPublicRegistrationMembershipFees(): Promise<RegistrationPublicMembershipFees> {
  const { priceConfig } = await loadRegistrationSettings();
  return {
    regularMinor: priceConfig.regularMembershipFeeMinor,
    socialMinor: priceConfig.socialMembershipFeeMinor,
    juniorRecreationalMinor: priceConfig.juniorRecreationalFeeMinor,
    sabbaticalMinor: priceConfig.sabbaticalFeeMinor,
    replacementNameTagMinor: priceConfig.replacementNameTagFeeMinor,
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
  desired_league_count?: number | null;
  name_tag_replacement_quantity?: number | null;
  usa_curling_membership_opt_in?: number | null;
  uswca_membership_opt_in?: number | null;
};

async function buildRegistrationContextFromSourceRow(
  registration: RegistrationMembershipPaymentSourceRow,
  options: {
    registrationId?: number;
    curlerDateOfBirth: string | null | undefined;
    curlerHasLifetimeMembership?: boolean;
    completedSessions: RegistrationContext['experience']['completedSessions'];
    experienceBaselines?: MemberExperienceBaselines;
  },
): Promise<RegistrationContext> {
  const { isEarlyAccessUnlockedInRequest } = await import('./registrationEarlyAccess.js');
  const window = await getEffectiveRegistrationWindow(registration.season_id, registration.session_id, {
    earlyAccessUnlocked: isEarlyAccessUnlockedInRequest(),
  });
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
    LeaguePriorityInput[],
    number[],
    RegistrationContext['existingSabbaticals'],
    RegistrationContext['existingWaitlistEntries'],
    RegistrationContext['juniorAssistance'] | undefined,
  ] = [{}, [], [], [], [], [], undefined];
  const [leagues, selections, priorities, activeLeagueIds, existingSabbaticals, existingWaitlistEntries, juniorAssistance] = options.registrationId
    ? await Promise.all([
        loadLeaguesForSession(registration.session_id, defaultLeagueFeeMinor),
        loadRegistrationSelections(options.registrationId),
        loadRegistrationLeaguePriorities(options.registrationId),
        memberId ? loadActiveLeagueIds(memberId, registration.session_id) : Promise.resolve([]),
        memberId ? loadExistingSabbaticals(memberId) : Promise.resolve([]),
        memberId ? loadExistingWaitlistEntriesForMember(memberId, registration.session_id) : Promise.resolve([]),
        loadJuniorAssistance(options.registrationId),
      ])
    : emptyContextState;
  const participatedLeagueIds = Array.from(
    new Set([...options.completedSessions.map((session) => session.leagueId), ...activeLeagueIds])
  );

  const returnEligibleMemberIdsByLeagueId =
    Object.keys(leagues).length > 0 ? await loadReturnEligibleMemberIdsByLeagueId(leagues) : {};

  const { loadPlayInEntryContextsForRegistration } = await import('./leagueEntryService.js');
  const playInEntry = options.registrationId
    ? await loadPlayInEntryContextsForRegistration({
        memberId,
        priorities,
        leagues,
      })
    : undefined;

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
      hasLifetimeMembership: options.curlerHasLifetimeMembership === true,
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
    returnEligibleMemberIdsByLeagueId,
    existingSabbaticals,
    existingWaitlistEntries,
    leagues,
    selections,
    priorities,
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
    playInEntry,
    sabbaticalDurationLimitYears: defaultSabbaticalDurationLimitYears(),
    desiredLeagueCount: registration.desired_league_count ?? null,
    nameTagReplacementQuantity: registration.name_tag_replacement_quantity ?? null,
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
    curlerHasLifetimeMembership: (curler?.lifetime_member ?? 0) === 1,
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
  usaCurlingMembershipOptIn?: boolean | null;
  uswcaMembershipOptIn?: boolean | null;
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
    usa_curling_membership_opt_in: sqliteFlagFromBoolean(input.usaCurlingMembershipOptIn),
    uswca_membership_opt_in: sqliteFlagFromBoolean(input.uswcaMembershipOptIn),
  };

  const context = await buildRegistrationContextFromSourceRow(synthetic, {
    curlerDateOfBirth: input.curlerDateOfBirth,
    completedSessions: [],
  });
  const evaluation = evaluateRegistrationDraft(context);
  const deadlineFields = await paymentDeadlineFieldsForSeasonSession(
    input.seasonId,
    input.sessionId,
    evaluation.paymentDecision.outcome,
  );

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(synthetic),
    icePrivilegesChoice: input.basicIcePrivileges ? 'basic_ice' : 'none',
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: effectiveExperienceYears(context),
    spareOnlyIcePrivilegeFeeMinor: context.priceConfig.spareOnlyIcePrivilegeFeeMinor,
    noMembershipEligible: false,
    hasLifetimeMembership: context.registrant.hasLifetimeMembership === true,
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
    ...deadlineFields,
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
  const deadlineFields = await paymentDeadlineFieldsForSeasonSession(
    registration.season_id,
    registration.session_id,
    evaluation.paymentDecision.outcome,
  );

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(registration),
    icePrivilegesChoice: (registration.ice_privileges_choice ?? 'none') as CurlingIcePrivilegesChoiceSqlite,
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: effectiveExperienceYears(context),
    spareOnlyIcePrivilegeFeeMinor: context.priceConfig.spareOnlyIcePrivilegeFeeMinor,
    noMembershipEligible: canChooseNoMembership(context),
    hasLifetimeMembership: context.registrant.hasLifetimeMembership === true,
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
    ...deadlineFields,
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
        registration: 'Canceled registrations cannot be edited.',
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

  let contextForNonPlaying: RegistrationContext | undefined;
  if (input.membershipOption === 'none' || input.membershipOption === 'social') {
    contextForNonPlaying = await buildRegistrationContextForDraft(registrationId);
    if (input.membershipOption === 'none' && !canChooseNoMembership(contextForNonPlaying)) {
      throw new RegistrationMembershipPaymentValidationError({
        membershipOption: 'No membership is only available when extending a sabbatical from the previous session.',
      });
    }
  }

  const membershipOption: CurlingMembershipOptionSqlite =
    input.membershipOption === 'none'
      ? 'none'
      : input.membershipOption === 'social'
        ? 'social'
        : input.membershipOption === 'junior_recreational'
          ? 'junior_recreational'
          : input.basicIcePrivileges
            ? 'regular_spare_only'
            : 'regular';
  const skipLeaguePlay =
    membershipOption === 'social' || membershipOption === 'junior_recreational' || membershipOption === 'none';
  const appliesParentAssociations =
    membershipOption === 'regular' || membershipOption === 'regular_spare_only' || membershipOption === 'social';
  const existingUsaCurlingOptIn = booleanFromSqliteFlag(registration.usa_curling_membership_opt_in);
  const existingUswcaOptIn = booleanFromSqliteFlag(registration.uswca_membership_opt_in);
  let uswcaDefaultPronouns: string | null = null;
  if (
    appliesParentAssociations &&
    input.uswcaMembershipOptIn == null &&
    existingUswcaOptIn == null &&
    registration.curler_member_id
  ) {
    const { db: pronounDb, schema: pronounSchema } = getDrizzleDb();
    const [curler] = await pronounDb
      .select({ preferred_pronouns: pronounSchema.members.preferred_pronouns })
      .from(pronounSchema.members)
      .where(eq(pronounSchema.members.id, registration.curler_member_id))
      .limit(1);
    uswcaDefaultPronouns = curler?.preferred_pronouns ?? null;
  }
  const usaCurlingMembershipOptIn = appliesParentAssociations
    ? sqliteFlagFromBoolean(
        input.usaCurlingMembershipOptIn ?? existingUsaCurlingOptIn ?? defaultUsaCurlingMembershipOptIn(),
      )
    : null;
  const uswcaMembershipOptIn = appliesParentAssociations
    ? sqliteFlagFromBoolean(
        input.uswcaMembershipOptIn ?? existingUswcaOptIn ?? defaultUswcaMembershipOptIn(uswcaDefaultPronouns),
      )
    : null;
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        membership_option: membershipOption,
        ice_privileges_choice: skipLeaguePlay ? 'none' : registration.ice_privileges_choice,
        student_discount_claimed: skipLeaguePlay ? 0 : registration.student_discount_claimed,
        student_institution: skipLeaguePlay ? null : registration.student_institution,
        reciprocal_discount_claimed: skipLeaguePlay ? 0 : registration.reciprocal_discount_claimed,
        reciprocal_club_name: skipLeaguePlay ? null : registration.reciprocal_club_name,
        experience_type: skipLeaguePlay ? null : registration.experience_type,
        experience_self_reported_years: skipLeaguePlay ? null : registration.experience_self_reported_years,
        desired_league_count:
          membershipOption === 'social' || membershipOption === 'none' ? null : registration.desired_league_count,
        basic_ice_fallback_interest:
          membershipOption === 'social' || membershipOption === 'none' ? null : registration.basic_ice_fallback_interest,
        usa_curling_membership_opt_in: usaCurlingMembershipOptIn,
        uswca_membership_opt_in: uswcaMembershipOptIn,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));

    if (membershipOption === 'social' || membershipOption === 'none') {
      await tx
        .delete(schema.registrationLeaguePriorities)
        .where(eq(schema.registrationLeaguePriorities.registration_id, registrationId));
    }

    if (
      membershipOption === 'social' &&
      contextForNonPlaying &&
      !canChooseNoMembership(contextForNonPlaying)
    ) {
      await tx
        .delete(schema.registrationSelections)
        .where(eq(schema.registrationSelections.registration_id, registrationId));
      const dropLeagues = listLeaguesRequiringPriorSessionDecision(contextForNonPlaying);
      if (dropLeagues.length > 0) {
        await tx.insert(schema.registrationSelections).values(
          dropLeagues.map((league) => ({
            registration_id: registrationId,
            league_id: league.id,
            selection_type: 'drop' as const,
            is_temporary_sabbatical_fill: 0,
            status: 'dropped' as const,
            fee_amount_minor_snapshot: 0,
            discount_amount_minor_snapshot: 0,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })),
        );
      }
    }

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
  const demographicsIncomplete =
    !curler?.firstName ||
    !curler.lastName ||
    !curler.email ||
    !curler.phone ||
    !curler.mailingAddress ||
    (!isMinor && (!curler.emergencyContactName || !curler.emergencyContactPhone));
  if (demographicsIncomplete) {
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
    context.membershipOption !== 'junior_recreational' &&
    context.membershipOption !== 'none'
  ) {
    throw new RegistrationMembershipPaymentValidationError({ membershipOption: 'Choose regular, social, or Junior Recreational membership.' });
  }
  if (context.membershipOption === 'none' && !canChooseNoMembership(context)) {
    throw new RegistrationMembershipPaymentValidationError({
      membershipOption: 'No membership is only available when extending a sabbatical from the previous session.',
    });
  }
  const details: Record<string, string> = {};
  if (registration.ice_privileges_choice === 'league_play' && context.membershipOption !== 'none') {
    if (context.priorities.length === 0) {
      details.iceLeagues = 'Add at least one league to your priority list to continue with league play.';
    }
  }
  if (evaluation.feePreview.blockingErrors.length > 0) {
    collectDecisionErrors('fees', evaluation.feePreview.blockingErrors, details);
  }
  if (evaluation.priorityValidation.blockingErrors.length > 0) {
    collectDecisionErrors('priority', evaluation.priorityValidation.blockingErrors, details);
  }
  if (Object.keys(details).length > 0) {
    throw new RegistrationMembershipPaymentValidationError(details);
  }
  if (context.membershipOption === 'social' || context.membershipOption === 'junior_recreational' || context.membershipOption === 'none') {
    return;
  }
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

/**
 * Turns every waitlisted entry on the priority list into a waitlist row,
 * carrying the rank and desired league count the offer coordinator needs to
 * decide who gets offered what.
 */
async function persistRegistrationWaitlists(input: {
  tx: any;
  registrationId: number;
  actorMemberId: number;
  curlerMemberId: number;
  context: RegistrationContext;
  evaluation: LeaguePriorityEvaluation;
  notifications?: Array<{
    entryId: number;
    waitlistId: number;
    leagueId: number;
    priorityRank: number;
  }>;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const waitlistedEntries = input.evaluation.entries.filter((entry) => entry.label === 'waitlisted');

  for (const entry of waitlistedEntries) {
    const priority = input.context.priorities.find((item) => item.leagueId === entry.leagueId);
    if (!priority) continue;

    const [league] = await input.tx
      .select({
        waitlistId: schema.leagues.waitlist_id,
        leagueType: schema.leagues.league_type,
        format: schema.leagues.format,
        sessionId: schema.leagues.session_id,
      })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, entry.leagueId))
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
    const existingParticipation = activeEntries.find((row: (typeof activeEntries)[number]) =>
      waitlistEntryIncludesMember(input.curlerMemberId, row),
    );
    // Someone else already listed this member on their team entry; that entry wins.
    if (existingParticipation && existingParticipation.member_id !== input.curlerMemberId) continue;
    const existing = existingParticipation ?? null;

    let teamRosterText = priority.byotTeammateText?.trim() || null;
    let teamRosterPlacements: string | null = null;
    if (league.leagueType === 'bring_your_own_team') {
      const { normalizeAndValidateTeamRosterPlacements, serializeTeamRosterPlacements } = await import(
        './waitlistTeamRoster.js'
      );
      const normalized = await normalizeAndValidateTeamRosterPlacements({
        league: { league_type: league.leagueType, format: league.format },
        primaryMemberId: input.curlerMemberId,
        sessionId: league.sessionId,
        placements: priority.teamRosterPlacements,
        teamRosterText,
        pendingRosterText: priority.byotTeammateText,
      });
      teamRosterText = normalized.teamRosterText;
      teamRosterPlacements = serializeTeamRosterPlacements(normalized.placements);
    }

    const nextEntry = {
      member_id: input.curlerMemberId,
      waitlist_id: league.waitlistId,
      source_registration_id: input.registrationId,
      team_roster_text: teamRosterText,
      team_roster_placements: teamRosterPlacements,
      priority_rank: priority.priorityRank,
      desired_league_count: input.evaluation.desiredLeagueCount,
      offer_response_preference: 'auto_accept' as const,
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
        priorityRank: existing.priority_rank,
        desiredLeagueCount: existing.desired_league_count,
        teamRosterText: existing.team_roster_text,
        teamRosterPlacements: existing.team_roster_placements,
        sourceRegistrationId: existing.source_registration_id,
        offerResponsePreference: existing.offer_response_preference,
        status: existing.status,
      };
      const unchanged =
        existing.priority_rank === nextEntry.priority_rank &&
        existing.desired_league_count === nextEntry.desired_league_count &&
        existing.team_roster_text === nextEntry.team_roster_text &&
        existing.team_roster_placements === nextEntry.team_roster_placements &&
        existing.source_registration_id === input.registrationId &&
        existing.offer_response_preference === nextEntry.offer_response_preference;
      if (unchanged) continue;
      action = 'staff_correction';
      await input.tx.update(schema.waitlistEntries).set(nextEntry).where(eq(schema.waitlistEntries.id, entryId));
    } else {
      const joinedAt = new Date();
      const [inserted] = await input.tx
        .insert(schema.waitlistEntries)
        .values({
          ...nextEntry,
          position_sort_key: waitlistPositionSortKey(input.registrationId, entry.leagueId),
          joined_at: dbValue(joinedAt),
        })
        .returning({ id: schema.waitlistEntries.id });
      entryId = inserted.id;
      after = { ...nextEntry, id: entryId };
      input.notifications?.push({
        entryId,
        waitlistId: league.waitlistId,
        leagueId: entry.leagueId,
        priorityRank: priority.priorityRank,
      });
    }

    const queuePosition = await getWaitlistQueuePosition(input.tx, league.waitlistId, entryId);
    await insertWaitlistAuditEvent(input.tx, {
      waitlistEntryId: entryId,
      leagueId: entry.leagueId,
      memberId: input.curlerMemberId,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      action,
      reason: existing ? 'WAITLIST_ENTRY_UPDATED_FROM_REGISTRATION' : 'WAITLIST_ENTRY_CREATED_FROM_PRIORITY_LIST',
      before: before ?? null,
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

type SabbaticalPersistenceRow = {
  id: number;
  member_id: number;
  original_league_id: number;
  current_league_id: number;
  first_sabbatical_league_id: number;
  first_sabbatical_start_date: string | Date;
  status: string;
  staff_override?: number | null;
};

function findActiveLineageSabbaticalRow(
  rows: SabbaticalPersistenceRow[],
  league: LeagueConfig,
): SabbaticalPersistenceRow | undefined {
  return rows.find(
    (row) =>
      isActiveSabbaticalRecord({
        id: row.id,
        originalLeagueId: row.original_league_id,
        currentLeagueId: row.current_league_id,
        firstSabbaticalLeagueId: row.first_sabbatical_league_id,
        firstSabbaticalStartDate: normalizeDate(row.first_sabbatical_start_date),
        status: row.status as RegistrationContext['existingSabbaticals'][number]['status'],
        staffOverride: row.staff_override === 1,
      }) &&
      sabbaticalMatchesLeagueLineage(
        { currentLeagueId: row.current_league_id, originalLeagueId: row.original_league_id },
        league,
      ),
  );
}

async function loadMemberSabbaticalRows(tx: any, memberId: number): Promise<SabbaticalPersistenceRow[]> {
  const { schema } = getDrizzleDb();
  return tx.select().from(schema.curlingLeagueSabbaticals).where(eq(schema.curlingLeagueSabbaticals.member_id, memberId));
}

async function persistSabbaticalDecisions(input: {
  tx: any;
  curlerMemberId: number;
  context: RegistrationContext;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const rows = await loadMemberSabbaticalRows(input.tx, input.curlerMemberId);

  for (const selection of input.context.selections) {
    if (!selection.leagueId || selection.selectionType !== 'drop') continue;
    const league = input.context.leagues[selection.leagueId];
    if (!league) continue;

    const lineageRow = findActiveLineageSabbaticalRow(rows, league);
    if (!lineageRow) continue;

    await input.tx
      .update(schema.curlingLeagueSabbaticals)
      .set({
        status: 'released',
        released_at: sql`CURRENT_TIMESTAMP`,
        released_reason: 'REGISTRATION_DROP',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingLeagueSabbaticals.id, lineageRow.id));
  }

  // A league back on the priority list with a guaranteed label ends the sabbatical.
  const evaluation = evaluateLeaguePriorities(input.context);
  for (const entry of evaluation.entries) {
    if (!entry.guaranteed) continue;
    const league = input.context.leagues[entry.leagueId];
    if (!league) continue;
    const lineageRow = findActiveLineageSabbaticalRow(rows, league);
    if (!lineageRow) continue;
    await input.tx
      .update(schema.curlingLeagueSabbaticals)
      .set({
        status: 'returning',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingLeagueSabbaticals.id, lineageRow.id));
  }
}

async function persistRegistrationSabbaticals(input: {
  tx: any;
  registrationId: number;
  curlerMemberId: number;
  context: RegistrationContext;
  feePreview: RegistrationFeePreview;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const memberRows = await loadMemberSabbaticalRows(input.tx, input.curlerMemberId);
  const sabbaticalSelections = input.context.selections.filter(
    (selection) => selection.selectionType === 'sabbatical' && selection.leagueId
  );
  for (const selection of sabbaticalSelections) {
    const leagueId = selection.leagueId!;
    const league = input.context.leagues[leagueId];
    if (!league) continue;
    const startDate = league.firstDayOfPlay ?? league.startDate;
    const endDate = league.lastDayOfPlay ?? league.endDate;
    const lineageRow = findActiveLineageSabbaticalRow(memberRows, league);
    let sabbaticalId = lineageRow?.id;

    if (sabbaticalId) {
      await input.tx
        .update(schema.curlingLeagueSabbaticals)
        .set({
          current_league_id: leagueId,
          source_registration_id: input.registrationId,
          status: 'active',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.curlingLeagueSabbaticals.id, sabbaticalId));
    } else {
      const [existingForRegistration] = await input.tx
        .select({ id: schema.curlingLeagueSabbaticals.id })
        .from(schema.curlingLeagueSabbaticals)
        .where(
          and(
            eq(schema.curlingLeagueSabbaticals.member_id, input.curlerMemberId),
            eq(schema.curlingLeagueSabbaticals.current_league_id, leagueId),
            eq(schema.curlingLeagueSabbaticals.source_registration_id, input.registrationId)
          )
        )
        .limit(1);
      sabbaticalId =
        existingForRegistration?.id ??
        (
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
    }
    if (!sabbaticalId) continue;

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
        sql`${schema.registrationSelections.selection_type} IN ('spare_only', 'junior_recreational', 'sabbatical')`,
        sql`${schema.registrationSelections.status} NOT IN ('dropped', 'not_placed', 'cancelled', 'declined')`,
      ),
    );
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'dropped', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        eq(schema.registrationSelections.selection_type, 'drop'),
      ),
    );
}

/** Selection statuses that must never be overwritten when confirming payment/entitlements. */
export const PRESERVED_REGISTRATION_SELECTION_STATUSES = ['dropped', 'not_placed', 'cancelled', 'declined'] as const;

export function registrationSelectionStatusIsPreserved(status: string): boolean {
  return (PRESERVED_REGISTRATION_SELECTION_STATUSES as readonly string[]).includes(status);
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
  if (input.membershipCommitteeComments !== undefined) {
    const comments = normalizeMembershipCommitteeComments(input.membershipCommitteeComments);
    if (comments && comments.length > MEMBERSHIP_COMMITTEE_COMMENTS_MAX_LENGTH) {
      throw new RegistrationMembershipPaymentValidationError({
        membershipCommitteeComments: `Comments must be ${MEMBERSHIP_COMMITTEE_COMMENTS_MAX_LENGTH} characters or fewer.`,
      });
    }
    const { db, schema } = getDrizzleDb();
    await db
      .update(schema.curlingRegistrations)
      .set({
        membership_committee_comments: comments,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
  }
  if (registration.curler_member_id) {
    const initialContext = await buildRegistrationContextForDraft(input.registrationId);
    const initialEvaluation = evaluateLeaguePriorities(initialContext);
    await removeOrphanedRegistrationWaitlistEntries({
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      waitlistedLeagueIds: initialEvaluation.entries
        .filter((entry) => entry.label === 'waitlisted')
        .map((entry) => entry.leagueId),
    });
    await removeOrphanedRegistrationRosterPlacements({
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      placements: rosterPlacementsForRegistration(initialContext, initialEvaluation),
    });
  }
  const context = await buildRegistrationContextForDraft(input.registrationId);
  const evaluation = evaluateRegistrationDraft(context);
  assertReadyToSubmit(registration, context, evaluation);

  const payLaterRequested = Boolean(input.payLater) && !input.staffEdit;
  if (payLaterRequested) {
    if (evaluation.paymentDecision.outcome !== 'immediate_payment') {
      throw new RegistrationMembershipPaymentValidationError({
        payment: 'Pay later is only available when payment is due now.',
      });
    }
  }

  const payerMemberId = registration.submitted_by_member_id ?? input.actor.id;
  const { db, schema } = getDrizzleDb();
  const existingInvoice = await loadLatestRegistrationInvoice(input.registrationId);
  const priorPaidMinor =
    input.staffEdit && existingInvoice?.status === 'paid' ? existingInvoice.total_minor : 0;
  const requiresCheckoutConfirmation =
    !input.staffEdit &&
    !payLaterRequested &&
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
    (existingInvoice.status === 'checkout_started' || existingInvoice.status === 'awaiting_payment')
  ) {
    const existingOrder = await createPaymentService().getPaymentOrderById(existingInvoice.payment_order_id);
    const hostedCheckoutUrl = typeof existingOrder?.metadata.hostedCheckoutUrl === 'string' ? existingOrder.metadata.hostedCheckoutUrl : null;
    if (
      existingOrder &&
      existingOrder.status === 'pending' &&
      hostedCheckoutUrl &&
      isFutureTimestamp(existingOrder.metadata.hostedCheckoutExpiresAt)
    ) {
      if (payLaterRequested) {
        const deadline = await getRegistrationPaymentDeadline(registration.season_id, registration.session_id);
        await safeSendRegistrationEmail({
          registrationId: input.registrationId,
          messageType: 'registration_submitted_immediate_payment',
          payload: {
            amountDueMinor: existingInvoice.total_minor,
            paymentUrl: hostedCheckoutUrl,
            deadlineText: registrationPayLaterDuePhrase(deadline?.paymentDeadlineAt),
            summaryLines: await registrationSummaryLines(context),
          },
        });
      }
      return {
        outcome: 'immediate_payment',
        registrationId: input.registrationId,
        invoiceId: existingInvoice.id,
        checkoutUrl: hostedCheckoutUrl,
        orderToken: existingOrder.orderToken,
        totalDueMinor: existingInvoice.total_minor,
        payLater: payLaterRequested || Boolean(existingOrder.metadata.payLater) || undefined,
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
    priorityRank: number;
  }> = [];
  const membershipGrantRef: { value: { memberId: number; seasonId: number } | null } = { value: null };
  const invoiceId = await db.transaction(async (tx) => {
    if (!registration.curler_member_id) {
      throw new RegistrationMembershipPaymentValidationError({ curler: 'The curler is required.' });
    }
    await applyRegistrationWaitlistOfferPreferences({
      tx,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      sessionId: context.session.id,
      priorityLeagueIds: context.priorities.map((priority) => priority.leagueId),
    });
    await removeOrphanedRegistrationWaitlistEntries({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: input.actor.id,
      waitlistedLeagueIds: evaluation.priorityEvaluation.entries
        .filter((entry) => entry.label === 'waitlisted')
        .map((entry) => entry.leagueId),
      priorityLeagueIds: context.priorities.map((priority) => priority.leagueId),
    });
    await persistRegistrationWaitlists({
      tx,
      registrationId: input.registrationId,
      actorMemberId: input.actor.id,
      curlerMemberId: registration.curler_member_id,
      context,
      evaluation: evaluation.priorityEvaluation,
      notifications: waitlistNotifications,
    });
    {
      const { syncRegistrationEntryTeams } = await import('./leagueEntryService.js');
      await syncRegistrationEntryTeams({
        tx,
        registrationId: input.registrationId,
        curlerMemberId: registration.curler_member_id,
        context,
        evaluation: evaluation.priorityEvaluation,
      });
    }
    await persistSabbaticalDecisions({
      tx,
      curlerMemberId: registration.curler_member_id,
      context,
    });
    await persistRegistrationSabbaticals({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      context,
      feePreview: evaluation.feePreview,
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
      placements: rosterPlacementsForRegistration(context, evaluation.priorityEvaluation),
      registrationStatus: submittedStatus,
    });
    if (
      context.registrant.hasLifetimeMembership === true &&
      evaluation.paymentDecision.outcome === 'no_payment_required' &&
      registration.membership_option !== 'none'
    ) {
      const [season] = await tx
        .select()
        .from(schema.curlingSeasons)
        .where(eq(schema.curlingSeasons.id, registration.season_id))
        .limit(1);
      if (season) {
        const grant = await applyConfirmedRegistrationEntitlementsInTx({
          tx,
          registrationId: input.registrationId,
          registration,
          invoiceId: snapshotId,
          curlerMemberId: registration.curler_member_id,
          season,
          paymentOrderId: null,
        });
        if (grant) {
          membershipGrantRef.value = { memberId: grant.memberId, seasonId: grant.seasonId };
        }
      }
    }
    return snapshotId;
  });

  if (membershipGrantRef.value) {
    queueMembershipGrantSync(membershipGrantRef.value.memberId, membershipGrantRef.value.seasonId);
  }

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
          provider: getDefaultPaymentProvider(),
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
          successUrl: registrationCheckoutSuccessUrl(input.registrationId, order.orderToken, input.frontendBaseUrl),
          cancelUrl: `${checkoutFrontendBaseUrl(input.frontendBaseUrl)}/registration/cancel?registration_id=${input.registrationId}`,
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
            summaryLines: await registrationSummaryLines(context),
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

  if (evaluation.paymentDecision.outcome === 'immediate_payment') {
    try {
      const paymentService = createPaymentService();
      const order = await paymentService.createPaymentOrder({
        provider: getDefaultPaymentProvider(),
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
          payLater: payLaterRequested || undefined,
        },
      });
      const checkout = await paymentService.createHostedCheckoutForOrder({
        orderId: order.id,
        successUrl: registrationCheckoutSuccessUrl(input.registrationId, order.orderToken, input.frontendBaseUrl),
        cancelUrl: `${checkoutFrontendBaseUrl(input.frontendBaseUrl)}/registration/cancel?registration_id=${input.registrationId}`,
      });
      // Pay later creates a hosted checkout link for email, but the registrant did not enter checkout.
      // Keep awaiting_payment so dashboard status is accurate.
      const invoiceStatus = payLaterRequested ? 'awaiting_payment' : 'checkout_started';
      const registrationStatus = payLaterRequested ? 'awaiting_payment' : 'payment_started';
      await db
        .update(schema.registrationInvoices)
        .set({
          status: invoiceStatus,
          payment_order_id: order.id,
          stripe_checkout_session_id: checkout.providerOrderId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, invoiceId));
      await db
        .update(schema.curlingRegistrations)
        .set({
          status: registrationStatus,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.curlingRegistrations.id, input.registrationId));

      if (payLaterRequested) {
        const deadline = await getRegistrationPaymentDeadline(registration.season_id, registration.session_id);
        await safeSendRegistrationEmail({
          registrationId: input.registrationId,
          messageType: 'registration_submitted_immediate_payment',
          payload: {
            amountDueMinor: evaluation.feePreview.totalDueMinor,
            paymentUrl: checkout.checkoutUrl,
            deadlineText: registrationPayLaterDuePhrase(deadline?.paymentDeadlineAt),
            summaryLines: await registrationSummaryLines(context),
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
        payLater: payLaterRequested || undefined,
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
      summaryLines: await registrationSummaryLines(context),
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
  frontendBaseUrl?: string;
}): Promise<SubmitRegistrationResult> {
  const registration = await loadFullRegistration(input.registrationId);
  if (!registration.curler_member_id) {
    throw new RegistrationMembershipPaymentValidationError({ curler: 'The curler is required.' });
  }
  const paymentContext = await buildRegistrationContextForDraft(input.registrationId);
  const { db, schema } = getDrizzleDb();
  // Placement is settled, so bill for the leagues the registrant actually holds
  // rather than the guarantees their priority list promised.
  const placedRows = await db
    .select({ leagueId: schema.leagueRoster.league_id })
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.member_id, registration.curler_member_id),
        eq(schema.leagueRoster.source_registration_id, input.registrationId),
        eq(schema.leagueRoster.status, 'active'),
      ),
    );
  const placedLeagueIds = [...new Set(placedRows.map((row) => row.leagueId))];
  const feePreview = calculateRegistrationFees(paymentContext, { chargedLeagueIds: placedLeagueIds });
  const paymentDecision = decideRegistrationPayment({
    context: paymentContext,
    feePreview,
    placementSettled: true,
  });
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
      provider: getDefaultPaymentProvider(),
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
      successUrl: registrationCheckoutSuccessUrl(input.registrationId, order.orderToken, input.frontendBaseUrl),
      cancelUrl: `${checkoutFrontendBaseUrl(input.frontendBaseUrl)}/registration/cancel?registration_id=${input.registrationId}`,
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
        summaryLines: await registrationSummaryLines(paymentContext),
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

async function applyConfirmedRegistrationEntitlementsInTx(input: {
  tx: any;
  registrationId: number;
  registration: {
    id: number;
    season_id: number;
    session_id: number;
    membership_option: CurlingMembershipOptionSqlite | string;
  };
  invoiceId: number;
  curlerMemberId: number;
  season: { start_date: string | Date; end_date: string | Date };
  paymentOrderId?: number | null;
}): Promise<{ membershipGranted: boolean; memberId: number; seasonId: number } | null> {
  const { schema } = getDrizzleDb();
  let membershipGranted = false;

  await input.tx
    .update(schema.curlingSabbaticalSessions)
    .set({ payment_status: 'paid', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.curlingSabbaticalSessions.registration_id, input.registration.id));

  const [existingMembership] = await input.tx
    .select({ id: schema.seasonMemberships.id })
    .from(schema.seasonMemberships)
    .where(eq(schema.seasonMemberships.source_registration_id, input.registration.id))
    .limit(1);
  if (!existingMembership && input.registration.membership_option !== 'none') {
    const membershipType =
      input.registration.membership_option === 'social'
        ? 'social'
        : input.registration.membership_option === 'junior_recreational'
          ? 'junior_recreational'
          : 'regular';
    await input.tx.insert(schema.seasonMemberships).values({
      member_id: input.curlerMemberId,
      season_id: input.registration.season_id,
      membership_type: membershipType,
      starts_at: dateColumnValue(input.season.start_date),
      ends_at: dateColumnValue(input.season.end_date),
      source_registration_id: input.registration.id,
      payment_order_id: input.paymentOrderId ?? null,
      status: 'active',
    } as any);
    membershipGranted = true;
  }

  const [spareOnlyLineItem] = await input.tx
    .select({ id: schema.registrationInvoiceLineItems.id })
    .from(schema.registrationInvoiceLineItems)
    .where(
      and(
        eq(schema.registrationInvoiceLineItems.invoice_id, input.invoiceId),
        eq(schema.registrationInvoiceLineItems.line_type, 'spare_only_fee')
      )
    )
    .limit(1);
  const grantsSpareOnlyIce =
    input.registration.membership_option === 'regular_spare_only' || Boolean(spareOnlyLineItem);
  if (grantsSpareOnlyIce) {
    const [existingPrivilege] = await input.tx
      .select({ id: schema.curlingIcePrivileges.id })
      .from(schema.curlingIcePrivileges)
      .where(eq(schema.curlingIcePrivileges.source_registration_id, input.registration.id))
      .limit(1);
    if (!existingPrivilege) {
      await input.tx.insert(schema.curlingIcePrivileges).values({
        member_id: input.curlerMemberId,
        season_id: input.registration.season_id,
        session_id: input.registration.session_id,
        source_type: 'spare_only',
        source_registration_id: input.registration.id,
        status: 'active',
      } as any);
    }
  }

  const entitlementContext = await buildRegistrationContextForDraft(input.registrationId);
  await syncRegistrationRosterPlacements({
    tx: input.tx,
    registrationId: input.registrationId,
    curlerMemberId: input.curlerMemberId,
    placements: rosterPlacementsForRegistration(entitlementContext, evaluateLeaguePriorities(entitlementContext)),
    registrationStatus: 'confirmed',
  });

  if (!membershipGranted) return null;
  return {
    membershipGranted: true,
    memberId: input.curlerMemberId,
    seasonId: input.registration.season_id,
  };
}

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
  const membershipGrantRef: { value: { memberId: number; seasonId: number } | null } = { value: null };
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
          sql`${schema.registrationSelections.selection_type} IN ('guaranteed_return', 'byot_request', 'play_in_request', 'instructional_join', 'sabbatical', 'spare_only', 'junior_recreational')`,
          // Preserve REPLACE releases and other terminal outcomes — never re-confirm unpaid leagues.
          sql`${schema.registrationSelections.status} NOT IN ('dropped', 'not_placed', 'cancelled', 'declined')`,
        )
      );
    const grant = await applyConfirmedRegistrationEntitlementsInTx({
      tx,
      registrationId,
      registration,
      invoiceId: invoice.id,
      curlerMemberId,
      season,
      paymentOrderId: order.id,
    });
    if (grant) {
      membershipGrantRef.value = { memberId: grant.memberId, seasonId: grant.seasonId };
    }
  });
  if (!confirmedNow) return;

  if (membershipGrantRef.value) {
    queueMembershipGrantSync(membershipGrantRef.value.memberId, membershipGrantRef.value.seasonId);
  }

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
  sessionId: string | null = null,
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
