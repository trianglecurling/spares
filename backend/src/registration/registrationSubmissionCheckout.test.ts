import { describe, expect, test } from 'bun:test';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { resolveRegistrationPaymentStatus, shouldMarkCheckoutCancelled } from './registrationMembershipPaymentService.js';
import { league, registrationContext, selection } from './registrationTestFixtures.js';

describe('Phase 7 submission and checkout decisions', () => {
  test('immediate-payment registration types create checkout-eligible decisions', () => {
    const byotLeague = league({ leagueType: 'bring_your_own_team', capacityType: 'team', allowsWaitlist: false, allowsSabbatical: false });

    const cases = [
      registrationContext({ membershipOption: 'social', selections: [] }),
      registrationContext({ membershipOption: 'regular_spare_only', selections: [] }),
      registrationContext({ selections: [selection({ selectionType: 'guaranteed_return' })] }),
      registrationContext({
        selections: [
          selection({ leagueId: 101, selectionType: 'guaranteed_return' }),
          selection({ leagueId: 102, selectionType: 'guaranteed_return' }),
        ],
        leagues: {
          101: league({ id: 101, predecessorLeagueId: 91 }),
          102: league({ id: 102, predecessorLeagueId: 92 }),
        },
        participatedLeagueIds: [91, 92],
      }),
      registrationContext({ membershipOption: 'none', selections: [selection({ selectionType: 'sabbatical' })] }),
      registrationContext({ membershipOption: 'junior_recreational', selections: [] }),
      registrationContext({
        leagues: { [byotLeague.id]: byotLeague },
        selections: [selection({ selectionType: 'byot_request', byotTeammateText: 'A, B, C' })],
      }),
    ];

    for (const context of cases) {
      const result = evaluateRegistrationDraft(context).paymentDecision;
      expect(result.outcome).toBe('immediate_payment');
      expect(result.createStripeCheckoutNow).toBe(true);
    }
  });

  test('deferred and no-payment registration types do not create checkout-now decisions', () => {
    const deferredCases = [
      registrationContext({ selections: [selection({ selectionType: 'waitlist_add' })] }),
      registrationContext({
        activeLeagueIds: [1],
        selections: [selection({ leagueId: 100, selectionType: 'waitlist_replace', replacesLeagueId: 1 })],
        leagues: {
          1: league({ id: 1, registrationFeeMinor: 30000 }),
          100: league({ id: 100, registrationFeeMinor: 35000 }),
        },
      }),
      registrationContext({ selections: [selection({ selectionType: 'third_league_interest' })] }),
      registrationContext({
        membershipOption: 'junior_recreational',
        selections: [],
        juniorAssistance: { requestedPercent: 50, status: 'pending' },
      }),
      registrationContext({ selections: [selection({ selectionType: 'return_subject_to_availability' })] }),
      registrationContext({ selections: [selection({ selectionType: 'sabbatical' }), selection({ selectionType: 'waitlist_add' })] }),
    ];

    for (const context of deferredCases) {
      const result = evaluateRegistrationDraft(context).paymentDecision;
      expect(result.outcome).toBe('deferred_payment');
      expect(result.createStripeCheckoutNow).toBe(false);
    }

    const waitlistOnly = evaluateRegistrationDraft(
      registrationContext({ membershipOption: 'none', selections: [selection({ selectionType: 'waitlist_add' })] })
    ).paymentDecision;
    expect(waitlistOnly.outcome).toBe('no_payment_required');
    expect(waitlistOnly.createStripeCheckoutNow).toBe(false);
  });

  test('REPLACE waitlists allow immediate payment when replacement league fees match', () => {
    const sameFeeCases = [
      registrationContext({
        activeLeagueIds: [1],
        selections: [selection({ leagueId: 100, selectionType: 'waitlist_replace', replacesLeagueId: 1 })],
        leagues: {
          1: league({ id: 1, registrationFeeMinor: 30000 }),
          100: league({ id: 100, registrationFeeMinor: 30000 }),
        },
      }),
      registrationContext({
        selections: [
          selection({ leagueId: 101, selectionType: 'guaranteed_return' }),
          selection({ leagueId: 102, selectionType: 'guaranteed_return' }),
          selection({ leagueId: 103, selectionType: 'waitlist_replace', replacesLeagueId: 101 }),
        ],
        leagues: {
          101: league({ id: 101, registrationFeeMinor: 30000, predecessorLeagueId: 91 }),
          102: league({ id: 102, registrationFeeMinor: 30000, predecessorLeagueId: 92 }),
          103: league({ id: 103, registrationFeeMinor: 30000 }),
        },
        participatedLeagueIds: [91, 92],
      }),
    ];

    for (const context of sameFeeCases) {
      const result = evaluateRegistrationDraft(context).paymentDecision;
      expect(result.outcome).toBe('immediate_payment');
      expect(result.createStripeCheckoutNow).toBe(true);
      expect(result.deferralReasons).not.toContain('waitlist_placement_pending');
    }
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
    const waitlistContext = registrationContext({ selections: [selection({ selectionType: 'waitlist_add' })] });
    const deferred = evaluateRegistrationDraft(waitlistContext).paymentDecision;
    expect(deferred.outcome).toBe('deferred_payment');

    const guaranteedContext = registrationContext({ selections: [selection({ selectionType: 'guaranteed_return' })] });
    const immediate = evaluateRegistrationDraft(guaranteedContext).paymentDecision;
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
