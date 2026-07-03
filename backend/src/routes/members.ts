import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin, isServerAdmin, isSponsorAdmin } from '../utils/auth.js';
import { loadGeneralAdminMemberIds, memberHasAdminAccess, setGeneralAdminRole } from '../utils/memberRoles.js';
import { hasScope } from '../utils/rbac.js';
import { Member } from '../types.js';
import {
  bulkCreateResponseSchema,
  bulkDeleteResponseSchema,
  bulkSendWelcomeResponseSchema,
  loginLinkResponseSchema,
  memberCreateResponseSchema,
  memberEmergencyContactResponseSchema,
  memberExperienceSummaryResponseSchema,
  memberLeaguesResponseSchema,
  memberListResponseSchema,
  memberDirectoryListResponseSchema,
  memberMembershipCardResponseSchema,
  createMemberSeasonMembershipBodySchema,
  memberSeasonMembershipListResponseSchema,
  memberSeasonMembershipSchema,
  memberPaymentDetailSchema,
  memberPaymentHistoryResponseSchema,
  memberProfileResponseSchema,
  memberUpdateResponseSchema,
  successResponseSchema,
} from '../api/schemas.js';
import { MEMBER_PROFILE_EMAIL_UNAVAILABLE } from '../api/errors.js';
import { clearMemberRestrictedRelations } from '../services/clearMemberRestrictedRelations.js';
import { getMemberMembershipCard } from '../services/memberMembershipCardService.js';
import { memberHasActiveMembershipCondition } from '../services/memberMembershipStatusService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { parseQueryBoolean } from '../utils/queryParams.js';
import { resolveRelevantSessionIdForLeagues } from '../services/curlingSessionService.js';
import { isLeagueEligibleForSpares } from '../utils/leagueSpareEligibility.js';
import type {
  ApiErrorResponse,
  BulkCreateBody,
  BulkCreateResponse,
  BulkDeleteBody,
  BulkDeleteResponse,
  BulkSendWelcomeResponse,
  CreateMemberBody,
  LoginLinkResponse,
  MemberAccountAccessDelegatesResponse,
  MemberCreateResponse,
  MemberEmergencyContactResponse,
  MemberExperienceSummaryResponse,
  MemberLeaguesResponse,
  MemberMembershipCardResponse,
  CreateMemberSeasonMembershipBody,
  MemberSeasonMembershipListResponse,
  MemberSeasonMembershipResponse,
  MemberPaymentDetail,
  MemberPaymentHistoryResponse,
  MemberProfileResponse,
  MemberSummaryResponse,
  MemberUpdateResponse,
  UpdateMemberBody,
  UpdateMemberAccountAccessDelegatesBody,
  UpdateProfileBody,
} from '../api/types.js';
import { sendWelcomeEmail } from '../services/email.js';
import { getMemberPaymentDetail, listMemberPaymentHistory } from '../services/memberPaymentHistoryService.js';
import { normalizeEmail } from '../utils/auth.js';
import { config } from '../config.js';
import {
  findMemberIdWithConflictingNormalizedEmailChange,
  listDelegateGranteesForGrantor,
  memberIdsWithSameNormalizedEmailAs,
} from '../services/accountAccess.js';
import {
  applyMemberDemographicsUpdate,
  MemberDemographicsUpdateError,
  MemberDemographicsValidationError,
} from '../services/memberDemographics.js';
import {
  applyMemberGuardianUpdate,
  clearMemberGuardian,
  guardianEmergencyContactName,
  MemberGuardianValidationError,
} from '../services/memberGuardian.js';
import { isMemberMinor } from '../utils/memberAge.js';
import { sendValidationError } from '../api/errors.js';
import { resolveMemberNameFields, splitMemberDisplayName } from '../utils/memberName.js';
import {
  countServerAdminsFromRows,
  countServerAdminsInDb,
  isLastServerAdminInDb,
  isLastServerAdminRow,
  LAST_SERVER_ADMIN_ERROR,
} from '../utils/serverAdmin.js';
import {
  normalizeHalfYearExperienceValue,
  validateHalfYearExperienceValue,
} from '../registration/curlingExperienceYears.js';
import { getMemberTotalExperienceYears } from '../services/memberExperienceSummary.js';
import {
  createMemberSeasonMembership,
  deleteMemberSeasonMembership,
  listMemberSeasonMemberships,
  MemberSeasonMembershipConflictError,
  MemberSeasonMembershipNotFoundError,
} from '../services/memberSeasonMembershipAdminService.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const profileDemographicFieldKeys = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'mailingAddress',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

const profileGuardianFieldKeys = [
  'guardianFirstName',
  'guardianLastName',
  'guardianEmail',
  'guardianPhone',
] as const;

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  dateOfBirth: z.string().min(1).optional(),
  mailingAddress: z.string().min(1).optional(),
  emergencyContactName: z.string().min(1).optional(),
  emergencyContactPhone: z.string().min(1).optional(),
  guardianFirstName: z.string().min(1).optional(),
  guardianLastName: z.string().min(1).optional(),
  guardianEmail: z.string().email().optional(),
  guardianPhone: z.string().min(1).optional(),
  optedInSms: z.boolean().optional(),
  emailVisible: z.boolean().optional(),
  phoneVisible: z.boolean().optional(),
  themePreference: z.enum(['light', 'dark', 'system']).optional(),
});

const createMemberSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    email: z.string().email(),
    phone: z.string().optional(),
    isAdmin: z.boolean().optional(),
    isServerAdmin: z.boolean().optional(),
    isCalendarAdmin: z.boolean().optional(),
    isContentAdmin: z.boolean().optional(),
    isSponsorAdmin: z.boolean().optional(),
    isLeagueAdministrator: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const resolved = resolveMemberNameFields(data);
    if (!resolved) {
      ctx.addIssue({
        code: 'custom',
        message: 'First name and last name are required.',
        path: ['firstName'],
      });
    }
  });

const optionalAdminEmailField = z.union([z.literal(''), z.string().email()]).optional();

const updateMemberSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  email: optionalAdminEmailField,
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  mailingAddress: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  lifetimeMember: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  isServerAdmin: z.boolean().optional(),
  isCalendarAdmin: z.boolean().optional(),
  isContentAdmin: z.boolean().optional(),
  isSponsorAdmin: z.boolean().optional(),
  isLeagueAdministrator: z.boolean().optional(),
  baselineOtherClubExperienceYears: z.coerce.number().optional(),
  baselineClubExperienceYears: z.coerce.number().optional(),
  emailVisible: z.boolean().optional(),
  phoneVisible: z.boolean().optional(),
  guardianFirstName: z.string().optional(),
  guardianLastName: z.string().optional(),
  guardianEmail: optionalAdminEmailField,
  guardianPhone: z.string().optional(),
});

const createMemberSeasonMembershipSchema = z.object({
  seasonId: z.number().int().positive(),
  membershipType: z.enum(['regular', 'social', 'junior_recreational']),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.number()).min(1),
});

const bulkCreateSchema = z.array(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  })
).min(1);

const bulkCreateRequestSchema = z.union([
  bulkCreateSchema,
  z.object({
    members: bulkCreateSchema,
  }),
]);

