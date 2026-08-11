import { describe, expect, test } from 'bun:test';
import {
  addPriority,
  availableLeaguesToAdd,
  evaluatePriorityList,
  guaranteeChipLabel,
  normalizePriorityOrder,
  removePriority,
  reorderPriorities,
  seedPriorityList,
  undecidedPriorLeagueIds,
  updatePriorityRoster,
  type LeaguePriorityInput,
  type RegistrationLeagueCatalogPayload,
} from './leaguePriorityShared';
import type { LeagueCatalogItem } from './registrationViewEditShared';

function catalogLeague(overrides: Partial<LeagueCatalogItem> & Pick<LeagueCatalogItem, 'id'>): LeagueCatalogItem {
  return {
    name: `League ${overrides.id}`,
    leagueType: 'standard',
    format: 'teams',
    registrationFeeMinor: 10000,
    allowsWaitlist: true,
    allowsSabbatical: true,
    isPlayInBased: false,
    ...overrides,
  };
}

const standardA = catalogLeague({ id: 1, name: 'Monday', registrationFeeMinor: 10000 });
const standardB = catalogLeague({ id: 2, name: 'Tuesday', registrationFeeMinor: 8000 });
const standardC = catalogLeague({ id: 3, name: 'Wednesday', registrationFeeMinor: 5000 });
const teamLeague = catalogLeague({
  id: 4,
  name: 'Sunday Doubles',
  leagueType: 'bring_your_own_team',
  format: 'doubles',
  allowsWaitlist: false,
});
const playInLeague = catalogLeague({
  id: 5,
  name: 'Competitive',
  leagueType: 'bring_your_own_team',
  isPlayInBased: true,
  allowsWaitlist: false,
});

const allLeagues = [standardA, standardB, standardC, teamLeague, playInLeague];

function ranked(...leagueIds: number[]): LeaguePriorityInput[] {
  return leagueIds.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 }));
}

function evaluate(input: {
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number | null;
  returnRightLeagueIds?: number[];
  playInEntry?: RegistrationLeagueCatalogPayload['playInEntry'];
  sabbaticalLeagueIds?: number[];
}) {
  return evaluatePriorityList({
    priorities: input.priorities,
    leagues: allLeagues,
    desiredLeagueCount: input.desiredLeagueCount,
    returnRightLeagueIds: input.returnRightLeagueIds ?? [],
    playInEntry: input.playInEntry,
    priorLeagueDecisions: (input.sabbaticalLeagueIds ?? []).map((leagueId) => ({
      leagueId,
      decision: 'sabbatical' as const,
    })),
    registrantMemberId: 100,
  });
}

describe('priority list ordering', () => {
  test('adding a league appends it and renumbers the ranks', () => {
    expect(addPriority(ranked(1), 2, allLeagues)).toEqual(ranked(1, 2));
  });

  test('adding a league already on the list changes nothing', () => {
    const current = ranked(1, 2);
    expect(addPriority(current, 1, allLeagues)).toBe(current);
  });

  test('removing a league closes the gap in the ranks', () => {
    expect(removePriority(ranked(1, 2, 3), 2, allLeagues)).toEqual(ranked(1, 3));
  });

  test('reordering renumbers from the new order', () => {
    const dragged = [
      { leagueId: 3, priorityRank: 3 },
      { leagueId: 1, priorityRank: 1 },
      { leagueId: 2, priorityRank: 2 },
    ];
    expect(reorderPriorities(dragged, allLeagues)).toEqual(ranked(3, 1, 2));
  });

  test('a team league is lifted above every standard league', () => {
    expect(normalizePriorityOrder(ranked(1, 2, 4), allLeagues)).toEqual(ranked(4, 1, 2));
  });

  test('lifting team leagues preserves the order within each block', () => {
    expect(normalizePriorityOrder(ranked(1, 5, 2, 4), allLeagues)).toEqual(ranked(5, 4, 1, 2));
  });

  test('roster edits are attached to the right league only', () => {
    const next = updatePriorityRoster(ranked(4, 1), 4, { teamRosterPlacements: [{ memberId: 100 }] });
    expect(next[0]?.teamRosterPlacements).toEqual([{ memberId: 100 }]);
    expect(next[1]?.teamRosterPlacements).toBeUndefined();
  });
});

