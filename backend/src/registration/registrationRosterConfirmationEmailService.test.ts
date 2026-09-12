import { describe, expect, test } from 'bun:test';
import { renderRegistrationEmail } from './registrationEmailService.js';
import {
  buildRosterConfirmationEmailPayload,
  matchAutomaticSabbaticals,
  pickRosterConfirmationBilling,
  rosterConfirmationCheckoutLines,
  rosterConfirmationSendSideEffects,
} from './registrationRosterConfirmationEmailService.js';

describe('roster confirmation checkout lines', () => {
  test('uses mapped Square product names instead of friendly invoice descriptions', () => {
    expect(
      rosterConfirmationCheckoutLines({
        owedLines: [
          { description: 'Regular membership fee', amountMinor: 30000, lineType: 'regular_membership_fee' },
          { description: 'Hump Day league fee', amountMinor: 15000, lineType: 'league_fee' },
        ],
        owedDiscountLines: [
          {
            description: 'Hump Day temporary sabbatical-fill discount',
            amountMinor: -5000,
            lineType: 'sabbatical_fill_discount',
          },
        ],
        owedMinor: 40000,
        paidMinor: 25000,
        configuredNames: new Map([
          ['regular_membership_fee', 'TCC Regular Membership'],
          ['league_fee', 'League'],
          ['sabbatical_fill_discount', 'Temporary sabbatical-fill discount'],
        ]),
      }),
    ).toEqual([
      { description: 'TCC Regular Membership', amountMinor: 5000 },
      { description: 'League', amountMinor: 15000 },
      { description: 'Temporary sabbatical-fill discount', amountMinor: -5000 },
    ]);
  });

  test('omits a fully paid membership from the Square cart', () => {
    expect(
      rosterConfirmationCheckoutLines({
        owedLines: [
          { description: 'Regular membership fee', amountMinor: 20800, lineType: 'regular_membership_fee' },
          { description: 'Hump Day league fee', amountMinor: 15000, lineType: 'league_fee' },
        ],
        owedDiscountLines: [],
        owedMinor: 35800,
        paidMinor: 20800,
      }),
    ).toEqual([{ description: 'League', amountMinor: 15000 }]);
  });

  test('returns no checkout lines when nothing is due', () => {
    expect(
      rosterConfirmationCheckoutLines({
        owedLines: [{ description: 'Regular membership fee', amountMinor: 30000 }],
        owedDiscountLines: [],
        owedMinor: 30000,
        paidMinor: 30000,
      }),
    ).toEqual([]);
    expect(
      rosterConfirmationCheckoutLines({
        owedLines: [{ description: 'Regular membership fee', amountMinor: 20000 }],
        owedDiscountLines: [],
        owedMinor: 20000,
        paidMinor: 25000,
      }),
    ).toEqual([]);
  });
});

describe('automatic fallback sabbaticals', () => {
  test('matches a sabbatical only when the member still has a play priority and a temp fill', () => {
    expect(
      matchAutomaticSabbaticals({
        sabbaticals: [{ leagueId: 8, leagueName: 'Monday Late League' }],
        playPriorityLeagueIds: [8, 2],
        temporaryFillLeagues: [{ leagueName: 'Friday Evening' }],
      }),
    ).toEqual([
      {
        sabbaticalLeagueName: 'Monday Late League',
        temporaryFillLeagueNames: ['Friday Evening'],
      },
    ]);
    expect(
      matchAutomaticSabbaticals({
        sabbaticals: [{ leagueId: 8, leagueName: 'Monday Late League' }],
        playPriorityLeagueIds: [8],
        temporaryFillLeagues: [],
      }),
    ).toEqual([]);
    expect(
      matchAutomaticSabbaticals({
        sabbaticals: [{ leagueId: 8, leagueName: 'Monday Late League' }],
        playPriorityLeagueIds: [2],
        temporaryFillLeagues: [{ leagueName: 'Friday Evening' }],
      }),
    ).toEqual([]);
  });
});

