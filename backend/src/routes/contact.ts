import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendEmail } from '../services/email.js';
import {
  getPublicContactRecipientBySlug,
  isGroupEventContactRecipient,
} from '../domains/content/publicContactRecipients.js';
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

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

const requestSchema = z
  .object({
    recipient: contactRecipientSlugSchema,
    email: z.string().email().max(320),
    subject: optionalTrimmedText(160),
    body: optionalTrimmedText(8000),
    fullName: optionalTrimmedText(200),
    organizationName: optionalTrimmedText(200),
    estimatedGroupSize: optionalTrimmedText(80),
    preferredDates: optionalTrimmedText(4000),
    /** When true, also email a copy of the message to the sender. */
    sendCopy: z.boolean().optional().default(false),
    /** Honeypot — must be empty; filled values get silent success after tarpit. */
    website: z.string().max(200).optional(),
    captchaToken: z.string().min(1),
    captchaAnswer: z.union([z.string(), z.number()]),
  })
  .superRefine((data, ctx) => {
    if (isGroupEventContactRecipient(data.recipient)) {
      if (!data.fullName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fullName'], message: 'Full name is required' });
      }
      if (!data.organizationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationName'],
          message: 'Company/organization/group name is required',
        });
      }
      return;
    }

    if (!data.subject || data.subject.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject'], message: 'Subject is required' });
    }
    if (!data.body || data.body.length < 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'Message is required' });
    }
  });

export type ContactRequestPayload = z.infer<typeof requestSchema>;

export function parseContactRequest(body: unknown) {
  return requestSchema.safeParse(body ?? {});
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphRow(label: string, value: string): string {
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function preformattedRow(label: string, value: string): string {
  return `<p><strong>${escapeHtml(label)}:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${escapeHtml(value)}</pre>`;
}

export function resolveContactEmailSubject(payload: ContactRequestPayload): string {
  if (payload.subject) {
    return payload.subject;
  }
  if (isGroupEventContactRecipient(payload.recipient) && payload.organizationName) {
    return `Group event inquiry from ${payload.organizationName}`;
  }
  if (isGroupEventContactRecipient(payload.recipient)) {
    return 'Group event inquiry';
  }
  return 'Contact form message';
}

export function buildContactEmailHtml(options: {
  payload: ContactRequestPayload;
  recipientLabel: string;
  isCopy: boolean;
}): string {
  const { payload, recipientLabel, isCopy } = options;
  const isGroupEvent = isGroupEventContactRecipient(payload.recipient);
  const heading = isCopy
    ? isGroupEvent
      ? 'Copy of your group event inquiry to Triangle Curling Club'
      : 'Copy of your message to Triangle Curling Club'
    : isGroupEvent
      ? 'New group event inquiry'
      : 'New public contact submission';
  const footer = isCopy
    ? 'This is a copy of the message you submitted through the public contact form.'
    : 'Submitted through the public contact form.';
  const subject = resolveContactEmailSubject(payload);

  const rows: string[] = [
    `<h2>${escapeHtml(heading)}</h2>`,
    paragraphRow('Recipient category', recipientLabel),
  ];

  if (payload.fullName) {
    rows.push(paragraphRow('Full name', payload.fullName));
  }
  if (payload.organizationName) {
    rows.push(paragraphRow('Company/organization/group name', payload.organizationName));
  }
  rows.push(paragraphRow(isCopy ? 'Email' : 'From', payload.email));
  if (payload.estimatedGroupSize) {
    rows.push(paragraphRow('Estimated group size', payload.estimatedGroupSize));
  }
  if (payload.preferredDates) {
    rows.push(preformattedRow('Preferred dates', payload.preferredDates));
  }
  if (!isGroupEvent) {
    rows.push(paragraphRow('Subject', subject));
  }
  if (payload.body) {
    rows.push(preformattedRow(isGroupEvent ? 'Additional questions/comments' : 'Message', payload.body));
  }
  rows.push(`<p style="font-size: 13px; color: #555;">${escapeHtml(footer)}</p>`);

  return `
      ${rows.join('\n      ')}
    `;
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
      const parsed = parseContactRequest(request.body);
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

      const subject = resolveContactEmailSubject(payload);
      const htmlContent = buildContactEmailHtml({
        payload,
        recipientLabel: recipientInfo.label,
        isCopy: false,
      });

      const delivery = await sendEmail({
        to: recipientInfo.email,
        subject: `[Contact Form] ${subject}`,
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
        const copyHtmlContent = buildContactEmailHtml({
          payload,
          recipientLabel: recipientInfo.label,
          isCopy: true,
        });

        const copyDelivery = await sendEmail({
          to: payload.email,
          subject: `Copy: ${subject}`,
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
