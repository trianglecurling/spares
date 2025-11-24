import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, like, gt } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  generateAuthCode,
  generateToken,
  normalizeEmail,
  normalizePhone,
  isAdmin,
} from '../utils/auth.js';
import { sendAuthCodeEmail } from '../services/email.js';
import { sendAuthCodeSMS } from '../services/sms.js';
import { Member } from '../types.js';

const requestCodeSchema = z.object({
  contact: z.string().min(1),
});

const verifyCodeSchema = z.object({
  contact: z.string().min(1),
  code: z.string().length(6),
});

const selectMemberSchema = z.object({
  memberId: z.number(),
  tempToken: z.string(),
});

export async function publicAuthRoutes(fastify: FastifyInstance) {
  // Request auth code
  fastify.post('/auth/request-code', async (request, reply) => {
    const body = requestCodeSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Determine if it's email or phone
    const isEmail = body.contact.includes('@');
    const normalizedContact = isEmail
      ? normalizeEmail(body.contact)
      : normalizePhone(body.contact);

    // Find members with this contact info
    const members = await db
      .select()
      .from(schema.members)
      .where(
        isEmail
          ? sql`LOWER(${schema.members.email}) = LOWER(${normalizedContact})`
          : eq(schema.members.phone, normalizedContact)
      );

    if (members.length === 0) {
      return reply.code(404).send({ error: 'No member found with this contact information' });
    }

    // Generate auth code
    const code = generateAuthCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.insert(schema.authCodes).values({
      contact: normalizedContact,
      code,
      expires_at: expiresAt, // Drizzle PostgreSQL timestamp columns require Date objects, not strings
      used: 0,
    });

    // Send code via email or SMS
    const member = members[0]; // Use first member for sending
    if (isEmail && member.email && member.email_subscribed === 1) {
      await sendAuthCodeEmail(normalizedContact, member.name, code);
    } else if (!isEmail && member.phone) {
      await sendAuthCodeSMS(normalizedContact, code);
    }

    return { success: true, multipleMembers: members.length > 1 };
  });

  // Verify auth code
  fastify.post('/auth/verify-code', async (request, reply) => {
    const body = verifyCodeSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const isEmail = body.contact.includes('@');
    const normalizedContact = isEmail
      ? normalizeEmail(body.contact)
      : normalizePhone(body.contact);

    // Find valid auth code
    const now = new Date().toISOString();
    const authCodes = await db
      .select()
      .from(schema.authCodes)
      .where(
        and(
          eq(schema.authCodes.contact, normalizedContact),
          eq(schema.authCodes.code, body.code),
          eq(schema.authCodes.used, 0),
          sql`${schema.authCodes.expires_at} > ${now}`
        )
      )
      .orderBy(desc(schema.authCodes.created_at))
      .limit(1);

    const authCode = authCodes[0];

    if (!authCode) {
      return reply.code(401).send({ error: 'Invalid or expired code' });
    }

    // Mark code as used
    await db
      .update(schema.authCodes)
      .set({ used: 1 })
      .where(eq(schema.authCodes.id, authCode.id));

    // Get members with this contact
    const members = await db
      .select()
      .from(schema.members)
      .where(
        isEmail
          ? sql`LOWER(${schema.members.email}) = LOWER(${normalizedContact})`
          : eq(schema.members.phone, normalizedContact)
      );

    if (members.length === 0) {
      return reply.code(404).send({ error: 'No member found' });
    }

    // If only one member, generate token and return
    if (members.length === 1) {
      const member = members[0];
      const token = generateToken(member as Member);

      return {
        token,
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          phone: member.phone,
          isAdmin: isAdmin(member as Member),
          firstLoginCompleted: member.first_login_completed === 1,
          optedInSms: member.opted_in_sms === 1,
          emailSubscribed: member.email_subscribed === 1,
        },
      };
    }

    // Multiple members - return temporary token for selection
    const tempToken = generateAuthCode();
    await db.insert(schema.authCodes).values({
      contact: `temp:${normalizedContact}`,
      code: tempToken,
      expires_at: new Date(Date.now() + 5 * 60 * 1000), // Drizzle PostgreSQL timestamp columns require Date objects, not strings
      used: 0,
    });

    return {
      requiresSelection: true,
      tempToken,
      members: members.map((m: Member) => ({
        id: m.id,
        name: m.name,
      })),
    };
  });

  // Select member (when multiple members share contact)
  fastify.post('/auth/select-member', async (request, reply) => {
    const body = selectMemberSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Verify temp token
    const now = new Date().toISOString();
    const tempAuths = await db
      .select()
      .from(schema.authCodes)
      .where(
        and(
          eq(schema.authCodes.code, body.tempToken),
          eq(schema.authCodes.used, 0),
          sql`${schema.authCodes.expires_at} > ${now}`,
          like(schema.authCodes.contact, 'temp:%')
        )
      )
      .orderBy(desc(schema.authCodes.created_at))
      .limit(1);

    const tempAuth = tempAuths[0];

    if (!tempAuth) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Mark temp token as used
    await db
      .update(schema.authCodes)
      .set({ used: 1 })
      .where(eq(schema.authCodes.id, tempAuth.id));

    // Get member
    const members = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, body.memberId))
      .limit(1);

    const member = members[0];

    if (!member) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    const token = generateToken(member as Member);

    return {
      token,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        isAdmin: isAdmin(member),
        firstLoginCompleted: member.first_login_completed === 1,
        optedInSms: member.opted_in_sms === 1,
        emailSubscribed: member.email_subscribed === 1,
      },
    };
  });
}

export async function protectedAuthRoutes(fastify: FastifyInstance) {
  // Verify token (for auto-login)
  fastify.get('/auth/verify', async (request, reply) => {
    const member = (request as any).member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    return {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        isAdmin: isAdmin(member),
        firstLoginCompleted: member.first_login_completed === 1,
        optedInSms: member.opted_in_sms === 1,
        emailSubscribed: member.email_subscribed === 1,
      },
    };
  });
}
