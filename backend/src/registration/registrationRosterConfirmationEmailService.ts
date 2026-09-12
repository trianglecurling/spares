import { and, eq, inArray, or } from 'drizzle-orm';
import { config } from '../config.js';
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
};

type LoadedRosterConfirmation = RosterConfirmationListResult & {
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

  const billingByRegistration = new Map(billing.registrations.map((row) => [row.registrationId, row]));
  const billingByMember = new Map<number, (typeof billing.registrations)[number]>();
  for (const row of billing.registrations) {
    if (row.curlerId == null) continue;
    const current = billingByMember.get(row.curlerId);
    if (!current || current.registrationId < row.registrationId) {
      billingByMember.set(row.curlerId, row);
    }
  }

  const registrationIdsForGuardians = [
    ...new Set(
      [...drafts.values()].flatMap((draft) => [
        ...draft.registrationIds,
        billingByMember.get(draft.memberId)?.registrationId ?? null,
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
      const preferredRegistrationId =
        draft.registrationIds.length > 0 ? Math.max(...draft.registrationIds) : billingByMember.get(draft.memberId)?.registrationId ?? null;
      const billingRow =
        (preferredRegistrationId != null ? billingByRegistration.get(preferredRegistrationId) : undefined) ??
        billingByMember.get(draft.memberId) ??
        null;
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

export async function sendRosterConfirmationEmails(input: {
  actor: Member;
  sessionId: number;
  memberIds?: number[];
  unsentOnly?: boolean;
  frontendBaseUrl?: string;
}): Promise<{
  sent: number;
  skipped: number;
  errors: Array<{ memberId: number; memberName: string; error: string }>;
}> {
  assertAccess(input.actor);
  if (await isLeagueProcessingActive()) {
    throw new RosterConfirmationEmailValidationError({ processing: LEAGUE_PROCESSING_HOLD_REASON });
  }
  const list = await loadRosterConfirmationRecipients(input);
  const selectedIds = input.memberIds && input.memberIds.length > 0 ? new Set(input.memberIds) : null;
  const targets = list.recipients.filter((recipient) => {
    if (selectedIds && !selectedIds.has(recipient.memberId)) return false;
    if (input.unsentOnly && recipient.alreadySent) return false;
    return true;
  });

  const result = { sent: 0, skipped: 0, errors: [] as Array<{ memberId: number; memberName: string; error: string }> };
  for (const recipient of targets) {
    if (!recipient.canSend || !recipient.memberEmail || recipient.registrationId == null) {
      result.skipped += 1;
      result.errors.push({
        memberId: recipient.memberId,
        memberName: recipient.memberName,
        error:
          recipient.skipReason === 'no_email'
            ? 'This member does not have an email address.'
            : 'This roster seat is not linked to a registration.',
      });
      continue;
    }

    try {
      let paymentUrl: string | null = null;
      const sideEffects = rosterConfirmationSendSideEffects(recipient.balanceMinor);
      if (sideEffects.createPaymentLink) {
        const payment = await triggerDeferredRegistrationPayment({
          registrationId: recipient.registrationId,
          actorMemberId: input.actor.id,
          frontendBaseUrl: input.frontendBaseUrl,
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
      const payload = payloadForRecipient(list, recipient, {
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
      result.sent += 1;
    } catch (error) {
      result.errors.push({
        memberId: recipient.memberId,
        memberName: recipient.memberName,
        error: error instanceof Error ? error.message : 'The email could not be sent.',
      });
    }
  }
  return result;
}
