import { describe, expect, test } from 'bun:test';
import { mergeRegistrationChargeSets, sessionPlacementChargeSet } from './registrationBillingChargeSet.js';

describe('mergeRegistrationChargeSets', () => {
  test('unions roster, team, and entered play-in leagues', () => {
    expect(
      mergeRegistrationChargeSets(
        { chargedLeagueIds: [34, 25], temporaryFillLeagueIds: [] },
        { chargedLeagueIds: [30] },
        { chargedLeagueIds: [30, 25] },
      ),
    ).toEqual({
      chargedLeagueIds: [34, 25, 30],
      temporaryFillLeagueIds: [],
    });
  });

  test('keeps temporary-fill leagues from any source', () => {
    expect(
      mergeRegistrationChargeSets(
        { chargedLeagueIds: [10], temporaryFillLeagueIds: [10] },
        { chargedLeagueIds: [11] },
      ),
    ).toEqual({
      chargedLeagueIds: [10, 11],
      temporaryFillLeagueIds: [10],
    });
  });
});

describe('sessionPlacementChargeSet', () => {
  test('discounts a temporary-fill roster seat that is not linked to a registration', () => {
    expect(
      sessionPlacementChargeSet({
        teamLeagueIds: [],
        playInLeagueIds: [],
        rosterSeats: [
          { leagueId: 27, temporaryFill: 0 },
          { leagueId: 34, temporaryFill: 1 },
        ],
      }),
    ).toEqual({
      chargedLeagueIds: [27, 34],
      temporaryFillLeagueIds: [34],
    });
  });
});
