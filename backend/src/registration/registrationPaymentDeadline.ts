import { and, asc, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export type RegistrationPaymentDeadlineRow = {
  id: number;
  seasonId: number;
  sessionId: number;
  paymentDeadlineAt: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function formatRegistrationPaymentDeadline(deadline: Date | string): string {
  const date = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(date.getTime())) return 'the payment deadline';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(date);
}

/** Phrase after “Payment is due …” for pay-later warnings and emails. */
export function registrationPayLaterDuePhrase(deadlineAt: Date | string | null | undefined): string {
  if (!deadlineAt) return 'before leagues begin';
  const formatted = formatRegistrationPaymentDeadline(deadlineAt);
  if (formatted === 'the payment deadline') return 'before leagues begin';
  return `by ${formatted}`;
}

function mapPaymentDeadline(row: {
  id: number;
  season_id: number;
  session_id: number;
  payment_deadline_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}): RegistrationPaymentDeadlineRow {
  return {
    id: row.id,
    seasonId: row.season_id,
    sessionId: row.session_id,
    paymentDeadlineAt: normalizeDateTime(row.payment_deadline_at) ?? '',
    createdAt: normalizeDateTime(row.created_at) ?? '',
    updatedAt: normalizeDateTime(row.updated_at) ?? '',
  };
}

export async function listRegistrationPaymentDeadlines(): Promise<RegistrationPaymentDeadlineRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.registrationPaymentDeadlines)
    .orderBy(
      asc(schema.registrationPaymentDeadlines.season_id),
      asc(schema.registrationPaymentDeadlines.session_id),
    );
  return rows.map(mapPaymentDeadline);
}

export async function getRegistrationPaymentDeadline(
  seasonId: number,
  sessionId: number,
): Promise<RegistrationPaymentDeadlineRow | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.registrationPaymentDeadlines)
    .where(
      and(
        eq(schema.registrationPaymentDeadlines.season_id, seasonId),
        eq(schema.registrationPaymentDeadlines.session_id, sessionId),
      ),
    )
    .limit(1);
  return row ? mapPaymentDeadline(row) : null;
}

export async function upsertRegistrationPaymentDeadline(input: {
  seasonId: number;
  sessionId: number;
  paymentDeadlineAt: string;
}): Promise<RegistrationPaymentDeadlineRow> {
  const deadline = new Date(input.paymentDeadlineAt);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error('Payment deadline must be a valid date and time.');
  }
  const { db, schema } = getDrizzleDb();
  const existing = await getRegistrationPaymentDeadline(input.seasonId, input.sessionId);
  if (existing) {
    const [updated] = await db
      .update(schema.registrationPaymentDeadlines)
      .set({
        payment_deadline_at: deadline,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.registrationPaymentDeadlines.id, existing.id))
      .returning();
    return mapPaymentDeadline(updated);
  }
  const [inserted] = await db
    .insert(schema.registrationPaymentDeadlines)
    .values({
      season_id: input.seasonId,
      session_id: input.sessionId,
      payment_deadline_at: deadline,
    })
    .returning();
  return mapPaymentDeadline(inserted);
}

export async function deleteRegistrationPaymentDeadline(id: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const deleted = await db
    .delete(schema.registrationPaymentDeadlines)
    .where(eq(schema.registrationPaymentDeadlines.id, id))
    .returning({ id: schema.registrationPaymentDeadlines.id });
  return deleted.length > 0;
}
