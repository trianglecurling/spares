import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export type MemberPaymentHistorySubjectType =
  | 'donation'
  | 'membership'
  | 'event_registration'
  | 'curling_registration';

export type MemberPaymentHistoryStatus =
  | 'created'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'pending_refund'
  | 'refunded'
  | 'partially_refunded';

export type MemberPaymentHistoryItem = {
  orderToken: string;
  subjectType: MemberPaymentHistorySubjectType;
  description: string;
  amountMinor: number;
  currency: string;
  status: MemberPaymentHistoryStatus;
  paidAt: string | null;
  createdAt: string;
};

export type MemberPaymentHistoryResponse = {
  total: number;
  limit: number;
  offset: number;
  payments: MemberPaymentHistoryItem[];
};

export type MemberPaymentLineItem = {
  description: string;
  amountMinor: number;
};

export type MemberPaymentRefundSummary = {
  amountMinor: number;
  currency: string;
  status: string;
  reason: string | null;
  processedAt: string | null;
  createdAt: string;
};

export type MemberPaymentContextField = {
  label: string;
  value: string;
};

export type MemberPaymentDetail = {
  orderToken: string;
  subjectType: MemberPaymentHistorySubjectType;
  description: string;
  amountMinor: number;
  currency: string;
  status: MemberPaymentHistoryStatus;
  provider: 'stripe' | 'paypal' | 'square';
  providerReference: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: MemberPaymentLineItem[];
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  refunds: MemberPaymentRefundSummary[];
  context: MemberPaymentContextField[];
};

function normalizeDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return null;
}

function tryParseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function metadataString(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function memberFacingConfirmationCode(orderToken: string): string {
  return orderToken.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function buildOwnershipConditions(
  memberId: number,
  options?: { orderId?: number; orderToken?: string }
) {
  const { db, schema } = getDrizzleDb();

  const ownership = or(
    eq(schema.paymentOrders.created_by_member_id, memberId),
    and(
      eq(schema.paymentOrders.subject_type, 'event_registration'),
      inArray(
        schema.paymentOrders.subject_id,
        db
          .select({ id: schema.eventRegistrations.id })
          .from(schema.eventRegistrations)
          .where(eq(schema.eventRegistrations.member_id, memberId))
      )
    ),
    and(
      eq(schema.paymentOrders.subject_type, 'curling_registration'),
      inArray(
        schema.paymentOrders.subject_id,
        db
          .select({ id: schema.curlingRegistrations.id })
          .from(schema.curlingRegistrations)
          .where(eq(schema.curlingRegistrations.submitted_by_member_id, memberId))
      )
    )
  );

  const filters = [ownership];
  if (options?.orderId != null) {
    filters.unshift(eq(schema.paymentOrders.id, options.orderId));
  }
  if (options?.orderToken != null) {
    filters.unshift(eq(schema.paymentOrders.order_token, options.orderToken));
  }
  return filters.length === 1 ? ownership : and(...filters);
}

async function loadEventRegistrationDescriptions(
  registrationIds: number[]
): Promise<Map<number, string>> {
  const descriptions = new Map<number, string>();
  if (registrationIds.length === 0) return descriptions;

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      registrationId: schema.eventRegistrations.id,
      eventTitle: schema.events.title,
    })
    .from(schema.eventRegistrations)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventRegistrations.event_id))
    .where(inArray(schema.eventRegistrations.id, registrationIds));

  for (const row of rows) {
    descriptions.set(row.registrationId, row.eventTitle);
  }
  return descriptions;
}

async function loadCurlingRegistrationDescriptions(
  registrationIds: number[]
): Promise<Map<number, string>> {
  const descriptions = new Map<number, string>();
  if (registrationIds.length === 0) return descriptions;

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      registrationId: schema.curlingRegistrations.id,
      seasonName: schema.curlingSeasons.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSeasons.id, schema.curlingRegistrations.season_id))
    .innerJoin(schema.curlingSessions, eq(schema.curlingSessions.id, schema.curlingRegistrations.session_id))
    .where(inArray(schema.curlingRegistrations.id, registrationIds));

  for (const row of rows) {
    const label = row.sessionName
      ? `${row.seasonName} (${row.sessionName})`
      : row.seasonName;
    descriptions.set(row.registrationId, label);
  }
  return descriptions;
}

