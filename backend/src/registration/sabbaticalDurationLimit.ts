import { config } from '../config.js';
import { addYears, compareDateLike, leagueLastDay } from './registrationAgeExperience.js';
import type { ExistingSabbatical, LeagueConfig } from './registrationContext.js';

/**
 * Sabbatical duration limit per docs/registration/sabbaticals.md:
 * - Clock starts on first_sabbatical_start_date (first day of play when sabbatical began).
 * - Cutoff = that date plus the configured number of years.
 * - Extension is blocked when the target league's last day of play is on or after the cutoff.
 *   This is not "has N years passed since today"; it is league-schedule-based.
 */
export function defaultSabbaticalDurationLimitYears(): number {
  return config.registration.sabbaticalDurationLimitYears;
}

export type SabbaticalDurationLimitEvaluation = {
  exceeded: boolean;
  cutoffDate: string;
  leagueLastDay: string;
  hasStaffOverride: boolean;
};

export function evaluateSabbaticalDurationLimit(input: {
  sabbatical: Pick<ExistingSabbatical, 'firstSabbaticalStartDate' | 'staffOverride'>;
  league: LeagueConfig;
  durationLimitYears: number;
  staffOverrideSabbaticalDuration?: boolean;
}): SabbaticalDurationLimitEvaluation {
  const cutoffDate = addYears(input.sabbatical.firstSabbaticalStartDate, input.durationLimitYears);
  const leagueEndDay = leagueLastDay(input.league);
  const exceeded = Boolean(leagueEndDay) && compareDateLike(leagueEndDay, cutoffDate) >= 0;
  const hasRowStaffOverride = Boolean(input.sabbatical.staffOverride);
  const hasContextStaffOverride = Boolean(input.staffOverrideSabbaticalDuration);

  return {
    exceeded,
    cutoffDate,
    leagueLastDay: leagueEndDay,
    hasStaffOverride: hasRowStaffOverride || hasContextStaffOverride,
  };
}

export function canExtendSabbaticalIntoLeague(input: {
  sabbatical: Pick<ExistingSabbatical, 'firstSabbaticalStartDate' | 'staffOverride'>;
  league: LeagueConfig;
  durationLimitYears: number;
  staffOverrideSabbaticalDuration?: boolean;
}): { allowed: boolean; requiresStaffReview: boolean; blockedMessage: string | null } {
  const evaluation = evaluateSabbaticalDurationLimit(input);
  if (!evaluation.exceeded) {
    return { allowed: true, requiresStaffReview: false, blockedMessage: null };
  }
  if (input.sabbatical.staffOverride) {
    return { allowed: true, requiresStaffReview: false, blockedMessage: null };
  }
  if (input.staffOverrideSabbaticalDuration) {
    return { allowed: true, requiresStaffReview: true, blockedMessage: null };
  }
  return {
    allowed: false,
    requiresStaffReview: false,
    blockedMessage: sabbaticalDurationLimitBlockedMessage(evaluation),
  };
}

export function sabbaticalDurationLimitBlockedMessage(
  evaluation: Pick<SabbaticalDurationLimitEvaluation, 'cutoffDate' | 'leagueLastDay'>,
): string {
  return `Sabbatical cannot continue into a league whose final day of play (${evaluation.leagueLastDay}) is on or after the duration limit (${evaluation.cutoffDate}).`;
}
