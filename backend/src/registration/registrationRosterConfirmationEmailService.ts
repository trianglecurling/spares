import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import {
  loadRegistrationPaymentItemNameMap,
  resolveRegistrationCheckoutItemDescription,
  type RegistrationPaymentItemLineType,
} from '../services/registrationPaymentItemNamesService.js';
import {
  curlingRegistrationCheckoutLineItems,
  remainingDueMinor,
  type CurlingCheckoutLine,
} from './registrationBillingMath.js';
import { listStaffRegistrationBilling } from './registrationBillingService.js';
import { renderRegistrationEmail, sendRegistrationEmailForDashboard, type RegistrationEmailPayload } from './registrationEmailService.js';
import { isLeagueProcessingActive, LEAGUE_PROCESSING_HOLD_REASON } from './registrationLeagueProcessing.js';
import { triggerDeferredRegistrationPayment } from './registrationMembershipPaymentService.js';
import { formatRegistrationPaymentDeadlineDate, getRegistrationPaymentDeadline } from './registrationPaymentDeadline.js';
import { registrationParentCopyEmail } from '../utils/memberParentEmail.js';
import { buildAuthzClaimsForMember } from '../utils/rbac.js';

export class RosterConfirmationEmailValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super(Object.values(details)[0] || 'Roster confirmation email operation failed');
  }
}

export type RosterConfirmationSkipReason = 'no_email' | 'no_registration';

export type RosterConfirmationLeague = {
  leagueId: number;
  leagueName: string;
  isTemporarySabbaticalFill: boolean;
};

export type RosterConfirmationRecipient = {
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  parentEmail: string | null;
  registrationId: number | null;
  leagues: RosterConfirmationLeague[];
  owedLines: Array<{ description: string; amountMinor: number }>;
  owedDiscountLines: Array<{ description: string; amountMinor: number }>;
  owedSubtotalMinor: number;
  owedDiscountMinor: number;
  owedMinor: number;
  paidMinor: number;
  balanceMinor: number;
  checkoutLines: CurlingCheckoutLine[];
  alreadySent: boolean;
  sentAt: string | null;
  skipReason: RosterConfirmationSkipReason | null;
  canSend: boolean;
};

export type RosterConfirmationEmailJobStatus = 'running' | 'completed' | 'failed';

export type RosterConfirmationEmailJobSnapshot = {
  id: number;
  sessionId: number;
  status: RosterConfirmationEmailJobStatus;
  total: number;
  completed: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: Array<{ memberId: number; memberName: string; error: string }>;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type RosterConfirmationAutomaticSabbatical = {
  sabbaticalLeagueName: string;
  temporaryFillLeagueNames: string[];
};

export type RosterConfirmationListResult = {
  sessionId: number;
  sessionName: string;
  seasonName: string;
  leagueProcessingActive: boolean;
  recipients: RosterConfirmationRecipient[];
  sendJob: RosterConfirmationEmailJobSnapshot | null;
};

type LoadedRosterConfirmation = Omit<RosterConfirmationListResult, 'sendJob'> & {
  automaticSabbaticalsByMemberId: Map<number, RosterConfirmationAutomaticSabbatical[]>;
  deadlineText: string;
};

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

function memberDisplayName(row: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const parts = [row.firstName, row.lastName].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
}

function assertAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RosterConfirmationEmailValidationError({
      registration: 'You do not have permission to manage registrations.',
    });
  }
}

type RosterConfirmationFeeLine = {
  description: string;
  amountMinor: number;
  lineType?: string;
};

export function rosterConfirmationInvoiceLines(input: {
  owedLines: Array<RosterConfirmationFeeLine>;
  owedDiscountLines: Array<RosterConfirmationFeeLine>;
}): Array<{ description: string; amountMinor: number }> {
  return [...input.owedLines, ...input.owedDiscountLines]
    .filter((line) => line.amountMinor !== 0)
    .map((line) => ({ description: line.description, amountMinor: line.amountMinor }));
}

function squareCheckoutInvoiceLines(
  input: {
    owedLines: Array<RosterConfirmationFeeLine>;
    owedDiscountLines: Array<RosterConfirmationFeeLine>;
  },
  configuredNames: Map<RegistrationPaymentItemLineType, string | null>,
): Array<{ description: string; amountMinor: number }> {
  return [...input.owedLines, ...input.owedDiscountLines]
    .filter((line) => line.amountMinor !== 0)
    .map((line) => ({
      description: resolveRegistrationCheckoutItemDescription({
        lineType: line.lineType ?? '',
        invoiceDescription: line.description,
        configuredNames,
      }),
      amountMinor: line.amountMinor,
    }));
}

