import { describe, expect, test } from 'bun:test';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { resolveRegistrationPaymentStatus, shouldMarkCheckoutCancelled } from './registrationMembershipPaymentService.js';
import { league, priority, registrationContext, selection } from './registrationTestFixtures.js';

/** Registration with no priority list, so nothing but membership is billable. */
function membershipOnly(overrides: Parameters<typeof registrationContext>[0] = {}) {
  return registrationContext({ selections: [], priorities: [], desiredLeagueCount: null, ...overrides });
}

describe('Phase 7 submission and checkout decisions', () => {
  test('immediate-payment registration types create checkout-eligible decisions', () => {
    const cases = [
      membershipOnly({ membershipOption: 'social' }),
      membershipOnly({ membershipOption: 'regular_spare_only' }),
      registrationContext(),
      registrationContext({
        priorities: [priority({ leagueId: 101, priorityRank: 1 }), priority({ leagueId: 102, priorityRank: 2 })],
        desiredLeagueCount: 2,
        leagues: {
          101: league({ id: 101, predecessorLeagueId: 91 }),
          102: league({ id: 102, predecessorLeagueId: 92 }),
          91: league({ id: 91, predecessorLeagueId: null }),
          92: league({ id: 92, predecessorLeagueId: null }),
        },
        participatedLeagueIds: [91, 92],
      }),
      membershipOnly({ membershipOption: 'none', selections: [selection({ selectionType: 'sabbatical' })] }),
      membershipOnly({ membershipOption: 'junior_recreational' }),
    ];

    for (const context of cases) {
      const result = evaluateRegistrationDraft(context).paymentDecision;
      expect(result.outcome).toBe('immediate_payment');
      expect(result.createStripeCheckoutNow).toBe(true);
    }
  });

  test('deferred and no-payment registration types do not create checkout-now decisions', () => {
    const wantsAWaitlistedLeague = registrationContext({
      leagues: { 100: league({ id: 100, predecessorLeagueId: null }) },
      participatedLeagueIds: [],
    });

    const deferredCases = [
      wantsAWaitlistedLeague,
      registrationContext({
        priorities: [priority({ leagueId: 100, priorityRank: 1 }), priority({ leagueId: 101, priorityRank: 2 })],
        desiredLeagueCount: 2,
        leagues: {
          100: league({ id: 100, predecessorLeagueId: 90 }),
          101: league({ id: 101, predecessorLeagueId: null }),
          90: league({ id: 90, predecessorLeagueId: null }),
        },
      }),
      membershipOnly({
        membershipOption: 'junior_recreational',
        juniorAssistance: { requestedPercent: 50, status: 'pending' },
      }),
      {
        ...wantsAWaitlistedLeague,
        selections: [selection({ selectionType: 'sabbatical', leagueId: 90 })],
      },
    ];

    for (const context of deferredCases) {
      const result = evaluateRegistrationDraft(context).paymentDecision;
      expect(result.outcome).toBe('deferred_payment');
      expect(result.createStripeCheckoutNow).toBe(false);
    }

    const nothingBillable = evaluateRegistrationDraft(membershipOnly({ membershipOption: 'none' })).paymentDecision;
    expect(nothingBillable.outcome).toBe('no_payment_required');
    expect(nothingBillable.createStripeCheckoutNow).toBe(false);
  });

  test('a fully guaranteed list bills now and quotes no range', () => {
    const context = registrationContext({
      priorities: [priority({ leagueId: 101, priorityRank: 1 }), priority({ leagueId: 102, priorityRank: 2 })],
      desiredLeagueCount: 2,
      leagues: {
        101: league({ id: 101, registrationFeeMinor: 30000, predecessorLeagueId: 91 }),
        102: league({ id: 102, registrationFeeMinor: 30000, predecessorLeagueId: 92 }),
        91: league({ id: 91, predecessorLeagueId: null }),
        92: league({ id: 92, predecessorLeagueId: null }),
      },
      participatedLeagueIds: [91, 92],
    });

    const result = evaluateRegistrationDraft(context).paymentDecision;
    expect(result.outcome).toBe('immediate_payment');
    expect(result.createStripeCheckoutNow).toBe(true);
    expect(result.deferralReasons).not.toContain('waitlist_placement_pending');
    expect(result.estimatedMaximumDueMinor).toBe(result.totalDueMinor);
  });

  test('client success redirect remains confirming until webhook-confirmed rows are paid', () => {
    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'checkout_started',
        registrationStatus: 'payment_started',
        paymentOrderStatus: 'pending',
        totalDueMinor: 12500,
      })
    ).toBe('confirming');

    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'paid',
        registrationStatus: 'confirmed',
        paymentOrderStatus: 'succeeded',
        totalDueMinor: 12500,
      })
    ).toBe('confirmed');

    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'failed',
        registrationStatus: 'awaiting_payment',
        paymentOrderStatus: 'failed',
        totalDueMinor: 12500,
      })
    ).toBe('failed');
  });

  test('deferred-to-immediate edit preview does not create checkout until confirmed', () => {
    const waitlistContext = registrationContext({
      leagues: { 100: league({ id: 100, predecessorLeagueId: null }) },
      participatedLeagueIds: [],
    });
    const deferred = evaluateRegistrationDraft(waitlistContext).paymentDecision;
    expect(deferred.outcome).toBe('deferred_payment');

    const immediate = evaluateRegistrationDraft(registrationContext()).paymentDecision;
    expect(immediate.outcome).toBe('immediate_payment');
    expect(immediate.createStripeCheckoutNow).toBe(true);
  });

  test('checkout cancellation cannot regress paid or confirmed registrations', () => {
    expect(
      shouldMarkCheckoutCancelled({
        invoiceStatus: 'checkout_started',
        registrationStatus: 'payment_started',
      })
    ).toBe(true);

    expect(
      shouldMarkCheckoutCancelled({
        invoiceStatus: 'paid',
        registrationStatus: 'payment_started',
      })
    ).toBe(false);

    expect(
      shouldMarkCheckoutCancelled({
        invoiceStatus: 'checkout_started',
        registrationStatus: 'confirmed',
      })
    ).toBe(false);
  });

  test('client success redirect confirms once payment order succeeds even if invoice still says checkout started', () => {
    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'checkout_started',
        registrationStatus: 'payment_started',
        paymentOrderStatus: 'succeeded',
        totalDueMinor: 12500,
      })
    ).toBe('confirming');

    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'paid',
        registrationStatus: 'confirmed',
        paymentOrderStatus: 'succeeded',
        totalDueMinor: 12500,
      })
    ).toBe('confirmed');
  });

  test('canceled registration stops confirming once payment succeeds without confirmation', () => {
    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'cancelled',
        registrationStatus: 'cancelled',
        paymentOrderStatus: 'succeeded',
        totalDueMinor: 44000,
      })
    ).toBe('payment_unapplied');

    expect(
      resolveRegistrationPaymentStatus({
        invoiceStatus: 'cancelled',
        registrationStatus: 'cancelled',
        paymentOrderStatus: 'pending',
        totalDueMinor: 44000,
      })
    ).toBe('cancelled');
  });
});
