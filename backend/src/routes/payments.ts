import { and, desc, eq, sql } from 'drizzle-orm';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { createPaymentService, PaymentServiceError } from '../services/paymentService.js';
import {
  listUpcomingEventsForPaymentItemNames,
  updateEventPaymentItemName,
  EventServiceError,
} from '../services/eventService.js';
import { hasScope } from '../utils/rbac.js';

const listOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  provider: z.enum(['stripe', 'paypal', 'square']).optional(),
  subjectType: z.enum(['donation', 'membership', 'event_registration', 'curling_registration']).optional(),
  status: z.enum(['created', 'pending', 'succeeded', 'failed', 'pending_refund', 'refunded', 'partially_refunded']).optional(),
});

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  provider: z.enum(['stripe', 'paypal', 'square']).optional(),
  status: z.enum(['received', 'processed', 'ignored', 'failed']).optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const updateEventItemNameBodySchema = z.object({
  paymentItemName: z.string().max(512).nullable(),
});

const eventIdParamSchema = z.object({
  eventId: z.coerce.number().int().positive(),
});

function tryParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requirePaymentsRead(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member || !hasScope(member.authz, 'payments.read')) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function requirePaymentsManage(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member || !hasScope(member.authz, 'payments.manage')) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/payments/orders',
    {
      schema: {
        tags: ['payments'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
            provider: { type: 'string', enum: ['stripe', 'paypal', 'square'] },
            subjectType: { type: 'string', enum: ['donation', 'membership', 'event_registration', 'curling_registration'] },
            status: { type: 'string', enum: ['created', 'pending', 'succeeded', 'failed', 'pending_refund', 'refunded', 'partially_refunded'] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requirePaymentsRead(request, reply)) return;
      const query = listOrdersQuerySchema.parse(request.query ?? {});
      const { db, schema } = getDrizzleDb();
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const conditions = [];
      if (query.provider) conditions.push(eq(schema.paymentOrders.provider, query.provider));
      if (query.subjectType) conditions.push(eq(schema.paymentOrders.subject_type, query.subjectType));
      if (query.status) conditions.push(eq(schema.paymentOrders.status, query.status));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: schema.paymentOrders.id,
            orderToken: schema.paymentOrders.order_token,
            provider: schema.paymentOrders.provider,
            subjectType: schema.paymentOrders.subject_type,
            subjectId: schema.paymentOrders.subject_id,
            amountMinor: schema.paymentOrders.amount_minor,
            currency: schema.paymentOrders.currency,
            status: schema.paymentOrders.status,
            statusReason: schema.paymentOrders.status_reason,
            providerOrderId: schema.paymentOrders.provider_order_id,
            metadata: schema.paymentOrders.metadata,
            createdByMemberId: schema.paymentOrders.created_by_member_id,
            completedAt: schema.paymentOrders.completed_at,
            createdAt: schema.paymentOrders.created_at,
            updatedAt: schema.paymentOrders.updated_at,
          })
          .from(schema.paymentOrders)
          .where(whereClause)
          .orderBy(desc(schema.paymentOrders.created_at), desc(schema.paymentOrders.id))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.paymentOrders)
          .where(whereClause),
      ]);

      return {
        total: Number(totalRows[0]?.count ?? 0),
        limit,
        offset,
        orders: rows.map((row) => ({
          ...row,
          metadata: tryParseJson(row.metadata),
        })),
      };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/payments/orders/:id',
    {
      schema: {
        tags: ['payments'],
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
      if (!requirePaymentsRead(request, reply)) return;
      const params = idParamSchema.parse(request.params);
      const { db, schema } = getDrizzleDb();

      const [order] = await db
        .select()
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, params.id))
        .limit(1);
      if (!order) {
        return reply.code(404).send({ error: 'Payment order not found' });
      }

      const [transactions, events, refunds] = await Promise.all([
        db
          .select()
          .from(schema.paymentTransactions)
          .where(eq(schema.paymentTransactions.payment_order_id, params.id))
          .orderBy(desc(schema.paymentTransactions.created_at), desc(schema.paymentTransactions.id)),
        db
          .select()
          .from(schema.paymentEvents)
          .where(eq(schema.paymentEvents.payment_order_id, params.id))
          .orderBy(desc(schema.paymentEvents.received_at), desc(schema.paymentEvents.id)),
        db
          .select()
          .from(schema.refunds)
          .where(eq(schema.refunds.payment_order_id, params.id))
          .orderBy(desc(schema.refunds.created_at), desc(schema.refunds.id)),
      ]);

      return {
        order: {
          ...order,
          metadata: tryParseJson(order.metadata),
        },
        transactions: transactions.map((row) => ({
          ...row,
          metadata: tryParseJson(row.metadata),
        })),
        events: events.map((row) => ({
          ...row,
          raw_payload: tryParseJson(row.raw_payload),
        })),
        refunds: refunds.map((row) => ({
          ...row,
          provider_response: tryParseJson(row.provider_response),
        })),
      };
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/payments/orders/:id/resync',
    {
      schema: {
        tags: ['payments'],
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
      if (!requirePaymentsManage(request, reply)) return;
      const params = idParamSchema.parse(request.params);
      const paymentService = createPaymentService();

      try {
        const reconciliation = await paymentService.reconcilePaymentOrder(params.id, 'admin-resync');
        const order = await paymentService.getPaymentOrderById(params.id);

        return {
          reconciliation,
          order: order
            ? {
                id: order.id,
                status: order.status,
                statusReason: order.statusReason,
                updatedAt: order.updatedAt,
              }
            : null,
        };
      } catch (error) {
        if (error instanceof PaymentServiceError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Failed to resync payment order';
        request.log.error({ err: error }, 'Failed to resync payment order');
        return reply.code(500).send({ error: message });
      }
    }
  );

  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/payments/events',
    {
      schema: {
        tags: ['payments'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
            provider: { type: 'string', enum: ['stripe', 'paypal', 'square'] },
            status: { type: 'string', enum: ['received', 'processed', 'ignored', 'failed'] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requirePaymentsRead(request, reply)) return;
      const query = listEventsQuerySchema.parse(request.query ?? {});
      const { db, schema } = getDrizzleDb();
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      const conditions = [];
      if (query.provider) conditions.push(eq(schema.paymentEvents.provider, query.provider));
      if (query.status) conditions.push(eq(schema.paymentEvents.processing_status, query.status));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: schema.paymentEvents.id,
            provider: schema.paymentEvents.provider,
            providerEventId: schema.paymentEvents.provider_event_id,
            eventType: schema.paymentEvents.event_type,
            paymentOrderId: schema.paymentEvents.payment_order_id,
            processingStatus: schema.paymentEvents.processing_status,
            processingError: schema.paymentEvents.processing_error,
            rawPayload: schema.paymentEvents.raw_payload,
            receivedAt: schema.paymentEvents.received_at,
            processedAt: schema.paymentEvents.processed_at,
          })
          .from(schema.paymentEvents)
          .where(whereClause)
          .orderBy(desc(schema.paymentEvents.received_at), desc(schema.paymentEvents.id))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.paymentEvents)
          .where(whereClause),
      ]);

      return {
        total: Number(totalRows[0]?.count ?? 0),
        limit,
        offset,
        events: rows.map((row) => ({
          ...row,
          rawPayload: tryParseJson(row.rawPayload),
        })),
      };
    }
  );

  fastify.get(
    '/payments/event-item-names',
    {
      schema: {
        tags: ['payments'],
      },
    },
    async (request, reply) => {
      if (!requirePaymentsRead(request, reply)) return;
      const events = await listUpcomingEventsForPaymentItemNames();
      return { events };
    }
  );

  fastify.patch<{ Params: { eventId: string }; Body: { paymentItemName: string | null } }>(
    '/payments/event-item-names/:eventId',
    {
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['eventId'],
          properties: {
            eventId: { type: 'number' },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['paymentItemName'],
          properties: {
            paymentItemName: { type: ['string', 'null'], maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requirePaymentsManage(request, reply)) return;
      const params = eventIdParamSchema.parse(request.params);
      const body = updateEventItemNameBodySchema.parse(request.body ?? {});
      try {
        await updateEventPaymentItemName(params.eventId, body.paymentItemName);
      } catch (error) {
        if (error instanceof EventServiceError) {
          reply.code(error.statusCode).send({ error: error.message });
          return;
        }
        throw error;
      }
      return { ok: true };
    }
  );
}
