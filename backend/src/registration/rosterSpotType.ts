import type { LeagueRosterPlacementTypeSqlite } from '../db/drizzle-schema.js';

export interface RosterSpotTypeFields {
  isTemporarySabbaticalFill: boolean;
  placementType: LeagueRosterPlacementTypeSqlite | null;
  relatedSabbaticalId: number | null;
}

/**
 * Staff correction of a roster seat between a permanent spot and a temporary
 * sabbatical-fill spot. Placement source is kept when it already records how
 * the member was added. A stored temporary-fill type becomes a staff correction
 * when the seat is made permanent.
 */
export function nextRosterSpotTypeFields(input: {
  isTemporarySabbaticalFill: boolean;
  placementType: LeagueRosterPlacementTypeSqlite | null;
  relatedSabbaticalId: number | null;
  /** Active sabbatical to link when a temporary fill has none yet. */
  availableSabbaticalId: number | null;
}): RosterSpotTypeFields {
  if (input.isTemporarySabbaticalFill) {
    const placementType =
      input.placementType == null || input.placementType === 'staff_manual'
        ? 'temporary_sabbatical_fill'
        : input.placementType;
    return {
      isTemporarySabbaticalFill: true,
      placementType,
      relatedSabbaticalId: input.relatedSabbaticalId ?? input.availableSabbaticalId,
    };
  }

  return {
    isTemporarySabbaticalFill: false,
    placementType:
      input.placementType === 'temporary_sabbatical_fill' ? 'staff_manual' : input.placementType,
    relatedSabbaticalId: null,
  };
}
