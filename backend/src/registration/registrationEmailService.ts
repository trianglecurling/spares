import { desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  RegistrationCommunicationDeliveryStatusSqlite,
  RegistrationCommunicationMessageTypeSqlite,
} from '../db/drizzle-schema.js';
import { sendEmail } from '../services/email.js';

export type RegistrationMessageType = RegistrationCommunicationMessageTypeSqlite;

export interface RegistrationReceiptLineItem {
  description: string;
  amountMinor: number;
}

export const REGISTRATION_PAYMENT_FINANCE_EMAIL = 'finance@trianglecurling.com';
export const REGISTRATION_MEMBERSHIP_EMAIL = 'membership@trianglecurling.com';
export const REGISTRATION_JUNIORS_EMAIL = 'juniors@trianglecurling.com';

type RegistrationContactType = 'payment' | 'membership' | 'juniors';

const REGISTRATION_CONTACT_PROMPTS: Record<RegistrationContactType, string> = {
  payment: 'Questions about payments?',
  membership: 'Questions about membership or league placements?',
  juniors: 'Questions about junior curling?',
};

function registrationContactEmail(type: RegistrationContactType): string {
  switch (type) {
    case 'payment':
      return REGISTRATION_PAYMENT_FINANCE_EMAIL;
    case 'membership':
      return REGISTRATION_MEMBERSHIP_EMAIL;
    case 'juniors':
      return REGISTRATION_JUNIORS_EMAIL;
  }
}

function registrationContactLineText(type: RegistrationContactType): string {
  return `${REGISTRATION_CONTACT_PROMPTS[type]} Contact ${registrationContactEmail(type)}.`;
}

function registrationContactLineHtml(type: RegistrationContactType): string {
  const email = registrationContactEmail(type);
  return `<p>${REGISTRATION_CONTACT_PROMPTS[type]} Contact <a href="mailto:${email}">${email}</a>.</p>`;
}

function registrationContactHtml(types: RegistrationContactType[]): string {
  return types.map(registrationContactLineHtml).join('\n          ');
}

function registrationContactText(types: RegistrationContactType[]): string {
  return types.map(registrationContactLineText).join('\n');
}

function registrationManualUpdateContactTypes(paymentImpact?: string | null): RegistrationContactType[] {
  const normalized = paymentImpact?.trim().toLowerCase() ?? 'unchanged';
  if (normalized === 'unchanged' || normalized === 'payment amount unchanged.') {
    return ['membership'];
  }
  return ['payment', 'membership'];
}

export interface RegistrationEmailPayload {
  curlerName?: string | null;
  seasonName?: string | null;
  sessionName?: string | null;
  leagueName?: string | null;
  waitlistType?: 'ADD' | 'REPLACE' | string | null;
  replacementLeagueName?: string | null;
  position?: number | null;
  waitlistSize?: number | null;
  updatedPosition?: number | null;
  declineCount?: number | null;
  amountDueMinor?: number | null;
  amountPaidMinor?: number | null;
  paymentUrl?: string | null;
  dashboardUrl?: string | null;
  acceptUrl?: string | null;
  declineUrl?: string | null;
  deadlineText?: string | null;
  offerResponseSource?: 'explicit' | 'automatic' | string | null;
  isTemporarySabbaticalFill?: boolean | null;
  requestedAssistancePercent?: number | null;
  approvedAssistancePercent?: number | null;
  teammateText?: string | null;
  addedByName?: string | null;
  changedSummary?: string | null;
  paymentImpact?: string | null;
  deferralReasons?: string[] | null;
  summaryLines?: string[] | null;
  registrationDetailLines?: string[] | null;
  paidItems?: string[] | null;
  receiptLineItems?: RegistrationReceiptLineItem[] | null;
  receiptSubtotalMinor?: number | null;
  receiptDiscountMinor?: number | null;
  paidAt?: string | null;
  paymentReference?: string | null;
  paymentDetailsUrl?: string | null;
  refundIssued?: boolean | null;
  amountRefundedMinor?: number | null;
  sabbaticalFeeStatus?: string | null;
  durationLimitWarning?: string | null;
}

export interface SendRegistrationEmailInput {
  messageType: RegistrationMessageType;
  recipientEmail: string;
  recipientName: string;
  recipientMemberId?: number | null;
  registrationId?: number | null;
  waitlistOfferId?: number | null;
  waitlistEntryId?: number | null;
  resendOfMessageId?: number | null;
  payload?: RegistrationEmailPayload;
}

export interface RegistrationEmailSummary {
  id: number;
  messageType: RegistrationMessageType;
  recipientEmail: string;
  subject: string;
  deliveryStatus: RegistrationCommunicationDeliveryStatusSqlite;
  sentAt: string | Date | null;
  createdAt: string | Date;
  errorDetail: string | null;
}

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

function dbValue(value: unknown): never {
  return value as never;
}

function jsonStorageValue(value: unknown): unknown {
  return getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(minor?: number | null): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return 'Not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
}

