import { describe, expect, test } from 'bun:test';
import { diffRosters, isFreeRebuildLeague, registrationMayJoinLeague, runRosterRebuildStage } from './rosterRebuildEngine.js';
import { parseLeagueCategoryMapJson, resolveLeagueCategoryFromName } from './rosterRebuildLeagues.js';
import type {
  RosterRebuildLeague,
  RosterRebuildMember,
  RosterRebuildRegistration,
  RosterRebuildSnapshot,
  RosterRebuildWaitlistEntry,
} from './rosterRebuildTypes.js';

function league(input: Partial<RosterRebuildLeague> & Pick<RosterRebuildLeague, 'id' | 'name' | 'category'>): RosterRebuildLeague {
  return {
    sessionId: 1,
    format: 'teams',
    capacityType: 'individual',
    capacityValue: 4,
    waitlistId: input.id * 10,
    predecessorLeagueId: input.id + 100,
    predecessorName: `Winter ${input.name}`,
    isPlayInBased: false,
    isJuniorRecreational: input.category === 'junior_rec',
    registrationFeeMinor: input.category === 'day_league' ? 0 : 15000,
    ...input,
  };
}

function member(input: Partial<RosterRebuildMember> & { memberId: number; name: string }): RosterRebuildMember {
  return {
    email: `${input.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    isLifetimeMember: false,
    clubTenureYears: 1,
    totalExperienceYears: 1,
    ...input,
  };
}

function registration(
  input: Partial<RosterRebuildRegistration> & { id: number; memberId: number; priorities: RosterRebuildRegistration['priorities'] },
): RosterRebuildRegistration {
  return {
    status: 'paid',
    desiredLeagueCount: 2,
    membershipOption: 'regular',
    juniorRecreationalSelection: false,
    sabbaticalLeagueIds: [],
    submittedAt: '2026-08-20T12:00:00.000Z',
    receivedDuringPriorityPeriod: true,
    icePrivilegesChoice: 'league_play',
    ...input,
  };
}

function waitlistEntry(
  input: Partial<RosterRebuildWaitlistEntry> & { id: number; waitlistId: number; memberId: number; position: number },
): RosterRebuildWaitlistEntry {
  return {
    declineCount: 0,
    priorityRankSnapshot: null,
    desiredLeagueCountSnapshot: null,
    status: 'active',
    ...input,
  };
}

function snapshot(input: Partial<RosterRebuildSnapshot> & { leagues: RosterRebuildLeague[] }): RosterRebuildSnapshot {
  const members = new Map<number, RosterRebuildMember>();
  for (const row of input.members?.values() ?? []) members.set(row.memberId, row);
  return {
    sessionId: 1,
    sessionName: 'Fall 2026',
    currentRosters: [],
    predecessorRosters: [],
    registrations: [],
    waitlistEntriesByWaitlistId: new Map(),
    members,
    tuesdayEveningRosterMemberIds: new Set(),
    unmanagedOccupiedKeys: new Set(),
    activeSabbaticals: [],
    pendingOffers: [],
    duplicateRegistrationMemberIds: [],
    guaranteedReturnPlacementCount: 0,
    waitlistPlacementCount: 0,
    priorityPeriodEndAt: '2026-09-04T04:01:00.000Z',
    priorityPeriodEndSource: 'open_transition',
    ...input,
  };
}

function membersMap(...rows: RosterRebuildMember[]): Map<number, RosterRebuildMember> {
  return new Map(rows.map((row) => [row.memberId, row]));
}

describe('resolveLeagueCategoryFromName', () => {
  test('matches the planned Fall 2026 names', () => {
    expect(resolveLeagueCategoryFromName({ name: 'Hump Day' })).toBe('normal');
    expect(resolveLeagueCategoryFromName({ name: 'Sunday Funday (evening)' })).toBe('normal');
    expect(resolveLeagueCategoryFromName({ name: 'I Hate Mondays' })).toBe('normal');
    expect(resolveLeagueCategoryFromName({ name: 'Monday Late League' })).toBe('normal');
    expect(resolveLeagueCategoryFromName({ name: 'Early Doubles' })).toBe('doubles');
    expect(resolveLeagueCategoryFromName({ name: 'Late Doubles' })).toBe('doubles');
    expect(resolveLeagueCategoryFromName({ name: 'Junior Recreational', isJuniorRecreational: 1 })).toBe('junior_rec');
    expect(resolveLeagueCategoryFromName({ name: 'Junior Advanced Commitment' })).toBe('junior_adv');
    expect(resolveLeagueCategoryFromName({ name: 'Tuesday Evening', isPlayInBased: 1 })).toBe('tuesday_evening');
    expect(resolveLeagueCategoryFromName({ name: 'Tuesday Daytime' })).toBe('day_league');
    expect(resolveLeagueCategoryFromName({ name: 'Wednesday Day League' })).toBe('day_league');
    expect(resolveLeagueCategoryFromName({ name: 'Saturday Instructional' })).toBe('instructional');
    expect(resolveLeagueCategoryFromName({ name: 'Saturday Evening' })).toBe('normal');
    expect(resolveLeagueCategoryFromName({ name: 'Mystery League' })).toBe('unresolved');
  });

  test('parses league map overrides', () => {
    const map = parseLeagueCategoryMapJson({ '12': 'normal', 'Early Doubles': 'doubles' });
    expect(map['12']).toBe('normal');
    expect(map['Early Doubles']).toBe('doubles');
  });
});

describe('stage returning', () => {
  test('places rank 1-2 returners and reports rank 3+', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal' });
    const sunday = league({ id: 2, name: 'Sunday Morning', category: 'normal' });
    const mad = league({ id: 3, name: 'Mad Hatter', category: 'normal' });
    const xavier = member({ memberId: 10, name: 'Xavier' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump, sunday, mad],
        members: membersMap(xavier),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: 'staff_manual', isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 102, memberId: 10, status: 'completed', placementType: 'staff_manual', isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 103, memberId: 10, status: 'active', placementType: 'staff_manual', isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
              { leagueId: 3, rank: 3, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements.map((row) => row.leagueId).sort()).toEqual([1, 2]);
    expect(result.placements.every((row) => row.placementType === 'guaranteed_return')).toBe(true);
    expect(result.notes.some((note) => note.code === 'returner_rank_3_plus' && note.leagueId === 3)).toBe(true);
  });

  test('caps two returning leagues at desired count 1', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal' });
    const sunday = league({ id: 2, name: 'Sunday Morning', category: 'normal' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump, sunday],
        members: membersMap(member({ memberId: 10, name: 'Xavier' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 102, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements.map((row) => row.leagueId)).toEqual([1]);
    expect(result.notes.some((note) => note.code === 'returner_exceeds_desired' && note.leagueId === 2)).toBe(true);
  });

  test('places a returning doubles team and skips text-only partners', () => {
    const early = league({ id: 8, name: 'Early Doubles', category: 'doubles', predecessorLeagueId: 108 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [early],
        members: membersMap(member({ memberId: 10, name: 'Ann' }), member({ memberId: 11, name: 'Bob' })),
        predecessorRosters: [
          { leagueId: 108, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 108, memberId: 11, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            priorities: [{ leagueId: 8, rank: 1, teammateMemberIds: [11], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            priorities: [{ leagueId: 8, rank: 2, teammateMemberIds: [10], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements.map((row) => row.memberId).sort()).toEqual([10, 11]);

    const skipped = runRosterRebuildStage(
      snapshot({
        leagues: [early],
        members: membersMap(member({ memberId: 10, name: 'Ann' })),
        predecessorRosters: [
          { leagueId: 108, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            priorities: [{ leagueId: 8, rank: 1, teammateMemberIds: [], teammateText: 'Partner Name' }],
          }),
        ],
      }),
      'returning',
    );
    expect(skipped.placements).toHaveLength(0);
    expect(skipped.notes.some((note) => note.code === 'doubles_partner_text_only')).toBe(true);
  });

  test('rosters junior rec membership and junior advanced listings', () => {
    const rec = league({ id: 20, name: 'Junior Recreational', category: 'junior_rec' });
    const adv = league({ id: 21, name: 'Junior Advanced Commitment', category: 'junior_adv' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [rec, adv],
        members: membersMap(member({ memberId: 1, name: 'Kid Rec' }), member({ memberId: 2, name: 'Kid Adv' })),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            membershipOption: 'junior_recreational',
            priorities: [],
          }),
          registration({
            id: 2,
            memberId: 2,
            priorities: [{ leagueId: 21, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 1, leagueId: 20, placementType: 'new_placement' }),
        expect.objectContaining({ memberId: 2, leagueId: 21, placementType: 'new_placement' }),
      ]),
    );
  });

  test('skips members already on the target roster', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Xavier' })),
        currentRosters: [
          { leagueId: 1, memberId: 10, status: 'active', placementType: 'staff_manual', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
        ],
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements).toHaveLength(0);
    expect(result.notes.some((note) => note.code === 'already_rostered')).toBe(true);
  });

  test('places Winter returners who registered after the priority period', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Late' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            receivedDuringPriorityPeriod: false,
            submittedAt: '2026-09-05T02:33:09.798Z',
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 10, leagueId: 1, placementType: 'guaranteed_return' }),
    ]);
  });

  test('places junior programs for open-period registrations', () => {
    const rec = league({ id: 20, name: 'Junior Recreational', category: 'junior_rec' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [rec],
        members: membersMap(member({ memberId: 1, name: 'Kid Rec' })),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            membershipOption: 'junior_recreational',
            receivedDuringPriorityPeriod: false,
            priorities: [],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 1, leagueId: 20, placementType: 'new_placement' }),
    ]);
  });

  test('places a returning doubles team when a partner registered after the priority period', () => {
    const early = league({ id: 8, name: 'Early Doubles', category: 'doubles', predecessorLeagueId: 108 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [early],
        members: membersMap(member({ memberId: 10, name: 'Ann' }), member({ memberId: 11, name: 'Bob' })),
        predecessorRosters: [
          { leagueId: 108, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 108, memberId: 11, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            priorities: [{ leagueId: 8, rank: 1, teammateMemberIds: [11], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            receivedDuringPriorityPeriod: false,
            submittedAt: '2026-09-05T02:33:09.798Z',
            priorities: [{ leagueId: 8, rank: 2, teammateMemberIds: [10], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements.map((row) => row.memberId).sort()).toEqual([10, 11]);
  });
});

describe('ice privileges', () => {
  test('treats fee-0 leagues as free and requires league play for paid leagues', () => {
    expect(isFreeRebuildLeague({ registrationFeeMinor: 0 })).toBe(true);
    expect(isFreeRebuildLeague({ registrationFeeMinor: 15000 })).toBe(false);
    expect(registrationMayJoinLeague({ icePrivilegesChoice: 'basic_ice' }, { registrationFeeMinor: 0 })).toBe(true);
    expect(registrationMayJoinLeague({ icePrivilegesChoice: 'none' }, { registrationFeeMinor: 0 })).toBe(true);
    expect(registrationMayJoinLeague({ icePrivilegesChoice: 'basic_ice' }, { registrationFeeMinor: 15000 })).toBe(false);
    expect(registrationMayJoinLeague({ icePrivilegesChoice: 'league_play' }, { registrationFeeMinor: 15000 })).toBe(true);
  });

  test('does not place a basic-ice Winter returner on a paid league', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Basic' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            icePrivilegesChoice: 'basic_ice',
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'returning',
    );
    expect(result.placements).toHaveLength(0);
    expect(result.notes.some((note) => note.code === 'ice_privileges_blocks_paid_league' && note.leagueId === 1)).toBe(true);
  });

  test('still auto-grants a free day league to a basic-ice registrant', () => {
    const tueDay = league({ id: 40, name: 'Tuesday Daytime', category: 'day_league', waitlistId: null, registrationFeeMinor: 0 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tueDay],
        members: membersMap(member({ memberId: 10, name: 'Day' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            icePrivilegesChoice: 'basic_ice',
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'third-leagues',
    );
    expect(result.placements).toEqual([expect.objectContaining({ memberId: 10, leagueId: 40 })]);
  });

  test('skips a basic-ice waitlist entry on a paid league so a league-play registrant can take the seat', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Basic' }), member({ memberId: 11, name: 'League play' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            icePrivilegesChoice: 'basic_ice',
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 11, position: 2 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 11, leagueId: 1, placementType: 'waitlist' }),
    ]);
    expect(result.waitlistEvents.some((event) => event.memberId === 10 && event.outcome === 'skipped_ice_privileges')).toBe(true);
    expect(result.waitlistMutations.some((row) => row.entryId === 1)).toBe(false);
  });

  test('open registration skips a paid first choice and fills a free later choice for basic ice', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', waitlistId: 10, registrationFeeMinor: 15000 });
    const freeEvening = league({ id: 2, name: 'Saturday Evening', category: 'normal', waitlistId: 20, registrationFeeMinor: 0 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump, freeEvening],
        members: membersMap(member({ memberId: 1, name: 'Late basic' })),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            receivedDuringPriorityPeriod: false,
            icePrivilegesChoice: 'basic_ice',
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([[10, []], [20, []]]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 1, leagueId: 2, stage: 'open-registration' }),
    ]);
  });
});

describe('Xavier/Yasmin waitlist miss', () => {
  test('Xavier moves up from B to A after Yasmin takes C', () => {
    const a = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const b = league({ id: 2, name: 'Sunday Morning', category: 'normal', capacityValue: 1, waitlistId: 20 });
    const c = league({ id: 3, name: 'Sunday Funday', category: 'normal', capacityValue: 1, waitlistId: 30 });
    const xavier = member({ memberId: 100, name: 'Xavier' });
    const yasmin = member({ memberId: 200, name: 'Yasmin' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [a, b, c],
        members: membersMap(xavier, yasmin),
        registrations: [
          registration({
            id: 1,
            memberId: 100,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
          registration({
            id: 2,
            memberId: 200,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 3, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 1, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 200, position: 1 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 100, position: 2 }),
            ],
          ],
          [20, [waitlistEntry({ id: 3, waitlistId: 20, memberId: 100, position: 1 })]],
          [30, [waitlistEntry({ id: 4, waitlistId: 30, memberId: 200, position: 1 })]],
        ]),
      }),
      'waitlists',
    );

    expect(result.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 100, leagueId: 1, placementType: 'waitlist' }),
        expect.objectContaining({ memberId: 200, leagueId: 3, placementType: 'waitlist' }),
      ]),
    );
    expect(result.placements.some((row) => row.memberId === 100 && row.leagueId === 2)).toBe(false);
    expect(result.waitlistEvents.some((event) => event.memberId === 100 && event.outcome === 'moved_up')).toBe(true);
    expect(result.waitlistEvents.some((event) => event.memberId === 200 && event.outcome === 'moved_up')).toBe(true);
  });

  test('re-offers a released seat to the member who still has 1st/2nd-league room', () => {
    const monday = league({ id: 1, name: 'Monday Late League', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const leaguey = league({ id: 2, name: 'Leaguey McLeagueface', category: 'normal', capacityValue: 1, waitlistId: 20 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [monday, leaguey],
        members: membersMap(member({ memberId: 10, name: 'Julia' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 2, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 1, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
          [20, [waitlistEntry({ id: 2, waitlistId: 20, memberId: 10, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 10, leagueId: 2, placementType: 'waitlist' }),
        expect.objectContaining({ memberId: 10, leagueId: 1, placementType: 'waitlist' }),
      ]),
    );
  });
});

describe('waitlist processing details', () => {
  test('auto-declines waitlist entries whose league is not on the registration list', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 2, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Off list' }), member({ memberId: 11, name: 'Next' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 99, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 11, position: 2 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    expect(result.haltedLeagueIds).toEqual([]);
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 11, leagueId: 1, placementType: 'waitlist' }),
    ]);
    expect(result.waitlistEvents.some((event) => event.memberId === 10 && event.outcome === 'auto_declined')).toBe(true);
  });

  test('places open-period waitlist entries in waitlist order with everyone else', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Late' }), member({ memberId: 11, name: 'Priority' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 11, position: 2 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 10, leagueId: 1, placementType: 'waitlist' }),
    ]);
    expect(result.waitlistEvents.some((event) => event.outcome === 'skipped_open_registration')).toBe(false);
  });

  test('fills a new league with no predecessor from the waitlist', () => {
    const saturday = league({
      id: 38,
      name: 'Saturday Evening',
      category: 'normal',
      capacityValue: 1,
      waitlistId: 380,
      predecessorLeagueId: null,
    });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [saturday],
        members: membersMap(member({ memberId: 10, name: 'New' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 38, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [380, [waitlistEntry({ id: 1, waitlistId: 380, memberId: 10, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 10, leagueId: 38, placementType: 'waitlist' }),
    ]);
  });

  test('does not increment declines for lifetime members or Tuesday roster #1 waitlists', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 2, waitlistId: 10 });
    const lifetime = member({ memberId: 10, name: 'Life', isLifetimeMember: true });
    const tuesday = member({ memberId: 11, name: 'Tue' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(lifetime, tuesday),
        tuesdayEveningRosterMemberIds: new Set([11]),
        currentRosters: [
          { leagueId: 9, memberId: 10, status: 'active', placementType: 'staff_manual', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
          { leagueId: 9, memberId: 11, status: 'active', placementType: 'play_in', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1, declineCount: 4 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 11, position: 2, declineCount: 1 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    const lifeDecline = result.waitlistMutations.find((row) => row.entryId === 1);
    const tueDecline = result.waitlistMutations.find((row) => row.entryId === 2);
    expect(lifeDecline).toMatchObject({ kind: 'declined', immune: true, declineCountBefore: 4, declineCountAfter: 4 });
    expect(tueDecline).toMatchObject({ kind: 'declined', immune: true, declineCountBefore: 1, declineCountAfter: 1 });
  });

  test('increments a waitlist entry decline at most once per run', () => {
    const a = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const b = league({ id: 2, name: 'Sunday Morning', category: 'normal', capacityValue: 1, waitlistId: 20 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [a, b],
        members: membersMap(member({ memberId: 100, name: 'Xavier' })),
        registrations: [
          registration({
            id: 1,
            memberId: 100,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 100, position: 1 })]],
          [20, [waitlistEntry({ id: 2, waitlistId: 20, memberId: 100, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([expect.objectContaining({ leagueId: 1, memberId: 100 })]);
    const declined = result.waitlistMutations.filter((row) => row.kind === 'declined');
    expect(declined).toHaveLength(1);
    expect(declined[0]).toMatchObject({ entryId: 2, declineCountAfter: 1 });
    const placed = result.waitlistMutations.filter((row) => row.kind === 'placed');
    expect(placed).toEqual([expect.objectContaining({ entryId: 1 })]);
  });

  test('commits a rank-3+ returner as a reserved-seat guaranteed return', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Returner' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 2,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 10,
        leagueId: 1,
        placementType: 'guaranteed_return',
        isRank3PlusReturner: true,
      }),
    ]);
  });

  test('does not commit a rank-3+ hold when a play-in league already fills desired count', () => {
    const tuesday = league({
      id: 30,
      name: 'Tuesday League',
      category: 'tuesday_evening',
      isPlayInBased: true,
      capacityValue: 80,
    });
    const hump = league({ id: 33, name: 'Hump Day', category: 'normal', capacityValue: 40, waitlistId: 330 });
    const friday = league({ id: 36, name: 'Friday Evening', category: 'normal', capacityValue: 72, waitlistId: 360 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tuesday, hump, friday],
        members: membersMap(member({ memberId: 310, name: 'Meg Lorenzen' })),
        currentRosters: [
          {
            leagueId: 30,
            memberId: 310,
            status: 'removed',
            placementType: 'guaranteed_return',
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: 207,
          },
          {
            leagueId: 33,
            memberId: 310,
            status: 'active',
            placementType: 'guaranteed_return',
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: 207,
          },
        ],
        predecessorRosters: [
          { leagueId: 133, memberId: 310, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 136, memberId: 310, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        unmanagedOccupiedKeys: new Set(['30:310']),
        registrations: [
          registration({
            id: 207,
            memberId: 310,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 30, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 33, rank: 2, teammateMemberIds: [], teammateText: null },
              { leagueId: 36, rank: 3, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [360, [waitlistEntry({ id: 1, waitlistId: 360, memberId: 310, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([]);
    expect(result.notes.some((note) => note.code === 'returner_rank_3_plus_no_allowance' && note.leagueId === 36)).toBe(
      true,
    );
  });

  test('still commits a rank-3+ hold when the play-in team is no longer occupying a slot', () => {
    const tuesday = league({
      id: 30,
      name: 'Tuesday League',
      category: 'tuesday_evening',
      isPlayInBased: true,
      capacityValue: 80,
    });
    const hump = league({ id: 33, name: 'Hump Day', category: 'normal', capacityValue: 40, waitlistId: 330 });
    const friday = league({ id: 36, name: 'Friday Evening', category: 'normal', capacityValue: 1, waitlistId: 360 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tuesday, hump, friday],
        members: membersMap(member({ memberId: 310, name: 'Cut From Tuesday' })),
        currentRosters: [
          {
            leagueId: 33,
            memberId: 310,
            status: 'active',
            placementType: 'guaranteed_return',
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: 207,
          },
        ],
        predecessorRosters: [
          { leagueId: 136, memberId: 310, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 207,
            memberId: 310,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 30, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 33, rank: 2, teammateMemberIds: [], teammateText: null },
              { leagueId: 36, rank: 3, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [360, [waitlistEntry({ id: 1, waitlistId: 360, memberId: 310, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 310,
        leagueId: 36,
        placementType: 'guaranteed_return',
        isRank3PlusReturner: true,
      }),
    ]);
  });

  test('commits a rank-3+ open-period returner as a reserved-seat hold', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Late returner' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 2,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 10,
        leagueId: 1,
        placementType: 'guaranteed_return',
        isRank3PlusReturner: true,
      }),
    ]);
  });
});

describe('temporary sabbatical vacancies', () => {
  test('skips a rank 1-2 returner who listed the league as a sabbatical', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 4 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Away' })),
        predecessorRosters: [
          { leagueId: 101, memberId: 10, status: 'active', placementType: null, isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            sabbaticalLeagueIds: [1],
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 10, status: 'active' }],
      }),
      'returning',
    );
    expect(result.placements).toHaveLength(0);
    expect(result.notes.some((note) => note.code === 'returner_on_sabbatical' && note.leagueId === 1)).toBe(true);
    expect(result.leagueVacancies.find((row) => row.leagueId === 1)).toMatchObject({
      permanentVacancy: 3,
      temporaryVacancy: 1,
    });
  });

  test('fills permanent waitlist seats before temporary sabbatical vacancies', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 2, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(
          member({ memberId: 10, name: 'First' }),
          member({ memberId: 11, name: 'Second' }),
        ),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 99, status: 'active' }],
        waitlistEntriesByWaitlistId: new Map([
          [
            10,
            [
              waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 }),
              waitlistEntry({ id: 2, waitlistId: 10, memberId: 11, position: 2 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 10,
        leagueId: 1,
        placementType: 'waitlist',
        isTemporarySabbaticalFill: false,
      }),
      expect.objectContaining({
        memberId: 11,
        leagueId: 1,
        placementType: 'temporary_sabbatical_fill',
        isTemporarySabbaticalFill: true,
        relatedSabbaticalId: 50,
      }),
    ]);
    expect(result.waitlistMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: 1, kind: 'placed' }),
        expect.objectContaining({ entryId: 2, kind: 'temporary_fill' }),
      ]),
    );
    expect(result.waitlistMutations.some((row) => row.entryId === 2 && row.kind === 'placed')).toBe(false);
    expect(result.waitlistEvents.some((event) => event.entryId === 2 && event.outcome === 'placed_temporary')).toBe(true);
  });

  test('converts a lower permanent hold into a fallback sabbatical to take a higher-ranked temp seat', () => {
    const a = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const b = league({ id: 2, name: 'Sunday Morning', category: 'normal', capacityValue: 1, waitlistId: 20 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [a, b],
        members: membersMap(member({ memberId: 100, name: 'Xavier' }), member({ memberId: 200, name: 'Yasmin' })),
        registrations: [
          registration({
            id: 1,
            memberId: 100,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
          registration({
            id: 2,
            memberId: 200,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 2, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 99, status: 'active' }],
        predecessorRosters: [
          {
            leagueId: 102,
            memberId: 100,
            status: 'active',
            placementType: null,
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: null,
          },
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 100, position: 1 })]],
          [
            20,
            [
              waitlistEntry({ id: 2, waitlistId: 20, memberId: 100, position: 1 }),
              waitlistEntry({ id: 3, waitlistId: 20, memberId: 200, position: 2 }),
            ],
          ],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 100,
          leagueId: 1,
          placementType: 'temporary_sabbatical_fill',
          isTemporarySabbaticalFill: true,
          relatedSabbaticalId: 50,
        }),
        expect.objectContaining({
          memberId: 200,
          leagueId: 2,
          placementType: 'temporary_sabbatical_fill',
          isTemporarySabbaticalFill: true,
        }),
      ]),
    );
    expect(result.placements.some((row) => row.memberId === 100 && row.leagueId === 2)).toBe(false);
    expect(result.sabbaticalMutations).toEqual([
      expect.objectContaining({ memberId: 100, leagueId: 2, replacedByLeagueId: 1 }),
    ]);
    expect(result.waitlistEvents.some((event) => event.memberId === 100 && event.outcome === 'sabbatical_fallback')).toBe(
      true,
    );
    expect(result.waitlistMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: 1, kind: 'temporary_fill' }),
        expect.objectContaining({ entryId: 3, kind: 'temporary_fill' }),
      ]),
    );
    expect(result.waitlistMutations.some((row) => row.entryId === 2 && row.kind === 'placed')).toBe(false);
    expect(result.placements.find((row) => row.memberId === 200)?.relatedSabbaticalId).toBe(
      result.sabbaticalMutations[0]?.syntheticId,
    );
  });

  test('takes a temp seat in addition to a permanent hold when 1st/2nd-league room remains', () => {
    const a = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const b = league({ id: 2, name: 'Sunday Morning', category: 'normal', capacityValue: 1, waitlistId: 20 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [a, b],
        members: membersMap(member({ memberId: 100, name: 'Xavier' })),
        registrations: [
          registration({
            id: 1,
            memberId: 100,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 99, status: 'active' }],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 100, position: 1 })]],
          [20, [waitlistEntry({ id: 2, waitlistId: 20, memberId: 100, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 100, leagueId: 2, placementType: 'waitlist', isTemporarySabbaticalFill: false }),
        expect.objectContaining({
          memberId: 100,
          leagueId: 1,
          placementType: 'temporary_sabbatical_fill',
          isTemporarySabbaticalFill: true,
        }),
      ]),
    );
    expect(result.sabbaticalMutations).toHaveLength(0);
  });

  test('does not create a fallback sabbatical for a waitlist hold on a league they are not returning to', () => {
    const saturday = league({
      id: 38,
      name: 'Saturday Evening',
      category: 'normal',
      capacityValue: 1,
      waitlistId: 380,
      predecessorLeagueId: null,
    });
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump, saturday],
        members: membersMap(member({ memberId: 100, name: 'Xavier' })),
        registrations: [
          registration({
            id: 1,
            memberId: 100,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 38, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 99, status: 'active' }],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 100, position: 1 })]],
          [380, [waitlistEntry({ id: 2, waitlistId: 380, memberId: 100, position: 1 })]],
        ]),
      }),
      'waitlists',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 100,
        leagueId: 1,
        placementType: 'temporary_sabbatical_fill',
        isTemporarySabbaticalFill: true,
      }),
    ]);
    expect(result.placements.some((row) => row.leagueId === 38)).toBe(false);
    expect(result.sabbaticalMutations).toHaveLength(0);
    expect(result.waitlistEvents.some((event) => event.outcome === 'sabbatical_fallback')).toBe(false);
    expect(result.waitlistMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: 1, kind: 'temporary_fill' }),
        expect.objectContaining({ entryId: 2, kind: 'declined' }),
      ]),
    );
  });

  test('fills remaining temporary vacancies in the 3rd+ stage after permanent seats', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 3, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [
          hump,
          league({ id: 2, name: 'Other', category: 'normal' }),
          league({ id: 3, name: 'Else', category: 'normal' }),
        ],
        members: membersMap(
          member({ memberId: 1, name: 'Pat', clubTenureYears: 2, totalExperienceYears: 2 }),
          member({ memberId: 2, name: 'Quinn', clubTenureYears: 8, totalExperienceYears: 8 }),
        ),
        currentRosters: [
          { leagueId: 2, memberId: 1, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
          { leagueId: 3, memberId: 1, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
          { leagueId: 2, memberId: 2, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 2, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 1, memberId: 9, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: null },
          { leagueId: 1, memberId: 8, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: null },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 2,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        activeSabbaticals: [{ id: 50, leagueId: 1, memberId: 99, status: 'active' }],
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 2,
        leagueId: 1,
        placementType: 'temporary_sabbatical_fill',
        isTemporarySabbaticalFill: true,
        relatedSabbaticalId: 50,
      }),
    ]);
  });
});

describe('stage third-leagues', () => {
  test('picks the most tenured member, then experience, then seeded random', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 3, waitlistId: 10 });
    const baseRegs = [
      registration({
        id: 1,
        memberId: 1,
        desiredLeagueCount: 3,
        priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
      }),
      registration({
        id: 2,
        memberId: 2,
        desiredLeagueCount: 3,
        priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
      }),
    ];
    const currentRosters = [
      { leagueId: 2, memberId: 1, status: 'active' as const, placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
      { leagueId: 3, memberId: 1, status: 'active' as const, placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
      { leagueId: 2, memberId: 2, status: 'active' as const, placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
      { leagueId: 3, memberId: 2, status: 'active' as const, placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
    ];

    const byTenure = runRosterRebuildStage(
      snapshot({
        leagues: [hump, league({ id: 2, name: 'Other', category: 'normal' }), league({ id: 3, name: 'Else', category: 'normal' })],
        members: membersMap(
          member({ memberId: 1, name: 'Short', clubTenureYears: 1, totalExperienceYears: 20 }),
          member({ memberId: 2, name: 'Long', clubTenureYears: 8, totalExperienceYears: 8 }),
        ),
        currentRosters,
        registrations: baseRegs,
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(byTenure.placements[0]).toMatchObject({ memberId: 2, leagueId: 1 });

    const byExperience = runRosterRebuildStage(
      snapshot({
        leagues: [hump, league({ id: 2, name: 'Other', category: 'normal' }), league({ id: 3, name: 'Else', category: 'normal' })],
        members: membersMap(
          member({ memberId: 1, name: 'A', clubTenureYears: 5, totalExperienceYears: 6 }),
          member({ memberId: 2, name: 'B', clubTenureYears: 5, totalExperienceYears: 12 }),
        ),
        currentRosters,
        registrations: baseRegs,
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(byExperience.placements[0]).toMatchObject({ memberId: 2, leagueId: 1 });

    const seedA = runRosterRebuildStage(
      snapshot({
        leagues: [hump, league({ id: 2, name: 'Other', category: 'normal' }), league({ id: 3, name: 'Else', category: 'normal' })],
        members: membersMap(
          member({ memberId: 1, name: 'A', clubTenureYears: 5, totalExperienceYears: 5 }),
          member({ memberId: 2, name: 'B', clubTenureYears: 5, totalExperienceYears: 5 }),
        ),
        currentRosters,
        registrations: baseRegs,
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
      { randomSeed: 1 },
    );
    const seedB = runRosterRebuildStage(
      snapshot({
        leagues: [hump, league({ id: 2, name: 'Other', category: 'normal' }), league({ id: 3, name: 'Else', category: 'normal' })],
        members: membersMap(
          member({ memberId: 1, name: 'A', clubTenureYears: 5, totalExperienceYears: 5 }),
          member({ memberId: 2, name: 'B', clubTenureYears: 5, totalExperienceYears: 5 }),
        ),
        currentRosters,
        registrations: baseRegs,
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
      { randomSeed: 99 },
    );
    expect(seedA.placements[0]?.memberId).not.toEqual(seedB.placements[0]?.memberId);
  });

  test('gives leftover vacancy to a 1st/2nd waitlist entry before 3rd+ assignment', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Waitlisted' }), member({ memberId: 11, name: 'Third' })),
        currentRosters: [
          { leagueId: 2, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'third-leagues',
    );
    expect(result.placements.filter((row) => row.leagueId === 1)).toEqual([
      expect.objectContaining({ memberId: 10, placementType: 'waitlist', stage: 'third-leagues' }),
    ]);
    expect(result.notes.some((note) => note.code === 'waitlist_not_exhausted')).toBe(false);
  });

  test('assigns 3rd+ after leftover 1st/2nd waitlist demand is filled', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 4, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Waitlisted' }), member({ memberId: 11, name: 'Third' })),
        currentRosters: [
          { leagueId: 2, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'third-leagues',
    );
    expect(result.placements.filter((row) => row.leagueId === 1)).toEqual([
      expect.objectContaining({ memberId: 10, placementType: 'waitlist' }),
      expect.objectContaining({ memberId: 11, placementType: 'new_placement' }),
    ]);
  });

  test('does not block 3rd+ assignment for waitlist entries left off the registration list', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 4, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Off list' }), member({ memberId: 11, name: 'Third' })),
        currentRosters: [
          { leagueId: 2, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 99, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'third-leagues',
    );
    expect(result.notes.some((note) => note.code === 'waitlist_not_exhausted')).toBe(false);
    expect(result.placements.some((row) => row.memberId === 11 && row.leagueId === 1)).toBe(true);
  });

  test('auto-grants day leagues until desired count is met', () => {
    const tueDay = league({ id: 40, name: 'Tuesday Daytime', category: 'day_league', waitlistId: null });
    const wedDay = league({ id: 41, name: 'Wednesday Day', category: 'day_league', waitlistId: null });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tueDay, wedDay],
        members: membersMap(member({ memberId: 10, name: 'Day' })),
        currentRosters: [
          { leagueId: 1, memberId: 10, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 40, rank: 2, teammateMemberIds: [], teammateText: null },
              { leagueId: 41, rank: 3, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
      }),
      'third-leagues',
    );
    expect(result.placements.map((row) => row.leagueId)).toEqual([40]);
  });

  test('does not auto-grant a day league past capacity', () => {
    const tueDay = league({ id: 40, name: 'Tuesday Daytime', category: 'day_league', waitlistId: null, capacityValue: 2 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tueDay],
        members: membersMap(
          member({ memberId: 10, name: 'Senior', clubTenureYears: 12 }),
          member({ memberId: 11, name: 'Mid', clubTenureYears: 6 }),
          member({ memberId: 12, name: 'Junior', clubTenureYears: 1 }),
        ),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 3,
            memberId: 12,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(result.placements.map((row) => row.memberId).sort((a, b) => a - b)).toEqual([10, 11]);
    expect(result.notes.some((note) => note.code === 'day_league_no_vacancy' && note.memberId === 12 && note.leagueId === 40)).toBe(true);
    expect(result.leagueVacancies.find((row) => row.leagueId === 40)?.rostered).toBe(2);
  });

  test('grants a later day league when the higher-ranked day league is full', () => {
    const tueDay = league({ id: 40, name: 'Tuesday Daytime', category: 'day_league', waitlistId: null, capacityValue: 1 });
    const wedDay = league({ id: 41, name: 'Wednesday Day', category: 'day_league', waitlistId: null, capacityValue: 2 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tueDay, wedDay],
        members: membersMap(
          member({ memberId: 10, name: 'Senior', clubTenureYears: 12 }),
          member({ memberId: 11, name: 'Junior', clubTenureYears: 1 }),
        ),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 41, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 10, leagueId: 40 }),
      expect.objectContaining({ memberId: 11, leagueId: 41 }),
    ]);
  });

  test('gives a 1st/2nd day-league seat to a day-only registrant before a more tenured 3rd+ add-on', () => {
    const tueDay = league({ id: 40, name: 'Tuesday Daytime', category: 'day_league', waitlistId: null, capacityValue: 1 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [tueDay],
        members: membersMap(
          member({ memberId: 10, name: 'Tenured third', clubTenureYears: 20 }),
          member({ memberId: 417, name: 'Steven Marquard', clubTenureYears: 1 }),
        ),
        currentRosters: [
          { leagueId: 1, memberId: 10, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
          { leagueId: 2, memberId: 10, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 40, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 417,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 40, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
      }),
      'third-leagues',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({
        memberId: 417,
        leagueId: 40,
        reason: expect.stringContaining('1st/2nd'),
      }),
    ]);
    expect(result.notes.some((note) => note.code === 'day_league_no_vacancy' && note.memberId === 10)).toBe(true);
  });

  test('gives leftover vacancy to an open-period waitlist entry before 3rd+ assignment', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 4, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Late waitlisted' }), member({ memberId: 11, name: 'Third' })),
        currentRosters: [
          { leagueId: 2, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 11, status: 'active', placementType: 'waitlist', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'third-leagues',
    );
    expect(result.placements.filter((row) => row.leagueId === 1)).toEqual([
      expect.objectContaining({ memberId: 10, placementType: 'waitlist' }),
      expect.objectContaining({ memberId: 11, placementType: 'new_placement' }),
    ]);
  });

  test('skips a full higher 3rd+ pick and fills the next league with room', () => {
    const diva = league({ id: 34, name: 'Diva', category: 'normal', capacityValue: 1, waitlistId: 340 });
    const saturday = league({ id: 38, name: 'Saturday Evening', category: 'normal', capacityValue: 36, waitlistId: 380 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [diva, saturday],
        members: membersMap(member({ memberId: 319, name: 'Mayre Brouse' })),
        currentRosters: [
          { leagueId: 24, memberId: 319, status: 'active', placementType: 'guaranteed_return', isTemporarySabbaticalFill: false, sourceRegistrationId: 218 },
          { leagueId: 30, memberId: 319, status: 'active', placementType: 'play_in', isTemporarySabbaticalFill: false, sourceRegistrationId: 218 },
          {
            leagueId: 34,
            memberId: 99,
            status: 'active',
            placementType: 'guaranteed_return',
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: 1,
          },
        ],
        registrations: [
          registration({
            id: 218,
            memberId: 319,
            desiredLeagueCount: 3,
            priorities: [
              { leagueId: 34, rank: 3, teammateMemberIds: [], teammateText: null },
              { leagueId: 38, rank: 4, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [340, []],
          [380, []],
        ]),
      }),
      'third-leagues',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 319, leagueId: 38, stage: 'third-leagues' }),
    ]);
  });

  test('assigns a 3rd league to an open-period registrant who already has two', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 11, name: 'Late third' })),
        currentRosters: [
          { leagueId: 2, memberId: 11, status: 'active', placementType: 'new_placement', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
          { leagueId: 3, memberId: 11, status: 'active', placementType: 'new_placement', isTemporarySabbaticalFill: false, sourceRegistrationId: 2 },
        ],
        registrations: [
          registration({
            id: 2,
            memberId: 11,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'third-leagues',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 11, leagueId: 1, stage: 'third-leagues' }),
    ]);
  });
});

describe('stage open-registration', () => {
  test('fills up to two leagues for open-period registrations by tenure, then experience, then seed', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const lateRegs = [
      registration({
        id: 1,
        memberId: 1,
        receivedDuringPriorityPeriod: false,
        desiredLeagueCount: 2,
        priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
      }),
      registration({
        id: 2,
        memberId: 2,
        receivedDuringPriorityPeriod: false,
        desiredLeagueCount: 2,
        priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
      }),
    ];

    const byTenure = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(
          member({ memberId: 1, name: 'Short', clubTenureYears: 1, totalExperienceYears: 20 }),
          member({ memberId: 2, name: 'Long', clubTenureYears: 8, totalExperienceYears: 8 }),
        ),
        registrations: lateRegs,
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(byTenure.placements).toEqual([
      expect.objectContaining({ memberId: 2, leagueId: 1, stage: 'open-registration' }),
    ]);
  });

  test('gives an open-period registrant two leagues when vacancy remains', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', waitlistId: 10 });
    const sunday = league({ id: 2, name: 'Sunday Morning', category: 'normal', waitlistId: 20 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump, sunday],
        members: membersMap(member({ memberId: 1, name: 'Late' })),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 2,
            priorities: [
              { leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 2, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([[10, []], [20, []]]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements.map((row) => row.leagueId).sort()).toEqual([1, 2]);
    expect(result.placements.every((row) => row.stage === 'open-registration')).toBe(true);
  });

  test('does not assign a 3rd league during open registration', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 1, name: 'Late' })),
        currentRosters: [
          { leagueId: 2, memberId: 1, status: 'active', placementType: 'new_placement', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
          { leagueId: 3, memberId: 1, status: 'active', placementType: 'new_placement', isTemporarySabbaticalFill: false, sourceRegistrationId: 1 },
        ],
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 3,
            priorities: [{ leagueId: 1, rank: 3, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements.filter((row) => row.leagueId === 1)).toHaveLength(0);
  });

  test('open-registration leftover 1st/2nd seats compete by tenure regardless of registration period', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(
          member({ memberId: 1, name: 'Priority', clubTenureYears: 20 }),
          member({ memberId: 2, name: 'Late', clubTenureYears: 1 }),
        ),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 2,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([[10, []]]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 1, leagueId: 1, stage: 'open-registration' }),
    ]);
  });

  test('places open-period junior programs', () => {
    const rec = league({ id: 20, name: 'Junior Recreational', category: 'junior_rec' });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [rec],
        members: membersMap(member({ memberId: 1, name: 'Kid Rec' })),
        registrations: [
          registration({
            id: 1,
            memberId: 1,
            membershipOption: 'junior_recreational',
            receivedDuringPriorityPeriod: false,
            priorities: [],
          }),
        ],
      }),
      'open-registration',
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 1, leagueId: 20, stage: 'open-registration' }),
    ]);
  });

  test('skips a full higher pick and fills the next league with room', () => {
    const friday = league({ id: 36, name: 'Friday Evening', category: 'normal', capacityValue: 1, waitlistId: 360 });
    const saturday = league({ id: 38, name: 'Saturday Evening', category: 'normal', capacityValue: 36, waitlistId: 380 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [friday, saturday],
        members: membersMap(member({ memberId: 601, name: 'Carter Woodiel' })),
        currentRosters: [
          {
            leagueId: 36,
            memberId: 99,
            status: 'active',
            placementType: 'guaranteed_return',
            isTemporarySabbaticalFill: false,
            sourceRegistrationId: 1,
          },
        ],
        registrations: [
          registration({
            id: 700,
            memberId: 601,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 36, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 38, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [360, []],
          [380, []],
        ]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 601, leagueId: 38, stage: 'open-registration' }),
    ]);
    expect(result.notes.some((note) => note.code === 'open_registration_not_next')).toBe(false);
  });

  test('still prefers an open higher pick over a later league with room', () => {
    const friday = league({ id: 36, name: 'Friday Evening', category: 'normal', capacityValue: 4, waitlistId: 360 });
    const saturday = league({ id: 38, name: 'Saturday Evening', category: 'normal', capacityValue: 36, waitlistId: 380 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [friday, saturday],
        members: membersMap(member({ memberId: 601, name: 'Carter Woodiel' })),
        registrations: [
          registration({
            id: 700,
            memberId: 601,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [
              { leagueId: 36, rank: 1, teammateMemberIds: [], teammateText: null },
              { leagueId: 38, rank: 2, teammateMemberIds: [], teammateText: null },
            ],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [360, []],
          [380, []],
        ]),
      }),
      'open-registration',
      { randomSeed: 7 },
    );
    expect(result.placements).toEqual([
      expect.objectContaining({ memberId: 601, leagueId: 36, stage: 'open-registration' }),
    ]);
  });

  test('gives leftover vacancy to a priority-period waitlist entry before open-registration assignment', () => {
    const hump = league({ id: 1, name: 'Hump Day', category: 'normal', capacityValue: 1, waitlistId: 10 });
    const result = runRosterRebuildStage(
      snapshot({
        leagues: [hump],
        members: membersMap(member({ memberId: 10, name: 'Waitlisted' }), member({ memberId: 11, name: 'Late' })),
        registrations: [
          registration({
            id: 1,
            memberId: 10,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
          registration({
            id: 2,
            memberId: 11,
            receivedDuringPriorityPeriod: false,
            desiredLeagueCount: 1,
            priorities: [{ leagueId: 1, rank: 1, teammateMemberIds: [], teammateText: null }],
          }),
        ],
        waitlistEntriesByWaitlistId: new Map([
          [10, [waitlistEntry({ id: 1, waitlistId: 10, memberId: 10, position: 1 })]],
        ]),
      }),
      'open-registration',
    );
    expect(result.placements.filter((row) => row.leagueId === 1)).toEqual([
      expect.objectContaining({ memberId: 10, placementType: 'waitlist', stage: 'open-registration' }),
    ]);
    expect(result.notes.some((note) => note.code === 'waitlist_not_exhausted')).toBe(false);
  });
});

describe('diffRosters', () => {
  test('classifies added, removed, and unchanged rows', () => {
    const rows = diffRosters({
      before: [
        { leagueId: 1, memberId: 10 },
        { leagueId: 1, memberId: 11 },
      ],
      after: [
        { leagueId: 1, memberId: 11 },
        { leagueId: 1, memberId: 12 },
      ],
      reasons: new Map([['1:12', { reason: 'waitlist', stage: 'waitlists' }]]),
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 10, change: 'removed' }),
        expect.objectContaining({ memberId: 11, change: 'unchanged' }),
        expect.objectContaining({ memberId: 12, change: 'added', reason: 'waitlist', stage: 'waitlists' }),
      ]),
    );
  });
});
