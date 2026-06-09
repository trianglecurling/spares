/** Minimum league constraints are unset when blank, null, or zero. */
export function leagueMinimumAgeConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

/** Maximum league constraints are unset when blank, null, or zero. */
export function leagueMaximumAgeConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

/** Minimum experience is unset when blank, null, or zero. */
export function leagueMinimumExperienceConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

/** Maximum experience is unset when blank, null, or zero. */
export function leagueMaximumExperienceConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

/** Normalize optional league constraint input before persistence. */
export function normalizeLeagueConstraintForStorage(
  value: number | null | undefined,
  kind: 'minimum' | 'maximum',
): number | null {
  if (value == null) return null;
  if (kind === 'minimum' && value <= 0) return null;
  if (kind === 'maximum' && value <= 0) return null;
  return value;
}
