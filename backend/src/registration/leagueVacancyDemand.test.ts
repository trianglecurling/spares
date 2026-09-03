import { describe, expect, test } from 'bun:test';
import {
  countEarmarkedRegistrationDemand,
  earmarkedDemandHolderKey,
  priorityListingEarnsVacancyHold,
  type EarmarkedDemandListing,
} from './leagueVacancyDemand.js';

function listing(overrides: Partial<EarmarkedDemandListing> & Pick<EarmarkedDemandListing, 'leagueId' | 'registrationId'>): EarmarkedDemandListing {
  return {
    memberId: overrides.memberId ?? overrides.registrationId,
    priorityRank: 1,
    desiredLeagueCount: 1,
    ...overrides,
  };
}

describe('priority listing vacancy holds', () => {
  test('a listing inside the desired count holds a spot', () => {
    expect(priorityListingEarnsVacancyHold({ priorityRank: 2, desiredLeagueCount: 2 })).toBe(true);
  });

  test('a backup below the desired count does not hold a spot', () => {
    expect(priorityListingEarnsVacancyHold({ priorityRank: 3, desiredLeagueCount: 2 })).toBe(false);
  });

  test('a missing desired count still holds so unfinished answers cannot hide demand', () => {
    expect(priorityListingEarnsVacancyHold({ priorityRank: 4, desiredLeagueCount: null })).toBe(true);
  });
});

describe('earmarked registration demand', () => {
  const emptyOccupied = {
    rosteredMemberIdsByLeagueId: new Map<number, Set<number>>(),
    waitlistedMemberIdsByLeagueId: new Map<number, Set<number>>(),
    waitlistedRegistrationIdsByLeagueId: new Map<number, Set<number>>(),
  };

  test('counts people who listed a league but are not on the roster or waitlist', () => {
    const counts = countEarmarkedRegistrationDemand(
      [
        listing({ leagueId: 10, registrationId: 1, memberId: 101 }),
        listing({ leagueId: 10, registrationId: 2, memberId: 102 }),
        listing({ leagueId: 10, registrationId: 3, memberId: 103, priorityRank: 3, desiredLeagueCount: 2 }),
      ],
      emptyOccupied,
    );
    expect(counts.get(10)).toBe(2);
  });

  test('does not double-count someone already on the roster', () => {
    const counts = countEarmarkedRegistrationDemand(
      [listing({ leagueId: 10, registrationId: 1, memberId: 101 })],
      {
        ...emptyOccupied,
        rosteredMemberIdsByLeagueId: new Map([[10, new Set([101])]]),
      },
    );
    expect(counts.get(10)).toBeUndefined();
  });

  test('does not double-count someone already on the waitlist', () => {
    const counts = countEarmarkedRegistrationDemand(
      [listing({ leagueId: 10, registrationId: 1, memberId: 101 })],
      {
        ...emptyOccupied,
        waitlistedMemberIdsByLeagueId: new Map([[10, new Set([101])]]),
      },
    );
    expect(counts.get(10)).toBeUndefined();
  });

  test('counts a guest registration that has no member id yet', () => {
    const counts = countEarmarkedRegistrationDemand(
      [listing({ leagueId: 10, registrationId: 55, memberId: null })],
      emptyOccupied,
    );
    expect(counts.get(10)).toBe(1);
    expect(earmarkedDemandHolderKey({ registrationId: 55, memberId: null })).toBe('registration:55');
  });

  test('33 instructional listings against 24 spots leave no remaining vacancies once earmarked', () => {
    const listings = Array.from({ length: 33 }, (_, index) =>
      listing({ leagueId: 10, registrationId: index + 1, memberId: 200 + index }),
    );
    const earmarked = countEarmarkedRegistrationDemand(listings, emptyOccupied).get(10) ?? 0;
    expect(earmarked).toBe(33);
    expect(Math.max(0, 24 - earmarked)).toBe(0);
  });
});
