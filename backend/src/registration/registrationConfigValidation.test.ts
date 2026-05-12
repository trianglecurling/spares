import { describe, expect, test } from 'bun:test';
import {
  RegistrationConfigValidationError,
  assertNoLeagueContinuityCycle,
  assertRegistrationStateTransition,
  assertSessionWithinSeason,
  assertValidLeagueRegistrationSettings,
  assertValidPriceConfig,
  assertValidRegistrationDiscountSettingsStored,
  effectiveLeagueRegistrationFeeMinor,
} from './registrationConfigValidation.js';

function expectValidationError(fn: () => void, field: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RegistrationConfigValidationError);
    expect((error as RegistrationConfigValidationError).details[field]).toBeString();
    return;
  }
  throw new Error('Expected validation error');
}

describe('registration configuration validation', () => {
  test('accepts valid registration state transition timestamps', () => {
    expect(() => assertRegistrationStateTransition({ effectiveAt: '2026-08-15T16:00:00.000Z' })).not.toThrow();
  });

  test('rejects empty registration state transition timestamps', () => {
    expectValidationError(() => assertRegistrationStateTransition({ effectiveAt: '   ' }), 'effectiveAt');
  });

  test('rejects sessions outside the selected season', () => {
    expectValidationError(
      () =>
        assertSessionWithinSeason({
          selectedSeasonId: 1,
          sessionSeasonId: 2,
          sessionStartDate: '2026-08-31',
          sessionEndDate: '2026-12-15',
          seasonStartDate: '2026-09-01',
          seasonEndDate: '2027-05-31',
        }),
      'sessionId'
    );
  });

  test('rejects invalid BYOT league settings', () => {
    expectValidationError(
      () =>
        assertValidLeagueRegistrationSettings({
          id: 10,
          leagueType: 'bring_your_own_team',
          capacityType: 'individual',
          capacityValue: 24,
          registrationFeeOverrideMinor: 5000,
          allowsWaitlist: true,
          allowsSabbatical: true,
        }),
      'allowsWaitlist'
    );
  });

  test('rejects circular league continuity chains', () => {
    expectValidationError(
      () =>
        assertNoLeagueContinuityCycle([
          { id: 1, predecessorLeagueId: 3 },
          { id: 2, predecessorLeagueId: 1 },
          { id: 3, predecessorLeagueId: 2 },
        ]),
      'predecessorLeagueId'
    );
  });

  test('rejects negative price amounts', () => {
    expectValidationError(
      () =>
        assertValidPriceConfig({
          regularMembershipFeeMinor: 10000,
          socialMembershipFeeMinor: -1,
          spareOnlyIcePrivilegeFeeMinor: 2500,
          sabbaticalFeeMinor: 5000,
          juniorRecreationalFeeMinor: 7500,
          defaultLeagueFeeMinor: 0,
        }),
      'socialMembershipFeeMinor'
    );
  });

  test('rejects negative dollar discount amounts', () => {
    expectValidationError(
      () =>
        assertValidRegistrationDiscountSettingsStored({
          student: { amountType: 'dollar', amountValue: -1 },
          reciprocal: { amountType: 'dollar', amountValue: 0 },
          winterOnly: { amountType: 'dollar', amountValue: 0 },
        }),
      'studentDiscount'
    );
  });

  test('rejects non-integer percentage discounts', () => {
    expectValidationError(
      () =>
        assertValidRegistrationDiscountSettingsStored({
          student: { amountType: 'percent', amountValue: 30.5 },
          reciprocal: { amountType: 'dollar', amountValue: 0 },
          winterOnly: { amountType: 'dollar', amountValue: 0 },
        }),
      'studentDiscount'
    );
  });

  test('rejects percentage discounts outside 0–100', () => {
    expectValidationError(
      () =>
        assertValidRegistrationDiscountSettingsStored({
          student: { amountType: 'percent', amountValue: 101 },
          reciprocal: { amountType: 'dollar', amountValue: 0 },
          winterOnly: { amountType: 'dollar', amountValue: 0 },
        }),
      'studentDiscount'
    );
  });

  test('effective league fee prefers override over club default', () => {
    expect(effectiveLeagueRegistrationFeeMinor(5000, 30000)).toBe(5000);
    expect(effectiveLeagueRegistrationFeeMinor(null, 30000)).toBe(30000);
    expect(effectiveLeagueRegistrationFeeMinor(undefined, 30000)).toBe(30000);
  });

  test('accepts whole-number percentage discounts', () => {
    expect(() =>
      assertValidRegistrationDiscountSettingsStored({
        student: { amountType: 'percent', amountValue: 30 },
        reciprocal: { amountType: 'percent', amountValue: 0 },
        winterOnly: { amountType: 'dollar', amountValue: 0 },
      })
    ).not.toThrow();
  });
});
