import { describe, expect, test } from 'bun:test';
import { nextRosterSpotTypeFields } from './rosterSpotType.js';

describe('nextRosterSpotTypeFields', () => {
  test('keeps a recorded placement source when marking a temporary fill', () => {
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: true,
        placementType: 'guaranteed_return',
        relatedSabbaticalId: null,
        availableSabbaticalId: 12,
      }),
    ).toEqual({
      isTemporarySabbaticalFill: true,
      placementType: 'guaranteed_return',
      relatedSabbaticalId: 12,
    });
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: true,
        placementType: 'waitlist',
        relatedSabbaticalId: 4,
        availableSabbaticalId: 12,
      }),
    ).toEqual({
      isTemporarySabbaticalFill: true,
      placementType: 'waitlist',
      relatedSabbaticalId: 4,
    });
  });

  test('records a temporary-fill placement when the seat has no source yet', () => {
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: true,
        placementType: null,
        relatedSabbaticalId: null,
        availableSabbaticalId: null,
      }),
    ).toEqual({
      isTemporarySabbaticalFill: true,
      placementType: 'temporary_sabbatical_fill',
      relatedSabbaticalId: null,
    });
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: true,
        placementType: 'staff_manual',
        relatedSabbaticalId: null,
        availableSabbaticalId: 9,
      }).placementType,
    ).toBe('temporary_sabbatical_fill');
  });

  test('clears the sabbatical link when marking a permanent spot', () => {
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: false,
        placementType: 'temporary_sabbatical_fill',
        relatedSabbaticalId: 12,
        availableSabbaticalId: 12,
      }),
    ).toEqual({
      isTemporarySabbaticalFill: false,
      placementType: 'staff_manual',
      relatedSabbaticalId: null,
    });
    expect(
      nextRosterSpotTypeFields({
        isTemporarySabbaticalFill: false,
        placementType: 'guaranteed_return',
        relatedSabbaticalId: 12,
        availableSabbaticalId: 12,
      }),
    ).toEqual({
      isTemporarySabbaticalFill: false,
      placementType: 'guaranteed_return',
      relatedSabbaticalId: null,
    });
  });
});