describe('seeding the priority list', () => {
  const basePayload: RegistrationLeagueCatalogPayload = {
    leagues: allLeagues,
    priorities: [],
    desiredLeagueCount: null,
    maxDesiredLeagueCount: 5,
    priorSeasonLeagueIds: [1, 2],
    priorLeagueDecisions: [],
    activeLeagueIds: [],
    participatedLeagueIds: [1, 2],
    returnRightLeagueIds: [1, 2],
    basicIceFallbackInterest: null,
    collectBasicIceFallback: false,
  };

  test('prior-session leagues seed the list', () => {
    expect(seedPriorityList(basePayload)).toEqual(ranked(1, 2));
  });

  test('a league the registrant is already waitlisted for leads the list', () => {
    expect(
      seedPriorityList({
        ...basePayload,
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
      }),
    ).toEqual(ranked(3, 1, 2));
  });

  test('inactive waitlist entries are not seeded', () => {
    expect(
      seedPriorityList({
        ...basePayload,
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'removed' }],
      }),
    ).toEqual(ranked(1, 2));
  });

  test('seeding still respects the team-league clamp', () => {
    expect(seedPriorityList({ ...basePayload, priorSeasonLeagueIds: [1, 4] })).toEqual(ranked(4, 1));
  });
});

describe('guarantee labels shown while reordering', () => {
  test('a return right in the top two spots reads as a guaranteed return', () => {
    const result = evaluate({ priorities: ranked(1, 2), desiredLeagueCount: 2, returnRightLeagueIds: [1, 2] });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'guaranteed_return']);
    expect(result.guaranteedCount).toBe(2);
  });

  test('an unused guarantee is spent lower down as a fallback', () => {
    const result = evaluate({ priorities: ranked(3, 2, 1), desiredLeagueCount: 3, returnRightLeagueIds: [1] });
    expect(result.entries.map((entry) => entry.label)).toEqual(['waitlisted', 'waitlisted', 'guaranteed_fallback']);
  });

  test('a league with no waitlist and no return right is subject to availability', () => {
    const result = evaluate({ priorities: ranked(4), desiredLeagueCount: 1 });
    expect(result.entries[0]?.label).toBe('subject_to_availability');
  });

  test('a play-in league is guaranteed only when its declared team clears the bar', () => {
    const priorities: LeaguePriorityInput[] = [
      {
        leagueId: 5,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }, { memberId: 102 }, { memberId: 103 }],
      },
    ];
    expect(
      evaluate({ priorities, desiredLeagueCount: 1, playInEntry: { 5: { guaranteed: true } } }).entries[0]?.label,
    ).toBe('guaranteed_return');
    expect(
      evaluate({ priorities, desiredLeagueCount: 1, playInEntry: { 5: { guaranteed: false } } }).entries[0]?.label,
    ).toBe('subject_to_availability');
  });

  test('a play-in league with an incomplete team is never guaranteed', () => {
    const priorities: LeaguePriorityInput[] = [
      { leagueId: 5, priorityRank: 1, teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }] },
    ];
    expect(
      evaluate({ priorities, desiredLeagueCount: 1, playInEntry: { 5: { guaranteed: true } } }).entries[0]?.label,
    ).toBe('subject_to_availability');
  });

  test('wanting one league caps the guarantees at one', () => {
    const result = evaluate({ priorities: ranked(1, 2), desiredLeagueCount: 1, returnRightLeagueIds: [1, 2] });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'waitlisted']);
  });

  test('a sabbatical consumes one of the two protected claims', () => {
    const result = evaluate({
      priorities: ranked(1, 2),
      desiredLeagueCount: 2,
      returnRightLeagueIds: [1, 2],
      sabbaticalLeagueIds: [3],
    });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'waitlisted']);
  });

  test('every label has readable chip text', () => {
    expect(guaranteeChipLabel('guaranteed_return')).toBe('Guaranteed return');
    expect(guaranteeChipLabel('guaranteed_fallback')).toBe('Guaranteed fallback');
    expect(guaranteeChipLabel('waitlisted')).toBe('Waitlisted');
    expect(guaranteeChipLabel('subject_to_availability')).toBe('Subject to availability');
  });
});

describe('add picker and prior-league decisions', () => {
  test('leagues already listed or ineligible are not offered', () => {
    expect(
      availableLeaguesToAdd({
        leagues: allLeagues,
        priorities: ranked(1, 2),
        isEligible: (league) => league.id !== 5,
      }).map((league) => league.id),
    ).toEqual([3, 4]);
  });

  test('a prior league that is neither listed nor answered is still undecided', () => {
    expect(
      undecidedPriorLeagueIds({
        priorSeasonLeagueIds: [1, 2, 3],
        priorities: ranked(1),
        priorLeagueDecisions: [{ leagueId: 2, decision: 'drop' }],
      }),
    ).toEqual([3]);
  });
});