describe('pick roster confirmation billing', () => {
  test('uses the paid registration instead of a later unpaid duplicate', () => {
    const paid = { registrationId: 510, paidMinor: 33300 };
    const unpaidDuplicate = { registrationId: 538, paidMinor: 0 };
    expect(pickRosterConfirmationBilling([unpaidDuplicate, paid], [538])).toEqual(paid);
    expect(pickRosterConfirmationBilling([paid, unpaidDuplicate], [538])).toEqual(paid);
  });

  test('keeps the roster-linked registration when neither has a payment', () => {
    const older = { registrationId: 510, paidMinor: 0 };
    const rosterLinked = { registrationId: 538, paidMinor: 0 };
    expect(pickRosterConfirmationBilling([older, rosterLinked], [538])).toEqual(rosterLinked);
  });
});

describe('roster confirmation send side effects', () => {
  test('creates a payment link only when a balance is due and never refunds', () => {
    expect(rosterConfirmationSendSideEffects(10000)).toEqual({ createPaymentLink: true, issueRefund: false });
    expect(rosterConfirmationSendSideEffects(0)).toEqual({ createPaymentLink: false, issueRefund: false });
    expect(rosterConfirmationSendSideEffects(-5000)).toEqual({ createPaymentLink: false, issueRefund: false });
  });
});

describe('roster confirmation payload', () => {
  test('email keeps friendly line names while Square checkout uses mapped product names', () => {
    const owedLines = [
      { description: 'Hump Day league fee', amountMinor: 15000, lineType: 'league_fee' as const },
    ];
    const payload = buildRosterConfirmationEmailPayload({
      memberName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      leagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      owedLines,
      owedDiscountLines: [],
      owedSubtotalMinor: 15000,
      owedDiscountMinor: 0,
      owedMinor: 15000,
      paidMinor: 0,
      balanceMinor: 15000,
    });
    expect(payload.receiptLineItems).toEqual([{ description: 'Hump Day league fee', amountMinor: 15000 }]);
    expect(
      rosterConfirmationCheckoutLines({
        owedLines,
        owedDiscountLines: [],
        owedMinor: 15000,
        paidMinor: 0,
      }),
    ).toEqual([{ description: 'League', amountMinor: 15000 }]);
  });

  test('preview payload asks for a payment link without creating one', () => {
    const payload = buildRosterConfirmationEmailPayload({
      memberName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      leagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      owedLines: [{ description: 'Hump Day league fee', amountMinor: 15000 }],
      owedDiscountLines: [],
      owedSubtotalMinor: 15000,
      owedDiscountMinor: 0,
      owedMinor: 15000,
      paidMinor: 5000,
      balanceMinor: 10000,
      paymentLinkPending: true,
      deadlineText: 'Sunday, September 13, 2026',
    });
    const rendered = renderRegistrationEmail('roster_confirmation', payload);
    expect(payload.paymentUrl).toBeNull();
    expect(payload.paymentLinkPending).toBe(true);
    expect(payload.deadlineText).toBe('Sunday, September 13, 2026');
    expect(rendered.subject).toBe('Your Fall leagues and payment link');
    expect(rendered.textBody).toContain('Payment link will be created when this email is sent.');
    expect(rendered.textBody).toContain('Payment is due by Sunday, September 13, 2026');
    expect(rendered.textBody).not.toContain('https://');
  });

  test('credit payload never includes a payment link', () => {
    const payload = buildRosterConfirmationEmailPayload({
      memberName: 'Alex Curler',
      seasonName: '2026-27',
      sessionName: 'Fall',
      leagues: [{ leagueName: 'Hump Day', isTemporarySabbaticalFill: false }],
      owedLines: [{ description: 'Hump Day league fee', amountMinor: 10000 }],
      owedDiscountLines: [],
      owedSubtotalMinor: 10000,
      owedDiscountMinor: 0,
      owedMinor: 10000,
      paidMinor: 15000,
      balanceMinor: -5000,
    });
    const rendered = renderRegistrationEmail('roster_confirmation', payload);
    expect(payload.paymentUrl).toBeNull();
    expect(payload.paymentLinkPending).toBe(false);
    expect(rendered.subject).toBe('Your Fall leagues');
    expect(rendered.subject).not.toContain('payment link');
    expect(rendered.textBody).toContain('refund will be issued');
    expect(rendered.textBody).not.toContain('Pay the remaining balance');
  });
});
