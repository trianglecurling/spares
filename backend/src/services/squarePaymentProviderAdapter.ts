import crypto from 'crypto';
import { SquareClient, SquareEnvironment, SquareError, WebhooksHelper } from 'square';
import type { Currency } from 'square';
import { config } from '../config.js';
import type {
  CheckoutLineItem,
  CompletePaidProviderOrderInput,
  CompletePaidProviderOrderResult,
  CreateCheckoutInput,
  CreateRefundInput,
  ExpireHostedCheckoutResult,
  HostedCheckoutSession,
  PaymentOrderStatus,
  PaymentProviderAdapter,
  ProviderRefundResult,
  RefundStatus,
  VerifiedWebhookEvent,
  VerifyWebhookInput,
} from './paymentService.js';
import { PaymentServiceError, PaymentSignatureError, toProviderCheckoutLineItem, truncateCheckoutText } from './paymentService.js';
import {
  buildSquareRefundReason,
  checkoutLineItemsToRefundItems,
  extractSquareOrderRefundLineItems,
} from './squareRefundReason.js';

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
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function moneyAmountMinor(value: unknown): number {
  if (isRecord(value)) {
    return asNumber(value.amount) ?? 0;
  }
  return 0;
}

function moneyCurrency(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const currency = asString(value.currency);
    if (currency) return currency.toLowerCase();
  }
  return fallback.toLowerCase();
}

function mapSquarePaymentStatus(status: string | null): PaymentOrderStatus | null {
  if (!status) return null;
  const normalized = status.trim().toUpperCase();
  if (normalized === 'COMPLETED') return 'succeeded';
  if (normalized === 'CANCELED' || normalized === 'CANCELLED' || normalized === 'FAILED') return 'failed';
  if (normalized === 'APPROVED' || normalized === 'PENDING') return 'pending';
  return null;
}

function mapSquareOrderState(state: string | null): PaymentOrderStatus | null {
  if (!state) return null;
  const normalized = state.trim().toUpperCase();
  if (normalized === 'COMPLETED') return 'succeeded';
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'failed';
  if (normalized === 'DRAFT') return 'pending';
  return null;
}

function resolveSquareOrderPaymentStatusFromRecord(order: unknown): PaymentOrderStatus | null {
  if (!isRecord(order)) return null;

  const mappedState = mapSquareOrderState(asString(order.state));
  if (mappedState === 'succeeded' || mappedState === 'failed') {
    return mappedState;
  }

  const netAmountDue = moneyAmountMinor(order.netAmountDueMoney ?? order.net_amount_due_money);
  const tenders = Array.isArray(order.tenders) ? order.tenders : [];
  if (netAmountDue === 0 && tenders.length > 0) {
    return 'succeeded';
  }

  if (mappedState === 'pending') {
    return 'pending';
  }

  return null;
}

const TERMINAL_SQUARE_ORDER_STATES = new Set(['COMPLETED', 'CANCELED', 'CANCELLED']);
const TERMINAL_SQUARE_FULFILLMENT_STATES = new Set(['COMPLETED', 'CANCELED', 'CANCELLED', 'FAILED']);

export function isSquareOrderFullyPaid(order: unknown): boolean {
  if (!isRecord(order)) return false;
  const netAmountDue = moneyAmountMinor(order.netAmountDueMoney ?? order.net_amount_due_money);
  const tenders = Array.isArray(order.tenders) ? order.tenders : [];
  return netAmountDue === 0 && tenders.length > 0;
}

export type SquareOrderCompletionPlan =
  | { action: 'already_completed'; orderId: string | null }
  | { action: 'skip'; reason: string; orderId: string | null }
  | {
      action: 'complete';
      orderId: string;
      version: number;
      locationId: string | null;
      fulfillments: Array<{ uid: string; state: 'COMPLETED' }>;
    };