function buildDescription(
  subjectType: MemberPaymentHistorySubjectType,
  subjectId: number | null,
  metadata: Record<string, unknown>,
  eventDescriptions: Map<number, string>,
  curlingDescriptions: Map<number, string>
): string {
  switch (subjectType) {
    case 'donation':
      return 'Donation';
    case 'membership':
      return 'Membership';
    case 'event_registration': {
      const fromMetadata = metadataString(metadata, 'eventTitle');
      if (fromMetadata) return fromMetadata;
      if (subjectId != null) {
        const fromJoin = eventDescriptions.get(subjectId);
        if (fromJoin) return fromJoin;
      }
      return 'Event registration';
    }
    case 'curling_registration': {
      if (subjectId != null) {
        const fromJoin = curlingDescriptions.get(subjectId);
        if (fromJoin) return `League registration — ${fromJoin}`;
      }
      return 'League registration';
    }
    default:
      return 'Payment';
  }
}

async function loadRegistrationInvoiceLineItems(paymentOrderId: number, metadata: Record<string, unknown>) {
  const { db, schema } = getDrizzleDb();
  const invoiceIdFromMetadata =
    typeof metadata.invoiceId === 'number'
      ? metadata.invoiceId
      : typeof metadata.invoiceId === 'string' && metadata.invoiceId.trim().length > 0
        ? Number.parseInt(metadata.invoiceId, 10)
        : null;

  const [invoice] = await db
    .select({
      id: schema.registrationInvoices.id,
      subtotalMinor: schema.registrationInvoices.subtotal_minor,
      discountMinor: schema.registrationInvoices.discount_minor,
      totalMinor: schema.registrationInvoices.total_minor,
    })
    .from(schema.registrationInvoices)
    .where(
      invoiceIdFromMetadata != null && Number.isFinite(invoiceIdFromMetadata)
        ? eq(schema.registrationInvoices.id, invoiceIdFromMetadata)
        : eq(schema.registrationInvoices.payment_order_id, paymentOrderId)
    )
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);

  if (!invoice) {
    return {
      lineItems: [] as MemberPaymentLineItem[],
      subtotalMinor: null,
      discountMinor: null,
      totalMinor: null,
    };
  }

  const lineRows = await db
    .select({
      id: schema.registrationInvoiceLineItems.id,
      description: schema.registrationInvoiceLineItems.description,
      amountMinor: schema.registrationInvoiceLineItems.amount_minor,
    })
    .from(schema.registrationInvoiceLineItems)
    .where(eq(schema.registrationInvoiceLineItems.invoice_id, invoice.id))
    .orderBy(
      asc(schema.registrationInvoiceLineItems.sort_order),
      asc(schema.registrationInvoiceLineItems.id)
    );

  return {
    lineItems: lineRows.map((line) => ({
      description: line.description,
      amountMinor: line.amountMinor,
    })),
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    totalMinor: invoice.totalMinor,
  };
}

