import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, like } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  generateAuthCode,
  generateTempAuthToken,
  normalizeEmail,
  isAdmin,
  isServerAdmin,
  isCalendarAdmin,
  isContentAdmin,
  isSponsorAdmin,
  LOGIN_DISABLED_MESSAGE,
  membersAllowedToLogin,
  isLoginDisabledForMembers,
} from '../utils/auth.js';
import {
  authVerifyFailKey,
  clearAuthVerifyFailures,
  isAuthVerifyLockedOut,
  isIpLimitBypassed,
  recordAuthVerifyFailure,
} from '../utils/abuseProtection.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';
import { isMemberIdBoundToContact, parseTempAuthContact } from '../utils/authSelectMember.js';
import { buildAuthzClaimsForMember, buildAuthzClaimsForImpersonatedMember, hasScope } from '../utils/rbac.js';
import { sendAuthCodeEmail } from '../services/email.js';
import { sendAuthCodeSMS } from '../services/sms.js';
import {
  listAccountSwitchOptions,
  canActorImpersonateTarget,
} from '../services/accountAccess.js';
import { Member } from '../types.js';
import type { AuthenticatedMember } from '../types.js';
import type {
  ApiErrorResponse,
  AuthRequestCodeBody,
  AuthRequestCodeResponse,
  AuthSelectMemberBody,
  AuthSignInAsBody,
  AuthTokenBody,
  AuthVerifyCodeBody,
  AuthVerifyCodeResponse,
  AuthVerifySuccessResponse,
  AuthVerifyTokenResponse,
} from '../api/types.js';
import { sendApiError } from '../api/errors.js';
import { logEvent } from '../services/observability.js';
import { issueAuthSession, refreshAuthSession, revokeRefreshToken } from '../services/authSessionService.js';
import {
  developerSignInErrorMessage,
  developerSignInErrorStatus,
  evaluateDeveloperSignIn,
} from '../services/developerSignIn.js';
import { memberIsSocialMember, memberIsSpareOnly } from '../utils/memberMembershipHelpers.js';
import { listOwnedEventIds } from '../services/eventService.js';
import { listAssignedManagedCredentialIds } from '../services/credentialService.js';
import { listManagedVolunteerProgramIds } from '../services/volunteeringService.js';
import { personAccountsOnly } from '../utils/accountKind.js';
import { findMemberByPersonalAccessToken } from '../services/personalAccessTokenService.js';
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
  WebAuthnServiceError,
} from '../services/webauthnService.js';

