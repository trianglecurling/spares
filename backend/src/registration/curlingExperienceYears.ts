export type MemberExperienceBaselines = {
  baselineOtherClubExperienceYears: number;
  baselineClubExperienceYears: number;
};

export const CURLING_EXPERIENCE_YEARS_MAX_EXCLUSIVE = 100;

export function isValidHalfYearExperienceValue(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value >= CURLING_EXPERIENCE_YEARS_MAX_EXCLUSIVE) {
    return false;
  }
  return Math.round(value * 2) === value * 2;
}

export function validateHalfYearExperienceValue(
  value: number | null | undefined,
  fieldLabel: string,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return `${fieldLabel} must be a number.`;
  }
  if (value < 0 || value >= CURLING_EXPERIENCE_YEARS_MAX_EXCLUSIVE) {
    return `${fieldLabel} must be at least 0 and less than ${CURLING_EXPERIENCE_YEARS_MAX_EXCLUSIVE}.`;
  }
  if (!isValidHalfYearExperienceValue(value)) {
    return `${fieldLabel} must be a whole number or end in .5.`;
  }
  return undefined;
}

export function normalizeHalfYearExperienceValue(value: number): number {
  return Math.round(value * 2) / 2;
}

export function memberExperienceBaselinesFromRow(row: {
  baseline_other_club_experience_years?: number | null;
  baseline_club_experience_years?: number | null;
}): MemberExperienceBaselines {
  return {
    baselineOtherClubExperienceYears: normalizeHalfYearExperienceValue(row.baseline_other_club_experience_years ?? 0),
    baselineClubExperienceYears: normalizeHalfYearExperienceValue(row.baseline_club_experience_years ?? 0),
  };
}
