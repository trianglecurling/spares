import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError, sendValidationError } from '../api/errors.js';
import type { ApiErrorResponse } from '../api/types.js';
import { PaymentServiceError } from '../services/paymentService.js';
import { resolveFrontendBaseUrl } from '../utils/frontendUrl.js';
import type { Member } from '../types.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';
import { MAX_DESIRED_LEAGUE_COUNT } from '../db/drizzle-schema.js';
import {
  RegistrationLeagueSelectionValidationError,
  getRegistrationLeagueCatalog,
  getRegistrationLeagueSelectionEvaluation,
  putRegistrationLeaguePriorities,
} from '../registration/registrationLeagueSelectionService.js';
import {
  RegistrationMembershipPaymentValidationError,
  getGuestMembershipPaymentPreview,
  getPublicRegistrationDiscountSettings,
  getPublicRegistrationMembershipFees,
  getRegistrationMembershipPaymentPayload,
  getRegistrationPaymentStatusByOrderToken,
  resolveRegistrationPaymentFromCheckoutReturn,
  markCurlingRegistrationPaymentCancelled,
  submitRegistrationMembershipPayment,
  updateDiscounts,
  updateExperience,
  updateIcePrivileges,
  updateMembership,
} from '../registration/registrationMembershipPaymentService.js';
import {
  RegistrationInProgressError,
  RegistrationShellValidationError,
  abandonRegistrationDraft,
  acceptPolicies,
  attachNewCurler,
  attachReturningCurler,
  canViewOrEditRegistration,
  completeShell,
  createDraft,
  findActiveRegistrationForSubmitter,
  findCompletedSelfRegistrationForWindow,
  getImmediatelyPriorRegistrationSessionDisplayName,
  getDefaultRegistrationWindow,
  getDefaultScheduleRegistrationWindow,
  getEffectiveRegistrationWindow,
  getRegistrationById,
  getRegistrationShellPayload,
  listEligibleReturningProfiles,
  submitGuestRegistration,
  updateCurlerDemographics,
  updateGuardian,
  type GuardianInput,
  type MemberDemographicsInput,
} from '../registration/registrationShellService.js';
import {
  REGISTRATION_EARLY_ACCESS_PATH,
  RegistrationEarlyAccessValidationError,
  bindEarlyAccessOnRequest,
  createEarlyAccessUnlockToken,
  isEarlyAccessUnlockedInRequest,
  isRegistrationEarlyAccessActive,
} from '../registration/registrationEarlyAccess.js';
import {
  registrationEarlyAccessStatusSchema,
  registrationEarlyAccessUnlockResponseSchema,
} from '../api/schemas.js';
import { getLeagueTeamMemberPlacementOptions } from '../registration/memberWaitlistJoinService.js';
import { RegistrationMemberValidationError } from '../registration/registrationMemberService.js';
import {
  evaluateRegistrantPlayInEntry,
  LeagueEntryValidationError,
} from '../registration/leagueEntryService.js';
import { canActorImpersonateTarget } from '../services/accountAccess.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const submitRegistrationSchema = z.object({
  confirmImmediatePayment: z.boolean().optional(),
  payLater: z.boolean().optional(),
  membershipCommitteeComments: z.string().trim().max(2000).nullable().optional(),
});
const windowQuerySchema = z.object({
  seasonId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
});
const paymentStatusParamsSchema = z.object({ orderToken: z.string().uuid() });
const resolveRegistrationPaymentSchema = z.object({
  sessionId: z.string().trim().min(3).max(255).optional(),
});
const createDraftSchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  returningMember: z.boolean(),
});
const earlyAccessUnlockSchema = z.object({
  password: z.string().min(1),
});
const returningIdentitySchema = z.object({
  curlerMemberId: z.number().int().positive(),
});
const demographicsSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1).optional(),
  email: z.string().email(),
  phone: z.string().min(1),
  mailingAddress: z.string().min(1),
  emergencyContactName: z.string().optional().default(''),
  emergencyContactPhone: z.string().optional().default(''),
});
const newIdentitySchema = z.object({
  registeringForSelf: z.boolean(),
  submitter: demographicsSchema.partial().extend({ email: z.string().email() }).optional(),
  curler: demographicsSchema.partial().extend({ email: z.string().email() }),
  useSubmitterEmailForCurler: z.boolean().optional(),
});
const policiesSchema = z.object({
  acceptedPolicyTypes: z.array(z.enum(['code_of_conduct', 'maapp', 'privacy'])).length(3),
});
const guardianSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});
const membershipSchema = z.object({
  membershipOption: z.enum(['regular', 'social', 'junior_recreational', 'none']),
  basicIcePrivileges: z.boolean().default(false),
  juniorAssistancePercent: z.number().int().refine((value) => [0, 25, 50, 75].includes(value)).nullable().optional(),
});
const icePrivilegesSchema = z.object({
  choice: z.enum(['league_play', 'basic_ice', 'none']),
});
const discountSchema = z.object({
  studentDiscountClaimed: z.boolean().optional(),
  studentInstitution: z.string().nullable().optional(),
  reciprocalDiscountClaimed: z.boolean().optional(),
  reciprocalClubName: z.string().nullable().optional(),
});
const experienceSchema = z.discriminatedUnion('experienceType', [
  z.object({ experienceType: z.literal('none_or_minimal'), experienceSelfReportedYears: z.null().optional() }),
  z.object({ experienceType: z.literal('specified_years'), experienceSelfReportedYears: z.coerce.number().min(0) }),
  z.object({ experienceType: z.literal('known_existing'), experienceSelfReportedYears: z.null().optional() }),
]);
const teamMemberPlacementOptionsQuerySchema = z.object({
  memberIds: z
    .union([z.string(), z.array(z.coerce.number().int().positive())])
    .transform((value) => {
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    }),
});
const leagueIdParamsSchema = z.object({ leagueId: z.coerce.number().int().positive() });
const playInEntryPreviewQuerySchema = z.object({
  /** Registrant being evaluated (the curler on the draft). Defaults to the authenticated actor. */
  memberId: z.coerce.number().int().positive().optional(),
  memberIds: z
    .union([z.string(), z.array(z.coerce.number().int().positive())])
    .optional()
    .transform((value) => {
      if (value == null) return [] as number[];
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    }),
  pendingNames: z.string().max(2000).optional().nullable(),
});
const leaguePrioritySchema = z.object({
  leagueId: z.number().int().positive(),
  priorityRank: z.number().int().positive(),
  byotTeammateText: z.string().max(2000).nullable().optional(),
  teamRosterPlacements: z
    .array(z.object({ memberId: z.number().int().positive() }))
    .nullable()
    .optional(),
});
const leaguePrioritiesSchema = z.object({
  desiredLeagueCount: z.number().int().min(1).max(MAX_DESIRED_LEAGUE_COUNT).nullable(),
  priorities: z.array(leaguePrioritySchema),
  priorLeagueDecisions: z
    .array(
      z.object({
        leagueId: z.number().int().positive(),
        decision: z.enum(['sabbatical', 'drop']),
        isTemporarySabbaticalFill: z.boolean().optional(),
      }),
    )
    .optional(),
  basicIceFallbackInterest: z.boolean().nullable().optional(),
});

const guestPreviewSchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  curlerDateOfBirth: z.string().min(1),
  membershipChoice: z.enum(['regular', 'social']),
  basicIcePrivileges: z.boolean(),
  studentDiscountClaimed: z.boolean(),
  studentInstitution: z.string().nullable(),
  reciprocalDiscountClaimed: z.boolean(),
  reciprocalClubName: z.string().nullable(),
  experienceType: z.enum(['none_or_minimal', 'specified_years', 'known_existing']),
  experienceSelfReportedYears: z.coerce.number().nullable(),
});

const guestSubmitSchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  registeringForSelf: z.boolean(),
  useSubmitterEmailForCurler: z.boolean().optional(),
  submitter: demographicsSchema.partial().extend({ email: z.string().email() }).optional(),
  curler: demographicsSchema,
  guardian: guardianSchema.optional(),
  membershipChoice: z.enum(['regular', 'social']),
  basicIcePrivileges: z.boolean(),
  studentDiscountClaimed: z.boolean(),
  studentInstitution: z.string().nullable(),
  reciprocalDiscountClaimed: z.boolean(),
  reciprocalClubName: z.string().nullable(),
  experienceType: z.enum(['none_or_minimal', 'specified_years', 'known_existing']),
  experienceSelfReportedYears: z.coerce.number().nullable(),
  payLater: z.boolean().optional(),
  membershipCommitteeComments: z.string().trim().max(2000).nullable().optional(),
});

const idParamsJsonSchema = {
  type: 'object',
  properties: { id: { type: 'number' } },
  required: ['id'],
} as const;

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;

const anyObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

function handleRegistrationError(reply: FastifyReply, error: unknown) {
  if (error instanceof RegistrationInProgressError) {
    return sendApiError(
      reply,
      409,
      'You already have a registration in progress. Continue from the registration start page or start over.',
    );
  }
  if (error instanceof RegistrationShellValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof RegistrationEarlyAccessValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof RegistrationMembershipPaymentValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof RegistrationLeagueSelectionValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof RegistrationMemberValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof PaymentServiceError) {
    return sendApiError(reply, error.statusCode, error.message);
  }
  if (error instanceof z.ZodError) {
    return sendValidationError(reply, 'Validation failed', error.flatten());
  }
  console.error('Registration shell error:', error);
  return sendApiError(reply, 500, 'Registration request failed');
}

async function requireDraftAccess(request: FastifyRequest, reply: FastifyReply, id: number) {
  const registration = await getRegistrationById(id);
  if (!registration) {
    sendApiError(reply, 404, 'Registration draft not found');
    return null;
  }
  const member = (request as AuthenticatedRequest).member;
  if (!(await canViewOrEditRegistration(member, registration))) {
    sendApiError(reply, 403, 'Forbidden');
    return null;
  }
  return registration;
}

export async function publicRegistrationShellRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', bindEarlyAccessOnRequest);

  fastify.get<{ Reply: unknown | ApiErrorResponse }>(
    '/registration/early-access/status',
    {
      schema: {
        tags: ['registration'],
        response: { 200: registrationEarlyAccessStatusSchema, 400: apiErrorResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        const scheduleWindow = await getDefaultScheduleRegistrationWindow();
        const registrationState = scheduleWindow?.state ?? 'closed';
        const available = (await isRegistrationEarlyAccessActive()) && registrationState === 'closed';
        return {
          available,
          registrationState,
          earlyAccessPath: REGISTRATION_EARLY_ACCESS_PATH,
        };
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Body: z.infer<typeof earlyAccessUnlockSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/early-access/unlock',
    {
      config: {
        rateLimit: abuseRouteRateLimits.registrationEarlyAccessUnlock,
      },
      schema: {
        tags: ['registration'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { password: { type: 'string' } },
          required: ['password'],
        },
        response: {
          200: registrationEarlyAccessUnlockResponseSchema,
          400: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const body = earlyAccessUnlockSchema.parse(request.body);
        return await createEarlyAccessUnlockToken(body.password);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: { seasonId?: number; sessionId?: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/window',
    {
      schema: {
        tags: ['registration'],
        querystring: {
          type: 'object',
          properties: { seasonId: { type: 'number' }, sessionId: { type: 'number' } },
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const query = windowQuerySchema.parse(request.query);
        const earlyAccessUnlocked = isEarlyAccessUnlockedInRequest(request);
        const window = query.seasonId && query.sessionId
          ? await getEffectiveRegistrationWindow(query.seasonId, query.sessionId, { earlyAccessUnlocked })
          : await getDefaultRegistrationWindow({ earlyAccessUnlocked });
        if (!window) return sendApiError(reply, 404, 'Registration window not found');
        const [previousRegistrationSessionDisplayName, availableDiscounts, membershipFees] = await Promise.all([
          getImmediatelyPriorRegistrationSessionDisplayName(window.session.id),
          getPublicRegistrationDiscountSettings(),
          getPublicRegistrationMembershipFees(),
        ]);
        return { ...window, previousRegistrationSessionDisplayName, availableDiscounts, membershipFees };
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Body: z.infer<typeof guestPreviewSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/guest/preview-membership-payment',
    {
      schema: {
        tags: ['registration'],
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const body = guestPreviewSchema.parse(request.body);
        return await getGuestMembershipPaymentPreview(body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Body: z.infer<typeof guestSubmitSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/guest/submit',
    {
      config: {
        rateLimit: abuseRouteRateLimits.guestRegistration,
      },
      schema: {
        tags: ['registration'],
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const body = guestSubmitSchema.parse(request.body);
        return await submitGuestRegistration(
          { ...body, earlyAccessUnlocked: isEarlyAccessUnlockedInRequest(request) },
          resolveFrontendBaseUrl(request),
        );
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { orderToken: string }; Reply: unknown | ApiErrorResponse }>(
    '/registration/payment-status/:orderToken',
    {
      schema: {
        tags: ['registration'],
        params: {
          type: 'object',
          properties: { orderToken: { type: 'string' } },
          required: ['orderToken'],
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { orderToken } = paymentStatusParamsSchema.parse(request.params);
        return await getRegistrationPaymentStatusByOrderToken(orderToken);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { orderToken: string }; Body: z.infer<typeof resolveRegistrationPaymentSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/payment-status/:orderToken/resolve',
    {
      schema: {
        tags: ['registration'],
        params: {
          type: 'object',
          properties: { orderToken: { type: 'string' } },
          required: ['orderToken'],
        },
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { orderToken } = paymentStatusParamsSchema.parse(request.params);
        const body = resolveRegistrationPaymentSchema.parse(request.body ?? {});
        return await resolveRegistrationPaymentFromCheckoutReturn(orderToken, body.sessionId ?? null);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );
}

export async function protectedRegistrationShellRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', bindEarlyAccessOnRequest);

  fastify.get('/registration/drafts/me', {
    schema: {
      tags: ['registration'],
      response: { 200: anyObjectSchema },
    },
  }, async (request) => {
    const member = (request as AuthenticatedRequest).member;
    const window = await getDefaultRegistrationWindow();
    const [row, completedSelf] = await Promise.all([
      findActiveRegistrationForSubmitter(member.id),
      window
        ? findCompletedSelfRegistrationForWindow(member.id, window.season.id, window.session.id)
        : Promise.resolve(null),
    ]);
    if (!row) {
      return {
        draft: null,
        completedSelfRegistration: completedSelf ? { id: completedSelf.id } : null,
      };
    }
    const shell = await getRegistrationShellPayload(row.id);
    return {
      draft: { id: row.id, ...shell },
      completedSelfRegistration: completedSelf ? { id: completedSelf.id } : null,
    };
  });

  fastify.post<{ Body: z.infer<typeof createDraftSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts',
    {
      schema: {
        tags: ['registration'],
        body: {
          type: 'object',
          properties: {
            seasonId: { type: 'number' },
            sessionId: { type: 'number' },
            returningMember: { type: 'boolean' },
          },
          required: ['seasonId', 'sessionId', 'returningMember'],
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 409: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const body = createDraftSchema.parse(request.body);
        return await createDraft({
          ...body,
          submittedByMemberId: (request as AuthenticatedRequest).member.id,
          earlyAccessUnlocked: isEarlyAccessUnlockedInRequest(request),
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        await abandonRegistrationDraft(id, (request as AuthenticatedRequest).member);
        return { ok: true };
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await requireDraftAccess(request, reply, id);
        if (!registration) return reply;
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: { seasonId?: number; sessionId?: number } }>('/registration/returning-profiles', {
    schema: {
      tags: ['registration'],
      querystring: {
        type: 'object',
        properties: { seasonId: { type: 'number' }, sessionId: { type: 'number' } },
      },
      response: { 200: { type: 'array', items: anyObjectSchema } },
    },
  }, async (request) => {
    const query = request.query ?? {};
    const seasonId = query.seasonId != null ? Number(query.seasonId) : undefined;
    const sessionId = query.sessionId != null ? Number(query.sessionId) : undefined;
    return listEligibleReturningProfiles(
      (request as AuthenticatedRequest).member.id,
      Number.isFinite(seasonId) ? seasonId : undefined,
      Number.isFinite(sessionId) ? sessionId : undefined,
    );
  });

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof returningIdentitySchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/identity-returning',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: {
          type: 'object',
          properties: { curlerMemberId: { type: 'number' } },
          required: ['curlerMemberId'],
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await getRegistrationById(id);
        if (!registration) return sendApiError(reply, 404, 'Registration draft not found');
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = returningIdentitySchema.parse(request.body);
        return await attachReturningCurler({
          registrationId: id,
          actorMemberId: (request as AuthenticatedRequest).member.id,
          curlerMemberId: body.curlerMemberId,
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof newIdentitySchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/identity-new',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = newIdentitySchema.parse(request.body);
        return await attachNewCurler({
          registrationId: id,
          actorMemberId: (request as AuthenticatedRequest).member.id,
          registeringForSelf: body.registeringForSelf,
          submitter: body.submitter,
          curler: body.curler,
          useSubmitterEmailForCurler: body.useSubmitterEmailForCurler,
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof policiesSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/policies',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        policiesSchema.parse(request.body);
        await acceptPolicies(id, (request as AuthenticatedRequest).member.id);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: MemberDemographicsInput & { confirmedCurrent?: boolean }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/demographics',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = demographicsSchema.extend({ confirmedCurrent: z.boolean().optional() }).parse(request.body);
        await updateCurlerDemographics(id, body, body.confirmedCurrent ?? false);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: GuardianInput; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/guardian',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = guardianSchema.parse(request.body);
        await updateGuardian(id, body);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/complete-shell',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        await completeShell(id);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/membership-payment',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await requireDraftAccess(request, reply, id);
        if (!registration) return reply;
        return await getRegistrationMembershipPaymentPayload(id, (request as AuthenticatedRequest).member);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof membershipSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/membership',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = membershipSchema.parse(request.body);
        return await updateMembership(id, (request as AuthenticatedRequest).member, body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof icePrivilegesSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/ice-privileges',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = icePrivilegesSchema.parse(request.body);
        return await updateIcePrivileges(id, (request as AuthenticatedRequest).member, body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof discountSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/discounts',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = discountSchema.parse(request.body);
        return await updateDiscounts(id, (request as AuthenticatedRequest).member, body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof experienceSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/experience',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = experienceSchema.parse(request.body);
        return await updateExperience(id, (request as AuthenticatedRequest).member, body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { leagueId: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/leagues/:leagueId/team-member-placement-options',
    {
      schema: {
        tags: ['registration'],
        params: { type: 'object', properties: { leagueId: { type: 'integer' } }, required: ['leagueId'] },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 401: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if (!request.member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      try {
        const params = leagueIdParamsSchema.parse(request.params);
        const query = teamMemberPlacementOptionsQuerySchema.parse(request.query);
        return await getLeagueTeamMemberPlacementOptions(params.leagueId, query.memberIds);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    },
  );

  fastify.get<{ Params: { leagueId: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/leagues/:leagueId/play-in-entry-preview',
    {
      schema: {
        tags: ['registration'],
        params: { type: 'object', properties: { leagueId: { type: 'integer' } }, required: ['leagueId'] },
        response: {
          200: anyObjectSchema,
          400: apiErrorResponseSchema,
          401: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      try {
        const params = leagueIdParamsSchema.parse(request.params);
        const query = playInEntryPreviewQuerySchema.parse(request.query);
        const registrantMemberId = query.memberId ?? request.member.id;
        // When registering on behalf of someone else, evaluate that curler — not the delegate.
        if (
          registrantMemberId !== request.member.id &&
          !memberCanManageRegistrations(request.member) &&
          !(await canActorImpersonateTarget(request.member.id, registrantMemberId))
        ) {
          return sendApiError(reply, 403, 'Forbidden');
        }
        return await evaluateRegistrantPlayInEntry({
          leagueId: params.leagueId,
          memberId: registrantMemberId,
          teamRosterPlacements: query.memberIds.map((memberId) => ({ memberId })),
          pendingTeammateText: query.pendingNames ?? null,
        });
      } catch (error) {
        if (error instanceof LeagueEntryValidationError) {
          return sendValidationError(reply, error.message, error.details);
        }
        return handleRegistrationError(reply, error);
      }
    },
  );

  fastify.get<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/league-catalog',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        return await getRegistrationLeagueCatalog(id, (request as AuthenticatedRequest).member);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.put<{ Params: { id: number }; Body: z.infer<typeof leaguePrioritiesSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/league-priorities',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = leaguePrioritiesSchema.parse(request.body);
        return await putRegistrationLeaguePriorities(id, (request as AuthenticatedRequest).member, body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/league-selection-eval',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        return await getRegistrationLeagueSelectionEvaluation(id, (request as AuthenticatedRequest).member);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: number }; Body: z.infer<typeof submitRegistrationSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/submit',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const body = submitRegistrationSchema.parse(request.body ?? {});
        return await submitRegistrationMembershipPayment({
          registrationId: id,
          actor: (request as AuthenticatedRequest).member,
          confirmImmediatePayment: body.confirmImmediatePayment,
          payLater: body.payLater,
          membershipCommitteeComments: body.membershipCommitteeComments,
          frontendBaseUrl: resolveFrontendBaseUrl(request),
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/payment-cancelled',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        await markCurlingRegistrationPaymentCancelled(id, (request as AuthenticatedRequest).member);
        return { ok: true };
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );
}
