import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingRegistrationStatusSqlite } from '../db/drizzle-schema.js';
import { sendRegistrationCancelledByMemberEmail } from './registrationEmailService.js';
import { createPaymentService } from '../services/paymentService.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import {
  canViewOrEditRegistration,
  getEffectiveRegistrationWindow,
  getRegistrationById,
  type RegistrationShellRow,
} from './registrationShellService.js';
import { removeAllRegistrationRosterPlacements } from './registrationRosterService.js';
import { recordAndDeleteWaitlistEntry, waitlistMemberDisplayName } from './waitlistAudit.js';

export class RegistrationPriorityEditValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration priority edit failed');
  }
}

export const PRIORITY_EDITABLE_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
] as const satisfies readonly CurlingRegistrationStatusSqlite[];

export const PRIORITY_CANCELLABLE_REGISTRATION_STATUSES = [
  ...PRIORITY_EDITABLE_REGISTRATION_STATUSES,
  'confirmed',
] as const satisfies readonly CurlingRegistrationStatusSqlite[];

const PRIORITY_EDITABLE_STATUS_SET = new Set<string>(PRIORITY_EDITABLE_REGISTRATION_STATUSES);
const PRIORITY_CANCELLABLE_STATUS_SET = new Set<string>(PRIORITY_CANCELLABLE_REGISTRATION_STATUSES);

export function isPriorityEditableRegistrationStatus(status: string): boolean {
  return PRIORITY_EDITABLE_STATUS_SET.has(status);
}

export function isPriorityCancellableRegistrationStatus(status: string): boolean {
  return PRIORITY_CANCELLABLE_STATUS_SET.has(status);
}

export async function isRegistrationPriorityEditWindow(
  seasonId: number,
  sessionId: number,
): Promise<boolean> {
  const window = await getEffectiveRegistrationWindow(seasonId, sessionId);
  return window?.state === 'priority';
}

export async function canEditRegistrationDuringPriority(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<boolean> {
  if (!(await canViewOrEditRegistration(actor, registration))) return false;
  if (!isPriorityEditableRegistrationStatus(registration.status)) return false;
  return isRegistrationPriorityEditWindow(registration.season_id, registration.session_id);
}

export async function canCancelRegistrationDuringPriority(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<boolean> {
  if (!(await canViewOrEditRegistration(actor, registration))) return false;
  if (!isPriorityCancellableRegistrationStatus(registration.status)) return false;
  return isRegistrationPriorityEditWindow(registration.season_id, registration.session_id);
}

export async function assertPriorityEditableRegistration(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<void> {
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  if (!isPriorityEditableRegistrationStatus(registration.status)) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'This registration cannot be edited right now.',
    });
  }
  if (!(await isRegistrationPriorityEditWindow(registration.season_id, registration.session_id))) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'Registration can only be edited during priority registration.',
    });
  }
}

export async function assertPriorityCancellableRegistration(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<void> {
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  if (!isPriorityCancellableRegistrationStatus(registration.status)) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'This registration cannot be deleted right now.',
    });
  }
  if (!(await isRegistrationPriorityEditWindow(registration.season_id, registration.session_id))) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'Registration can only be deleted during priority registration.',
    });
  }
}

const STAFF_EDITABLE_REGISTRATION_STATUSES = new Set([
  ...PRIORITY_EDITABLE_REGISTRATION_STATUSES,
  'confirmed',
]);

const STAFF_NON_EDITABLE_DRAFT_STATUSES = new Set([
  'identity_incomplete',
  'policies_incomplete',
  'demographics_incomplete',
  'shell_complete',
]);

export function isStaffEditableRegistrationStatus(status: string): boolean {
  return !STAFF_NON_EDITABLE_DRAFT_STATUSES.has(status);
}

export async function assertStaffEditableRegistration(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<void> {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  if (registration.status === 'cancelled') {
    throw new RegistrationPriorityEditValidationError({
      registration: 'Cancelled registrations cannot be edited.',
    });
  }
  if (STAFF_NON_EDITABLE_DRAFT_STATUSES.has(registration.status)) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'Only submitted registrations can be edited by staff.',
    });
  }
  if (!STAFF_EDITABLE_REGISTRATION_STATUSES.has(registration.status)) {
    throw new RegistrationPriorityEditValidationError({
      registration: 'This registration cannot be edited right now.',
    });
  }
}

export async function assertRegistrationEditableForLeagueOrMembership(
  actor: Member,
  registration: RegistrationShellRow,
): Promise<void> {
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  if (memberCanManageRegistrations(actor)) {
    // Staff may assist in-progress shell drafts through league and membership steps.
    if (registration.status === 'shell_complete') {
      return;
    }
    await assertStaffEditableRegistration(actor, registration);
    return;
  }
  if (registration.status === 'shell_complete') {
    return;
  }
  await assertPriorityEditableRegistration(actor, registration);
}

export async function cancelStaffRegistration(input: {
  registrationId: number;
  actor: Member;
}): Promise<{ registrationId: number; refundIssued: boolean }> {
  if (!memberCanManageRegistrations(input.actor)) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  if (registration.status === 'cancelled') {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration is already cancelled.' });
  }
  if (STAFF_NON_EDITABLE_DRAFT_STATUSES.has(registration.status)) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Only submitted registrations can be cancelled.' });
  }
  return cancelMemberRegistrationCore(input);
}

export async function cancelMemberRegistration(input: {
  registrationId: number;
  actor: Member;
}): Promise<{ registrationId: number; refundIssued: boolean }> {
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }
  await assertPriorityCancellableRegistration(input.actor, registration);
  return cancelMemberRegistrationCore(input);
}

