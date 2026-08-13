import { describe, expect, test } from 'bun:test';
import {
  addPriority,
  availableLeaguesToAdd,
  canMovePriority,
  canReorderPriorityDrop,
  defaultDesiredLeagueCount,
  evaluatePriorityList,
  guaranteeChipLabel,
  hydratePriorityList,
  incompletePlayInLeagueNames,
  isFreeLeague,
  mergeActiveWaitlistLeagues,
  movePriorityInList,
  normalizePriorityOrder,
  paidPriorLeaguesOffList,
  priorityMoveButtonTitle,
  removePriority,
  reorderPriorities,
  seedPriorityList,
  sabbaticalListEntries,
  shouldShowGuaranteeChip,
  addPriorityAtTop,
  undecidedContinuingSabbaticalIds,
  undecidedPriorLeagueIds,
  updatePriorityRoster,
  type LeaguePriorityInput,
  type RegistrationLeagueCatalogPayload,
} from './leaguePriorityShared';
import {
  isLeagueSelectionEligibleLeague,
  type ContinuingSabbaticalSummary,
  type LeagueCatalogItem,
} from './registrationViewEditShared';

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
  returnEligibleMemberIdsByLeagueId?: Record<number, number[]>;
  playInEntry?: RegistrationLeagueCatalogPayload['playInEntry'];
  sabbaticalLeagueIds?: number[];
}) {
  return evaluatePriorityList({
    priorities: input.priorities,
    leagues: allLeagues,
    desiredLeagueCount: input.desiredLeagueCount,
    returnRightLeagueIds: input.returnRightLeagueIds ?? [],
    returnEligibleMemberIdsByLeagueId: input.returnEligibleMemberIdsByLeagueId,
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

  test('desired league count defaults to prior-session play only', () => {
    expect(defaultDesiredLeagueCount(basePayload)).toBe(2);
    expect(
      defaultDesiredLeagueCount({
        ...basePayload,
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
      }),
    ).toBe(2);
    expect(
      defaultDesiredLeagueCount({
        ...basePayload,
        priorSeasonLeagueIds: [],
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
      }),
    ).toBeNull();
    expect(defaultDesiredLeagueCount({ ...basePayload, desiredLeagueCount: 1 })).toBe(1);
  });

  test('saved priorities still pick up a newly joined waitlist league', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: ranked(1, 2),
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
      }),
    ).toEqual(ranked(3, 1, 2));
  });

  test('merge leaves the list unchanged when waitlisted leagues are already present', () => {
    const current = ranked(3, 1, 2);
    const payload = {
      ...basePayload,
      existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
    };
    expect(mergeActiveWaitlistLeagues(current, payload)).toBe(current);
  });

  test('basic ice hydrates only free leagues and leaves paid return rights off the list', () => {
    const freeDaytime = catalogLeague({
      id: 6,
      name: 'Daytime',
      registrationFeeMinor: 0,
      allowsWaitlist: false,
    });
    const payload: RegistrationLeagueCatalogPayload = {
      ...basePayload,
      leagues: [...allLeagues, freeDaytime],
      priorSeasonLeagueIds: [1, 6],
      returnRightLeagueIds: [1, 6],
      priorities: ranked(1, 6),
      desiredLeagueCount: 2,
      existingWaitlistEntries: [{ waitlistId: 8, leagueId: 2, status: 'active' }],
    };
    expect(hydratePriorityList(payload, { freeLeaguesOnly: true })).toEqual([{ leagueId: 6, priorityRank: 1 }]);
    expect(defaultDesiredLeagueCount(payload, { freeLeaguesOnly: true })).toBe(1);
    expect(
      paidPriorLeaguesOffList({
        priorSeasonLeagueIds: [1, 6],
        priorities: [{ leagueId: 6, priorityRank: 1 }],
        priorLeagueDecisions: [],
        leagues: payload.leagues,
      }).map((league) => league.id),
    ).toEqual([1]);
    expect(
      paidPriorLeaguesOffList({
        priorSeasonLeagueIds: [1, 6],
        priorities: [{ leagueId: 6, priorityRank: 1 }],
        priorLeagueDecisions: [{ leagueId: 1, decision: 'drop' }],
        leagues: payload.leagues,
      }).map((league) => league.id),
    ).toEqual([1]);
    expect(isFreeLeague(freeDaytime)).toBe(true);
    expect(isFreeLeague(standardA)).toBe(false);
  });

  test('drag drop targets stay within the BYOT or standard block', () => {
    expect(canReorderPriorityDrop({ leagueId: 4, priorityRank: 1 }, { leagueId: 5, priorityRank: 2 }, allLeagues)).toBe(
      true,
    );
    expect(canReorderPriorityDrop({ leagueId: 1, priorityRank: 1 }, { leagueId: 2, priorityRank: 2 }, allLeagues)).toBe(
      true,
    );
    expect(canReorderPriorityDrop({ leagueId: 4, priorityRank: 1 }, { leagueId: 1, priorityRank: 2 }, allLeagues)).toBe(
      false,
    );
    expect(canReorderPriorityDrop({ leagueId: 1, priorityRank: 2 }, { leagueId: 4, priorityRank: 1 }, allLeagues)).toBe(
      false,
    );
  });

  test('move up and down buttons stay inside each block', () => {
    const list = ranked(4, 5, 1, 2);
    expect(canMovePriority(list, 5, 'up', allLeagues)).toBe(true);
    expect(canMovePriority(list, 5, 'down', allLeagues)).toBe(false);
    expect(canMovePriority(list, 1, 'up', allLeagues)).toBe(false);
    expect(canMovePriority(list, 1, 'down', allLeagues)).toBe(true);
    expect(movePriorityInList(list, 5, 'up', allLeagues).map((priority) => priority.leagueId)).toEqual([5, 4, 1, 2]);
    expect(movePriorityInList(list, 1, 'down', allLeagues).map((priority) => priority.leagueId)).toEqual([4, 5, 2, 1]);
    expect(movePriorityInList(list, 5, 'down', allLeagues)).toBe(list);
  });

  test('disabled move tooltips explain the BYOT boundary only', () => {
    const list = ranked(4, 5, 1, 2);
    expect(priorityMoveButtonTitle(list, 5, 'down', allLeagues, 'Competitive')).toBe(
      'Cannot move down. Bring-your-own-team leagues must be prioritized higher than standard leagues.',
    );
    expect(priorityMoveButtonTitle(list, 1, 'up', allLeagues, 'Monday')).toBe(
      'Cannot move up. Bring-your-own-team leagues must be prioritized higher than standard leagues.',
    );
    expect(priorityMoveButtonTitle(list, 4, 'up', allLeagues, 'Sunday Doubles')).toBeUndefined();
    expect(priorityMoveButtonTitle(list, 5, 'up', allLeagues, 'Competitive')).toBe('Move Competitive up');
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
    expect(result.guaranteedCount).toBe(0);
    expect(result.confirmedLeagueFeeMinor).toBe(result.entries[0]?.feeMinor);
    expect(result.maximumLeagueFeeMinor).toBe(result.confirmedLeagueFeeMinor);
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

  test('a play-in league with an incomplete team awaits roster entry', () => {
    const priorities: LeaguePriorityInput[] = [
      { leagueId: 5, priorityRank: 1, teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }] },
    ];
    expect(
      evaluate({ priorities, desiredLeagueCount: 1, playInEntry: { 5: { guaranteed: true } } }).entries[0]?.label,
    ).toBe('awaiting_roster_entry');
  });

  test('a BYOT league is guaranteed only when every teammate is returning', () => {
    const priorities: LeaguePriorityInput[] = [
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }],
      },
    ];
    expect(
      evaluate({
        priorities,
        desiredLeagueCount: 1,
        returnRightLeagueIds: [4],
        returnEligibleMemberIdsByLeagueId: { 4: [100, 101] },
      }).entries[0]?.label,
    ).toBe('guaranteed_return');
    expect(
      evaluate({
        priorities,
        desiredLeagueCount: 1,
        returnRightLeagueIds: [4],
        returnEligibleMemberIdsByLeagueId: { 4: [100] },
      }).entries[0]?.label,
    ).toBe('subject_to_availability');
  });

  test('wanting one league caps the guarantees at one', () => {
    const result = evaluate({ priorities: ranked(1, 2), desiredLeagueCount: 1, returnRightLeagueIds: [1, 2] });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'waitlisted']);
  });

  test('a sabbatical does not reduce the guarantee budget', () => {
    const result = evaluate({
      priorities: ranked(1, 2),
      desiredLeagueCount: 2,
      returnRightLeagueIds: [1, 2],
      sabbaticalLeagueIds: [3],
    });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'guaranteed_return']);
    expect(result.guaranteedCount).toBe(2);
  });

  test('every label has readable chip text', () => {
    expect(guaranteeChipLabel('guaranteed_return')).toBe('Guaranteed return');
    expect(guaranteeChipLabel('awaiting_roster_entry')).toBe('Awaiting roster entry');
    expect(guaranteeChipLabel('guaranteed_fallback')).toBe('Guaranteed fallback');
    expect(guaranteeChipLabel('waitlisted')).toBe('Waitlisted');
    expect(guaranteeChipLabel('subject_to_availability')).toBe('Subject to availability');
    expect(shouldShowGuaranteeChip('subject_to_availability')).toBe(false);
    expect(shouldShowGuaranteeChip('waitlisted')).toBe(true);
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

describe('sabbatical list', () => {
  const continuing = (
    overrides: Partial<ContinuingSabbaticalSummary> & Pick<ContinuingSabbaticalSummary, 'leagueId'>,
  ): ContinuingSabbaticalSummary => ({
    sabbaticalId: overrides.leagueId,
    leagueName: `League ${overrides.leagueId}`,
    priorLeagueId: overrides.leagueId,
    firstSabbaticalStartDate: '2025-10-01',
    canExtend: true,
    extensionBlockedMessage: null,
    sabbaticalFeeMinor: 2500,
    ...overrides,
  });

  test('shows newly indicated sabbaticals and undecided continuing ones', () => {
    expect(
      sabbaticalListEntries({
        continuingSabbaticals: [continuing({ leagueId: 10 })],
        priorLeagueDecisions: [{ leagueId: 2, decision: 'sabbatical' }],
        priorities: ranked(1),
        leagues: allLeagues,
        defaultSabbaticalFeeMinor: 3000,
      }),
    ).toEqual([
      {
        leagueId: 10,
        leagueName: 'League 10',
        sabbaticalFeeMinor: 2500,
        kind: 'continuing',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: null,
      },
      {
        leagueId: 2,
        leagueName: 'Tuesday',
        sabbaticalFeeMinor: 3000,
        kind: 'indicated',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: 'sabbatical',
      },
    ]);
  });

  test('keeps continuing sabbaticals visible after return, extend, or drop', () => {
    expect(
      sabbaticalListEntries({
        continuingSabbaticals: [
          continuing({ leagueId: 10 }),
          continuing({ leagueId: 11 }),
          continuing({ leagueId: 12 }),
        ],
        priorLeagueDecisions: [
          { leagueId: 11, decision: 'drop' },
          { leagueId: 12, decision: 'sabbatical' },
        ],
        priorities: [{ leagueId: 10, priorityRank: 1 }],
        leagues: allLeagues,
        defaultSabbaticalFeeMinor: 3000,
      }),
    ).toEqual([
      {
        leagueId: 10,
        leagueName: 'League 10',
        sabbaticalFeeMinor: 2500,
        kind: 'continuing',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: 'return',
      },
      {
        leagueId: 11,
        leagueName: 'League 11',
        sabbaticalFeeMinor: 2500,
        kind: 'continuing',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: 'drop',
      },
      {
        leagueId: 12,
        leagueName: 'League 12',
        sabbaticalFeeMinor: 2500,
        kind: 'continuing',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: 'sabbatical',
      },
    ]);
  });

  test('does not duplicate a continuing sabbatical that is also in prior decisions', () => {
    expect(
      sabbaticalListEntries({
        continuingSabbaticals: [continuing({ leagueId: 2, leagueName: 'Tuesday Open' })],
        priorLeagueDecisions: [{ leagueId: 2, decision: 'sabbatical' }],
        priorities: [],
        leagues: allLeagues,
        defaultSabbaticalFeeMinor: 3000,
      }),
    ).toEqual([
      {
        leagueId: 2,
        leagueName: 'Tuesday Open',
        sabbaticalFeeMinor: 2500,
        kind: 'continuing',
        canExtend: true,
        extensionBlockedMessage: null,
        decision: 'sabbatical',
      },
    ]);
  });

  test('return adds a missing continuing sabbatical at the top of the priority list', () => {
    expect(addPriorityAtTop(ranked(2, 3), 1, allLeagues).map((entry) => entry.leagueId)).toEqual([1, 2, 3]);
    expect(addPriorityAtTop(ranked(1, 2), 1, allLeagues)).toEqual(ranked(1, 2));
  });

  test('undecided continuing sabbaticals block continue', () => {
    expect(
      undecidedContinuingSabbaticalIds({
        continuingSabbaticals: [continuing({ leagueId: 10 }), continuing({ leagueId: 11 })],
        priorities: [{ leagueId: 10, priorityRank: 1 }],
        priorLeagueDecisions: [],
      }),
    ).toEqual([11]);
  });
});

describe('incomplete play-in roster confirmation', () => {
  test('names play-in leagues that meet the minimum but are not full', () => {
    expect(
      incompletePlayInLeagueNames(
        [
          {
            leagueId: 5,
            priorityRank: 1,
            teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }],
          },
        ],
        allLeagues,
        100,
      ),
    ).toEqual(['Competitive']);
  });

  test('ignores empty, below-minimum, and full play-in rosters', () => {
    expect(incompletePlayInLeagueNames([{ leagueId: 5, priorityRank: 1 }], allLeagues, 100)).toEqual([]);
    expect(
      incompletePlayInLeagueNames(
        [{ leagueId: 5, priorityRank: 1, teamRosterPlacements: [{ memberId: 100 }] }],
        allLeagues,
        100,
      ),
    ).toEqual([]);
    expect(
      incompletePlayInLeagueNames(
        [
          {
            leagueId: 5,
            priorityRank: 1,
            teamRosterPlacements: [
              { memberId: 100 },
              { memberId: 101 },
              { memberId: 102 },
              { memberId: 103 },
            ],
          },
        ],
        allLeagues,
        100,
      ),
    ).toEqual([]);
  });
});

describe('Junior Recreational program league', () => {
  test('is not eligible for the regular priority list', () => {
    const juniorLeague = catalogLeague({ id: 9, name: 'Junior Recreational', isJuniorRecreational: true });
    expect(
      isLeagueSelectionEligibleLeague(juniorLeague, {
        dateOfBirth: '2014-01-01',
        experienceType: 'none_or_minimal',
        membershipOption: 'regular',
      }),
    ).toBe(false);
  });
});
