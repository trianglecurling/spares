import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  getWebhookEventDocumentation,
  isKnownWebhookEventType,
  type WebhookEventType,
} from './webhookEvents.js';

export const WEBHOOK_API_VERSION = '1';
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function safeJsonParseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function signPayload(secret: string, body: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

export function isValidWebhookDestinationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && parsed.hostname.toLowerCase() === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

export type WebhookEnvelope = {
  id: string;
  apiVersion: string;
  event: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
};

function buildEnvelope(deliveryId: string, eventType: WebhookEventType, data: Record<string, unknown>): WebhookEnvelope {
  return {
    id: deliveryId,
    apiVersion: WEBHOOK_API_VERSION,
    event: eventType,
    createdAt: new Date().toISOString(),
    data,
  };
}

async function loadLatestChargeTransactionId(orderId: number): Promise<string | null> {
  const { db, schema } = getDrizzleDb();
  const [transaction] = await db
    .select({ providerTransactionId: schema.paymentTransactions.provider_transaction_id })
    .from(schema.paymentTransactions)
    .where(
      and(
        eq(schema.paymentTransactions.payment_order_id, orderId),
        eq(schema.paymentTransactions.transaction_type, 'charge')
      )
    )
    .orderBy(desc(schema.paymentTransactions.id))
    .limit(1);
  return asString(transaction?.providerTransactionId);
}

async function loadLatestRefundAmountMinor(orderId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const [refund] = await db
    .select({ amountMinor: schema.refunds.amount_minor })
    .from(schema.refunds)
    .where(and(eq(schema.refunds.payment_order_id, orderId), eq(schema.refunds.status, 'succeeded')))
    .orderBy(desc(schema.refunds.id))
    .limit(1);
  return refund?.amountMinor ?? null;
}

async function buildSubjectBlock(
  subjectType: string,
  subjectId: number | null,
  metadata: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { db, schema } = getDrizzleDb();

  if (subjectType === 'donation') {
    return {
      donorName: asString(metadata.donorName ?? metadata.donor_name) ?? 'Donor',
      donorEmail: asString(metadata.donorEmail ?? metadata.donor_email),
    };
  }

  if (subjectType === 'event_registration' && subjectId) {
    const [row] = await db
      .select({
        contactName: schema.eventRegistrations.contact_name,
        contactEmail: schema.eventRegistrations.contact_email,
        eventTitle: schema.events.title,
        eventSlug: schema.events.slug,
      })
      .from(schema.eventRegistrations)
      .innerJoin(schema.events, eq(schema.eventRegistrations.event_id, schema.events.id))
      .where(eq(schema.eventRegistrations.id, subjectId))
      .limit(1);
    if (!row) return {};
    return {
      eventTitle: row.eventTitle,
      eventSlug: row.eventSlug,
      registrantName: row.contactName,
      registrantEmail: row.contactEmail,
    };
  }

  if (subjectType === 'curling_registration' && subjectId) {
    const [row] = await db
      .select({
        curlerName: schema.members.name,
        seasonName: schema.curlingSeasons.name,
      })
      .from(schema.curlingRegistrations)
      .innerJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
      .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
      .where(eq(schema.curlingRegistrations.id, subjectId))
      .limit(1);
    if (!row) return {};
    return {
      memberName: row.curlerName,
      seasonName: row.seasonName,
    };
  }

  if (subjectType === 'membership') {
    const memberName = asString(metadata.memberName ?? metadata.member_name);
    const seasonName = asString(metadata.seasonName ?? metadata.season_name);
    return {
      ...(memberName ? { memberName } : {}),
      ...(seasonName ? { seasonName } : {}),
    };
  }

  return {};
}

export async function buildPaymentWebhookData(
  orderId: number,
  options?: { includeRefundAmount?: boolean }
): Promise<Record<string, unknown> | null> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      orderToken: schema.paymentOrders.order_token,
      provider: schema.paymentOrders.provider,
      providerOrderId: schema.paymentOrders.provider_order_id,
      subjectType: schema.paymentOrders.subject_type,
      subjectId: schema.paymentOrders.subject_id,
      amountMinor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
      status: schema.paymentOrders.status,
      completedAt: schema.paymentOrders.completed_at,
      metadata: schema.paymentOrders.metadata,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, orderId))
    .limit(1);

  if (!order) return null;

  const metadata = safeJsonParseObject(order.metadata);
  const transactionId = await loadLatestChargeTransactionId(orderId);
  const subject = await buildSubjectBlock(order.subjectType, order.subjectId ?? null, metadata);

  const data: Record<string, unknown> = {
    orderId: order.id,
    orderToken: order.orderToken,
    provider: order.provider,
    providerOrderId: order.providerOrderId,
    subjectType: order.subjectType,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: order.status,
    completedAt: order.completedAt,
    ...(transactionId ? { transactionId } : {}),
    ...(Object.keys(subject).length > 0 ? { subject } : {}),
  };

  if (options?.includeRefundAmount) {
    const refundAmountMinor = await loadLatestRefundAmountMinor(orderId);
    if (refundAmountMinor != null) {
      data.refundAmountMinor = refundAmountMinor;
    }
  }

  return data;
}

