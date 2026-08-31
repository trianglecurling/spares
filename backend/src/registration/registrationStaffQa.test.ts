import { describe, expect, test } from 'bun:test';
import {
  buildReturningMembersQaRows,
  classifyReturningPlayerQa,
  isNotYetRegisteredForQa,
  pickStaffRegistrationForQa,
} from './registrationStaffQa.js';

describe('pickStaffRegistrationForQa', () => {
  test('prefers a submitted registration over a newer draft', () => {
    const picked = pickStaffRegistrationForQa([
      {
        id: 2,
        status: 'shell_complete',
        submittedAt: null,
        updatedAt: '2026-08-26T12:00:00.000Z',
        desiredLeagueCount: 2,
        returningMemberAnswer: 1,
      },
      {
        id: 1,
        status: 'submitted',
        submittedAt: '2026-08-20T12:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z',
        desiredLeagueCount: 2,
        returningMemberAnswer: 1,
      },
    ]);
    expect(picked?.id).toBe(1);
  });

  test('ignores canceled registrations and returns the latest draft', () => {
    const picked = pickStaffRegistrationForQa([
      {
        id: 3,
        status: 'cancelled',
        submittedAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-26T12:00:00.000Z',
        desiredLeagueCount: 1,
        returningMemberAnswer: 1,
      },
      {
        id: 4,
        status: 'demographics_incomplete',
        submittedAt: null,
        updatedAt: '2026-08-25T12:00:00.000Z',
        desiredLeagueCount: null,
        returningMemberAnswer: 1,
      },
    ]);
    expect(picked?.id).toBe(4);
  });
});

describe('classifyReturningPlayerQa', () => {
  test('treats missing and draft registrations as not yet registered', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: false,
        leagueId: 10,
        priorities: [],
        selections: [],
        guaranteeLabelByLeagueId: new Map(),
      }).status,
    ).toBe('not_yet_registered');
  });

  test('classifies a sabbatical selection', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [],
        selections: [{ selectionType: 'sabbatical', leagueId: 10 }],
        guaranteeLabelByLeagueId: new Map(),
      }).status,
    ).toBe('sabbatical');
  });

  test('classifies an explicit drop and a submitted registration that omitted the league', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [{ leagueId: 11, priorityRank: 1 }],
        selections: [{ selectionType: 'drop', leagueId: 10 }],
        guaranteeLabelByLeagueId: new Map(),
      }).status,
    ).toBe('dropped');
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [{ leagueId: 11, priorityRank: 1 }],
        selections: [],
        guaranteeLabelByLeagueId: new Map(),
      }).status,
    ).toBe('dropped');
  });

  test('uses guaranteed return when the derived label says so', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [{ leagueId: 10, priorityRank: 1 }],
        selections: [],
        guaranteeLabelByLeagueId: new Map([[10, 'guaranteed_return']]),
      }).status,
    ).toBe('guaranteed_return');
  });

  test('treats a 1st or 2nd choice as the expected return even without a return label', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [{ leagueId: 10, priorityRank: 2 }],
        selections: [],
        guaranteeLabelByLeagueId: new Map([[10, 'available']]),
      }).status,
    ).toBe('guaranteed_return');
  });

  test('prefers guaranteed fallback over a generic 3rd-or-higher label', () => {
    expect(
      classifyReturningPlayerQa({
        hasSubmittedRegistration: true,
        leagueId: 10,
        priorities: [{ leagueId: 10, priorityRank: 3 }],
        selections: [],
        guaranteeLabelByLeagueId: new Map([[10, 'guaranteed_fallback']]),
      }).status,
    ).toBe('guaranteed_fallback');
  });

  test('classifies a 3rd-or-higher choice without fallback', () => {
    const result = classifyReturningPlayerQa({
      hasSubmittedRegistration: true,
      leagueId: 10,
      priorities: [{ leagueId: 10, priorityRank: 3 }],
      selections: [],
      guaranteeLabelByLeagueId: new Map([[10, 'superfluous']]),
    });
    expect(result.status).toBe('third_or_higher');
    expect(result.priorityRank).toBe(3);
  });
});

describe('isNotYetRegisteredForQa', () => {
  test('treats missing, draft, and canceled rows as not yet registered', () => {
    expect(isNotYetRegisteredForQa(null)).toBe(true);
    expect(isNotYetRegisteredForQa({ status: 'shell_complete' })).toBe(true);
    expect(isNotYetRegisteredForQa({ status: 'cancelled' })).toBe(true);
    expect(isNotYetRegisteredForQa({ status: 'submitted' })).toBe(false);
    expect(isNotYetRegisteredForQa({ status: 'paid' })).toBe(false);
  });
});

describe('buildReturningMembersQaRows', () => {
  const tuesday = { id: 1, name: 'Tuesday Evening', dayOfWeek: 2 };
  const thursday = { id: 2, name: 'Thursday Doubles', dayOfWeek: 4 };

  test('keeps unregistered members once and lists each previous-session league', () => {
    const rows = buildReturningMembersQaRows({
      roster: [
        { memberId: 10, memberName: 'Ada Lovelace', memberEmail: 'ada@example.com', league: thursday },
        { memberId: 10, memberName: 'Ada Lovelace', memberEmail: 'ada@example.com', league: tuesday },
        { memberId: 11, memberName: 'Grace Hopper', memberEmail: 'grace@example.com', league: tuesday },
      ],
      registrationsByMemberId: new Map([
        [
          11,
          {
            id: 50,
            status: 'submitted',
            submittedAt: '2026-08-20T12:00:00.000Z',
            updatedAt: '2026-08-20T12:00:00.000Z',
            desiredLeagueCount: 1,
            returningMemberAnswer: 1,
          },
        ],
      ]),
    });
    expect(rows).toEqual([
      {
        memberId: 10,
        memberName: 'Ada Lovelace',
        memberEmail: 'ada@example.com',
        previousLeagues: [tuesday, thursday],
        registrationId: null,
        registrationStatus: null,
      },
    ]);
  });

  test('includes members with only a draft registration', () => {
    const rows = buildReturningMembersQaRows({
      roster: [{ memberId: 12, memberName: 'Alan Turing', memberEmail: null, league: tuesday }],
      registrationsByMemberId: new Map([
        [
          12,
          {
            id: 77,
            status: 'demographics_incomplete',
            submittedAt: null,
            updatedAt: '2026-08-25T12:00:00.000Z',
            desiredLeagueCount: null,
            returningMemberAnswer: 1,
          },
        ],
      ]),
    });
    expect(rows).toEqual([
      {
        memberId: 12,
        memberName: 'Alan Turing',
        memberEmail: null,
        previousLeagues: [tuesday],
        registrationId: 77,
        registrationStatus: 'demographics_incomplete',
      },
    ]);
  });
});
