import { describe, expect, test } from 'bun:test';
import {
  classifyReturningPlayerQa,
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
