import { describe, expect, test } from 'bun:test';
import { mergeRegistrationChargeSets } from './registrationBillingChargeSet.js';

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
