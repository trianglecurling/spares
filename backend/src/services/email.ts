import { EmailClient, EmailMessage } from '@azure/communication-email';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq } from 'drizzle-orm';
import { formatDateForEmail, formatTimeForEmail } from '../utils/dateFormat.js';
import type { FormattedEventWhen } from '../utils/formatEventTimespans.js';
import { logEvent } from './observability.js';

let emailClient: EmailClient | null = null;
let smtpTransporter: Transporter | null = null;
let testModeSmtpTransporter: Transporter | null = null;
let cachedConfig: { connectionString: string; senderEmail: string; disableEmail: boolean; testMode: boolean } | null = null;
let configCacheTimestamp = 0;
const CONFIG_CACHE_TTL = 5000; // Cache for 5 seconds

async function getConfigFromDatabase() {
  const now = Date.now();
  if (cachedConfig && (now - configCacheTimestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  // Important: on fresh/partially-migrated databases, selecting columns from server_config
  // can throw (e.g. "column does not exist"). In that case, fall back to env config
  // and let sendEmail() log to console if not configured.
  let serverConfig:
    | {
        azure_connection_string?: string | null;
        azure_sender_email?: string | null;
        disable_email?: number | null;
        test_mode?: number | null;
      }
    | undefined;

  try {
    const { db, schema } = getDrizzleDb();
    const serverConfigs = await db
      .select({
        azure_connection_string: schema.serverConfig.azure_connection_string,
        azure_sender_email: schema.serverConfig.azure_sender_email,
        disable_email: schema.serverConfig.disable_email,
        test_mode: schema.serverConfig.test_mode,
      })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);

    serverConfig = serverConfigs[0];
  } catch (error) {
    console.warn(
      '[Email Service] Failed to read server_config from database; falling back to env config. Error:',
      error
    );
    serverConfig = undefined;
  }

  cachedConfig = {
    connectionString: serverConfig?.azure_connection_string || config.azure.connectionString,
    senderEmail: serverConfig?.azure_sender_email || config.azure.senderEmail,
    disableEmail: serverConfig?.disable_email === 1,
    testMode: serverConfig?.test_mode === 1,
  };
  configCacheTimestamp = now;
  
  return cachedConfig;
}

export function clearEmailClient() {
  emailClient = null;
  smtpTransporter = null;
  testModeSmtpTransporter = null;
}

function getTestModeSmtpTransporter(): Transporter {
  if (!testModeSmtpTransporter) {
    testModeSmtpTransporter = nodemailer.createTransport({
      host: config.testMailer.smtpHost,
      port: config.testMailer.smtpPort,
      secure: false,
    });
  }
  return testModeSmtpTransporter;
}

function getSmtpTransporter(): Transporter {
  if (!config.smtp.host) {
    throw new Error('SMTP is not configured');
  }
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      ...(config.smtp.user
        ? { auth: { user: config.smtp.user, pass: config.smtp.pass } }
        : {}),
    });
  }
  return smtpTransporter;
}

async function sendWithSmtp(
  options: EmailOptions,
  fullHtmlContent: string,
  senderAddress: string
): Promise<void> {
  const transporter = getSmtpTransporter();
  await sendMailWithTransporter(transporter, options, fullHtmlContent, senderAddress);
}

async function sendMailWithTransporter(
  transporter: Transporter,
  options: EmailOptions,
  fullHtmlContent: string,
  senderAddress: string
): Promise<void> {
  await transporter.sendMail({
    from: senderAddress,
    to: options.to,
    subject: options.subject,
    html: fullHtmlContent,
    ...(options.textContent ? { text: options.textContent } : {}),
    ...(options.replyTo && options.replyTo.trim().length > 0
      ? { replyTo: options.replyTo.trim() }
      : {}),
  });
}

async function getEmailClient(): Promise<EmailClient> {
  const dbConfig = await getConfigFromDatabase();
  
  if (!emailClient && dbConfig.connectionString) {
    emailClient = new EmailClient(dbConfig.connectionString);
  }
  if (!emailClient) {
    throw new Error('Email client not configured');
  }
  return emailClient;
}

interface EmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  recipientName: string;
  replyTo?: string;
}

export interface EmailDeliveryResult {
  status: 'sent' | 'logged' | 'failed';
  reason?: string;
  error?: string;
}

function getLoginRedirectUrl(pathAndSearch: string): string {
  return `${config.frontendUrl}/login?redirect=${encodeURIComponent(pathAndSearch)}`;
}

