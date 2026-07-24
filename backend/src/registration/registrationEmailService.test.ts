import { describe, expect, test } from 'bun:test';
import { renderRegistrationEmail } from './registrationEmailService.js';

describe('Phase 9 registration email rendering', () => {
  test('deferred registration email does not call pending choices confirmed', () => {
    const rendered = renderRegistrationEmail('registration_submitted_deferred_payment', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      summaryLines: ['waitlist add: Monday Open'],
      deferralReasons: ['League placement is pending.'],
    });

    expect(rendered.subject).toContain('payment will come later');
    expect(rendered.textBody.toLowerCase()).toContain('payment is deferred');
    expect(rendered.textBody.toLowerCase()).not.toContain('fully confirmed');
  });

  test('waitlist joined email explains when a teammate was added by someone else', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      leagueName: 'Late Doubles',
      waitlistType: 'ADD',
      position: 2,
      waitlistSize: 5,
      addedByName: 'Alice Example',
      dashboardUrl: 'https://example.test/waitlists/12',
    });

    expect(rendered.subject).toBe('You were added to the Late Doubles waitlist');
    expect(rendered.textBody).toContain('Alice Example added you to this waitlist.');
    expect(rendered.textBody).toContain('Your waitlist entry type: ADD to this league');
    expect(rendered.textBody).toContain(
      'If you believe this was a mistake, please reach out to Alice Example.',
    );
    expect(rendered.textBody).toContain(
      'Questions about membership or league placements? Contact membership@trianglecurling.com.',
    );
  });

  test('waitlist joined email shows entry type, replaced league, and position of total', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      leagueName: 'Late Doubles',
      waitlistType: 'REPLACE',
      replacementLeagueName: 'Early Doubles',
      position: 2,
      waitlistSize: 5,
      dashboardUrl: 'https://example.test/registration/view',
    });

    expect(rendered.subject).toBe('You have joined the Late Doubles waitlist');
    expect(rendered.textBody).toContain('Waitlist entry type: REPLACE one of your leagues');
    expect(rendered.textBody).toContain('Replaces league: Early Doubles');
    expect(rendered.textBody).toContain('Current position: 2 of 5');
    expect(rendered.textBody).toContain('View waitlist: https://example.test/registration/view');
    expect(rendered.htmlBody).not.toContain('Replacement league');
  });

  test('temporary offer email includes no-response and temporary spot wording', () => {
    const rendered = renderRegistrationEmail('waitlist_offer_temporary_sabbatical_fill', {
      leagueName: 'Tuesday Competitive',
      deadlineText: 'Tue, Sep 1, 6:00 PM EDT',
      declineUrl: 'https://example.test/decline',
    });

    expect(rendered.textBody).toContain('If you do not accept this offer by the response deadline, we will treat it as declined');
    expect(rendered.textBody).toContain('temporary spot');
    expect(rendered.textBody).toContain('does not remove you from the waitlist for a permanent spot');
  });

  test('social membership confirmation states ice and upgrade limits', () => {
    const rendered = renderRegistrationEmail('social_membership_confirmation', {
      curlerName: 'Sam Social',
      seasonName: '2026-27',
    });

    expect(rendered.textBody).toContain('does not include ice privileges');
    expect(rendered.textBody).toContain('no social membership credit');
    expect(rendered.textBody).toContain('no discounts');
  });

  test('registration cancellation email includes refund details when applicable', () => {
    const rendered = renderRegistrationEmail('registration_cancelled_by_member', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      refundIssued: true,
      amountRefundedMinor: 25000,
      paymentReference: 'Payment order 42',
      paymentDetailsUrl: 'https://example.test/payments/abc-123',
    });

    expect(rendered.subject).toContain('Registration canceled');
    expect(rendered.textBody).toContain('$250.00');
    expect(rendered.textBody).toContain('Payment order 42');
    expect(rendered.textBody).toContain('refund has been issued');
    expect(rendered.textBody).toContain('View refund receipt: https://example.test/payments/abc-123');
    expect(rendered.htmlBody).toContain('Registration canceled');
    expect(rendered.htmlBody).toContain('View refund receipt');
  });

  test('registration cancellation email explains when no refund was issued', () => {
    const rendered = renderRegistrationEmail('registration_cancelled_by_member', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      refundIssued: false,
    });

    expect(rendered.textBody).toContain('No refund was issued');
    expect(rendered.textBody).not.toContain('Refund amount');
    expect(rendered.subject).toContain('Registration canceled');
  });

  test('registration payment confirmation includes registration details, receipt, and contact emails', () => {
    const rendered = renderRegistrationEmail('registration_payment_received', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      amountPaidMinor: 47500,
      registrationDetailLines: [
        'Season: 2026-27',
        'Session: Fall',
        'Membership/program: Regular membership',
        'League and program choices:',
        'Guaranteed return: Monday Open (confirmed)',
      ],
      receiptLineItems: [
        { description: 'Regular membership fee', amountMinor: 30000 },
        { description: 'Monday Open league fee', amountMinor: 20000 },
        { description: 'Student discount', amountMinor: -2500 },
      ],
      receiptSubtotalMinor: 50000,
      receiptDiscountMinor: 2500,
      paymentReference: 'Payment order 42',
      paymentDetailsUrl: 'https://example.test/payments/abc-123',
      paidAt: 'Jun 6, 2026, 3:15 PM',
      dashboardUrl: 'https://example.test/registration/view',
    });

    expect(rendered.subject).toBe('Registration payment received');
    expect(rendered.textBody).toContain('View payment details: https://example.test/payments/abc-123');
    expect(rendered.textBody).toContain('Registration details');
    expect(rendered.textBody).toContain('Guaranteed return: Monday Open (confirmed)');
    expect(rendered.textBody).toContain('Regular membership fee: $300.00');
    expect(rendered.textBody).toContain('Discounts: -$25.00');
    expect(rendered.textBody).toContain('Total paid: $475.00');
    expect(rendered.textBody).toContain('finance@trianglecurling.com');
    expect(rendered.textBody).toContain('membership@trianglecurling.com');
    expect(rendered.textBody).toContain('Questions about payments? Contact finance@trianglecurling.com.');
    expect(rendered.textBody).toContain(
      'Questions about membership or league placements? Contact membership@trianglecurling.com.',
    );
    expect(rendered.htmlBody).toContain('Payment receipt');
    expect(rendered.htmlBody).toContain('mailto:finance@trianglecurling.com');
  });
});
