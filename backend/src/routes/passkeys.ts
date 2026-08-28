import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ApiErrorResponse,
  MemberPasskeySummary,
  MemberPasskeysResponse,
  PasskeyCeremonyOptionsResponse,
  PasskeyRegistrationVerifyBody,
  UpdateMemberPasskeyBody,
} from '../api/types.js';
import { sendApiError } from '../api/errors.js';
import { logEvent } from '../services/observability.js';
import {
  beginPasskeyRegistration,
  deleteMemberPasskey,
  finishPasskeyRegistration,
  listMemberPasskeys,
  renameMemberPasskey,
  WebAuthnServiceError,
} from '../services/webauthnService.js';

const IMPERSONATION_PASSKEY_MESSAGE =
  "Passkeys cannot be changed while using another member's account.";

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
} as const;

const passkeySummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    createdAt: { type: 'string' },
    lastUsedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'createdAt', 'lastUsedAt'],
} as const;

const passkeysListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passkeys: { type: 'array', items: passkeySummarySchema },
  },
  required: ['passkeys'],
} as const;

const webauthnOptionsObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const ceremonyOptionsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    challengeId: { type: 'string' },
    options: webauthnOptionsObjectSchema,
  },
  required: ['challengeId', 'options'],
} as const;

const registrationVerifyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    challengeId: { type: 'string', minLength: 1 },
    credential: webauthnOptionsObjectSchema,
    name: { type: 'string' },
  },
  required: ['challengeId', 'credential'],
} as const;

const renameBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
  },
  required: ['name'],
} as const;

const registrationVerifyZod = z.object({
  challengeId: z.string().min(1),
  credential: z.record(z.unknown()),
  name: z.string().optional(),
});

const renameZod = z.object({
  name: z.string().min(1),
});

const passkeyIdParamsZod = z.object({
  passkeyId: z.coerce.number().int().positive(),
});

function sendWebAuthnError(reply: Parameters<typeof sendApiError>[0], error: unknown) {
  if (error instanceof WebAuthnServiceError) {
    return sendApiError(reply, error.statusCode, error.message);
  }
  throw error;
}

export async function protectedPasskeyRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: MemberPasskeysResponse | ApiErrorResponse }>(
    '/members/me/passkeys',
    {
      schema: {
        tags: ['members'],
        response: {
          200: passkeysListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      return { passkeys: await listMemberPasskeys(member.id) };
    }
  );

  fastify.post<{ Reply: PasskeyCeremonyOptionsResponse | ApiErrorResponse }>(
    '/members/me/passkeys/registration/options',
    {
      schema: {
        tags: ['members'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        response: {
          200: ceremonyOptionsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      if (request.isImpersonating) {
        return sendApiError(reply, 403, IMPERSONATION_PASSKEY_MESSAGE);
      }
      try {
        const result = await beginPasskeyRegistration(member);
        return {
          challengeId: result.challengeId,
          options: result.options as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return sendWebAuthnError(reply, error);
      }
    }
  );

  fastify.post<{
    Body: PasskeyRegistrationVerifyBody;
    Reply: MemberPasskeySummary | ApiErrorResponse;
  }>(
    '/members/me/passkeys/registration/verify',
    {
      schema: {
        tags: ['members'],
        body: registrationVerifyBodySchema,
        response: {
          200: passkeySummarySchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      if (request.isImpersonating) {
        return sendApiError(reply, 403, IMPERSONATION_PASSKEY_MESSAGE);
      }
      const body = registrationVerifyZod.parse(request.body);
      try {
        const passkey = await finishPasskeyRegistration({
          member,
          challengeId: body.challengeId,
          credential: body.credential,
          name: body.name,
          request,
        });
        logEvent({
          eventType: 'auth.passkey_registered',
          memberId: member.id,
          relatedId: passkey.id,
        }).catch(() => {});
        return passkey;
      } catch (error) {
        return sendWebAuthnError(reply, error);
      }
    }
  );

  fastify.patch<{
    Params: { passkeyId: string };
    Body: UpdateMemberPasskeyBody;
    Reply: MemberPasskeySummary | ApiErrorResponse;
  }>(
    '/members/me/passkeys/:passkeyId',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            passkeyId: { type: 'string' },
          },
          required: ['passkeyId'],
        },
        body: renameBodySchema,
        response: {
          200: passkeySummarySchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      if (request.isImpersonating) {
        return sendApiError(reply, 403, IMPERSONATION_PASSKEY_MESSAGE);
      }
      const { passkeyId } = passkeyIdParamsZod.parse(request.params);
      const body = renameZod.parse(request.body);
      try {
        return await renameMemberPasskey(member.id, passkeyId, body.name);
      } catch (error) {
        return sendWebAuthnError(reply, error);
      }
    }
  );

  fastify.delete<{
    Params: { passkeyId: string };
    Reply: { success: boolean } | ApiErrorResponse;
  }>(
    '/members/me/passkeys/:passkeyId',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            passkeyId: { type: 'string' },
          },
          required: ['passkeyId'],
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: {
              success: { type: 'boolean' },
            },
            required: ['success'],
          },
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      if (request.isImpersonating) {
        return sendApiError(reply, 403, IMPERSONATION_PASSKEY_MESSAGE);
      }
      const { passkeyId } = passkeyIdParamsZod.parse(request.params);
      try {
        await deleteMemberPasskey(member.id, passkeyId);
        logEvent({
          eventType: 'auth.passkey_removed',
          memberId: member.id,
          relatedId: passkeyId,
        }).catch(() => {});
        return { success: true };
      } catch (error) {
        return sendWebAuthnError(reply, error);
      }
    }
  );
}