const directoryQuerySchema = z.object({
  leagueId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
});

const memberLeaguesQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'number' },
    relevantSession: { type: 'string', enum: ['true', 'false'] },
  },
} as const;

const updateAccountAccessDelegatesSchema = z.object({
  memberIds: z.array(z.number().int().positive()),
});

const memberAccountAccessDelegatesResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    delegatedToMemberIds: { type: 'array', items: { type: 'number' } },
    implicitAccessMemberIds: { type: 'array', items: { type: 'number' } },
  },
  required: ['delegatedToMemberIds', 'implicitAccessMemberIds'],
} as const;

const updateAccountAccessDelegatesBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberIds: { type: 'array', items: { type: 'number' } },
  },
  required: ['memberIds'],
} as const;

const updateProfileBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    firstName: { type: 'string', minLength: 1 },
    lastName: { type: 'string', minLength: 1 },
    dateOfBirth: { type: 'string', minLength: 1 },
    mailingAddress: { type: 'string', minLength: 1 },
    emergencyContactName: { type: 'string', minLength: 1 },
    emergencyContactPhone: { type: 'string', minLength: 1 },
    guardianFirstName: { type: 'string', minLength: 1 },
    guardianLastName: { type: 'string', minLength: 1 },
    guardianEmail: { type: 'string' },
    guardianPhone: { type: 'string', minLength: 1 },
    optedInSms: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    themePreference: { type: 'string', enum: ['light', 'dark', 'system'] },
  },
} as const;

const createMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { type: 'string', minLength: 1 },
    lastName: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    lifetimeMember: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    isCalendarAdmin: { type: 'boolean' },
    isContentAdmin: { type: 'boolean' },
    isSponsorAdmin: { type: 'boolean' },
    isLeagueAdministrator: { type: 'boolean' },
  },
  required: ['email'],
} as const;

const updateMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { type: 'string', minLength: 1 },
    lastName: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    dateOfBirth: { type: 'string' },
    mailingAddress: { type: 'string' },
    emergencyContactName: { type: 'string' },
    emergencyContactPhone: { type: 'string' },
    lifetimeMember: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    isCalendarAdmin: { type: 'boolean' },
    isContentAdmin: { type: 'boolean' },
    isSponsorAdmin: { type: 'boolean' },
    baselineOtherClubExperienceYears: { type: 'number' },
    baselineClubExperienceYears: { type: 'number' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    guardianFirstName: { type: 'string' },
    guardianLastName: { type: 'string' },
    guardianEmail: { type: 'string' },
    guardianPhone: { type: 'string' },
  },
} as const;

const bulkDeleteBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ids: { type: 'array', items: { type: 'number' }, minItems: 1 },
  },
  required: ['ids'],
} as const;

const bulkCreateBodySchema = {
  oneOf: [
    {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name', 'email'],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        members: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1 },
              email: { type: 'string' },
              phone: { type: 'string' },
            },
            required: ['name', 'email'],
          },
          minItems: 1,
        },
      },
      required: ['members'],
    },
  ],
} as const;

const directoryQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leagueId: { type: 'number' },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    search: { type: 'string' },
  },
} as const;

interface MemberUpdateData {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  date_of_birth?: string | null;
  mailing_address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  lifetime_member?: number;
  opted_in_sms?: number;
  email_visible?: number;
  phone_visible?: number;
  theme_preference?: string;
  is_server_admin?: number;
  is_calendar_admin?: number;
  is_content_admin?: number;
  is_sponsor_admin?: number;
  baseline_other_club_experience_years?: number;
  baseline_club_experience_years?: number;
  updated_at?: ReturnType<typeof sql>;
}

function memberExperienceBaselineDetails(body: {
  baselineOtherClubExperienceYears?: number;
  baselineClubExperienceYears?: number;
}): Record<string, string> | null {
  const details: Record<string, string> = {};
  if (body.baselineOtherClubExperienceYears !== undefined) {
    const error = validateHalfYearExperienceValue(
      body.baselineOtherClubExperienceYears,
      'Years of experience at another club',
    );
    if (error) details.baselineOtherClubExperienceYears = error;
  }
  if (body.baselineClubExperienceYears !== undefined) {
    const error = validateHalfYearExperienceValue(
      body.baselineClubExperienceYears,
      'Baseline years of experience at this club',
    );
    if (error) details.baselineClubExperienceYears = error;
  }
  return Object.keys(details).length > 0 ? details : null;
}

async function setGlobalLeagueAdministrator(
  db: ReturnType<typeof getDrizzleDb>['db'],
  schema: ReturnType<typeof getDrizzleDb>['schema'],
  memberId: number,
  enabled: boolean
) {
  if (enabled) {
    await db
      .insert(schema.leagueMemberRoles)
      .values({ member_id: memberId, league_id: null, role: 'league_administrator' })
      .onConflictDoNothing();
  } else {
    await db
      .delete(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.member_id, memberId),
          isNull(schema.leagueMemberRoles.league_id),
          eq(schema.leagueMemberRoles.role, 'league_administrator')
        )
      );
  }
}