function listItems(items?: Array<string | null | undefined> | null): string {
  const normalized = (items ?? []).map((item) => item?.trim()).filter((item): item is string => Boolean(item));
  if (normalized.length === 0) return '<p>No itemized summary is available.</p>';
  return `<ul>${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function textList(items?: Array<string | null | undefined> | null): string {
  const normalized = (items ?? []).map((item) => item?.trim()).filter((item): item is string => Boolean(item));
  return normalized.length > 0 ? normalized.map((item) => `- ${item}`).join('\n') : '- No itemized summary is available.';
}

function sessionLabel(payload: RegistrationEmailPayload): string {
  return [payload.seasonName, payload.sessionName].map((part) => part?.trim()).filter(Boolean).join(' / ') || 'the season';
}

function paymentLinkHtml(payload: RegistrationEmailPayload): string {
  return payload.paymentUrl
    ? `<p><a href="${escapeHtml(payload.paymentUrl)}">Complete your registration payment</a></p>`
    : '<p>No payment link is available yet.</p>';
}

function paymentDetailsLinkHtml(payload: RegistrationEmailPayload): string {
  return payload.paymentDetailsUrl
    ? `<p><a href="${escapeHtml(payload.paymentDetailsUrl)}">View payment details</a></p>`
    : '';
}

function actionLinksHtml(payload: RegistrationEmailPayload): string {
  const links = [
    payload.acceptUrl ? `<a href="${escapeHtml(payload.acceptUrl)}">Accept this offer</a>` : null,
    payload.declineUrl ? `<a href="${escapeHtml(payload.declineUrl)}">Decline this offer</a>` : null,
    payload.dashboardUrl ? `<a href="${escapeHtml(payload.dashboardUrl)}">View your registration status</a>` : null,
  ].filter(Boolean);
  return links.length > 0 ? `<p>${links.join(' &nbsp; ')}</p>` : '';
}

function receiptTableHtml(payload: RegistrationEmailPayload): string {
  const lineItems = payload.receiptLineItems ?? [];
  if (lineItems.length === 0) {
    return `<p><strong>Amount paid:</strong> ${money(payload.amountPaidMinor)}</p>`;
  }

  const rows = lineItems
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td style="text-align:right; white-space:nowrap;">${money(line.amountMinor)}</td></tr>`
    )
    .join('');
  const footerRows = [
    typeof payload.receiptSubtotalMinor === 'number'
      ? `<tr><td>Subtotal</td><td style="text-align:right; white-space:nowrap;">${money(payload.receiptSubtotalMinor)}</td></tr>`
      : null,
    typeof payload.receiptDiscountMinor === 'number' && payload.receiptDiscountMinor > 0
      ? `<tr><td>Discounts</td><td style="text-align:right; white-space:nowrap;">${money(-payload.receiptDiscountMinor)}</td></tr>`
      : null,
    `<tr><td><strong>Total paid</strong></td><td style="text-align:right; white-space:nowrap;"><strong>${money(payload.amountPaidMinor)}</strong></td></tr>`,
  ].filter(Boolean);

  return `
    <table style="border-collapse:collapse; width:100%; max-width:36rem;">
      <thead>
        <tr>
          <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:0.35rem 0;">Item</th>
          <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:0.35rem 0;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>${footerRows.join('')}</tfoot>
    </table>
  `;
}

function receiptTableText(payload: RegistrationEmailPayload): string {
  const lineItems = payload.receiptLineItems ?? [];
  if (lineItems.length === 0) {
    return `Amount paid: ${money(payload.amountPaidMinor)}`;
  }

  const lines = lineItems.map((line) => `${line.description}: ${money(line.amountMinor)}`);
  if (typeof payload.receiptSubtotalMinor === 'number') {
    lines.push(`Subtotal: ${money(payload.receiptSubtotalMinor)}`);
  }
  if (typeof payload.receiptDiscountMinor === 'number' && payload.receiptDiscountMinor > 0) {
    lines.push(`Discounts: ${money(-payload.receiptDiscountMinor)}`);
  }
  lines.push(`Total paid: ${money(payload.amountPaidMinor)}`);
  return lines.join('\n');
}

function waitlistEntryTypeLabel(waitlistType?: string | null): string {
  if (waitlistType === 'REPLACE') return 'REPLACE one of your leagues';
  if (waitlistType === 'ADD') return 'ADD to this league';
  return waitlistType?.trim() || 'ADD to this league';
}

function waitlistPositionLabel(position?: number | null, waitlistSize?: number | null): string {
  if (typeof position === 'number' && typeof waitlistSize === 'number' && waitlistSize > 0) {
    return `${position} of ${waitlistSize}`;
  }
  if (typeof position === 'number') return String(position);
  return 'Not available';
}

