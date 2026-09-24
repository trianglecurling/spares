import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { successResponseSchema } from '../api/schemas.js';
import type { ApiReply } from '../api/types.js';
import {
  confirmContactSettingsNudge,
  dismissContactSettingsNudge,
  getContactSettingsNudgeStatus,
} from '../services/contactSettingsNudgeService.js';

const contactSettingsNudgeStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visible: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
  },
  required: ['visible', 'emailVisible', 'phoneVisible'],
} as const;

const confirmContactSettingsNudgeBodySchema = z.object({
  emailVisible: z.boolean(),
  phoneVisible: z.boolean(),
});

const confirmContactSettingsNudgeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
  },
  required: ['success', 'emailVisible', 'phoneVisible'],
} as const;

export async function contactSettingsNudgeRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/members/me/contact-settings-nudge',
    {
      schema: {
        tags: ['members'],
        response: {
          200: contactSettingsNudgeStatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      return getContactSettingsNudgeStatus(member.id);
    },
  );

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/members/me/contact-settings-nudge/confirm',
    {
      schema: {
        tags: ['members'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            emailVisible: { type: 'boolean' },
            phoneVisible: { type: 'boolean' },
          },
          required: ['emailVisible', 'phoneVisible'],
        },
        response: {
          200: confirmContactSettingsNudgeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const body = confirmContactSettingsNudgeBodySchema.parse(request.body);
      return confirmContactSettingsNudge(member.id, body);
    },
  );

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/members/me/contact-settings-nudge/dismiss',
    {
      schema: {
        tags: ['members'],
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      return dismissContactSettingsNudge(member.id);
    },
  );
}