function normalizeDateString(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function normalizeTimestamp(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function memberSummaryNameFields(member: Member): { firstName: string | null; lastName: string | null } {
  const storedFirst = member.first_name?.trim() ?? '';
  const storedLast = member.last_name?.trim() ?? '';
  if (storedFirst || storedLast) {
    return {
      firstName: storedFirst || null,
      lastName: storedLast || null,
    };
  }
  const split = splitMemberDisplayName(member.name);
  return {
    firstName: split.firstName || null,
    lastName: split.lastName || null,
  };
}

function buildMemberProfileResponse(member: Member): MemberProfileResponse {
  const dateOfBirth = normalizeDateString(member.date_of_birth);
  const minor = isMemberMinor(dateOfBirth);
  const guardianFirstName = member.guardian_first_name ?? null;
  const guardianLastName = member.guardian_last_name ?? null;
  const guardianPhone = member.guardian_phone ?? null;
  const guardianEmergencyName =
    guardianFirstName || guardianLastName
      ? guardianEmergencyContactName({
          firstName: guardianFirstName ?? '',
          lastName: guardianLastName ?? '',
          email: member.guardian_email ?? '',
          phone: guardianPhone ?? '',
        })
      : null;
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    firstName: member.first_name ?? null,
    lastName: member.last_name ?? null,
    dateOfBirth,
    mailingAddress: member.mailing_address ?? null,
    emergencyContactName: minor ? guardianEmergencyName ?? member.emergency_contact_name ?? null : member.emergency_contact_name ?? null,
    emergencyContactPhone: minor ? guardianPhone ?? member.emergency_contact_phone ?? null : member.emergency_contact_phone ?? null,
    guardianFirstName,
    guardianLastName,
    guardianEmail: member.guardian_email ?? null,
    guardianPhone,
    isMinor: minor,
    lifetimeMember: (member.lifetime_member ?? 0) === 1,
    isAdmin: isAdmin(member),
    isServerAdmin: isServerAdmin(member),
    optedInSms: member.opted_in_sms === 1,
    emailSubscribed: member.email_subscribed === 1,
    emailVisible: member.email_visible === 1,
    phoneVisible: member.phone_visible === 1,
    themePreference: member.theme_preference || 'system',
  };
}

function leagueManagerLeagueIdsFromMember(member: Member): number[] {
  const roleIds = new Set<number>();
  for (const rule of member.authz?.scopeRules ?? []) {
    if (rule.effect !== 'allow') continue;
    if (rule.scope !== 'leagues.manage' && rule.scope !== 'leagues.*' && rule.scope !== '*') continue;
    if (rule.resourceType !== 'league') continue;
    if (rule.resourceId === null || rule.resourceId === undefined) continue;
    roleIds.add(Number(rule.resourceId));
  }
  return Array.from(roleIds);
}

export async function memberRoutes(fastify: FastifyInstance) {
  // Get current member profile
  fastify.get<{ Reply: MemberProfileResponse | ApiErrorResponse }>(
    '/members/me',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberProfileResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const authMember = (request as AuthenticatedRequest).member;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, authMember.id))
      .limit(1);
    const member = (rows[0] as Member | undefined) ?? authMember;

    const leagueManagerLeagueIds = leagueManagerLeagueIdsFromMember(member);
    const isLeagueAdministratorGlobal = hasScope(member.authz, 'leagues.manage');

    return {
      ...buildMemberProfileResponse(member),
      leagueManagerLeagueIds,
      isLeagueAdministrator: isLeagueAdministratorGlobal,
      isLeagueAdministratorGlobal,
    };
    }
  );

  fastify.get<{ Reply: MemberMembershipCardResponse | ApiErrorResponse }>(
    '/members/me/membership-card',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberMembershipCardResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authMember = (request as AuthenticatedRequest).member;
      if (!authMember) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      return getMemberMembershipCard(authMember);
    },
  );

  fastify.get<{ Reply: MemberPaymentHistoryResponse | ApiErrorResponse }>(
    '/members/me/payment-history',
    {
      schema: {
        tags: ['members'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
        response: {
          200: memberPaymentHistoryResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const memberId = (request as AuthenticatedRequest).member.id;
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .parse(request.query ?? {});

      return listMemberPaymentHistory(memberId, {
        limit: query.limit,
        offset: query.offset,
      });
    }
  );

  fastify.get<{
    Params: { orderToken: string };
    Reply: MemberPaymentDetail | ApiErrorResponse;
  }>(
    '/members/me/payment-history/:orderToken',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            orderToken: { type: 'string' },
          },
          required: ['orderToken'],
        },
        response: {
          200: memberPaymentDetailSchema,
        },
      },
    },
    async (request, reply) => {
      const memberId = (request as AuthenticatedRequest).member.id;
      const params = z.object({ orderToken: z.string().uuid() }).parse(request.params);
      const detail = await getMemberPaymentDetail(memberId, params.orderToken);
      if (!detail) {
        return reply.code(404).send({ error: 'Payment not found' });
      }
      return detail;
    }
  );

  fastify.get<{ Reply: MemberAccountAccessDelegatesResponse | ApiErrorResponse }>(
    '/members/me/account-access-delegates',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberAccountAccessDelegatesResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const grantorId = (request as AuthenticatedRequest).member.id;
      const delegatedToMemberIds = await listDelegateGranteesForGrantor(grantorId);
      const sameEmail = await memberIdsWithSameNormalizedEmailAs(grantorId);
      const implicitAccessMemberIds = sameEmail.filter((id) => id !== grantorId);
      return { delegatedToMemberIds, implicitAccessMemberIds };
    }
  );

  fastify.put<{
    Body: UpdateMemberAccountAccessDelegatesBody;
    Reply: MemberAccountAccessDelegatesResponse | ApiErrorResponse;
  }>(
    '/members/me/account-access-delegates',
    {
      schema: {
        tags: ['members'],
        body: updateAccountAccessDelegatesBodySchema,
        response: {
          200: memberAccountAccessDelegatesResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const grantorId = (request as AuthenticatedRequest).member.id;
      const { memberIds } = updateAccountAccessDelegatesSchema.parse(request.body);
      const implicit = new Set(await memberIdsWithSameNormalizedEmailAs(grantorId));
      implicit.delete(grantorId);
      for (const mid of memberIds) {
        if (mid === grantorId) {
          return reply.code(400).send({ error: 'Invalid member ID' });
        }
        if (implicit.has(mid)) {
          return reply.code(400).send({
            error: 'That member already has access because they share your email address.',
          });
        }
      }
      const unique = [...new Set(memberIds)];
      const { db, schema } = getDrizzleDb();
      if (unique.length > 0) {
        const existing = await db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(inArray(schema.members.id, unique));
        if (existing.length !== unique.length) {
          return reply.code(400).send({ error: 'One or more members were not found' });
        }
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.memberAccountAccessDelegations)
          .where(eq(schema.memberAccountAccessDelegations.grantor_member_id, grantorId));
        if (unique.length > 0) {
          await tx.insert(schema.memberAccountAccessDelegations).values(
            unique.map((grantee_member_id) => ({
              grantor_member_id: grantorId,
              grantee_member_id,
            }))
          );
        }
      });
      const delegatedToMemberIds = await listDelegateGranteesForGrantor(grantorId);
      const sameEmail = await memberIdsWithSameNormalizedEmailAs(grantorId);
      const implicitAccessMemberIds = sameEmail.filter((id) => id !== grantorId);
      return { delegatedToMemberIds, implicitAccessMemberIds };
    }
  );

  // Update current member profile
  fastify.patch<{ Body: UpdateProfileBody; Reply: MemberProfileResponse | ApiErrorResponse }>(
    '/members/me',
    {
      schema: {
        tags: ['members'],
        body: updateProfileBodySchema,
        response: {
          200: memberProfileResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;

    const body = updateProfileSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const hasAnyDemographicField = profileDemographicFieldKeys.some((key) => body[key] !== undefined);
    const hasAllDemographicFields = profileDemographicFieldKeys.every((key) => body[key] !== undefined);
    const hasAnyGuardianField = profileGuardianFieldKeys.some((key) => body[key] !== undefined);
    const hasAllGuardianFields = profileGuardianFieldKeys.every((key) => body[key] !== undefined);
    if (hasAnyDemographicField && !hasAllDemographicFields) {
      return sendValidationError(reply, 'Validation failed', {
        demographics: 'Provide first name, last name, date of birth, mailing address, and emergency contact together.',
      });
    }
    if (hasAnyGuardianField && !hasAllGuardianFields) {
      return sendValidationError(reply, 'Validation failed', {
        guardian: 'Provide all parent/guardian contact fields together.',
      });
    }
    if (hasAllGuardianFields && !isMemberMinor(body.dateOfBirth ?? normalizeDateString(member.date_of_birth))) {
      return sendValidationError(reply, 'Validation failed', {
        guardian: 'Parent/guardian information applies only to members under 18.',
      });
    }

    if (hasAllGuardianFields) {
      try {
        await applyMemberGuardianUpdate(member.id, {
          firstName: body.guardianFirstName!,
          lastName: body.guardianLastName!,
          email: body.guardianEmail!,
          phone: body.guardianPhone!,
        });
      } catch (error) {
        if (error instanceof MemberGuardianValidationError) {
          return sendValidationError(reply, error.message, error.details);
        }
        throw error;
      }
    }

    if (hasAllDemographicFields) {
      const email = body.email ?? member.email;
      const phone = body.phone ?? member.phone;
      if (!email) {
        return sendValidationError(reply, 'Validation failed', { email: 'Email address is required.' });
      }
      try {
        await applyMemberDemographicsUpdate(member.id, {
          firstName: body.firstName!,
          lastName: body.lastName!,
          dateOfBirth: body.dateOfBirth!,
          email,
          phone: phone ?? '',
          mailingAddress: body.mailingAddress!,
          emergencyContactName: body.emergencyContactName!,
          emergencyContactPhone: body.emergencyContactPhone!,
        });
      } catch (error) {
        if (error instanceof MemberDemographicsValidationError) {
          return sendValidationError(reply, error.message, error.details);
        }
        if (error instanceof MemberDemographicsUpdateError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    }

    const updateData: MemberUpdateData = {};

    if (body.name !== undefined && !hasAllDemographicFields) {
      updateData.name = body.name;
    }
    if (body.email !== undefined && !hasAllDemographicFields) {
      const normalizedEmail = normalizeEmail(body.email);
      const conflictId = await findMemberIdWithConflictingNormalizedEmailChange(
        normalizedEmail,
        member.email,
        member.id
      );
      if (conflictId != null) {
        return reply.code(409).send({ error: MEMBER_PROFILE_EMAIL_UNAVAILABLE });
      }
      if (normalizedEmail !== (member.email ? normalizeEmail(member.email) : null)) {
        updateData.email = normalizedEmail;
      }
    }
    if (body.phone !== undefined && !hasAllDemographicFields) {
      updateData.phone = body.phone;
    }
    if (body.optedInSms !== undefined) {
      updateData.opted_in_sms = body.optedInSms ? 1 : 0;
    }
    if (body.emailVisible !== undefined) {
      updateData.email_visible = body.emailVisible ? 1 : 0;
    }
    if (body.phoneVisible !== undefined) {
      updateData.phone_visible = body.phoneVisible ? 1 : 0;
    }
    if (body.themePreference !== undefined) {
      updateData.theme_preference = body.themePreference;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.members)
        .set(updateData)
        .where(eq(schema.members.id, member.id));
    }

    const updatedMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, member.id))
      .limit(1);

    const updatedMember = updatedMembers[0] as Member;
    return buildMemberProfileResponse(updatedMember);
    }
  );

  // Get all members (filtered for non-admins)
  fastify.get<{ Reply: MemberSummaryResponse[] | ApiErrorResponse }>(
    '/members',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberListResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    const { db, schema } = getDrizzleDb();
    const members = await db
      .select()
      .from(schema.members)
      .orderBy(schema.members.name) as Member[];

    const isCurrentUserAdmin = isAdmin(member);
    const leagueAdminRows = await db
      .select({ member_id: schema.leagueMemberRoles.member_id })
      .from(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.role, 'league_administrator'),
          isNull(schema.leagueMemberRoles.league_id)
        )
      );
    const leagueAdminIds = new Set(leagueAdminRows.map((row) => row.member_id));
    const generalAdminMemberIds = await loadGeneralAdminMemberIds();
    const serverAdminCount = countServerAdminsFromRows(members);

    return members.map((m) => {
      // Basic info always visible
      // Ensure proper boolean conversion
      const response: MemberSummaryResponse = {
        id: m.id,
        name: m.name,
        isAdmin: memberHasAdminAccess(m, { generalAdminMemberIds }),
        isServerAdmin: isServerAdmin(m),
        isCalendarAdmin: (m.is_calendar_admin ?? 0) === 1,
        isContentAdmin: (m.is_content_admin ?? 0) === 1,
        isSponsorAdmin: isSponsorAdmin(m),
        isLeagueAdministratorGlobal: leagueAdminIds.has(m.id),
        isLastServerAdmin: isLastServerAdminRow(m, serverAdminCount),
        emailSubscribed: Boolean(m.email_subscribed === 1),
        optedInSms: Boolean(m.opted_in_sms === 1),
        emailVisible: Boolean(m.email_visible === 1),
        phoneVisible: Boolean(m.phone_visible === 1),
      };

      // Sensitive info visibility logic
      if (isCurrentUserAdmin || m.id === member.id) {
        // Admins and self see everything
        response.email = m.email;
        response.phone = m.phone;
        response.createdAt = normalizeTimestamp(m.created_at);
        if (isCurrentUserAdmin) {
          response.lifetimeMember = (m.lifetime_member ?? 0) === 1;
          const nameFields = memberSummaryNameFields(m);
          response.firstName = nameFields.firstName;
          response.lastName = nameFields.lastName;
          response.baselineOtherClubExperienceYears = normalizeHalfYearExperienceValue(
            m.baseline_other_club_experience_years ?? 0
          );
          response.baselineClubExperienceYears = normalizeHalfYearExperienceValue(
            m.baseline_club_experience_years ?? 0
          );
        }
      } else {
        // Others see based on privacy settings
        response.email = m.email_visible === 1 ? m.email : null;
        response.phone = m.phone_visible === 1 ? m.phone : null;
      }

      return response;
    });
    }
  );

  // Directory: active members only (expired members excluded)
  fastify.get<{ Querystring: { leagueId?: number; page?: number; pageSize?: number; search?: string }; Reply: unknown }>(
    '/members/directory',
    {
      schema: {
        tags: ['members'],
        querystring: directoryQuerySchemaJson,
        response: {
          200: memberDirectoryListResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const { db, schema } = getDrizzleDb();
    const parsedQuery = directoryQuerySchema.parse(request.query ?? {});
    const { leagueId, search } = parsedQuery;
    const page = Math.max(1, parsedQuery.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, parsedQuery.pageSize ?? 50));
    const today = await getCurrentDateStringAsync();
    const directoryVisibilityCondition = or(
      eq(schema.members.lifetime_member, 1),
      eq(schema.members.is_server_admin, 1),
      memberHasActiveMembershipCondition(schema, today),
    );
    const searchTerm = search?.trim().toLowerCase() ?? '';
    const searchCondition =
      searchTerm.length > 0
        ? sql`LOWER(${schema.members.name}) LIKE ${`%${searchTerm}%`}`
        : undefined;

    if (leagueId) {
      const [league] = await db
        .select({
          format: schema.leagues.format,
          allows_drop_ins: schema.leagues.allows_drop_ins,
        })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, leagueId))
        .limit(1);
      if (!league || !isLeagueEligibleForSpares(league)) {
        return { items: [], total: 0, page: 1, pageSize };
      }
    }

    const memberSelect = {
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      phone: schema.members.phone,
      is_server_admin: schema.members.is_server_admin,
      is_calendar_admin: schema.members.is_calendar_admin,
      is_content_admin: schema.members.is_content_admin,
      is_sponsor_admin: schema.members.is_sponsor_admin,
      opted_in_sms: schema.members.opted_in_sms,
      email_subscribed: schema.members.email_subscribed,
      email_visible: schema.members.email_visible,
      phone_visible: schema.members.phone_visible,
      theme_preference: schema.members.theme_preference,
      created_at: schema.members.created_at,
      updated_at: schema.members.updated_at,
    };

    const listWhere = leagueId
      ? and(
          eq(schema.memberAvailability.league_id, leagueId),
          eq(schema.memberAvailability.available, 1),
          directoryVisibilityCondition,
          ...(searchCondition ? [searchCondition] : []),
        )
      : and(directoryVisibilityCondition, ...(searchCondition ? [searchCondition] : []));

    const [totalRow] = leagueId
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.members)
          .innerJoin(
            schema.memberAvailability,
            eq(schema.memberAvailability.member_id, schema.members.id),
          )
          .where(listWhere)
      : await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.members)
          .where(listWhere);
    const total = Number(totalRow?.count ?? 0);
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, maxPage);

    const members = (leagueId
      ? await db
          .select(memberSelect)
          .from(schema.members)
          .innerJoin(
            schema.memberAvailability,
            eq(schema.memberAvailability.member_id, schema.members.id),
          )
          .where(listWhere)
          .orderBy(schema.members.name)
          .limit(pageSize)
          .offset((effectivePage - 1) * pageSize)
      : await db
          .select(memberSelect)
          .from(schema.members)
          .where(listWhere)
          .orderBy(schema.members.name)
          .limit(pageSize)
          .offset((effectivePage - 1) * pageSize)) as unknown as Member[];

    const leagueAdminRows = await db
      .select({ member_id: schema.leagueMemberRoles.member_id })
      .from(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.role, 'league_administrator'),
          isNull(schema.leagueMemberRoles.league_id),
        ),
      );
    const leagueAdminIds = new Set(leagueAdminRows.map((row) => row.member_id));
    const generalAdminMemberIds = await loadGeneralAdminMemberIds();
    const [serverAdminCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.members)
      .where(eq(schema.members.is_server_admin, 1));
    const serverAdminCount = Number(serverAdminCountRow?.count ?? 0);

    return {
      items: members.map((m) => {
        const response: MemberSummaryResponse = {
          id: m.id,
          name: m.name,
          isAdmin: memberHasAdminAccess(m, { generalAdminMemberIds }),
          isServerAdmin: isServerAdmin(m),
          isCalendarAdmin: (m.is_calendar_admin ?? 0) === 1,
          isContentAdmin: (m.is_content_admin ?? 0) === 1,
          isSponsorAdmin: isSponsorAdmin(m),
          isLeagueAdministratorGlobal: leagueAdminIds.has(m.id),
          isLastServerAdmin: isLastServerAdminRow(m, serverAdminCount),
          emailSubscribed: Boolean(m.email_subscribed === 1),
          optedInSms: Boolean(m.opted_in_sms === 1),
          emailVisible: Boolean(m.email_visible === 1),
          phoneVisible: Boolean(m.phone_visible === 1),
        };

        response.email = m.email_visible === 1 ? m.email : null;
        response.phone = m.phone_visible === 1 ? m.phone : null;

        return response;
      }),
      total,
      page: effectivePage,
      pageSize,
    };
    }
  );

  // Get a member's leagues and team assignments (for directory profile)
  fastify.get<{ Params: { memberId: string }; Reply: MemberLeaguesResponse | ApiErrorResponse }>(
    '/members/:memberId/leagues',
    {
      schema: {
        tags: ['members'],
        querystring: memberLeaguesQuerySchemaJson,
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memberId: { type: 'string' },
          },
          required: ['memberId'],
        },
        response: {
          200: memberLeaguesResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { memberId } = request.params;
    const targetMemberId = parseInt(memberId, 10);
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const sessionIdParam =
      rawQuery.sessionId != null && rawQuery.sessionId !== ''
        ? Number.parseInt(String(rawQuery.sessionId), 10)
        : undefined;
    const relevantSession = parseQueryBoolean(rawQuery.relevantSession);
    let filterSessionId =
      sessionIdParam != null && Number.isFinite(sessionIdParam) && sessionIdParam > 0
        ? sessionIdParam
        : null;
    if (filterSessionId == null && relevantSession) {
      const today = await getCurrentDateStringAsync();
      filterSessionId = await resolveRelevantSessionIdForLeagues(today);
      if (filterSessionId == null) {
        return [];
      }
    }

    const { db, schema } = getDrizzleDb();
    const rosterFilters = [eq(schema.leagueRoster.member_id, targetMemberId)];
    if (filterSessionId != null) {
      rosterFilters.push(eq(schema.leagues.session_id, filterSessionId));
    }

    const rows = (await db
      .select({
        league_id: schema.leagueRoster.league_id,
        league_name: schema.leagues.name,
        league_day_of_week: schema.leagues.day_of_week,
        team_id: schema.leagueTeams.id,
        team_name: schema.leagueTeams.name,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
      .leftJoin(schema.teamMembers, eq(schema.leagueRoster.member_id, schema.teamMembers.member_id))
      .leftJoin(
        schema.leagueTeams,
        and(
          eq(schema.teamMembers.team_id, schema.leagueTeams.id),
          eq(schema.leagueTeams.league_id, schema.leagueRoster.league_id)
        )
      )
      .where(and(...rosterFilters))
      .orderBy(schema.leagues.day_of_week, schema.leagues.name)) as {
      league_id: number;
      league_name: string;
      league_day_of_week: number;
      team_id: number | null;
      team_name: string | null;
    }[];

    return rows.map((row) => ({
      leagueId: row.league_id,
      leagueName: row.league_name,
      dayOfWeek: row.league_day_of_week,
      teamId: row.team_id,
      teamName: row.team_name,
    }));
    }
  );

  // Total curling experience for a member (visible to all authenticated members)
  fastify.get<{ Params: { memberId: string }; Reply: MemberExperienceSummaryResponse | ApiErrorResponse }>(
    '/members/:memberId/experience',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memberId: { type: 'string' },
          },
          required: ['memberId'],
        },
        response: {
          200: memberExperienceSummaryResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const targetMemberId = parseInt(request.params.memberId, 10);
      if (Number.isNaN(targetMemberId)) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }

      const totalExperienceYears = await getMemberTotalExperienceYears(targetMemberId);
      if (totalExperienceYears === null) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      return { totalExperienceYears };
    },
  );

  // Emergency contact for a member (visible to all authenticated members)
  fastify.get<{ Params: { memberId: string }; Reply: MemberEmergencyContactResponse | ApiErrorResponse }>(
    '/members/:memberId/emergency-contact',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memberId: { type: 'string' },
          },
          required: ['memberId'],
        },
        response: {
          200: memberEmergencyContactResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const targetMemberId = parseInt(request.params.memberId, 10);
      if (Number.isNaN(targetMemberId)) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }

      const { db, schema } = getDrizzleDb();
      const rows = await db
        .select({
          date_of_birth: schema.members.date_of_birth,
          emergency_contact_name: schema.members.emergency_contact_name,
          emergency_contact_phone: schema.members.emergency_contact_phone,
          guardian_first_name: schema.members.guardian_first_name,
          guardian_last_name: schema.members.guardian_last_name,
          guardian_email: schema.members.guardian_email,
          guardian_phone: schema.members.guardian_phone,
        })
        .from(schema.members)
        .where(eq(schema.members.id, targetMemberId))
        .limit(1);

      const target = rows[0];
      if (!target) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      const dateOfBirth = normalizeDateString(target.date_of_birth);
      const minor = isMemberMinor(dateOfBirth);
      const guardianEmergencyName =
        target.guardian_first_name || target.guardian_last_name
          ? guardianEmergencyContactName({
              firstName: target.guardian_first_name ?? '',
              lastName: target.guardian_last_name ?? '',
              email: target.guardian_email ?? '',
              phone: target.guardian_phone ?? '',
            })
          : null;

      return {
        emergencyContactName: minor
          ? guardianEmergencyName ?? target.emergency_contact_name ?? null
          : target.emergency_contact_name ?? null,
        emergencyContactPhone: minor
          ? target.guardian_phone ?? target.emergency_contact_phone ?? null
          : target.emergency_contact_phone ?? null,
      };
    }
  );

  // Admin: Create member
  fastify.post<{ Body: CreateMemberBody; Reply: MemberCreateResponse | ApiErrorResponse }>(
    '/members',
    {
      schema: {
        tags: ['members'],
        body: createMemberBodySchema,
        response: {
          200: memberCreateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member || !isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createMemberSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const resolvedName = resolveMemberNameFields(body);
    if (!resolvedName) {
      return sendValidationError(_reply, 'Validation failed', {
        firstName: 'First name and last name are required.',
      });
    }

    // Only server admins can create server admins
    if (body.isServerAdmin && !isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Only server admins can create server admins' });
    }

    const result = await db
      .insert(schema.members)
      .values({
        name: resolvedName.name,
        first_name: resolvedName.firstName,
        last_name: resolvedName.lastName,
        email: body.email,
        phone: body.phone || null,
        is_server_admin: body.isServerAdmin ? 1 : 0,
        is_calendar_admin: body.isCalendarAdmin ? 1 : 0,
        is_content_admin: body.isContentAdmin ? 1 : 0,
        is_sponsor_admin: body.isSponsorAdmin ? 1 : 0,
        opted_in_sms: 0,
        email_subscribed: 1,
        email_visible: 0,
        phone_visible: 0,
      })
      .returning();

    const newMember = result[0] as Member;

    if (body.isLeagueAdministrator) {
      await setGlobalLeagueAdministrator(db, schema, newMember.id, true);
    }
    if (body.isAdmin) {
      await setGeneralAdminRole(newMember.id, true);
    }

    return {
      id: newMember.id,
      name: newMember.name,
      email: newMember.email,
      phone: newMember.phone,
      isAdmin: body.isAdmin ?? false,
      emailSubscribed: newMember.email_subscribed === 1,
      optedInSms: newMember.opted_in_sms === 1,
    };
    }
  );

  // Admin: Bulk create members
  fastify.post<{ Body: BulkCreateBody; Reply: BulkCreateResponse | ApiErrorResponse }>(
    '/members/bulk',
    {
      schema: {
        tags: ['members'],
        body: bulkCreateBodySchema,
        response: {
          200: bulkCreateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const parsed = bulkCreateRequestSchema.parse(request.body);
    const body = Array.isArray(parsed) ? parsed : parsed.members;
    const { db, schema } = getDrizzleDb();

    // Use a transaction to ensure atomicity
    const insertedIds = await db.transaction(async (tx) => {
      const ids: number[] = [];
      
      for (const memberData of body) {
        const resolvedName = resolveMemberNameFields({ name: memberData.name });
        if (!resolvedName) continue;
        const result = await tx
          .insert(schema.members)
          .values({
            name: resolvedName.name,
            first_name: resolvedName.firstName,
            last_name: resolvedName.lastName,
            email: memberData.email,
            phone: memberData.phone || null,
            opted_in_sms: 0,
            email_subscribed: 1,
            email_visible: 0,
            phone_visible: 0,
          })
          .returning();
        
        ids.push(result[0].id);
      }
      
      return ids;
    });

    return {
      success: true,
      count: insertedIds.length,
      ids: insertedIds,
    };
    }
  );

  fastify.get<{
    Params: { id: string };
    Reply: MemberPaymentHistoryResponse | ApiErrorResponse;
  }>(
    '/members/:id/payment-history',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
        response: {
          200: memberPaymentHistoryResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authMember = (request as AuthenticatedRequest).member;
      if (!isAdmin(authMember)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const memberId = parseInt(request.params.id, 10);
      if (Number.isNaN(memberId)) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }
      const { db, schema } = getDrizzleDb();
      const rows = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.id, memberId)).limit(1);
      if (!rows[0]) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .parse(request.query ?? {});

      return listMemberPaymentHistory(memberId, {
        limit: query.limit,
        offset: query.offset,
      });
    },
  );

  fastify.get<{ Params: { id: string }; Reply: MemberProfileResponse | ApiErrorResponse }>(
    '/members/:id/profile',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: memberProfileResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const authMember = (request as AuthenticatedRequest).member;
      if (!isAdmin(authMember)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const memberId = parseInt(request.params.id, 10);
      if (Number.isNaN(memberId)) {
        return reply.code(400).send({ error: 'Invalid member ID' });
      }
      const { db, schema } = getDrizzleDb();
      const rows = await db.select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1);
      const target = rows[0] as Member | undefined;
      if (!target) {
        return reply.code(404).send({ error: 'Member not found' });
      }
      return buildMemberProfileResponse(target);
    },
  );

  // Admin: Update member
  fastify.patch<{ Params: { id: string }; Body: UpdateMemberBody; Reply: MemberUpdateResponse | ApiErrorResponse }>(
    '/members/:id',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: updateMemberBodySchema,
        response: {
          200: memberUpdateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);
    const body = updateMemberSchema.parse(request.body);
    const experienceBaselineDetails = memberExperienceBaselineDetails(body);
    if (experienceBaselineDetails) {
      return sendValidationError(_reply, 'Validation failed', experienceBaselineDetails);
    }
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);

    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember) {
      return _reply.code(404).send({ error: 'Member not found' });
    }

    // Prevent users from changing their own role
    if (
      memberId === member.id &&
      (body.isAdmin !== undefined || body.isServerAdmin !== undefined || body.isLeagueAdministrator !== undefined)
    ) {
      return _reply.code(400).send({ error: 'You cannot change your own role' });
    }

    if (
      body.isServerAdmin === false &&
      (targetMember.is_server_admin === 1 || isServerAdmin(targetMember)) &&
      (await isLastServerAdminInDb(memberId))
    ) {
      return _reply.code(400).send({ error: LAST_SERVER_ADMIN_ERROR });
    }

    // Regular admins cannot modify server admin roles
    if (!isServerAdmin(member) && (targetMember.is_server_admin === 1 || isServerAdmin(targetMember))) {
      // Regular admin trying to modify a server admin - only allow non-role fields
      if (body.isAdmin !== undefined || body.isServerAdmin !== undefined) {
        return _reply.code(403).send({ error: 'Only server admins can modify server admin roles' });
      }
    }

    // Only server admins can update server admin status
    if (body.isServerAdmin !== undefined && !isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Only server admins can change server admin status' });
    }
    if (body.lifetimeMember !== undefined && !isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Only server admins can change lifetime member status' });
    }

    const updateData: MemberUpdateData = {};

    const hasNameFieldUpdate =
      body.firstName !== undefined || body.lastName !== undefined || body.name !== undefined;
    if (hasNameFieldUpdate) {
      const resolvedName = resolveMemberNameFields({
        firstName: body.firstName,
        lastName: body.lastName,
        name: body.name ?? targetMember.name,
      });
      if (!resolvedName) {
        return sendValidationError(_reply, 'Validation failed', {
          firstName: 'First name and last name are required.',
        });
      }
      updateData.name = resolvedName.name;
      updateData.first_name = resolvedName.firstName;
      updateData.last_name = resolvedName.lastName;
    }
    if (body.email !== undefined) {
      const normalizedEmail = normalizeEmail(body.email);
      const conflictId = await findMemberIdWithConflictingNormalizedEmailChange(
        normalizedEmail,
        targetMember.email,
        memberId
      );
      if (conflictId != null) {
        return _reply.code(409).send({ error: MEMBER_PROFILE_EMAIL_UNAVAILABLE });
      }
      if (normalizedEmail !== (targetMember.email ? normalizeEmail(targetMember.email) : null)) {
        updateData.email = normalizedEmail;
      }
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone.trim();
    }
    if (body.emailVisible !== undefined) {
      updateData.email_visible = body.emailVisible ? 1 : 0;
    }
    if (body.phoneVisible !== undefined) {
      updateData.phone_visible = body.phoneVisible ? 1 : 0;
    }
    if (body.dateOfBirth !== undefined) {
      const dateOfBirth = body.dateOfBirth.trim();
      if (!dateOfBirth) {
        updateData.date_of_birth = null;
      } else {
        const parsed = new Date(`${dateOfBirth}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
          return sendValidationError(_reply, 'Validation failed', {
            dateOfBirth: 'Enter a valid date of birth.',
          });
        }
        const today = new Date();
        const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        if (parsed.getTime() > todayUtc) {
          return sendValidationError(_reply, 'Validation failed', {
            dateOfBirth: 'Date of birth cannot be in the future.',
          });
        }
        updateData.date_of_birth = dateOfBirth;
      }
    }
    if (body.mailingAddress !== undefined) {
      updateData.mailing_address = body.mailingAddress.trim() || null;
    }
    if (body.emergencyContactName !== undefined) {
      updateData.emergency_contact_name = body.emergencyContactName.trim() || null;
    }
    if (body.emergencyContactPhone !== undefined) {
      updateData.emergency_contact_phone = body.emergencyContactPhone.trim() || null;
    }
    if (body.lifetimeMember !== undefined) {
      updateData.lifetime_member = body.lifetimeMember ? 1 : 0;
    }
    if (body.isServerAdmin !== undefined) {
      updateData.is_server_admin = body.isServerAdmin ? 1 : 0;
    }
    if (body.isCalendarAdmin !== undefined) {
      updateData.is_calendar_admin = body.isCalendarAdmin ? 1 : 0;
    }
    if (body.isContentAdmin !== undefined) {
      updateData.is_content_admin = body.isContentAdmin ? 1 : 0;
    }
    if (body.baselineOtherClubExperienceYears !== undefined) {
      updateData.baseline_other_club_experience_years = normalizeHalfYearExperienceValue(
        body.baselineOtherClubExperienceYears
      );
    }
    if (body.baselineClubExperienceYears !== undefined) {
      updateData.baseline_club_experience_years = normalizeHalfYearExperienceValue(body.baselineClubExperienceYears);
    }
    if (body.isSponsorAdmin !== undefined) {
      updateData.is_sponsor_admin = body.isSponsorAdmin ? 1 : 0;
    }

    const hasAnyGuardianField =
      body.guardianFirstName !== undefined ||
      body.guardianLastName !== undefined ||
      body.guardianEmail !== undefined ||
      body.guardianPhone !== undefined;
    const hasAllGuardianFields =
      body.guardianFirstName !== undefined &&
      body.guardianLastName !== undefined &&
      body.guardianEmail !== undefined &&
      body.guardianPhone !== undefined;
    if (hasAnyGuardianField && !hasAllGuardianFields) {
      return sendValidationError(_reply, 'Validation failed', {
        guardian: 'Provide all parent/guardian contact fields together.',
      });
    }
    if (hasAllGuardianFields) {
      const guardianValues = {
        firstName: body.guardianFirstName!.trim(),
        lastName: body.guardianLastName!.trim(),
        email: body.guardianEmail!.trim(),
        phone: body.guardianPhone!.trim(),
      };
      const guardianIsEmpty =
        !guardianValues.firstName &&
        !guardianValues.lastName &&
        !guardianValues.email &&
        !guardianValues.phone;
      if (guardianIsEmpty) {
        await clearMemberGuardian(memberId);
      } else {
        const effectiveDateOfBirth =
          body.dateOfBirth !== undefined
            ? body.dateOfBirth.trim() || null
            : normalizeDateString(targetMember.date_of_birth);
        if (!isMemberMinor(effectiveDateOfBirth)) {
          return sendValidationError(_reply, 'Validation failed', {
            guardian: 'Parent/guardian information applies only to members under 18.',
          });
        }
        try {
          await applyMemberGuardianUpdate(memberId, guardianValues);
        } catch (error) {
          if (error instanceof MemberGuardianValidationError) {
            return sendValidationError(_reply, error.message, error.details);
          }
          throw error;
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.members)
        .set(updateData)
        .where(eq(schema.members.id, memberId));
    }

    if (body.isLeagueAdministrator !== undefined) {
      await setGlobalLeagueAdministrator(db, schema, memberId, body.isLeagueAdministrator);
    }
    if (body.isAdmin !== undefined) {
      await setGeneralAdminRole(memberId, body.isAdmin);
    }

    const updatedMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const updatedMember = updatedMembers[0] as Member;
    const generalAdminMemberIds = await loadGeneralAdminMemberIds();

    return {
      id: updatedMember.id,
      name: updatedMember.name,
      email: updatedMember.email,
      phone: updatedMember.phone,
      isAdmin: memberHasAdminAccess(updatedMember, { generalAdminMemberIds }),
      isServerAdmin: isServerAdmin(updatedMember),
      emailSubscribed: updatedMember.email_subscribed === 1,
      optedInSms: updatedMember.opted_in_sms === 1,
    };
    }
  );

  // Admin: Delete member
  fastify.delete<{ Params: { id: string }; Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/:id',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member || !isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);

    // Prevent self-deletion
    if (memberId === member.id) {
      return _reply.code(400).send({ error: 'You cannot delete yourself' });
    }

    const { db, schema } = getDrizzleDb();

    // Get target member to check permissions
    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1) as Member[];

    const targetMember = targetMembers[0];
    if (!targetMember) {
      return _reply.code(404).send({ error: 'Member not found' });
    }

    const isCurrentUserServerAdmin = isServerAdmin(member);
    const generalAdminMemberIds = await loadGeneralAdminMemberIds();

    // Check deletion permissions
    if (!isCurrentUserServerAdmin) {
      // Regular admin can only delete regular users (not admins or server admins)
      if (memberHasAdminAccess(targetMember, { generalAdminMemberIds }) || isServerAdmin(targetMember)) {
        return _reply.code(403).send({ error: 'You can only delete regular members' });
      }
    } else if (isServerAdmin(targetMember) && (await isLastServerAdminInDb(memberId))) {
      return _reply.code(400).send({ error: LAST_SERVER_ADMIN_ERROR });
    }

    await db.transaction(async (tx) => {
      await clearMemberRestrictedRelations(tx, schema, [memberId]);
      await tx.delete(schema.members).where(eq(schema.members.id, memberId));
    });

    return { success: true };
    }
  );

  // Admin: Bulk delete members
  fastify.post<{ Body: BulkDeleteBody; Reply: BulkDeleteResponse | ApiErrorResponse }>(
    '/members/bulk-delete',
    {
      schema: {
        tags: ['members'],
        body: bulkDeleteBodySchema,
        response: {
          200: bulkDeleteResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkDeleteSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get all members to check permissions
    const membersToDelete = await db
      .select()
      .from(schema.members)
      .where(inArray(schema.members.id, body.ids)) as Member[];

    const isCurrentUserServerAdmin = isServerAdmin(member);
    const generalAdminMemberIds = await loadGeneralAdminMemberIds();
    let remainingServerAdmins = await countServerAdminsInDb();

    // Filter based on permissions
    const deletableIds = membersToDelete
      .filter((m: Member) => {
        // Can't delete self
        if (m.id === member.id) return false;

        if (!isCurrentUserServerAdmin) {
          // Regular admin can only delete regular users (not admins or server admins)
          return !memberHasAdminAccess(m, { generalAdminMemberIds }) && !isServerAdmin(m);
        }

        if (isServerAdmin(m)) {
          if (remainingServerAdmins <= 1) return false;
          remainingServerAdmins -= 1;
        }

        return true;
      })
      .map((m: Member) => m.id);

    if (deletableIds.length === 0) {
      return _reply.code(400).send({ error: 'No members can be deleted with your permissions' });
    }

    // Use a transaction to ensure atomicity
    await db.transaction(async (tx) => {
      await clearMemberRestrictedRelations(tx, schema, deletableIds);

      await tx
        .delete(schema.memberAvailability)
        .where(inArray(schema.memberAvailability.member_id, deletableIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.requester_id, deletableIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.filled_by_member_id, deletableIds));
      
      await tx
        .delete(schema.spareRequestInvitations)
        .where(inArray(schema.spareRequestInvitations.member_id, deletableIds));
      
      await tx
        .delete(schema.spareResponses)
        .where(inArray(schema.spareResponses.member_id, deletableIds));
      
      // Finally delete the members
      await tx
        .delete(schema.members)
        .where(inArray(schema.members.id, deletableIds));
    });

    return { success: true, deletedCount: deletableIds.length };
    }
  );

  fastify.get<{ Params: { id: string }; Reply: MemberSeasonMembershipListResponse | ApiErrorResponse }>(
    '/members/:id/season-memberships',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: memberSeasonMembershipListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const memberId = parseInt(request.params.id, 10);
      if (!Number.isFinite(memberId)) {
        return reply.code(400).send({ error: 'Invalid member id' });
      }

      const { db, schema } = getDrizzleDb();
      const [targetMember] = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.id, memberId))
        .limit(1);
      if (!targetMember) {
        return reply.code(404).send({ error: 'Member not found' });
      }

      return listMemberSeasonMemberships(memberId);
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: CreateMemberSeasonMembershipBody;
    Reply: MemberSeasonMembershipResponse | ApiErrorResponse;
  }>(
    '/members/:id/season-memberships',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: createMemberSeasonMembershipBodySchema,
        response: {
          200: memberSeasonMembershipSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const memberId = parseInt(request.params.id, 10);
      if (!Number.isFinite(memberId)) {
        return reply.code(400).send({ error: 'Invalid member id' });
      }

      const body = createMemberSeasonMembershipSchema.parse(request.body);

      try {
        return await createMemberSeasonMembership({
          memberId,
          seasonId: body.seasonId,
          membershipType: body.membershipType,
        });
      } catch (error) {
        if (error instanceof MemberSeasonMembershipNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof MemberSeasonMembershipConflictError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  fastify.delete<{ Params: { id: string; membershipId: string }; Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/:id/season-memberships/:membershipId',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            membershipId: { type: 'string' },
          },
          required: ['id', 'membershipId'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const memberId = parseInt(request.params.id, 10);
      const membershipId = parseInt(request.params.membershipId, 10);
      if (!Number.isFinite(memberId) || !Number.isFinite(membershipId)) {
        return reply.code(400).send({ error: 'Invalid membership id' });
      }

      try {
        await deleteMemberSeasonMembership({ memberId, membershipId });
        return { success: true };
      } catch (error) {
        if (error instanceof MemberSeasonMembershipNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  // Server admin only: Get login link for member
  fastify.get<{ Params: { id: string }; Reply: LoginLinkResponse | ApiErrorResponse }>(
    '/members/:id/login-link',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: loginLinkResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember) {
      return _reply.code(404).send({ error: 'Member not found' });
    }

    const loginLink = `${config.frontendUrl}/login`;

    return { loginLink };
    }
  );

  // Admin: Send welcome email
  fastify.post<{ Params: { id: string }; Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/:id/send-welcome',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember || !targetMember.email) {
      return _reply.code(404).send({ error: 'Member not found or has no email' });
    }

    // Send welcome email asynchronously (fire-and-forget) to avoid blocking the response
    sendWelcomeEmail(targetMember.email, targetMember.name).catch((error) => {
      console.error('Error sending welcome email:', error);
    });

    return { success: true };
    }
  );

  // Admin: Bulk send welcome emails
  fastify.post<{ Body: BulkDeleteBody; Reply: BulkSendWelcomeResponse | ApiErrorResponse }>(
    '/members/bulk-send-welcome',
    {
      schema: {
        tags: ['members'],
        body: bulkDeleteBodySchema,
        response: {
          200: bulkSendWelcomeResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkDeleteSchema.parse(request.body); // Reuse the schema for IDs array
    const { db, schema } = getDrizzleDb();

    // Get all selected members with email addresses
    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(
        and(
          inArray(schema.members.id, body.ids),
          sql`${schema.members.email} IS NOT NULL AND ${schema.members.email} != ''`
        )
      ) as Member[];

    if (targetMembers.length === 0) {
      return _reply.code(400).send({ error: 'No members with email addresses found' });
    }

    // Send welcome emails asynchronously (fire-and-forget) to avoid blocking the response
    for (const targetMember of targetMembers) {
      if (targetMember.email) {
        sendWelcomeEmail(targetMember.email, targetMember.name).catch((error) => {
          console.error(`Error sending welcome email to ${targetMember.email}:`, error);
        });
      }
    }

    return {
      success: true,
      sent: targetMembers.length,
    };
    }
  );
}