function buildFullHtmlContent(htmlContent: string, _memberToken?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${htmlContent}
    </body>
    </html>
  `;
}

function logEmail(options: EmailOptions, fullHtmlContent: string, prefix: string): void {
  console.log('='.repeat(80));
  console.log(`[${prefix}] Email would be sent:`);
  console.log('To:', options.to);
  console.log('Subject:', options.subject);
  console.log('Recipient Name:', options.recipientName);
  console.log('HTML Content:');
  console.log(fullHtmlContent);
  console.log('='.repeat(80));
}

export async function sendEmail(options: EmailOptions, memberToken?: string): Promise<EmailDeliveryResult> {
  console.log(`[Email Service] sendEmail called for ${options.to}`);
  const fullHtmlContent = buildFullHtmlContent(options.htmlContent, memberToken);

  // Special case: Never send emails to @example.com addresses (log instead)
  if (options.to.toLowerCase().endsWith('@example.com')) {
    console.log(`[Email Service] Blocking email to @example.com address: ${options.to}`);
    logEmail(options, fullHtmlContent, 'EXAMPLE.COM BLOCKED');
    logEvent({ eventType: 'email.logged', meta: { reason: 'blocked_example_com' } }).catch(() => {});
    return { status: 'logged', reason: 'blocked_example_com' };
  }

  const dbConfig = await getConfigFromDatabase();
  console.log(`[Email Service] Config: disableEmail=${dbConfig.disableEmail}, testMode=${dbConfig.testMode}`);

  if (dbConfig.disableEmail) {
    console.log(`[Email Service] Email disabled - logging email instead of sending`);
    logEmail(options, fullHtmlContent, 'DISABLED');
    logEvent({ eventType: 'email.logged', meta: { reason: 'disabled' } }).catch(() => {});
    return { status: 'logged', reason: 'disabled' };
  }

  const smtpFrom = config.smtp.from || dbConfig.senderEmail;

  if (dbConfig.testMode) {
    try {
      const transporter = getTestModeSmtpTransporter();
      await sendMailWithTransporter(transporter, options, fullHtmlContent, smtpFrom);
      console.log(
        `[Email Service] Test mode: sent via SMTP to ${config.testMailer.smtpHost}:${config.testMailer.smtpPort}`
      );
      logEvent({ eventType: 'email.sent', meta: { test_mode: true } }).catch(() => {});
      return { status: 'sent' };
    } catch (error) {
      console.error(
        '[Email Service] Test mode SMTP send failed - logging to console instead:',
        error
      );
      logEmail(options, fullHtmlContent, 'TEST MODE SMTP FAILED - LOGGED');
      logEvent({ eventType: 'email.logged', meta: { reason: 'test_mode_smtp_failed' } }).catch(
        () => {}
      );
      return { status: 'failed', reason: 'test_mode_smtp_failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  const useSmtp = Boolean(config.smtp.host);
  if (!useSmtp && !dbConfig.connectionString) {
    console.log('Email not configured. Would send:', options);
    logEvent({ eventType: 'email.logged', meta: { reason: 'not_configured' } }).catch(() => {});
    return { status: 'logged', reason: 'not_configured' };
  }

  try {
    if (useSmtp) {
      await sendWithSmtp(options, fullHtmlContent, smtpFrom);
      logEvent({ eventType: 'email.sent' }).catch(() => {});
    } else {
      const client = await getEmailClient();

      // senderAddress must be just the email address, not formatted with display name
      // Display name is not directly supported in the Azure Email SDK senderAddress field
      const message: EmailMessage = {
        senderAddress: dbConfig.senderEmail,
        content: {
          subject: options.subject,
          html: fullHtmlContent,
          ...(options.textContent ? { plainText: options.textContent } : {}),
        },
        recipients: {
          to: [{ address: options.to, displayName: options.recipientName }],
        },
      };
      if (options.replyTo && options.replyTo.trim().length > 0) {
        (message as EmailMessage & { replyTo: Array<{ address: string }> }).replyTo = [
          { address: options.replyTo.trim() },
        ];
      }

      const poller = await client.beginSend(message);
      await poller.pollUntilDone();
      logEvent({ eventType: 'email.sent' }).catch(() => {});
    }
    return { status: 'sent' };
  } catch (error) {
    // If sending fails for any reason (misconfiguration, transient outage, etc),
    // fall back to logging so auth/login flows can continue.
    console.error('[Email Service] Error sending email - logging to console instead:', error);
    logEmail(options, fullHtmlContent, 'SEND FAILED - LOGGED');
    logEvent({ eventType: 'email.logged', meta: { reason: 'send_failed' } }).catch(() => {});
    return { status: 'failed', reason: 'send_failed', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendAuthCodeEmail(
  email: string,
  name: string,
  code: string
): Promise<void> {
  const htmlContent = `
    <h2>Your Triangle Curling Login Code</h2>
    <p>Hi ${name},</p>
    <p>Your login code is: <strong style="font-size: 24px; color: #121033;">${code}</strong></p>
    <p>This code will expire in 10 minutes.</p>
    <p>If you didn't request this code, you can safely ignore this email.</p>
  `;

  await sendEmail(
    {
      to: email,
      subject: `Your login code: ${code}`,
      htmlContent,
      recipientName: name,
    }
  );
}

export async function sendSpareRequestEmail(
  recipientEmail: string,
  recipientName: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
    message?: string;
    invitedMemberNames?: string[]; // For private requests
  },
  spareRequestId: number
): Promise<void> {
  const positionText = requestDetails.position
    ? ` as <strong>${requestDetails.position}</strong>`
    : '';

  const messageText = requestDetails.message
    ? `<p><em>Message: "${requestDetails.message}"</em></p>`
    : '';

  // Build the list of invited members for private requests
  const invitedMembersList = requestDetails.invitedMemberNames && requestDetails.invitedMemberNames.length > 0
    ? `
    <p>This spare request was sent privately to ${requestDetails.invitedMemberNames.length} member${requestDetails.invitedMemberNames.length === 1 ? '' : 's'}:</p>
    <ul>
      ${requestDetails.invitedMemberNames.map(name => `<li>${name}</li>`).join('\n      ')}
    </ul>
    `
    : '';

  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';
  const acceptUrl = getLoginRedirectUrl(`/spare-request/respond?requestId=${spareRequestId}`);
  const declineUrl = getLoginRedirectUrl(`/spare-request/decline?requestId=${spareRequestId}`);

  const htmlContent = `
    <h2>New Spare Request</h2>
    <p>Hi ${recipientName},</p>
    <p>${requesterName} has requested a spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${invitedMembersList}
    ${messageText}
    <p>
      <a href="${acceptUrl}" 
         style="display: inline-block; background-color: #01B9BC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 10px;">
        Accept This Spare
      </a>
    </p>
    ${
      requestDetails.invitedMemberNames && requestDetails.invitedMemberNames.length > 0
        ? `<p>
      <a href="${declineUrl}"
         style="display: inline-block; background-color: #6b7280; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; margin-top: 8px;">
        Decline
      </a>
    </p>
    <p style="color: #666; font-size: 14px;">If you decline, you can optionally include a message.</p>`
        : ''
    }
    <p style="color: #666; font-size: 14px;">Or copy this link: ${acceptUrl}</p>
  `;

  await sendEmail(
    {
      to: recipientEmail,
      subject: `Spare needed: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName,
    }
  );
}

