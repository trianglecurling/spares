import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getDatabaseConfig } from '../db/config.js';
import { Member } from '../types.js';
import { config } from '../config.js';
import { isAdmin, normalizeEmail, verifyToken } from '../utils/auth.js';
import { createCaptchaChallenge, verifyCaptchaAnswer } from '../utils/captcha.js';
import { sendEmail } from '../services/email.js';

const feedbackCategorySchema = z.enum(['suggestion', 'problem', 'question', 'general']);

const submitFeedbackSchema = z.object({
  category: feedbackCategorySchema,
  email: z.string().email().optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  body: z.string().min(1),
  captchaToken: z.string().optional(),
  captchaAnswer: z.union([z.string(), z.number()]).optional(),
  pagePath: z.string().optional(),
});

function isMemberExpired(member: Member): boolean {
  if (!member.valid_through) return false;
  const validThrough = new Date(member.valid_through);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  validThrough.setHours(0, 0, 0, 0);
  return today > validThrough;
}

async function getMemberFromOptionalAuth(request: FastifyRequest): Promise<Member | null> {
  const authHeader = request.headers?.authorization;
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const { db, schema } = getDrizzleDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, payload.memberId))
    .limit(1);

  const member = members[0] as Member | undefined;
  if (!member) return null;
  if (isMemberExpired(member)) return null;
  return member;
}

function normalizeTimestamp(value: string | Date | number | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'suggestion':
      return 'Suggestion';
    case 'problem':
      return 'Problem';
    case 'question':
      return 'Question';
    case 'general':
      return 'General feedback';
    default:
      return category;
  }
}

async function getServerAdminRecipients(): Promise<Array<{ email: string; name: string }>> {
  const recipients = new Map<string, string>(); // email -> name

  // 1) Server admins from env + db-config file
  for (const email of config.admins || []) {
    const normalized = normalizeEmail(email);
    if (normalized) recipients.set(normalized, normalized);
  }
  const dbConfig = getDatabaseConfig();
  for (const email of dbConfig?.adminEmails || []) {
    const normalized = normalizeEmail(email);
    if (normalized) recipients.set(normalized, normalized);
  }

  // 2) Members flagged as server admins in DB
  const { db, schema } = getDrizzleDb();
  const serverAdmins = await db
    .select({ email: schema.members.email, name: schema.members.name })
    .from(schema.members)
    .where(eq(schema.members.is_server_admin, 1));

  for (const m of serverAdmins) {
    const normalized = normalizeEmail(m.email);
    if (!normalized) continue;
    recipients.set(normalized, m.name || normalized);
  }

  return Array.from(recipients.entries()).map(([email, name]) => ({ email, name }));
}

export async function publicFeedbackRoutes(fastify: FastifyInstance) {
  fastify.get('/feedback/captcha', async () => {
    return createCaptchaChallenge();
  });

  fastify.post('/feedback', async (request, reply) => {
    const parsed = submitFeedbackSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const member = await getMemberFromOptionalAuth(request);
    const isLoggedIn = !!member;

    if (!isLoggedIn) {
      if (!body.captchaToken || body.captchaAnswer === undefined) {
        return reply.code(400).send({ error: 'CAPTCHA required' });
      }
      const answerNum = typeof body.captchaAnswer === 'number' ? body.captchaAnswer : Number(body.captchaAnswer);
      if (!Number.isFinite(answerNum)) {
        return reply.code(400).send({ error: 'Invalid CAPTCHA answer' });
      }
      const result = verifyCaptchaAnswer(body.captchaToken, answerNum);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
    }

    const { db, schema } = getDrizzleDb();
    const userAgent = request.headers['user-agent'];
    const emailToStore = member?.email || body.email;

    await db.insert(schema.feedback).values({
      category: body.category,
      body: body.body,
      email: emailToStore || null,
      member_id: member?.id ?? null,
      page_path: body.pagePath || null,
      user_agent: typeof userAgent === 'string' ? userAgent : null,
    });

    // Logged-in users: notify all server admins by email (best-effort; don't block submission)
    if (member) {
      try {
        const recipients = await getServerAdminRecipients();
        const submittedBy = `${member.name}${member.email ? ` (${member.email})` : ''}`;
        const subject = `Feedback: ${categoryLabel(body.category)} from ${member.name}`;
        const adminLink = `${config.frontendUrl}/admin/feedback`;
        const pagePath = body.pagePath ? escapeHtml(body.pagePath) : '(unknown)';
        const detail = escapeHtml(body.body);

        const htmlContent = `
          <h2>New feedback submitted</h2>
          <p><strong>Category:</strong> ${escapeHtml(categoryLabel(body.category))}</p>
          <p><strong>Submitted by:</strong> ${escapeHtml(submittedBy)} (Member #${member.id})</p>
          <p><strong>Page:</strong> <span style="font-family: monospace;">${pagePath}</span></p>
          <p><strong>Details:</strong></p>
          <pre style="white-space: pre-wrap; padding: 12px; background: #f7f7f7; border: 1px solid #e0e0e0; border-radius: 6px;">${detail}</pre>
          <p><a href="${adminLink}">View all feedback</a></p>
        `;

        await Promise.all(
          recipients.map((r) =>
            sendEmail({
              to: r.email,
              subject,
              htmlContent,
              recipientName: r.name || r.email,
            })
          )
        );
      } catch (e) {
        console.error('Failed to email server admins about feedback:', e);
      }
    }

    return { ok: true };
  });
}

export async function protectedFeedbackRoutes(fastify: FastifyInstance) {
  fastify.get('/feedback', async (request, reply) => {
    const member = request.member;
    if (!member) return reply.code(401).send({ error: 'Unauthorized' });
    if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const { db, schema } = getDrizzleDb();

    const rows = await db
      .select({
        id: schema.feedback.id,
        category: schema.feedback.category,
        body: schema.feedback.body,
        email: schema.feedback.email,
        memberId: schema.feedback.member_id,
        pagePath: schema.feedback.page_path,
        userAgent: schema.feedback.user_agent,
        createdAt: schema.feedback.created_at,
        memberName: schema.members.name,
        memberEmail: schema.members.email,
      })
      .from(schema.feedback)
      .leftJoin(schema.members, eq(schema.feedback.member_id, schema.members.id))
      .orderBy(desc(schema.feedback.created_at))
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      body: r.body,
      email: r.email,
      memberId: r.memberId,
      pagePath: r.pagePath,
      userAgent: r.userAgent,
      createdAt: normalizeTimestamp(r.createdAt),
      memberName: r.memberName,
      memberEmail: r.memberEmail,
    }));
  });
}