async function buildCurlingRegistrationPaymentDetail(
  registrationId: number,
  paymentOrderId: number,
  metadata: Record<string, unknown>
): Promise<{
  lineItems: MemberPaymentLineItem[];
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  context: MemberPaymentContextField[];
}> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      seasonId: schema.curlingRegistrations.season_id,
      sessionId: schema.curlingRegistrations.session_id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      status: schema.curlingRegistrations.status,
    })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);

  const [season, session, curler, invoiceData] = await Promise.all([
    registration
      ? db
          .select({ name: schema.curlingSeasons.name })
          .from(schema.curlingSeasons)
          .where(eq(schema.curlingSeasons.id, registration.seasonId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    registration
      ? db
          .select({ name: schema.curlingSessions.name })
          .from(schema.curlingSessions)
          .where(eq(schema.curlingSessions.id, registration.sessionId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    registration?.curlerMemberId
      ? db
          .select({ name: schema.members.name })
          .from(schema.members)
          .where(eq(schema.members.id, registration.curlerMemberId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    loadRegistrationInvoiceLineItems(paymentOrderId, metadata),
  ]);

  const context: MemberPaymentContextField[] = [];
  if (season?.name) context.push({ label: 'Season', value: season.name });
  if (session?.name) context.push({ label: 'Session', value: session.name });
  if (curler?.name) context.push({ label: 'Curler', value: curler.name });
  if (registration?.status) {
    context.push({
      label: 'Registration status',
      value: registration.status.replace(/_/g, ' '),
    });
  }

  return {
    ...invoiceData,
    context,
  };
}

async function buildEventRegistrationPaymentDetail(
  registrationId: number,
  amountMinor: number
): Promise<{
  lineItems: MemberPaymentLineItem[];
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  context: MemberPaymentContextField[];
}> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      contactName: schema.eventRegistrations.contact_name,
      contactEmail: schema.eventRegistrations.contact_email,
      groupSize: schema.eventRegistrations.group_size,
      status: schema.eventRegistrations.status,
      eventTitle: schema.events.title,
    })
    .from(schema.eventRegistrations)
    .innerJoin(schema.events, eq(schema.events.id, schema.eventRegistrations.event_id))
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);

  if (!registration) {
    return {
      lineItems: [],
      subtotalMinor: null,
      discountMinor: null,
      totalMinor: null,
      context: [],
    };
  }

  const groupSize = registration.groupSize ?? 1;
  const lineDescription =
    groupSize > 1
      ? `${registration.eventTitle} registration (${groupSize} people)`
      : `${registration.eventTitle} registration`;

  const context: MemberPaymentContextField[] = [
    { label: 'Event', value: registration.eventTitle },
    { label: 'Registrant', value: registration.contactName },
    { label: 'Email', value: registration.contactEmail },
    { label: 'Group size', value: String(groupSize) },
    { label: 'Registration status', value: registration.status.replace(/_/g, ' ') },
  ];

  return {
    lineItems: [{ description: lineDescription, amountMinor }],
    subtotalMinor: amountMinor,
    discountMinor: 0,
    totalMinor: amountMinor,
    context,
  };
}

function buildDonationPaymentDetail(
  amountMinor: number,
  metadata: Record<string, unknown>
): {
  lineItems: MemberPaymentLineItem[];
  subtotalMinor: number | null;
  discountMinor: number | null;
  totalMinor: number | null;
  context: MemberPaymentContextField[];
} {
  const context: MemberPaymentContextField[] = [];
  const donorName = metadataString(metadata, 'donorName', 'donor_name');
  const donorEmail = metadataString(metadata, 'donorEmail', 'donor_email');
  const message = metadataString(metadata, 'message');
  if (donorName) context.push({ label: 'Donor name', value: donorName });
  if (donorEmail) context.push({ label: 'Donor email', value: donorEmail });
  if (message) context.push({ label: 'Message', value: message });

  return {
    lineItems: [{ description: 'Donation', amountMinor }],
    subtotalMinor: amountMinor,
    discountMinor: 0,
    totalMinor: amountMinor,
    context,
  };
}

type PaymentOrderDetailRow = {
  id: number;
  orderToken: string;
  subjectType: string;
  subjectId: number | null;
  amountMinor: number;
  currency: string;
  status: string;
  provider: 'stripe' | 'paypal' | 'square';
  providerOrderId: string | null;
  metadata: string | null;
  completedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

async function buildPaymentDetailFromOrder(order: PaymentOrderDetailRow): Promise<MemberPaymentDetail> {
  const { db, schema } = getDrizzleDb();

  const metadata = tryParseMetadata(order.metadata);
  const subjectType = order.subjectType as MemberPaymentHistorySubjectType;

  let lineItems: MemberPaymentLineItem[] = [];
  let subtotalMinor: number | null = null;
  let discountMinor: number | null = null;
  let totalMinor: number | null = null;
  let context: MemberPaymentContextField[] = [];

  if (subjectType === 'curling_registration' && order.subjectId != null) {
    const detail = await buildCurlingRegistrationPaymentDetail(order.subjectId, order.id, metadata);
    lineItems = detail.lineItems;
    subtotalMinor = detail.subtotalMinor;
    discountMinor = detail.discountMinor;
    totalMinor = detail.totalMinor;
    context = detail.context;
  } else if (subjectType === 'event_registration' && order.subjectId != null) {
    const detail = await buildEventRegistrationPaymentDetail(order.subjectId, order.amountMinor);
    lineItems = detail.lineItems;
    subtotalMinor = detail.subtotalMinor;
    discountMinor = detail.discountMinor;
    totalMinor = detail.totalMinor;
    context = detail.context;
  } else if (subjectType === 'donation') {
    const detail = buildDonationPaymentDetail(order.amountMinor, metadata);
    lineItems = detail.lineItems;
    subtotalMinor = detail.subtotalMinor;
    discountMinor = detail.discountMinor;
    totalMinor = detail.totalMinor;
    context = detail.context;
    context.unshift({
      label: 'Confirmation code',
      value: memberFacingConfirmationCode(order.orderToken),
    });
  } else if (subjectType === 'membership') {
    lineItems = [{ description: 'Membership', amountMinor: order.amountMinor }];
    subtotalMinor = order.amountMinor;
    discountMinor = 0;
    totalMinor = order.amountMinor;
  }

  if (lineItems.length === 0) {
    lineItems = [{ description: 'Payment', amountMinor: order.amountMinor }];
    subtotalMinor = order.amountMinor;
    discountMinor = 0;
    totalMinor = order.amountMinor;
  }

  const [eventDescriptions, curlingDescriptions, refundRows] = await Promise.all([
    order.subjectType === 'event_registration' && order.subjectId != null
      ? loadEventRegistrationDescriptions([order.subjectId])
      : Promise.resolve(new Map<number, string>()),
    order.subjectType === 'curling_registration' && order.subjectId != null
      ? loadCurlingRegistrationDescriptions([order.subjectId])
      : Promise.resolve(new Map<number, string>()),
    db
      .select({
        id: schema.refunds.id,
        amountMinor: schema.refunds.amount_minor,
        currency: schema.refunds.currency,
        status: schema.refunds.status,
        reason: schema.refunds.reason,
        processedAt: schema.refunds.processed_at,
        createdAt: schema.refunds.created_at,
      })
      .from(schema.refunds)
      .where(eq(schema.refunds.payment_order_id, order.id))
      .orderBy(desc(schema.refunds.created_at), desc(schema.refunds.id)),
  ]);

  const description = buildDescription(
    subjectType,
    order.subjectId,
    metadata,
    eventDescriptions,
    curlingDescriptions
  );

  return {
    orderToken: order.orderToken,
    subjectType,
    description,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: order.status as MemberPaymentHistoryStatus,
    provider: order.provider,
    providerReference: order.providerOrderId,
    paidAt: normalizeDateTime(order.completedAt),
    createdAt: normalizeDateTime(order.createdAt) ?? '',
    updatedAt: normalizeDateTime(order.updatedAt) ?? '',
    lineItems,
    subtotalMinor,
    discountMinor,
    totalMinor,
    refunds: refundRows.map((refund) => ({
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      processedAt: normalizeDateTime(refund.processedAt),
      createdAt: normalizeDateTime(refund.createdAt) ?? '',
    })),
    context,
  };
}

export async function getPaymentDetailByOrderToken(orderToken: string): Promise<MemberPaymentDetail | null> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      orderToken: schema.paymentOrders.order_token,
      subjectType: schema.paymentOrders.subject_type,
      subjectId: schema.paymentOrders.subject_id,
      amountMinor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
      status: schema.paymentOrders.status,
      provider: schema.paymentOrders.provider,
      providerOrderId: schema.paymentOrders.provider_order_id,
      metadata: schema.paymentOrders.metadata,
      completedAt: schema.paymentOrders.completed_at,
      createdAt: schema.paymentOrders.created_at,
      updatedAt: schema.paymentOrders.updated_at,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.order_token, orderToken))
    .limit(1);

  if (!order) return null;
  return buildPaymentDetailFromOrder(order);
}

