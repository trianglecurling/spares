import { describe, expect, test } from 'bun:test';
import { deriveRosterPlacementSource } from './rosterPlacementSource.js';

describe('deriveRosterPlacementSource', () => {
  test('maps guaranteed return types to league returner', () => {
    expect(
      deriveRosterPlacementSource({ placementType: 'guaranteed_return', sessionLeagueCount: 1 }),
    ).toBe('league_returner');
    expect(
      deriveRosterPlacementSource({ placementType: 'guaranteed_fallback', sessionLeagueCount: 2 }),
    ).toBe('league_returner');
  });

  test('maps waitlist type to waitlist add even when the member has three leagues', () => {
    expect(
      deriveRosterPlacementSource({ placementType: 'waitlist', sessionLeagueCount: 3 }),
    ).toBe('waitlist_add');
  });

  test('maps stored third_league type', () => {
    expect(
      deriveRosterPlacementSource({ placementType: 'third_league', sessionLeagueCount: 1 }),
    ).toBe('third_league');
  });

  test('classifies new placement as third-league when the member already has two other seats', () => {
    expect(
      deriveRosterPlacementSource({ placementType: 'new_placement', sessionLeagueCount: 3 }),
    ).toBe('third_league');
    expect(
      deriveRosterPlacementSource({ placementType: 'new_placement', sessionLeagueCount: 2 }),
    ).toBeNull();
  });

  test('classifies temporary sabbatical fills as waitlist add unless they are a third seat', () => {
    expect(
      deriveRosterPlacementSource({
        placementType: 'temporary_sabbatical_fill',
        sessionLeagueCount: 1,
      }),
    ).toBe('waitlist_add');
    expect(
      deriveRosterPlacementSource({
        placementType: 'temporary_sabbatical_fill',
        sessionLeagueCount: 3,
      }),
    ).toBe('third_league');
  });

  test('does not invent a source for staff or play-in seats', () => {
    expect(
      deriveRosterPlacementSource({ placementType: 'staff_manual', sessionLeagueCount: 3 }),
    ).toBeNull();
    expect(
      deriveRosterPlacementSource({ placementType: 'play_in', sessionLeagueCount: 1 }),
    ).toBeNull();
    expect(deriveRosterPlacementSource({ placementType: null, sessionLeagueCount: 3 })).toBeNull();
  });
});
