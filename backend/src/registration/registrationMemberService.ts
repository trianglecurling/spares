import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { canActorImpersonateTarget, listAccountSwitchOptions } from '../services/accountAccess.js';
import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { canViewOrEditRegistration, getRegistrationById } from './registrationShellService.js';
import { listRegistrationOutboundMessages, sendRegistrationEmailForDashboard } from './registrationEmailService.js';

export class RegistrationMemberValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration member operation failed');
  }
}

function dbValue(value: unknown): never {
  return value as never;
}

function textJsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function dbNow(): never {
  return dbValue(getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString());
}

function memberName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'Unknown curler';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
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

async function actorManagedMemberIds(actor: Member): Promise<number[]> {
  if (isAdmin(actor) || isServerAdmin(actor)) {
    const { db, schema } = getDrizzleDb();
    const rows = await db.select({ id: schema.members.id }).from(schema.members);
    return rows.map((row) => row.id);
  }
  const options = await listAccountSwitchOptions(actor.id);
  return [...new Set([actor.id, ...options.map((option) => option.id)])];
}

async function waitlistPosition(leagueId: number, entryId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.waitlistEntries.id })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.league_id, leagueId), eq(schema.waitlistEntries.status, 'active')))
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));
  const index = rows.findIndex((row) => row.id === entryId);
  return index >= 0 ? index + 1 : null;
}

