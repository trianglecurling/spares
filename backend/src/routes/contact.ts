import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { sendEmail } from '../services/email.js';
import { getPublicContactRecipientBySlug } from '../domains/content/publicContactRecipients.js';

const pendingContactTtlMs = 30 * 60 * 1000;

const contactRecipientSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/);

const requestSchema = z.object({
  recipient: contactRecipientSlugSchema,
  email: z.string().email().max(320),
  subject: z.string().trim().min(2).max(160),
  body: z.string().trim().min(10).max(8000),
  website: z.string().max(0).optional(),
});

const confirmSchema = z.object({
  email: z.string().email().max(320),
  code: z.string().trim().length(6),
});

type PendingContactMessage = {
  recipientSlug: string;
  senderEmail: string;
  subject: string;
  body: string;
  createdAt: number;
  expiresAt: number;
};

const pendingMessages = new Map<string, PendingContactMessage>();

function cleanupExpiredPendingMessages(now = Date.now()): void {
  for (const [token, entry] of pendingMessages.entries()) {
    if (entry.expiresAt <= now) {
      pendingMessages.delete(token);
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function pendingMessageKey(email: string, code: string): string {
  return `${email.toLowerCase().trim()}:${code}`;
}

function publicContactConfirmUrl(): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/contact/confirm`;
}

export async function contactRoutes(fastify: FastifyInstance) {
  fastify.post('/public/contact/request', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    if (payload.website && payload.website.trim().length > 0) {
      return { ok: true };
    }

    const recipientInfo = await getPublicContactRecipientBySlug(payload.recipient, { activeOnly: true });
    if (!recipientInfo) {
      return reply.code(400).send({ error: 'Invalid recipient' });
    }

    cleanupExpiredPendingMessages();

    const code = createCode();
    const now = Date.now();
    const expiresAt = now + pendingContactTtlMs;

    pendingMessages.set(pendingMessageKey(payload.email, code), {
      recipientSlug: payload.recipient,
      senderEmail: payload.email,
      subject: payload.subject,
      body: payload.body,
      createdAt: now,
      expiresAt,
    });

    const confirmUrl = publicContactConfirmUrl();
    const safeSubject = escapeHtml(payload.subject);
    const safeBody = escapeHtml(payload.body);
    const safeSenderEmail = escapeHtml(payload.email);

    const htmlContent = `
      <h2>Confirm your contact message</h2>
      <p>Please enter this code on the contact confirmation page to send your message:</p>

      <p style="font-size: 24px; font-weight: 700; letter-spacing: 0.08em;">${code}</p>

      <div style="margin: 18px 0;">
        <a href="${confirmUrl}" style="display: inline-block; background-color: #0f766e; color: #ffffff; padding: 14px 24px; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 16px;">
          Open confirmation page
        </a>
      </div>

      <p style="font-size: 13px; color: #555;">This code expires in 30 minutes.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p><strong>From:</strong> ${safeSenderEmail}</p>
      <p><strong>To:</strong> ${escapeHtml(recipientInfo.label)}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${safeBody}</pre>
      <p style="font-size: 13px; color: #555;">If the button does not work, visit ${confirmUrl} and enter the code above.</p>
    `;

    await sendEmail({
      to: payload.email,
      subject: 'Confirm your Triangle Curling contact message',
      htmlContent,
      recipientName: payload.email,
    });

    return { ok: true };
  });

  fastify.post('/public/contact/confirm', async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }

    cleanupExpiredPendingMessages();

    const key = pendingMessageKey(parsed.data.email, parsed.data.code);
    const pending = pendingMessages.get(key);
    if (!pending) {
      return reply.code(400).send({ error: 'This confirmation code is invalid or has expired.' });
    }

    pendingMessages.delete(key);

    const recipientInfo = await getPublicContactRecipientBySlug(pending.recipientSlug, { activeOnly: true });
    if (!recipientInfo) {
      return reply.code(400).send({ error: 'This contact category is no longer available.' });
    }

    const safeSubject = escapeHtml(pending.subject);
    const safeBody = escapeHtml(pending.body);
    const safeSenderEmail = escapeHtml(pending.senderEmail);

    const htmlContent = `
      <h2>New public contact submission</h2>
      <p><strong>Recipient category:</strong> ${escapeHtml(recipientInfo.label)}</p>
      <p><strong>From:</strong> ${safeSenderEmail}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${safeBody}</pre>
      <p style="font-size: 13px; color: #555;">Confirmed through public contact page workflow.</p>
    `;

    await sendEmail({
      to: recipientInfo.email,
      subject: `[Contact Form] ${pending.subject}`,
      htmlContent,
      recipientName: recipientInfo.label,
      replyTo: pending.senderEmail,
    });

    return { ok: true };
  });
}