/** Prefer a paid registration over a later unpaid duplicate for the same member. */
export function pickRosterConfirmationBilling<T extends { registrationId: number; paidMinor: number }>(
  candidates: T[],
  rosterRegistrationIds: number[],
): T | null {
  if (candidates.length === 0) return null;
  const rosterSet = new Set(rosterRegistrationIds);
  return [...candidates].sort((left, right) => {
    if (left.paidMinor !== right.paidMinor) return right.paidMinor - left.paidMinor;
    const leftOnRoster = rosterSet.has(left.registrationId) ? 1 : 0;
    const rightOnRoster = rosterSet.has(right.registrationId) ? 1 : 0;
    if (leftOnRoster !== rightOnRoster) return rightOnRoster - leftOnRoster;
    return right.registrationId - left.registrationId;
  })[0];
}

export function rosterConfirmationSendSideEffects(balanceMinor: number): {
  createPaymentLink: boolean;
  issueRefund: boolean;
} {
  return {
    createPaymentLink: balanceMinor > 0,
    issueRefund: false,
  };
}

export function rosterConfirmationCheckoutLines(input: {
  owedLines: Array<RosterConfirmationFeeLine>;
  owedDiscountLines: Array<RosterConfirmationFeeLine>;
  owedMinor: number;
  paidMinor: number;
  configuredNames?: Map<RegistrationPaymentItemLineType, string | null>;
}): CurlingCheckoutLine[] {
  const remainingMinor = remainingDueMinor(input.owedMinor, input.paidMinor);
  if (remainingMinor <= 0) return [];
  return (
    curlingRegistrationCheckoutLineItems({
      invoiceLines: squareCheckoutInvoiceLines(input, input.configuredNames ?? new Map()),
      orderAmountMinor: remainingMinor,
      priorPaidMinor: input.paidMinor,
      allowBalanceFallback: true,
    }) ?? []
  );
}

export function matchAutomaticSabbaticals(input: {
  sabbaticals: Array<{ leagueId: number; leagueName: string }>;
  playPriorityLeagueIds: number[];
  temporaryFillLeagues: Array<{ leagueName: string }>;
}): RosterConfirmationAutomaticSabbatical[] {
  const playPriorityLeagueIds = new Set(input.playPriorityLeagueIds);
  const temporaryFillLeagueNames = [
    ...new Set(input.temporaryFillLeagues.map((league) => league.leagueName.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
  if (temporaryFillLeagueNames.length === 0) return [];
  return input.sabbaticals
    .filter((sabbatical) => playPriorityLeagueIds.has(sabbatical.leagueId))
    .map((sabbatical) => ({
      sabbaticalLeagueName: sabbatical.leagueName,
      temporaryFillLeagueNames,
    }))
    .sort((left, right) => left.sabbaticalLeagueName.localeCompare(right.sabbaticalLeagueName));
}

export function buildRosterConfirmationEmailPayload(input: {
  memberName: string;
  seasonName: string;
  sessionName: string;
  leagues: Array<{ leagueName: string; isTemporarySabbaticalFill: boolean }>;
  owedLines: Array<{ description: string; amountMinor: number }>;
  owedDiscountLines: Array<{ description: string; amountMinor: number }>;
  owedSubtotalMinor: number;
  owedDiscountMinor: number;
  owedMinor: number;
  paidMinor: number;
  balanceMinor: number;
  paymentUrl?: string | null;
  paymentLinkPending?: boolean;
  dashboardUrl?: string | null;
  automaticSabbaticals?: RosterConfirmationAutomaticSabbatical[];
  deadlineText?: string | null;
}): RegistrationEmailPayload {
  return {
    curlerName: input.memberName,
    seasonName: input.seasonName,
    sessionName: input.sessionName,
    rosterLeagues: input.leagues,
    receiptLineItems: rosterConfirmationInvoiceLines(input),
    receiptSubtotalMinor: input.owedSubtotalMinor,
    receiptDiscountMinor: input.owedDiscountMinor,
    amountPaidMinor: input.paidMinor,
    amountDueMinor: remainingDueMinor(input.owedMinor, input.paidMinor),
    billingBalanceMinor: input.balanceMinor,
    paymentUrl: input.paymentUrl ?? null,
    paymentLinkPending: input.paymentLinkPending === true,
    dashboardUrl: input.dashboardUrl ?? null,
    automaticSabbaticals: input.automaticSabbaticals ?? [],
    deadlineText: input.deadlineText ?? null,
  };
}

function skipReasonFor(email: string | null, registrationId: number | null): RosterConfirmationSkipReason | null {
  if (!email?.trim()) return 'no_email';
  if (registrationId == null) return 'no_registration';
  return null;
}

async function loadAutomaticSabbaticals(input: {
  sessionId: number;
  recipients: RosterConfirmationRecipient[];
}): Promise<Map<number, RosterConfirmationAutomaticSabbatical[]>> {
  const result = new Map<number, RosterConfirmationAutomaticSabbatical[]>();
  const memberIds = [...new Set(input.recipients.map((row) => row.memberId))];
  const registrationIds = [
    ...new Set(input.recipients.map((row) => row.registrationId).filter((id): id is number => id != null)),
  ];
  if (memberIds.length === 0 || registrationIds.length === 0) return result;

  const { db, schema } = getDrizzleDb();
  const [sabbaticalRows, priorityRows] = await Promise.all([
    db
      .select({
        memberId: schema.curlingLeagueSabbaticals.member_id,
        leagueId: schema.curlingLeagueSabbaticals.current_league_id,
        leagueName: schema.leagues.name,
      })
      .from(schema.curlingLeagueSabbaticals)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.curlingLeagueSabbaticals.current_league_id))
      .where(
        and(
          eq(schema.curlingLeagueSabbaticals.status, 'active'),
          eq(schema.leagues.session_id, input.sessionId),
          inArray(schema.curlingLeagueSabbaticals.member_id, memberIds),
        ),
      ),
    db
      .select({
        registrationId: schema.registrationLeaguePriorities.registration_id,
        leagueId: schema.registrationLeaguePriorities.league_id,
      })
      .from(schema.registrationLeaguePriorities)
      .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds)),
  ]);

  const prioritiesByRegistration = new Map<number, number[]>();
  for (const row of priorityRows) {
    const list = prioritiesByRegistration.get(row.registrationId) ?? [];
    list.push(row.leagueId);
    prioritiesByRegistration.set(row.registrationId, list);
  }
  const sabbaticalsByMember = new Map<number, Array<{ leagueId: number; leagueName: string }>>();
  for (const row of sabbaticalRows) {
    const list = sabbaticalsByMember.get(row.memberId) ?? [];
    list.push({ leagueId: row.leagueId, leagueName: row.leagueName });
    sabbaticalsByMember.set(row.memberId, list);
  }

  for (const recipient of input.recipients) {
    if (recipient.registrationId == null) continue;
    const matched = matchAutomaticSabbaticals({
      sabbaticals: sabbaticalsByMember.get(recipient.memberId) ?? [],
      playPriorityLeagueIds: prioritiesByRegistration.get(recipient.registrationId) ?? [],
      temporaryFillLeagues: recipient.leagues.filter((league) => league.isTemporarySabbaticalFill),
    });
    if (matched.length > 0) result.set(recipient.memberId, matched);
  }
  return result;
}

