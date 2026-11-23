import { and, eq, sql, type SQL } from 'drizzle-orm';
import { config } from '../../../config.js';
import { getDatabaseConfig } from '../../../db/config.js';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { ExpenseDateRangeError, resolveExpenseDateBounds } from '../../../services/expenseReportDateRange.js';
import { formatDateInTimeZone, localDateTimeToUtcDate } from '../../../utils/timeZone.js';

export const REFUND_STATUSES = ['requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed'] as const;
export const REFUND_SUBJECT_TYPES = ['donation', 'membership', 'event_registration', 'curling_registration'] as const;
export const REFUND_PROVIDERS = ['stripe', 'paypal', 'square'] as const;
export const REFUND_DATE_RANGES = ['this_month', 'last_month', 'this_fiscal_year', 'custom'] as const;
export const REFUND_SORT_KEYS = ['issuedAt', 'amount', 'status', 'recipient', 'subject', 'provider', 'issuedBy'] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type RefundSubjectType = (typeof REFUND_SUBJECT_TYPES)[number];
export type RefundProvider = (typeof REFUND_PROVIDERS)[number];
export type RefundDateRange = (typeof REFUND_DATE_RANGES)[number];
export type RefundSortKey = (typeof REFUND_SORT_KEYS)[number];

export type AdminRefundListQuery = {
  limit?: number;
  offset?: number;
  search?: string;
  provider?: RefundProvider;
  subjectType?: RefundSubjectType;
  status?: RefundStatus;
  range?: RefundDateRange | '';
  from?: string;
  to?: string;
  sort?: RefundSortKey;
  order?: 'asc' | 'desc';
};

export type AdminRefundListItem = {
  id: number;
  paymentOrderId: number;
  orderToken: string;
  provider: RefundProvider;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: RefundStatus;
  subjectType: RefundSubjectType;
  subjectId: number | null;
  subjectLabel: string;
  recipientName: string | null;
  recipientEmail: string | null;
  issuedByName: string | null;
  providerRefundId: string | null;
  processedAt: string | null;
  createdAt: string;
  issuedAt: string;
};

export type AdminRefundCurrencyTotal = {
  currency: string;
  amountMinor: number;
};

export type AdminRefundListResponse = {
  total: number;
  limit: number;
  offset: number;
  summary: {
    succeededAmountByCurrency: AdminRefundCurrencyTotal[];
  };
  refunds: AdminRefundListItem[];
};

export class PaymentRefundListError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'PaymentRefundListError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

type RefundSchema = ReturnType<typeof getDrizzleDb>['schema'];

const memberDisplayNameSql = sql.raw(`CASE
  WHEN trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) <> ''
  THEN trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))
  ELSE nullif(trim(m.name), '')
END`);

const memberEmailSql = sql.raw(`nullif(trim(m.email), '')`);

export function utcInstantToSqliteDateTime(instant: Date): string {
  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

export function resolveRefundIssuedBounds(input: {
  range?: RefundDateRange | '';
  from?: string;
  to?: string;
  todayLocal: string;
  fiscalYearStartMmdd?: string | null;
  timeZone: string;
}): { fromUtc?: Date; toExclusiveUtc?: Date } {
  const range = input.range || undefined;
  if (!range) return {};

  let bounds: { from?: string; toExclusive?: string };
  try {
    bounds = resolveExpenseDateBounds({
      range,
      from: input.from,
      to: input.to,
      todayLocal: input.todayLocal,
      fiscalYearStartMmdd: input.fiscalYearStartMmdd,
    });
  } catch (error) {
    if (error instanceof ExpenseDateRangeError) {
      throw new PaymentRefundListError(error.message, 400, { field: error.field });
    }
    throw error;
  }

  const fromUtc = bounds.from ? localDateTimeToUtcDate(bounds.from, '00:00:00', input.timeZone) : undefined;
  const toExclusiveUtc = bounds.toExclusive
    ? localDateTimeToUtcDate(bounds.toExclusive, '00:00:00', input.timeZone)
    : undefined;
  if ((fromUtc && Number.isNaN(fromUtc.getTime())) || (toExclusiveUtc && Number.isNaN(toExclusiveUtc.getTime()))) {
    throw new PaymentRefundListError('Enter a valid date range.', 400, { field: 'from' });
  }
  return { fromUtc, toExclusiveUtc };
}

function normalizeDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function metadataText(schema: RefundSchema, isPostgres: boolean, key: string): SQL {
  const column = schema.paymentOrders.metadata;
  if (isPostgres) {
    return sql`nullif(trim(COALESCE(${column}::jsonb->>${key}, '')), '')`;
  }
  return sql`nullif(trim(COALESCE(json_extract(COALESCE(${column}, '{}'), ${`$.${key}`}), '')), '')`;
}

function curlerNameSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberDisplayNameSql}
    FROM curling_registrations cr
    INNER JOIN members m ON m.id = cr.curler_member_id
    WHERE ${schema.paymentOrders.subject_type} = 'curling_registration'
      AND cr.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
}

function curlerEmailSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberEmailSql}
    FROM curling_registrations cr
    INNER JOIN members m ON m.id = cr.curler_member_id
    WHERE ${schema.paymentOrders.subject_type} = 'curling_registration'
      AND cr.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
}

function payerNameSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberDisplayNameSql}
    FROM registration_invoices ri
    INNER JOIN members m ON m.id = ri.payer_member_id
    WHERE ri.payment_order_id = ${schema.paymentOrders.id}
    ORDER BY ri.id DESC
    LIMIT 1
  )`;
}

function payerEmailSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberEmailSql}
    FROM registration_invoices ri
    INNER JOIN members m ON m.id = ri.payer_member_id
    WHERE ri.payment_order_id = ${schema.paymentOrders.id}
    ORDER BY ri.id DESC
    LIMIT 1
  )`;
}

function eventContactNameSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT nullif(trim(er.contact_name), '')
    FROM event_registrations er
    WHERE ${schema.paymentOrders.subject_type} = 'event_registration'
      AND er.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
}

function eventContactEmailSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT nullif(trim(er.contact_email), '')
    FROM event_registrations er
    WHERE ${schema.paymentOrders.subject_type} = 'event_registration'
      AND er.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
}

function creatorNameSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberDisplayNameSql}
    FROM members m
    WHERE m.id = ${schema.paymentOrders.created_by_member_id}
    LIMIT 1
  )`;
}

function creatorEmailSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberEmailSql}
    FROM members m
    WHERE m.id = ${schema.paymentOrders.created_by_member_id}
    LIMIT 1
  )`;
}

function donorNameSql(schema: RefundSchema, isPostgres: boolean): SQL {
  return sql`COALESCE(${metadataText(schema, isPostgres, 'donorName')}, ${metadataText(schema, isPostgres, 'donor_name')})`;
}

function donorEmailSql(schema: RefundSchema, isPostgres: boolean): SQL {
  return sql`COALESCE(${metadataText(schema, isPostgres, 'donorEmail')}, ${metadataText(schema, isPostgres, 'donor_email')})`;
}

function recipientNameSql(schema: RefundSchema, isPostgres: boolean): SQL {
  return sql`COALESCE(
    ${curlerNameSql(schema)},
    ${payerNameSql(schema)},
    ${eventContactNameSql(schema)},
    CASE
      WHEN ${schema.paymentOrders.subject_type} = 'donation' THEN ${donorNameSql(schema, isPostgres)}
      ELSE NULL
    END,
    ${creatorNameSql(schema)}
  )`;
}

function recipientEmailSql(schema: RefundSchema, isPostgres: boolean): SQL {
  return sql`CASE
    WHEN ${curlerNameSql(schema)} IS NOT NULL THEN ${curlerEmailSql(schema)}
    WHEN ${payerNameSql(schema)} IS NOT NULL THEN ${payerEmailSql(schema)}
    WHEN ${eventContactNameSql(schema)} IS NOT NULL THEN ${eventContactEmailSql(schema)}
    WHEN ${schema.paymentOrders.subject_type} = 'donation'
      AND (${donorNameSql(schema, isPostgres)} IS NOT NULL OR ${donorEmailSql(schema, isPostgres)} IS NOT NULL)
      THEN ${donorEmailSql(schema, isPostgres)}
    ELSE ${creatorEmailSql(schema)}
  END`;
}

function issuedByNameSql(schema: RefundSchema): SQL {
  return sql`(
    SELECT ${memberDisplayNameSql}
    FROM members m
    WHERE m.id = ${schema.refunds.requested_by_member_id}
    LIMIT 1
  )`;
}