export async function buildEventRegistrationWebhookData(orderId: number): Promise<Record<string, unknown> | null> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      subjectType: schema.paymentOrders.subject_type,
      subjectId: schema.paymentOrders.subject_id,
      amountMinor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, orderId))
    .limit(1);

  if (!order || order.subjectType !== 'event_registration' || !order.subjectId) {
    return null;
  }

  const [row] = await db
    .select({
      registrationId: schema.eventRegistrations.id,
      contactName: schema.eventRegistrations.contact_name,
      contactEmail: schema.eventRegistrations.contact_email,
      eventTitle: schema.events.title,
      eventSlug: schema.events.slug,
    })
    .from(schema.eventRegistrations)
    .innerJoin(schema.events, eq(schema.eventRegistrations.event_id, schema.events.id))
    .where(eq(schema.eventRegistrations.id, order.subjectId))
    .limit(1);

  if (!row) return null;

  return {
    registrationId: row.registrationId,
    eventTitle: row.eventTitle,
    eventSlug: row.eventSlug,
    registrantName: row.contactName,
    registrantEmail: row.contactEmail,
    amountMinor: order.amountMinor,
    currency: order.currency,
    orderId: order.id,
  };
}

export function buildSampleWebhookData(eventType: WebhookEventType): Record<string, unknown> {
  switch (eventType) {
    case 'payment.received':
      return {
        orderId: 0,
        orderToken: 'sample-order-token',
        provider: 'stripe',
        providerOrderId: 'pi_sample',
        subjectType: 'event_registration',
        amountMinor: 4500,
        currency: 'usd',
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        transactionId: 'ch_sample',
        subject: {
          eventTitle: 'Sample event',
          eventSlug: 'sample-event',
          registrantName: 'Sample Registrant',
          registrantEmail: 'registrant@example.com',
        },
      };
    case 'payment.refunded':
      return {
        orderId: 0,
        orderToken: 'sample-order-token',
        provider: 'stripe',
        providerOrderId: 'pi_sample',
        subjectType: 'event_registration',
        amountMinor: 4500,
        currency: 'usd',
        status: 'refunded',
        completedAt: new Date().toISOString(),
        transactionId: 'ch_sample',
        refundAmountMinor: 4500,
        subject: {
          eventTitle: 'Sample event',
          eventSlug: 'sample-event',
          registrantName: 'Sample Registrant',
          registrantEmail: 'registrant@example.com',
        },
      };
    case 'event_registration.received':
      return {
        registrationId: 0,
        eventTitle: 'Sample event',
        eventSlug: 'sample-event',
        registrantName: 'Sample Registrant',
        registrantEmail: 'registrant@example.com',
        amountMinor: 4500,
        currency: 'usd',
        orderId: 0,
      };
    default:
      return {};
  }
}