async function loadRosterConfirmationRecipients(input: {
  actor: Member;
  sessionId: number;
  memberId?: number;
}): Promise<LoadedRosterConfirmation> {
  assertAccess(input.actor);
  const { db, schema } = getDrizzleDb();
  const [session, rosterRows] = await Promise.all([
    db
      .select({
        id: schema.curlingSessions.id,
        name: schema.curlingSessions.name,
        seasonId: schema.curlingSessions.season_id,
        seasonName: schema.curlingSeasons.name,
      })
      .from(schema.curlingSessions)
      .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
      .where(eq(schema.curlingSessions.id, input.sessionId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        memberId: schema.leagueRoster.member_id,
        leagueId: schema.leagueRoster.league_id,
        leagueName: schema.leagues.name,
        registrationId: schema.leagueRoster.source_registration_id,
        isTemporarySabbaticalFill: schema.leagueRoster.is_temporary_sabbatical_fill,
        memberName: schema.members.name,
        firstName: schema.members.first_name,
        lastName: schema.members.last_name,
        email: schema.members.email,
        dateOfBirth: schema.members.date_of_birth,
        guardianEmail: schema.members.guardian_email,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueRoster.league_id))
      .innerJoin(schema.members, eq(schema.members.id, schema.leagueRoster.member_id))
      .where(
        and(
          eq(schema.leagues.session_id, input.sessionId),
          eq(schema.leagueRoster.status, 'active'),
          input.memberId != null ? eq(schema.leagueRoster.member_id, input.memberId) : undefined,
        ),
      ),
  ]);
  if (!session) {
    throw new RosterConfirmationEmailValidationError({ sessionId: 'Session was not found.' });
  }

  const rosterMemberIds = [...new Set(rosterRows.map((row) => row.memberId))];
  const [billing, configuredNames] = await Promise.all([
    listStaffRegistrationBilling({
      actor: input.actor,
      sessionId: input.sessionId,
      curlerMemberIds: rosterMemberIds,
    }),
    loadRegistrationPaymentItemNameMap(),
  ]);

  type Draft = {
    memberId: number;
    memberName: string;
    memberEmail: string | null;
    dateOfBirth: unknown;
    guardianEmail: string | null;
    registrationIds: number[];
    leagues: Map<number, RosterConfirmationLeague>;
  };
  const drafts = new Map<number, Draft>();
  for (const row of rosterRows) {
    const existing = drafts.get(row.memberId) ?? {
      memberId: row.memberId,
      memberName: memberDisplayName(row),
      memberEmail: row.email?.trim() || null,
      dateOfBirth: row.dateOfBirth ?? null,
      guardianEmail: row.guardianEmail?.trim() || null,
      registrationIds: [],
      leagues: new Map<number, RosterConfirmationLeague>(),
    };
    if (row.registrationId != null && !existing.registrationIds.includes(row.registrationId)) {
      existing.registrationIds.push(row.registrationId);
    }
    const prior = existing.leagues.get(row.leagueId);
    existing.leagues.set(row.leagueId, {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      isTemporarySabbaticalFill: prior?.isTemporarySabbaticalFill === true || row.isTemporarySabbaticalFill === 1,
    });
    drafts.set(row.memberId, existing);
  }

  const billingCandidatesByMember = new Map<number, Array<(typeof billing.registrations)[number]>>();
  for (const row of billing.registrations) {
    if (row.curlerId == null) continue;
    const list = billingCandidatesByMember.get(row.curlerId) ?? [];
    list.push(row);
    billingCandidatesByMember.set(row.curlerId, list);
  }

  const registrationIdsForGuardians = [
    ...new Set(
      [...drafts.values()].flatMap((draft) => [
        ...draft.registrationIds,
        pickRosterConfirmationBilling(billingCandidatesByMember.get(draft.memberId) ?? [], draft.registrationIds)
          ?.registrationId ?? null,
      ]).filter((id): id is number => id != null),
    ),
  ];
  const registrationGuardianById = new Map<number, string | null>();
  if (registrationIdsForGuardians.length > 0) {
    const guardianRows = await db
      .select({
        id: schema.curlingRegistrations.id,
        guardianEmail: schema.curlingRegistrations.guardian_email,
      })
      .from(schema.curlingRegistrations)
      .where(inArray(schema.curlingRegistrations.id, registrationIdsForGuardians));
    for (const row of guardianRows) {
      registrationGuardianById.set(row.id, row.guardianEmail?.trim() || null);
    }
  }

  const recipients: RosterConfirmationRecipient[] = [...drafts.values()]
    .map((draft) => {
      const billingRow = pickRosterConfirmationBilling(
        billingCandidatesByMember.get(draft.memberId) ?? [],
        draft.registrationIds,
      );
      const preferredRegistrationId =
        draft.registrationIds.length > 0 ? Math.max(...draft.registrationIds) : billingRow?.registrationId ?? null;
      const registrationId = billingRow?.registrationId ?? preferredRegistrationId;
      const skipReason = skipReasonFor(draft.memberEmail, registrationId);
      const owedLines = billingRow?.owedLines ?? [];
      const owedDiscountLines = billingRow?.owedDiscountLines ?? [];
      const owedMinor = billingRow?.owedMinor ?? 0;
      const paidMinor = billingRow?.paidMinor ?? 0;
      return {
        memberId: draft.memberId,
        memberName: draft.memberName,
        memberEmail: draft.memberEmail,
        parentEmail: registrationParentCopyEmail({
          memberEmail: draft.memberEmail,
          dateOfBirth: draft.dateOfBirth,
          memberGuardianEmail: draft.guardianEmail,
          registrationGuardianEmail: registrationId != null ? registrationGuardianById.get(registrationId) ?? null : null,
        }),
        registrationId,
        leagues: [...draft.leagues.values()].sort((left, right) => left.leagueName.localeCompare(right.leagueName)),
        owedLines: owedLines.map((line) => ({ description: line.description, amountMinor: line.amountMinor })),
        owedDiscountLines: owedDiscountLines.map((line) => ({
          description: line.description,
          amountMinor: line.amountMinor,
        })),
        owedSubtotalMinor: billingRow?.owedSubtotalMinor ?? 0,
        owedDiscountMinor: billingRow?.owedDiscountMinor ?? 0,
        owedMinor,
        paidMinor,
        balanceMinor: billingRow?.balanceMinor ?? 0,
        checkoutLines: rosterConfirmationCheckoutLines({
          owedLines,
          owedDiscountLines,
          owedMinor,
          paidMinor,
          configuredNames,
        }),
        alreadySent: false,
        sentAt: null,
        skipReason,
        canSend: skipReason == null,
      };
    })
    .sort((left, right) => left.memberName.localeCompare(right.memberName) || left.memberId - right.memberId);

  const registrationIds = [...new Set(recipients.map((row) => row.registrationId).filter((id): id is number => id != null))];
  const memberIds = recipients.map((row) => row.memberId);
  if (memberIds.length > 0) {
    const sentFilters = [inArray(schema.registrationOutboundMessages.recipient_member_id, memberIds)];
    if (registrationIds.length > 0) {
      sentFilters.push(inArray(schema.registrationOutboundMessages.registration_id, registrationIds));
    }
    const sentRows = await db
      .select({
        memberId: schema.registrationOutboundMessages.recipient_member_id,
        registrationId: schema.registrationOutboundMessages.registration_id,
        sentAt: schema.registrationOutboundMessages.sent_at,
      })
      .from(schema.registrationOutboundMessages)
      .where(
        and(
          eq(schema.registrationOutboundMessages.message_type, 'roster_confirmation'),
          eq(schema.registrationOutboundMessages.delivery_status, 'sent'),
          or(...sentFilters),
        ),
      );
    const sentByMember = new Map<number, string>();
    const sentByRegistration = new Map<number, string>();
    for (const row of sentRows) {
      const stamp = row.sentAt instanceof Date ? row.sentAt.toISOString() : row.sentAt ? String(row.sentAt) : '';
      if (row.memberId != null && !sentByMember.has(row.memberId)) sentByMember.set(row.memberId, stamp);
      if (row.registrationId != null && !sentByRegistration.has(row.registrationId)) {
        sentByRegistration.set(row.registrationId, stamp);
      }
    }
    for (const recipient of recipients) {
      const sentAt = sentByMember.get(recipient.memberId) ?? (recipient.registrationId != null ? sentByRegistration.get(recipient.registrationId) : undefined);
      if (sentAt != null) {
        recipient.alreadySent = true;
        recipient.sentAt = sentAt || null;
      }
    }
  }

  const deadline = await getRegistrationPaymentDeadline(session.seasonId, session.id);
  return {
    sessionId: session.id,
    sessionName: session.name,
    seasonName: session.seasonName ?? '',
    leagueProcessingActive: billing.leagueProcessingActive,
    recipients,
    automaticSabbaticalsByMemberId: await loadAutomaticSabbaticals({
      sessionId: session.id,
      recipients,
    }),
    deadlineText: formatRegistrationPaymentDeadlineDate(deadline?.paymentDeadlineAt) ?? '',
  };
}