interface RenderedRegistrationEmail {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export function renderRegistrationEmail(messageType: RegistrationMessageType, payload: RegistrationEmailPayload = {}): RenderedRegistrationEmail {
  const curlerName = payload.curlerName?.trim() || 'the curler';
  const leagueName = payload.leagueName?.trim() || 'the league';
  const season = sessionLabel(payload);
  const summaryHtml = listItems(payload.summaryLines);
  const summaryText = textList(payload.summaryLines);
  const registrationDetailsHtml = listItems(payload.registrationDetailLines ?? payload.summaryLines);
  const registrationDetailsText = textList(payload.registrationDetailLines ?? payload.summaryLines);
  const deferralHtml = listItems(payload.deferralReasons);
  const deferralText = textList(payload.deferralReasons);
  const receiptHtml = receiptTableHtml(payload);
  const receiptText = receiptTableText(payload);
  const paymentAndMembershipContactHtml = registrationContactHtml(['payment', 'membership']);
  const paymentAndMembershipContactText = registrationContactText(['payment', 'membership']);
  const membershipContactHtml = registrationContactHtml(['membership']);
  const membershipContactText = registrationContactText(['membership']);
  const juniorsContactHtml = registrationContactHtml(['juniors']);
  const juniorsContactText = registrationContactText(['juniors']);
  const manualUpdateContactHtml = registrationContactHtml(registrationManualUpdateContactTypes(payload.paymentImpact));
  const manualUpdateContactText = registrationContactText(registrationManualUpdateContactTypes(payload.paymentImpact));
  const waitlistOfferAcceptedContactHtml = registrationContactHtml(payload.paymentUrl ? ['payment', 'membership'] : ['membership']);
  const waitlistOfferAcceptedContactText = registrationContactText(payload.paymentUrl ? ['payment', 'membership'] : ['membership']);
  const cancellationContactHtml = registrationContactHtml(payload.refundIssued === true ? ['payment', 'membership'] : ['membership']);
  const cancellationContactText = registrationContactText(payload.refundIssued === true ? ['payment', 'membership'] : ['membership']);

