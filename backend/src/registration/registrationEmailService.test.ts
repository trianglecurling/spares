import { describe, expect, test } from 'bun:test';
import {
  automaticSabbaticalExplanation,
  formatRegistrationTeammatesDisplay,
  renderRegistrationEmail,
} from './registrationEmailService.js';

describe('Phase 9 registration email rendering', () => {
  test('formatRegistrationTeammatesDisplay joins account-linked and pending names', () => {
    expect(
      formatRegistrationTeammatesDisplay({
        memberNames: ['Alice Example', 'Bob Example'],
        pendingNames: ['Casey Pending'],
      }),
    ).toBe('Alice Example, Bob Example, Casey Pending');
  });

  test('formatRegistrationTeammatesDisplay falls back to legacy roster text', () => {
    expect(
      formatRegistrationTeammatesDisplay({
        legacyRosterText: 'Dana\nEli',
      }),
    ).toBe('Dana, Eli');
  });

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

  test('immediate payment email includes pay-later deadline and payment link', () => {
    const rendered = renderRegistrationEmail('registration_submitted_immediate_payment', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      amountDueMinor: 12500,
      paymentUrl: 'https://example.test/pay',
      deadlineText: 'by Monday, September 1, 2026 at 11:59 PM EDT',
      summaryLines: ['Regular membership'],
    });

    expect(rendered.subject).toContain('Complete your registration payment');
    expect(rendered.textBody).toContain('chose to pay later');
    expect(rendered.textBody).toContain(
      'Payment is due by Monday, September 1, 2026 at 11:59 PM EDT to secure your league selections.',
    );
    expect(rendered.textBody).toContain('https://example.test/pay');
  });

  test('immediate payment email uses before-leagues-begin when no calendar deadline', () => {
    const rendered = renderRegistrationEmail('registration_submitted_immediate_payment', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      amountDueMinor: 12500,
      paymentUrl: 'https://example.test/pay',
      deadlineText: 'before leagues begin',
      summaryLines: ['Regular membership'],
    });

    expect(rendered.textBody).toContain(
      'Payment is due before leagues begin to secure your league selections.',
    );
  });

  test('deferred payment-link email includes the payment deadline', () => {
    const rendered = renderRegistrationEmail('deferred_registration_payment_link', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      amountDueMinor: 15000,
      paymentUrl: 'https://example.test/pay',
      deadlineText: 'by Monday, September 14, 2026 at 11:59 PM EDT',
      summaryLines: ['Hump Day league fee'],
    });

    expect(rendered.textBody).toContain(
      'Payment is due by Monday, September 14, 2026 at 11:59 PM EDT to secure your league selections.',
    );
    expect(rendered.textBody).toContain('https://example.test/pay');
  });

  test('waitlist joined email explains when a teammate was added by someone else', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      leagueName: 'Late Doubles',
      priorityRank: 3,
      position: 2,
      waitlistSize: 5,
      addedByName: 'Alice Example',
      dashboardUrl: 'https://example.test/waitlists/12',
    });

    expect(rendered.subject).toBe('You were added to the Late Doubles waitlist');
    expect(rendered.textBody).toContain('Alice Example added you to this waitlist.');
    expect(rendered.textBody).toContain('Your priority: #3 on your league priority list');
    expect(rendered.textBody).toContain(
      'If you believe this was a mistake, please reach out to Alice Example.',
    );
    expect(rendered.textBody).toContain(
      'Questions about membership or league placements? Contact membership@trianglecurling.com.',
    );
  });

  test('waitlist joined email shows priority rank and position of total', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      leagueName: 'Late Doubles',
      priorityRank: 2,
      position: 2,
      waitlistSize: 5,
      dashboardUrl: 'https://example.test/registration/view',
    });

    expect(rendered.subject).toBe('You have joined the Late Doubles waitlist');
    expect(rendered.textBody).toContain('Your priority: #2 on your league priority list');
    expect(rendered.textBody).toContain('Current position: 2 of 5');
    expect(rendered.textBody).toContain('View waitlist: https://example.test/registration/view');
  });

  test('waitlist joined email lists every waitlist from one edit session', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      joinedWaitlists: [
        {
          leagueName: 'Monday Open',
          priorityRank: 1,
          position: 3,
          waitlistSize: 12,
        },
        {
          leagueName: 'Late Doubles',
          priorityRank: 2,
          position: 1,
          waitlistSize: 4,
        },
      ],
      dashboardUrl: 'https://example.test/waitlists',
    });

    expect(rendered.subject).toBe('You have joined 2 waitlists');
    expect(rendered.textBody).toContain('- Monday Open (preference #1, position 3 of 12)');
    expect(rendered.textBody).toContain('- Late Doubles (preference #2, position 1 of 4)');
    expect(rendered.textBody).toContain('View your waitlists: https://example.test/waitlists');
    expect(rendered.textBody).not.toContain('You have joined the Monday Open waitlist');
  });

  test('waitlist joined email lists every waitlist a teammate was added to', () => {
    const rendered = renderRegistrationEmail('waitlist_joined', {
      addedByName: 'Alice Example',
      joinedWaitlists: [
        { leagueName: 'Late Doubles', position: 1, waitlistSize: 4 },
        { leagueName: 'Mixed Doubles', position: 2, waitlistSize: 6 },
      ],
      dashboardUrl: 'https://example.test/waitlists',
    });

    expect(rendered.subject).toBe('You were added to 2 waitlists');
    expect(rendered.textBody).toContain('Alice Example added you to these waitlists.');
    expect(rendered.textBody).toContain('- Late Doubles (position 1 of 4)');
    expect(rendered.textBody).toContain('- Mixed Doubles (position 2 of 6)');
    expect(rendered.textBody).toContain(
      'If you believe this was a mistake, please reach out to Alice Example.',
    );
  });

  test('waitlist removed email names the teammate who removed the entry', () => {
    const rendered = renderRegistrationEmail('waitlist_removed_by_member', {
      leagueName: 'Late Doubles',
      removedByName: 'Bob Example',
    });

    expect(rendered.subject).toBe('You have been removed from the Late Doubles waitlist');
    expect(rendered.textBody).toContain('Bob Example removed this waitlist entry.');
    expect(rendered.textBody).toContain('Your previous waitlist position is no longer held.');
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

    expect(rendered.textBody).toContain('No refund was issued because no completed payment was on file');
    expect(rendered.textBody).not.toContain('Refund amount');
    expect(rendered.subject).toContain('Registration canceled');
  });

  test('registration cancellation email explains when staff left the payment in place', () => {
    const rendered = renderRegistrationEmail('registration_cancelled_by_member', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      refundIssued: false,
      refundSkipped: true,
    });

    expect(rendered.textBody).toContain('The payment on file was left in place');
    expect(rendered.textBody).not.toContain('no completed payment was on file');
    expect(rendered.textBody).not.toContain('Refund amount');
  });

  test('deferred registration email includes teammate summary lines when provided', () => {
    const rendered = renderRegistrationEmail('registration_submitted_deferred_payment', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      summaryLines: ['play in request: Tuesday Competitive · Teammates: Alice Example, Bob Example'],
      deferralReasons: ['Play-in placement is pending.'],
    });

    expect(rendered.textBody).toContain('Teammates: Alice Example, Bob Example');
    expect(rendered.subject).toContain('payment will come later');
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
        'Play-in request: Tuesday Competitive (confirmed) · Teammates: Alice Example, Bob Example',
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
    expect(rendered.textBody).toContain('Teammates: Alice Example, Bob Example');
    expect(rendered.textBody).toContain('Regular membership fee: $300.00');
    expect(rendered.textBody).toContain('Discounts: -$25.00');
    expect(rendered.textBody).toContain('Total paid: $475.00');
    expect(rendered.textBody).toContain('finance@trianglecurling.com');
    expect(rendered.textBody).toContain('membership@trianglecurling.com');
    expect(rendered.textBody).toContain(
      'Do you have a question about your bill or think there may be a mistake? Please contact finance@trianglecurling.com.',
    );
    expect(rendered.textBody).toContain(
      'Questions about membership or league placements? Contact membership@trianglecurling.com.',
    );
    expect(rendered.htmlBody).toContain('Payment receipt');
    expect(rendered.htmlBody).toContain('mailto:finance@trianglecurling.com');
  });

  test('roster confirmation lists temporary fills with an asterisk and footnote', () => {
    const rendered = renderRegistrationEmail('roster_confirmation', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      rosterLeagues: [
        { leagueName: 'Sunday Funday (evening)', isTemporarySabbaticalFill: false },
        { leagueName: 'Friday Evening', isTemporarySabbaticalFill: true },
      ],
      receiptLineItems: [
        { description: 'Regular membership fee', amountMinor: 30000 },
        { description: 'Friday Evening temporary sabbatical-fill discount', amountMinor: -5000 },
      ],
      receiptSubtotalMinor: 30000,
      receiptDiscountMinor: 5000,
      amountPaidMinor: 25000,
      billingBalanceMinor: 0,
    });

    expect(rendered.subject).toBe('Your Fall leagues');
    expect(rendered.textBody).toContain('You are on the roster for the following Fall leagues:');
    expect(rendered.textBody).not.toContain('2026-27 /');
    expect(rendered.textBody).toContain('Sunday Funday (evening)');
    expect(rendered.textBody).toContain('Friday Evening*');
    expect(rendered.textBody).toContain('* Temporary sabbatical-fill spot');
    expect(rendered.textBody).toContain('someone is taking a sabbatical');
    expect(rendered.textBody).toContain('$20 discount');
    expect(rendered.textBody).toContain('keep your waitlist spot');
    expect(rendered.textBody).toContain('Amount paid: $250.00');
    expect(rendered.textBody).toContain('Balance: $0.00');
    expect(rendered.textBody).not.toContain('Pay the remaining balance');
    expect(rendered.textBody).not.toContain('refund will be issued');
    expect(rendered.textBody).not.toContain('Why you have a sabbatical');
  });

  test('roster confirmation explains an automatic fallback sabbatical', () => {
    const rendered = renderRegistrationEmail('roster_confirmation', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall 2026',
      rosterLeagues: [
        { leagueName: 'Sunday Funday (evening)', isTemporarySabbaticalFill: false },
        { leagueName: 'Friday Evening', isTemporarySabbaticalFill: true },
      ],
      automaticSabbaticals: [
        {
          sabbaticalLeagueName: 'Monday Late League',
          temporaryFillLeagueNames: ['Friday Evening'],
        },
      ],
      billingBalanceMinor: 0,
    });

    expect(rendered.textBody).toContain('Why you have a sabbatical');
    expect(rendered.textBody).toContain('You did not request a sabbatical');
    expect(rendered.textBody).toContain('Friday Evening');
    expect(rendered.textBody).toContain('Monday Late League');
    expect(rendered.textBody).toContain('right to return to Monday Late League');
    expect(rendered.htmlBody).toContain('Why you have a sabbatical');
    expect(automaticSabbaticalExplanation({
      sabbaticalLeagueName: 'Monday Late League',
      temporaryFillLeagueNames: ['Friday Evening'],
    })).toContain('You did not request a sabbatical');
  });

  test('roster confirmation with a balance due uses a payment-link placeholder in preview', () => {
    const rendered = renderRegistrationEmail('roster_confirmation', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      rosterLeagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      receiptLineItems: [{ description: 'Hump Day league fee', amountMinor: 15000 }],
      amountPaidMinor: 5000,
      billingBalanceMinor: 10000,
      amountDueMinor: 10000,
      paymentLinkPending: true,
      deadlineText: 'Sunday, September 13, 2026',
    });

    expect(rendered.textBody).toContain('Hump Day');
    expect(rendered.textBody).not.toContain('Hump Day*');
    expect(rendered.textBody).not.toContain('Temporary sabbatical-fill spot');
    expect(rendered.textBody).toContain('Amount paid: $50.00');
    expect(rendered.textBody).toContain('Balance due: $100.00');
    expect(rendered.textBody).toContain('Payment link will be created when this email is sent.');
    expect(rendered.textBody).toContain('Payment is due by Sunday, September 13, 2026');
    expect(rendered.textBody).not.toContain('to secure your league selections');
    expect(rendered.textBody).not.toContain('11:59');
    expect(rendered.textBody).not.toContain('https://');
  });

  test('roster confirmation with a credit tells the member a refund will be reviewed', () => {
    const rendered = renderRegistrationEmail('roster_confirmation', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      rosterLeagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      receiptLineItems: [{ description: 'Hump Day league fee', amountMinor: 10000 }],
      amountPaidMinor: 15000,
      billingBalanceMinor: -5000,
    });

    expect(rendered.textBody).toContain('Credit: -$50.00');
    expect(rendered.textBody).toContain('A refund will be issued within 5–7 business days');
    expect(rendered.textBody).not.toContain('send it manually');
    expect(rendered.textBody).not.toContain('Pay the remaining balance');
  });

  test('roster confirmation includes the Square payment URL when one is provided', () => {
    const rendered = renderRegistrationEmail('roster_confirmation', {
      curlerName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      rosterLeagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      receiptLineItems: [{ description: 'Hump Day league fee', amountMinor: 15000 }],
      amountPaidMinor: 0,
      billingBalanceMinor: 15000,
      paymentUrl: 'https://squareup.example/pay/abc',
      deadlineText: 'Sunday, September 13, 2026',
    });

    expect(rendered.textBody).toContain('Pay the remaining balance: https://squareup.example/pay/abc');
    expect(rendered.textBody).toContain('Payment is due by Sunday, September 13, 2026');
    expect(rendered.textBody).not.toContain('to secure your league selections');
    expect(rendered.htmlBody).toContain('https://squareup.example/pay/abc');
    expect(rendered.htmlBody).toContain('Payment is due');
  });
});
