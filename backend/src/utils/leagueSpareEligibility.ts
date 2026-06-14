import type { League } from '../types.js';
import { toAllowsDropIns } from './leagueDropIn.js';

type LeagueSpareEligibilityInput = {
  format: League['format'] | string | null | undefined;
  allowsDropIns?: number | boolean | null;
  allows_drop_ins?: number | boolean | null;
};

export function isLeagueEligibleForSpares(league: LeagueSpareEligibilityInput): boolean {
  if (toAllowsDropIns(league.allowsDropIns ?? league.allows_drop_ins ?? 0)) {
    return false;
  }
  return league.format != null && league.format !== 'instructional';
}

/** @deprecated Use {@link isLeagueEligibleForSpares} */
export function isLeagueFormatEligibleForSpares(
  format: League['format'] | string | null | undefined,
): boolean {
  return isLeagueEligibleForSpares({ format });
}
