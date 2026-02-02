import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, like, gt } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  generateAuthCode,
  generateToken,
  normalizeEmail,
  isAdmin,
  isServerAdmin,
} from '../utils/auth.js';
import { sendAuthCodeEmail } from '../services/email.js';
import { sendAuthCodeSMS } from '../services/sms.js';
import { Member } from '../types.js';
import type { AuthenticatedMember } from '../types.js';
import type {
  ApiErrorResponse,
  AuthRequestCodeBody,
  AuthRequestCodeResponse,
  AuthSelectMemberBody,
  AuthVerifyCodeBody,
  AuthVerifyCodeResponse,
  AuthVerifyTokenResponse,
} from '../api/types.js';
import { logEvent } from '../services/observability.js';

function normalizeDateString(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function isMemberExpired(member: Member): boolean {
  if (isAdmin(member) || isServerAdmin(member)) return false;
  const validThrough = normalizeDateString(member.valid_through);
  if (!validThrough) return false;
  const today = new Date().toISOString().split('T')[0];
  return today > validThrough;
}

function normalizePhoneDigits10(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function normalizeStoredPhoneDigits10(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return normalizePhoneDigits10(String(value));
}

function phoneDigits10ToE164(digits10: string): string {
  return `+1${digits10}`;
}

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

const authMemberResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    firstLoginCompleted: { type: 'boolean' },
    optedInSms: { type: 'boolean' },
    emailSubscribed: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    themePreference: { type: 'string' },
  },
  required: [
    'id',
    'name',
    'email',
    'phone',
    'spareOnly',
    'isAdmin',
    'isServerAdmin',
    'firstLoginCompleted',
    'optedInSms',
    'emailSubscribed',
    'emailVisible',
    'phoneVisible',
    'themePreference',
  ],
} as const;

const authRequestCodeBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contact: { type: 'string', minLength: 1 },
  },
  required: ['contact'],
} as const;

const authRequestCodeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    multipleMembers: { type: 'boolean' },
  },
  required: ['success', 'multipleMembers'],
} as const;

const authVerifyCodeBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contact: { type: 'string', minLength: 1 },
    code: { type: 'string', minLength: 6, maxLength: 6 },
  },
  required: ['contact', 'code'],
} as const;

const authVerifyCodeResponseSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        requiresSelection: { type: 'boolean', enum: [true] },
        tempToken: { type: 'string' },
        members: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
            },
            required: ['id', 'name'],
          },
        },
      },
      required: ['requiresSelection', 'tempToken', 'members'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        token: { type: 'string' },
        member: authMemberResponseSchema,
      },
      required: ['token', 'member'],
    },
  ],
} as const;

const authSelectMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    tempToken: { type: 'string' },
  },
  required: ['memberId', 'tempToken'],
} as const;

const authVerifyTokenResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: authMemberResponseSchema,
  },
  required: ['member'],
} as const;

