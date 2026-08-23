import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import { ageOnDate } from './registrationAgeExperience.js';
import { DRAFT_REGISTRATION_STATUSES } from './registrationDraftProgress.js';
import { RegistrationStaffValidationError } from './registrationStaffService.js';
import { loadActiveWaitlistEntryCountsByLeagueId } from './waitlistEntityService.js';
import { loadLeagueVacancyCountsByLeagueId } from './waitlistStaffService.js';

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

const ACTIVE_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

/** Age cutoff requested for the admin session summary: under 21 vs 21 and over. */
export const SESSION_STATS_JUNIOR_AGE = 21;

export type StaffRegistrationStatRow = {
  id: number;
  status: string;
  membershipOption: string;
  desiredLeagueCount: number | null;
  dateOfBirth: string | null;
  returningMemberAnswer: number | null;
  studentDiscountClaimed: number;
  reciprocalDiscountClaimed: number;
  invoiceStatus: string | null;
  invoiceTotalMinor: number | null;
  invoiceDeferred: boolean;
};

export type StaffRegistrationLeagueStatRow = {
  capacityValue: number;
  confirmedPlacements: number;
  permanentVacancies: number;
  activeWaitlistEntries: number;
  pendingOffers: number;
};

export type StaffRegistrationStats = {
  sessionId: number;
  seasonName: string;
  sessionName: string;
  registrations: {
    total: number;
    canceled: number;
    inProgressDrafts: number;
    byStatus: {
      submitted: number;
      awaitingStaffReview: number;
      awaitingPlacement: number;
      awaitingPayment: number;
      paymentStarted: number;
      paid: number;
      confirmed: number;
    };
  };
  payment: {
    paid: number;
    unpaid: number;
    deferred: number;
    collectedMinor: number;
    expectedMinor: number;
    outstandingMinor: number;
  };
  membership: {
    regular: number;
    social: number;
    juniorRecreational: number;
    spareOnly: number;
    none: number;
  };
  age: {
    junior: number;
    adult: number;
    unknown: number;
  };
  members: {
    newMembers: number;
    returningMembers: number;
    unknown: number;
  };
  leagues: {
    requested: number;
    availableSpots: number;
    filledSpots: number;
    openSpots: number;
    waitlistEntries: number;
    pendingOffers: number;
  };
  attention: {
    awaitingStaffReview: number;
    awaitingPlacement: number;
    pendingFinancialAssistance: number;
    studentDiscounts: number;
    reciprocalDiscounts: number;
  };
};

function assertStaffAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationStaffValidationError({ registration: 'You do not have permission to manage registrations.' });
  }
}

