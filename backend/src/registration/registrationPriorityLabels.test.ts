import { describe, expect, test } from 'bun:test';
import {
  asPriorityLeague,
  evaluateGuaranteeLabels,
  rosterStatusForLeague,
  type GuaranteeLabelLeagueRow,
} from './registrationPriorityLabels.js';
import type { LeaguePriorityInput } from './registrationContext.js';
import type { PriorityLeagueShape } from './leaguePriorityRules.js';

function standardLeague(id: number, predecessorLeagueId: number | null): GuaranteeLabelLeagueRow {
  const league: PriorityLeagueShape = {
    leagueType: 'standard',
    format: 'teams',
    allowsWaitlist: false,
    isPlayInBased: false,
    registrationFeeMinor: 10000,
  };
  return { id, predecessorLeagueId, league };
}

function labelsFor(input: {
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number;
  memberId?: number;
  participatedLeagueIds?: number[];
  predecessorByLeagueId?: Record<number, number | null>;
}): Map<number, string> {
  const memberId = input.memberId ?? 10;
  const leaguesById = new Map<number, GuaranteeLabelLeagueRow>();
  for (const priority of input.priorities) {
    leaguesById.set(
      priority.leagueId,
      standardLeague(priority.leagueId, input.predecessorByLeagueId?.[priority.leagueId] ?? priority.leagueId + 100),
    );
  }
  return evaluateGuaranteeLabels({
    priorities: input.priorities,
    desiredLeagueCount: input.desiredLeagueCount,
    mode: 'priority',
    memberId,
    isReturningMember: true,
    participatedLeagueIds: new Set(input.participatedLeagueIds ?? []),
    sabbaticals: [],
    leaguesById,
    returnEligibleMemberIdsByLeagueId: new Map(),
  });
}

describe('asPriorityLeague', () => {
  test('treats sqlite 1 and boolean true as play-in', () => {
    const row = {
      league_type: 'standard' as const,
      format: 'teams' as const,
      waitlist_id: 3,
      is_play_in_based: 1 as number | boolean | null,
      registration_fee_minor: 0,
    };
    expect(asPriorityLeague(row).isPlayInBased).toBe(true);
    expect(asPriorityLeague({ ...row, is_play_in_based: true }).isPlayInBased).toBe(true);
    expect(asPriorityLeague({ ...row, is_play_in_based: 0 }).isPlayInBased).toBe(false);
  });
});

describe('evaluateGuaranteeLabels', () => {
  test('labels a returning first choice as guaranteed return and a later choice as subject to availability', () => {
    const labels = labelsFor({
      priorities: [
        { leagueId: 1, priorityRank: 1 },
        { leagueId: 2, priorityRank: 2 },
        { leagueId: 3, priorityRank: 3 },
      ],
      desiredLeagueCount: 2,
      participatedLeagueIds: [101],
      predecessorByLeagueId: { 1: 101, 2: 102, 3: 103 },
    });
    expect(labels.get(1)).toBe('guaranteed_return');
    expect(labels.get(3)).toBe('subject_to_availability');
  });
});

describe('rosterStatusForLeague', () => {
  test('returns the derived label and rank for a listed league', () => {
    const labels = new Map([
      [10, 'guaranteed_return' as const],
      [11, 'subject_to_availability' as const],
    ]);
    expect(
      rosterStatusForLeague(
        11,
        [
          { leagueId: 10, priorityRank: 1 },
          { leagueId: 11, priorityRank: 3 },
        ],
        labels,
      ),
    ).toEqual({ guaranteeLabel: 'subject_to_availability', priorityRank: 3 });
  });

  test('returns null when the league is not on the priority list', () => {
    expect(rosterStatusForLeague(99, [{ leagueId: 10, priorityRank: 1 }], new Map([[10, 'guaranteed_return']]))).toBe(
      null,
    );
  });
});