  switch (messageType) {
    case 'registration_submitted_immediate_payment':
      return {
        subject: 'Complete your registration payment',
        htmlBody: `
          <h2>Complete your registration payment</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>Your registration for ${escapeHtml(season)} has been submitted, but it is not fully confirmed until payment is complete.</p>
          ${summaryHtml}
          <p><strong>Amount due:</strong> ${money(payload.amountDueMinor)}</p>
          ${paymentLinkHtml(payload)}
          ${paymentAndMembershipContactHtml}
        `,
        textBody: `Complete your registration payment\n\nRegistration for ${curlerName} (${season}) has been submitted, but it is not fully confirmed until payment is complete.\n\n${summaryText}\n\nAmount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\n\n${paymentAndMembershipContactText}`,
      };
    case 'registration_submitted_deferred_payment':
      return {
        subject: 'Registration submitted - payment will come later',
        htmlBody: `
          <h2>Registration submitted</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>You do not need to pay yet. Some of your registration choices require placement or staff review first. We will email you when your payment is ready.</p>
          ${summaryHtml}
          <p><strong>Why payment is deferred:</strong></p>
          ${deferralHtml}
          ${payload.paymentUrl ? paymentLinkHtml(payload) : ''}
          ${membershipContactHtml}
        `,
        textBody: `Registration submitted - payment will come later\n\nYou do not need to pay yet. Some choices require placement or staff review first.\n\n${summaryText}\n\nWhy payment is deferred:\n${deferralText}\n\n${payload.paymentUrl ? `Payment link: ${payload.paymentUrl}\n\n` : ''}${membershipContactText}`,
      };
    case 'registration_payment_received':
      return {
        subject: 'Registration payment received',
        htmlBody: `
          <h2>Registration payment received</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>We received your registration payment for ${escapeHtml(season)}. Your paid registration choices are confirmed below.</p>
          <h3>Registration details</h3>
          ${registrationDetailsHtml}
          <h3>Payment receipt</h3>
          ${receiptHtml}
          ${payload.paymentReference ? `<p><strong>Payment reference:</strong> ${escapeHtml(payload.paymentReference)}</p>` : ''}
          ${payload.paidAt ? `<p><strong>Paid on:</strong> ${escapeHtml(payload.paidAt)}</p>` : ''}
          ${paymentDetailsLinkHtml(payload)}
          <p>Pending waitlist, third-league interest, and other unpaid choices are not confirmed by this payment.</p>
          ${payload.dashboardUrl ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View your registration status</a></p>` : ''}
          ${paymentAndMembershipContactHtml}
        `,
        textBody: [
          'Registration payment received',
          '',
          `Hi ${curlerName},`,
          '',
          `We received your registration payment for ${season}. Your paid registration choices are confirmed below.`,
          '',
          'Registration details',
          registrationDetailsText,
          '',
          'Payment receipt',
          receiptText,
          payload.paymentReference ? `Payment reference: ${payload.paymentReference}` : null,
          payload.paidAt ? `Paid on: ${payload.paidAt}` : null,
          payload.paymentDetailsUrl ? `View payment details: ${payload.paymentDetailsUrl}` : null,
          '',
          'Pending waitlist, third-league interest, and other unpaid choices are not confirmed by this payment.',
          payload.dashboardUrl ? `View your registration status: ${payload.dashboardUrl}` : null,
          '',
          paymentAndMembershipContactText,
        ].filter(Boolean).join('\n'),
      };
    case 'social_membership_confirmation':
      return {
        subject: 'Social membership confirmed',
        htmlBody: `
          <h2>Social membership confirmed</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>Your social membership is active for ${escapeHtml(season)} after payment.</p>
          <p>Social membership does not include ice privileges. Social members are not eligible for league play or sparing unless they later upgrade to regular membership and purchase applicable ice privileges.</p>
          <p>Upgrading later requires paying the full regular membership price with no social membership credit and no discounts.</p>
          ${membershipContactHtml}
        `,
        textBody: `Social membership confirmed\n\nYour social membership is active for ${season} after payment. Social membership does not include ice privileges. Social members cannot play in leagues or spare unless they later upgrade to regular membership and purchase applicable ice privileges. Upgrading later requires paying the full regular membership price with no social membership credit and no discounts.\n\n${membershipContactText}`,
      };
    case 'waitlist_joined': {
      const entryTypeLabel = waitlistEntryTypeLabel(payload.waitlistType);
      const positionLabel = waitlistPositionLabel(payload.position, payload.waitlistSize);
      const replacesLeagueHtml = payload.replacementLeagueName
        ? `<p><strong>Replaces league:</strong> ${escapeHtml(payload.replacementLeagueName)}</p>`
        : '';
      const replacesLeagueText = payload.replacementLeagueName ? `Replaces league: ${payload.replacementLeagueName}\n` : '';
      const viewWaitlistHtml = payload.dashboardUrl
        ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View waitlist</a></p>`
        : '';
      const viewWaitlistText = payload.dashboardUrl ? `View waitlist: ${payload.dashboardUrl}` : '';
      if (payload.addedByName) {
        const mistakeHtml = `<p>If you believe this was a mistake, please reach out to <strong>${escapeHtml(payload.addedByName)}</strong>.</p>`;
        const mistakeText = `If you believe this was a mistake, please reach out to ${payload.addedByName}.`;
        return {
          subject: `You were added to the ${leagueName} waitlist`,
          htmlBody: `
            <h2>You were added to the ${escapeHtml(leagueName)} waitlist</h2>
            <p><strong>${escapeHtml(payload.addedByName)}</strong> added you to this waitlist.</p>
            <p><strong>Your waitlist entry type:</strong> ${escapeHtml(entryTypeLabel)}</p>
            ${replacesLeagueHtml}
            <p><strong>Current position:</strong> ${escapeHtml(positionLabel)}</p>
            ${viewWaitlistHtml}
            ${mistakeHtml}
            ${membershipContactHtml}
          `,
          textBody: [
            `You were added to the ${leagueName} waitlist`,
            '',
            `${payload.addedByName} added you to this waitlist.`,
            `Your waitlist entry type: ${entryTypeLabel}`,
            replacesLeagueText.trim(),
            `Current position: ${positionLabel}`,
            viewWaitlistText,
            mistakeText,
            membershipContactText,
          ].filter(Boolean).join('\n'),
        };
      }
      return {
        subject: `You have joined the ${leagueName} waitlist`,
        htmlBody: `
          <h2>You have joined the ${escapeHtml(leagueName)} waitlist</h2>
          <p><strong>Waitlist entry type:</strong> ${escapeHtml(entryTypeLabel)}</p>
          ${replacesLeagueHtml}
          <p><strong>Current position:</strong> ${escapeHtml(positionLabel)}</p>
          ${viewWaitlistHtml}
          ${membershipContactHtml}
        `,
        textBody: [
          `You have joined the ${leagueName} waitlist`,
          '',
          `Waitlist entry type: ${entryTypeLabel}`,
          replacesLeagueText.trim(),
          `Current position: ${positionLabel}`,
          viewWaitlistText,
          membershipContactText,
        ].filter(Boolean).join('\n'),
      };
    }
    case 'waitlist_removed_by_member':
      return {
        subject: `You have been removed from the ${leagueName} waitlist`,
        htmlBody: `
          <h2>You have been removed from the waitlist</h2>
          <p>You have been removed from the waitlist for <strong>${escapeHtml(leagueName)}</strong>.</p>
          <p>Your previous waitlist position is no longer held.</p>
          ${membershipContactHtml}
        `,
        textBody: `You have been removed from the ${leagueName} waitlist.\n\nYour previous waitlist position is no longer held.\n\n${membershipContactText}`,
      };
    case 'waitlist_changed_by_staff':
      return {
        subject: `Your ${leagueName} waitlist status changed`,
        htmlBody: `
          <h2>Your waitlist status changed</h2>
          <p>Your waitlist entry for <strong>${escapeHtml(leagueName)}</strong> was updated.</p>
          <p>${escapeHtml(payload.changedSummary || 'Staff updated your waitlist entry.')}</p>
          <p>New position/status: ${escapeHtml(payload.updatedPosition ?? payload.position ?? 'See your account page for details')}</p>
          ${membershipContactHtml}
        `,
        textBody: `Your ${leagueName} waitlist status changed.\n\n${payload.changedSummary || 'Staff updated your waitlist entry.'}\nNew position/status: ${payload.updatedPosition ?? payload.position ?? 'See your account page for details'}\n\n${membershipContactText}`,
      };
    case 'waitlist_offer_permanent':
    case 'waitlist_offer_temporary_sabbatical_fill': {
      const temporary = messageType === 'waitlist_offer_temporary_sabbatical_fill' || payload.isTemporarySabbaticalFill;
      const temporaryText = temporary
        ? 'This is a temporary spot while another member is on sabbatical. The original member may return in a future session. Accepting this temporary spot does not remove you from the waitlist for a permanent spot. Declining counts under the normal decline rules.'
        : 'This is a permanent league spot offer.';
      return {
        subject: `${temporary ? 'Temporary league spot available' : 'League spot available'}: ${leagueName}`,
        htmlBody: `
          <h2>${temporary ? 'Temporary league spot available' : 'League spot available'}</h2>
          <p>Triangle Curling Club has an offer for you in <strong>${escapeHtml(leagueName)}</strong>.</p>
          <p>${escapeHtml(temporaryText)}</p>
          <p>If you do not accept this offer by the response deadline, we will treat it as declined. If payment is required after acceptance, staff will follow up with you.</p>
          ${payload.deadlineText ? `<p><strong>Respond by:</strong> ${escapeHtml(payload.deadlineText)}</p>` : ''}
          ${actionLinksHtml(payload)}
          ${membershipContactHtml}
        `,
        textBody: `${temporary ? 'Temporary league spot available' : 'League spot available'}: ${leagueName}\n\n${temporaryText}\n\nIf you do not accept this offer by the response deadline, we will treat it as declined. If payment is required after acceptance, staff will follow up with you.\n${payload.deadlineText ? `Respond by: ${payload.deadlineText}\n` : ''}${payload.acceptUrl ? `Accept: ${payload.acceptUrl}\n` : ''}${payload.declineUrl ? `Decline: ${payload.declineUrl}\n` : ''}\n${membershipContactText}`,
      };
    }
    case 'waitlist_offer_accepted':
      return {
        subject: `League offer accepted: ${leagueName}`,
        htmlBody: `
          <h2>League offer accepted</h2>
          <p>Your offer for <strong>${escapeHtml(leagueName)}</strong> has been accepted.</p>
          <p>Spot type: ${payload.isTemporarySabbaticalFill ? 'temporary sabbatical-fill' : 'permanent'}.</p>
          <p>${payload.paymentUrl ? 'Payment is ready now.' : 'If payment is required, staff will follow up.'}</p>
          ${payload.paymentUrl ? paymentLinkHtml(payload) : ''}
          ${waitlistOfferAcceptedContactHtml}
        `,
        textBody: `League offer accepted: ${leagueName}\n\nYour offer has been accepted.\nSpot type: ${payload.isTemporarySabbaticalFill ? 'temporary sabbatical-fill' : 'permanent'}.\n${payload.paymentUrl ? `Payment link: ${payload.paymentUrl}` : 'If payment is required, staff will follow up.'}\n\n${waitlistOfferAcceptedContactText}`,
      };
    case 'waitlist_offer_declined':
      return {
        subject: `League offer declined: ${leagueName}`,
        htmlBody: `
          <h2>League offer declined</h2>
          <p>Your offer for <strong>${escapeHtml(leagueName)}</strong> has been declined${payload.offerResponseSource === 'automatic' ? ' because the response deadline passed without an acceptance' : ''}.</p>
          <p>${(payload.declineCount ?? 0) >= 2 ? 'This was your second decline for this waitlist, so you have moved to the bottom of the waitlist.' : 'This was your first decline for this waitlist, so your position is retained.'}</p>
          <p>Updated position: ${payload.updatedPosition ?? payload.position ?? 'Not available'}</p>
          ${payload.dashboardUrl ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View waitlist status</a></p>` : ''}
          ${membershipContactHtml}
        `,
        textBody: `League offer declined: ${leagueName}\n\nYour offer has been declined${payload.offerResponseSource === 'automatic' ? ' because the response deadline passed without an acceptance' : ''}.\n${(payload.declineCount ?? 0) >= 2 ? 'This was your second decline, so you have moved to the bottom of the waitlist.' : 'This was your first decline, so your position is retained.'}\nUpdated position: ${payload.updatedPosition ?? payload.position ?? 'Not available'}\n${payload.dashboardUrl ? `View status: ${payload.dashboardUrl}\n` : ''}\n${membershipContactText}`,
      };
    case 'deferred_registration_payment_link':
      return {
        subject: 'Your registration payment is ready',
        htmlBody: `
          <h2>Your registration payment is ready</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>Your registration payment for ${escapeHtml(season)} is ready.</p>
          ${summaryHtml}
          <p><strong>Amount due:</strong> ${money(payload.amountDueMinor)}</p>
          ${paymentLinkHtml(payload)}
          <p>Payment is required to complete registration.</p>
          ${paymentAndMembershipContactHtml}
        `,
        textBody: `Your registration payment is ready\n\n${summaryText}\n\nAmount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\nPayment is required to complete registration.\n\n${paymentAndMembershipContactText}`,
      };
    case 'junior_assistance_pending':
      return {
        subject: 'Junior Recreational assistance request received',
        htmlBody: `
          <h2>Junior Recreational assistance request received</h2>
          <p>We received the Junior Recreational assistance request for ${escapeHtml(curlerName)}.</p>
          <p><strong>Requested assistance:</strong> ${payload.requestedAssistancePercent ?? 'Not available'}%</p>
          <p>Payment is deferred while staff reviews the request. Staff will follow up with the final amount due.</p>
          ${juniorsContactHtml}
        `,
        textBody: `Junior Recreational assistance request received\n\nRequested assistance: ${payload.requestedAssistancePercent ?? 'Not available'}%\nPayment is deferred while staff reviews the request. Staff will follow up with the final amount due.\n\n${juniorsContactText}`,
      };
    case 'junior_assistance_decision':
      return {
        subject: 'Junior Recreational registration payment is ready',
        htmlBody: `
          <h2>Junior Recreational registration payment is ready</h2>
          <p>Staff has reviewed the assistance request for ${escapeHtml(curlerName)}.</p>
          <p><strong>Requested assistance:</strong> ${payload.requestedAssistancePercent ?? 'Not available'}%</p>
          <p><strong>Approved assistance:</strong> ${payload.approvedAssistancePercent ?? 0}%</p>
          <p><strong>Final amount due:</strong> ${money(payload.amountDueMinor)}</p>
          ${paymentLinkHtml(payload)}
          <p>If the approved amount creates a concern, please contact <a href="mailto:${REGISTRATION_JUNIORS_EMAIL}">${REGISTRATION_JUNIORS_EMAIL}</a> before paying.</p>
          ${registrationContactHtml(['payment'])}
        `,
        textBody: `Junior Recreational registration payment is ready\n\nRequested assistance: ${payload.requestedAssistancePercent ?? 'Not available'}%\nApproved assistance: ${payload.approvedAssistancePercent ?? 0}%\nFinal amount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\nIf the approved amount creates a concern, contact ${REGISTRATION_JUNIORS_EMAIL} before paying.\n\n${registrationContactText(['payment'])}`,
      };
    case 'sabbatical_confirmation':
      return {
        subject: `Sabbatical confirmed for ${leagueName}`,
        htmlBody: `
          <h2>Sabbatical confirmed</h2>
          <p>Your sabbatical for <strong>${escapeHtml(leagueName)}</strong> in ${escapeHtml(season)} has been recorded.</p>
          <p>Sabbatical fee status: ${escapeHtml(payload.sabbaticalFeeStatus || 'See your dashboard')}.</p>
          <p>This preserves your right to return under the sabbatical rules. Sabbaticals are time-limited.</p>
          ${payload.durationLimitWarning ? `<p><strong>${escapeHtml(payload.durationLimitWarning)}</strong></p>` : ''}
          ${membershipContactHtml}
        `,
        textBody: `Sabbatical confirmed for ${leagueName}\n\nSabbatical fee status: ${payload.sabbaticalFeeStatus || 'See your dashboard'}.\nThis preserves your right to return under the sabbatical rules. Sabbaticals are time-limited.\n${payload.durationLimitWarning ?? ''}\n\n${membershipContactText}`.trim(),
      };
    case 'sabbatical_release':
      return {
        subject: `Your sabbatical spot for ${leagueName} has been released`,
        htmlBody: `
          <h2>Your sabbatical spot has been released</h2>
          <p>The protected sabbatical spot for <strong>${escapeHtml(leagueName)}</strong> has been released.</p>
          <p>Returning later requires joining the waitlist.</p>
          ${membershipContactHtml}
        `,
        textBody: `Your sabbatical spot for ${leagueName} has been released.\n\nReturning later requires joining the waitlist.\n\n${membershipContactText}`,
      };
    case 'byot_registration_confirmation':
      return {
        subject: `BYOT registration received: ${leagueName}`,
        htmlBody: `
          <h2>BYOT registration received</h2>
          <p>Your bring-your-own-team request for <strong>${escapeHtml(leagueName)}</strong> has been submitted.</p>
          <p><strong>Submitted teammates:</strong> ${escapeHtml(payload.teammateText || 'Not provided')}</p>
          <p>BYOT placement is coordinated by the league coordinator. You may be contacted if roster adjustments are needed.</p>
          ${membershipContactHtml}
        `,
        textBody: `BYOT registration received: ${leagueName}\n\nSubmitted teammates: ${payload.teammateText || 'Not provided'}\nBYOT placement is coordinated by the league coordinator. You may be contacted if roster adjustments are needed.\n\n${membershipContactText}`,
      };
    case 'registration_manually_updated_by_staff':
      return {
        subject: 'Your registration has been updated',
        htmlBody: `
          <h2>Your registration has been updated</h2>
          <p>Staff updated the registration for ${escapeHtml(curlerName)}.</p>
          <p>${escapeHtml(payload.changedSummary || 'A registration detail was updated by staff.')}</p>
          <p>Payment status: ${escapeHtml(payload.paymentImpact || 'unchanged')}.</p>
          ${manualUpdateContactHtml}
        `,
        textBody: `Your registration has been updated\n\n${payload.changedSummary || 'A registration detail was updated by staff.'}\nPayment status: ${payload.paymentImpact || 'unchanged'}.\n\n${manualUpdateContactText}`,
      };
    case 'registration_cancelled_by_member': {
      const refundIssued = payload.refundIssued === true;
      const refundHtml = refundIssued
        ? `
          <p><strong>Refund amount:</strong> ${money(payload.amountRefundedMinor)}</p>
          ${payload.paymentReference ? `<p><strong>Payment reference:</strong> ${escapeHtml(payload.paymentReference)}</p>` : ''}
          <p>A refund has been issued and should appear on your original payment method within a few business days.</p>
        `
        : '<p>No refund was issued because no completed payment was on file for this registration.</p>';
      const refundText = refundIssued
        ? `Refund amount: ${money(payload.amountRefundedMinor)}\n${payload.paymentReference ? `Payment reference: ${payload.paymentReference}\n` : ''}A refund has been issued and should appear on your original payment method within a few business days.`
        : 'No refund was issued because no completed payment was on file for this registration.';
      return {
        subject: `Registration deleted for ${season}`,
        htmlBody: `
          <h2>Registration deleted</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>Your registration for ${escapeHtml(season)} has been deleted.</p>
          <p>You will not be placed into any leagues from this registration.</p>
          ${refundHtml}
          <p>If you still need to register, you may submit a new registration while priority registration is open.</p>
          ${payload.dashboardUrl ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View your dashboard</a></p>` : ''}
          ${cancellationContactHtml}
        `,
        textBody: `Registration deleted\n\nHi ${curlerName},\n\nYour registration for ${season} has been deleted.\nYou will not be placed into any leagues from this registration.\n\n${refundText}\n\nIf you still need to register, you may submit a new registration while priority registration is open.\n${payload.dashboardUrl ? `Dashboard: ${payload.dashboardUrl}\n` : ''}\n${cancellationContactText}`,
      };
    }
  }
}