export function planSquareOrderCompletion(order: unknown): SquareOrderCompletionPlan {
  if (!isRecord(order)) {
    return { action: 'skip', reason: 'missing_order', orderId: null };
  }

  const orderId = asString(order.id);
  const state = (asString(order.state) ?? '').toUpperCase();
  if (state === 'COMPLETED') {
    return { action: 'already_completed', orderId };
  }
  if (TERMINAL_SQUARE_ORDER_STATES.has(state)) {
    return { action: 'skip', reason: 'canceled', orderId };
  }
  if (!isSquareOrderFullyPaid(order)) {
    return { action: 'skip', reason: 'not_fully_paid', orderId };
  }

  const version = asNumber(order.version);
  if (version == null) {
    return { action: 'skip', reason: 'missing_version', orderId };
  }
  if (!orderId) {
    return { action: 'skip', reason: 'missing_order_id', orderId: null };
  }

  const fulfillments: Array<{ uid: string; state: 'COMPLETED' }> = [];
  const rawFulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  for (const fulfillment of rawFulfillments) {
    if (!isRecord(fulfillment)) continue;
    const uid = asString(fulfillment.uid);
    if (!uid) continue;
    const fulfillmentState = (asString(fulfillment.state) ?? '').toUpperCase();
    if (!TERMINAL_SQUARE_FULFILLMENT_STATES.has(fulfillmentState)) {
      fulfillments.push({ uid, state: 'COMPLETED' });
    }
  }

  return {
    action: 'complete',
    orderId,
    version,
    locationId: asString(order.locationId ?? order.location_id),
    fulfillments,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordField(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return null;
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function recordString(record: Record<string, unknown> | null, keys: string[]): string | null {
  return asString(recordField(record, keys));
}

function metadataString(value: unknown): string | null {
  const note = asString(value);
  if (!note) return null;
  try {
    const parsed = JSON.parse(note);
    if (!isRecord(parsed)) return null;
    return asString(parsed.orderId ?? parsed.paymentOrderId ?? parsed.order_id);
  } catch {
    return null;
  }
}

export function isSquareVersionMismatch(error: unknown): boolean {
  if (error instanceof SquareError) {
    return (error.errors ?? []).some((bodyError) => {
      const code = (bodyError.code ?? '').toUpperCase();
      return code === 'VERSION_MISMATCH' || code === 'CONFLICT';
    });
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toUpperCase();
  return message.includes('VERSION_MISMATCH') || (error instanceof PaymentServiceError && error.statusCode === 409 && message.includes('CONFLICT'));
}

export function extractSquareWebhookOrderLookup(payload: unknown): {
  orderId: number | null;
  orderToken: string | null;
  providerOrderId: string | null;
  providerTransactionId: string | null;
} {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const object = isRecord(data.object) ? data.object : {};
  const payment = isRecord(object.payment) ? object.payment : null;
  const refund = isRecord(object.refund) ? object.refund : null;
  const order = isRecord(object.order) ? object.order : null;
  const orderUpdated = isRecord(object.order_updated)
    ? object.order_updated
    : isRecord(object.orderUpdated)
      ? object.orderUpdated
      : null;
  const eventType = (asString(root.type) ?? '').toLowerCase();
  const isRefundEvent = eventType.includes('refund');

  const orderToken =
    recordString(payment, ['reference_id', 'referenceId'])
    ?? recordString(order, ['reference_id', 'referenceId'])
    ?? recordString(object, ['reference_id', 'referenceId']);
  const orderId =
    asNumber(metadataString(recordString(payment, ['note'])))
    ?? asNumber(metadataString(recordString(order, ['note'])));
  const providerOrderId =
    recordString(payment, ['order_id', 'orderId'])
    ?? recordString(order, ['id'])
    ?? recordString(orderUpdated, ['order_id', 'orderId'])
    ?? recordString(refund, ['order_id', 'orderId']);
  const providerTransactionId = isRefundEvent
    ? (recordString(refund, ['id']) ?? recordString(refund, ['payment_id', 'paymentId']))
    : recordString(payment, ['id']);

  return {
    orderId,
    orderToken,
    providerOrderId,
    providerTransactionId,
  };
}

async function resolveSquareOrderPaymentStatus(
  client: SquareClient,
  order: unknown
): Promise<PaymentOrderStatus> {
  const resolved = resolveSquareOrderPaymentStatusFromRecord(order);
  if (resolved === 'succeeded' || resolved === 'failed') {
    return resolved;
  }

  if (!isRecord(order) || !Array.isArray(order.tenders)) {
    return 'pending';
  }

  for (const tender of order.tenders) {
    if (!isRecord(tender)) continue;
    const paymentId = asString(tender.paymentId ?? tender.payment_id ?? tender.id);
    if (!paymentId) continue;
    try {
      const paymentResponse = await client.payments.get({ paymentId });
      const paymentStatus = mapSquarePaymentStatus(asString(paymentResponse.payment?.status));
      if (paymentStatus === 'succeeded' || paymentStatus === 'failed') {
        return paymentStatus;
      }
    } catch {
      // Fall through to pending when Square has not materialized the payment yet.
    }
  }

  return resolved ?? 'pending';
}

function mapSquareRefundStatus(status: string | null): RefundStatus {
  if (!status) return 'processing';
  const normalized = status.trim().toUpperCase();
  if (normalized === 'COMPLETED') return 'succeeded';
  if (normalized === 'FAILED') return 'failed';
  if (normalized === 'REJECTED') return 'rejected';
  if (normalized === 'PENDING') return 'processing';
  return 'processing';
}

function squareCurrency(currency: string): Currency {
  return currency.trim().toUpperCase() as Currency;
}

function checkoutLineItemsTotalMinor(lineItems: CheckoutLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
}

export function buildSquareOrderDetails(input: CreateCheckoutInput): {
  lineItems: Array<{
    name: string;
    quantity: string;
    basePriceMoney: {
      amount: bigint;
      currency: Currency;
    };
  }>;
  discounts?: Array<{
    uid: string;
    name: string;
    scope: 'ORDER';
    type: 'FIXED_AMOUNT';
    amountMoney: {
      amount: bigint;
      currency: Currency;
    };
  }>;
} {
  const currency = squareCurrency(input.currency);
  const fallbackName = input.description?.trim() || 'Triangle Curling Club payment';
  const lineItems = input.lineItems?.filter((item) => item.amountMinor !== 0) ?? [];
  const totalFromLineItems = checkoutLineItemsTotalMinor(lineItems);

  if (lineItems.length === 0 || totalFromLineItems !== input.amountMinor) {
    return {
      lineItems: [
        {
          name: fallbackName,
          quantity: '1',
          basePriceMoney: {
            amount: BigInt(input.amountMinor),
            currency,
          },
        },
      ],
    };
  }

  const positiveItems = lineItems.filter((item) => item.amountMinor > 0);
  const discountItems = lineItems.filter((item) => item.amountMinor < 0);

  return {
    lineItems: positiveItems.map((item) => {
      const priced = toProviderCheckoutLineItem(item);
      return {
        name: truncateCheckoutText(priced.description, 512),
        quantity: String(priced.quantity),
        basePriceMoney: {
          amount: BigInt(priced.unitAmountMinor),
          currency,
        },
      };
    }),
    discounts:
      discountItems.length > 0
        ? discountItems.map((item, index) => ({
            uid: `discount-${index}`,
            name: truncateCheckoutText(item.description, 255),
            scope: 'ORDER' as const,
            type: 'FIXED_AMOUNT' as const,
            amountMoney: {
              amount: BigInt(Math.abs(item.amountMinor)),
              currency,
            },
          }))
        : undefined,
  };
}

function squareWebhookNotificationUrl(): string {
  const configured = config.payment.webhookBaseUrl.trim().replace(/\/+$/, '');
  if (!configured) {
    throw new PaymentSignatureError('Square webhook notification URL is not configured. Set PAYMENT_WEBHOOK_BASE_URL.');
  }
  return `${configured}/api/payments/webhooks/square`;
}

/**
 * Convert a Square SDK API error into a PaymentServiceError (502) whose message carries
 * Square's own error details (category/code/detail), so callers and the frontend can see
 * exactly why Square rejected the request instead of a bare provider status code.
 */
function toPaymentServiceError(error: unknown): PaymentServiceError | null {
  if (!(error instanceof SquareError)) return null;

  const details = (error.errors ?? [])
    .map((bodyError) => {
      const parts = [bodyError.category, bodyError.code, bodyError.detail].filter(
        (part): part is string => typeof part === 'string' && part.trim().length > 0
      );
      return parts.join(' ');
    })
    .filter((detail) => detail.length > 0);

  const summary = details.length > 0 ? details.join('; ') : error.message;
  const status = error.statusCode != null ? ` (HTTP ${error.statusCode})` : '';
  return new PaymentServiceError(`Square error${status}: ${summary}`, 502);
}

async function callSquare<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const mapped = toPaymentServiceError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

function resolveSquareEnvironment(): string {
  const normalized = config.payment.providers.square.environment.trim().toLowerCase();
  return normalized === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
}

export class SquarePaymentProviderAdapter implements PaymentProviderAdapter {
  readonly provider = 'square' as const;
  private readonly client: SquareClient | null;
  private readonly webhookSecret: string | null;
  private readonly locationId: string | null;

  constructor(
    accessToken: string | null,
    webhookSecret: string | null,
    locationId: string | null
  ) {
    const normalizedToken = accessToken?.trim() ?? '';
    this.client =
      normalizedToken.length > 0
        ? new SquareClient({
            token: normalizedToken,
            environment: resolveSquareEnvironment(),
          })
        : null;
    this.webhookSecret = webhookSecret?.trim() ? webhookSecret.trim() : null;
    this.locationId = locationId?.trim() ? locationId.trim() : null;
  }

  private requireClient(): SquareClient {
    if (!this.client) {
      throw new PaymentServiceError('Square is not configured. Missing SQUARE_ACCESS_TOKEN.', 500);
    }
    return this.client;
  }

  private requireLocationId(): string {
    if (!this.locationId) {
      throw new PaymentServiceError('Square is not configured. Missing SQUARE_LOCATION_ID.', 500);
    }
    return this.locationId;
  }

  async createHostedCheckoutSession(input: CreateCheckoutInput): Promise<HostedCheckoutSession> {
    const client = this.requireClient();
    const locationId = this.requireLocationId();

    const squareOrderDetails = buildSquareOrderDetails(input);
    const response = await callSquare(() => client.checkout.paymentLinks.create({
      idempotencyKey: crypto.randomUUID(),
      description: `Payment order ${input.orderId}`,
      order: {
        locationId,
        referenceId: input.orderToken,
        lineItems: squareOrderDetails.lineItems,
        discounts: squareOrderDetails.discounts,
      },
      checkoutOptions: {
        redirectUrl: input.successUrl,
      },
      prePopulatedData: input.customerEmail ? { buyerEmail: input.customerEmail } : undefined,
    }));

    const paymentLink = response.paymentLink;
    const checkoutUrl = paymentLink?.longUrl ?? paymentLink?.url ?? null;
    if (!paymentLink?.id || !checkoutUrl) {
      const detail =
        response.errors?.map((error) => error.detail ?? error.code).filter(Boolean).join('; ')
        || 'Square payment link did not return a redirect URL';
      throw new PaymentServiceError(detail, 502);
    }

    return {
      providerOrderId: paymentLink.id,
      checkoutUrl,
      expiresAt: null,
      metadata: {
        squareOrderId: paymentLink.orderId ?? null,
      },
    };
  }

  async verifyWebhookEvent(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent> {
    if (!this.webhookSecret) {
      throw new PaymentSignatureError('Square webhook secret is not configured');
    }

    const signatureHeader =
      input.headers['x-square-hmacsha256-signature']
      ?? input.headers['x-square-signature']
      ?? null;
    if (!signatureHeader) {
      throw new PaymentSignatureError('Missing x-square-hmacsha256-signature header');
    }

    const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody;
    const notificationUrl = squareWebhookNotificationUrl();
    const isValid = await WebhooksHelper.verifySignature({
      requestBody: rawBody,
      signatureHeader,
      signatureKey: this.webhookSecret,
      notificationUrl,
    });
    if (!isValid) {
      throw new PaymentSignatureError('Invalid Square webhook signature');
    }

    const payload = isRecord(input.parsedBody)
      ? input.parsedBody
      : (() => {
          try {
            const parsed = JSON.parse(rawBody);
            return isRecord(parsed) ? parsed : {};
          } catch {
            return {};
          }
        })();

    const providerEventId = asString(payload.event_id) ?? asString(payload.eventId);
    if (!providerEventId) {
      throw new PaymentServiceError('Square webhook payload is missing event id', 400);
    }

    const eventType = asString(payload.type) ?? 'payment.event.unknown';
    const eventCreatedAt = asString(payload.created_at) ?? asString(payload.createdAt) ?? null;
    const data = isRecord(payload.data) ? payload.data : {};
    const object = isRecord(data.object) ? data.object : {};
    const payment = isRecord(object.payment) ? object.payment : null;
    const refund = isRecord(object.refund) ? object.refund : null;
    const order = isRecord(object.order) ? object.order : null;
    const lookup = extractSquareWebhookOrderLookup(payload);
    const isRefundEvent = eventType.toLowerCase().includes('refund');
    const transactionType = isRefundEvent ? 'refund' : 'charge';
    const { orderToken, orderId, providerOrderId, providerTransactionId } = lookup;
    const orderUpdated = isRecord(object.order_updated)
      ? object.order_updated
      : isRecord(object.orderUpdated)
        ? object.orderUpdated
        : null;

    const amountMinor =
      moneyAmountMinor(payment?.amount_money ?? payment?.amountMoney)
      || moneyAmountMinor(payment?.total_money ?? payment?.totalMoney)
      || moneyAmountMinor(refund?.amount_money ?? refund?.amountMoney)
      || moneyAmountMinor(order?.total_money ?? order?.totalMoney);
    const currency =
      moneyCurrency(payment?.amount_money ?? payment?.amountMoney, 'usd')
      || moneyCurrency(payment?.total_money ?? payment?.totalMoney, 'usd')
      || moneyCurrency(refund?.amount_money ?? refund?.amountMoney, 'usd')
      || moneyCurrency(order?.total_money ?? order?.totalMoney, 'usd');

    let nextStatus = mapSquarePaymentStatus(asString(payment?.status));
    if (!nextStatus && order) {
      nextStatus = resolveSquareOrderPaymentStatusFromRecord(order);
    }
    if (!nextStatus && orderUpdated) {
      nextStatus = mapSquareOrderState(recordString(orderUpdated, ['state']));
    }
    if (!nextStatus && isRefundEvent) {
      nextStatus = 'refunded';
    }

    const refundAmountMinor = moneyAmountMinor(refund?.amount_money ?? refund?.amountMoney);
    const transactionAmount = transactionType === 'refund' && refundAmountMinor > 0 ? refundAmountMinor : amountMinor;
    // Prefer created_at for charges — payment.updated_at changes again when refunds land.
    const occurredAt = isRefundEvent
      ? (recordString(refund, ['created_at', 'createdAt']) ?? recordString(refund, ['updated_at', 'updatedAt']) ?? eventCreatedAt)
      : (recordString(payment, ['created_at', 'createdAt']) ?? recordString(payment, ['updated_at', 'updatedAt']) ?? eventCreatedAt);
    const processingFee = payment?.processing_fee ?? payment?.processingFee;

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
      nextStatus,
      transaction: providerTransactionId
        ? {
            providerTransactionId,
            transactionType,
            amountMinor: transactionAmount,
            currency,
            feeMinor:
              Array.isArray(processingFee) && processingFee.length > 0
                ? moneyAmountMinor(processingFee[0])
                : null,
            status: nextStatus ?? 'pending',
            occurredAt,
            metadata: isRecord(payment?.note) ? payment.note : null,
          }
        : null,
      rawPayload: payload,
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<PaymentOrderStatus> {
    const client = this.requireClient();
    const linkResponse = await callSquare(() => client.checkout.paymentLinks.get({ id: providerOrderId }));
    const squareOrderId = linkResponse.paymentLink?.orderId;
    if (!squareOrderId) {
      return 'pending';
    }

    const orderResponse = await callSquare(() => client.orders.get({ orderId: squareOrderId }));
    return resolveSquareOrderPaymentStatus(client, orderResponse.order);
  }

  async expireHostedCheckoutSession(providerOrderId: string): Promise<ExpireHostedCheckoutResult> {
    const client = this.requireClient();
    try {
      const status = await this.fetchPaymentStatus(providerOrderId);
      if (status === 'succeeded') return 'already_paid';
      if (status === 'failed') return 'already_expired';
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/not found|NOT_FOUND/i.test(message)) return 'already_expired';
      throw error;
    }

    try {
      await callSquare(() => client.checkout.paymentLinks.delete({ id: providerOrderId }));
      return 'expired';
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/not found|NOT_FOUND|already/i.test(message)) return 'already_expired';
      throw error;
    }
  }

  async completePaidProviderOrder(input: CompletePaidProviderOrderInput): Promise<CompletePaidProviderOrderResult> {
    const client = this.requireClient();
    const squareOrderId = await this.resolveSquareOrderId(client, input);
    if (!squareOrderId) {
      return { status: 'skipped', reason: 'missing_square_order_id', providerNativeOrderId: null };
    }

    return this.completeSquareOrderById(client, squareOrderId, input.dryRun === true);
  }

  private async completeSquareOrderById(
    client: SquareClient,
    squareOrderId: string,
    dryRun: boolean,
    remainingVersionRetries = 3,
    remainingPaidRetries = 2
  ): Promise<CompletePaidProviderOrderResult> {
    const orderResponse = await callSquare(() => client.orders.get({ orderId: squareOrderId }));
    const plan = planSquareOrderCompletion(orderResponse.order);
    if (plan.action === 'already_completed') {
      return { status: 'already_completed', providerNativeOrderId: plan.orderId ?? squareOrderId };
    }
    if (plan.action === 'skip') {
      if (!dryRun && plan.reason === 'not_fully_paid' && remainingPaidRetries > 0) {
        await sleep(400);
        return this.completeSquareOrderById(
          client,
          squareOrderId,
          dryRun,
          remainingVersionRetries,
          remainingPaidRetries - 1
        );
      }
      return { status: 'skipped', reason: plan.reason, providerNativeOrderId: plan.orderId ?? squareOrderId };
    }
    if (dryRun) {
      return { status: 'completed', reason: 'dry_run', providerNativeOrderId: plan.orderId };
    }

    try {
      await callSquare(() =>
        client.orders.update({
          orderId: plan.orderId,
          idempotencyKey: `complete-paid-order:${plan.orderId}:v${plan.version}`,
          order: {
            version: plan.version,
            state: 'COMPLETED',
            locationId: plan.locationId ?? this.requireLocationId(),
            fulfillments: plan.fulfillments.length > 0 ? plan.fulfillments : undefined,
          },
        })
      );
    } catch (error) {
      if (remainingVersionRetries > 0 && isSquareVersionMismatch(error)) {
        return this.completeSquareOrderById(
          client,
          squareOrderId,
          dryRun,
          remainingVersionRetries - 1,
          remainingPaidRetries
        );
      }
      throw error;
    }

    return { status: 'completed', providerNativeOrderId: plan.orderId };
  }

  private async resolveSquareOrderId(
    client: SquareClient,
    input: CompletePaidProviderOrderInput
  ): Promise<string | null> {
    const metadata = input.metadata ?? {};
    const candidates = [
      asString(input.nativeOrderId),
      asString(metadata.squareOrderId),
      asString(metadata.square_order_id),
    ].filter((value): value is string => value != null);

    if (candidates.length > 0) {
      return candidates[0];
    }

    const providerOrderId = asString(input.providerOrderId);
    if (!providerOrderId) return null;

    try {
      const linkResponse = await client.checkout.paymentLinks.get({ id: providerOrderId });
      const fromLink = asString(linkResponse.paymentLink?.orderId);
      if (fromLink) return fromLink;
    } catch {
      // providerOrderId may already be a Square order id.
    }

    return providerOrderId;
  }

  async createRefund(input: CreateRefundInput): Promise<ProviderRefundResult> {
    try {
      const client = this.requireClient();
      const paymentId =
        input.providerPaymentId?.trim()
        || await this.resolvePaymentIdForRefund(client, input);
      const reason = await this.buildRefundReason(client, input);
      const response = await callSquare(() => client.refunds.refundPayment({
        idempotencyKey: crypto.randomUUID(),
        paymentId,
        amountMoney: {
          amount: BigInt(input.amountMinor),
          currency: squareCurrency(input.currency),
        },
        reason: reason ?? undefined,
      }));

      const refund = response.refund;
      if (!refund?.id) {
        const detail =
          response.errors?.map((error) => error.detail ?? error.code).filter(Boolean).join('; ')
          || 'Square refund request failed';
        throw new PaymentServiceError(detail, 502);
      }

      return {
        providerRefundId: refund.id,
        status: mapSquareRefundStatus(asString(refund.status)),
        rawResponse: refund,
      };
    } catch (error) {
      if (error instanceof PaymentServiceError) throw error;
      const mapped = toPaymentServiceError(error);
      if (mapped) throw mapped;
      throw new PaymentServiceError(
        error instanceof Error && error.message.trim()
          ? `Square refund failed: ${error.message}`
          : 'Square refund request failed',
        502,
      );
    }
  }

  async fetchRefundStatus(providerRefundId: string): Promise<RefundStatus | null> {
    const client = this.requireClient();
    const response = await callSquare(() => client.refunds.get({ refundId: providerRefundId }));
    return mapSquareRefundStatus(asString(response.refund?.status));
  }

  private paymentIdFromTenders(tenders: unknown[]): string | null {
    for (const tender of tenders) {
      if (!isRecord(tender)) continue;
      // Prefer payment_id only — tender.id is not a valid Refunds API paymentId.
      const paymentId = asString(tender.paymentId) ?? asString(tender.payment_id);
      if (paymentId) return paymentId;
    }
    return null;
  }

  private async loadSquareOrderRefundLineItems(
    client: SquareClient,
    input: CreateRefundInput
  ): Promise<ReturnType<typeof extractSquareOrderRefundLineItems>> {
    const squareOrderId = await this.resolveSquareOrderId(client, {
      providerOrderId: input.providerOrderId,
      metadata: input.metadata ?? null,
    });
    if (!squareOrderId) return [];
    try {
      const orderResponse = await callSquare(() => client.orders.get({ orderId: squareOrderId }));
      return extractSquareOrderRefundLineItems(orderResponse.order);
    } catch {
      return [];
    }
  }

  private async buildRefundReason(client: SquareClient, input: CreateRefundInput): Promise<string | null> {
    const squareItems = await this.loadSquareOrderRefundLineItems(client, input);
    const fallbackItems = checkoutLineItemsToRefundItems(input.lineItems);
    return buildSquareRefundReason({
      items: squareItems.length > 0 ? squareItems : fallbackItems,
      refundAmountMinor: input.amountMinor,
      orderAmountMinor: input.orderAmountMinor ?? null,
      currency: input.currency,
      staffReason: input.reason,
    });
  }

  private async resolvePaymentIdForRefund(client: SquareClient, input: CreateRefundInput): Promise<string> {
    if (!input.providerOrderId) {
      throw new PaymentServiceError('Unable to create refund: payment order has no provider checkout id', 400);
    }

    const paymentIdFromLink = await this.tryResolvePaymentIdFromPaymentLink(client, input.providerOrderId);
    if (paymentIdFromLink) return paymentIdFromLink;

    const paymentIdFromOrder = await this.tryResolvePaymentIdFromSquareOrder(client, input.providerOrderId);
    if (paymentIdFromOrder) return paymentIdFromOrder;

    throw new PaymentServiceError('Unable to create refund: no Square payment found for checkout order', 400);
  }

  private async tryResolvePaymentIdFromPaymentLink(
    client: SquareClient,
    paymentLinkId: string
  ): Promise<string | null> {
    try {
      const linkResponse = await client.checkout.paymentLinks.get({ id: paymentLinkId });
      const squareOrderId = linkResponse.paymentLink?.orderId;
      if (!squareOrderId) return null;
      const orderResponse = await client.orders.get({ orderId: squareOrderId });
      return this.paymentIdFromTenders(orderResponse.order?.tenders ?? []);
    } catch {
      return null;
    }
  }

  private async tryResolvePaymentIdFromSquareOrder(
    client: SquareClient,
    squareOrderId: string
  ): Promise<string | null> {
    try {
      const orderResponse = await client.orders.get({ orderId: squareOrderId });
      return this.paymentIdFromTenders(orderResponse.order?.tenders ?? []);
    } catch {
      return null;
    }
  }
}
