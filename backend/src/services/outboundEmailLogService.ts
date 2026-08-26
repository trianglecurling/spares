import { and, desc, eq, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { SendBudgetKind } from '../utils/abuseProtection.js';

export const OUTBOUND_EMAIL_RETENTION_DAYS = 30;
export const OUTBOUND_EMAIL_LIST_PAGE_SIZE = 50;

export type OutboundEmailListItem = {
  id: number;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  createdAt: string;
};

export type OutboundEmailDetail = OutboundEmailListItem & {
  htmlBody: string;
  textBody: string | null;
};

function retentionPredicate(createdAtColumn: unknown) {
  const config = getDatabaseConfig();
  if (config?.type === 'sqlite') {
    return sql`${createdAtColumn} >= datetime('now', '-30 days')`;
  }
  return sql`${createdAtColumn} >= NOW() - INTERVAL '30 days'`;
}

function expiredPredicate(createdAtColumn: unknown) {
  const config = getDatabaseConfig();
  if (config?.type === 'sqlite') {
    return sql`${createdAtColumn} < datetime('now', '-30 days')`;
  }
  return sql`${createdAtColumn} < NOW() - INTERVAL '30 days'`;
}

export function shouldLogOutboundEmail(options: { budgetKind?: SendBudgetKind }): boolean {
  return options.budgetKind !== 'otp';
}

export function serializeOutboundEmailTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return new Date().toISOString();
}

export async function purgeExpiredOutboundEmails(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.outboundEmails).where(expiredPredicate(schema.outboundEmails.created_at));
}

export async function recordOutboundEmail(input: {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  htmlBody: string;
  textBody?: string | null;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.insert(schema.outboundEmails).values({
    recipient_email: input.recipientEmail,
    recipient_name: input.recipientName || null,
    subject: input.subject,
    html_body: input.htmlBody,
    text_body: input.textBody?.trim() ? input.textBody : null,
  });
  await purgeExpiredOutboundEmails();
}

export async function listOutboundEmails(input: {
  page?: number;
  pageSize?: number;
}): Promise<{ items: OutboundEmailListItem[]; page: number; pageSize: number; total: number }> {
  const pageSize = Math.max(
    1,
    Math.min(100, Math.round(input.pageSize ?? OUTBOUND_EMAIL_LIST_PAGE_SIZE))
  );
  const requestedPage = Math.max(1, Math.round(input.page ?? 1));
  const { db, schema } = getDrizzleDb();
  const withinRetention = retentionPredicate(schema.outboundEmails.created_at);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.outboundEmails)
    .where(withinRetention);
  const total = Number(totalRow?.count ?? 0);
  const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(requestedPage, maxPage);

  const rows = await db
    .select({
      id: schema.outboundEmails.id,
      recipientEmail: schema.outboundEmails.recipient_email,
      recipientName: schema.outboundEmails.recipient_name,
      subject: schema.outboundEmails.subject,
      createdAt: schema.outboundEmails.created_at,
    })
    .from(schema.outboundEmails)
    .where(withinRetention)
    .orderBy(desc(schema.outboundEmails.created_at), desc(schema.outboundEmails.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((row) => ({
      id: row.id,
      recipientEmail: row.recipientEmail,
      recipientName: row.recipientName ?? null,
      subject: row.subject,
      createdAt: serializeOutboundEmailTimestamp(row.createdAt),
    })),
    page,
    pageSize,
    total,
  };
}

export async function getOutboundEmail(id: number): Promise<OutboundEmailDetail | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.outboundEmails.id,
      recipientEmail: schema.outboundEmails.recipient_email,
      recipientName: schema.outboundEmails.recipient_name,
      subject: schema.outboundEmails.subject,
      htmlBody: schema.outboundEmails.html_body,
      textBody: schema.outboundEmails.text_body,
      createdAt: schema.outboundEmails.created_at,
    })
    .from(schema.outboundEmails)
    .where(and(eq(schema.outboundEmails.id, id), retentionPredicate(schema.outboundEmails.created_at)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName ?? null,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody ?? null,
    createdAt: serializeOutboundEmailTimestamp(row.createdAt),
  };
}