function deliveryStatusFromResult(status: 'sent' | 'logged' | 'failed'): RegistrationCommunicationDeliveryStatusSqlite {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  return 'suppressed';
}

export async function sendRegistrationEmail(input: SendRegistrationEmailInput): Promise<RegistrationEmailSummary> {
  const rendered = renderRegistrationEmail(input.messageType, input.payload);
  const { db, schema } = getDrizzleDb();
  const [message] = await db
    .insert(schema.registrationOutboundMessages)
    .values({
      message_type: input.messageType,
      recipient_email: input.recipientEmail,
      recipient_member_id: input.recipientMemberId ?? null,
      registration_id: input.registrationId ?? null,
      waitlist_offer_id: input.waitlistOfferId ?? null,
      waitlist_entry_id: input.waitlistEntryId ?? null,
      resend_of_message_id: input.resendOfMessageId ?? null,
      subject: rendered.subject,
      html_body: rendered.htmlBody,
      text_body: rendered.textBody,
      payload_json: dbValue(jsonStorageValue(input.payload ?? {})),
      delivery_status: 'pending',
    })
    .returning();

  const result = await sendEmail({
    to: input.recipientEmail,
    recipientName: input.recipientName,
    subject: rendered.subject,
    htmlContent: rendered.htmlBody,
    textContent: rendered.textBody,
  });

  const deliveryStatus = deliveryStatusFromResult(result.status);
  const [updated] = await db
    .update(schema.registrationOutboundMessages)
    .set({
      delivery_status: deliveryStatus,
      error_detail: result.error ?? result.reason ?? null,
      sent_at: deliveryStatus === 'sent' ? dbValue(new Date()) : null,
    })
    .where(eq(schema.registrationOutboundMessages.id, message.id))
    .returning();

  return mapMessageSummary(updated);
}

