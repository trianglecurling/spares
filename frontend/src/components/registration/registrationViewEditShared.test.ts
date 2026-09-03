import { AxiosError } from 'axios';
import { describe, expect, test } from 'bun:test';
import {
  addPriority,
  availableLeaguesToAdd,
  canMovePriority,
  canReorderPriorityDrop,
  defaultDesiredLeagueCount,
  evaluatePriorityList,
  guaranteeChipLabel,
  leagueCatalogAvailabilityLabel,
  hydratePriorityList,
  incompletePlayInLeagueNames,
  isFreeLeague,
  mergeActiveWaitlistLeagues,
  mergeExistingPlayInTeamLeagues,
  mergeNewlyDiscoveredPlayInTeamLeagues,
  mergeNewlyJoinedWaitlistLeagues,
  addedExistingPlayInTeamCount,
  bumpDesiredLeagueCount,
  applyExistingPlayInTeamRosterIfEmpty,
  priorityRosterFromPlayInTeamMembers,
  omitLeaveBehindDecisionsForListedLeagues,
  movePriorityInList,
  normalizePriorityOrder,
  omittedWaitlistLeagues,
  formatConjunctionList,
  formatPriorityOrdinal,
  paidPriorLeaguesOffList,
  priorityMoveButtonTitle,
  byotGuaranteedReturnFootnote,
  byotGuaranteedReturnFootnotes,
  removePriority,
  reorderPriorities,
  rosterGuaranteeChipLabel,
  seedPriorityList,
  sabbaticalEligiblePriorLeagues,
  defaultSabbaticalOnlyDecisions,
  isSabbaticalEligibleLeague,
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
  leagueScheduleText,
  shouldShowLeaguePriorityIntro,
  editValidationErrorMessage,
  type ContinuingSabbaticalSummary,
  type LeagueCatalogItem,
  type RegistrationByotDeclaredTeamSummary,
  type RegistrationPlayInEntrySummary,
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

function existingPlayInSummary(
  overrides: Partial<RegistrationPlayInEntrySummary> = {},
): RegistrationPlayInEntrySummary {
  return {
    leagueId: 5,
    autoEntryCount: 18,
    playInSpotCount: 2,
    teamSize: 4,
    onExistingTeam: true,
    existingTeam: {
      id: 9,
      name: null,
      createdByName: 'Alice Skip',
      members: [
        { memberId: 21, memberName: 'Alice Skip', pendingName: null, priorityRank: null },
        { memberId: 100, memberName: 'Bob Vice', pendingName: null, priorityRank: null },
      ],
    },
    committedOtherMemberIds: [],
    teamTotalPoints: 40,
    meetsReturningRule: true,
    guaranteed: true,
    guaranteeThresholdPoints: 24,
    ...overrides,
  };
}

function existingByotSummary(
  overrides: Partial<RegistrationByotDeclaredTeamSummary> = {},
): RegistrationByotDeclaredTeamSummary {
  return {
    leagueId: 4,
    teamSize: 2,
    onExistingTeam: true,
    existingTeam: {
      id: 11,
      name: null,
      createdByName: 'Alice Skip',
      members: [
        { memberId: 21, memberName: 'Alice Skip', pendingName: null },
        { memberId: 100, memberName: 'Bob Vice', pendingName: null },
      ],
    },
    committedOtherMemberIds: [],
    ...overrides,
  };
}

function ranked(...leagueIds: number[]): LeaguePriorityInput[] {
  return leagueIds.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 }));
}