function subjectLabelSql(schema: RefundSchema, isPostgres: boolean): SQL {
  const eventTitle = sql`(
    SELECT nullif(trim(e.title), '')
    FROM event_registrations er
    INNER JOIN events e ON e.id = er.event_id
    WHERE er.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
  const seasonLabel = sql`(
    SELECT CASE
      WHEN nullif(trim(sess.name), '') IS NOT NULL AND nullif(trim(season.name), '') IS NOT NULL
        THEN trim(season.name) || ' (' || trim(sess.name) || ')'
      ELSE COALESCE(nullif(trim(season.name), ''), nullif(trim(sess.name), ''))
    END
    FROM curling_registrations cr
    INNER JOIN curling_seasons season ON season.id = cr.season_id
    INNER JOIN curling_sessions sess ON sess.id = cr.session_id
    WHERE cr.id = ${schema.paymentOrders.subject_id}
    LIMIT 1
  )`;
  return sql`CASE ${schema.paymentOrders.subject_type}
    WHEN 'donation' THEN 'Donation'
    WHEN 'membership' THEN 'Membership'
    WHEN 'event_registration' THEN COALESCE(${eventTitle}, ${metadataText(schema, isPostgres, 'eventTitle')}, 'Event registration')
    WHEN 'curling_registration' THEN CASE
      WHEN ${seasonLabel} IS NOT NULL THEN 'League registration — ' || ${seasonLabel}
      ELSE 'League registration'
    END
    ELSE 'Payment'
  END`;
}

function issuedAtSql(schema: RefundSchema): SQL {
  return sql`COALESCE(${schema.refunds.processed_at}, ${schema.refunds.created_at})`;
}

function clubToday(timeZone: string): string {
  return formatDateInTimeZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
}

async function fiscalYearStartMmdd(): Promise<string | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ mmdd: schema.governanceSettings.fiscal_year_start_mmdd })
    .from(schema.governanceSettings)
    .where(eq(schema.governanceSettings.id, 1))
    .limit(1);
  return row?.mmdd ?? null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function listAdminRefunds(query: AdminRefundListQuery): Promise<AdminRefundListResponse> {
  const { db, schema } = getDrizzleDb();
  const isPostgres = getDatabaseConfig()?.type === 'postgres';
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const sort = query.sort ?? 'issuedAt';
  const order = query.order ?? 'desc';
  const timeZone = config.timeZone || 'America/New_York';
  const range = query.range || (query.from || query.to ? 'custom' : '');
  const bounds = resolveRefundIssuedBounds({
    range,
    from: query.from,
    to: query.to,
    todayLocal: clubToday(timeZone),
    fiscalYearStartMmdd: range === 'this_fiscal_year' ? await fiscalYearStartMmdd() : null,
    timeZone,
  });

  const conditions: SQL[] = [];
  if (query.provider) conditions.push(eq(schema.refunds.provider, query.provider));
  if (query.status) conditions.push(eq(schema.refunds.status, query.status));
  if (query.subjectType) conditions.push(eq(schema.paymentOrders.subject_type, query.subjectType));
  if (bounds.fromUtc) {
    const issuedAt = issuedAtSql(schema);
    conditions.push(
      isPostgres
        ? sql`${issuedAt} >= ${bounds.fromUtc}`
        : sql`datetime(${issuedAt}) >= datetime(${utcInstantToSqliteDateTime(bounds.fromUtc)})`
    );
  }
  if (bounds.toExclusiveUtc) {
    const issuedAt = issuedAtSql(schema);
    conditions.push(
      isPostgres
        ? sql`${issuedAt} < ${bounds.toExclusiveUtc}`
        : sql`datetime(${issuedAt}) < datetime(${utcInstantToSqliteDateTime(bounds.toExclusiveUtc)})`
    );
  }

  const search = query.search?.trim().toLowerCase() ?? '';
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(sql`(
      lower(coalesce(${recipientNameSql(schema, isPostgres)}, '')) LIKE ${pattern}
      OR lower(coalesce(${recipientEmailSql(schema, isPostgres)}, '')) LIKE ${pattern}
      OR lower(coalesce(${subjectLabelSql(schema, isPostgres)}, '')) LIKE ${pattern}
      OR lower(coalesce(${issuedByNameSql(schema)}, '')) LIKE ${pattern}
      OR lower(coalesce(${schema.refunds.reason}, '')) LIKE ${pattern}
      OR lower(coalesce(${schema.refunds.provider_refund_id}, '')) LIKE ${pattern}
      OR lower(coalesce(${schema.paymentOrders.order_token}, '')) LIKE ${pattern}
      OR lower(coalesce(${schema.paymentOrders.provider_order_id}, '')) LIKE ${pattern}
      OR cast(${schema.refunds.id} as text) LIKE ${pattern}
      OR cast(${schema.paymentOrders.id} as text) LIKE ${pattern}
    )`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const direction = sql.raw(order === 'asc' ? 'ASC' : 'DESC');
  const sortExpr =
    sort === 'amount'
      ? sql`${schema.refunds.amount_minor}`
      : sort === 'status'
        ? sql`${schema.refunds.status}`
        : sort === 'provider'
          ? sql`${schema.refunds.provider}`
          : sort === 'recipient'
            ? sql`lower(${recipientNameSql(schema, isPostgres)})`
            : sort === 'subject'
              ? sql`lower(${subjectLabelSql(schema, isPostgres)})`
              : sort === 'issuedBy'
                ? sql`lower(${issuedByNameSql(schema)})`
                : issuedAtSql(schema);

  const [rows, totalRows, succeededTotals] = await Promise.all([
    db
      .select({
        id: schema.refunds.id,
        paymentOrderId: schema.refunds.payment_order_id,
        orderToken: schema.paymentOrders.order_token,
        provider: schema.refunds.provider,
        amountMinor: schema.refunds.amount_minor,
        currency: schema.refunds.currency,
        reason: schema.refunds.reason,
        status: schema.refunds.status,
        subjectType: schema.paymentOrders.subject_type,
        subjectId: schema.paymentOrders.subject_id,
        subjectLabel: subjectLabelSql(schema, isPostgres),
        recipientName: recipientNameSql(schema, isPostgres),
        recipientEmail: recipientEmailSql(schema, isPostgres),
        issuedByName: issuedByNameSql(schema),
        providerRefundId: schema.refunds.provider_refund_id,
        processedAt: schema.refunds.processed_at,
        createdAt: schema.refunds.created_at,
        issuedAt: issuedAtSql(schema),
      })
      .from(schema.refunds)
      .innerJoin(schema.paymentOrders, eq(schema.refunds.payment_order_id, schema.paymentOrders.id))
      .where(whereClause)
      .orderBy(sql`${sortExpr} ${direction} NULLS LAST`, sql`${schema.refunds.id} DESC`)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.refunds)
      .innerJoin(schema.paymentOrders, eq(schema.refunds.payment_order_id, schema.paymentOrders.id))
      .where(whereClause),
    db
      .select({
        currency: schema.refunds.currency,
        amountMinor: sql<number>`COALESCE(SUM(${schema.refunds.amount_minor}), 0)`,
      })
      .from(schema.refunds)
      .innerJoin(schema.paymentOrders, eq(schema.refunds.payment_order_id, schema.paymentOrders.id))
      .where(whereClause ? and(whereClause, eq(schema.refunds.status, 'succeeded')) : eq(schema.refunds.status, 'succeeded'))
      .groupBy(schema.refunds.currency),
  ]);

  const succeededAmountByCurrency = succeededTotals
    .map((row) => ({
      currency: (row.currency || 'usd').toLowerCase(),
      amountMinor: Number(row.amountMinor ?? 0),
    }))
    .filter((row) => row.amountMinor !== 0)
    .sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    total: Number(totalRows[0]?.count ?? 0),
    limit,
    offset,
    summary: { succeededAmountByCurrency },
    refunds: rows.map((row) => ({
      id: row.id,
      paymentOrderId: row.paymentOrderId,
      orderToken: row.orderToken,
      provider: row.provider,
      amountMinor: Number(row.amountMinor),
      currency: row.currency,
      reason: textOrNull(row.reason),
      status: row.status,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectLabel: textOrNull(row.subjectLabel) ?? 'Payment',
      recipientName: textOrNull(row.recipientName),
      recipientEmail: textOrNull(row.recipientEmail),
      issuedByName: textOrNull(row.issuedByName),
      providerRefundId: textOrNull(row.providerRefundId),
      processedAt: normalizeDateTime(row.processedAt),
      createdAt: normalizeDateTime(row.createdAt) ?? '',
      issuedAt: normalizeDateTime(row.issuedAt) ?? normalizeDateTime(row.createdAt) ?? '',
    })),
  };
}