export async function getMemberPaymentDetail(
  memberId: number,
  orderToken: string
): Promise<MemberPaymentDetail | null> {
  const { db, schema } = getDrizzleDb();
  const ownershipCondition = buildOwnershipConditions(memberId, { orderToken });
  const [owned] = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(ownershipCondition)
    .limit(1);
  if (!owned) return null;
  return getPaymentDetailByOrderToken(orderToken);
}

export async function listMemberPaymentHistory(
  memberId: number,
  options?: { limit?: number; offset?: number }
): Promise<MemberPaymentHistoryResponse> {
  const { db, schema } = getDrizzleDb();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const ownershipCondition = buildOwnershipConditions(memberId);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        orderToken: schema.paymentOrders.order_token,
        subjectType: schema.paymentOrders.subject_type,
        subjectId: schema.paymentOrders.subject_id,
        amountMinor: schema.paymentOrders.amount_minor,
        currency: schema.paymentOrders.currency,
        status: schema.paymentOrders.status,
        metadata: schema.paymentOrders.metadata,
        completedAt: schema.paymentOrders.completed_at,
        createdAt: schema.paymentOrders.created_at,
      })
      .from(schema.paymentOrders)
      .where(ownershipCondition)
      .orderBy(desc(schema.paymentOrders.created_at), desc(schema.paymentOrders.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.paymentOrders)
      .where(ownershipCondition),
  ]);

  const eventRegistrationIds = rows
    .filter((row) => row.subjectType === 'event_registration' && row.subjectId != null)
    .map((row) => row.subjectId as number);
  const curlingRegistrationIds = rows
    .filter((row) => row.subjectType === 'curling_registration' && row.subjectId != null)
    .map((row) => row.subjectId as number);

  const [eventDescriptions, curlingDescriptions] = await Promise.all([
    loadEventRegistrationDescriptions(eventRegistrationIds),
    loadCurlingRegistrationDescriptions(curlingRegistrationIds),
  ]);

  return {
    total: Number(totalRows[0]?.count ?? 0),
    limit,
    offset,
    payments: rows.map((row) => {
      const metadata = tryParseMetadata(row.metadata);
      return {
        orderToken: row.orderToken,
        subjectType: row.subjectType as MemberPaymentHistorySubjectType,
        description: buildDescription(
          row.subjectType as MemberPaymentHistorySubjectType,
          row.subjectId,
          metadata,
          eventDescriptions,
          curlingDescriptions
        ),
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status as MemberPaymentHistoryStatus,
        paidAt: normalizeDateTime(row.completedAt),
        createdAt: normalizeDateTime(row.createdAt) ?? '',
      };
    }),
  };
}
