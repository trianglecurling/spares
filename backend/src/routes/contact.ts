import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { sendEmail } from '../services/email.js';

const pendingContactTtlMs = 30 * 60 * 1000;

const contactRecipients = {
  general: {
    label: 'General info and questions',
    email: 'info@trianglecurling.com',
  },
  membership: {
    label: 'Leagues and membership inquiries',
    email: 'membership@trianglecurling.com',
  },
  marketing: {
    label: 'Media inquiries, advertising, merchandise',
    email: 'marketing@trianglecurling.com',
  },
  rentals: {
    label: 'Private events, team building, corporate outings',
    email: 'rentals@trianglecurling.com',
  },
  juniors: {
    label: 'Youth & junior programs',
    email: 'juniors@trianglecurling.com',
  },
  operations: {
    label: 'Facilities & contractors',
    email: 'operations@trianglecurling.com',
  },
  learntocurl: {
    label: 'Learn-to-curl events',
    email: 'learntocurl@trianglecurling.com',
  },
  pickupandpizza: {
    label: 'Pick-Up and Pizza/Pick-Up and Play',
    email: 'pickupandpizza@trianglecurling.com',
  },
  web: {
    label: 'Website issues',
    email: 'web@trianglecurling.com',
  },
  president: {
    label: 'Contact the president',
    email: 'president@trianglecurling.com',
  },
} as const;

type ContactRecipientKey = keyof typeof contactRecipients;

const requestSchema = z.object({
  recipient: z.enum([
    'general',
    'membership',
    'marketing',
    'rentals',
    'juniors',
    'operations',
    'learntocurl',
    'pickupandpizza',
    'web',
    'president',
  ]),
  email: z.string().email().max(320),
  subject: z.string().trim().min(2).max(160),
  body: z.string().trim().min(10).max(8000),
  website: z.string().max(0).optional(),
});

const confirmSchema = z.object({
  token: z.string().trim().min(20).max(300),
});

type PendingContactMessage = {
  recipient: ContactRecipientKey;
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

function createToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
}

function publicContactConfirmUrl(token: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  const encodedToken = encodeURIComponent(token);
  return `${base}/contact/confirm?token=${encodedToken}`;
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

    cleanupExpiredPendingMessages();

    const token = createToken();
    const now = Date.now();
    const expiresAt = now + pendingContactTtlMs;

    pendingMessages.set(token, {
      recipient: payload.recipient,
      senderEmail: payload.email,
      subject: payload.subject,
      body: payload.body,
      createdAt: now,
      expiresAt,
    });

    const recipientInfo = contactRecipients[payload.recipient];
    const confirmUrl = publicContactConfirmUrl(token);
    const safeSubject = escapeHtml(payload.subject);
    const safeBody = escapeHtml(payload.body);
    const safeSenderEmail = escapeHtml(payload.email);

    const htmlContent = `
      <h2>Confirm your contact message</h2>
      <p>Please click &quot;Send now&quot; to confirm sending your message below.</p>

      <div style="margin: 18px 0;">
        <a href="${confirmUrl}" style="display: inline-block; background-color: #0f766e; color: #ffffff; padding: 14px 24px; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 16px;">
          Send now
        </a>
      </div>

      <p style="font-size: 13px; color: #555;">This link expires in 30 minutes.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p><strong>From:</strong> ${safeSenderEmail}</p>
      <p><strong>To:</strong> ${escapeHtml(recipientInfo.label)}</p>
      <p><strong>Subject:</strong> ${safeSubject}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space: pre-wrap; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">${safeBody}</pre>
      <p style="font-size: 13px; color: #555;">If the button does not work, use this link: ${confirmUrl}</p>
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

    const token = parsed.data.token;
    const pending = pendingMessages.get(token);
    if (!pending) {
      return reply.code(400).send({ error: 'This confirmation link is invalid or has expired.' });
    }

    pendingMessages.delete(token);

    const recipientInfo = contactRecipients[pending.recipient];
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
      includeUnsubscribeFooter: false,
    });

    return { ok: true };
  });
}