async function dashboardUrlFor(registrationId: number | null, memberId: number): Promise<string | null> {
  if (registrationId == null) return `${frontendBaseUrl()}/dashboard`;
  const { resolveRegistrationViewPath } = await import('./registrationMemberService.js');
  const path = await resolveRegistrationViewPath(registrationId, memberId);
  return `${frontendBaseUrl()}${path}`;
}

function payloadForRecipient(
  list: LoadedRosterConfirmation,
  recipient: RosterConfirmationRecipient,
  options: { paymentUrl?: string | null; paymentLinkPending?: boolean; dashboardUrl?: string | null },
): RegistrationEmailPayload {
  return buildRosterConfirmationEmailPayload({
    memberName: recipient.memberName,
    seasonName: list.seasonName,
    sessionName: list.sessionName,
    leagues: recipient.leagues,
    owedLines: recipient.owedLines,
    owedDiscountLines: recipient.owedDiscountLines,
    owedSubtotalMinor: recipient.owedSubtotalMinor,
    owedDiscountMinor: recipient.owedDiscountMinor,
    owedMinor: recipient.owedMinor,
    paidMinor: recipient.paidMinor,
    balanceMinor: recipient.balanceMinor,
    paymentUrl: options.paymentUrl,
    paymentLinkPending: options.paymentLinkPending,
    dashboardUrl: options.dashboardUrl,
    automaticSabbaticals: list.automaticSabbaticalsByMemberId.get(recipient.memberId) ?? [],
    deadlineText: recipient.balanceMinor > 0 && list.deadlineText ? list.deadlineText : null,
  });
}