function memberDisplayName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'there';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'there';
}

export async function sendRegistrationCancelledByMemberEmail(input: {
  registrationId: number;
  refundIssued: boolean;
  amountRefundedMinor?: number | null;
  paymentReference?: string | null;
}): Promise<void> {
  try {
    const { db, schema } = getDrizzleDb();
    const [registration] = await db
      .select()
      .from(schema.curlingRegistrations)
      .where(eq(schema.curlingRegistrations.id, input.registrationId))
      .limit(1);
    if (!registration?.curler_member_id) return;

    const [curler] = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, registration.curler_member_id))
      .limit(1);
    if (!curler?.email) return;

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

    await sendRegistrationEmailForDashboard({
      messageType: 'registration_cancelled_by_member',
      recipientEmail: curler.email,
      recipientName: memberDisplayName(curler),
      recipientMemberId: curler.id,
      registrationId: input.registrationId,
      payload: {
        curlerName: memberDisplayName(curler),
        seasonName: season?.name ?? null,
        sessionName: session?.name ?? null,
        refundIssued: input.refundIssued,
        amountRefundedMinor: input.amountRefundedMinor ?? null,
        paymentReference: input.paymentReference ?? null,
      },
    });
  } catch (error) {
    console.error('[Registration Email] Failed to send registration cancellation email:', error);
  }
}