function evaluate(input: {
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number | null;
  returnRightLeagueIds?: number[];
  returnEligibleMemberIdsByLeagueId?: Record<number, number[]>;
  playInEntry?: RegistrationLeagueCatalogPayload['playInEntry'];
  byotEntry?: RegistrationLeagueCatalogPayload['byotEntry'];
  sabbaticalLeagueIds?: number[];
  registrationState?: RegistrationLeagueCatalogPayload['registrationState'];
  leagues?: LeagueCatalogItem[];
}) {
  return evaluatePriorityList({
    priorities: input.priorities,
    leagues: input.leagues ?? allLeagues,
    desiredLeagueCount: input.desiredLeagueCount,
    returnRightLeagueIds: input.returnRightLeagueIds ?? [],
    returnEligibleMemberIdsByLeagueId: input.returnEligibleMemberIdsByLeagueId,
    playInEntry: input.playInEntry,
    byotEntry: input.byotEntry,
    priorLeagueDecisions: (input.sabbaticalLeagueIds ?? []).map((leagueId) => ({
      leagueId,
      decision: 'sabbatical' as const,
    })),
    registrantMemberId: 100,
    registrationState: input.registrationState,
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

  test('a play-in league is lifted above every other league', () => {
    expect(normalizePriorityOrder(ranked(1, 2, 5), allLeagues)).toEqual(ranked(5, 1, 2));
  });

  test('a bring-your-own-team league that is not play-in based stays in place', () => {
    expect(normalizePriorityOrder(ranked(1, 2, 4), allLeagues)).toEqual(ranked(1, 2, 4));
  });

  test('lifting play-in leagues preserves the order within each block', () => {
    expect(normalizePriorityOrder(ranked(1, 5, 2, 4), allLeagues)).toEqual(ranked(5, 1, 2, 4));
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

  test('re-seeding last-session leagues drops a leftover drop for a listed play-in league', () => {
    const payload: RegistrationLeagueCatalogPayload = {
      ...basePayload,
      priorSeasonLeagueIds: [5],
      priorLeagueDecisions: [{ leagueId: 5, decision: 'drop' }],
    };
    const priorities = hydratePriorityList(payload);
    expect(priorities.map((entry) => entry.leagueId)).toEqual([5]);
    expect(omitLeaveBehindDecisionsForListedLeagues(payload.priorLeagueDecisions, priorities)).toEqual([]);
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

  test('seeding still respects the play-in clamp', () => {
    expect(seedPriorityList({ ...basePayload, priorSeasonLeagueIds: [1, 5] })).toEqual(ranked(5, 1));
  });

  test('seeding does not lift a bring-your-own-team league that is not play-in based', () => {
    expect(seedPriorityList({ ...basePayload, priorSeasonLeagueIds: [1, 4] })).toEqual(ranked(1, 4));
  });

  test('an existing play-in team seeds the league onto an empty list', () => {
    expect(
      seedPriorityList({
        ...basePayload,
        playInEntry: { 5: existingPlayInSummary() },
      }).map((priority) => priority.leagueId),
    ).toEqual([5, 1, 2]);
  });

  test('an existing play-in team is added onto a saved list that omitted it', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: ranked(1, 2),
        playInEntry: { 5: existingPlayInSummary() },
      }).map((priority) => priority.leagueId),
    ).toEqual([5, 1, 2]);
  });

  test('an existing play-in team fills an empty roster from the declared team', () => {
    const priorities = hydratePriorityList({
      ...basePayload,
      priorSeasonLeagueIds: [5],
      playInEntry: { 5: existingPlayInSummary() },
    });
    expect(priorities).toEqual([
      {
        leagueId: 5,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }, { memberId: 100 }],
        byotTeammateText: null,
      },
    ]);
  });

  test('an existing play-in team does not overwrite a roster the registrant already declared', () => {
    const saved = [
      {
        leagueId: 5,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 30 }],
        byotTeammateText: 'Dana Pending',
      },
    ];
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: saved,
        playInEntry: { 5: existingPlayInSummary() },
      }),
    ).toEqual(saved);
  });

  test('merge leaves the list unchanged when the existing play-in league is already present with a roster', () => {
    const current = [
      {
        leagueId: 5,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }, { memberId: 100 }],
        byotTeammateText: null,
      },
    ];
    expect(
      mergeExistingPlayInTeamLeagues(current, {
        ...basePayload,
        playInEntry: { 5: existingPlayInSummary() },
      }),
    ).toBe(current);
  });

  test('a catalog refresh only inserts play-in teams discovered since the last snapshot', () => {
    const current = ranked(1, 2);
    const payload = { ...basePayload, playInEntry: { 5: existingPlayInSummary() } };
    expect(mergeNewlyDiscoveredPlayInTeamLeagues(current, payload, new Set([5]))).toBe(current);
    expect(
      mergeNewlyDiscoveredPlayInTeamLeagues(current, payload, new Set()).map((priority) => priority.leagueId),
    ).toEqual([5, 1, 2]);
  });

  test('auto-seeded existing play-in teams raise the desired league count', () => {
    const payload: RegistrationLeagueCatalogPayload = {
      ...basePayload,
      playInEntry: { 5: existingPlayInSummary() },
    };
    const next = hydratePriorityList(payload);
    expect(addedExistingPlayInTeamCount(payload, next)).toBe(1);
    expect(bumpDesiredLeagueCount(defaultDesiredLeagueCount(payload), 1)).toBe(3);
  });

  test('copying an existing play-in roster omits the registering curler', () => {
    expect(
      priorityRosterFromPlayInTeamMembers(
        [
          { memberId: 100, pendingName: null },
          { memberId: 21, pendingName: null },
          { memberId: null, pendingName: 'Dana Pending' },
        ],
        100,
      ),
    ).toEqual({
      teamRosterPlacements: [{ memberId: 21 }],
      byotTeammateText: 'Dana Pending',
    });
  });

  test('an existing doubles team seeds the league onto an empty list', () => {
    expect(
      seedPriorityList({
        ...basePayload,
        byotEntry: { 4: existingByotSummary() },
      }).map((priority) => priority.leagueId),
    ).toEqual([4, 1, 2]);
  });

  test('an existing doubles team is added onto a saved list that omitted it', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: ranked(1, 2),
        byotEntry: { 4: existingByotSummary() },
      }).map((priority) => priority.leagueId),
    ).toEqual([4, 1, 2]);
  });

  test('an existing doubles team fills an empty roster from the declared pair', () => {
    const priorities = hydratePriorityList({
      ...basePayload,
      priorSeasonLeagueIds: [4],
      byotEntry: { 4: existingByotSummary() },
    });
    expect(priorities).toEqual([
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }, { memberId: 100 }],
        byotTeammateText: null,
      },
    ]);
  });

  test('an existing doubles team does not overwrite a roster the registrant already declared', () => {
    const saved = [
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 30 }],
        byotTeammateText: null,
      },
    ];
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: saved,
        byotEntry: { 4: existingByotSummary() },
      }),
    ).toEqual(saved);
  });

  test('an existing doubles team replaces a free-text partner name with linked members', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorSeasonLeagueIds: [4],
        priorities: [
          {
            leagueId: 4,
            priorityRank: 1,
            teamRosterPlacements: [],
            byotTeammateText: 'Alice Skip',
          },
        ],
        byotEntry: { 4: existingByotSummary() },
      }),
    ).toEqual([
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }, { memberId: 100 }],
        byotTeammateText: null,
      },
    ]);
  });

  test('a catalog refresh only inserts doubles teams discovered since the last snapshot', () => {
    const current = ranked(1, 2);
    const payload = { ...basePayload, byotEntry: { 4: existingByotSummary() } };
    expect(mergeNewlyDiscoveredPlayInTeamLeagues(current, payload, new Set([4]))).toBe(current);
    expect(
      mergeNewlyDiscoveredPlayInTeamLeagues(current, payload, new Set()).map((priority) => priority.leagueId),
    ).toEqual([4, 1, 2]);
  });

  test('auto-seeded existing doubles teams raise the desired league count', () => {
    const payload: RegistrationLeagueCatalogPayload = {
      ...basePayload,
      byotEntry: { 4: existingByotSummary() },
    };
    const next = hydratePriorityList(payload);
    expect(addedExistingPlayInTeamCount(payload, next)).toBe(1);
    expect(bumpDesiredLeagueCount(defaultDesiredLeagueCount(payload), 1)).toBe(3);
  });

  test('adding a league copies an empty existing play-in roster', () => {
    expect(
      applyExistingPlayInTeamRosterIfEmpty(
        ranked(5, 1),
        5,
        existingPlayInSummary().existingTeam!,
        100,
      ),
    ).toEqual([
      {
        leagueId: 5,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }],
        byotTeammateText: null,
      },
      { leagueId: 1, priorityRank: 2 },
    ]);
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
    ).toBe(1);
    expect(defaultDesiredLeagueCount({ ...basePayload, desiredLeagueCount: 1 })).toBe(1);
  });

  test('saved priorities keep a waitlist league off the list after the registrant removed it', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: ranked(1, 2),
        existingWaitlistEntries: [{ waitlistId: 7, leagueId: 3, status: 'active' }],
      }),
    ).toEqual(ranked(1, 2));
  });

  test('an empty saved list still seeds last-session leagues plus active waitlists', () => {
    expect(
      hydratePriorityList({
        ...basePayload,
        priorities: [],
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

  test('a catalog refresh only inserts waitlist leagues joined since the last snapshot', () => {
    const current = ranked(1, 2);
    const payload = {
      ...basePayload,
      existingWaitlistEntries: [
        { waitlistId: 7, leagueId: 3, status: 'active' },
        { waitlistId: 8, leagueId: 2, status: 'active' },
      ],
    };
    expect(mergeNewlyJoinedWaitlistLeagues(current, payload, new Set([3]))).toEqual(ranked(1, 2));
    expect(mergeNewlyJoinedWaitlistLeagues(current, payload, new Set()).map((priority) => priority.leagueId)).toEqual([
      3, 1, 2,
    ]);
  });

  test('omitted waitlist leagues are those on an active waitlist but not on the priority list', () => {
    const payload = {
      ...basePayload,
      existingWaitlistEntries: [
        { waitlistId: 7, leagueId: 3, status: 'active' },
        { waitlistId: 8, leagueId: 2, status: 'active' },
        { waitlistId: 9, leagueId: 1, status: 'removed' },
      ],
    };
    expect(omittedWaitlistLeagues(payload, ranked(2)).map((league) => league.id)).toEqual([3]);
    expect(omittedWaitlistLeagues(payload, ranked(2, 3))).toEqual([]);
  });

  test('conjunction lists use and before the last name', () => {
    expect(formatConjunctionList(['Monday'])).toBe('Monday');
    expect(formatConjunctionList(['Monday', 'Tuesday'])).toBe('Monday and Tuesday');
    expect(formatConjunctionList(['Monday', 'Tuesday', 'Wednesday'])).toBe('Monday, Tuesday, and Wednesday');
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

  test('drag drop targets stay within the play-in or other block', () => {
    expect(canReorderPriorityDrop({ leagueId: 1, priorityRank: 1 }, { leagueId: 2, priorityRank: 2 }, allLeagues)).toBe(
      true,
    );
    expect(canReorderPriorityDrop({ leagueId: 4, priorityRank: 1 }, { leagueId: 1, priorityRank: 2 }, allLeagues)).toBe(
      true,
    );
    expect(canReorderPriorityDrop({ leagueId: 1, priorityRank: 2 }, { leagueId: 4, priorityRank: 1 }, allLeagues)).toBe(
      true,
    );
    expect(canReorderPriorityDrop({ leagueId: 5, priorityRank: 1 }, { leagueId: 1, priorityRank: 2 }, allLeagues)).toBe(
      false,
    );
    expect(canReorderPriorityDrop({ leagueId: 1, priorityRank: 2 }, { leagueId: 5, priorityRank: 1 }, allLeagues)).toBe(
      false,
    );
    expect(canReorderPriorityDrop({ leagueId: 5, priorityRank: 1 }, { leagueId: 4, priorityRank: 2 }, allLeagues)).toBe(
      false,
    );
  });

  test('move up and down buttons stay inside each block', () => {
    const list = ranked(5, 4, 1, 2);
    expect(canMovePriority(list, 5, 'down', allLeagues)).toBe(false);
    expect(canMovePriority(list, 4, 'up', allLeagues)).toBe(false);
    expect(canMovePriority(list, 4, 'down', allLeagues)).toBe(true);
    expect(canMovePriority(list, 1, 'up', allLeagues)).toBe(true);
    expect(canMovePriority(list, 1, 'down', allLeagues)).toBe(true);
    expect(movePriorityInList(list, 4, 'down', allLeagues).map((priority) => priority.leagueId)).toEqual([5, 1, 4, 2]);
    expect(movePriorityInList(list, 1, 'up', allLeagues).map((priority) => priority.leagueId)).toEqual([5, 1, 4, 2]);
    expect(movePriorityInList(list, 5, 'down', allLeagues)).toBe(list);
  });

  test('disabled move tooltips explain the play-in boundary only', () => {
    const list = ranked(5, 4, 1, 2);
    expect(priorityMoveButtonTitle(list, 5, 'down', allLeagues, 'Competitive')).toBe(
      'Cannot move down. Play-in leagues must be prioritized higher than other leagues.',
    );
    expect(priorityMoveButtonTitle(list, 4, 'up', allLeagues, 'Sunday Doubles')).toBe(
      'Cannot move up. Play-in leagues must be prioritized higher than other leagues.',
    );
    expect(priorityMoveButtonTitle(list, 5, 'up', allLeagues, 'Competitive')).toBeUndefined();
    expect(priorityMoveButtonTitle(list, 4, 'down', allLeagues, 'Sunday Doubles')).toBe('Move Sunday Doubles down');
    expect(priorityMoveButtonTitle(list, 1, 'up', allLeagues, 'Monday')).toBe('Move Monday up');
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

  test('waitlists above a fallback stay waitlisted after a guaranteed return', () => {
    const thursday = catalogLeague({ id: 7, name: 'Thursday' });
    const result = evaluate({
      priorities: ranked(1, 3, 7, 2),
      desiredLeagueCount: 2,
      returnRightLeagueIds: [1, 2],
      leagues: [...allLeagues, thursday],
    });
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'guaranteed_return',
      'waitlisted',
      'waitlisted',
      'guaranteed_fallback',
    ]);
  });

  test('a league with no waitlist and no return right is subject to availability', () => {
    const result = evaluate({ priorities: ranked(4), desiredLeagueCount: 1 });
    expect(result.entries[0]?.label).toBe('subject_to_availability');
    expect(result.guaranteedCount).toBe(0);
    expect(result.confirmedLeagueFeeMinor).toBe(0);
    expect(result.maximumLeagueFeeMinor).toBe(result.entries[0]?.feeMinor);
  });

  test('an instructional program with remaining space reads as available and is billed now', () => {
    const instructional = catalogLeague({
      id: 6,
      name: 'Saturday Instructional',
      format: 'instructional',
      allowsWaitlist: false,
      openSpotCount: 20,
      activeWaitlistEntryCount: 0,
      registrationFeeMinor: 15000,
    });
    const result = evaluate({
      priorities: ranked(6),
      desiredLeagueCount: 1,
      leagues: [instructional],
    });
    expect(result.entries[0]?.label).toBe('available');
    expect(result.confirmedLeagueFeeMinor).toBe(15000);
  });

  test('a full instructional program is subject to availability and is not billed yet', () => {
    const instructional = catalogLeague({
      id: 6,
      name: 'Saturday Instructional',
      format: 'instructional',
      allowsWaitlist: false,
      openSpotCount: 0,
      activeWaitlistEntryCount: 0,
      registrationFeeMinor: 15000,
    });
    const result = evaluate({
      priorities: ranked(6),
      desiredLeagueCount: 1,
      leagues: [instructional],
    });
    expect(result.entries[0]?.label).toBe('subject_to_availability');
    expect(result.confirmedLeagueFeeMinor).toBe(0);
    expect(result.maximumLeagueFeeMinor).toBe(15000);
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

  test('an incomplete play-in roster does not make later leagues superfluous', () => {
    const priorities: LeaguePriorityInput[] = [
      { leagueId: 5, priorityRank: 1, teamRosterPlacements: [{ memberId: 100 }, { memberId: 101 }] },
      { leagueId: 1, priorityRank: 2 },
    ];
    expect(
      evaluate({
        priorities,
        desiredLeagueCount: 1,
        returnRightLeagueIds: [1],
        playInEntry: { 5: { guaranteed: true } },
      }).entries.map((entry) => entry.label),
    ).toEqual(['awaiting_roster_entry', 'guaranteed_return']);
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
    expect(
      evaluate({
        priorities,
        desiredLeagueCount: 1,
        returnRightLeagueIds: [4],
      }).entries[0]?.label,
    ).toBe('subject_to_availability');
  });

  test('a registrant listed on a returning doubles pair is guaranteed even with an empty local roster', () => {
    expect(
      evaluate({
        priorities: [{ leagueId: 4, priorityRank: 1 }],
        desiredLeagueCount: 1,
        returnRightLeagueIds: [4],
        returnEligibleMemberIdsByLeagueId: { 4: [100, 21] },
        byotEntry: { 4: existingByotSummary() },
      }).entries[0]?.label,
    ).toBe('guaranteed_return');
  });

  test('a listed doubles teammate with the partner as free-text is still guaranteed from the existing pair', () => {
    expect(
      evaluate({
        priorities: [
          {
            leagueId: 4,
            priorityRank: 1,
            teamRosterPlacements: [],
            byotTeammateText: 'Mike Hartman',
          },
        ],
        desiredLeagueCount: 1,
        returnRightLeagueIds: [4],
        returnEligibleMemberIdsByLeagueId: { 4: [100, 21] },
        byotEntry: { 4: existingByotSummary() },
      }).entries[0]?.label,
    ).toBe('guaranteed_return');
  });

  test('wanting one league caps the guarantees at one', () => {
    const result = evaluate({ priorities: ranked(1, 2), desiredLeagueCount: 1, returnRightLeagueIds: [1, 2] });
    expect(result.entries.map((entry) => entry.label)).toEqual(['guaranteed_return', 'superfluous']);
  });

  test('two guaranteed returns leave extra leagues subject to availability as backups', () => {
    const result = evaluate({
      priorities: ranked(1, 2, 3, 4),
      desiredLeagueCount: 3,
      returnRightLeagueIds: [1, 2],
    });
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'guaranteed_return',
      'guaranteed_return',
      'subject_to_availability',
      'subject_to_availability',
    ]);
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
    expect(guaranteeChipLabel('guaranteed_return', playInLeague)).toBe('Guaranteed entry');
    expect(guaranteeChipLabel('awaiting_roster_entry')).toBe('Awaiting roster entry');
    expect(guaranteeChipLabel('guaranteed_fallback')).toBe('Guaranteed fallback');
    expect(leagueCatalogAvailabilityLabel({ openSpotCount: 4, activeWaitlistEntryCount: 0 })).toBe('Available');
    expect(
      leagueCatalogAvailabilityLabel({ allowsWaitlist: true, openSpotCount: 0, activeWaitlistEntryCount: 3 }),
    ).toBe('Waitlist');
    expect(
      leagueCatalogAvailabilityLabel({ allowsWaitlist: false, openSpotCount: 0, activeWaitlistEntryCount: 0 }),
    ).toBe('Subject to availability');
    expect(guaranteeChipLabel('available')).toBe('Available');
    expect(guaranteeChipLabel('temporary_spot_available')).toBe('Temporary spot available');
    expect(guaranteeChipLabel('waitlisted')).toBe('Waitlisted');
    expect(guaranteeChipLabel('subject_to_availability')).toBe('Subject to availability');
    expect(guaranteeChipLabel('superfluous')).toBe('Superfluous');
    expect(shouldShowGuaranteeChip('subject_to_availability')).toBe(true);
    expect(shouldShowGuaranteeChip('superfluous')).toBe(true);
    expect(shouldShowGuaranteeChip('waitlisted')).toBe(true);
    expect(shouldShowGuaranteeChip('available')).toBe(true);
    expect(formatPriorityOrdinal(1)).toBe('1st');
    expect(formatPriorityOrdinal(2)).toBe('2nd');
    expect(formatPriorityOrdinal(3)).toBe('3rd');
    expect(formatPriorityOrdinal(4)).toBe('4th');
    expect(formatPriorityOrdinal(11)).toBe('11th');
    expect(formatPriorityOrdinal(21)).toBe('21st');
    expect(rosterGuaranteeChipLabel('guaranteed_return', 1)).toBe('Guaranteed return');
    expect(rosterGuaranteeChipLabel('guaranteed_fallback', 2)).toBe('Guaranteed fallback');
    expect(rosterGuaranteeChipLabel('subject_to_availability', 3)).toBe(
      'Subject to availability (3rd priority)',
    );
    expect(rosterGuaranteeChipLabel('subject_to_availability', 1, playInLeague)).toBe(
      'Subject to availability (1st priority)',
    );
    expect(rosterGuaranteeChipLabel('guaranteed_return', 1, playInLeague)).toBe('Guaranteed entry');
  });

  test('a non-play-in BYOT guaranteed return adds an asterisk and teammate-priority footnote', () => {
    const teamsByot = catalogLeague({
      id: 8,
      name: 'Thursday Teams',
      leagueType: 'bring_your_own_team',
      format: 'teams',
      allowsWaitlist: false,
    });
    expect(guaranteeChipLabel('guaranteed_return', teamLeague)).toBe('Guaranteed return*');
    expect(guaranteeChipLabel('guaranteed_return', teamsByot)).toBe('Guaranteed return*');
    expect(guaranteeChipLabel('guaranteed_return', playInLeague)).toBe('Guaranteed entry');
    expect(guaranteeChipLabel('guaranteed_fallback', teamLeague)).toBe('Guaranteed fallback');
    expect(byotGuaranteedReturnFootnote(teamLeague)).toBe(
      '* Doubles partner must also choose this league as their first or second priority.',
    );
    expect(byotGuaranteedReturnFootnote(teamsByot)).toBe(
      '* All teammates must also choose this league as their first or second priority.',
    );
    expect(
      byotGuaranteedReturnFootnotes(
        [
          { label: 'guaranteed_return', league: teamLeague },
          { label: 'guaranteed_return', league: teamsByot },
          { label: 'guaranteed_return', league: playInLeague },
          { label: 'guaranteed_return', league: standardA },
        ],
        'caveat',
      ),
    ).toEqual([
      {
        id: 'caveat-doubles',
        text: '* Doubles partner must also choose this league as their first or second priority.',
      },
      {
        id: 'caveat-teams',
        text: '* All teammates must also choose this league as their first or second priority.',
      },
    ]);
    expect(guaranteeChipLabel('guaranteed_return', teamLeague, { onExistingTeam: true })).toBe('Guaranteed return');
    expect(guaranteeChipLabel('guaranteed_return', teamsByot, { onExistingTeam: true })).toBe('Guaranteed return*');
    expect(
      byotGuaranteedReturnFootnotes(
        [{ label: 'guaranteed_return', league: teamLeague, onExistingTeam: true }],
        'caveat',
      ),
    ).toEqual([]);
  });

  test('open registration uses vacancy labels instead of return guarantees', () => {
    const vacantLeagues = [
      catalogLeague({ id: 1, name: 'Monday', openSpotCount: 4, activeWaitlistEntryCount: 1 }),
      catalogLeague({ id: 2, name: 'Tuesday', openSpotCount: 2, activeWaitlistEntryCount: 0 }),
      catalogLeague({ id: 3, name: 'Wednesday', openSpotCount: 6, activeWaitlistEntryCount: 0 }),
    ];
    const result = evaluate({
      priorities: ranked(1, 2, 3),
      desiredLeagueCount: 3,
      returnRightLeagueIds: [1, 2],
      registrationState: 'open',
      leagues: vacantLeagues,
    });
    expect(result.entries.map((entry) => entry.label)).toEqual([
      'available',
      'available',
      'subject_to_availability',
    ]);
    expect(result.guaranteedCount).toBe(0);
  });

  test('open registration waitlists a sabbatical-fill vacancy instead of placing it', () => {
    const result = evaluate({
      priorities: ranked(1),
      desiredLeagueCount: 1,
      registrationState: 'open',
      leagues: [
        catalogLeague({
          id: 1,
          name: 'Monday',
          openSpotCount: 0,
          activeWaitlistEntryCount: 5,
          temporarySabbaticalFillVacancyCount: 1,
        }),
      ],
    });
    expect(result.entries[0]?.label).toBe('waitlisted');
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

  test('Junior Recreational last-session play does not require a keep-or-leave', () => {
    const juniorLeague = catalogLeague({ id: 9, name: 'Junior Recreational', isJuniorRecreational: true });
    expect(
      undecidedPriorLeagueIds({
        priorSeasonLeagueIds: [9, 1],
        priorities: ranked(1),
        priorLeagueDecisions: [],
        leagues: [...allLeagues, juniorLeague],
      }),
    ).toEqual([]);
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

describe('sabbatical-only last-session choices', () => {
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

  test('lists only sabbatical-eligible last-session leagues', () => {
    expect(
      sabbaticalEligiblePriorLeagues({
        priorSeasonLeagueIds: [1, 4, 2],
        leagues: allLeagues,
      }).map((league) => league.id),
    ).toEqual([1, 2]);
    expect(isSabbaticalEligibleLeague(standardA)).toBe(true);
    expect(isSabbaticalEligibleLeague(teamLeague)).toBe(false);
  });

  test('defaults continuing sabbaticals to extend and drops ineligible last-session leagues', () => {
    expect(
      defaultSabbaticalOnlyDecisions({
        priorSeasonLeagueIds: [1, 4],
        priorLeagueDecisions: [],
        continuingSabbaticals: [continuing({ leagueId: 10 }), continuing({ leagueId: 11 })],
        leagues: allLeagues,
      }),
    ).toEqual([
      { leagueId: 4, decision: 'drop' },
      { leagueId: 10, decision: 'sabbatical' },
      { leagueId: 11, decision: 'sabbatical' },
    ]);
  });

  test('does not default a third continuing sabbatical when two are already extended', () => {
    expect(
      defaultSabbaticalOnlyDecisions({
        priorSeasonLeagueIds: [],
        priorLeagueDecisions: [],
        continuingSabbaticals: [
          continuing({ leagueId: 10 }),
          continuing({ leagueId: 11 }),
          continuing({ leagueId: 12 }),
        ],
        leagues: allLeagues,
      })
        .filter((entry) => entry.decision === 'sabbatical')
        .map((entry) => entry.leagueId),
    ).toEqual([10, 11]);
  });

  test('keeps a saved drop instead of re-defaulting to extend', () => {
    expect(
      defaultSabbaticalOnlyDecisions({
        priorSeasonLeagueIds: [],
        priorLeagueDecisions: [{ leagueId: 10, decision: 'drop' }],
        continuingSabbaticals: [continuing({ leagueId: 10 })],
        leagues: allLeagues,
      }),
    ).toEqual([{ leagueId: 10, decision: 'drop' }]);
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

describe('league priority intro', () => {
  const beginnerEligibility = {
    dateOfBirth: '2010-01-01',
    experienceType: 'none_or_minimal' as const,
    membershipOption: 'regular' as const,
  };

  test('shows the intro when only instructional programs are eligible', () => {
    const instructional = catalogLeague({
      id: 20,
      name: 'Learn to Curl',
      format: 'instructional',
      minExperienceYears: 0,
    });
    const experienced = catalogLeague({
      id: 21,
      name: 'Monday Night',
      format: 'teams',
      minExperienceYears: 1,
    });
    expect(shouldShowLeaguePriorityIntro([instructional, experienced], beginnerEligibility)).toBe(true);
  });

  test('skips the intro when no leagues are eligible', () => {
    const experienced = catalogLeague({
      id: 21,
      name: 'Monday Night',
      format: 'teams',
      minExperienceYears: 1,
    });
    expect(shouldShowLeaguePriorityIntro([experienced], beginnerEligibility)).toBe(false);
  });

  test('shows the intro when a non-instructional league is eligible', () => {
    const instructional = catalogLeague({
      id: 20,
      name: 'Learn to Curl',
      format: 'instructional',
    });
    const openLeague = catalogLeague({
      id: 21,
      name: 'Monday Night',
      format: 'teams',
    });
    expect(shouldShowLeaguePriorityIntro([instructional, openLeague], beginnerEligibility)).toBe(true);
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

  test('is not seeded onto a returning-member priority list', () => {
    const juniorLeague = catalogLeague({ id: 9, name: 'Junior Recreational', isJuniorRecreational: true });
    expect(
      hydratePriorityList({
        leagues: [...allLeagues, juniorLeague],
        priorities: [],
        desiredLeagueCount: null,
        maxDesiredLeagueCount: 5,
        priorSeasonLeagueIds: [9, 1],
        priorLeagueDecisions: [],
        activeLeagueIds: [],
        participatedLeagueIds: [9, 1],
        returnRightLeagueIds: [9, 1],
        basicIceFallbackInterest: null,
        collectBasicIceFallback: false,
      }).map((priority) => priority.leagueId),
    ).toEqual([1]);
  });
});

describe('league schedule text', () => {
  test('includes the draw time after the weekday', () => {
    expect(leagueScheduleText({ dayOfWeek: 2, drawTimes: ['18:15'] })).toBe('Tuesday 6:15pm');
  });

  test('joins multiple draw times with and', () => {
    expect(leagueScheduleText({ dayOfWeek: 2, drawTimes: ['18:15', '20:30'] })).toBe('Tuesday 6:15pm and 8:30pm');
  });

  test('falls back to the weekday when no draw times are configured', () => {
    expect(leagueScheduleText({ dayOfWeek: 2, drawTimes: [] })).toBe('Tuesday');
  });
});

describe('editValidationErrorMessage', () => {
  test('shows membership payment detail messages instead of the generic envelope', () => {
    const error = new AxiosError('Request failed');
    error.response = {
      data: {
        error: 'Registration membership payment validation failed',
        details: {
          iceLeagues: 'Add at least one league to your priority list to continue with league play.',
        },
      },
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} } as never,
    };
    expect(editValidationErrorMessage(error, 'Unable to submit registration.')).toBe(
      'Add at least one league to your priority list to continue with league play.',
    );
  });
});