export async function listMemberRegistrationSummaries(actor: Member, seasonId?: number) {
  const ids = await actorManagedMemberIds(actor);
  if (ids.length === 0) return { registrations: [] };
  const { db, schema } = getDrizzleDb();
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
      seasonName: schema.curlingSeasons.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
    .innerJoin(schema.curlingSessions, eq(schema.curlingRegistrations.session_id, schema.curlingSessions.id))
    .where(and(
      inArray(schema.curlingRegistrations.curler_member_id, ids),
      seasonId ? eq(schema.curlingRegistrations.season_id, seasonId) : sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`
    ))
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));

  const registrations = [];
  for (const row of rows) {
    const [invoice] = await db
      .select()
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, row.id))
      .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
      .limit(1);
    const order = invoice?.payment_order_id
      ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
      : null;
    registrations.push({
      id: row.id,
      curlerId: row.curlerId,
      curlerName: memberName({
        name: row.curlerName,
        first_name: row.curlerFirstName,
        last_name: row.curlerLastName,
      }),
      seasonName: row.seasonName,
      sessionName: row.sessionName,
      registrationStatus: row.status,
      paymentStatus: invoice?.status ?? (row.status === 'confirmed' ? 'paid' : 'not_required'),
      membershipOption: row.membershipOption,
      amountDueMinor: invoice?.total_minor ?? null,
      paymentLink: order?.status === 'pending' ? hostedCheckoutUrl(order.metadata) : null,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    });
  }
  return { registrations };
}

export async function getMemberRegistrationDetail(registrationId: number, actor: Member) {
  const shellRegistration = await getRegistrationById(registrationId);
  if (!shellRegistration || !(await canViewOrEditRegistration(actor, shellRegistration))) {
    throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  }
  const { db, schema } = getDrizzleDb();
  const [registration] = await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, registrationId)).limit(1);
  if (!registration) throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const [season] = await db.select().from(schema.curlingSeasons).where(eq(schema.curlingSeasons.id, registration.season_id)).limit(1);
  const [session] = await db.select().from(schema.curlingSessions).where(eq(schema.curlingSessions.id, registration.session_id)).limit(1);
  const selections = await db
    .select({
      id: schema.registrationSelections.id,
      selectionType: schema.registrationSelections.selection_type,
      status: schema.registrationSelections.status,
      rank: schema.registrationSelections.rank,
      leagueId: schema.registrationSelections.league_id,
      replacesLeagueId: schema.registrationSelections.replaces_league_id,
      isTemporarySabbaticalFill: schema.registrationSelections.is_temporary_sabbatical_fill,
      byotTeammateText: schema.registrationSelections.byot_teammate_text,
      leagueName: schema.leagues.name,
    })
    .from(schema.registrationSelections)
    .leftJoin(schema.leagues, eq(schema.registrationSelections.league_id, schema.leagues.id))
    .where(eq(schema.registrationSelections.registration_id, registrationId))
    .orderBy(asc(schema.registrationSelections.rank), asc(schema.registrationSelections.id));
  const waitlists = registration.curler_member_id
    ? await db
        .select({
          id: schema.waitlistEntries.id,
          leagueId: schema.waitlistEntries.league_id,
          entryType: schema.waitlistEntries.entry_type,
          replacesLeagueId: schema.waitlistEntries.replaces_league_id,
          declineCount: schema.waitlistEntries.decline_count,
          status: schema.waitlistEntries.status,
          rolledOverFromWaitlistEntryId: schema.waitlistEntries.rolled_over_from_waitlist_entry_id,
          leagueName: schema.leagues.name,
        })
        .from(schema.waitlistEntries)
        .innerJoin(schema.leagues, eq(schema.waitlistEntries.league_id, schema.leagues.id))
        .where(and(
          eq(schema.waitlistEntries.member_id, registration.curler_member_id),
          eq(schema.waitlistEntries.status, 'active')
        ))
        .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id))
    : [];
  const waitlistDetails = await Promise.all(waitlists.map(async (entry) => ({
    ...entry,
    position: await waitlistPosition(entry.leagueId, entry.id),
  })));
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  const order = invoice?.payment_order_id
    ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
    : null;
  return {
    registration: {
      id: registration.id,
      curlerId: registration.curler_member_id,
      curlerName: memberName(curler),
      seasonName: season?.name ?? null,
      sessionName: session?.name ?? null,
      registrationStatus: registration.status,
      membershipOption: registration.membership_option,
      submittedAt: registration.submitted_at,
      updatedAt: registration.updated_at,
      studentDiscountClaimed: registration.student_discount_claimed === 1,
      reciprocalDiscountClaimed: registration.reciprocal_discount_claimed === 1,
    },
    selections,
    waitlists: waitlistDetails,
    payment: {
      status: invoice?.status ?? (registration.status === 'confirmed' ? 'paid' : 'not_required'),
      amountDueMinor: invoice?.total_minor ?? null,
      amountPaidMinor: invoice?.status === 'paid' ? invoice.total_minor : null,
      paymentLink: order?.status === 'pending' ? hostedCheckoutUrl(order.metadata) : null,
      deferredReason: invoice?.deferred_reason ?? null,
    },
    communications: await listRegistrationOutboundMessages({ registrationId, limit: 25 }),
  };
}

export async function removeMemberWaitlistEntry(input: { entryId: number; actor: Member }) {
  const { db, schema } = getDrizzleDb();
  const [entry] = await db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, input.entryId)).limit(1);
  if (!entry || entry.status !== 'active') {
    throw new RegistrationMemberValidationError({ waitlistEntry: 'Active waitlist entry was not found.' });
  }
  const allowed = isAdmin(input.actor) || isServerAdmin(input.actor) || await canActorImpersonateTarget(input.actor.id, entry.member_id);
  if (!allowed) {
    throw new RegistrationMemberValidationError({ waitlistEntry: 'You do not have access to remove this waitlist entry.' });
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.waitlistEntries)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, entry.id));
    await tx.insert(schema.waitlistAuditEvents).values({
      waitlist_entry_id: entry.id,
      league_id: entry.league_id,
      member_id: entry.member_id,
      actor_member_id: input.actor.id,
      source: isAdmin(input.actor) || isServerAdmin(input.actor) ? 'staff_action' : 'member_self',
      action: 'entry_removed',
      reason: 'WAITLIST_REMOVED_BY_MEMBER',
      before_json: textJsonValue(entry),
      after_json: textJsonValue({ ...entry, status: 'removed' }),
      metadata_json: textJsonValue({ sourceRegistrationId: entry.source_registration_id }),
      created_at: dbNow(),
    });
  });
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, entry.league_id)).limit(1);
  if (member?.email) {
    await sendRegistrationEmailForDashboard({
      messageType: 'waitlist_removed_by_member',
      recipientEmail: member.email,
      recipientName: memberName(member),
      recipientMemberId: member.id,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: league?.name,
      },
    });
  }
  return { entryId: entry.id, status: 'removed' };
}