export async function listRosterConfirmationEmails(input: {
  actor: Member;
  sessionId: number;
}): Promise<RosterConfirmationListResult> {
  const loaded = await loadRosterConfirmationRecipients(input);
  return {
    sessionId: loaded.sessionId,
    sessionName: loaded.sessionName,
    seasonName: loaded.seasonName,
    leagueProcessingActive: loaded.leagueProcessingActive,
    recipients: loaded.recipients,
    sendJob: await getLatestRosterConfirmationEmailJob(loaded.sessionId),
  };
}

export async function getRosterConfirmationEmailPreview(input: {
  actor: Member;
  sessionId: number;
  memberId: number;
}): Promise<{
  sessionId: number;
  sessionName: string;
  seasonName: string;
  leagueProcessingActive: boolean;
  recipient: RosterConfirmationRecipient;
  subject: string;
  htmlBody: string;
  textBody: string;
  paymentLinkPending: boolean;
}> {
  const list = await loadRosterConfirmationRecipients(input);
  const recipient = list.recipients.find((row) => row.memberId === input.memberId);
  if (!recipient) {
    throw new RosterConfirmationEmailValidationError({ memberId: 'This member is not on a league roster for the selected session.' });
  }
  const paymentLinkPending = recipient.balanceMinor > 0;
  const payload = payloadForRecipient(list, recipient, {
    paymentLinkPending,
    dashboardUrl: await dashboardUrlFor(recipient.registrationId, recipient.memberId),
  });
  const rendered = renderRegistrationEmail('roster_confirmation', payload);
  return {
    sessionId: list.sessionId,
    sessionName: list.sessionName,
    seasonName: list.seasonName,
    leagueProcessingActive: list.leagueProcessingActive,
    recipient,
    subject: rendered.subject,
    htmlBody: rendered.htmlBody,
    textBody: rendered.textBody,
    paymentLinkPending,
  };
}