function isActiveStatus(status: string): boolean {
  return (ACTIVE_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

function dateOfBirthString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

function invoiceUpdatedMs(value: Date | string | null): number {
  if (value == null) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isNaN(time) ? 0 : time;
}

function latestInvoiceByRegistrationId<T extends { registrationId: number; updatedAt: Date | string | null; id: number }>(
  invoices: T[],
): Map<number, T> {
  const latest = new Map<number, T>();
  for (const invoice of invoices) {
    const current = latest.get(invoice.registrationId);
    if (!current) {
      latest.set(invoice.registrationId, invoice);
      continue;
    }
    const currentUpdated = invoiceUpdatedMs(current.updatedAt);
    const nextUpdated = invoiceUpdatedMs(invoice.updatedAt);
    if (nextUpdated > currentUpdated || (nextUpdated === currentUpdated && invoice.id > current.id)) {
      latest.set(invoice.registrationId, invoice);
    }
  }
  return latest;
}

export function summarizeStaffRegistrationStats(input: {
  rows: StaffRegistrationStatRow[];
  leagues: StaffRegistrationLeagueStatRow[];
  inProgressDrafts: number;
  pendingFinancialAssistance: number;
  asOfDate: string;
}): Omit<StaffRegistrationStats, 'sessionId' | 'seasonName' | 'sessionName'> {
  const byStatus = {
    submitted: 0,
    awaitingStaffReview: 0,
    awaitingPlacement: 0,
    awaitingPayment: 0,
    paymentStarted: 0,
    paid: 0,
    confirmed: 0,
  };
  let canceled = 0;
  let paid = 0;
  let unpaid = 0;
  let deferred = 0;
  let collectedMinor = 0;
  let expectedMinor = 0;
  const membership = {
    regular: 0,
    social: 0,
    juniorRecreational: 0,
    spareOnly: 0,
    none: 0,
  };
  const age = { junior: 0, adult: 0, unknown: 0 };
  const members = { newMembers: 0, returningMembers: 0, unknown: 0 };
  let requested = 0;
  let studentDiscounts = 0;
  let reciprocalDiscounts = 0;

  for (const row of input.rows) {
    if (row.status === 'cancelled') {
      canceled += 1;
      continue;
    }
    if (!isActiveStatus(row.status)) continue;

    if (row.status === 'awaiting_staff_review') byStatus.awaitingStaffReview += 1;
    else if (row.status === 'awaiting_placement') byStatus.awaitingPlacement += 1;
    else if (row.status === 'awaiting_payment') byStatus.awaitingPayment += 1;
    else if (row.status === 'payment_started') byStatus.paymentStarted += 1;
    else if (row.status === 'paid') byStatus.paid += 1;
    else if (row.status === 'confirmed') byStatus.confirmed += 1;
    else byStatus.submitted += 1;

    const invoicePaid = row.invoiceStatus === 'paid';
    if (invoicePaid) paid += 1;
    else unpaid += 1;
    if (row.invoiceDeferred && !invoicePaid) deferred += 1;

    const invoiceTotal = row.invoiceTotalMinor ?? 0;
    if (row.invoiceStatus != null) {
      expectedMinor += invoiceTotal;
      if (invoicePaid) collectedMinor += invoiceTotal;
    }

    if (row.membershipOption === 'social') membership.social += 1;
    else if (row.membershipOption === 'junior_recreational') membership.juniorRecreational += 1;
    else if (row.membershipOption === 'regular_spare_only') {
      membership.regular += 1;
      membership.spareOnly += 1;
    } else if (row.membershipOption === 'regular') membership.regular += 1;
    else membership.none += 1;

    const years = row.dateOfBirth ? ageOnDate(row.dateOfBirth, input.asOfDate) : null;
    if (years == null || !Number.isFinite(years)) age.unknown += 1;
    else if (years < SESSION_STATS_JUNIOR_AGE) age.junior += 1;
    else age.adult += 1;

    if (row.returningMemberAnswer === 1) members.returningMembers += 1;
    else if (row.returningMemberAnswer === 0) members.newMembers += 1;
    else members.unknown += 1;

    requested += Math.max(0, row.desiredLeagueCount ?? 0);
    if (row.studentDiscountClaimed === 1) studentDiscounts += 1;
    if (row.reciprocalDiscountClaimed === 1) reciprocalDiscounts += 1;
  }

  const leagues = input.leagues.reduce(
    (totals, league) => ({
      availableSpots: totals.availableSpots + Math.max(0, league.capacityValue),
      filledSpots: totals.filledSpots + Math.max(0, league.confirmedPlacements),
      openSpots: totals.openSpots + Math.max(0, league.permanentVacancies),
      waitlistEntries: totals.waitlistEntries + Math.max(0, league.activeWaitlistEntries),
      pendingOffers: totals.pendingOffers + Math.max(0, league.pendingOffers),
    }),
    { availableSpots: 0, filledSpots: 0, openSpots: 0, waitlistEntries: 0, pendingOffers: 0 },
  );

  const total = paid + unpaid;
  return {
    registrations: {
      total,
      canceled,
      inProgressDrafts: input.inProgressDrafts,
      byStatus,
    },
    payment: {
      paid,
      unpaid,
      deferred,
      collectedMinor,
      expectedMinor,
      outstandingMinor: Math.max(0, expectedMinor - collectedMinor),
    },
    membership,
    age,
    members,
    leagues: {
      requested,
      ...leagues,
    },
    attention: {
      awaitingStaffReview: byStatus.awaitingStaffReview,
      awaitingPlacement: byStatus.awaitingPlacement,
      pendingFinancialAssistance: input.pendingFinancialAssistance,
      studentDiscounts,
      reciprocalDiscounts,
    },
  };
}

export async function getStaffRegistrationStats(input: { actor: Member; sessionId: number }): Promise<StaffRegistrationStats> {
  assertStaffAccess(input.actor);
  const { db, schema } = getDrizzleDb();

  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationStaffValidationError({ sessionId: 'Session not found.' });
  }

  const registrationRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      membershipOption: schema.curlingRegistrations.membership_option,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
      returningMemberAnswer: schema.curlingRegistrations.returning_member_answer,
      studentDiscountClaimed: schema.curlingRegistrations.student_discount_claimed,
      reciprocalDiscountClaimed: schema.curlingRegistrations.reciprocal_discount_claimed,
      dateOfBirth: schema.members.date_of_birth,
    })
    .from(schema.curlingRegistrations)
    .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, input.sessionId),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...LISTABLE_REGISTRATION_STATUSES]),
      ),
    );

  const registrationIds = registrationRows.map((row) => row.id);
  const invoices = registrationIds.length
    ? await db
        .select({
          id: schema.registrationInvoices.id,
          registrationId: schema.registrationInvoices.registration_id,
          status: schema.registrationInvoices.status,
          totalMinor: schema.registrationInvoices.total_minor,
          deferred: schema.registrationInvoices.deferred,
          updatedAt: schema.registrationInvoices.updated_at,
        })
        .from(schema.registrationInvoices)
        .where(inArray(schema.registrationInvoices.registration_id, registrationIds))
        .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    : [];
  const latestInvoices = latestInvoiceByRegistrationId(invoices);

  const [draftCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, input.sessionId),
        inArray(schema.curlingRegistrations.status, [...DRAFT_REGISTRATION_STATUSES]),
      ),
    );

  const activeRegistrationIds = registrationRows
    .filter((row) => isActiveStatus(row.status))
    .map((row) => row.id);
  const [assistanceCountRow] = activeRegistrationIds.length
    ? await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.financialAssistanceRequests)
        .where(
          and(
            inArray(schema.financialAssistanceRequests.registration_id, activeRegistrationIds),
            eq(schema.financialAssistanceRequests.status, 'pending'),
          ),
        )
    : [{ count: 0 }];

  const leagues = await db
    .select({
      id: schema.leagues.id,
      capacityValue: schema.leagues.capacity_value,
    })
    .from(schema.leagues)
    .where(and(eq(schema.leagues.league_type, 'standard'), eq(schema.leagues.session_id, input.sessionId)));
  const leagueIds = leagues.map((league) => league.id);
  const [vacancies, waitlistCounts, rosterRows, offerRows] = await Promise.all([
    loadLeagueVacancyCountsByLeagueId(leagues.map((league) => ({ id: league.id, capacityValue: league.capacityValue ?? 0 }))),
    loadActiveWaitlistEntryCountsByLeagueId(leagueIds),
    leagueIds.length
      ? db
          .select({
            leagueId: schema.leagueRoster.league_id,
            total: sql<number>`count(*)`,
          })
          .from(schema.leagueRoster)
          .where(and(inArray(schema.leagueRoster.league_id, leagueIds), eq(schema.leagueRoster.status, 'active')))
          .groupBy(schema.leagueRoster.league_id)
      : Promise.resolve([]),
    leagueIds.length
      ? db
          .select({
            leagueId: schema.waitlistOffers.league_id,
            total: sql<number>`count(*)`,
          })
          .from(schema.waitlistOffers)
          .where(and(inArray(schema.waitlistOffers.league_id, leagueIds), eq(schema.waitlistOffers.status, 'pending')))
          .groupBy(schema.waitlistOffers.league_id)
      : Promise.resolve([]),
  ]);
  const rosterByLeague = new Map(rosterRows.map((row) => [row.leagueId, Number(row.total ?? 0)]));
  const offersByLeague = new Map(offerRows.map((row) => [row.leagueId, Number(row.total ?? 0)]));

  const asOfDate = new Date().toISOString().slice(0, 10);
  const summary = summarizeStaffRegistrationStats({
    rows: registrationRows.map((row) => {
      const invoice = latestInvoices.get(row.id);
      return {
        id: row.id,
        status: row.status,
        membershipOption: row.membershipOption,
        desiredLeagueCount: row.desiredLeagueCount,
        dateOfBirth: dateOfBirthString(row.dateOfBirth),
        returningMemberAnswer: row.returningMemberAnswer,
        studentDiscountClaimed: row.studentDiscountClaimed ?? 0,
        reciprocalDiscountClaimed: row.reciprocalDiscountClaimed ?? 0,
        invoiceStatus: invoice?.status ?? null,
        invoiceTotalMinor: invoice?.totalMinor ?? null,
        invoiceDeferred: Number(invoice?.deferred ?? 0) === 1,
      };
    }),
    leagues: leagues.map((league) => ({
      capacityValue: league.capacityValue ?? 0,
      confirmedPlacements: rosterByLeague.get(league.id) ?? 0,
      permanentVacancies: vacancies.get(league.id)?.permanentVacancies ?? 0,
      activeWaitlistEntries: waitlistCounts.get(league.id) ?? 0,
      pendingOffers: offersByLeague.get(league.id) ?? 0,
    })),
    inProgressDrafts: Number(draftCountRow?.count ?? 0),
    pendingFinancialAssistance: Number(assistanceCountRow?.count ?? 0),
    asOfDate,
  });

  return {
    sessionId: session.id,
    seasonName: session.seasonName,
    sessionName: session.name,
    ...summary,
  };
}