export async function publicAuthRoutes(fastify: FastifyInstance) {
  // Request auth code
  fastify.post<{ Body: AuthRequestCodeBody; Reply: AuthRequestCodeResponse | ApiErrorResponse }>(
    '/auth/request-code',
    {
      schema: {
        tags: ['auth'],
        body: authRequestCodeBodySchema,
        response: {
          200: authRequestCodeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = requestCodeSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Determine if it's email or phone
    const isEmail = body.contact.includes('@');
    const normalizedContact = isEmail ? normalizeEmail(body.contact) : body.contact;

    let members: Member[] = [];
    let authContactToStore: string;

    if (isEmail) {
      members = await db
        .select()
        .from(schema.members)
        .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedContact})`) as Member[];
      authContactToStore = normalizedContact;
    } else {
      const digits10 = normalizePhoneDigits10(body.contact);
      if (!digits10) {
        return reply.code(404).send({ error: 'No member found with this contact information' });
      }

      // Load candidates and match in JS to handle legacy punctuation/format differences in stored phone values.
      const candidates = await db
        .select()
        .from(schema.members)
        .where(sql`${schema.members.phone} IS NOT NULL AND ${schema.members.phone} != ''`) as Member[];

      members = candidates.filter((m) => normalizeStoredPhoneDigits10(m.phone) === digits10);
      authContactToStore = phoneDigits10ToE164(digits10);
    }

    if (members.length === 0) {
      return reply.code(404).send({ error: 'No member found with this contact information' });
    }

    // Phone login requires SMS enabled for at least one matching member
    if (!isEmail) {
      const anySmsEnabled = members.some((m) => m.opted_in_sms === 1);
      if (!anySmsEnabled) {
        return reply.code(400).send({
          error:
            'SMS messages are not enabled for this user. Please log in with your email address, then update your SMS settings by visiting your profile page.',
        });
      }
    }

    // Generate auth code
    const code = generateAuthCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.insert(schema.authCodes).values({
      contact: authContactToStore,
      code,
      expires_at: expiresAt, // Drizzle PostgreSQL timestamp columns require Date objects, not strings
      used: 0,
    });

    // Best-effort analytics (do not block)
    logEvent({
      eventType: 'auth.code_requested',
      meta: { channel: isEmail ? 'email' : 'sms', matchedMembers: members.length },
    }).catch(() => {});

    // Send code via email or SMS asynchronously (fire-and-forget) to avoid blocking the response
    // Auth codes are time-sensitive but we can still return immediately
    const member = members[0]; // Use first member for sending
    if (isEmail && member.email && member.email_subscribed === 1) {
      sendAuthCodeEmail(authContactToStore, member.name, code).catch((error) => {
        console.error('Error sending auth code email:', error);
      });
    } else if (!isEmail) {
      sendAuthCodeSMS(authContactToStore, code).catch((error) => {
        console.error('Error sending auth code SMS:', error);
      });
    }

      return { success: true, multipleMembers: members.length > 1 };
    }
  );

  // Verify auth code
  fastify.post<{ Body: AuthVerifyCodeBody; Reply: AuthVerifyCodeResponse<AuthenticatedMember> | ApiErrorResponse }>(
    '/auth/verify-code',
    {
      schema: {
        tags: ['auth'],
        body: authVerifyCodeBodySchema,
        response: {
          200: authVerifyCodeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = verifyCodeSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const isEmail = body.contact.includes('@');
    const normalizedContact = isEmail ? normalizeEmail(body.contact) : body.contact;
    const authContactToMatch = isEmail
      ? normalizedContact
      : (() => {
          const digits10 = normalizePhoneDigits10(body.contact);
          return digits10 ? phoneDigits10ToE164(digits10) : body.contact;
        })();

    // Find valid auth code
    const now = new Date().toISOString();
    const authCodes = await db
      .select()
      .from(schema.authCodes)
      .where(
        and(
          eq(schema.authCodes.contact, authContactToMatch),
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
    let members: Member[] = [];
    if (isEmail) {
      members = await db
        .select()
        .from(schema.members)
        .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedContact})`) as Member[];
    } else {
      const digits10 = normalizePhoneDigits10(body.contact);
      if (!digits10) {
        return reply.code(404).send({ error: 'No member found' });
      }
      const candidates = await db
        .select()
        .from(schema.members)
        .where(sql`${schema.members.phone} IS NOT NULL AND ${schema.members.phone} != ''`) as Member[];
      members = candidates.filter((m) => normalizeStoredPhoneDigits10(m.phone) === digits10);
    }

    if (members.length === 0) {
      return reply.code(404).send({ error: 'No member found' });
    }

    // If only one member, generate token and return
    if (members.length === 1) {
      const member = members[0];
      if (isMemberExpired(member)) {
        return reply.code(403).send({ error: 'Membership expired' });
      }
      const token = generateToken(member as Member);

      // Best-effort analytics (do not block)
      logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});

      return {
        token,
        member: {
          id: member.id,
          name: member.name,
          email: member.email,
          phone: member.phone,
          spareOnly: member.spare_only === 1,
          isAdmin: isAdmin(member as Member),
          isServerAdmin: isServerAdmin(member as Member),
          firstLoginCompleted: member.first_login_completed === 1,
          optedInSms: member.opted_in_sms === 1,
          emailSubscribed: member.email_subscribed === 1,
          emailVisible: member.email_visible === 1,
          phoneVisible: member.phone_visible === 1,
          themePreference:
            member.theme_preference === 'light' || member.theme_preference === 'dark' || member.theme_preference === 'system'
              ? member.theme_preference
              : 'system',
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
    }
  );

  // Select member (when multiple members share contact)
  fastify.post<{ Body: AuthSelectMemberBody; Reply: AuthVerifyCodeResponse<AuthenticatedMember> | ApiErrorResponse }>(
    '/auth/select-member',
    {
      schema: {
        tags: ['auth'],
        body: authSelectMemberBodySchema,
        response: {
          200: authVerifyCodeResponseSchema,
        },
      },
    },
    async (request, reply) => {
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

    if (isMemberExpired(member)) {
      return reply.code(403).send({ error: 'Membership expired' });
    }

    const token = generateToken(member as Member);

    // Best-effort analytics (do not block)
    logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});

      return {
      token,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        spareOnly: member.spare_only === 1,
        isAdmin: isAdmin(member),
        isServerAdmin: isServerAdmin(member),
        firstLoginCompleted: member.first_login_completed === 1,
        optedInSms: member.opted_in_sms === 1,
        emailSubscribed: member.email_subscribed === 1,
        emailVisible: member.email_visible === 1,
        phoneVisible: member.phone_visible === 1,
        themePreference:
          member.theme_preference === 'light' || member.theme_preference === 'dark' || member.theme_preference === 'system'
            ? member.theme_preference
            : 'system',
      },
      };
    }
  );
}

export async function protectedAuthRoutes(fastify: FastifyInstance) {
  // Verify token (for auto-login)
  fastify.get<{ Reply: AuthVerifyTokenResponse<AuthenticatedMember> | ApiErrorResponse }>(
    '/auth/verify',
    {
      schema: {
        tags: ['auth'],
        response: {
          200: authVerifyTokenResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

      return {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        spareOnly: member.spare_only === 1,
        isAdmin: isAdmin(member),
        isServerAdmin: isServerAdmin(member),
        firstLoginCompleted: member.first_login_completed === 1,
        optedInSms: member.opted_in_sms === 1,
        emailSubscribed: member.email_subscribed === 1,
        emailVisible: member.email_visible === 1,
        phoneVisible: member.phone_visible === 1,
        themePreference:
          member.theme_preference === 'light' || member.theme_preference === 'dark' || member.theme_preference === 'system'
            ? member.theme_preference
            : 'system',
      },
      };
    }
  );
}