async function cancelMemberRegistrationCore(input: {
  registrationId: number;
  actor: Member;
}): Promise<{ registrationId: number; refundIssued: boolean }> {
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) {
    throw new RegistrationPriorityEditValidationError({ registration: 'Registration was not found.' });
  }

  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, input.registrationId))
    .orderBy(sql`${schema.registrationInvoices.updated_at} DESC`, sql`${schema.registrationInvoices.id} DESC`)
    .limit(1);

  let refundIssued = false;
  let amountRefundedMinor: number | null = null;
  let paymentReference: string | null = null;
  if (invoice?.payment_order_id) {
    const [order] = await db
      .select()
      .from(schema.paymentOrders)
      .where(eq(schema.paymentOrders.id, invoice.payment_order_id))
      .limit(1);
    if (order?.status === 'succeeded') {
      amountRefundedMinor = order.amount_minor;
      paymentReference = `Payment order ${order.id}`;
      try {
        await createPaymentService().createRefundForOrder({
          orderId: order.id,
          amountMinor: order.amount_minor,
          reason: 'Registration cancelled during priority registration',
          requestedByMemberId: input.actor.id,
        });
        refundIssued = true;
      } catch {
        await db.insert(schema.refunds).values({
          payment_order_id: order.id,
          provider: order.provider,
          amount_minor: order.amount_minor,
          currency: order.currency,
          reason: 'Registration cancelled during priority registration',
          status: 'requested',
          requested_by_member_id: input.actor.id,
        });
        refundIssued = true;
      }
    }
  }

  await db.transaction(async (tx) => {
    if (registration.curler_member_id) {
      const sessionWaitlists = await tx
        .select({
          entry: schema.waitlistEntries,
          leagueId: schema.leagues.id,
        })
        .from(schema.waitlistEntries)
        .innerJoin(schema.leagueWaitlists, eq(schema.waitlistEntries.waitlist_id, schema.leagueWaitlists.id))
        .innerJoin(
          schema.leagues,
          and(
            eq(schema.leagues.waitlist_id, schema.waitlistEntries.waitlist_id),
            eq(schema.leagues.session_id, registration.session_id),
          ),
        )
        .where(
          and(
            eq(schema.waitlistEntries.member_id, registration.curler_member_id),
            eq(schema.waitlistEntries.status, 'active'),
            eq(schema.waitlistEntries.source_registration_id, input.registrationId),
          ),
        );

      const [curler] = registration.curler_member_id
        ? await tx
            .select({
              name: schema.members.name,
              first_name: schema.members.first_name,
              last_name: schema.members.last_name,
              email: schema.members.email,
            })
            .from(schema.members)
            .where(eq(schema.members.id, registration.curler_member_id))
            .limit(1)
        : [null];
      const [actor] = await tx
        .select({
          name: schema.members.name,
          first_name: schema.members.first_name,
          last_name: schema.members.last_name,
          email: schema.members.email,
        })
        .from(schema.members)
        .where(eq(schema.members.id, input.actor.id))
        .limit(1);

      for (const row of sessionWaitlists) {
        await recordAndDeleteWaitlistEntry(tx, {
          entry: row.entry,
          leagueId: row.leagueId,
          actorMemberId: input.actor.id,
          source: 'registration_submission',
          reason: 'REGISTRATION_CANCELLED_BY_MEMBER',
          metadata: { sourceRegistrationId: input.registrationId },
          memberName: curler ? waitlistMemberDisplayName(curler) : null,
          actorMemberName: actor ? waitlistMemberDisplayName(actor) : null,
        });
      }

      await tx
        .update(schema.curlingLeagueSabbaticals)
        .set({
          status: 'released',
          released_at: sql`CURRENT_TIMESTAMP`,
          released_reason: 'REGISTRATION_CANCELLED_BY_MEMBER',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(schema.curlingLeagueSabbaticals.member_id, registration.curler_member_id),
            eq(schema.curlingLeagueSabbaticals.source_registration_id, input.registrationId),
            eq(schema.curlingLeagueSabbaticals.status, 'active'),
          ),
        );

      await removeAllRegistrationRosterPlacements({
        tx,
        registrationId: input.registrationId,
        curlerMemberId: registration.curler_member_id,
      });
    }

    await tx
      .update(schema.registrationSelections)
      .set({ status: 'dropped', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.registrationSelections.registration_id, input.registrationId));

    if (invoice) {
      await tx
        .update(schema.registrationInvoices)
        .set({
          status: refundIssued ? 'refunded' : invoice.status === 'paid' ? 'refunded' : 'cancelled',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, invoice.id));
    }

    await tx
      .update(schema.seasonMemberships)
      .set({
        status: refundIssued ? 'refunded' : 'cancelled',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.seasonMemberships.source_registration_id, input.registrationId),
          inArray(schema.seasonMemberships.status, ['pending', 'active']),
        ),
      );

    await tx
      .update(schema.curlingIcePrivileges)
      .set({
        status: 'cancelled',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.curlingIcePrivileges.source_registration_id, input.registrationId),
          inArray(schema.curlingIcePrivileges.status, ['pending', 'active']),
        ),
      );

    await tx
      .update(schema.curlingRegistrations)
      .set({
        status: 'cancelled',
        cancelled_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
  });

  await sendRegistrationCancelledByMemberEmail({
    registrationId: input.registrationId,
    refundIssued,
    amountRefundedMinor,
    paymentReference,
  });

  return { registrationId: input.registrationId, refundIssued };
}