export async function sendRegistrationEmailForDashboard(input: Omit<SendRegistrationEmailInput, 'payload'> & { payload?: RegistrationEmailPayload }): Promise<RegistrationEmailSummary> {
  let dashboardPath = '/dashboard';
  if (input.registrationId) {
    const { resolveRegistrationViewPath } = await import('./registrationMemberService.js');
    dashboardPath = await resolveRegistrationViewPath(input.registrationId, input.recipientMemberId);
  }
  return sendRegistrationEmail({
    ...input,
    payload: {
      dashboardUrl: `${frontendBaseUrl()}${dashboardPath}`,
      ...input.payload,
    },
  });
}

export async function resendRegistrationOutboundMessage(messageId: number): Promise<RegistrationEmailSummary> {
  const { db, schema } = getDrizzleDb();
  const [original] = await db
    .select()
    .from(schema.registrationOutboundMessages)
    .where(eq(schema.registrationOutboundMessages.id, messageId))
    .limit(1);
  if (!original) {
    throw new Error('Registration communication was not found.');
  }

  const [copy] = await db
    .insert(schema.registrationOutboundMessages)
    .values({
      message_type: original.message_type,
      recipient_email: original.recipient_email,
      recipient_member_id: original.recipient_member_id,
      registration_id: original.registration_id,
      waitlist_offer_id: original.waitlist_offer_id,
      waitlist_entry_id: original.waitlist_entry_id,
      resend_of_message_id: original.id,
      subject: original.subject,
      html_body: original.html_body,
      text_body: original.text_body,
      payload_json: original.payload_json,
      delivery_status: 'pending',
    })
    .returning();

  const result = await sendEmail({
    to: original.recipient_email,
    recipientName: original.recipient_email,
    subject: original.subject,
    htmlContent: original.html_body,
    textContent: original.text_body,
  });
  const deliveryStatus = deliveryStatusFromResult(result.status);
  const [updated] = await db
    .update(schema.registrationOutboundMessages)
    .set({
      delivery_status: deliveryStatus,
      error_detail: result.error ?? result.reason ?? null,
      sent_at: deliveryStatus === 'sent' ? dbValue(new Date()) : null,
    })
    .where(eq(schema.registrationOutboundMessages.id, copy.id))
    .returning();
  return mapMessageSummary(updated);
}

