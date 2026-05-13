import { eq, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  listRegistrationOutboundMessages,
  resendRegistrationOutboundMessage,
  sendRegistrationEmailForDashboard,
} from './registrationEmailService.js';

function dbValue(value: unknown): never {
  return value as never;
}

function memberName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'there';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'there';
}

function hostedCheckoutUrl(metadata: unknown): string | null {
  const value = typeof metadata === 'string' ? (() => {
    try {
      return JSON.parse(metadata) as unknown;
    } catch {
      return null;
    }
  })() : metadata;
  if (value && typeof value === 'object' && 'hostedCheckoutUrl' in value && typeof value.hostedCheckoutUrl === 'string') {
    return value.hostedCheckoutUrl;
  }
  return null;
}

export async function listStaffRegistrationCommunications(input: { registrationId?: number; waitlistOfferId?: number }) {
  return { communications: await listRegistrationOutboundMessages({ ...input, limit: 100 }) };
}

export async function resendStaffRegistrationCommunication(messageId: number) {
  return { communication: await resendRegistrationOutboundMessage(messageId) };
}

export async function sendManualRegistrationUpdateEmail(input: {
  registrationId: number;
  changedSummary: string;
  paymentImpact?: string | null;
}) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, input.registrationId))
    .limit(1);
  if (!registration?.curler_member_id) throw new Error('Registration was not found.');
  const [curler] = await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1);
  if (!curler?.email) throw new Error('Curler email was not found.');
  const communication = await sendRegistrationEmailForDashboard({
    messageType: 'registration_manually_updated_by_staff',
    recipientEmail: curler.email,
    recipientName: memberName(curler),
    recipientMemberId: curler.id,
    registrationId: registration.id,
    payload: {
      changedSummary: input.changedSummary,
      paymentImpact: input.paymentImpact ?? 'unchanged',
    },
  });
  return { communication };
}

export async function reviewJuniorFinancialAssistance(input: {
  requestId: number;
  actorMemberId: number;
  status: 'approved' | 'partially_approved' | 'denied' | 'withdrawn';
  approvedPercentage?: number | null;
  staffNotes?: string | null;
}) {
  const { db, schema } = getDrizzleDb();
  const [request] = await db
    .select()
    .from(schema.financialAssistanceRequests)
    .where(eq(schema.financialAssistanceRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new Error('Financial assistance request was not found.');
  const reviewedAt = getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString();
  const [updated] = await db
    .update(schema.financialAssistanceRequests)
    .set({
      status: input.status,
      approved_percentage: input.approvedPercentage ?? (input.status === 'approved' ? request.requested_percentage : 0),
      reviewed_by_member_id: input.actorMemberId,
      reviewed_at: dbValue(reviewedAt),
      staff_notes: input.staffNotes?.trim() || null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.financialAssistanceRequests.id, request.id))
    .returning();

  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, request.member_id)).limit(1);
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, request.registration_id))
    .limit(1);
  const order = invoice?.payment_order_id
    ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
    : null;
  if (member?.email) {
    await sendRegistrationEmailForDashboard({
      messageType: 'junior_assistance_decision',
      recipientEmail: member.email,
      recipientName: memberName(member),
      recipientMemberId: member.id,
      registrationId: request.registration_id,
      payload: {
        requestedAssistancePercent: request.requested_percentage,
        approvedAssistancePercent: updated.approved_percentage ?? 0,
        amountDueMinor: invoice?.total_minor ?? null,
        paymentUrl: hostedCheckoutUrl(order?.metadata),
      },
    });
  }

  return { request: updated };
}
