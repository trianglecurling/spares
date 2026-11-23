import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { spareSettingsResponseSchema } from '../api/schemas.js';
import type { ApiReply } from '../api/types.js';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { hasClubLeagueAdministratorAccess } from '../utils/leagueAccess.js';
import {
  getSpareSettings,
  SPARE_SETTINGS_LIMITS,
  updateSpareSettings,
  type SpareSettings,
} from '../domains/spares/spareSettings.js';

function limitedInt(key: keyof SpareSettings) {
  const { min, max } = SPARE_SETTINGS_LIMITS[key];
  return z
    .number()
    .int('Enter a whole number.')
    .min(min, `Enter ${min} or more.`)
    .max(max, `Enter ${max} or less.`)
    .optional();
}

const updateSpareSettingsSchema = z.object({
  notificationDelaySeconds: limitedInt('notificationDelaySeconds'),
  byePriorityWindowMinutes: limitedInt('byePriorityWindowMinutes'),
  urgentThresholdHours: limitedInt('urgentThresholdHours'),
  reissueCooldownHours: limitedInt('reissueCooldownHours'),
});

const updateSpareSettingsBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notificationDelaySeconds: { type: 'number' },
    byePriorityWindowMinutes: { type: 'number' },
    urgentThresholdHours: { type: 'number' },
    reissueCooldownHours: { type: 'number' },
  },
} as const;

/** Sparing rules are public so the help pages can describe the real timings. */
export async function publicSpareSettingsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<SpareSettings> }>(
    '/public/spare-settings',
    {
      schema: {
        tags: ['spares'],
        response: {
          200: spareSettingsResponseSchema,
        },
      },
    },
    async () => getSpareSettings(),
  );
}

export async function protectedSpareSettingsRoutes(fastify: FastifyInstance) {
  fastify.patch<{ Reply: ApiReply<SpareSettings> }>(
    '/spare-settings',
    {
      schema: {
        tags: ['spares'],
        body: updateSpareSettingsBodySchema,
        response: {
          200: spareSettingsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return sendApiError(reply, 401, 'Unauthorized');
      }
      if (!(await hasClubLeagueAdministratorAccess(member))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = updateSpareSettingsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? '');
          if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        return sendValidationError(reply, 'Some sparing settings are not valid.', { fieldErrors });
      }

      return updateSpareSettings(parsed.data);
    },
  );
}