type RosterConfirmationEmailJobError = { memberId: number; memberName: string; error: string };

function jsonStorageValue(value: unknown): never {
  return (getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value)) as never;
}

function parseJobMemberIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is number => Number.isInteger(value));
  }
  if (typeof raw === 'string') {
    try {
      return parseJobMemberIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function parseJobErrors(raw: unknown): RosterConfirmationEmailJobError[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (value): value is RosterConfirmationEmailJobError =>
        Boolean(value) &&
        typeof value === 'object' &&
        Number.isInteger((value as { memberId?: unknown }).memberId) &&
        typeof (value as { memberName?: unknown }).memberName === 'string' &&
        typeof (value as { error?: unknown }).error === 'string',
    );
  }
  if (typeof raw === 'string') {
    try {
      return parseJobErrors(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value.includes(' ') ? value.replace(' ', 'T') : value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function snapshotRosterConfirmationEmailJob(row: {
  id: number;
  session_id: number;
  status: string;
  cursor: number;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  errors_json: unknown;
  started_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}): RosterConfirmationEmailJobSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status as RosterConfirmationEmailJobStatus,
    total: row.total,
    completed: row.cursor,
    sent: row.sent,
    skipped: row.skipped,
    failed: row.failed,
    errors: parseJobErrors(row.errors_json),
    startedAt: toIso(row.started_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    finishedAt: toIso(row.finished_at),
  };
}

export async function getLatestRosterConfirmationEmailJob(
  sessionId: number,
): Promise<RosterConfirmationEmailJobSnapshot | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.rosterConfirmationEmailJobs)
    .where(eq(schema.rosterConfirmationEmailJobs.session_id, sessionId))
    .orderBy(desc(schema.rosterConfirmationEmailJobs.id))
    .limit(1);
  return row ? snapshotRosterConfirmationEmailJob(row) : null;
}

export async function getRunningRosterConfirmationEmailJob(
  sessionId: number,
): Promise<RosterConfirmationEmailJobSnapshot | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.rosterConfirmationEmailJobs)
    .where(
      and(
        eq(schema.rosterConfirmationEmailJobs.session_id, sessionId),
        eq(schema.rosterConfirmationEmailJobs.status, 'running'),
      ),
    )
    .orderBy(desc(schema.rosterConfirmationEmailJobs.id))
    .limit(1);
  return row ? snapshotRosterConfirmationEmailJob(row) : null;
}

export async function getRosterConfirmationEmailJobById(
  jobId: number,
): Promise<RosterConfirmationEmailJobSnapshot | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.rosterConfirmationEmailJobs)
    .where(eq(schema.rosterConfirmationEmailJobs.id, jobId))
    .limit(1);
  return row ? snapshotRosterConfirmationEmailJob(row) : null;
}

function skipSendError(recipient: RosterConfirmationRecipient): string {
  return recipient.skipReason === 'no_email'
    ? 'This member does not have an email address.'
    : 'This roster seat is not linked to a registration.';
}

async function sendOneRosterConfirmationEmail(input: {
  actor: Member;
  list: LoadedRosterConfirmation;
  recipient: RosterConfirmationRecipient;
  frontendBaseUrl?: string | null;
}): Promise<'sent'> {
  const recipient = input.recipient;
  if (!recipient.canSend || !recipient.memberEmail || recipient.registrationId == null) {
    throw new Error(skipSendError(recipient));
  }
  let paymentUrl: string | null = null;
  const sideEffects = rosterConfirmationSendSideEffects(recipient.balanceMinor);
  if (sideEffects.createPaymentLink) {
    const payment = await triggerDeferredRegistrationPayment({
      registrationId: recipient.registrationId,
      actorMemberId: input.actor.id,
      frontendBaseUrl: input.frontendBaseUrl ?? undefined,
      collectBalance: true,
      skipEmail: true,
    });
    if (payment.outcome === 'immediate_payment' && 'checkoutUrl' in payment) {
      paymentUrl = payment.checkoutUrl ?? null;
    }
    if (!paymentUrl) {
      throw new Error('A Square payment link could not be created for the remaining balance.');
    }
  }
  const payload = payloadForRecipient(input.list, recipient, {
    paymentUrl,
    dashboardUrl: await dashboardUrlFor(recipient.registrationId, recipient.memberId),
  });
  const sent = await sendRegistrationEmailForDashboard({
    messageType: 'roster_confirmation',
    recipientEmail: recipient.memberEmail,
    recipientName: recipient.memberName,
    recipientMemberId: recipient.memberId,
    registrationId: recipient.registrationId,
    payload,
  });
  if (sent.deliveryStatus === 'failed') {
    throw new Error(sent.errorDetail || 'The email failed to send.');
  }
  return 'sent';
}

