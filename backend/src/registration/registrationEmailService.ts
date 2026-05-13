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

export interface RegistrationEmailPayload {
  curlerName?: string | null;
  seasonName?: string | null;
  sessionName?: string | null;
  leagueName?: string | null;
  waitlistType?: 'ADD' | 'REPLACE' | string | null;
  replacementLeagueName?: string | null;
  position?: number | null;
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
  changedSummary?: string | null;
  paymentImpact?: string | null;
  deferralReasons?: string[] | null;
  summaryLines?: string[] | null;
  paidItems?: string[] | null;
  paymentReference?: string | null;
  staffContact?: string | null;
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

function staffContact(payload: RegistrationEmailPayload): string {
  return payload.staffContact?.trim() || 'Triangle Curling Club staff';
}

function paymentLinkHtml(payload: RegistrationEmailPayload): string {
  return payload.paymentUrl
    ? `<p><a href="${escapeHtml(payload.paymentUrl)}">Complete your registration payment</a></p>`
    : '<p>No payment link is available yet.</p>';
}

function actionLinksHtml(payload: RegistrationEmailPayload): string {
  const links = [
    payload.acceptUrl ? `<a href="${escapeHtml(payload.acceptUrl)}">Accept this offer</a>` : null,
    payload.declineUrl ? `<a href="${escapeHtml(payload.declineUrl)}">Decline this offer</a>` : null,
    payload.dashboardUrl ? `<a href="${escapeHtml(payload.dashboardUrl)}">View your registration status</a>` : null,
  ].filter(Boolean);
  return links.length > 0 ? `<p>${links.join(' &nbsp; ')}</p>` : '';
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
  const contact = staffContact(payload);
  const summaryHtml = listItems(payload.summaryLines);
  const summaryText = textList(payload.summaryLines);
  const deferralHtml = listItems(payload.deferralReasons);
  const deferralText = textList(payload.deferralReasons);
  const paidItemsHtml = listItems(payload.paidItems ?? payload.summaryLines);
  const paidItemsText = textList(payload.paidItems ?? payload.summaryLines);

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
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Complete your registration payment\n\nRegistration for ${curlerName} (${season}) has been submitted, but it is not fully confirmed until payment is complete.\n\n${summaryText}\n\nAmount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\n\nQuestions? Contact ${contact}.`,
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
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Registration submitted - payment will come later\n\nYou do not need to pay yet. Some choices require placement or staff review first.\n\n${summaryText}\n\nWhy payment is deferred:\n${deferralText}\n\n${payload.paymentUrl ? `Payment link: ${payload.paymentUrl}\n\n` : ''}Questions? Contact ${contact}.`,
      };
    case 'registration_payment_received':
      return {
        subject: 'Registration payment received',
        htmlBody: `
          <h2>Registration payment received</h2>
          <p>Hi ${escapeHtml(curlerName)},</p>
          <p>We received your registration payment for ${escapeHtml(season)}.</p>
          <p><strong>Amount paid:</strong> ${money(payload.amountPaidMinor)}</p>
          ${paidItemsHtml}
          ${payload.paymentReference ? `<p><strong>Payment reference:</strong> ${escapeHtml(payload.paymentReference)}</p>` : ''}
          <p>Any pending waitlist or third-league interest items are not confirmed by this payment.</p>
        `,
        textBody: `Registration payment received\n\nWe received payment for ${curlerName} (${season}).\n\nAmount paid: ${money(payload.amountPaidMinor)}\n${paidItemsText}\n${payload.paymentReference ? `Payment reference: ${payload.paymentReference}\n` : ''}\nPending waitlist or third-league items are not confirmed by this payment.`,
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
        `,
        textBody: `Social membership confirmed\n\nYour social membership is active for ${season} after payment. Social membership does not include ice privileges. Social members cannot play in leagues or spare unless they later upgrade to regular membership and purchase applicable ice privileges. Upgrading later requires paying the full regular membership price with no social membership credit and no discounts.`,
      };
    case 'waitlist_joined':
      return {
        subject: `You have joined the ${leagueName} waitlist`,
        htmlBody: `
          <h2>You have joined the ${escapeHtml(leagueName)} waitlist</h2>
          <p><strong>Waitlist type:</strong> ${escapeHtml(payload.waitlistType ?? 'ADD')}</p>
          ${payload.replacementLeagueName ? `<p><strong>Replacement league:</strong> ${escapeHtml(payload.replacementLeagueName)}</p>` : ''}
          <p><strong>Current position:</strong> ${payload.position ?? 'Not available'}</p>
          <p>Waitlists roll forward to successor leagues unless you are removed, placed, or the waitlist is discontinued.</p>
          ${payload.dashboardUrl ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View waitlist status</a></p>` : ''}
        `,
        textBody: `You have joined the ${leagueName} waitlist\n\nType: ${payload.waitlistType ?? 'ADD'}\n${payload.replacementLeagueName ? `Replacement league: ${payload.replacementLeagueName}\n` : ''}Current position: ${payload.position ?? 'Not available'}\nWaitlists roll forward to successor leagues unless you are removed, placed, or the waitlist is discontinued.\n${payload.dashboardUrl ? `View status: ${payload.dashboardUrl}` : ''}`,
      };
    case 'waitlist_removed_by_member':
      return {
        subject: `You have been removed from the ${leagueName} waitlist`,
        htmlBody: `
          <h2>You have been removed from the waitlist</h2>
          <p>You have been removed from the waitlist for <strong>${escapeHtml(leagueName)}</strong>.</p>
          <p>Your previous waitlist position is no longer held. If this was a mistake, contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `You have been removed from the ${leagueName} waitlist.\n\nYour previous waitlist position is no longer held. If this was a mistake, contact ${contact}.`,
      };
    case 'waitlist_changed_by_staff':
      return {
        subject: `Your ${leagueName} waitlist status changed`,
        htmlBody: `
          <h2>Your waitlist status changed</h2>
          <p>Your waitlist entry for <strong>${escapeHtml(leagueName)}</strong> was updated.</p>
          <p>${escapeHtml(payload.changedSummary || 'Staff updated your waitlist entry.')}</p>
          <p>New position/status: ${escapeHtml(payload.updatedPosition ?? payload.position ?? 'See your account page for details')}</p>
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Your ${leagueName} waitlist status changed.\n\n${payload.changedSummary || 'Staff updated your waitlist entry.'}\nNew position/status: ${payload.updatedPosition ?? payload.position ?? 'See your account page for details'}\nQuestions? Contact ${contact}.`,
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
          <p>If you do not decline this offer within 24 hours, we will treat the offer as accepted and add you to the league. If payment is required, staff will follow up with you.</p>
          ${payload.deadlineText ? `<p><strong>Decline by:</strong> ${escapeHtml(payload.deadlineText)}</p>` : ''}
          ${actionLinksHtml(payload)}
        `,
        textBody: `${temporary ? 'Temporary league spot available' : 'League spot available'}: ${leagueName}\n\n${temporaryText}\n\nIf you do not decline this offer within 24 hours, we will treat the offer as accepted and add you to the league. If payment is required, staff will follow up with you.\n${payload.deadlineText ? `Decline by: ${payload.deadlineText}\n` : ''}${payload.acceptUrl ? `Accept: ${payload.acceptUrl}\n` : ''}${payload.declineUrl ? `Decline: ${payload.declineUrl}\n` : ''}`,
      };
    }
    case 'waitlist_offer_accepted':
      return {
        subject: `League offer accepted: ${leagueName}`,
        htmlBody: `
          <h2>League offer accepted</h2>
          <p>Your offer for <strong>${escapeHtml(leagueName)}</strong> has been accepted${payload.offerResponseSource === 'automatic' ? ' automatically after the response window' : ''}.</p>
          <p>Spot type: ${payload.isTemporarySabbaticalFill ? 'temporary sabbatical-fill' : 'permanent'}.</p>
          <p>${payload.paymentUrl ? 'Payment is ready now.' : 'If payment is required, staff will follow up.'}</p>
          ${payload.paymentUrl ? paymentLinkHtml(payload) : ''}
        `,
        textBody: `League offer accepted: ${leagueName}\n\nYour offer has been accepted${payload.offerResponseSource === 'automatic' ? ' automatically after the response window' : ''}.\nSpot type: ${payload.isTemporarySabbaticalFill ? 'temporary sabbatical-fill' : 'permanent'}.\n${payload.paymentUrl ? `Payment link: ${payload.paymentUrl}` : 'If payment is required, staff will follow up.'}`,
      };
    case 'waitlist_offer_declined':
      return {
        subject: `League offer declined: ${leagueName}`,
        htmlBody: `
          <h2>League offer declined</h2>
          <p>Your offer for <strong>${escapeHtml(leagueName)}</strong> has been declined.</p>
          <p>${(payload.declineCount ?? 0) >= 2 ? 'This was your second decline for this waitlist, so you have moved to the bottom of the waitlist.' : 'This was your first decline for this waitlist, so your position is retained.'}</p>
          <p>Updated position: ${payload.updatedPosition ?? payload.position ?? 'Not available'}</p>
          ${payload.dashboardUrl ? `<p><a href="${escapeHtml(payload.dashboardUrl)}">View waitlist status</a></p>` : ''}
        `,
        textBody: `League offer declined: ${leagueName}\n\n${(payload.declineCount ?? 0) >= 2 ? 'This was your second decline, so you have moved to the bottom of the waitlist.' : 'This was your first decline, so your position is retained.'}\nUpdated position: ${payload.updatedPosition ?? payload.position ?? 'Not available'}\n${payload.dashboardUrl ? `View status: ${payload.dashboardUrl}` : ''}`,
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
        `,
        textBody: `Your registration payment is ready\n\n${summaryText}\n\nAmount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\nPayment is required to complete registration.`,
      };
    case 'junior_assistance_pending':
      return {
        subject: 'Junior Recreational assistance request received',
        htmlBody: `
          <h2>Junior Recreational assistance request received</h2>
          <p>We received the Junior Recreational assistance request for ${escapeHtml(curlerName)}.</p>
          <p><strong>Requested assistance:</strong> ${payload.requestedAssistancePercent ?? 'Not available'}%</p>
          <p>Payment is deferred while staff reviews the request. Staff will follow up with the final amount due.</p>
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Junior Recreational assistance request received\n\nRequested assistance: ${payload.requestedAssistancePercent ?? 'Not available'}%\nPayment is deferred while staff reviews the request. Staff will follow up with the final amount due.\nQuestions? Contact ${contact}.`,
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
          <p>If the approved amount creates a concern, please contact ${escapeHtml(contact)} before paying.</p>
        `,
        textBody: `Junior Recreational registration payment is ready\n\nRequested assistance: ${payload.requestedAssistancePercent ?? 'Not available'}%\nApproved assistance: ${payload.approvedAssistancePercent ?? 0}%\nFinal amount due: ${money(payload.amountDueMinor)}\nPayment link: ${payload.paymentUrl ?? 'Not available'}\nIf the approved amount creates a concern, contact ${contact} before paying.`,
      };
    case 'sabbatical_confirmation':
      return {
        subject: `Sabbatical confirmed for ${leagueName}`,
        htmlBody: `
          <h2>Sabbatical confirmed</h2>
          <p>Your sabbatical for <strong>${escapeHtml(leagueName)}</strong> in ${escapeHtml(season)} has been recorded.</p>
          <p>Sabbatical fee status: ${escapeHtml(payload.sabbaticalFeeStatus || 'See your registration status page')}.</p>
          <p>This preserves your right to return under the sabbatical rules. Sabbaticals are time-limited.</p>
          ${payload.durationLimitWarning ? `<p><strong>${escapeHtml(payload.durationLimitWarning)}</strong></p>` : ''}
        `,
        textBody: `Sabbatical confirmed for ${leagueName}\n\nSabbatical fee status: ${payload.sabbaticalFeeStatus || 'See your registration status page'}.\nThis preserves your right to return under the sabbatical rules. Sabbaticals are time-limited.\n${payload.durationLimitWarning ?? ''}`,
      };
    case 'sabbatical_release':
      return {
        subject: `Your sabbatical spot for ${leagueName} has been released`,
        htmlBody: `
          <h2>Your sabbatical spot has been released</h2>
          <p>The protected sabbatical spot for <strong>${escapeHtml(leagueName)}</strong> has been released.</p>
          <p>Returning later requires joining the waitlist.</p>
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Your sabbatical spot for ${leagueName} has been released.\n\nReturning later requires joining the waitlist. Questions? Contact ${contact}.`,
      };
    case 'byot_registration_confirmation':
      return {
        subject: `BYOT registration received: ${leagueName}`,
        htmlBody: `
          <h2>BYOT registration received</h2>
          <p>Your bring-your-own-team request for <strong>${escapeHtml(leagueName)}</strong> has been submitted.</p>
          <p><strong>Submitted teammates:</strong> ${escapeHtml(payload.teammateText || 'Not provided')}</p>
          <p>BYOT placement is coordinated by the league coordinator. You may be contacted if roster adjustments are needed.</p>
        `,
        textBody: `BYOT registration received: ${leagueName}\n\nSubmitted teammates: ${payload.teammateText || 'Not provided'}\nBYOT placement is coordinated by the league coordinator. You may be contacted if roster adjustments are needed.`,
      };
    case 'registration_manually_updated_by_staff':
      return {
        subject: 'Your registration has been updated',
        htmlBody: `
          <h2>Your registration has been updated</h2>
          <p>Staff updated the registration for ${escapeHtml(curlerName)}.</p>
          <p>${escapeHtml(payload.changedSummary || 'A registration detail was updated by staff.')}</p>
          <p>Payment status: ${escapeHtml(payload.paymentImpact || 'unchanged')}.</p>
          <p>Questions? Contact ${escapeHtml(contact)}.</p>
        `,
        textBody: `Your registration has been updated\n\n${payload.changedSummary || 'A registration detail was updated by staff.'}\nPayment status: ${payload.paymentImpact || 'unchanged'}.\nQuestions? Contact ${contact}.`,
      };
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
    includeUnsubscribeFooter: false,
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

export async function sendRegistrationEmailForDashboard(input: Omit<SendRegistrationEmailInput, 'payload'> & { payload?: RegistrationEmailPayload }): Promise<RegistrationEmailSummary> {
  return sendRegistrationEmail({
    ...input,
    payload: {
      dashboardUrl: `${frontendBaseUrl()}/registration/status${input.registrationId ? `/${input.registrationId}` : ''}`,
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
    includeUnsubscribeFooter: false,
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