export async function listRegistrationOutboundMessages(input: {
  registrationId?: number;
  waitlistOfferId?: number;
  limit?: number;
}): Promise<RegistrationEmailSummary[]> {
  const { db, schema } = getDrizzleDb();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  if (input.registrationId) {
    const rows = await db
      .select()
      .from(schema.registrationOutboundMessages)
      .where(eq(schema.registrationOutboundMessages.registration_id, input.registrationId))
      .orderBy(desc(schema.registrationOutboundMessages.created_at), desc(schema.registrationOutboundMessages.id))
      .limit(limit);
    return rows.map(mapMessageSummary);
  }
  if (input.waitlistOfferId) {
    const rows = await db
      .select()
      .from(schema.registrationOutboundMessages)
      .where(eq(schema.registrationOutboundMessages.waitlist_offer_id, input.waitlistOfferId))
      .orderBy(desc(schema.registrationOutboundMessages.created_at), desc(schema.registrationOutboundMessages.id))
      .limit(limit);
    return rows.map(mapMessageSummary);
  }
  const rows = await db
    .select()
    .from(schema.registrationOutboundMessages)
    .orderBy(desc(schema.registrationOutboundMessages.created_at), desc(schema.registrationOutboundMessages.id))
    .limit(limit);
  return rows.map(mapMessageSummary);
}

function mapMessageSummary(row: {
  id: number;
  message_type: RegistrationMessageType;
  recipient_email: string;
  subject: string;
  delivery_status: RegistrationCommunicationDeliveryStatusSqlite;
  sent_at?: string | Date | null;
  created_at: string | Date;
  error_detail?: string | null;
}): RegistrationEmailSummary {
  return {
    id: row.id,
    messageType: row.message_type,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    deliveryStatus: row.delivery_status,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    errorDetail: row.error_detail ?? null,
  };
}
