import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import { listCurlingRegistrationPaymentActivity } from '../domains/payments/queries/paymentSummaries.js';
import { getMemberRegistrationDetail } from './registrationMemberService.js';
import { getDefaultRegistrationWindow } from './registrationShellService.js';

export class RegistrationStaffValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration staff operation failed');
  }
}

function memberName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'Unknown curler';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
}

function assertStaffAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationStaffValidationError({ registration: 'You do not have permission to manage registrations.' });
  }
}

const LISTABLE_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
  'cancelled',
] as const;

export async function listStaffRegistrationSessions() {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.curlingSessions.id,
      seasonId: schema.curlingSessions.season_id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .orderBy(desc(schema.curlingSeasons.start_date), asc(schema.curlingSessions.start_date));
  const window = await getDefaultRegistrationWindow();
  return {
    sessions: rows.map((row) => ({
      id: row.id,
      seasonId: row.seasonId,
      seasonName: row.seasonName,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      isDefault: window?.session.id === row.id,
    })),
    defaultSessionId: window?.session.id ?? rows[0]?.id ?? null,
  };
}

export async function listStaffRegistrations(input: {
  actor: Member;
  sessionId: number;
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  assertStaffAccess(input.actor);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const search = input.search?.trim().toLowerCase() ?? '';

  const { db, schema } = getDrizzleDb();
  const filters = [
    eq(schema.curlingRegistrations.session_id, input.sessionId),
    sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
  ];
  if (input.status) {
    filters.push(eq(schema.curlingRegistrations.status, input.status as (typeof LISTABLE_REGISTRATION_STATUSES)[number]));
  } else {
    filters.push(inArray(schema.curlingRegistrations.status, [...LISTABLE_REGISTRATION_STATUSES]));
  }
  if (search) {
    const pattern = `%${search}%`;
    filters.push(
      or(
        sql`lower(coalesce(${schema.members.name}, '')) LIKE ${pattern}`,
        sql`lower(coalesce(${schema.members.first_name}, '')) LIKE ${pattern}`,
        sql`lower(coalesce(${schema.members.last_name}, '')) LIKE ${pattern}`,
        sql`lower(coalesce(${schema.members.email}, '')) LIKE ${pattern}`,
        sql`cast(${schema.curlingRegistrations.id} as text) LIKE ${pattern}`,
      )!,
    );
  }

  const whereClause = and(...filters);
  const rows = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      submittedAt: schema.curlingRegistrations.submitted_at,
      updatedAt: schema.curlingRegistrations.updated_at,
      membershipOption: schema.curlingRegistrations.membership_option,
      curlerId: schema.members.id,
      curlerName: schema.members.name,
      curlerFirstName: schema.members.first_name,
      curlerLastName: schema.members.last_name,
      curlerEmail: schema.members.email,
      seasonName: schema.curlingSeasons.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.curlingRegistrations)
    .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
    .innerJoin(schema.curlingSessions, eq(schema.curlingRegistrations.session_id, schema.curlingSessions.id))
    .where(whereClause)
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id))
    .limit(pageSize)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.curlingRegistrations)
    .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .where(whereClause);

  const registrations = [];
  for (const row of rows) {
    const [invoice] = await db
      .select({
        status: schema.registrationInvoices.status,
        totalMinor: schema.registrationInvoices.total_minor,
      })
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, row.id))
      .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
      .limit(1);
    registrations.push({
      id: row.id,
      curlerId: row.curlerId,
      curlerName: memberName({
        name: row.curlerName,
        first_name: row.curlerFirstName,
        last_name: row.curlerLastName,
        email: row.curlerEmail,
      }),
      curlerEmail: row.curlerEmail,
      seasonName: row.seasonName,
      sessionName: row.sessionName,
      registrationStatus: row.status,
      membershipOption: row.membershipOption,
      paymentStatus: invoice?.status ?? null,
      amountDueMinor: invoice?.totalMinor ?? null,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    });
  }

  return {
    registrations,
    page,
    pageSize,
    total: Number(countRow?.count ?? 0),
  };
}

export async function getStaffRegistrationDetail(registrationId: number, actor: Member) {
  assertStaffAccess(actor);
  const detail = await getMemberRegistrationDetail(registrationId, actor);
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  const lineItems = invoice
    ? await db
        .select({
          id: schema.registrationInvoiceLineItems.id,
          lineType: schema.registrationInvoiceLineItems.line_type,
          description: schema.registrationInvoiceLineItems.description,
          relatedLeagueId: schema.registrationInvoiceLineItems.related_league_id,
          amountMinor: schema.registrationInvoiceLineItems.amount_minor,
          sortOrder: schema.registrationInvoiceLineItems.sort_order,
        })
        .from(schema.registrationInvoiceLineItems)
        .where(eq(schema.registrationInvoiceLineItems.invoice_id, invoice.id))
        .orderBy(asc(schema.registrationInvoiceLineItems.sort_order), asc(schema.registrationInvoiceLineItems.id))
    : [];
  const paymentActivity = await listCurlingRegistrationPaymentActivity(registrationId);
  const [submitter] = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(schema.members, eq(schema.curlingRegistrations.submitted_by_member_id, schema.members.id))
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);

  return {
    ...detail,
    canEdit: detail.registration.registrationStatus !== 'cancelled',
    canCancel: detail.registration.registrationStatus !== 'cancelled',
    submittedBy: submitter
      ? {
          id: submitter.id,
          name: memberName(submitter),
          email: submitter.email,
        }
      : null,
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status,
          subtotalMinor: invoice.subtotal_minor,
          discountMinor: invoice.discount_minor,
          totalMinor: invoice.total_minor,
          deferredReason: invoice.deferred_reason,
          paidAt: invoice.paid_at,
          lineItems,
        }
      : null,
    paymentActivity,
  };
}