export async function sendPrivateInviteDeclinedEmail(
  requesterEmail: string,
  requesterName: string,
  declinerName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment: string,
  requesterToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const myRequestsUrl = `${config.frontendUrl}/my-requests`;

  const htmlContent = `
    <h2>Private Invite Declined</h2>
    <p>Hi ${requesterName},</p>
    <p><strong>${declinerName}</strong> declined your private spare request for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    <p><strong>Message:</strong> "${comment}"</p>
    <p>You can manage this request on your <a href="${myRequestsUrl}">My requests</a> page.</p>
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Declined: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendAllPrivateInvitesDeclinedEmail(
  requesterEmail: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  requesterToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const myRequestsUrl = `${config.frontendUrl}/my-requests`;

  const htmlContent = `
    <h2>All Invitees Declined</h2>
    <p>Hi ${requesterName},</p>
    <p>All invited members have declined your private spare request for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    <p>
      Next steps:
      <ul>
        <li>Invite more people</li>
        <li>Or convert the request to public (this cannot be undone) to start notifying available spares automatically</li>
      </ul>
    </p>
    <p>Go to <a href="${myRequestsUrl}">My requests</a> to manage this request.</p>
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `All declined: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendSpareRequestCreatedEmail(
  requesterEmail: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
    message?: string;
  },
  requesterToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const messageText = requestDetails.message ? `<p><em>Message: "${requestDetails.message}"</em></p>` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Request Created</h2>
    <p>Hi ${requesterName},</p>
    <p>You created a spare request for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${messageText}
    <p>You can view and manage this request from your "My spare requests" page.</p>
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Spare request created: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendSpareRequestCcCreatedEmail(
  ccEmail: string,
  ccName: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
    message?: string;
  },
  ccToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const messageText = requestDetails.message ? `<p><em>Message: "${requestDetails.message}"</em></p>` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>You were CC'd on a Spare Request</h2>
    <p>Hi ${ccName},</p>
    <p><strong>${requesterName}</strong> created a spare request for <strong>${requestDetails.requestedForName}</strong>${positionText} and CC'd you on it.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${messageText}
    <p>This email is for your awareness. You can log in to view it on your dashboard.</p>
  `;

  await sendEmail(
    {
      to: ccEmail,
      subject: `CC: Spare needed ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: ccName,
    },
    ccToken
  );
}

export async function sendSpareRequestCcFilledEmail(
  ccEmail: string,
  ccName: string,
  requesterName: string,
  responderName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment?: string,
  ccToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const commentText = comment ? `<p><em>Comment: "${comment}"</em></p>` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Request Filled (CC)</h2>
    <p>Hi ${ccName},</p>
    <p>This is an update for a spare request you were CC'd on.</p>
    <p><strong>${responderName}</strong> has agreed to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Requested by:</strong> ${requesterName}</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${commentText}
  `;

  await sendEmail(
    {
      to: ccEmail,
      subject: `CC: Spare request filled${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: ccName,
    },
    ccToken
  );
}

export async function sendSpareRequestCcCancellationEmail(
  ccEmail: string,
  ccName: string,
  requesterName: string,
  responderName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment: string,
  ccToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Cancellation (CC)</h2>
    <p>Hi ${ccName},</p>
    <p>This is an update for a spare request you were CC'd on.</p>
    <p><strong>${responderName}</strong> has canceled their offer to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Requested by:</strong> ${requesterName}</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    <p><strong>Reason:</strong> "${comment}"</p>
  `;

  await sendEmail(
    {
      to: ccEmail,
      subject: `CC: Spare cancellation: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: ccName,
    },
    ccToken
  );
}

export async function sendSpareRequestCancelledEmail(
  recipientEmail: string,
  recipientName: string,
  cancelledByName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  recipientToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Request Canceled</h2>
    <p>Hi ${recipientName},</p>
    <p><strong>${cancelledByName}</strong> canceled the spare request for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
  `;

  await sendEmail(
    {
      to: recipientEmail,
      subject: `Spare request canceled: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName,
    },
    recipientToken
  );
}

export async function sendSpareRequestCancelConfirmationEmail(
  cancellerEmail: string,
  cancellerName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  cancellerToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Request Cancellation Confirmation</h2>
    <p>Hi ${cancellerName},</p>
    <p>This confirms you canceled the spare request for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
  `;

  await sendEmail(
    {
      to: cancellerEmail,
      subject: `Spare request cancellation confirmation: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: cancellerName,
    },
    cancellerToken
  );
}

export async function sendSpareResponseEmail(
  requesterEmail: string,
  requesterName: string,
  responderName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment?: string,
  requesterToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const commentText = comment ? `<p><em>Comment: "${comment}"</em></p>` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Request Filled</h2>
    <p>Hi ${requesterName},</p>
    <p><strong>${responderName}</strong> has agreed to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${commentText}
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Your spare request has been filled${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendSpareCancellationEmail(
  requesterEmail: string,
  requesterName: string,
  responderName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment: string,
  requesterToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Cancellation</h2>
    <p>Hi ${requesterName},</p>
    <p><strong>${responderName}</strong> has canceled their offer to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    <p><strong>Reason:</strong> "${comment}"</p>
    <p>You can re-issue this spare request from your "My spare requests" page.</p>
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Spare cancellation: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendSpareOfferConfirmationEmail(
  responderEmail: string,
  responderName: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment?: string,
  responderToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const commentText = comment ? `<p><em>Your comment: "${comment}"</em></p>` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>You're Signed Up to Spare</h2>
    <p>Hi ${responderName},</p>
    <p>Thanks — you are signed up to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Requested by:</strong> ${requesterName}</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    ${commentText}
    <p>If something changes and you can't make it, please cancel your offer in the app as soon as possible.</p>
  `;

  await sendEmail(
    {
      to: responderEmail,
      subject: `Spare confirmation: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: responderName,
    },
    responderToken
  );
}

export async function sendSpareOfferCancellationConfirmationEmail(
  responderEmail: string,
  responderName: string,
  requesterName: string,
  requestDetails: {
    leagueName?: string;
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
  },
  comment: string,
  responderToken?: string
): Promise<void> {
  const positionText = requestDetails.position ? ` (${requestDetails.position})` : '';
  const formattedDate = formatDateForEmail(requestDetails.gameDate);
  const formattedTime = formatTimeForEmail(requestDetails.gameTime);
  const leagueLine = requestDetails.leagueName
    ? `<p><strong>League:</strong> ${requestDetails.leagueName}</p>`
    : '';

  const htmlContent = `
    <h2>Spare Offer Canceled</h2>
    <p>Hi ${responderName},</p>
    <p>This confirms you canceled your offer to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Requested by:</strong> ${requesterName}</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${leagueLine}
    <p><strong>Your reason:</strong> "${comment}"</p>
  `;

  await sendEmail(
    {
      to: responderEmail,
      subject: `Spare cancellation confirmation: ${formattedDate} at ${formattedTime}${requestDetails.leagueName ? ` (${requestDetails.leagueName})` : ''}`,
      htmlContent,
      recipientName: responderName,
    },
    responderToken
  );
}

export async function sendWelcomeEmail(
  email: string,
  name: string
): Promise<void> {
  const loginUrl = `${config.frontendUrl}/login`;
  const htmlContent = `
    <h2>Welcome to Triangle Curling</h2>
    <p>Hi ${name},</p>
    <p>Your Triangle Curling Club member account gives you access to leagues, events, and other club resources—including finding spares when you can&rsquo;t make your game, and signing up to spare for others.</p>
    <p>To get started, sign in with your email address and the one-time code we send you.</p>
    <p>
      <a href="${loginUrl}" 
         style="display: inline-block; background-color: #fa4c06; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 10px;">
        Get Started
      </a>
    </p>
    <p>See you on the ice!</p>
  `;

  await sendEmail(
    {
      to: email,
      subject: 'Welcome to Triangle Curling',
      htmlContent,
      recipientName: name,
    }
  );
}

export interface ByeRequestEntry {
  drawDate: string;
  priority: number;
}

export async function sendByeRequestsConfirmationEmail(
  to: string,
  recipientName: string,
  leagueName: string,
  teamName: string,
  requests: ByeRequestEntry[],
  updatedByName: string
): Promise<void> {
  const sorted = [...requests].sort((a, b) => a.drawDate.localeCompare(b.drawDate));

  const rows =
    sorted.length === 0
      ? '<p><em>No bye priorities submitted.</em></p>'
      : `
    <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="text-align: left; padding: 8px; border: 1px solid #ddd;">Date</th>
          <th style="text-align: left; padding: 8px; border: 1px solid #ddd;">Bye priority</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map(
            (r) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;">${formatDateForEmail(r.drawDate)}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${r.priority}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  const htmlContent = `
    <h2>Bye requests updated</h2>
    <p>Hi ${recipientName},</p>
    <p>Your team's bye requests for <strong>${leagueName}</strong> have been updated.</p>
    <p><strong>Updated by:</strong> ${updatedByName}</p>
    <p><strong>Team:</strong> ${teamName}</p>
    <p><strong>Bye priorities (schedule):</strong></p>
    ${rows}
    <p>Lower priority numbers are preferred byes (1 = highest preference). These will be considered when the league schedule is generated.</p>
  `;

  await sendEmail({
    to,
    subject: `Bye requests updated – ${leagueName} (${teamName})`,
    htmlContent,
    recipientName: recipientName || to,
  });
}

function escapeHtmlEmail(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DonationReceiptEmailOptions {
  to: string;
  donorName: string;
  amountMinor: number;
  currency: string;
  receivedAt: Date;
  treasurerName: string;
  paymentDetailsUrl?: string | null;
}

function formatDonationAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatDonationReceiptDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: config.timeZone,
  });
}

export async function sendDonationReceiptEmail(options: DonationReceiptEmailOptions): Promise<void> {
  const donorName = escapeHtmlEmail(options.donorName);
  const amount = escapeHtmlEmail(formatDonationAmount(options.amountMinor, options.currency));
  const receivedDate = escapeHtmlEmail(formatDonationReceiptDate(options.receivedAt));
  const treasurerName = escapeHtmlEmail(options.treasurerName);

  const paymentDetailsLine = options.paymentDetailsUrl
    ? `<p><a href="${escapeHtmlEmail(options.paymentDetailsUrl)}">View payment details</a></p>`
    : '';

  const htmlContent = `
    <p>Dear ${donorName},</p>
    <p>
      Thank you for your generous donation of ${amount} to Triangle Curling Club, received on ${receivedDate}.
      We sincerely appreciate your support of our mission and the impact your contribution makes.
    </p>
    ${paymentDetailsLine}
    <p>
      Triangle Curling Club of North Carolina is a qualified 501(c)(3) tax-exempt organization.
      Our EIN is 56-1997682. No goods or services were provided in exchange for this contribution, so the full
      amount of your donation may be tax-deductible to the extent allowed by law.
    </p>
    <p>Thank you again for your kindness and support.</p>
    <p>Sincerely,</p>
    <p>
      ${treasurerName}<br />
      Treasurer<br />
      Triangle Curling Club of North Carolina<br />
      P.O. Box 14687<br />
      Durham, NC 27709<br />
      <a href="mailto:treasurer@trianglecurling.com">treasurer@trianglecurling.com</a>
    </p>
  `;

  const textContent = [
    `Dear ${options.donorName},`,
    '',
    `Thank you for your generous donation of ${formatDonationAmount(options.amountMinor, options.currency)} to Triangle Curling Club, received on ${formatDonationReceiptDate(options.receivedAt)}.`,
    options.paymentDetailsUrl ? `View payment details: ${options.paymentDetailsUrl}` : null,
    '',
    'Triangle Curling Club of North Carolina is a qualified 501(c)(3) tax-exempt organization.',
    'Our EIN is 56-1997682. No goods or services were provided in exchange for this contribution, so the full amount of your donation may be tax-deductible to the extent allowed by law.',
    '',
    'Thank you again for your kindness and support.',
    '',
    options.treasurerName,
    'Treasurer',
    'Triangle Curling Club of North Carolina',
  ].filter(Boolean).join('\n');

  await sendEmail({
    to: options.to,
    subject: `Donation receipt - Triangle Curling Club (${receivedDate})`,
    htmlContent,
    textContent,
    recipientName: options.donorName,
  });
}

const ICE_PURPOSE_LABELS: Record<string, string> = {
  practice: 'Practice',
  makeup_game: 'Make-up game',
  guests: 'Bringing guests',
  guests_new: 'Bringing guests: new curlers',
  guests_experienced: 'Bringing guests: experienced',
  other: 'Other',
};

export async function sendIceBookingConfirmationEmail(
  to: string,
  recipientName: string,
  details: {
    sheetName: string;
    startIso: string;
    endIso: string;
    purpose: string;
    purposeOther?: string | null;
    guestNames?: string | null;
  },
  memberToken?: string
): Promise<void> {
  const start = new Date(details.startIso);
  const end = new Date(details.endIso);
  const whenStr = `${start.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const purposeLabel = ICE_PURPOSE_LABELS[details.purpose] ?? details.purpose;
  const otherLine =
    details.purpose === 'other' && details.purposeOther
      ? `<p><strong>Notes:</strong> ${escapeHtmlEmail(details.purposeOther)}</p>`
      : '';
  const guestNamesLine =
    (details.purpose === 'guests_new' || details.purpose === 'guests_experienced') && details.guestNames
      ? `<p><strong>Guest names:</strong> ${escapeHtmlEmail(details.guestNames)}</p>`
      : '';

  const htmlContent = `
    <h2>Ice time booked</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>Your ice booking is confirmed.</p>
    <p><strong>When:</strong> ${escapeHtmlEmail(whenStr)}</p>
    <p><strong>Sheet:</strong> ${escapeHtmlEmail(details.sheetName)}</p>
    <p><strong>Purpose:</strong> ${escapeHtmlEmail(purposeLabel)}</p>
    ${otherLine}
    ${guestNamesLine}
    <p>Please review the facility rules shown in the app after booking. At least one other person must be on premises with you; you may not use the ice alone.</p>
  `;

  await sendEmail(
    {
      to,
      subject: `Ice time confirmed: Sheet ${details.sheetName}`,
      htmlContent,
      recipientName,
    },
    memberToken
  );
}

export type EventRegistrationEmailLinks = {
  manageRegistrationUrl?: string;
  receiptUrl?: string | null;
  pointOfContact?: string;
  manageLinkLabel?: string;
  manageSecuritySubject?: string;
};

function eventPointOfContactSections(pointOfContact?: string | null): { html: string; text: string } {
  const trimmed = pointOfContact?.trim();
  if (!trimmed) return { html: '', text: '' };

  return {
    html: `<p>Questions about this event? Contact <a href="mailto:${escapeHtmlEmail(trimmed)}">${escapeHtmlEmail(trimmed)}</a>.</p>`,
    text: `Questions about this event? Contact ${trimmed}.`,
  };
}

function eventRegistrationEmailLinkSections(links?: EventRegistrationEmailLinks): { html: string; text: string } {
  if (!links?.manageRegistrationUrl && !links?.receiptUrl) {
    return { html: '', text: '' };
  }

  const receiptHtml = links.receiptUrl
    ? `<p><a href="${escapeHtmlEmail(links.receiptUrl)}">View payment receipt</a></p>`
    : '';
  const manageLabel = links.manageLinkLabel ?? 'Manage your registration';
  const manageSubject = links.manageSecuritySubject ?? 'registration';
  const manageHtml = links.manageRegistrationUrl
    ? `<p><a href="${escapeHtmlEmail(links.manageRegistrationUrl)}">${escapeHtmlEmail(manageLabel)}</a></p>`
    : '';
  const securityHtml = links.manageRegistrationUrl
    ? `<p><strong>Important:</strong> Do not forward this email. Anyone with the manage link above can view or change your ${escapeHtmlEmail(manageSubject)}.</p>`
    : '';

  const receiptText = links.receiptUrl ? `View payment receipt: ${links.receiptUrl}` : null;
  const manageText = links.manageRegistrationUrl ? `${manageLabel}: ${links.manageRegistrationUrl}` : null;
  const securityText = links.manageRegistrationUrl
    ? `Important: Do not forward this email. Anyone with the manage link above can view or change your ${manageSubject}.`
    : null;

  return {
    html: `${receiptHtml}${manageHtml}${securityHtml}`,
    text: [receiptText, manageText, securityText].filter(Boolean).join('\n'),
  };
}

export async function sendEventRegistrationPaymentConfirmationEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  eventWhen: FormattedEventWhen,
  groupSize: number,
  paymentDetailsUrl: string,
  memberToken?: string,
  links?: EventRegistrationEmailLinks
): Promise<void> {
  const groupLine = groupSize > 1
    ? `<p><strong>Group size:</strong> ${groupSize}</p>`
    : '';

  const linkSections = eventRegistrationEmailLinkSections({
    manageRegistrationUrl: links?.manageRegistrationUrl,
    receiptUrl: links?.receiptUrl ?? paymentDetailsUrl,
  });
  const contactSections = eventPointOfContactSections(links?.pointOfContact);

  const htmlContent = `
    <h2>Payment received</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>We received your payment and your registration is confirmed.</p>
    <p><strong>Event:</strong> ${escapeHtmlEmail(eventTitle)}</p>
    <p><strong>When:</strong><br>${eventWhen.html}</p>
    ${groupLine}
    ${linkSections.html || `<p><a href="${escapeHtmlEmail(paymentDetailsUrl)}">View payment details</a></p>`}
    ${contactSections.html}
  `;

  const textBody = [
    'Payment received',
    '',
    `Hi ${recipientName},`,
    '',
    'We received your payment and your registration is confirmed.',
    '',
    `Event: ${eventTitle}`,
    `When: ${eventWhen.text}`,
    groupSize > 1 ? `Group size: ${groupSize}` : null,
    linkSections.text || `View payment details: ${paymentDetailsUrl}`,
    contactSections.text || null,
  ].filter(Boolean).join('\n');

  await sendEmail(
    {
      to,
      subject: `Payment received: ${eventTitle}`,
      htmlContent,
      textContent: textBody,
      recipientName,
    },
    memberToken
  );
}

export async function sendEventRegistrationConfirmationEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  eventWhen: FormattedEventWhen,
  status: 'confirmed' | 'pending_payment' | 'waitlisted',
  groupSize: number,
  memberToken?: string,
  links?: EventRegistrationEmailLinks
): Promise<void> {
  const statusLabel = status === 'confirmed'
    ? 'Your registration is confirmed!'
    : status === 'waitlisted'
      ? 'You have been added to the waitlist.'
      : 'Your registration is pending payment.';

  const groupLine = groupSize > 1
    ? `<p><strong>Group size:</strong> ${groupSize}</p>`
    : '';

  const isWaitlisted = status === 'waitlisted';
  const linkSections = eventRegistrationEmailLinkSections({
    ...links,
    receiptUrl: isWaitlisted ? null : links?.receiptUrl,
    manageLinkLabel: isWaitlisted ? 'Manage your waitlist entry' : links?.manageLinkLabel,
    manageSecuritySubject: isWaitlisted ? 'waitlist entry' : links?.manageSecuritySubject,
  });
  const contactSections = eventPointOfContactSections(links?.pointOfContact);

  const htmlContent = `
    <h2>Event registration</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>${statusLabel}</p>
    <p><strong>Event:</strong> ${escapeHtmlEmail(eventTitle)}</p>
    <p><strong>When:</strong><br>${eventWhen.html}</p>
    ${groupLine}
    ${linkSections.html}
    ${contactSections.html}
  `;

  const textBody = [
    'Event registration',
    '',
    `Hi ${recipientName},`,
    '',
    statusLabel,
    '',
    `Event: ${eventTitle}`,
    `When: ${eventWhen.text}`,
    groupSize > 1 ? `Group size: ${groupSize}` : null,
    linkSections.text || null,
    contactSections.text || null,
  ].filter(Boolean).join('\n');

  await sendEmail(
    {
      to,
      subject: `Registration ${status === 'confirmed' ? 'confirmed' : status === 'waitlisted' ? 'waitlisted' : 'pending'}: ${eventTitle}`,
      htmlContent,
      textContent: textBody,
      recipientName,
    },
    memberToken
  );
}

export async function sendEventRegistrationCancelledEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  refundIssued: boolean,
  memberToken?: string,
  options?: {
    refundReceiptUrl?: string | null;
    pointOfContact?: string;
    isWaitlistEntry?: boolean;
  }
): Promise<void> {
  const isWaitlistEntry = options?.isWaitlistEntry === true;
  const refundReceiptUrl = isWaitlistEntry ? null : (options?.refundReceiptUrl?.trim() || null);
  const contactSections = eventPointOfContactSections(options?.pointOfContact);

  const refundLine = !isWaitlistEntry && refundIssued
    ? '<p>A full refund has been issued and should appear within a few business days.</p>'
    : '';

  const refundReceiptHtml = refundReceiptUrl
    ? `<p><a href="${escapeHtmlEmail(refundReceiptUrl)}">View refund receipt</a></p>`
    : '';

  const heading = isWaitlistEntry ? 'Waitlist entry canceled' : 'Registration canceled';
  const canceledLine = isWaitlistEntry
    ? `Your waitlist entry for <strong>${escapeHtmlEmail(eventTitle)}</strong> has been canceled.`
    : `Your registration for <strong>${escapeHtmlEmail(eventTitle)}</strong> has been canceled.`;

  const htmlContent = `
    <h2>${heading}</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>${canceledLine}</p>
    ${refundLine}
    ${refundReceiptHtml}
    ${contactSections.html}
  `;

  const textBody = [
    heading,
    '',
    `Hi ${recipientName},`,
    '',
    isWaitlistEntry
      ? `Your waitlist entry for ${eventTitle} has been canceled.`
      : `Your registration for ${eventTitle} has been canceled.`,
    !isWaitlistEntry && refundIssued ? 'A full refund has been issued and should appear within a few business days.' : null,
    refundReceiptUrl ? `View refund receipt: ${refundReceiptUrl}` : null,
    contactSections.text || null,
  ].filter(Boolean).join('\n');

  await sendEmail(
    {
      to,
      subject: `${heading}: ${eventTitle}`,
      htmlContent,
      textContent: textBody,
      recipientName,
    },
    memberToken
  );
}

export async function sendEventWaitlistPromotionEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  needsPayment: boolean,
  eventUrl: string,
  memberToken?: string
): Promise<void> {
  await sendEventWaitlistPromotionOfferEmail(
    to,
    recipientName,
    eventTitle,
    needsPayment,
    3,
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    eventUrl,
    memberToken,
  );
}

export async function sendEventWaitlistPromotionOfferEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  needsPayment: boolean,
  respondByDays: number,
  expiresAt: Date,
  offerUrl: string,
  memberToken?: string,
): Promise<void> {
  const expiresLabel = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const declineUrl = `${offerUrl}${offerUrl.includes('?') ? '&' : '?'}action=decline`;
  const paymentLine = needsPayment
    ? 'You can accept the spot and complete payment from the link below.'
    : 'You can accept the spot from the link below — no payment is required.';

  const htmlContent = `
    <h2>A spot opened up!</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>Good news — a spot has opened for <strong>${escapeHtmlEmail(eventTitle)}</strong>.</p>
    <p>You have <strong>${respondByDays} day${respondByDays === 1 ? '' : 's'}</strong> to respond (until ${escapeHtmlEmail(expiresLabel)}).</p>
    <p>${paymentLine}</p>
    <p><a href="${escapeHtmlEmail(offerUrl)}">Review and respond to this offer</a></p>
    <p><a href="${escapeHtmlEmail(declineUrl)}">Decline this spot</a></p>
    <p><strong>Event:</strong> ${escapeHtmlEmail(eventTitle)}</p>
  `;

  const textBody = [
    'A spot opened up!',
    '',
    `Hi ${recipientName},`,
    '',
    `Good news — a spot has opened for ${eventTitle}.`,
    `You have ${respondByDays} day${respondByDays === 1 ? '' : 's'} to respond (until ${expiresLabel}).`,
    paymentLine,
    '',
    `Review and respond: ${offerUrl}`,
    `Decline this spot: ${declineUrl}`,
  ].join('\n');

  await sendEmail(
    {
      to,
      subject: `Spot available: ${eventTitle}`,
      htmlContent,
      textContent: textBody,
      recipientName,
    },
    memberToken,
  );
}

export async function sendEventRegistrationPaymentRaceWaitlistEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  eventWhen: FormattedEventWhen,
  waitlistPosition: number,
  waitlistLength: number,
  links?: EventRegistrationEmailLinks,
): Promise<void> {
  const linkSections = eventRegistrationEmailLinkSections(links);
  const contactSections = eventPointOfContactSections(links?.pointOfContact);
  const positionLine =
    waitlistLength > 0
      ? `You have been placed on the waitlist at position ${waitlistPosition} of ${waitlistLength}.`
      : `You have been placed on the waitlist at position ${waitlistPosition}.`;

  const htmlContent = `
    <h2>Payment received — event filled</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>We received your payment, but the event filled before your payment completed.</p>
    <p>${positionLine}</p>
    <p>A full refund has been issued, and it should appear on your statement within the next few business days.</p>
    <p><strong>Event:</strong> ${escapeHtmlEmail(eventTitle)}</p>
    <p><strong>When:</strong><br>${eventWhen.html}</p>
    ${linkSections.html}
    ${contactSections.html}
  `;

  const textBody = [
    'Payment received — event filled',
    '',
    `Hi ${recipientName},`,
    '',
    'We received your payment, but the event filled before your payment completed.',
    positionLine,
    'A full refund has been issued, and it should appear on your statement within the next few business days.',
    '',
    `Event: ${eventTitle}`,
    `When: ${eventWhen.text}`,
    linkSections.text || null,
    contactSections.text || null,
  ].filter(Boolean).join('\n');

  await sendEmail({
    to,
    subject: `Waitlisted after payment: ${eventTitle}`,
    htmlContent,
    textContent: textBody,
    recipientName,
  });
}

export async function sendEventRegistrationPaymentRaceCancelledEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  eventWhen: FormattedEventWhen,
  links?: EventRegistrationEmailLinks,
): Promise<void> {
  const contactSections = eventPointOfContactSections(links?.pointOfContact);

  const htmlContent = `
    <h2>Payment received — registration could not be completed</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>We received your payment, but the event filled before your payment completed and the waitlist is not available for this event.</p>
    <p>Your registration could not be completed.</p>
    <p>A full refund has been issued, and it should appear on your statement within the next few business days.</p>
    <p><strong>Event:</strong> ${escapeHtmlEmail(eventTitle)}</p>
    <p><strong>When:</strong><br>${eventWhen.html}</p>
    ${contactSections.html}
  `;

  const textBody = [
    'Payment received — registration could not be completed',
    '',
    `Hi ${recipientName},`,
    '',
    'We received your payment, but the event filled before your payment completed and the waitlist is not available for this event.',
    'Your registration could not be completed.',
    'A full refund has been issued, and it should appear on your statement within the next few business days.',
    '',
    `Event: ${eventTitle}`,
    `When: ${eventWhen.text}`,
    contactSections.text || null,
  ].filter(Boolean).join('\n');

  await sendEmail({
    to,
    subject: `Registration could not be completed: ${eventTitle}`,
    htmlContent,
    textContent: textBody,
    recipientName,
  });
}

export type EventRegistrationFormEmailRow = {
  key: string;
  label: string;
  value: string;
};

export type EventRegistrationFormFieldChange = {
  label: string;
  oldValue: string;
  newValue: string;
};

function eventRegistrationFormRowsHtml(rows: EventRegistrationFormEmailRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (row) =>
        `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;"><strong>${escapeHtmlEmail(row.label)}</strong></td><td style="padding:4px 0;vertical-align:top;">${escapeHtmlEmail(row.value)}</td></tr>`,
    )
    .join('');
  return `<table style="border-collapse:collapse;">${body}</table>`;
}

function eventRegistrationFormRowsText(rows: EventRegistrationFormEmailRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}

function eventRegistrationFormChangesHtml(changes: EventRegistrationFormFieldChange[]): string {
  if (changes.length === 0) return '';
  const body = changes
    .map(
      (change) =>
        `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;"><strong>${escapeHtmlEmail(change.label)}</strong></td><td style="padding:4px 8px 4px 0;vertical-align:top;">${escapeHtmlEmail(change.oldValue)}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtmlEmail(change.newValue)}</td></tr>`,
    )
    .join('');
  return `<table style="border-collapse:collapse;"><thead><tr><th align="left" style="padding:0 12px 8px 0;">Field</th><th align="left" style="padding:0 8px 8px 0;">Previous</th><th align="left" style="padding:0 0 8px 0;">New</th></tr></thead><tbody>${body}</tbody></table>`;
}

function eventRegistrationFormChangesText(changes: EventRegistrationFormFieldChange[]): string {
  return changes
    .map((change) => `${change.label}\n  Previous: ${change.oldValue}\n  New: ${change.newValue}`)
    .join('\n\n');
}

export async function sendEventPointOfContactNewRegistrationEmail(
  to: string,
  eventTitle: string,
  registrantName: string,
  registrantEmail: string,
  status: string,
  formRows: EventRegistrationFormEmailRow[],
): Promise<void> {
  const formHtml = eventRegistrationFormRowsHtml(formRows);
  const formText = eventRegistrationFormRowsText(formRows);

  const htmlContent = `
    <h2>New event registration</h2>
    <p>A new registration was submitted for <strong>${escapeHtmlEmail(eventTitle)}</strong>.</p>
    <p><strong>Registrant:</strong> ${escapeHtmlEmail(registrantName)} (${escapeHtmlEmail(registrantEmail)})</p>
    <p><strong>Status:</strong> ${escapeHtmlEmail(status)}</p>
    ${formHtml ? `<h3>Submitted information</h3>${formHtml}` : ''}
  `;

  const textBody = [
    'New event registration',
    '',
    `A new registration was submitted for ${eventTitle}.`,
    '',
    `Registrant: ${registrantName} (${registrantEmail})`,
    `Status: ${status}`,
    formText ? '' : null,
    formText ? 'Submitted information:' : null,
    formText || null,
  ].filter((line) => line !== null).join('\n');

  await sendEmail({
    to,
    subject: `New registration: ${eventTitle}`,
    htmlContent,
    textContent: textBody,
    recipientName: to,
  });
}

export async function sendEventPointOfContactRegistrationUpdatedEmail(
  to: string,
  eventTitle: string,
  registrantName: string,
  registrantEmail: string,
  changes: EventRegistrationFormFieldChange[],
): Promise<void> {
  const changesHtml = eventRegistrationFormChangesHtml(changes);
  const changesText = eventRegistrationFormChangesText(changes);

  const htmlContent = `
    <h2>Registration updated</h2>
    <p>${escapeHtmlEmail(registrantName)} (${escapeHtmlEmail(registrantEmail)}) updated their registration for <strong>${escapeHtmlEmail(eventTitle)}</strong>.</p>
    <h3>Changes</h3>
    ${changesHtml}
  `;

  const textBody = [
    'Registration updated',
    '',
    `${registrantName} (${registrantEmail}) updated their registration for ${eventTitle}.`,
    '',
    'Changes:',
    changesText,
  ].join('\n');

  await sendEmail({
    to,
    subject: `Registration updated: ${eventTitle}`,
    htmlContent,
    textContent: textBody,
    recipientName: to,
  });
}

export async function sendEventPointOfContactRegistrationCancelledEmail(
  to: string,
  eventTitle: string,
  registrantName: string,
  registrantEmail: string,
  formRows: EventRegistrationFormEmailRow[],
  isWaitlistEntry = false,
): Promise<void> {
  const formHtml = eventRegistrationFormRowsHtml(formRows);
  const formText = eventRegistrationFormRowsText(formRows);

  const heading = isWaitlistEntry ? 'Waitlist entry canceled' : 'Registration canceled';
  const canceledLine = isWaitlistEntry
    ? `${escapeHtmlEmail(registrantName)} (${escapeHtmlEmail(registrantEmail)}) canceled their waitlist entry for <strong>${escapeHtmlEmail(eventTitle)}</strong>.`
    : `${escapeHtmlEmail(registrantName)} (${escapeHtmlEmail(registrantEmail)}) canceled their registration for <strong>${escapeHtmlEmail(eventTitle)}</strong>.`;
  const formHeading = isWaitlistEntry ? 'Waitlist entry information' : 'Registration information';

  const htmlContent = `
    <h2>${heading}</h2>
    <p>${canceledLine}</p>
    ${formHtml ? `<h3>${formHeading}</h3>${formHtml}` : ''}
  `;

  const textBody = [
    heading,
    '',
    isWaitlistEntry
      ? `${registrantName} (${registrantEmail}) canceled their waitlist entry for ${eventTitle}.`
      : `${registrantName} (${registrantEmail}) canceled their registration for ${eventTitle}.`,
    formText ? '' : null,
    formText ? `${formHeading}:` : null,
    formText || null,
  ].filter((line) => line !== null).join('\n');

  await sendEmail({
    to,
    subject: `${heading}: ${eventTitle}`,
    htmlContent,
    textContent: textBody,
    recipientName: to,
  });
}

export async function sendEventOwnerNewRegistrationEmail(
  to: string,
  ownerName: string,
  eventTitle: string,
  registrantName: string,
  registrantEmail: string,
  groupSize: number,
  status: string
): Promise<void> {
  const htmlContent = `
    <h2>New event registration</h2>
    <p>Hi ${escapeHtmlEmail(ownerName)},</p>
    <p>A new registration has been received for <strong>${escapeHtmlEmail(eventTitle)}</strong>.</p>
    <p><strong>Registrant:</strong> ${escapeHtmlEmail(registrantName)} (${escapeHtmlEmail(registrantEmail)})</p>
    <p><strong>Group size:</strong> ${groupSize}</p>
    <p><strong>Status:</strong> ${escapeHtmlEmail(status)}</p>
  `;

  await sendEmail({
    to,
    subject: `New registration for ${eventTitle}`,
    htmlContent,
    recipientName: ownerName,
  });
}

export async function sendEventCancelledEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  memberToken?: string
): Promise<void> {
  const htmlContent = `
    <h2>Event canceled</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>The event <strong>${escapeHtmlEmail(eventTitle)}</strong> has been canceled.</p>
    <p>If you were registered and paid a fee, a refund will be processed within a few business days.</p>
  `;

  await sendEmail(
    {
      to,
      subject: `Event canceled: ${eventTitle}`,
      htmlContent,
      recipientName,
    },
    memberToken
  );
}

export async function sendEventReminderEmail(
  to: string,
  recipientName: string,
  eventTitle: string,
  eventDateStr: string,
  eventUrl: string,
  memberToken?: string
): Promise<void> {
  const htmlContent = `
    <h2>Event reminder</h2>
    <p>Hi ${escapeHtmlEmail(recipientName)},</p>
    <p>This is a reminder that <strong>${escapeHtmlEmail(eventTitle)}</strong> is coming up.</p>
    <p><strong>When:</strong> ${escapeHtmlEmail(eventDateStr)}</p>
    <p><a href="${eventUrl}">View event details</a></p>
  `;

  await sendEmail(
    {
      to,
      subject: `Reminder: ${eventTitle}`,
      htmlContent,
      recipientName,
    },
    memberToken
  );
}