function normalizePhoneDigits10(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function phoneDigits10ToE164(digits10: string): string {
  return `+1${digits10}`;
}

async function findMembersByEmail(normalizedEmail: string): Promise<Member[]> {
  const { db, schema } = getDrizzleDb();
  return (await db
    .select()
    .from(schema.members)
    .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedEmail})`)) as Member[];
}

/**
 * Match members by 10-digit US phone using SQL digit stripping (avoids full-table JS scan).
 */
async function findMembersByPhoneDigits10(digits10: string): Promise<Member[]> {
  const { db, schema } = getDrizzleDb();
  const withCountry = `1${digits10}`;
  return (await db
    .select()
    .from(schema.members)
    .where(
      sql`regexp_replace(COALESCE(${schema.members.phone}, ''), '[^0-9]', '', 'g') IN (${digits10}, ${withCountry})`
    )) as Member[];
}

async function findMembersForAuthContact(contact: string): Promise<{
  isEmail: boolean;
  members: Member[];
  authContactToStore: string | null;
}> {
  const isEmail = contact.includes('@');
  if (isEmail) {
    const normalized = normalizeEmail(contact);
    return {
      isEmail: true,
      members: personAccountsOnly(await findMembersByEmail(normalized)),
      authContactToStore: normalized,
    };
  }
  const digits10 = normalizePhoneDigits10(contact);
  if (!digits10) {
    return { isEmail: false, members: [], authContactToStore: null };
  }
  return {
    isEmail: false,
    members: personAccountsOnly(await findMembersByPhoneDigits10(digits10)),
    authContactToStore: phoneDigits10ToE164(digits10),
  };
}

async function invalidateUnusedAuthCodes(contact: string): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.authCodes)
    .set({ used: 1 })
    .where(and(eq(schema.authCodes.contact, contact), eq(schema.authCodes.used, 0)));
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
  tempToken: z.string().min(16).max(128),
});

const impersonateSchema = z.object({
  targetMemberId: z.number().int().positive(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
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
    socialMember: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    isCalendarAdmin: { type: 'boolean' },
    isContentAdmin: { type: 'boolean' },
    isSponsorAdmin: { type: 'boolean' },
    leagueManagerLeagueIds: { type: 'array', items: { type: 'number' } },
    ownedEventIds: { type: 'array', items: { type: 'number' } },
    managedCredentialIds: { type: 'array', items: { type: 'number' } },
    managedVolunteerProgramIds: { type: 'array', items: { type: 'number' } },
    isLeagueAdministrator: { type: 'boolean' },
    isLeagueAdministratorGlobal: { type: 'boolean' },
    roleCodes: { type: 'array', items: { type: 'string' } },
    roleNames: { type: 'array', items: { type: 'string' } },
    scopeRules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          effect: { type: 'string', enum: ['allow', 'deny'] },
          resourceType: { type: ['string', 'null'] },
          resourceId: { type: ['number', 'null'] },
        },
        required: ['scope', 'effect'],
      },
    },
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
    'socialMember',
    'isAdmin',
    'isServerAdmin',
    'isCalendarAdmin',
    'isContentAdmin',
    'isSponsorAdmin',
    'leagueManagerLeagueIds',
    'ownedEventIds',
    'managedCredentialIds',
    'managedVolunteerProgramIds',
    'isLeagueAdministrator',
    'isLeagueAdministratorGlobal',
    'roleCodes',
    'roleNames',
    'scopeRules',
    'optedInSms',
    'emailSubscribed',
    'emailVisible',
    'phoneVisible',
    'themePreference',
  ],
} as const;

function getLeagueManagerLeagueIdsFromRules(
  rules: Array<{ scope: string; effect: 'allow' | 'deny'; resourceType?: string | null; resourceId?: number | null }>
): number[] {
  const leagueIds = new Set<number>();
  for (const rule of rules) {
    if (rule.effect !== 'allow') continue;
    if (rule.scope !== 'leagues.manage' && rule.scope !== 'leagues.*' && rule.scope !== '*') continue;
    if (rule.resourceType !== 'league') continue;
    if (rule.resourceId === null || rule.resourceId === undefined) continue;
    leagueIds.add(Number(rule.resourceId));
  }
  return Array.from(leagueIds);
}

async function buildAuthenticatedMember(member: Member): Promise<AuthenticatedMember> {
  // Prefer live DB claims over any authz already attached (e.g. from a JWT).
  const authz = member.impersonationSession
    ? await buildAuthzClaimsForImpersonatedMember(member)
    : await buildAuthzClaimsForMember(member);
  member.authz = authz;
  const leagueManagerLeagueIds = getLeagueManagerLeagueIdsFromRules(authz.scopeRules);
  const isLeagueAdministratorGlobal = hasScope(authz, 'leagues.manage');
  const ownedEventIds = await listOwnedEventIds(member.id);
  const managedCredentialIds = await listAssignedManagedCredentialIds(member.id);
  const managedVolunteerProgramIds = await listManagedVolunteerProgramIds(member.id);

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    spareOnly: memberIsSpareOnly(member),
    socialMember: memberIsSocialMember(member),
    isAdmin: isAdmin(member),
    isServerAdmin: isServerAdmin(member),
    isCalendarAdmin: isCalendarAdmin(member),
    isContentAdmin: isContentAdmin(member),
    isSponsorAdmin: isSponsorAdmin(member),
    leagueManagerLeagueIds,
    ownedEventIds,
    managedCredentialIds,
    managedVolunteerProgramIds,
    isLeagueAdministrator: isLeagueAdministratorGlobal,
    isLeagueAdministratorGlobal,
    roleCodes: authz.roleCodes,
    roleNames: authz.roleNames,
    scopeRules: authz.scopeRules,
    optedInSms: member.opted_in_sms === 1,
    emailSubscribed: member.email_subscribed === 1,
    emailVisible: member.email_visible === 1,
    phoneVisible: member.phone_visible === 1,
    themePreference:
      member.theme_preference === 'light' || member.theme_preference === 'dark' || member.theme_preference === 'system'
        ? member.theme_preference
        : 'system',
  };
}

const authRequestCodeBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contact: { type: 'string', minLength: 1 },
  },
  required: ['contact'],
} as const;

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
} as const;

const authRequestCodeResponseSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean' },
        multipleMembers: { type: 'boolean' },
      },
      required: ['success', 'multipleMembers'],
    },
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
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        member: authMemberResponseSchema,
      },
      required: ['accessToken', 'refreshToken', 'member'],
    },
  ],
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
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        member: authMemberResponseSchema,
      },
      required: ['accessToken', 'refreshToken', 'member'],
    },
  ],
} as const;

const authTokenZodSchema = z.object({
  token: z.string().min(16).max(200),
});

const authTokenBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 16, maxLength: 200 },
  },
  required: ['token'],
} as const;

const authTokenExchangeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    member: authMemberResponseSchema,
  },
  required: ['accessToken', 'refreshToken', 'member'],
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

const accountSwitchOptionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
} as const;

const authVerifyTokenResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: authMemberResponseSchema,
    actorMemberId: { type: 'number' },
    isImpersonating: { type: 'boolean' },
    accountSwitchOptions: { type: 'array', items: accountSwitchOptionSchema },
  },
  required: ['member', 'actorMemberId', 'isImpersonating', 'accountSwitchOptions'],
} as const;

const authSessionTokenResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    member: authMemberResponseSchema,
    actorMemberId: { type: 'number' },
    isImpersonating: { type: 'boolean' },
    accountSwitchOptions: { type: 'array', items: accountSwitchOptionSchema },
  },
  required: ['accessToken', 'refreshToken', 'member', 'actorMemberId', 'isImpersonating', 'accountSwitchOptions'],
} as const;

const authRefreshBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string' },
  },
  required: ['refreshToken'],
} as const;

const authTokenPairResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
  },
  required: ['accessToken', 'refreshToken'],
} as const;

const passkeyCeremonyOptionsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    challengeId: { type: 'string' },
    options: { type: 'object', additionalProperties: true },
  },
  required: ['challengeId', 'options'],
} as const;

const passkeyAuthenticationVerifyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    challengeId: { type: 'string', minLength: 1 },
    credential: { type: 'object', additionalProperties: true },
  },
  required: ['challengeId', 'credential'],
} as const;

const passkeyAuthenticationVerifyZod = z.object({
  challengeId: z.string().min(1),
  credential: z.record(z.unknown()),
});

const authLogoutResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

const authImpersonateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targetMemberId: { type: 'number' },
  },
  required: ['targetMemberId'],
} as const;

const authSignInAsBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targetMemberId: { type: 'number' },
  },
  required: ['targetMemberId'],
} as const;

const signInAsSchema = z.object({
  targetMemberId: z.number().int().positive(),
});

export async function publicAuthRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: { refreshToken: string };
    Reply: { accessToken: string; refreshToken: string } | ApiErrorResponse;
  }>(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        body: authRefreshBodySchema,
        response: {
          200: authTokenPairResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = refreshTokenSchema.parse(request.body);
      const session = await refreshAuthSession(body.refreshToken);
      if (!session) {
        return reply.code(401).send({ error: 'Invalid or expired refresh token' });
      }
      return session;
    }
  );

  fastify.post<{
    Body: { refreshToken?: string };
    Reply: { success: boolean };
  }>(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        response: {
          200: authLogoutResponseSchema,
        },
      },
    },
    async (request) => {
      const refreshToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : undefined;
      await revokeRefreshToken(refreshToken);
      return { success: true };
    }
  );

  // Request auth code
  fastify.post<{
    Body: AuthRequestCodeBody;
    Reply:
      | AuthRequestCodeResponse
      | AuthVerifyCodeResponse<AuthenticatedMember>
      | ApiErrorResponse;
  }>(
    '/auth/request-code',
    {
      config: {
        rateLimit: abuseRouteRateLimits.authRequestCode,
      },
      schema: {
        tags: ['auth'],
        body: authRequestCodeBodySchema,
        response: {
          200: authRequestCodeResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = requestCodeSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Check server config for test mode and login restrictions
    const configRows = await db
      .select({
        bypass_login_verification: schema.serverConfig.bypass_login_verification,
        disable_user_login: schema.serverConfig.disable_user_login,
      })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    const bypassLoginVerification = configRows[0]?.bypass_login_verification === 1;
    const disableUserLogin = configRows[0]?.disable_user_login === 1;

    const resolved = await findMembersForAuthContact(body.contact);
    const { isEmail, authContactToStore } = resolved;
    let members = resolved.members;

    if (!authContactToStore || members.length === 0) {
      return sendApiError(
        reply,
        404,
        isEmail
          ? 'That email address was not found. If you are a member, contact Membership for help.'
          : 'That phone number was not found. If you are a member, contact Membership for help.'
      );
    }

    if (isLoginDisabledForMembers(members, disableUserLogin)) {
      return reply.code(403).send({ error: LOGIN_DISABLED_MESSAGE });
    }

    members = membersAllowedToLogin(members, disableUserLogin);

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

    // Dev bypass: auto-login without sending verification code
    if (bypassLoginVerification) {
      if (members.length === 1) {
        const member = members[0];
        const session = await issueAuthSession(member as Member);

        logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});

        return {
          ...session,
          member: await buildAuthenticatedMember(member as Member),
        };
      }

      const tempContact = `temp:${authContactToStore}`;
      await invalidateUnusedAuthCodes(tempContact);
      const tempToken = generateTempAuthToken();
      await db.insert(schema.authCodes).values({
        contact: tempContact,
        code: tempToken,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        used: 0,
      });

      return {
        requiresSelection: true as const,
        tempToken,
        members: members.map((m: Member) => ({ id: m.id, name: m.name })),
      };
    }

    // Normal flow: generate and send auth code
    const code = generateAuthCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await invalidateUnusedAuthCodes(authContactToStore);
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
      config: {
        rateLimit: abuseRouteRateLimits.authVerify,
      },
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
    const clientIp = request.ip || 'unknown';
    const bypassIpLimits = isIpLimitBypassed(clientIp);
    const failKey = authVerifyFailKey(clientIp, body.contact);
    if (!bypassIpLimits && isAuthVerifyLockedOut(failKey)) {
      return reply.code(429).send({ error: 'Too many failed attempts. Please try again later.' });
    }

    const configRows = await db
      .select({ disable_user_login: schema.serverConfig.disable_user_login })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    const disableUserLogin = configRows[0]?.disable_user_login === 1;

    const resolved = await findMembersForAuthContact(body.contact);
    const authContactToMatch = resolved.authContactToStore;
    if (!authContactToMatch) {
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired code' });
    }

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
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired code' });
    }

    // Mark code as used
    await db
      .update(schema.authCodes)
      .set({ used: 1 })
      .where(eq(schema.authCodes.id, authCode.id));

    let members = resolved.members;

    if (members.length === 0) {
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired code' });
    }

    if (isLoginDisabledForMembers(members, disableUserLogin)) {
      return reply.code(403).send({ error: LOGIN_DISABLED_MESSAGE });
    }

    members = membersAllowedToLogin(members, disableUserLogin);
    if (!bypassIpLimits) clearAuthVerifyFailures(failKey);

    // If only one member, generate token and return
    if (members.length === 1) {
      const member = members[0];
      const session = await issueAuthSession(member as Member);

      // Best-effort analytics (do not block)
      logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});

      return {
        ...session,
        member: await buildAuthenticatedMember(member as Member),
      };
    }

    // Multiple members - return temporary token for selection
    const tempContact = `temp:${authContactToMatch}`;
    await invalidateUnusedAuthCodes(tempContact);
    const tempToken = generateTempAuthToken();
    await db.insert(schema.authCodes).values({
      contact: tempContact,
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
      config: {
        rateLimit: abuseRouteRateLimits.authSelect,
      },
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
    const clientIp = request.ip || 'unknown';
    const bypassIpLimits = isIpLimitBypassed(clientIp);
    const failKey = authVerifyFailKey(clientIp, `temp:${body.tempToken.slice(0, 16)}`);
    if (!bypassIpLimits && isAuthVerifyLockedOut(failKey)) {
      return reply.code(429).send({ error: 'Too many failed attempts. Please try again later.' });
    }

    const configRows = await db
      .select({ disable_user_login: schema.serverConfig.disable_user_login })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    const disableUserLogin = configRows[0]?.disable_user_login === 1;

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
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const boundContact = parseTempAuthContact(tempAuth.contact);
    if (!boundContact) {
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const allowed = await findMembersForAuthContact(boundContact);
    if (!isMemberIdBoundToContact(body.memberId, allowed.members.map((m) => m.id))) {
      if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    // Mark temp token as used only after binding checks pass
    await db
      .update(schema.authCodes)
      .set({ used: 1 })
      .where(eq(schema.authCodes.id, tempAuth.id));

    const members = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, body.memberId))
      .limit(1);

    const member = members[0];

    if (!member) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    if (disableUserLogin && !isServerAdmin(member)) {
      return reply.code(403).send({ error: LOGIN_DISABLED_MESSAGE });
    }

    if (!bypassIpLimits) clearAuthVerifyFailures(failKey);
    const session = await issueAuthSession(member as Member);

    // Best-effort analytics (do not block)
    logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});

      return {
      ...session,
      member: await buildAuthenticatedMember(member),
      };
    }
  );

  fastify.post<{
    Body: AuthTokenBody;
    Reply: AuthVerifySuccessResponse<AuthenticatedMember> | ApiErrorResponse;
  }>(
    '/auth/token',
    {
      config: {
        rateLimit: abuseRouteRateLimits.authToken,
      },
      schema: {
        tags: ['auth'],
        body: authTokenBodySchema,
        response: {
          200: authTokenExchangeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = authTokenZodSchema.parse(request.body);
      const clientIp = request.ip || 'unknown';
      const bypassIpLimits = isIpLimitBypassed(clientIp);
      const failKey = authVerifyFailKey(clientIp, 'access-token');
      if (!bypassIpLimits && isAuthVerifyLockedOut(failKey)) {
        return reply.code(429).send({ error: 'Too many failed attempts. Please try again later.' });
      }
      const member = await findMemberByPersonalAccessToken(body.token);
      if (!member) {
        if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
        return reply.code(401).send({ error: 'Invalid token' });
      }
      if (!bypassIpLimits) clearAuthVerifyFailures(failKey);
      const session = await issueAuthSession(member);
      logEvent({ eventType: 'auth.login_success', memberId: member.id }).catch(() => {});
      return {
        ...session,
        member: await buildAuthenticatedMember(member),
      };
    }
  );

  fastify.post<{
    Reply: { challengeId: string; options: Record<string, unknown> } | ApiErrorResponse;
  }>(
    '/auth/passkeys/authentication/options',
    {
      config: {
        rateLimit: abuseRouteRateLimits.authPasskey,
      },
      schema: {
        tags: ['auth'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        response: {
          200: passkeyCeremonyOptionsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await beginPasskeyAuthentication();
        return {
          challengeId: result.challengeId,
          options: result.options as unknown as Record<string, unknown>,
        };
      } catch (error) {
        if (error instanceof WebAuthnServiceError) {
          return sendApiError(reply, error.statusCode, error.message);
        }
        throw error;
      }
    }
  );

  fastify.post<{
    Body: { challengeId: string; credential: Record<string, unknown> };
    Reply: AuthVerifySuccessResponse<AuthenticatedMember> | ApiErrorResponse;
  }>(
    '/auth/passkeys/authentication/verify',
    {
      config: {
        rateLimit: abuseRouteRateLimits.authPasskey,
      },
      schema: {
        tags: ['auth'],
        body: passkeyAuthenticationVerifyBodySchema,
        response: {
          200: authTokenExchangeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = passkeyAuthenticationVerifyZod.parse(request.body);
      const clientIp = request.ip || 'unknown';
      const bypassIpLimits = isIpLimitBypassed(clientIp);
      const failKey = authVerifyFailKey(clientIp, 'passkey');
      if (!bypassIpLimits && isAuthVerifyLockedOut(failKey)) {
        return reply.code(429).send({ error: 'Too many failed attempts. Please try again later.' });
      }

      try {
        const member = await finishPasskeyAuthentication({
          challengeId: body.challengeId,
          credential: body.credential,
          request,
        });

        const { db, schema } = getDrizzleDb();
        const configRows = await db
          .select({ disable_user_login: schema.serverConfig.disable_user_login })
          .from(schema.serverConfig)
          .where(eq(schema.serverConfig.id, 1))
          .limit(1);
        const disableUserLogin = configRows[0]?.disable_user_login === 1;
        if (isLoginDisabledForMembers([member], disableUserLogin)) {
          return reply.code(403).send({ error: LOGIN_DISABLED_MESSAGE });
        }

        if (!bypassIpLimits) clearAuthVerifyFailures(failKey);
        const session = await issueAuthSession(member);
        logEvent({
          eventType: 'auth.login_success',
          memberId: member.id,
          meta: { method: 'passkey' },
        }).catch(() => {});
        return {
          ...session,
          member: await buildAuthenticatedMember(member),
        };
      } catch (error) {
        if (!bypassIpLimits) recordAuthVerifyFailure(failKey);
        if (error instanceof WebAuthnServiceError) {
          return sendApiError(reply, error.statusCode, error.message);
        }
        throw error;
      }
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

      const actorMemberId = request.actorMemberId ?? member.id;
      return {
        member: await buildAuthenticatedMember(member),
        actorMemberId,
        isImpersonating: request.isImpersonating ?? false,
        accountSwitchOptions: await listAccountSwitchOptions(actorMemberId),
      };
    }
  );

  fastify.post<{
    Body: { targetMemberId: number };
    Reply:
      | {
          accessToken: string;
          refreshToken: string;
          member: AuthenticatedMember;
          actorMemberId: number;
          isImpersonating: boolean;
          accountSwitchOptions: Array<{ id: number; name: string }>;
        }
      | ApiErrorResponse;
  }>(
    '/auth/impersonate',
    {
      schema: {
        tags: ['auth'],
        body: authImpersonateBodySchema,
        response: {
          200: authSessionTokenResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actorId = request.actorMemberId;
      if (actorId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { targetMemberId } = impersonateSchema.parse(request.body);
      if (!(await canActorImpersonateTarget(actorId, targetMemberId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const { db, schema } = getDrizzleDb();
      const targets = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, targetMemberId))
        .limit(1);

      const raw = targets[0];
      if (!raw) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      const targetMember = raw as Member;
      targetMember.authz = await buildAuthzClaimsForMember(targetMember);

      const session = await issueAuthSession(targetMember, { actorMemberId: actorId });
      targetMember.impersonationSession = actorId !== targetMemberId;
      targetMember.authz = await buildAuthzClaimsForImpersonatedMember(targetMember);

      logEvent({
        eventType: 'auth.impersonate',
        memberId: actorId,
        relatedId: targetMemberId,
      }).catch(() => {});

      return {
        ...session,
        member: await buildAuthenticatedMember(targetMember),
        actorMemberId: actorId,
        isImpersonating: actorId !== targetMemberId,
        accountSwitchOptions: await listAccountSwitchOptions(actorId),
      };
    }
  );

  fastify.post<{
    Body: AuthSignInAsBody;
    Reply:
      | {
          accessToken: string;
          refreshToken: string;
          member: AuthenticatedMember;
          actorMemberId: number;
          isImpersonating: boolean;
          accountSwitchOptions: Array<{ id: number; name: string }>;
        }
      | ApiErrorResponse;
  }>(
    '/auth/sign-in-as',
    {
      schema: {
        tags: ['auth'],
        body: authSignInAsBodySchema,
        response: {
          200: authSessionTokenResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const operator = request.member;
      if (!operator) {
        return sendApiError(reply, 401, 'Unauthorized');
      }

      const { targetMemberId } = signInAsSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      const targets = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, targetMemberId))
        .limit(1);
      const rawTarget = targets[0] ?? null;

      const denial = evaluateDeveloperSignIn({
        actorIsServerAdmin: isServerAdmin(operator),
        actorIsImpersonating: request.isImpersonating === true,
        actorMemberId: operator.id,
        target: rawTarget,
      });
      if (denial) {
        return sendApiError(reply, developerSignInErrorStatus(denial), developerSignInErrorMessage(denial));
      }

      const targetMember = rawTarget as Member;
      const session = await issueAuthSession(targetMember);

      logEvent({
        eventType: 'auth.developer_signin',
        memberId: operator.id,
        relatedId: targetMember.id,
      }).catch(() => {});

      return {
        ...session,
        member: await buildAuthenticatedMember(targetMember),
        actorMemberId: targetMember.id,
        isImpersonating: false,
        accountSwitchOptions: await listAccountSwitchOptions(targetMember.id),
      };
    }
  );

  fastify.post<{
    Reply:
      | {
          accessToken: string;
          refreshToken: string;
          member: AuthenticatedMember;
          actorMemberId: number;
          isImpersonating: boolean;
          accountSwitchOptions: Array<{ id: number; name: string }>;
        }
      | ApiErrorResponse;
  }>(
    '/auth/stop-impersonation',
    {
      schema: {
        tags: ['auth'],
        response: {
          200: authSessionTokenResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.isImpersonating || request.actorMemberId === undefined) {
        return reply.code(400).send({ error: 'Not impersonating' });
      }
      const actorId = request.actorMemberId;
      const { db, schema } = getDrizzleDb();
      const actors = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.id, actorId))
        .limit(1);

      const rawActor = actors[0];
      if (!rawActor) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      const actorMember = rawActor as Member;
      actorMember.impersonationSession = false;
      actorMember.authz = await buildAuthzClaimsForMember(actorMember);
      const session = await issueAuthSession(actorMember);

      logEvent({ eventType: 'auth.stop_impersonation', memberId: actorId }).catch(() => {});

      return {
        ...session,
        member: await buildAuthenticatedMember(actorMember),
        actorMemberId: actorId,
        isImpersonating: false,
        accountSwitchOptions: await listAccountSwitchOptions(actorId),
      };
    }
  );

  fastify.get(
    '/openapi.json',
    {
      schema: {
        tags: ['auth'],
        hide: true,
      },
    },
    async () => fastify.swagger()
  );
}
