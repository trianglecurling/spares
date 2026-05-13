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

  test('temporary offer email includes no-response and temporary spot wording', () => {
    const rendered = renderRegistrationEmail('waitlist_offer_temporary_sabbatical_fill', {
      leagueName: 'Tuesday Competitive',
      deadlineText: 'Tue, Sep 1, 6:00 PM EDT',
      declineUrl: 'https://example.test/decline',
    });

    expect(rendered.textBody).toContain('If you do not decline this offer within 24 hours');
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
});
