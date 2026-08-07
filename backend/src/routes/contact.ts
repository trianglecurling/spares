import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendEmail } from '../services/email.js';
import { getPublicContactRecipientBySlug } from '../domains/content/publicContactRecipients.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';
import {
  consumeSlidingWindowLimit,
  honeypotTarpitMs,
  tarpitDelay,
} from '../utils/abuseProtection.js';
import { createCaptchaChallenge, verifyCaptchaAnswer } from '../utils/captcha.js';
import { captchaResponseSchema } from '../api/schemas.js';

const EMAIL_LIMIT_PER_HOUR = 3;
const EMAIL_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const contactRecipientSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/);

const requestSchema = z.object({
  recipient: contactRecipientSlugSchema,
  email: z.string().email().max(320),
  subject: z.string().trim().min(2).max(160),
  body: z.string().trim().min(10).max(8000),
  /** When true, also email a copy of the message to the sender. */
  sendCopy: z.boolean().optional().default(false),
  /** Honeypot — must be empty; filled values get silent success after tarpit. */
  website: z.string().max(200).optional(),
  captchaToken: z.string().min(1),
  captchaAnswer: z.union([z.string(), z.number()]),
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function contactRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/public/contact/captcha',
    {
      schema: {
        tags: ['public'],
        response: {
          200: captchaResponseSchema,
        },
      },
    },
    async () => createCaptchaChallenge()
  );

  fastify.post(
    '/public/contact/request',
    {
      config: {
        rateLimit: abuseRouteRateLimits.contact,
      },
    },
    async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      if (payload.website && payload.website.trim().length > 0) {
        await tarpitDelay(honeypotTarpitMs());
        return { ok: true };
      }

      const answerNum =
        typeof payload.captchaAnswer === 'number'
          ? payload.captchaAnswer
          : Number(payload.captchaAnswer);
      if (!Number.isFinite(answerNum)) {
        return reply.code(400).send({ error: 'Invalid CAPTCHA answer' });
      }
      const captchaResult = verifyCaptchaAnswer(payload.captchaToken, answerNum);
      if (!captchaResult.ok) {
        return reply.code(400).send({ error: captchaResult.error });
      }

      const emailKey = `contact-email:${payload.email.toLowerCase().trim()}`;
      if (!consumeSlidingWindowLimit(emailKey, EMAIL_LIMIT_PER_HOUR, EMAIL_LIMIT_WINDOW_MS).ok) {
        return reply.code(429).send({ error: 'Too many contact requests. Please try again later.' });
      }

      const recipientInfo = await getPublicContactRecipientBySlug(payload.recipient);
      if (!recipientInfo) {
        return reply.code(400).send({ error: 'Invalid recipient' });
      }

      const safeSubject = escapeHtml(payload.subject);
      const safeBody = escapeHtml(payload.body);
      const safeSenderEmail = escapeHtml(payload.email);

      const htmlContent = `
      <h2>New public contact submission</h2>
      <p><strong>Recipient category:</strong> ${escapeHtml(recipientInfo.label)}</p>
      <p><strong>From:</strong> ${safeSenderEmail}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${safeBody}</pre>
      <p style="font-size: 13px; color: #555;">Submitted through the public contact form.</p>
    `;

      const delivery = await sendEmail({
        to: recipientInfo.email,
        subject: `[Contact Form] ${payload.subject}`,
        htmlContent,
        recipientName: recipientInfo.label,
        replyTo: payload.email,
        budgetKind: 'public',
        failOpenBudget: false,
      });

      if (delivery.status === 'failed' && delivery.reason === 'send_budget') {
        return reply.code(429).send({ error: 'Too many contact requests. Please try again later.' });
      }

      if (payload.sendCopy) {
        const copyHtmlContent = `
      <h2>Copy of your message to Triangle Curling Club</h2>
      <p><strong>Recipient category:</strong> ${escapeHtml(recipientInfo.label)}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${safeBody}</pre>
      <p style="font-size: 13px; color: #555;">This is a copy of the message you submitted through the public contact form.</p>
    `;

        const copyDelivery = await sendEmail({
          to: payload.email,
          subject: `Copy: ${payload.subject}`,
          htmlContent: copyHtmlContent,
          recipientName: payload.email,
          budgetKind: 'public',
          failOpenBudget: false,
        });
        if (copyDelivery.status === 'failed') {
          request.log.error(
            { reason: copyDelivery.reason, error: copyDelivery.error },
            'Contact form send-copy email failed'
          );
        }
      }

      return { ok: true };
    }
  );
}
