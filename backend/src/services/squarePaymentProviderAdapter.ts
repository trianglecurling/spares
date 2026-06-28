import crypto from 'crypto';
import { SquareClient, SquareEnvironment, WebhooksHelper } from 'square';
import type { Currency } from 'square';
import { config } from '../config.js';
import type {
  CheckoutLineItem,
  CreateCheckoutInput,
  CreateRefundInput,
  HostedCheckoutSession,
  PaymentOrderStatus,
  PaymentProviderAdapter,
  ProviderRefundResult,
  RefundStatus,
  VerifiedWebhookEvent,
  VerifyWebhookInput,
} from './paymentService.js';
import { PaymentServiceError, PaymentSignatureError, truncateCheckoutText } from './paymentService.js';

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

function buildSquareOrderDetails(input: CreateCheckoutInput): {
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
    lineItems: positiveItems.map((item) => ({
      name: truncateCheckoutText(item.description, 512),
      quantity: '1',
      basePriceMoney: {
        amount: BigInt(item.amountMinor),
        currency,
      },
    })),
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
    const response = await client.checkout.paymentLinks.create({
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
    });

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

    const orderToken =
      asString(payment?.reference_id)
      ?? asString(order?.reference_id)
      ?? asString(object.reference_id)
      ?? null;
    const orderId =
      asNumber(metadataString(asString(payment?.note)))
      ?? asNumber(metadataString(asString(order?.note)));
    const providerOrderId =
      asString(payment?.order_id)
      ?? asString(order?.id)
      ?? null;
    const providerTransactionId =
      asString(payment?.id)
      ?? asString(refund?.payment_id)
      ?? asString(refund?.id);

    const amountMinor =
      moneyAmountMinor(payment?.amount_money)
      || moneyAmountMinor(payment?.total_money)
      || moneyAmountMinor(refund?.amount_money)
      || moneyAmountMinor(order?.total_money);
    const currency =
      moneyCurrency(payment?.amount_money, 'usd')
      || moneyCurrency(payment?.total_money, 'usd')
      || moneyCurrency(refund?.amount_money, 'usd')
      || moneyCurrency(order?.total_money, 'usd');

    let nextStatus = mapSquarePaymentStatus(asString(payment?.status));
    if (!nextStatus && order) {
      nextStatus = resolveSquareOrderPaymentStatusFromRecord(order);
    }
    if (!nextStatus && eventType.toLowerCase().includes('refund')) {
      nextStatus = 'refunded';
    }

    const refundAmountMinor = moneyAmountMinor(refund?.amount_money);
    const transactionType = eventType.toLowerCase().includes('refund') ? 'refund' : 'charge';
    const transactionAmount = transactionType === 'refund' && refundAmountMinor > 0 ? refundAmountMinor : amountMinor;

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
              Array.isArray(payment?.processing_fee) && payment.processing_fee.length > 0
                ? moneyAmountMinor(payment.processing_fee[0])
                : null,
            status: nextStatus ?? 'pending',
            occurredAt: asString(payment?.updated_at) ?? asString(refund?.updated_at) ?? eventCreatedAt,
            metadata: isRecord(payment?.note) ? payment.note : null,
          }
        : null,
      rawPayload: payload,
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<PaymentOrderStatus> {
    const client = this.requireClient();
    const linkResponse = await client.checkout.paymentLinks.get({ id: providerOrderId });
    const squareOrderId = linkResponse.paymentLink?.orderId;
    if (!squareOrderId) {
      return 'pending';
    }

    const orderResponse = await client.orders.get({ orderId: squareOrderId });
    return resolveSquareOrderPaymentStatus(client, orderResponse.order);
  }

  async createRefund(input: CreateRefundInput): Promise<ProviderRefundResult> {
    const client = this.requireClient();
    const paymentId =
      input.providerPaymentId?.trim()
      || await this.resolvePaymentIdForRefund(client, input);
    const response = await client.refunds.refundPayment({
      idempotencyKey: crypto.randomUUID(),
      paymentId,
      amountMoney: {
        amount: BigInt(input.amountMinor),
        currency: squareCurrency(input.currency),
      },
      reason: input.reason?.trim() ? 'Requested by customer' : undefined,
    });

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
  }

  async fetchRefundStatus(providerRefundId: string): Promise<RefundStatus | null> {
    const client = this.requireClient();
    const response = await client.refunds.get({ refundId: providerRefundId });
    return mapSquareRefundStatus(asString(response.refund?.status));
  }

  private paymentIdFromTenders(tenders: unknown[]): string | null {
    for (const tender of tenders) {
      if (!isRecord(tender)) continue;
      const paymentId =
        asString(tender.paymentId)
        ?? asString(tender.payment_id)
        ?? asString(tender.id);
      if (paymentId) return paymentId;
    }
    return null;
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
