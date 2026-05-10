import type { LeagueConfig, RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';

export function league(overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  return {
    id: 100,
    sessionId: 10,
    name: 'Tuesday Evening',
    leagueType: 'standard',
    capacityType: 'individual',
    capacityValue: 40,
    registrationFeeMinor: 30000,
    requiresClubMembership: true,
    isInstructional: false,
    minExperienceYears: 1,
    minAge: null,
    maxAge: null,
    startDate: '2026-09-15',
    endDate: '2026-12-15',
    firstDayOfPlay: '2026-09-15',
    lastDayOfPlay: '2026-12-15',
    allowsWaitlist: true,
    allowsSabbatical: true,
    predecessorLeagueId: 90,
    successorLeagueId: null,
    discountEligible: true,
    ...overrides,
  };
}

export function selection(overrides: Partial<RegistrationSelectionInput> = {}): RegistrationSelectionInput {
  return {
    selectionType: 'guaranteed_return',
    leagueId: 100,
    ...overrides,
  };
}

export function registrationContext(overrides: Partial<RegistrationContext> = {}): RegistrationContext {
  const defaultLeague = league();
  return {
    season: {
      id: 1,
      name: '2026-27',
      startDate: '2026-09-01',
      endDate: '2027-05-31',
    },
    session: {
      id: 10,
      seasonId: 1,
      name: 'Fall',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
    },
    registrationState: 'priority',
    isFirstSessionOfSeason: true,
    membershipSeasonStartYear: 2026,
    registrant: {
      memberId: 20,
      hasUserAccount: true,
      isReturningMember: true,
      dateOfBirth: '1990-01-01',
    },
    submittedByMemberId: 20,
    membershipOption: 'regular',
    isSocialToRegularUpgrade: false,
    experience: {
      type: 'specified_years',
      selfReportedYears: 2,
      completedSessions: [],
    },
    activeLeagueIds: [],
    participatedLeagueIds: [90],
    existingSabbaticals: [],
    existingWaitlistEntries: [],
    leagues: {
      [defaultLeague.id]: defaultLeague,
      90: league({
        id: 90,
        name: 'Previous Tuesday Evening',
        sessionId: 9,
        predecessorLeagueId: null,
        successorLeagueId: 100,
        startDate: '2026-01-15',
        endDate: '2026-05-15',
        firstDayOfPlay: '2026-01-15',
        lastDayOfPlay: '2026-05-15',
      }),
    },
    selections: [selection()],
    discountClaims: {},
    priceConfig: {
      regularMembershipFeeMinor: 10000,
      socialMembershipFeeMinor: 4000,
      spareOnlyIcePrivilegeFeeMinor: 2500,
      sabbaticalFeeMinor: 5000,
      juniorRecreationalFeeMinor: 7500,
    },
    discountSettings: {
      student: { amountType: 'dollar', amountValue: 1000 },
      reciprocal: { amountType: 'percent', amountValue: 10 },
      winterOnly: { amountType: 'dollar', amountValue: 2500 },
    },
    sabbaticalDurationLimitYears: 3,
    ...overrides,
  };
}
