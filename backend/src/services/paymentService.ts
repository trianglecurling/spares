import crypto from 'crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendDonationReceiptEmail, sendEventRegistrationPaymentConfirmationEmail } from './email.js';
import { formatEventTimespansForDisplay } from '../utils/formatEventTimespans.js';
import { paymentDetailsUrl } from '../utils/paymentDetailsUrl.js';
import { logEvent } from './observability.js';
import { dispatchWebhookEvent } from './webhookService.js';
import { SquarePaymentProviderAdapter } from './squarePaymentProviderAdapter.js';
import {
  loadRegistrationPaymentItemNameMap,
  resolveRegistrationCheckoutItemDescription,
} from './registrationPaymentItemNamesService.js';

export type PaymentProvider = 'stripe' | 'paypal' | 'square';
export type PaymentSubjectType = 'donation' | 'membership' | 'event_registration' | 'curling_registration';
export type PaymentOrderStatus = 'created' | 'pending' | 'succeeded' | 'failed' | 'pending_refund' | 'refunded' | 'partially_refunded';
export type PaymentTransactionType = 'charge' | 'capture' | 'refund' | 'adjustment';
export type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed';

const ORDER_STATUS_TRANSITIONS: Record<PaymentOrderStatus, ReadonlySet<PaymentOrderStatus>> = {
  created: new Set(['pending', 'succeeded', 'failed']),
  pending: new Set(['succeeded', 'failed', 'partially_refunded', 'pending_refund', 'refunded']),
  succeeded: new Set(['partially_refunded', 'pending_refund', 'refunded']),
  failed: new Set(),
  pending_refund: new Set(['succeeded', 'partially_refunded', 'refunded']),
  refunded: new Set(),
  partially_refunded: new Set(['partially_refunded', 'pending_refund', 'refunded', 'succeeded']),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function safeJsonParseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value, (_key, nested) =>
      typeof nested === 'bigint' ? nested.toString() : nested
    );
    return json.length > 100_000 ? json.slice(0, 100_000) : json;
  } catch {
    return '{}';
  }
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function inferStatusFromEventType(eventType: string): PaymentOrderStatus | null {
  const normalized = eventType.toLowerCase();
  if (normalized.includes('partially_refunded') || normalized.includes('partial_refund')) return 'partially_refunded';
  if (normalized.includes('refunded') || normalized.includes('refund.succeeded')) return 'refunded';
  if (normalized.includes('succeeded') || normalized.includes('completed') || normalized.includes('paid')) return 'succeeded';
  if (normalized.includes('failed') || normalized.includes('canceled') || normalized.includes('cancelled')) return 'failed';
  if (normalized.includes('pending') || normalized.includes('processing')) return 'pending';
  if (normalized.includes('created')) return 'created';
  return null;
}

function normalizeOrderStatus(value: string | null, eventType: string): PaymentOrderStatus | null {
  if (!value) return inferStatusFromEventType(eventType);
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  if (
    normalized === 'created' ||
    normalized === 'pending' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'refunded' ||
    normalized === 'partially_refunded' ||
    normalized === 'pending_refund'
  ) {
    return normalized;
  }
  return inferStatusFromEventType(eventType);
}

function inferTransactionType(eventType: string): PaymentTransactionType {
  const normalized = eventType.toLowerCase();
  if (normalized.includes('refund')) return 'refund';
  if (normalized.includes('capture')) return 'capture';
  if (normalized.includes('adjust')) return 'adjustment';
  return 'charge';
}

function normalizeTransactionType(value: string | null, eventType: string): PaymentTransactionType {
  if (!value) return inferTransactionType(eventType);
  const normalized = value.trim().toLowerCase();
  if (normalized === 'charge' || normalized === 'capture' || normalized === 'refund' || normalized === 'adjustment') {
    return normalized;
  }
  return inferTransactionType(eventType);
}

function signatureCandidatesForProvider(provider: PaymentProvider): string[] {
  if (provider === 'stripe') return ['stripe-signature', 'x-stripe-signature', 'x-payment-signature'];
  if (provider === 'paypal') return ['paypal-transmission-sig', 'x-paypal-signature', 'x-payment-signature'];
  return ['x-square-hmacsha256-signature', 'x-square-signature', 'x-payment-signature'];
}

function normalizeSignature(value: string): string {
  if (value.includes(',')) {
    const parts = value.split(',').map((part) => part.trim());
    const versioned = parts.find((part) => part.startsWith('v1='));
    if (versioned) {
      return versioned.slice(3).trim();
    }
  }
  if (value.startsWith('sha256=')) return value.slice('sha256='.length).trim();
  return value.trim();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('unique') || message.includes('duplicate') || message.includes('conflict');
}

export class PaymentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'PaymentServiceError';
  }
}

export class PaymentSignatureError extends PaymentServiceError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'PaymentSignatureError';
  }
}

export interface HostedCheckoutSession {
  providerOrderId: string;
  checkoutUrl: string;
  expiresAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface CheckoutLineItem {
  description: string;
  amountMinor: number;
}

export interface CreateCheckoutInput {
  orderId: number;
  orderToken: string;
  amountMinor: number;
  currency: string;
  subjectType: PaymentSubjectType;
  subjectId: number | null;
  successUrl: string;
  cancelUrl: string;
  description?: string | null;
  customerEmail?: string | null;
  metadata?: Record<string, unknown>;
  lineItems?: CheckoutLineItem[];
}

function checkoutLineItemsTotalMinor(lineItems: CheckoutLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
}

export function truncateCheckoutText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function eventRegistrationCheckoutItemDescription(metadata: Record<string, unknown>): string {
  const customName = asString(metadata.paymentItemName ?? metadata.payment_item_name)?.trim();
  if (customName) return truncateCheckoutText(customName, 512);
  const eventTitle = asString(metadata.eventTitle ?? metadata.event_title);
  return eventTitle
    ? truncateCheckoutText(`Event registration — ${eventTitle}`, 512)
    : 'Event registration';
}

function defaultCheckoutDescription(subjectType: PaymentSubjectType, metadata: Record<string, unknown>): string {
  if (subjectType === 'donation') return 'Donation to Triangle Curling Club';
  if (subjectType === 'curling_registration') {
    if (asString(metadata.paymentKind) === 'registration_balance') {
      return 'Registration balance payment';
    }
    return 'League registration';
  }
  if (subjectType === 'event_registration') {
    return eventRegistrationCheckoutItemDescription(metadata);
  }
  return 'Triangle Curling Club payment';
}

export interface VerifyWebhookInput {
  headers: Record<string, string | undefined>;
  rawBody: string | Buffer;
  parsedBody: unknown;
}

export interface VerifiedWebhookEvent {
  providerEventId: string;
  eventType: string;
  eventCreatedAt: string | null;
  orderLookup: {
    orderId: number | null;
    orderToken: string | null;
    providerOrderId: string | null;
    providerTransactionId: string | null;
  };
  nextStatus: PaymentOrderStatus | null;
  transaction: {
    providerTransactionId: string;
    transactionType: PaymentTransactionType;
    amountMinor: number;
    currency: string;
    feeMinor: number | null;
    status: PaymentOrderStatus;
    occurredAt: string | null;
    metadata: Record<string, unknown> | null;
  } | null;
  rawPayload: unknown;
}

export interface CreateRefundInput {
  orderId: number;
  providerOrderId: string | null;
  /** Square/Stripe payment id when already known (e.g. from payment_transactions). */
  providerPaymentId?: string | null;
  amountMinor: number;
  currency: string;
  reason: string | null;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  status: RefundStatus;
  rawResponse: unknown;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createHostedCheckoutSession(input: CreateCheckoutInput): Promise<HostedCheckoutSession>;
  verifyWebhookEvent(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent>;
  fetchPaymentStatus(providerOrderId: string): Promise<PaymentOrderStatus>;
  fetchRefundStatus(providerRefundId: string): Promise<RefundStatus | null>;
  createRefund(input: CreateRefundInput): Promise<ProviderRefundResult>;
}

function buildStripeCheckoutLineItems(input: CreateCheckoutInput): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const fallbackName = input.description?.trim() || 'Triangle Curling Club payment';
  const lineItems = input.lineItems?.filter((item) => item.amountMinor !== 0) ?? [];
  const hasDiscounts = lineItems.some((item) => item.amountMinor < 0);
  const totalFromLineItems = checkoutLineItemsTotalMinor(lineItems);

  if (lineItems.length === 0 || hasDiscounts || totalFromLineItems !== input.amountMinor) {
    return [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amountMinor,
          product_data: {
            name: fallbackName,
          },
        },
      },
    ];
  }

  return lineItems.map((item) => ({
    quantity: 1,
    price_data: {
      currency: input.currency.toLowerCase(),
      unit_amount: item.amountMinor,
      product_data: {
        name: truncateCheckoutText(item.description, 250),
      },
    },
  }));
}

class StripePaymentProviderAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProvider = 'stripe';
  private readonly client: Stripe | null;
  private readonly webhookSecret: string | null;

  constructor(apiKey: string | null, webhookSecret: string | null) {
    const normalizedKey = apiKey?.trim() ?? '';
    this.client = normalizedKey ? new Stripe(normalizedKey) : null;
    this.webhookSecret = webhookSecret?.trim() ? webhookSecret.trim() : null;
  }

  private requireClient(): Stripe {
    if (!this.client) {
      throw new PaymentServiceError('Stripe is not configured. Missing STRIPE_API_KEY.', 500);
    }
    return this.client;
  }

  async createHostedCheckoutSession(input: CreateCheckoutInput): Promise<HostedCheckoutSession> {
    const stripe = this.requireClient();
    const metadata: Record<string, string> = {
      orderId: String(input.orderId),
      orderToken: input.orderToken,
      subjectType: input.subjectType,
    };
    if (input.subjectId !== null) {
      metadata.subjectId = String(input.subjectId);
    }
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        if (value === undefined || value === null) continue;
        metadata[key] = String(value);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: input.subjectType === 'donation' ? 'donate' : undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail ?? undefined,
      client_reference_id: input.orderToken,
      metadata,
      payment_intent_data: {
        metadata,
      },
      line_items: buildStripeCheckoutLineItems(input),
    });

    if (!session.url) {
      throw new PaymentServiceError('Stripe checkout session did not return a redirect URL', 502);
    }

    return {
      providerOrderId: session.id,
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      metadata: {
        paymentIntentId: asString(session.payment_intent),
      },
    };
  }

  async verifyWebhookEvent(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent> {
    const stripe = this.requireClient();
    if (!this.webhookSecret) {
      throw new PaymentSignatureError('Stripe webhook secret is not configured');
    }
    const signature = input.headers['stripe-signature'] ?? input.headers['x-stripe-signature'];
    if (!signature) {
      throw new PaymentSignatureError('Missing stripe-signature header');
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(input.rawBody, signature, this.webhookSecret);
    } catch (error) {
      throw new PaymentSignatureError(
        `Invalid Stripe webhook signature: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }

    const object = event.data.object as unknown as Record<string, unknown>;
    const objectMetadata = isRecord(object.metadata) ? object.metadata : {};
    const objectId = asString(object.id);

    const amountMinor = asNumber(object.amount_total ?? object.amount_received ?? object.amount) ?? 0;
    const rawAmountRefunded = asNumber(object.amount_refunded) ?? 0;
    const currency = (asString(object.currency) ?? 'usd').toLowerCase();
    const orderToken =
      asString(object.client_reference_id)
      ?? asString(objectMetadata.orderToken)
      ?? asString(objectMetadata.order_token)
      ?? null;
    const orderId = asNumber(objectMetadata.orderId ?? objectMetadata.paymentOrderId ?? objectMetadata.order_id);
    const providerOrderId =
      asString(objectMetadata.checkoutSessionId)
      ?? (asString(object.object) === 'checkout.session' ? objectId : null);

    let nextStatus: PaymentOrderStatus | null = inferStatusFromEventType(event.type);
    if (event.type === 'checkout.session.completed') {
      nextStatus = asString(object.payment_status) === 'paid' ? 'succeeded' : 'pending';
    } else if (event.type === 'checkout.session.async_payment_succeeded') {
      nextStatus = 'succeeded';
    } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      nextStatus = 'failed';
    } else if (event.type === 'payment_intent.payment_failed') {
      nextStatus = 'failed';
    } else if (event.type === 'charge.refunded') {
      const chargedAmount = asNumber(object.amount) ?? amountMinor;
      nextStatus = rawAmountRefunded > 0 && rawAmountRefunded < chargedAmount ? 'partially_refunded' : 'refunded';
    }

    const paymentIntentId = asString(object.payment_intent);
    let transactionId = paymentIntentId ?? objectId;
    let transactionType = normalizeTransactionType(null, event.type);
    let transactionAmount = amountMinor;
    if (event.type === 'charge.refunded') {
      transactionType = 'refund';
      transactionAmount = rawAmountRefunded > 0 ? rawAmountRefunded : amountMinor;
      transactionId = `${objectId}:refund`;
    }

    return {
      providerEventId: event.id,
      eventType: event.type,
      eventCreatedAt: new Date(event.created * 1000).toISOString(),
      orderLookup: {
        orderId,
        orderToken,
        providerOrderId,
        providerTransactionId: paymentIntentId,
      },
      nextStatus,
      transaction: transactionId
        ? {
            providerTransactionId: transactionId,
            transactionType,
            amountMinor: transactionAmount,
            currency,
            feeMinor: asNumber(object.application_fee_amount),
            status: nextStatus ?? (asBoolean(object.paid) ? 'succeeded' : 'pending'),
            occurredAt: new Date(event.created * 1000).toISOString(),
            metadata: objectMetadata,
          }
        : null,
      rawPayload: event,
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<PaymentOrderStatus> {
    const stripe = this.requireClient();
    const session = await stripe.checkout.sessions.retrieve(providerOrderId);
    if (session.payment_status === 'paid') return 'succeeded';
    if (session.status === 'expired') return 'failed';
    if (session.status === 'complete') return 'pending';
    return 'pending';
  }

  async createRefund(input: CreateRefundInput): Promise<ProviderRefundResult> {
    const stripe = this.requireClient();
    if (!input.providerOrderId) {
      throw new PaymentServiceError('Unable to create refund: payment order has no provider checkout session id', 400);
    }
    const session = await stripe.checkout.sessions.retrieve(input.providerOrderId);
    const paymentIntentId = asString(session.payment_intent);
    if (!paymentIntentId) {
      throw new PaymentServiceError('Unable to create refund: checkout session has no payment intent', 400);
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: input.amountMinor,
      reason: input.reason?.trim() ? 'requested_by_customer' : undefined,
      metadata: {
        orderId: String(input.orderId),
      },
    });

    const refundStatus: RefundStatus =
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'failed'
          ? 'failed'
          : refund.status === 'cancelled'
            ? 'rejected'
            : 'processing';

    return {
      providerRefundId: refund.id,
      status: refundStatus,
      rawResponse: refund,
    };
  }

  async fetchRefundStatus(providerRefundId: string): Promise<RefundStatus | null> {
    const stripe = this.requireClient();
    const refund = await stripe.refunds.retrieve(providerRefundId);
    if (refund.status === 'succeeded') return 'succeeded';
    if (refund.status === 'failed') return 'failed';
    if (refund.status === 'cancelled') return 'rejected';
    return 'processing';
  }
}

class HmacPaymentProviderAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  private readonly webhookSecret: string | null;

  constructor(provider: PaymentProvider, webhookSecret: string | null) {
    this.provider = provider;
    this.webhookSecret = webhookSecret;
  }

  async createHostedCheckoutSession(input: CreateCheckoutInput): Promise<HostedCheckoutSession> {
    const providerOrderId = `${this.provider}_${crypto.randomUUID()}`;
    const checkoutUrl = `${input.successUrl.replace(/\/+$/, '')}?provider=${this.provider}&order=${providerOrderId}`;
    return {
      providerOrderId,
      checkoutUrl,
      expiresAt: null,
      metadata: {
        orderId: input.orderId,
        orderToken: input.orderToken,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    };
  }

  async verifyWebhookEvent(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent> {
    if (!this.webhookSecret) {
      throw new PaymentSignatureError(`Webhook secret is not configured for ${this.provider}`);
    }

    const signatureHeaderName = signatureCandidatesForProvider(this.provider).find(
      (headerName) => input.headers[headerName]
    );
    const signatureHeaderValue = signatureHeaderName ? input.headers[signatureHeaderName] : null;
    if (!signatureHeaderValue) {
      throw new PaymentSignatureError(`Missing signature header for ${this.provider} webhook`);
    }

    const expected = crypto.createHmac('sha256', this.webhookSecret).update(input.rawBody).digest('hex');
    const supplied = normalizeSignature(signatureHeaderValue);
    if (!timingSafeStringEqual(expected, supplied)) {
      throw new PaymentSignatureError(`Invalid webhook signature for ${this.provider}`);
    }

    const payload = isRecord(input.parsedBody)
      ? input.parsedBody
      : (() => {
          try {
            const parsed = JSON.parse(
              Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody
            );
            return isRecord(parsed) ? parsed : {};
          } catch {
            return {};
          }
        })();
    const data = isRecord(payload.data) ? payload.data : {};
    const providerEventId = asString(payload.id) ?? asString(data.eventId) ?? asString(data.providerEventId);
    if (!providerEventId) {
      throw new PaymentServiceError(`Webhook payload for ${this.provider} is missing event id`, 400);
    }

    const eventType = asString(payload.type) ?? asString(data.type) ?? 'payment.event.unknown';
    const eventCreatedAt = asString(payload.createdAt) ?? asString(payload.created_at) ?? null;

    const status = normalizeOrderStatus(asString(data.status), eventType);
    const orderId = asNumber(data.orderId ?? data.paymentOrderId);
    const orderToken = asString(data.orderToken);
    const providerOrderId =
      asString(data.providerOrderId) ?? asString(data.checkoutSessionId) ?? asString(data.sessionId) ?? null;
    const providerTransactionId =
      asString(data.providerTransactionId) ??
      asString(data.transactionId) ??
      asString(data.chargeId) ??
      asString(data.refundId);

    const amountMinor = asNumber(data.amountMinor) ?? asNumber(data.amount) ?? 0;
    const feeMinor = asNumber(data.feeMinor);
    const currency = (asString(data.currency) ?? 'usd').toLowerCase();
    const occurredAt = asString(data.occurredAt) ?? asString(data.paidAt) ?? null;
    const transactionType = normalizeTransactionType(asString(data.transactionType), eventType);
    const transactionMetadata = isRecord(data.metadata) ? data.metadata : null;

    return {
      providerEventId,
      eventType,
      eventCreatedAt,
      orderLookup: {
        orderId,
        orderToken,
        providerOrderId,
        providerTransactionId: providerTransactionId ?? null,
      },
      nextStatus: status,
      transaction: providerTransactionId
        ? {
            providerTransactionId,
            transactionType,
            amountMinor,
            currency,
            feeMinor,
            status: status ?? 'pending',
            occurredAt,
            metadata: transactionMetadata,
          }
        : null,
      rawPayload: payload,
    };
  }

  async fetchPaymentStatus(_providerOrderId: string): Promise<PaymentOrderStatus> {
    return 'pending';
  }

  async fetchRefundStatus(_providerRefundId: string): Promise<RefundStatus | null> {
    return null;
  }

  async createRefund(_input: CreateRefundInput): Promise<ProviderRefundResult> {
    throw new PaymentServiceError(
      `${this.provider} refunds require the live payment provider adapter. Configure ${this.provider} credentials in PAYMENT_ENABLED_PROVIDERS.`,
      501
    );
  }
}

type DbHandle = ReturnType<typeof getDrizzleDb>['db'];
type SchemaHandle = ReturnType<typeof getDrizzleDb>['schema'];

export interface CreatePaymentOrderInput {
  provider?: PaymentProvider;
  subjectType: PaymentSubjectType;
  subjectId?: number | null;
  amountMinor: number;
  currency?: string;
  createdByMemberId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProcessWebhookInput {
  provider: PaymentProvider;
  headers: Record<string, string | undefined>;
  rawBody: string | Buffer;
  parsedBody: unknown;
}

export interface ProcessWebhookResult {
  eventId: number | null;
  paymentOrderId: number | null;
  deduplicated: boolean;
  status: 'processed' | 'ignored';
}

export interface CreateHostedCheckoutForOrderInput {
  orderId: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateHostedCheckoutForOrderResult {
  orderId: number;
  orderToken: string;
  provider: PaymentProvider;
  providerOrderId: string;
  checkoutUrl: string;
  expiresAt: string | null;
  status: PaymentOrderStatus;
}

export interface ReconcilePaymentOrderResult {
  orderId: number;
  provider: PaymentProvider;
  providerOrderId: string | null;
  previousStatus: PaymentOrderStatus;
  providerStatus: PaymentOrderStatus | null;
  currentStatus: PaymentOrderStatus;
  changed: boolean;
  reason: string;
}

export interface ReconcilePaymentOrderByTokenResult extends ReconcilePaymentOrderResult {
  orderToken: string;
}

export interface ReconcilePendingPaymentsSummary {
  checked: number;
  changed: number;
  skippedByMaxAge: number;
  staleThresholdIso: string;
  maxPendingAgeThresholdIso: string | null;
  results: ReconcilePaymentOrderResult[];
}

export interface CreateRefundForOrderInput {
  orderId: number;
  amountMinor?: number | null;
  reason?: string | null;
  requestedByMemberId?: number | null;
}

export class PaymentService {
  private readonly db: DbHandle;
  private readonly schema: SchemaHandle;
  private readonly adapters: Record<PaymentProvider, PaymentProviderAdapter>;
  private readonly defaultProvider: PaymentProvider;

  constructor(
    db: DbHandle,
    schema: SchemaHandle,
    adapters: Record<PaymentProvider, PaymentProviderAdapter>,
    defaultProvider: PaymentProvider
  ) {
    this.db = db;
    this.schema = schema;
    this.adapters = adapters;
    this.defaultProvider = defaultProvider;
  }

  async createPaymentOrder(input: CreatePaymentOrderInput): Promise<{ id: number; orderToken: string; status: PaymentOrderStatus }> {
    const provider = input.provider ?? this.defaultProvider;
    if (!getEnabledPaymentProviders().includes(provider)) {
      throw new PaymentServiceError(`Payment provider ${provider} is not enabled`, 400);
    }
    if (!this.adapters[provider]) {
      throw new PaymentServiceError(`Unsupported payment provider: ${provider}`, 400);
    }
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
      throw new PaymentServiceError('Payment amount must be a positive integer in minor units', 400);
    }

    const orderToken = crypto.randomUUID();
    const [inserted] = await this.db
      .insert(this.schema.paymentOrders)
      .values({
        order_token: orderToken,
        provider,
        subject_type: input.subjectType,
        subject_id: input.subjectId ?? null,
        amount_minor: input.amountMinor,
        currency: (input.currency ?? 'usd').toLowerCase(),
        status: 'created',
        metadata: input.metadata ? safeJsonStringify(input.metadata) : null,
        created_by_member_id: input.createdByMemberId ?? null,
      })
      .returning({
        id: this.schema.paymentOrders.id,
        order_token: this.schema.paymentOrders.order_token,
        status: this.schema.paymentOrders.status,
      });

    await logEvent({
      eventType: 'payment.order.created',
      memberId: input.createdByMemberId ?? null,
      relatedId: inserted.id,
      meta: {
        provider,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        amountMinor: input.amountMinor,
      },
    });

    return {
      id: inserted.id,
      orderToken: inserted.order_token,
      status: inserted.status as PaymentOrderStatus,
    };
  }

  private async resolveCheckoutLineItems(input: {
    orderId: number;
    subjectType: PaymentSubjectType;
    amountMinor: number;
    metadata: Record<string, unknown>;
  }): Promise<CheckoutLineItem[] | undefined> {
    if (input.subjectType === 'curling_registration') {
      if (asString(input.metadata.paymentKind) === 'registration_balance') {
        return [
          {
            description: 'Registration balance payment',
            amountMinor: input.amountMinor,
          },
        ];
      }

      const invoiceIdFromMetadata = asNumber(input.metadata.invoiceId);
      const [invoice] = await this.db
        .select({ id: this.schema.registrationInvoices.id })
        .from(this.schema.registrationInvoices)
        .where(
          invoiceIdFromMetadata != null
            ? eq(this.schema.registrationInvoices.id, invoiceIdFromMetadata)
            : eq(this.schema.registrationInvoices.payment_order_id, input.orderId)
        )
        .orderBy(desc(this.schema.registrationInvoices.updated_at), desc(this.schema.registrationInvoices.id))
        .limit(1);

      if (!invoice) return undefined;

      const configuredRegistrationItemNames = await loadRegistrationPaymentItemNameMap();

      const lineRows = await this.db
        .select({
          lineType: this.schema.registrationInvoiceLineItems.line_type,
          description: this.schema.registrationInvoiceLineItems.description,
          amountMinor: this.schema.registrationInvoiceLineItems.amount_minor,
        })
        .from(this.schema.registrationInvoiceLineItems)
        .where(eq(this.schema.registrationInvoiceLineItems.invoice_id, invoice.id))
        .orderBy(
          asc(this.schema.registrationInvoiceLineItems.sort_order),
          asc(this.schema.registrationInvoiceLineItems.id)
        );

      const lineItems = lineRows
        .map((line) => ({
          description: resolveRegistrationCheckoutItemDescription({
            lineType: line.lineType,
            invoiceDescription: line.description.trim(),
            configuredNames: configuredRegistrationItemNames,
          }),
          amountMinor: line.amountMinor,
        }))
        .filter((line) => line.description.length > 0 && line.amountMinor !== 0);

      if (lineItems.length === 0 || checkoutLineItemsTotalMinor(lineItems) !== input.amountMinor) {
        return undefined;
      }

      return lineItems;
    }

    if (input.subjectType === 'event_registration') {
      return [
        {
          description: eventRegistrationCheckoutItemDescription(input.metadata),
          amountMinor: input.amountMinor,
        },
      ];
    }

    return undefined;
  }

  async createHostedCheckoutForOrder(input: CreateHostedCheckoutForOrderInput): Promise<CreateHostedCheckoutForOrderResult> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        order_token: this.schema.paymentOrders.order_token,
        provider: this.schema.paymentOrders.provider,
        subject_type: this.schema.paymentOrders.subject_type,
        subject_id: this.schema.paymentOrders.subject_id,
        amount_minor: this.schema.paymentOrders.amount_minor,
        currency: this.schema.paymentOrders.currency,
        status: this.schema.paymentOrders.status,
        metadata: this.schema.paymentOrders.metadata,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, input.orderId))
      .limit(1);

    if (!order) {
      throw new PaymentServiceError(`Payment order ${input.orderId} not found`, 404);
    }

    const provider = order.provider as PaymentProvider;
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new PaymentServiceError(`Unsupported payment provider: ${provider}`, 400);
    }

    const parsedMetadata = safeJsonParseObject(order.metadata);
    const subjectType = order.subject_type as PaymentSubjectType;
    const checkoutLineItems = await this.resolveCheckoutLineItems({
      orderId: order.id,
      subjectType,
      amountMinor: order.amount_minor,
      metadata: parsedMetadata,
    });
    const checkoutSession = await adapter.createHostedCheckoutSession({
      orderId: order.id,
      orderToken: order.order_token,
      amountMinor: order.amount_minor,
      currency: order.currency,
      subjectType,
      subjectId: order.subject_id ?? null,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      description: defaultCheckoutDescription(subjectType, parsedMetadata),
      customerEmail: asString(parsedMetadata.donorEmail ?? parsedMetadata.donor_email),
      metadata: parsedMetadata,
      lineItems: checkoutLineItems,
    });

    await this.db
      .update(this.schema.paymentOrders)
      .set({
        provider_order_id: checkoutSession.providerOrderId,
        metadata: safeJsonStringify({
          ...parsedMetadata,
          ...(checkoutSession.metadata ?? {}),
          hostedCheckoutUrl: checkoutSession.checkoutUrl,
          hostedCheckoutExpiresAt: checkoutSession.expiresAt,
        }),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(this.schema.paymentOrders.id, order.id));

    const currentStatus = order.status as PaymentOrderStatus;
    if (currentStatus === 'created') {
      await this.transitionOrderStatus(order.id, 'pending', 'checkout-session-created');
    }

    return {
      orderId: order.id,
      orderToken: order.order_token,
      provider,
      providerOrderId: checkoutSession.providerOrderId,
      checkoutUrl: checkoutSession.checkoutUrl,
      expiresAt: checkoutSession.expiresAt,
      status: currentStatus === 'created' ? 'pending' : currentStatus,
    };
  }

  async getPaymentOrderByToken(orderToken: string): Promise<{
    id: number;
    orderToken: string;
    provider: PaymentProvider;
    subjectType: PaymentSubjectType;
    subjectId: number | null;
    amountMinor: number;
    currency: string;
    status: PaymentOrderStatus;
    providerOrderId: string | null;
    statusReason: string | null;
    completedAt: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    metadata: Record<string, unknown>;
  } | null> {
    const normalizedToken = orderToken.trim();
    if (!normalizedToken) return null;

    const [order] = await this.db
      .select()
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.order_token, normalizedToken))
      .limit(1);
    if (!order) return null;

    return {
      id: order.id,
      orderToken: order.order_token,
      provider: order.provider as PaymentProvider,
      subjectType: order.subject_type as PaymentSubjectType,
      subjectId: order.subject_id ?? null,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: order.status as PaymentOrderStatus,
      providerOrderId: order.provider_order_id ?? null,
      statusReason: order.status_reason ?? null,
      completedAt: order.completed_at ?? null,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      metadata: safeJsonParseObject(order.metadata),
    };
  }

  async getPaymentOrderById(orderId: number): Promise<{
    id: number;
    orderToken: string;
    provider: PaymentProvider;
    subjectType: PaymentSubjectType;
    subjectId: number | null;
    amountMinor: number;
    currency: string;
    status: PaymentOrderStatus;
    providerOrderId: string | null;
    statusReason: string | null;
    completedAt: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    metadata: Record<string, unknown>;
  } | null> {
    const [order] = await this.db
      .select()
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (!order) return null;

    return {
      id: order.id,
      orderToken: order.order_token,
      provider: order.provider as PaymentProvider,
      subjectType: order.subject_type as PaymentSubjectType,
      subjectId: order.subject_id ?? null,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: order.status as PaymentOrderStatus,
      providerOrderId: order.provider_order_id ?? null,
      statusReason: order.status_reason ?? null,
      completedAt: order.completed_at ?? null,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      metadata: safeJsonParseObject(order.metadata),
    };
  }

  async createRefundForOrder(input: CreateRefundForOrderInput): Promise<{
    refundId: number;
    provider: PaymentProvider;
    providerRefundId: string;
    status: RefundStatus;
    amountMinor: number;
    currency: string;
  }> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        provider: this.schema.paymentOrders.provider,
        provider_order_id: this.schema.paymentOrders.provider_order_id,
        status: this.schema.paymentOrders.status,
        amount_minor: this.schema.paymentOrders.amount_minor,
        currency: this.schema.paymentOrders.currency,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, input.orderId))
      .limit(1);
    if (!order) {
      throw new PaymentServiceError(`Payment order ${input.orderId} not found`, 404);
    }

    const currentStatus = order.status as PaymentOrderStatus;
    if (currentStatus !== 'succeeded' && currentStatus !== 'partially_refunded') {
      throw new PaymentServiceError(`Payment order ${input.orderId} cannot be refunded from status ${currentStatus}`, 409);
    }

    const amountMinor = Math.max(1, Math.min(input.amountMinor ?? order.amount_minor, order.amount_minor));
    const provider = order.provider as PaymentProvider;
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new PaymentServiceError(`Unsupported payment provider: ${provider}`, 400);
    }

    const [chargeTransaction] = await this.db
      .select({
        provider_transaction_id: this.schema.paymentTransactions.provider_transaction_id,
      })
      .from(this.schema.paymentTransactions)
      .where(
        and(
          eq(this.schema.paymentTransactions.payment_order_id, order.id),
          eq(this.schema.paymentTransactions.transaction_type, 'charge'),
        )
      )
      .orderBy(
        desc(this.schema.paymentTransactions.occurred_at),
        desc(this.schema.paymentTransactions.id)
      )
      .limit(1);

    const providerRefund = await adapter.createRefund({
      orderId: order.id,
      providerOrderId: order.provider_order_id ?? null,
      providerPaymentId: chargeTransaction?.provider_transaction_id ?? null,
      amountMinor,
      currency: order.currency,
      reason: input.reason?.trim() || null,
    });

    const isTerminal = providerRefund.status === 'succeeded' || providerRefund.status === 'failed' || providerRefund.status === 'rejected';
    const [refund] = await this.db
      .insert(this.schema.refunds)
      .values({
        payment_order_id: order.id,
        provider,
        amount_minor: amountMinor,
        currency: order.currency,
        reason: input.reason?.trim() || null,
        status: providerRefund.status,
        requested_by_member_id: input.requestedByMemberId ?? null,
        provider_refund_id: providerRefund.providerRefundId,
        provider_response: safeJsonStringify(providerRefund.rawResponse),
        processed_at: isTerminal ? sql`CURRENT_TIMESTAMP` : null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .returning({
        id: this.schema.refunds.id,
      });

    if (providerRefund.status === 'succeeded' || providerRefund.status === 'processing') {
      await this.syncOrderRefundStatus(order.id);
    }

    await logEvent({
      eventType: 'payment.refund.created',
      memberId: input.requestedByMemberId ?? null,
      relatedId: refund.id,
      meta: {
        paymentOrderId: order.id,
        provider,
        status: providerRefund.status,
        amountMinor,
        providerRefundId: providerRefund.providerRefundId,
      },
    });

    return {
      refundId: refund.id,
      provider,
      providerRefundId: providerRefund.providerRefundId,
      status: providerRefund.status,
      amountMinor,
      currency: order.currency,
    };
  }

  private async syncOrderRefundStatus(orderId: number): Promise<boolean> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        status: this.schema.paymentOrders.status,
        amount_minor: this.schema.paymentOrders.amount_minor,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (!order) return false;

    const currentStatus = order.status as PaymentOrderStatus;
    if (currentStatus === 'created' || currentStatus === 'failed' || currentStatus === 'pending') {
      return false;
    }

    const refundRows = await this.db
      .select({
        amount_minor: this.schema.refunds.amount_minor,
        status: this.schema.refunds.status,
      })
      .from(this.schema.refunds)
      .where(eq(this.schema.refunds.payment_order_id, orderId));

    const inFlightRefundStatuses = new Set<RefundStatus>(['processing', 'requested', 'approved']);
    const inFlightMinor = refundRows
      .filter((row) => inFlightRefundStatuses.has(row.status as RefundStatus))
      .reduce((sum, row) => sum + row.amount_minor, 0);
    const succeededMinor = refundRows
      .filter((row) => row.status === 'succeeded')
      .reduce((sum, row) => sum + row.amount_minor, 0);

    let targetStatus: PaymentOrderStatus | null = null;
    if (inFlightMinor > 0) {
      targetStatus = 'pending_refund';
    } else if (succeededMinor >= order.amount_minor) {
      targetStatus = 'refunded';
    } else if (succeededMinor > 0) {
      targetStatus = 'partially_refunded';
    } else if (
      currentStatus === 'pending_refund'
      || currentStatus === 'partially_refunded'
      || currentStatus === 'refunded'
    ) {
      targetStatus = 'succeeded';
    }

    if (!targetStatus || targetStatus === currentStatus) return false;

    return this.transitionOrderStatus(orderId, targetStatus, 'refund-status-sync');
  }

  async reconcileRefundsForOrder(orderId: number): Promise<void> {
    const pendingRefunds = await this.db
      .select({
        id: this.schema.refunds.id,
        provider: this.schema.refunds.provider,
        provider_refund_id: this.schema.refunds.provider_refund_id,
        status: this.schema.refunds.status,
        provider_response: this.schema.refunds.provider_response,
      })
      .from(this.schema.refunds)
      .where(
        and(
          eq(this.schema.refunds.payment_order_id, orderId),
          inArray(this.schema.refunds.status, ['processing', 'requested', 'approved'])
        )
      );

    for (const row of pendingRefunds) {
      if (!row.provider_refund_id) continue;
      const provider = row.provider as PaymentProvider;
      const adapter = this.adapters[provider];
      if (!adapter) continue;

      try {
        const providerStatus = await adapter.fetchRefundStatus(row.provider_refund_id);
        if (!providerStatus || providerStatus === row.status) continue;

        const isTerminal =
          providerStatus === 'succeeded'
          || providerStatus === 'failed'
          || providerStatus === 'rejected';
        await this.db
          .update(this.schema.refunds)
          .set({
            status: providerStatus,
            processed_at: isTerminal ? sql`CURRENT_TIMESTAMP` : null,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(this.schema.refunds.id, row.id));
      } catch (error) {
        await logEvent({
          eventType: 'payment.refund.reconcile_failed',
          relatedId: row.id,
          meta: {
            paymentOrderId: orderId,
            provider,
            providerRefundId: row.provider_refund_id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    await this.syncOrderRefundStatus(orderId);
  }

  async reconcilePaymentOrder(orderId: number, reason = 'manual-reconcile'): Promise<ReconcilePaymentOrderResult> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        provider: this.schema.paymentOrders.provider,
        provider_order_id: this.schema.paymentOrders.provider_order_id,
        status: this.schema.paymentOrders.status,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (!order) {
      throw new PaymentServiceError(`Payment order ${orderId} not found`, 404);
    }

    const provider = order.provider as PaymentProvider;
    const previousStatus = order.status as PaymentOrderStatus;
    const providerOrderId = order.provider_order_id ?? null;
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new PaymentServiceError(`Unsupported payment provider: ${provider}`, 400);
    }

    if (!providerOrderId) {
      return {
        orderId,
        provider,
        providerOrderId: null,
        previousStatus,
        providerStatus: null,
        currentStatus: previousStatus,
        changed: false,
        reason: 'missing_provider_order_id',
      };
    }

    const providerStatus = await adapter.fetchPaymentStatus(providerOrderId);
    let currentStatus = previousStatus;
    let changed = false;
    let resultReason = reason;

    if (providerStatus !== previousStatus) {
      try {
        changed = await this.transitionOrderStatus(orderId, providerStatus, `${reason}:${provider}`);
        if (changed) {
          currentStatus = providerStatus;
          if (providerStatus === 'succeeded') {
            await this.runSucceededOrderSideEffects(orderId);
          } else if (providerStatus === 'refunded' || providerStatus === 'partially_refunded') {
            await this.runRefundedOrderSideEffects(orderId);
          }
        }
      } catch (error) {
        if (error instanceof PaymentServiceError && error.statusCode === 409) {
          resultReason = `${reason}:invalid_transition`;
          changed = false;
        } else {
          throw error;
        }
      }
    }

    await logEvent({
      eventType: 'payment.order.reconciled',
      relatedId: orderId,
      meta: {
        provider,
        providerOrderId,
        previousStatus,
        providerStatus,
        currentStatus,
        changed,
        reason: resultReason,
      },
    });

    if ((providerStatus === 'succeeded' || currentStatus === 'succeeded') && !changed) {
      await this.confirmCurlingRegistrationForSucceededOrder(orderId);
      await this.confirmEventRegistrationForSucceededOrder(orderId);
    }

    await this.reconcileRefundsForOrder(orderId);

    const [refreshedOrder] = await this.db
      .select({ status: this.schema.paymentOrders.status })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (refreshedOrder) {
      currentStatus = refreshedOrder.status as PaymentOrderStatus;
      changed = currentStatus !== previousStatus;
    }

    return {
      orderId,
      provider,
      providerOrderId,
      previousStatus,
      providerStatus,
      currentStatus,
      changed,
      reason: resultReason,
    };
  }

  async reconcilePaymentOrderByToken(
    orderToken: string,
    expectedProviderOrderId: string | null = null,
    reason = 'checkout-return-reconcile'
  ): Promise<ReconcilePaymentOrderByTokenResult> {
    const normalizedToken = orderToken.trim();
    if (!normalizedToken) {
      throw new PaymentServiceError('Missing payment order token', 400);
    }

    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        order_token: this.schema.paymentOrders.order_token,
        provider_order_id: this.schema.paymentOrders.provider_order_id,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.order_token, normalizedToken))
      .limit(1);
    if (!order) {
      throw new PaymentServiceError(`Payment order with token ${normalizedToken} not found`, 404);
    }

    if (expectedProviderOrderId && order.provider_order_id && order.provider_order_id !== expectedProviderOrderId) {
      throw new PaymentServiceError('Checkout session does not match this payment order', 409);
    }

    if (expectedProviderOrderId && !order.provider_order_id) {
      await this.db
        .update(this.schema.paymentOrders)
        .set({
          provider_order_id: expectedProviderOrderId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(this.schema.paymentOrders.id, order.id));
    }

    const result = await this.reconcilePaymentOrder(order.id, reason);
    return {
      ...result,
      orderToken: order.order_token,
    };
  }

  async reconcileStalePendingOrders(
    staleBefore: Date,
    limit: number,
    reason = 'background-reconcile',
    maxPendingAgeSeconds: number | null = null
  ): Promise<ReconcilePendingPaymentsSummary> {
    const batchLimit = Math.max(1, Math.min(200, limit));
    const maxPendingAgeThreshold =
      maxPendingAgeSeconds && maxPendingAgeSeconds > 0
        ? new Date(Date.now() - maxPendingAgeSeconds * 1000)
        : null;
    const candidateRows = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        status: this.schema.paymentOrders.status,
        provider_order_id: this.schema.paymentOrders.provider_order_id,
        created_at: this.schema.paymentOrders.created_at,
        updated_at: this.schema.paymentOrders.updated_at,
      })
      .from(this.schema.paymentOrders)
      .where(
        or(
          eq(this.schema.paymentOrders.status, 'created'),
          eq(this.schema.paymentOrders.status, 'pending')
        )
      )
      .orderBy(this.schema.paymentOrders.updated_at, this.schema.paymentOrders.id)
      .limit(batchLimit * 4);

    const staleRows = candidateRows
      .filter((row) => {
        if (!row.provider_order_id) return false;
        const updatedOrCreatedAt = parseDateValue(row.updated_at) ?? parseDateValue(row.created_at);
        if (!updatedOrCreatedAt) return false;
        if (updatedOrCreatedAt.getTime() > staleBefore.getTime()) return false;

        if (maxPendingAgeThreshold) {
          const createdAt = parseDateValue(row.created_at) ?? updatedOrCreatedAt;
          if (!createdAt) return false;
          if (createdAt.getTime() < maxPendingAgeThreshold.getTime()) return false;
        }

        return true;
      })
      .slice(0, batchLimit);
    const skippedByMaxAge = maxPendingAgeThreshold
      ? candidateRows.filter((row) => {
          if (!row.provider_order_id) return false;
          const updatedOrCreatedAt = parseDateValue(row.updated_at) ?? parseDateValue(row.created_at);
          if (!updatedOrCreatedAt) return false;
          if (updatedOrCreatedAt.getTime() > staleBefore.getTime()) return false;
          const createdAt = parseDateValue(row.created_at) ?? updatedOrCreatedAt;
          if (!createdAt) return false;
          return createdAt.getTime() < maxPendingAgeThreshold.getTime();
        }).length
      : 0;

    const results: ReconcilePaymentOrderResult[] = [];
    for (const row of staleRows) {
      try {
        const result = await this.reconcilePaymentOrder(row.id, reason);
        results.push(result);
      } catch (error) {
        await logEvent({
          eventType: 'payment.order.reconcile_failed',
          relatedId: row.id,
          meta: {
            error: error instanceof Error ? error.message : 'Unknown error',
            reason,
          },
        });
      }
    }

    return {
      checked: staleRows.length,
      changed: results.filter((result) => result.changed).length,
      skippedByMaxAge,
      staleThresholdIso: staleBefore.toISOString(),
      maxPendingAgeThresholdIso: maxPendingAgeThreshold ? maxPendingAgeThreshold.toISOString() : null,
      results,
    };
  }

  async transitionOrderStatus(orderId: number, nextStatus: PaymentOrderStatus, reason?: string | null): Promise<boolean> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        status: this.schema.paymentOrders.status,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (!order) {
      throw new PaymentServiceError(`Payment order ${orderId} not found`, 404);
    }

    const currentStatus = order.status as PaymentOrderStatus;
    if (currentStatus === nextStatus) return false;

    const allowedNextStatuses = ORDER_STATUS_TRANSITIONS[currentStatus];
    if (!allowedNextStatuses.has(nextStatus)) {
      throw new PaymentServiceError(
        `Invalid payment order transition from ${currentStatus} to ${nextStatus} for order ${orderId}`,
        409
      );
    }

    const [updated] = await this.db
      .update(this.schema.paymentOrders)
      .set({
        status: nextStatus,
        status_reason: reason ?? null,
        completed_at:
          nextStatus === 'succeeded' || nextStatus === 'refunded' || nextStatus === 'partially_refunded'
            ? sql`CURRENT_TIMESTAMP`
            : null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(this.schema.paymentOrders.id, orderId), eq(this.schema.paymentOrders.status, currentStatus)))
      .returning({ id: this.schema.paymentOrders.id });

    if (!updated) {
      return false;
    }

    await logEvent({
      eventType: 'payment.order.status_transition',
      relatedId: orderId,
      meta: {
        from: currentStatus,
        to: nextStatus,
        reason: reason ?? null,
      },
    });
    return true;
  }

  async processWebhook(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
    const adapter = this.adapters[input.provider];
    if (!adapter) {
      throw new PaymentServiceError(`Unsupported payment provider: ${input.provider}`, 400);
    }

    const verified = await adapter.verifyWebhookEvent({
      headers: input.headers,
      rawBody: input.rawBody,
      parsedBody: input.parsedBody,
    });

    const [existingEvent] = await this.db
      .select({ id: this.schema.paymentEvents.id, payment_order_id: this.schema.paymentEvents.payment_order_id })
      .from(this.schema.paymentEvents)
      .where(
        and(
          eq(this.schema.paymentEvents.provider, input.provider),
          eq(this.schema.paymentEvents.provider_event_id, verified.providerEventId)
        )
      )
      .limit(1);
    if (existingEvent) {
      await logEvent({
        eventType: 'payment.webhook.deduplicated',
        relatedId: existingEvent.id,
        meta: {
          provider: input.provider,
          providerEventId: verified.providerEventId,
        },
      });
      return {
        eventId: existingEvent.id,
        paymentOrderId: existingEvent.payment_order_id ?? null,
        deduplicated: true,
        status: 'ignored',
      };
    }

    const order = await this.findOrderForWebhook(input.provider, verified.orderLookup);
    let eventId: number | null = null;
    const eventReceivedAt = parseTimestamp(verified.eventCreatedAt);
    try {
      const [insertedEvent] = await this.db
        .insert(this.schema.paymentEvents)
        .values({
          provider: input.provider,
          provider_event_id: verified.providerEventId,
          event_type: verified.eventType,
          payment_order_id: order?.id ?? null,
          processing_status: 'received',
          raw_payload: safeJsonStringify(verified.rawPayload),
          received_at: eventReceivedAt ?? sql`CURRENT_TIMESTAMP`,
        })
        .returning({ id: this.schema.paymentEvents.id });
      eventId = insertedEvent?.id ?? null;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return {
          eventId: null,
          paymentOrderId: order?.id ?? null,
          deduplicated: true,
          status: 'ignored',
        };
      }
      throw error;
    }

    if (!order) {
      await this.db
        .update(this.schema.paymentEvents)
        .set({
          processing_status: 'ignored',
          processing_error: 'No matching payment order found',
          processed_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(this.schema.paymentEvents.id, eventId!));
      await logEvent({
        eventType: 'payment.webhook.unmatched',
        relatedId: eventId,
        meta: {
          provider: input.provider,
          providerEventId: verified.providerEventId,
          orderLookup: verified.orderLookup,
        },
      });
      return {
        eventId,
        paymentOrderId: null,
        deduplicated: false,
        status: 'ignored',
      };
    }

    try {
      if (verified.orderLookup.providerOrderId && !order.provider_order_id) {
        await this.db
          .update(this.schema.paymentOrders)
          .set({
            provider_order_id: verified.orderLookup.providerOrderId,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(this.schema.paymentOrders.id, order.id));
      }

      if (verified.transaction) {
        const occurredAt = parseTimestamp(verified.transaction.occurredAt);
        await this.db
          .insert(this.schema.paymentTransactions)
          .values({
            payment_order_id: order.id,
            provider: input.provider,
            provider_transaction_id: verified.transaction.providerTransactionId,
            transaction_type: verified.transaction.transactionType,
            amount_minor: verified.transaction.amountMinor,
            currency: verified.transaction.currency,
            fee_minor: verified.transaction.feeMinor,
            status: verified.transaction.status,
            occurred_at: occurredAt ?? sql`CURRENT_TIMESTAMP`,
            metadata: verified.transaction.metadata ? safeJsonStringify(verified.transaction.metadata) : null,
          })
          .onConflictDoNothing({
            target: [
              this.schema.paymentTransactions.provider,
              this.schema.paymentTransactions.provider_transaction_id,
            ],
          });

        await logEvent({
          eventType: 'payment.transaction.recorded',
          relatedId: order.id,
          meta: {
            provider: input.provider,
            providerTransactionId: verified.transaction.providerTransactionId,
            transactionType: verified.transaction.transactionType,
            amountMinor: verified.transaction.amountMinor,
          },
        });
      }

      let transitionedToSucceeded = false;
      let transitionedToRefunded = false;
      let transitionedToFailed = false;
      if (verified.nextStatus) {
        const transitioned = await this.transitionOrderStatus(
          order.id,
          verified.nextStatus,
          `webhook:${input.provider}:${verified.eventType}`
        );
        transitionedToSucceeded = transitioned && verified.nextStatus === 'succeeded';
        transitionedToRefunded = transitioned && (verified.nextStatus === 'refunded' || verified.nextStatus === 'partially_refunded');
        transitionedToFailed = transitioned && verified.nextStatus === 'failed';
      }

      await this.db
        .update(this.schema.paymentEvents)
        .set({
          processing_status: 'processed',
          processing_error: null,
          processed_at: sql`CURRENT_TIMESTAMP`,
          payment_order_id: order.id,
        })
        .where(eq(this.schema.paymentEvents.id, eventId!));

      if (transitionedToSucceeded) {
        await this.runSucceededOrderSideEffects(order.id);
      } else if (verified.nextStatus === 'succeeded') {
        await this.runSucceededOrderSideEffects(order.id);
      }

      if (transitionedToFailed) {
        await this.markCurlingRegistrationFailedForOrder(order.id);
      }

      if (transitionedToRefunded) {
        await this.runRefundedOrderSideEffects(order.id);
      }

      await logEvent({
        eventType: 'payment.webhook.processed',
        relatedId: order.id,
        meta: {
          provider: input.provider,
          providerEventId: verified.providerEventId,
          eventType: verified.eventType,
          nextStatus: verified.nextStatus,
        },
      });

      return {
        eventId,
        paymentOrderId: order.id,
        deduplicated: false,
        status: 'processed',
      };
    } catch (error) {
      await this.db
        .update(this.schema.paymentEvents)
        .set({
          processing_status: 'failed',
          processing_error: error instanceof Error ? error.message : 'Unknown webhook processing error',
          processed_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(this.schema.paymentEvents.id, eventId!));

      await logEvent({
        eventType: 'payment.webhook.failed',
        relatedId: order.id,
        meta: {
          provider: input.provider,
          providerEventId: verified.providerEventId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  private async runSucceededOrderSideEffects(orderId: number): Promise<void> {
    await this.sendDonationReceiptForSucceededOrder(orderId);
    await this.confirmEventRegistrationForSucceededOrder(orderId);
    await this.confirmCurlingRegistrationForSucceededOrder(orderId);
    dispatchWebhookEvent('payment.received', { orderId }).catch(() => {});
    const [orderSubject] = await this.db
      .select({ subjectType: this.schema.paymentOrders.subject_type })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);
    if (orderSubject?.subjectType === 'event_registration') {
      dispatchWebhookEvent('event_registration.received', { orderId }).catch(() => {});
    }
  }

  private async runRefundedOrderSideEffects(orderId: number): Promise<void> {
    await this.cancelEventRegistrationForRefundedOrder(orderId);
    dispatchWebhookEvent('payment.refunded', { orderId }).catch(() => {});
  }

  private async sendDonationReceiptForSucceededOrder(orderId: number): Promise<void> {
    try {
      const [order] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          order_token: this.schema.paymentOrders.order_token,
          subject_type: this.schema.paymentOrders.subject_type,
          amount_minor: this.schema.paymentOrders.amount_minor,
          currency: this.schema.paymentOrders.currency,
          status: this.schema.paymentOrders.status,
          metadata: this.schema.paymentOrders.metadata,
          completed_at: this.schema.paymentOrders.completed_at,
          updated_at: this.schema.paymentOrders.updated_at,
        })
        .from(this.schema.paymentOrders)
        .where(eq(this.schema.paymentOrders.id, orderId))
        .limit(1);

      if (!order || order.subject_type !== 'donation' || order.status !== 'succeeded') {
        return;
      }

      const metadata = safeJsonParseObject(order.metadata);
      if (asString(metadata.donationReceiptSentAt ?? metadata.donation_receipt_sent_at)) {
        return;
      }

      const donorEmail = asString(metadata.donorEmail ?? metadata.donor_email);
      if (!donorEmail) {
        await logEvent({
          eventType: 'payment.donation_receipt.skipped',
          relatedId: orderId,
          meta: {
            reason: 'missing_donor_email',
          },
        });
        return;
      }

      const donorName = asString(metadata.donorName ?? metadata.donor_name) ?? 'Donor';
      const receivedAt = parseDateValue(order.completed_at) ?? parseDateValue(order.updated_at) ?? new Date();
      const treasurerName = (await this.getCurrentTreasurerName()) ?? 'Treasurer';

      await sendDonationReceiptEmail({
        to: donorEmail,
        donorName,
        amountMinor: order.amount_minor,
        currency: order.currency,
        receivedAt,
        treasurerName,
        paymentDetailsUrl: paymentDetailsUrl(order.order_token),
      });

      metadata.donationReceiptSentAt = new Date().toISOString();
      await this.db
        .update(this.schema.paymentOrders)
        .set({
          metadata: safeJsonStringify(metadata),
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(this.schema.paymentOrders.id, orderId));

      await logEvent({
        eventType: 'payment.donation_receipt.sent',
        relatedId: orderId,
        meta: {
          donorEmail,
          donorName,
          treasurerName,
        },
      });
    } catch (error) {
      await logEvent({
        eventType: 'payment.donation_receipt.failed',
        relatedId: orderId,
        meta: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private async claimEventPaymentConfirmationEmail(orderId: number): Promise<boolean> {
    const sentAt = new Date().toISOString();
    const isPostgres = getDatabaseConfig()?.type === 'postgres';
    const metadataColumn = this.schema.paymentOrders.metadata;

    const notSentCondition = isPostgres
      ? sql`COALESCE(${metadataColumn}::jsonb->>'eventPaymentConfirmationSentAt', '') = '' AND COALESCE(${metadataColumn}::jsonb->>'event_payment_confirmation_sent_at', '') = ''`
      : sql`COALESCE(json_extract(COALESCE(${metadataColumn}, '{}'), '$.eventPaymentConfirmationSentAt'), '') = '' AND COALESCE(json_extract(COALESCE(${metadataColumn}, '{}'), '$.event_payment_confirmation_sent_at'), '') = ''`;

    const claimed = await this.db
      .update(this.schema.paymentOrders)
      .set({
        metadata: isPostgres
          ? sql`(COALESCE(${metadataColumn}::jsonb, '{}'::jsonb) || jsonb_build_object('eventPaymentConfirmationSentAt', cast(${sentAt} as text)))::text`
          : sql`json_set(COALESCE(${metadataColumn}, '{}'), '$.eventPaymentConfirmationSentAt', ${sentAt})`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(this.schema.paymentOrders.id, orderId),
          eq(this.schema.paymentOrders.status, 'succeeded'),
          eq(this.schema.paymentOrders.subject_type, 'event_registration'),
          notSentCondition,
        ),
      )
      .returning({ id: this.schema.paymentOrders.id });

    return claimed.length > 0;
  }

  private async clearEventPaymentConfirmationEmailClaim(orderId: number): Promise<void> {
    const isPostgres = getDatabaseConfig()?.type === 'postgres';
    const metadataColumn = this.schema.paymentOrders.metadata;

    await this.db
      .update(this.schema.paymentOrders)
      .set({
        metadata: isPostgres
          ? sql`(COALESCE(${metadataColumn}::jsonb, '{}'::jsonb) - 'eventPaymentConfirmationSentAt')::text`
          : sql`json_remove(COALESCE(${metadataColumn}, '{}'), '$.eventPaymentConfirmationSentAt')`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(this.schema.paymentOrders.id, orderId));
  }

  private async confirmEventRegistrationForSucceededOrder(orderId: number): Promise<void> {
    try {
      const [order] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          subject_type: this.schema.paymentOrders.subject_type,
          subject_id: this.schema.paymentOrders.subject_id,
          status: this.schema.paymentOrders.status,
        })
        .from(this.schema.paymentOrders)
        .where(eq(this.schema.paymentOrders.id, orderId))
        .limit(1);

      if (!order || order.subject_type !== 'event_registration' || order.status !== 'succeeded' || !order.subject_id) {
        return;
      }

      const { confirmRegistrationPayment } = await import('./eventService.js');
      await confirmRegistrationPayment(order.subject_id, order.id);

      await logEvent({
        eventType: 'event.registration.payment_confirmed',
        relatedId: order.subject_id,
        meta: { paymentOrderId: orderId },
      });
    } catch (error) {
      await logEvent({
        eventType: 'event.registration.payment_confirmation_failed',
        relatedId: orderId,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private async claimEventPointOfContactNotification(orderId: number): Promise<boolean> {
    const sentAt = new Date().toISOString();
    const isPostgres = getDatabaseConfig()?.type === 'postgres';
    const metadataColumn = this.schema.paymentOrders.metadata;

    const notSentCondition = isPostgres
      ? sql`COALESCE(${metadataColumn}::jsonb->>'eventPointOfContactNotificationSentAt', '') = '' AND COALESCE(${metadataColumn}::jsonb->>'event_point_of_contact_notification_sent_at', '') = ''`
      : sql`COALESCE(json_extract(COALESCE(${metadataColumn}, '{}'), '$.eventPointOfContactNotificationSentAt'), '') = '' AND COALESCE(json_extract(COALESCE(${metadataColumn}, '{}'), '$.event_point_of_contact_notification_sent_at'), '') = ''`;

    const claimed = await this.db
      .update(this.schema.paymentOrders)
      .set({
        metadata: isPostgres
          ? sql`(COALESCE(${metadataColumn}::jsonb, '{}'::jsonb) || jsonb_build_object('eventPointOfContactNotificationSentAt', cast(${sentAt} as text)))::text`
          : sql`json_set(COALESCE(${metadataColumn}, '{}'), '$.eventPointOfContactNotificationSentAt', ${sentAt})`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(this.schema.paymentOrders.id, orderId),
          eq(this.schema.paymentOrders.status, 'succeeded'),
          eq(this.schema.paymentOrders.subject_type, 'event_registration'),
          notSentCondition,
        ),
      )
      .returning({ id: this.schema.paymentOrders.id });

    return claimed.length > 0;
  }

  private async notifyPointOfContactForPaidEventRegistration(
    orderId: number,
    registrationId: number,
    event: { id: number; title: string; point_of_contact: string; registrationFields?: unknown[] },
    status: string,
  ): Promise<void> {
    let claimed = false;
    try {
      claimed = await this.claimEventPointOfContactNotification(orderId);
    } catch (error) {
      console.error('[Payment Service] Failed to claim event point of contact notification:', error);
      return;
    }

    if (!claimed) {
      return;
    }

    try {
      const { notifyPointOfContactOfNewRegistration } = await import('./eventRegistrationPointOfContactNotification.js');
      await notifyPointOfContactOfNewRegistration({
        event,
        registrationId,
        status,
      });
    } catch (error) {
      console.error('[Payment Service] Failed to notify event point of contact:', error);
    }
  }

  async sendEventRegistrationCompletionEmailsForOrder(orderId: number): Promise<void> {
    const [order] = await this.db
      .select({
        id: this.schema.paymentOrders.id,
        order_token: this.schema.paymentOrders.order_token,
        subject_type: this.schema.paymentOrders.subject_type,
        subject_id: this.schema.paymentOrders.subject_id,
        status: this.schema.paymentOrders.status,
      })
      .from(this.schema.paymentOrders)
      .where(eq(this.schema.paymentOrders.id, orderId))
      .limit(1);

    if (!order || order.subject_type !== 'event_registration' || order.status !== 'succeeded' || !order.subject_id) {
      return;
    }

    const [registration] = await this.db
      .select({
        contactName: this.schema.eventRegistrations.contact_name,
        contactEmail: this.schema.eventRegistrations.contact_email,
        groupSize: this.schema.eventRegistrations.group_size,
        eventId: this.schema.eventRegistrations.event_id,
        accessToken: this.schema.eventRegistrations.access_token,
        status: this.schema.eventRegistrations.status,
      })
      .from(this.schema.eventRegistrations)
      .where(eq(this.schema.eventRegistrations.id, order.subject_id))
      .limit(1);

    if (!registration?.contactEmail) {
      return;
    }

    const { getEventById } = await import('./eventService.js');
    const event = await getEventById(registration.eventId);
    if (!event) {
      return;
    }

    let emailClaimed = false;
    try {
      emailClaimed = await this.claimEventPaymentConfirmationEmail(orderId);
      if (emailClaimed) {
        const eventWhen = formatEventTimespansForDisplay(event.timespans);

        const { ensureRegistrationAccessToken } = await import('./eventService.js');
        const { eventRegistrationManageUrl } = await import('../utils/eventRegistrationManageUrl.js');
        const accessToken = registration.accessToken
          ?? await ensureRegistrationAccessToken(order.subject_id);

        await sendEventRegistrationPaymentConfirmationEmail(
          registration.contactEmail,
          registration.contactName,
          event.title,
          eventWhen,
          registration.groupSize ?? 1,
          paymentDetailsUrl(order.order_token),
          undefined,
          {
            manageRegistrationUrl: eventRegistrationManageUrl(accessToken),
            receiptUrl: paymentDetailsUrl(order.order_token),
            pointOfContact: event.point_of_contact,
          },
        );

        await logEvent({
          eventType: 'event.registration.payment_confirmation_email.sent',
          relatedId: orderId,
          meta: { registrationId: order.subject_id },
        });
      }
    } catch (error) {
      if (emailClaimed) {
        await this.clearEventPaymentConfirmationEmailClaim(orderId).catch(() => {});
      }
      await logEvent({
        eventType: 'event.registration.payment_confirmation_email_failed',
        relatedId: orderId,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }

    const [latestRegistration] = await this.db
      .select({ status: this.schema.eventRegistrations.status })
      .from(this.schema.eventRegistrations)
      .where(eq(this.schema.eventRegistrations.id, order.subject_id))
      .limit(1);

    await this.notifyPointOfContactForPaidEventRegistration(
      orderId,
      order.subject_id,
      event,
      latestRegistration?.status ?? registration.status,
    );
  }

  private async confirmCurlingRegistrationForSucceededOrder(orderId: number): Promise<void> {
    try {
      const { confirmCurlingRegistrationForPaymentOrder } = await import('../registration/registrationMembershipPaymentService.js');
      await confirmCurlingRegistrationForPaymentOrder(orderId);

      await logEvent({
        eventType: 'curling.registration.payment_confirmed',
        relatedId: orderId,
        meta: { paymentOrderId: orderId },
      });
    } catch (error) {
      await logEvent({
        eventType: 'curling.registration.payment_confirmation_failed',
        relatedId: orderId,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private async markCurlingRegistrationFailedForOrder(orderId: number): Promise<void> {
    try {
      const { markCurlingRegistrationPaymentFailedForOrder } = await import('../registration/registrationMembershipPaymentService.js');
      await markCurlingRegistrationPaymentFailedForOrder(orderId);

      await logEvent({
        eventType: 'curling.registration.payment_failed',
        relatedId: orderId,
        meta: { paymentOrderId: orderId },
      });
    } catch (error) {
      await logEvent({
        eventType: 'curling.registration.payment_failure_mark_failed',
        relatedId: orderId,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private async cancelEventRegistrationForRefundedOrder(orderId: number): Promise<void> {
    try {
      const [order] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          subject_type: this.schema.paymentOrders.subject_type,
          subject_id: this.schema.paymentOrders.subject_id,
        })
        .from(this.schema.paymentOrders)
        .where(eq(this.schema.paymentOrders.id, orderId))
        .limit(1);

      if (!order || order.subject_type !== 'event_registration' || !order.subject_id) {
        return;
      }

      const [reg] = await this.db
        .select({ status: this.schema.eventRegistrations.status })
        .from(this.schema.eventRegistrations)
        .where(eq(this.schema.eventRegistrations.id, order.subject_id))
        .limit(1);

      if (!reg || reg.status === 'cancelled') {
        return;
      }

      const { cancelRegistration } = await import('./eventService.js');
      await cancelRegistration(order.subject_id);

      await logEvent({
        eventType: 'event.registration.cancelled_by_refund',
        relatedId: order.subject_id,
        meta: { paymentOrderId: orderId },
      });
    } catch (error) {
      await logEvent({
        eventType: 'event.registration.refund_cancellation_failed',
        relatedId: orderId,
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private async getCurrentTreasurerName(): Promise<string | null> {
    const [treasurer] = await this.db
      .select({
        memberName: this.schema.members.name,
      })
      .from(this.schema.governanceOfficers)
      .innerJoin(
        this.schema.governanceBoardMembers,
        eq(this.schema.governanceOfficers.board_member_id, this.schema.governanceBoardMembers.id)
      )
      .innerJoin(this.schema.members, eq(this.schema.governanceBoardMembers.member_id, this.schema.members.id))
      .where(eq(this.schema.governanceOfficers.position, 'treasurer'))
      .limit(1);

    return asString(treasurer?.memberName);
  }

  private async findOrderForWebhook(
    provider: PaymentProvider,
    lookup: { orderId: number | null; orderToken: string | null; providerOrderId: string | null; providerTransactionId: string | null }
  ): Promise<{ id: number; provider_order_id: string | null } | null> {
    if (lookup.orderId) {
      const [orderById] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          provider_order_id: this.schema.paymentOrders.provider_order_id,
        })
        .from(this.schema.paymentOrders)
        .where(eq(this.schema.paymentOrders.id, lookup.orderId))
        .limit(1);
      if (orderById) return orderById;
    }

    if (lookup.orderToken) {
      const [orderByToken] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          provider_order_id: this.schema.paymentOrders.provider_order_id,
        })
        .from(this.schema.paymentOrders)
        .where(eq(this.schema.paymentOrders.order_token, lookup.orderToken))
        .limit(1);
      if (orderByToken) return orderByToken;
    }

    if (lookup.providerOrderId) {
      const [orderByProvider] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          provider_order_id: this.schema.paymentOrders.provider_order_id,
        })
        .from(this.schema.paymentOrders)
        .where(
          and(
            eq(this.schema.paymentOrders.provider, provider),
            eq(this.schema.paymentOrders.provider_order_id, lookup.providerOrderId)
          )
        )
        .limit(1);
      if (orderByProvider) return orderByProvider;
    }

    if (lookup.providerTransactionId) {
      const [orderByTransaction] = await this.db
        .select({
          id: this.schema.paymentOrders.id,
          provider_order_id: this.schema.paymentOrders.provider_order_id,
        })
        .from(this.schema.paymentOrders)
        .innerJoin(
          this.schema.paymentTransactions,
          eq(this.schema.paymentTransactions.payment_order_id, this.schema.paymentOrders.id)
        )
        .where(
          and(
            eq(this.schema.paymentTransactions.provider, provider),
            eq(this.schema.paymentTransactions.provider_transaction_id, lookup.providerTransactionId)
          )
        )
        .limit(1);
      if (orderByTransaction) return orderByTransaction;
    }

    return null;
  }
}

function normalizeProvider(value: string): PaymentProvider | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stripe' || normalized === 'paypal' || normalized === 'square') {
    return normalized;
  }
  return null;
}

export function getEnabledPaymentProviders(): PaymentProvider[] {
  const providers = config.payment.enabledProviders
    .map(normalizeProvider)
    .filter((provider): provider is PaymentProvider => provider !== null);
  return providers.length > 0 ? providers : ['stripe'];
}

export function getDefaultPaymentProvider(): PaymentProvider {
  const enabled = getEnabledPaymentProviders();
  const configuredDefault = normalizeProvider(config.payment.defaultProvider) ?? 'stripe';
  if (enabled.includes(configuredDefault)) {
    return configuredDefault;
  }
  return enabled[0] ?? 'stripe';
}

export function buildCheckoutSuccessUrl(baseSuccessUrl: string, provider: PaymentProvider = getDefaultPaymentProvider()): string {
  if (provider !== 'stripe') {
    return baseSuccessUrl;
  }
  const separator = baseSuccessUrl.includes('?') ? '&' : '?';
  return `${baseSuccessUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;
}

function buildDefaultAdapters(): Record<PaymentProvider, PaymentProviderAdapter> {
  const adapters: Partial<Record<PaymentProvider, PaymentProviderAdapter>> = {};
  adapters.stripe = new StripePaymentProviderAdapter(
    config.payment.providers.stripe.apiKey,
    config.payment.providers.stripe.webhookSecret
  );
  const configuredProviders = getEnabledPaymentProviders();

  for (const provider of configuredProviders) {
    if (provider === 'stripe') continue;
    if (provider === 'square') {
      adapters.square = new SquarePaymentProviderAdapter(
        config.payment.providers.square.accessToken,
        config.payment.providers.square.webhookSecret,
        config.payment.providers.square.locationId
      );
      continue;
    }
    adapters[provider] = new HmacPaymentProviderAdapter(provider, config.payment.providers[provider].webhookSecret);
  }

  return {
    stripe: adapters.stripe ?? new StripePaymentProviderAdapter('', null),
    paypal: adapters.paypal ?? new HmacPaymentProviderAdapter('paypal', null),
    square:
      adapters.square
      ?? (configuredProviders.includes('square')
        ? new SquarePaymentProviderAdapter(
            config.payment.providers.square.accessToken,
            config.payment.providers.square.webhookSecret,
            config.payment.providers.square.locationId
          )
        : new HmacPaymentProviderAdapter('square', null)),
  };
}

export function normalizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value[0];
    } else {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

export function createPaymentService(): PaymentService {
  const { db, schema } = getDrizzleDb();
  return new PaymentService(db, schema, buildDefaultAdapters(), getDefaultPaymentProvider());
}

export async function sendEventRegistrationCompletionEmailsForOrder(orderId: number): Promise<void> {
  await createPaymentService().sendEventRegistrationCompletionEmailsForOrder(orderId);
}
