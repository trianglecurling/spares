import { EmailClient, EmailMessage } from '@azure/communication-email';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq } from 'drizzle-orm';
import { formatDateForEmail, formatTimeForEmail } from '../utils/dateFormat.js';

let emailClient: EmailClient | null = null;
let cachedConfig: { connectionString: string; senderEmail: string; disableEmail: boolean; testMode: boolean } | null = null;
let configCacheTimestamp = 0;
const CONFIG_CACHE_TTL = 5000; // Cache for 5 seconds

async function getConfigFromDatabase() {
  const now = Date.now();
  if (cachedConfig && (now - configCacheTimestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

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
  
  const serverConfig = serverConfigs[0];

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
  recipientName: string;
}

function getUnsubscribeFooter(memberToken?: string): string {
  const unsubscribeUrl = memberToken
    ? `${config.frontendUrl}/unsubscribe?token=${memberToken}`
    : `${config.frontendUrl}/unsubscribe`;

  return `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 12px;">
      <p><strong style="color: #d32f2f;">⚠️ Do not forward this email!</strong> The links in this email are tied to your account. If someone else has access to them, they will be able to access your account.</p>
      <p>Triangle Curling Club</p>
      <p><a href="${unsubscribeUrl}" style="color: #666;">Unsubscribe from all emails</a></p>
    </div>
  `;
}

function buildFullHtmlContent(htmlContent: string, memberToken?: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${htmlContent}
      ${getUnsubscribeFooter(memberToken)}
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

export async function sendEmail(options: EmailOptions, memberToken?: string): Promise<void> {
  console.log(`[Email Service] sendEmail called for ${options.to}`);
  const fullHtmlContent = buildFullHtmlContent(options.htmlContent, memberToken);

  // Special case: Never send emails to @example.com addresses (log instead)
  if (options.to.toLowerCase().endsWith('@example.com')) {
    console.log(`[Email Service] Blocking email to @example.com address: ${options.to}`);
    logEmail(options, fullHtmlContent, 'EXAMPLE.COM BLOCKED');
    return;
  }

  const dbConfig = await getConfigFromDatabase();
  console.log(`[Email Service] Config: disableEmail=${dbConfig.disableEmail}, testMode=${dbConfig.testMode}`);
  
  // If email is disabled or in test mode, print to console instead of sending
  if (dbConfig.disableEmail || dbConfig.testMode) {
    console.log(`[Email Service] Email disabled or test mode - logging email instead of sending`);
    logEmail(options, fullHtmlContent, 'TEST MODE');
    return;
  }
  
  if (!dbConfig.connectionString) {
    console.log('Email not configured. Would send:', options);
    return;
  }

  try {
    const client = await getEmailClient();

    // senderAddress must be just the email address, not formatted with display name
    // Display name is not directly supported in the Azure Email SDK senderAddress field
    const message: EmailMessage = {
      senderAddress: dbConfig.senderEmail,
      content: {
        subject: options.subject,
        html: fullHtmlContent,
      },
      recipients: {
        to: [{ address: options.to, displayName: options.recipientName }],
      },
    };

    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
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
    requestedForName: string;
    gameDate: string;
    gameTime: string;
    position?: string;
    message?: string;
    invitedMemberNames?: string[]; // For private requests
  },
  acceptToken: string,
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

  const htmlContent = `
    <h2>New Spare Request</h2>
    <p>Hi ${recipientName},</p>
    <p>${requesterName} has requested a spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${invitedMembersList}
    ${messageText}
    <p>
      <a href="${config.frontendUrl}/spare-request/respond?token=${acceptToken}&requestId=${spareRequestId}" 
         style="display: inline-block; background-color: #01B9BC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 10px;">
        Accept This Spare
      </a>
    </p>
    <p style="color: #666; font-size: 14px;">Or copy this link: ${config.frontendUrl}/spare-request/respond?token=${acceptToken}&requestId=${spareRequestId}</p>
  `;

  await sendEmail(
    {
      to: recipientEmail,
      subject: `Spare needed: ${formattedDate} at ${formattedTime}`,
      htmlContent,
      recipientName,
    },
    acceptToken
  );
}

export async function sendSpareResponseEmail(
  requesterEmail: string,
  requesterName: string,
  responderName: string,
  requestDetails: {
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

  const htmlContent = `
    <h2>Spare Request Filled</h2>
    <p>Hi ${requesterName},</p>
    <p><strong>${responderName}</strong> has agreed to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    ${commentText}
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Your spare request has been filled`,
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

  const htmlContent = `
    <h2>Spare Cancellation</h2>
    <p>Hi ${requesterName},</p>
    <p><strong>${responderName}</strong> has canceled their offer to spare for <strong>${requestDetails.requestedForName}</strong>${positionText}.</p>
    <p><strong>Date:</strong> ${formattedDate}<br>
    <strong>Time:</strong> ${formattedTime}</p>
    <p><strong>Reason:</strong> "${comment}"</p>
    <p>You can re-issue this spare request from your "My spare requests" page.</p>
  `;

  await sendEmail(
    {
      to: requesterEmail,
      subject: `Spare cancellation: ${formattedDate} at ${formattedTime}`,
      htmlContent,
      recipientName: requesterName,
    },
    requesterToken
  );
}

export async function sendWelcomeEmail(
  email: string,
  name: string,
  loginToken: string
): Promise<void> {
  const htmlContent = `
    <h2>Welcome to Triangle Curling Spares</h2>
    <p>Hi ${name},</p>
    <p>Welcome to the Triangle Curling Club spare management system! This application makes it easy to find spares when you can't make your game, and to sign up to spare for others.</p>
    <p>To get started, click the link below to set up your profile and availability:</p>
    <p>
      <a href="${config.frontendUrl}?token=${loginToken}" 
         style="display: inline-block; background-color: #fa4c06; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 10px;">
        Get Started
      </a>
    </p>
    <p>See you on the ice!</p>
  `;

  await sendEmail(
    {
      to: email,
      subject: 'Welcome to Triangle Curling Spares',
      htmlContent,
      recipientName: name,
    },
    loginToken
  );
}