const runningRosterConfirmationJobIds = new Set<number>();
const startingRosterConfirmationSessionIds = new Set<number>();

async function persistRosterConfirmationEmailJobProgress(input: {
  jobId: number;
  cursor: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: RosterConfirmationEmailJobError[];
  status?: RosterConfirmationEmailJobStatus;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const finished = input.status === 'completed' || input.status === 'failed';
  await db
    .update(schema.rosterConfirmationEmailJobs)
    .set({
      cursor: input.cursor,
      sent: input.sent,
      skipped: input.skipped,
      failed: input.failed,
      errors_json: jsonStorageValue(input.errors),
      ...(input.status ? { status: input.status } : {}),
      updated_at: sql`CURRENT_TIMESTAMP`,
      ...(finished ? { finished_at: sql`CURRENT_TIMESTAMP` } : {}),
    })
    .where(eq(schema.rosterConfirmationEmailJobs.id, input.jobId));
}

async function loadJobActor(actorMemberId: number): Promise<Member | null> {
  const { db, schema } = getDrizzleDb();
  const [actorRow] = await db.select().from(schema.members).where(eq(schema.members.id, actorMemberId)).limit(1);
  if (!actorRow) return null;
  const actor = actorRow as Member;
  actor.authz = await buildAuthzClaimsForMember(actor);
  return actor;
}

export async function processRosterConfirmationEmailJob(jobId: number): Promise<void> {
  if (runningRosterConfirmationJobIds.has(jobId)) return;
  runningRosterConfirmationJobIds.add(jobId);
  try {
    const { db, schema } = getDrizzleDb();
    const [job] = await db
      .select()
      .from(schema.rosterConfirmationEmailJobs)
      .where(eq(schema.rosterConfirmationEmailJobs.id, jobId))
      .limit(1);
    if (!job || job.status !== 'running') return;

    const actor = await loadJobActor(job.actor_member_id);
    if (!actor || !memberCanManageRegistrations(actor)) {
      await persistRosterConfirmationEmailJobProgress({
        jobId,
        cursor: job.cursor,
        sent: job.sent,
        skipped: job.skipped,
        failed: job.failed,
        errors: [
          ...parseJobErrors(job.errors_json),
          {
            memberId: 0,
            memberName: 'Send job',
            error: 'The staff member who started this send no longer has permission to send roster emails.',
          },
        ],
        status: 'failed',
      });
      return;
    }

    const memberIds = parseJobMemberIds(job.member_ids_json);
    const unsentOnly = job.unsent_only === 1;
    let cursor = job.cursor;
    let sent = job.sent;
    let skipped = job.skipped;
    let failed = job.failed;
    const errors = parseJobErrors(job.errors_json);

    while (cursor < memberIds.length) {
      const [latest] = await db
        .select({ status: schema.rosterConfirmationEmailJobs.status })
        .from(schema.rosterConfirmationEmailJobs)
        .where(eq(schema.rosterConfirmationEmailJobs.id, jobId))
        .limit(1);
      if (!latest || latest.status !== 'running') return;

      const memberId = memberIds[cursor];
      try {
        if (await isLeagueProcessingActive()) {
          throw new RosterConfirmationEmailValidationError({ processing: LEAGUE_PROCESSING_HOLD_REASON });
        }
        const list = await loadRosterConfirmationRecipients({
          actor,
          sessionId: job.session_id,
          memberId,
        });
        if (list.leagueProcessingActive) {
          throw new RosterConfirmationEmailValidationError({ processing: LEAGUE_PROCESSING_HOLD_REASON });
        }
        const recipient = list.recipients.find((entry) => entry.memberId === memberId);
        if (!recipient) {
          skipped += 1;
        } else if (unsentOnly && recipient.alreadySent) {
          skipped += 1;
        } else if (!recipient.canSend || !recipient.memberEmail || recipient.registrationId == null) {
          skipped += 1;
          errors.push({
            memberId: recipient.memberId,
            memberName: recipient.memberName,
            error: skipSendError(recipient),
          });
        } else {
          await sendOneRosterConfirmationEmail({
            actor,
            list,
            recipient,
            frontendBaseUrl: job.frontend_base_url,
          });
          sent += 1;
        }
      } catch (error) {
        if (error instanceof RosterConfirmationEmailValidationError && error.details.processing) {
          errors.push({
            memberId: 0,
            memberName: 'Send job',
            error: error.message,
          });
          await persistRosterConfirmationEmailJobProgress({
            jobId,
            cursor,
            sent,
            skipped,
            failed,
            errors,
            status: 'failed',
          });
          return;
        }
        failed += 1;
        const [member] = await db
          .select({
            firstName: schema.members.first_name,
            lastName: schema.members.last_name,
            name: schema.members.name,
            email: schema.members.email,
          })
          .from(schema.members)
          .where(eq(schema.members.id, memberId))
          .limit(1);
        errors.push({
          memberId,
          memberName: member ? memberDisplayName(member) : `Member ${memberId}`,
          error: error instanceof Error ? error.message : 'The email could not be sent.',
        });
      }
      cursor += 1;
      await persistRosterConfirmationEmailJobProgress({
        jobId,
        cursor,
        sent,
        skipped,
        failed,
        errors,
      });
    }

    await persistRosterConfirmationEmailJobProgress({
      jobId,
      cursor,
      sent,
      skipped,
      failed,
      errors,
      status: 'completed',
    });
  } catch (error) {
    const { db, schema } = getDrizzleDb();
    const [job] = await db
      .select()
      .from(schema.rosterConfirmationEmailJobs)
      .where(eq(schema.rosterConfirmationEmailJobs.id, jobId))
      .limit(1);
    if (job && job.status === 'running') {
      await persistRosterConfirmationEmailJobProgress({
        jobId,
        cursor: job.cursor,
        sent: job.sent,
        skipped: job.skipped,
        failed: job.failed,
        errors: [
          ...parseJobErrors(job.errors_json),
          {
            memberId: 0,
            memberName: 'Send job',
            error: error instanceof Error ? error.message : 'Roster confirmation email send failed.',
          },
        ],
        status: 'failed',
      });
    }
  } finally {
    runningRosterConfirmationJobIds.delete(jobId);
  }
}

export async function startRosterConfirmationEmailJob(input: {
  actor: Member;
  sessionId: number;
  memberIds?: number[];
  unsentOnly?: boolean;
  frontendBaseUrl?: string;
}): Promise<RosterConfirmationEmailJobSnapshot> {
  assertAccess(input.actor);
  while (startingRosterConfirmationSessionIds.has(input.sessionId)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const existing = await getRunningRosterConfirmationEmailJob(input.sessionId);
    if (existing) {
      void processRosterConfirmationEmailJob(existing.id);
      return existing;
    }
  }
  startingRosterConfirmationSessionIds.add(input.sessionId);
  try {
    if (await isLeagueProcessingActive()) {
      throw new RosterConfirmationEmailValidationError({ processing: LEAGUE_PROCESSING_HOLD_REASON });
    }
    const running = await getRunningRosterConfirmationEmailJob(input.sessionId);
    if (running) {
      void processRosterConfirmationEmailJob(running.id);
      return running;
    }

    const list = await loadRosterConfirmationRecipients(input);
    if (list.leagueProcessingActive) {
      throw new RosterConfirmationEmailValidationError({ processing: LEAGUE_PROCESSING_HOLD_REASON });
    }
    const selectedIds = input.memberIds && input.memberIds.length > 0 ? new Set(input.memberIds) : null;
    const targets = list.recipients.filter((recipient) => {
      if (selectedIds && !selectedIds.has(recipient.memberId)) return false;
      if (input.unsentOnly && recipient.alreadySent) return false;
      return true;
    });

    const { db, schema } = getDrizzleDb();
    const [row] = await db
      .insert(schema.rosterConfirmationEmailJobs)
      .values({
        session_id: list.sessionId,
        actor_member_id: input.actor.id,
        status: 'running',
        unsent_only: input.unsentOnly !== false ? 1 : 0,
        frontend_base_url: input.frontendBaseUrl ?? frontendBaseUrl(),
        member_ids_json: jsonStorageValue(targets.map((recipient) => recipient.memberId)),
        cursor: 0,
        total: targets.length,
        sent: 0,
        skipped: 0,
        failed: 0,
        errors_json: jsonStorageValue([]),
      })
      .returning();
    if (!row) {
      throw new RosterConfirmationEmailValidationError({
        send: 'Could not start roster confirmation email send.',
      });
    }
    void processRosterConfirmationEmailJob(row.id);
    return snapshotRosterConfirmationEmailJob(row);
  } finally {
    startingRosterConfirmationSessionIds.delete(input.sessionId);
  }
}

export async function resumeIncompleteRosterConfirmationEmailJobs(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.rosterConfirmationEmailJobs.id })
    .from(schema.rosterConfirmationEmailJobs)
    .where(eq(schema.rosterConfirmationEmailJobs.status, 'running'));
  for (const row of rows) {
    void processRosterConfirmationEmailJob(row.id);
  }
}

export async function sendRosterConfirmationEmails(input: {
  actor: Member;
  sessionId: number;
  memberIds?: number[];
  unsentOnly?: boolean;
  frontendBaseUrl?: string;
}): Promise<RosterConfirmationEmailJobSnapshot> {
  return startRosterConfirmationEmailJob(input);
}
