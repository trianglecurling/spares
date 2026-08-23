import { describe, expect, test } from 'bun:test';
import {
  SESSION_STATS_JUNIOR_AGE,
  summarizeStaffRegistrationStats,
  type StaffRegistrationStatRow,
} from './registrationStaffStats.js';

function row(overrides: Partial<StaffRegistrationStatRow> = {}): StaffRegistrationStatRow {
  return {
    id: 1,
    status: 'confirmed',
    membershipOption: 'regular',
    desiredLeagueCount: 2,
    dateOfBirth: '1990-01-01',
    returningMemberAnswer: 1,
    studentDiscountClaimed: 0,
    reciprocalDiscountClaimed: 0,
    invoiceStatus: 'paid',
    invoiceTotalMinor: 25000,
    invoiceDeferred: false,
    ...overrides,
  };
}

describe('summarizeStaffRegistrationStats', () => {
  test('counts paid and unpaid among active registrations and excludes canceled', () => {
    const summary = summarizeStaffRegistrationStats({
      rows: [
        row({ id: 1, invoiceStatus: 'paid', invoiceTotalMinor: 20000 }),
        row({ id: 2, status: 'awaiting_payment', invoiceStatus: 'awaiting_payment', invoiceTotalMinor: 15000 }),
        row({ id: 3, status: 'cancelled', invoiceStatus: 'cancelled', invoiceTotalMinor: 18000 }),
      ],
      leagues: [],
      inProgressDrafts: 4,
      pendingFinancialAssistance: 1,
      asOfDate: '2026-08-23',
    });

    expect(summary.registrations.total).toBe(2);
    expect(summary.registrations.canceled).toBe(1);
    expect(summary.registrations.inProgressDrafts).toBe(4);
    expect(summary.payment.paid).toBe(1);
    expect(summary.payment.unpaid).toBe(1);
    expect(summary.payment.collectedMinor).toBe(20000);
    expect(summary.payment.expectedMinor).toBe(35000);
    expect(summary.payment.outstandingMinor).toBe(15000);
    expect(summary.attention.pendingFinancialAssistance).toBe(1);
  });

  test('breaks membership into regular, social, and junior recreational', () => {
    const summary = summarizeStaffRegistrationStats({
      rows: [
        row({ id: 1, membershipOption: 'regular' }),
        row({ id: 2, membershipOption: 'regular_spare_only' }),
        row({ id: 3, membershipOption: 'social' }),
        row({ id: 4, membershipOption: 'junior_recreational' }),
        row({ id: 5, membershipOption: 'none' }),
      ],
      leagues: [],
      inProgressDrafts: 0,
      pendingFinancialAssistance: 0,
      asOfDate: '2026-08-23',
    });

    expect(summary.membership.regular).toBe(2);
    expect(summary.membership.spareOnly).toBe(1);
    expect(summary.membership.social).toBe(1);
    expect(summary.membership.juniorRecreational).toBe(1);
    expect(summary.membership.none).toBe(1);
  });

  test(`treats ages under ${SESSION_STATS_JUNIOR_AGE} as junior and 21 and over as adult`, () => {
    const summary = summarizeStaffRegistrationStats({
      rows: [
        row({ id: 1, dateOfBirth: '2010-08-24' }),
        row({ id: 2, dateOfBirth: '2005-08-24' }),
        row({ id: 3, dateOfBirth: '2005-08-23' }),
        row({ id: 4, dateOfBirth: null }),
      ],
      leagues: [],
      inProgressDrafts: 0,
      pendingFinancialAssistance: 0,
      asOfDate: '2026-08-23',
    });

    expect(summary.age.junior).toBe(2);
    expect(summary.age.adult).toBe(1);
    expect(summary.age.unknown).toBe(1);
  });

  test('sums desired league counts against waitlist-style league capacity', () => {
    const summary = summarizeStaffRegistrationStats({
      rows: [
        row({ id: 1, desiredLeagueCount: 2 }),
        row({ id: 2, desiredLeagueCount: 1 }),
        row({ id: 3, desiredLeagueCount: null }),
        row({ id: 4, status: 'cancelled', desiredLeagueCount: 4 }),
      ],
      leagues: [
        {
          capacityValue: 40,
          confirmedPlacements: 28,
          permanentVacancies: 8,
          activeWaitlistEntries: 5,
          pendingOffers: 2,
        },
        {
          capacityValue: 16,
          confirmedPlacements: 16,
          permanentVacancies: 0,
          activeWaitlistEntries: 3,
          pendingOffers: 0,
        },
      ],
      inProgressDrafts: 0,
      pendingFinancialAssistance: 0,
      asOfDate: '2026-08-23',
    });

    expect(summary.leagues.requested).toBe(3);
    expect(summary.leagues.availableSpots).toBe(56);
    expect(summary.leagues.filledSpots).toBe(44);
    expect(summary.leagues.openSpots).toBe(8);
    expect(summary.leagues.waitlistEntries).toBe(8);
    expect(summary.leagues.pendingOffers).toBe(2);
  });

  test('counts deferred invoices and new versus returning members', () => {
    const summary = summarizeStaffRegistrationStats({
      rows: [
        row({
          id: 1,
          status: 'awaiting_placement',
          invoiceStatus: 'deferred',
          invoiceTotalMinor: 12000,
          invoiceDeferred: true,
          returningMemberAnswer: 0,
          studentDiscountClaimed: 1,
        }),
        row({
          id: 2,
          returningMemberAnswer: 1,
          reciprocalDiscountClaimed: 1,
        }),
        row({ id: 3, returningMemberAnswer: null }),
      ],
      leagues: [],
      inProgressDrafts: 0,
      pendingFinancialAssistance: 0,
      asOfDate: '2026-08-23',
    });

    expect(summary.payment.deferred).toBe(1);
    expect(summary.members.newMembers).toBe(1);
    expect(summary.members.returningMembers).toBe(1);
    expect(summary.members.unknown).toBe(1);
    expect(summary.attention.studentDiscounts).toBe(1);
    expect(summary.attention.reciprocalDiscounts).toBe(1);
    expect(summary.registrations.byStatus.awaitingPlacement).toBe(1);
  });
});
