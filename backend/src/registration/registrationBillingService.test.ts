import { describe, expect, test } from 'bun:test';
import { refundDueMinor } from './registrationBillingMath.js';
import {
  addSabbaticalSelectionsForBilling,
  resolveBillingRegistrationIdForSabbatical,
} from './registrationBillingService.js';
import type { RegistrationSelectionInput } from './registrationContext.js';

describe('resolveBillingRegistrationIdForSabbatical', () => {
  test('prefers the sabbatical source registration when it is in the billing set', () => {
    expect(
      resolveBillingRegistrationIdForSabbatical({
        sourceRegistrationId: 212,
        memberId: 137,
        registrationIds: new Set([212, 400]),
        registrationsByMember: new Map([[137, [400, 212]]]),
      }),
    ).toBe(212);
  });

  test('falls back to the member’s first billed registration', () => {
    expect(
      resolveBillingRegistrationIdForSabbatical({
        sourceRegistrationId: 999,
        memberId: 137,
        registrationIds: new Set([212]),
        registrationsByMember: new Map([[137, [212]]]),
      }),
    ).toBe(212);
  });

  test('returns null when the member has no billed registration', () => {
    expect(
      resolveBillingRegistrationIdForSabbatical({
        sourceRegistrationId: null,
        memberId: 137,
        registrationIds: new Set(),
        registrationsByMember: new Map(),
      }),
    ).toBeNull();
  });
});

describe('addSabbaticalSelectionsForBilling', () => {
  test('adds a staff sabbatical that has no registration selection', () => {
    const selections = new Map<number, RegistrationSelectionInput[]>();
    addSabbaticalSelectionsForBilling(selections, [{ registrationId: 212, leagueId: 21 }]);
    expect(selections.get(212)).toEqual([{ selectionType: 'sabbatical', leagueId: 21 }]);
  });

  test('does not duplicate an existing sabbatical selection', () => {
    const selections = new Map<number, RegistrationSelectionInput[]>([
      [212, [{ selectionType: 'sabbatical', leagueId: 21 }]],
    ]);
    addSabbaticalSelectionsForBilling(selections, [{ registrationId: 212, leagueId: 21 }]);
    expect(selections.get(212)).toEqual([{ selectionType: 'sabbatical', leagueId: 21 }]);
  });

  test('nets a $20 sabbatical against a $125 unused-league overpayment', () => {
    const leagueFeeMinor = 12500;
    const sabbaticalFeeMinor = 2000;
    const paidMinor = leagueFeeMinor * 2;
    const owedWithoutSabbatical = leagueFeeMinor;
    const owedWithSabbatical = leagueFeeMinor + sabbaticalFeeMinor;

    expect(refundDueMinor(owedWithoutSabbatical, paidMinor)).toBe(12500);
    expect(refundDueMinor(owedWithSabbatical, paidMinor)).toBe(10500);
  });
});