async function resolveWebhookData(
  eventType: WebhookEventType,
  context: { orderId: number }
): Promise<Record<string, unknown> | null> {
  switch (eventType) {
    case 'payment.received':
      return buildPaymentWebhookData(context.orderId);
    case 'payment.refunded':
      return buildPaymentWebhookData(context.orderId, { includeRefundAmount: true });
    case 'event_registration.received':
      return buildEventRegistrationWebhookData(context.orderId);
    default:
      return null;
  }
}

type WebhookRow = {
  id: number;
  event_type: string;
  destination_url: string;
  secret: string;
  enabled: number;
};

async function deliverWebhook(
  webhook: WebhookRow,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const deliveryId = crypto.randomUUID();
  const envelope = buildEnvelope(deliveryId, eventType, data);
  const body = safeJsonStringify(envelope);
  const signature = signPayload(webhook.secret, body);

  let responseStatus: number | null = null;
  let success = false;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(webhook.destination_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Broomstack-Webhooks/1',
          'X-Broomstack-Event': eventType,
          'X-Broomstack-Delivery': deliveryId,
          'X-Broomstack-Webhook-Id': String(webhook.id),
          'X-Broomstack-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      responseStatus = response.status;
      success = response.ok;
      if (!response.ok) {
        errorMessage = `HTTP ${response.status}`;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown delivery error';
  }

  await db.insert(schema.webhookDeliveries).values({
    webhook_id: webhook.id,
    event_type: eventType,
    payload: body,
    request_url: webhook.destination_url,
    response_status: responseStatus,
    success: success ? 1 : 0,
    error_message: errorMessage,
  });
}

export async function dispatchWebhookEvent(
  eventType: WebhookEventType,
  context: { orderId: number }
): Promise<void> {
  if (!isKnownWebhookEventType(eventType)) return;

  try {
    const data = await resolveWebhookData(eventType, context);
    if (!data) return;

    const { db, schema } = getDrizzleDb();
    const webhooks = (await db
      .select({
        id: schema.webhooks.id,
        event_type: schema.webhooks.event_type,
        destination_url: schema.webhooks.destination_url,
        secret: schema.webhooks.secret,
        enabled: schema.webhooks.enabled,
      })
      .from(schema.webhooks)
      .where(and(eq(schema.webhooks.event_type, eventType), eq(schema.webhooks.enabled, 1)))) as WebhookRow[];

    await Promise.all(webhooks.map((webhook) => deliverWebhook(webhook, eventType, data)));
  } catch {
    // Best-effort. Never block user flows if webhook delivery fails.
  }
}

export async function sendTestWebhook(webhookId: number): Promise<{
  success: boolean;
  responseStatus: number | null;
  errorMessage: string | null;
}> {
  const { db, schema } = getDrizzleDb();
  const [webhook] = (await db
    .select({
      id: schema.webhooks.id,
      event_type: schema.webhooks.event_type,
      destination_url: schema.webhooks.destination_url,
      secret: schema.webhooks.secret,
      enabled: schema.webhooks.enabled,
    })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1)) as WebhookRow[];

  if (!webhook) {
    throw new Error(`Webhook ${webhookId} not found`);
  }

  const eventType = webhook.event_type as WebhookEventType;
  if (!isKnownWebhookEventType(eventType)) {
    throw new Error(`Unknown webhook event type: ${webhook.event_type}`);
  }

  const data = buildSampleWebhookData(eventType);
  await deliverWebhook(webhook, eventType, data);

  const [delivery] = await db
    .select({
      success: schema.webhookDeliveries.success,
      responseStatus: schema.webhookDeliveries.response_status,
      errorMessage: schema.webhookDeliveries.error_message,
    })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.webhook_id, webhookId))
    .orderBy(desc(schema.webhookDeliveries.id))
    .limit(1);

  return {
    success: delivery?.success === 1,
    responseStatus: delivery?.responseStatus ?? null,
    errorMessage: delivery?.errorMessage ?? null,
  };
}

export function getWebhookEventLabel(eventType: string): string {
  return getWebhookEventDocumentation(eventType)?.label ?? eventType;
}
