import { desc, eq, sql } from 'drizzle-orm';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getWebhookEventRegistry, isKnownWebhookEventType } from '../services/webhookEvents.js';
import {
  generateWebhookSecret,
  getWebhookEventLabel,
  isValidWebhookDestinationUrl,
  sendTestWebhook,
} from '../services/webhookService.js';
import { hasScope } from '../utils/rbac.js';

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const createWebhookBodySchema = z.object({
  eventType: z.string().trim().min(1),
  destinationUrl: z.string().trim().url(),
  description: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const updateWebhookBodySchema = z.object({
  eventType: z.string().trim().min(1).optional(),
  destinationUrl: z.string().trim().url().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const listDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function tryParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requireAdminManage(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member || !hasScope(member.authz, 'admin.manage')) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function validateDestinationUrl(destinationUrl: string): string | null {
  if (!isValidWebhookDestinationUrl(destinationUrl)) {
    return 'Destination URL must use HTTPS, or HTTP with a localhost domain.';
  }
  return null;
}

function mapWebhookRow(row: {
  id: number;
  event_type: string;
  destination_url: string;
  secret: string;
  enabled: number;
  description: string | null;
  created_by_member_id: number | null;
  created_at: string | Date;
  updated_at: string | Date;
}, options?: { includeSecret?: boolean }) {
  return {
    id: row.id,
    eventType: row.event_type,
    eventLabel: getWebhookEventLabel(row.event_type),
    destinationUrl: row.destination_url,
    ...(options?.includeSecret ? { secret: row.secret } : {}),
    enabled: row.enabled === 1,
    description: row.description,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/webhooks/events',
    {
      schema: {
        tags: ['webhooks'],
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      return { events: getWebhookEventRegistry() };
    }
  );

  fastify.get(
    '/webhooks',
    {
      schema: {
        tags: ['webhooks'],
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const { db, schema } = getDrizzleDb();
      const rows = await db
        .select()
        .from(schema.webhooks)
        .orderBy(desc(schema.webhooks.created_at), desc(schema.webhooks.id));
      return {
        webhooks: rows.map((row) => mapWebhookRow(row)),
      };
    }
  );

  fastify.post<{ Body: Record<string, unknown> }>(
    '/webhooks',
    {
      schema: {
        tags: ['webhooks'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventType: { type: 'string' },
            destinationUrl: { type: 'string' },
            description: { type: 'string', nullable: true },
            enabled: { type: 'boolean' },
          },
          required: ['eventType', 'destinationUrl'],
        },
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const body = createWebhookBodySchema.parse(request.body ?? {});

      if (!isKnownWebhookEventType(body.eventType)) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: { eventType: 'Unknown event type.' },
        });
      }

      const destinationUrlError = validateDestinationUrl(body.destinationUrl);
      if (destinationUrlError) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: { destinationUrl: destinationUrlError },
        });
      }

      const { db, schema } = getDrizzleDb();
      const secret = generateWebhookSecret();
      const [created] = await db
        .insert(schema.webhooks)
        .values({
          event_type: body.eventType,
          destination_url: body.destinationUrl,
          secret,
          enabled: body.enabled === false ? 0 : 1,
          description: body.description ?? null,
          created_by_member_id: request.member?.id ?? null,
        })
        .returning();

      return reply.code(201).send({
        webhook: mapWebhookRow(created, { includeSecret: true }),
      });
    }
  );

  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/webhooks/:id',
    {
      schema: {
        tags: ['webhooks'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            eventType: { type: 'string' },
            destinationUrl: { type: 'string' },
            description: { type: 'string', nullable: true },
            enabled: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const params = idParamSchema.parse(request.params);
      const body = updateWebhookBodySchema.parse(request.body ?? {});

      if (body.eventType && !isKnownWebhookEventType(body.eventType)) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: { eventType: 'Unknown event type.' },
        });
      }

      if (body.destinationUrl) {
        const destinationUrlError = validateDestinationUrl(body.destinationUrl);
        if (destinationUrlError) {
          return reply.code(400).send({
            error: 'Validation failed',
            details: { destinationUrl: destinationUrlError },
          });
        }
      }

      const { db, schema } = getDrizzleDb();
      const [existing] = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, params.id))
        .limit(1);
      if (!existing) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }

      const updates: Record<string, unknown> = {
        updated_at: sql`CURRENT_TIMESTAMP`,
      };
      if (body.eventType !== undefined) updates.event_type = body.eventType;
      if (body.destinationUrl !== undefined) updates.destination_url = body.destinationUrl;
      if (body.description !== undefined) updates.description = body.description;
      if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;

      const [updated] = await db
        .update(schema.webhooks)
        .set(updates)
        .where(eq(schema.webhooks.id, params.id))
        .returning();

      return { webhook: mapWebhookRow(updated) };
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/webhooks/:id',
    {
      schema: {
        tags: ['webhooks'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const params = idParamSchema.parse(request.params);
      const { db, schema } = getDrizzleDb();

      const [existing] = await db
        .select({ id: schema.webhooks.id })
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, params.id))
        .limit(1);
      if (!existing) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }

      await db.delete(schema.webhooks).where(eq(schema.webhooks.id, params.id));
      return reply.code(204).send();
    }
  );

  fastify.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/webhooks/:id/deliveries',
    {
      schema: {
        tags: ['webhooks'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
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
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const params = idParamSchema.parse(request.params);
      const query = listDeliveriesQuerySchema.parse(request.query ?? {});
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const { db, schema } = getDrizzleDb();

      const [webhook] = await db
        .select({ id: schema.webhooks.id })
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, params.id))
        .limit(1);
      if (!webhook) {
        return reply.code(404).send({ error: 'Webhook not found' });
      }

      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(schema.webhookDeliveries)
          .where(eq(schema.webhookDeliveries.webhook_id, params.id))
          .orderBy(desc(schema.webhookDeliveries.created_at), desc(schema.webhookDeliveries.id))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.webhookDeliveries)
          .where(eq(schema.webhookDeliveries.webhook_id, params.id)),
      ]);

      return {
        total: Number(totalRows[0]?.count ?? 0),
        limit,
        offset,
        deliveries: rows.map((row) => ({
          id: row.id,
          webhookId: row.webhook_id,
          eventType: row.event_type,
          eventLabel: getWebhookEventLabel(row.event_type),
          payload: tryParseJson(row.payload),
          requestUrl: row.request_url,
          responseStatus: row.response_status,
          success: row.success === 1,
          errorMessage: row.error_message,
          createdAt: row.created_at,
        })),
      };
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/webhooks/:id/test',
    {
      schema: {
        tags: ['webhooks'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      if (!requireAdminManage(request, reply)) return;
      const params = idParamSchema.parse(request.params);

      try {
        const result = await sendTestWebhook(params.id);
        return { test: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send test webhook';
        if (message.includes('not found')) {
          return reply.code(404).send({ error: message });
        }
        request.log.error({ err: error }, 'Failed to send test webhook');
        return reply.code(500).send({ error: message });
      }
    }
  );
}
