import { ageOnLeagueStart, effectiveExperienceYears } from './registrationAgeExperience.js';
import { blockingError, createDecision, type BusinessDecision, type DecisionMessage } from './registrationDecisionTypes.js';
import {
  leagueMaximumAgeConstraint,
  leagueMaximumExperienceConstraint,
  leagueMinimumAgeConstraint,
  leagueMinimumExperienceConstraint,
} from './leagueEligibilityConstraints.js';
import type { LeagueConfig, RegistrationContext } from './registrationContext.js';

export type LeagueEligibilityMode = 'league_selection' | 'waitlist';

function hasRegularMembershipPath(context: RegistrationContext): boolean {
  return context.membershipOption === 'regular' || context.membershipOption === 'regular_spare_only';
}

export function validateRegistrationIsOpen(context: RegistrationContext): BusinessDecision<'allowed' | 'blocked'> {
  if (context.registrationState === 'closed') {
    return createDecision({
      status: 'blocked',
      allowed: false,
      blockingErrors: [blockingError('registration_closed', 'Registration is closed.')],
    });
  }
  return createDecision({ status: 'allowed', allowed: true, messages: ['Registration is available.'] });
}

export function validateDiscountClaims(context: RegistrationContext): BusinessDecision<'valid' | 'invalid'> {
  const blockingErrors: DecisionMessage[] = [];
  if (context.discountClaims.student?.claimed && !context.discountClaims.student.institution?.trim()) {
    blockingErrors.push(blockingError('student_discount_requires_institution', 'Student discount requires an institution.'));
  }
  if (context.discountClaims.reciprocal?.claimed && !context.discountClaims.reciprocal.clubName?.trim()) {
    blockingErrors.push(blockingError('reciprocal_discount_requires_club', 'Reciprocal discount requires another curling club.'));
  }
  return createDecision({
    status: blockingErrors.length > 0 ? 'invalid' : 'valid',
    allowed: blockingErrors.length === 0,
    blockingErrors,
  });
}

export function validateSpareOnlyEligibility(context: RegistrationContext): BusinessDecision<'eligible' | 'ineligible'> {
  const blockingErrors: DecisionMessage[] = [];
  if (context.membershipOption === 'junior_recreational') {
    blockingErrors.push(
      blockingError('junior_recreational_exclusive', 'Junior Recreational participants cannot purchase spare-only privileges.')
    );
  }
  if (!hasRegularMembershipPath(context)) {
    blockingErrors.push(
      blockingError('spare_only_requires_regular_membership', 'Spare-only requires regular membership.')
    );
  }
  return createDecision({
    status: blockingErrors.length > 0 ? 'ineligible' : 'eligible',
    eligible: blockingErrors.length === 0,
    blockingErrors,
  });
}

export function validateLeagueEligibility(
  context: RegistrationContext,
  league: LeagueConfig,
  mode: LeagueEligibilityMode = 'league_selection'
): BusinessDecision<'eligible' | 'ineligible'> {
  const blockingErrors: DecisionMessage[] = [];
  const registrationOpen = validateRegistrationIsOpen(context);
  blockingErrors.push(...registrationOpen.blockingErrors);

  const age = ageOnLeagueStart(context.registrant.dateOfBirth, league);
  const minimumAge = leagueMinimumAgeConstraint(league.minAge);
  const maximumAge = leagueMaximumAgeConstraint(league.maxAge);
  if (age !== null && minimumAge != null && age < minimumAge) {
    blockingErrors.push(blockingError('under_minimum_age', `Registrant must be at least ${minimumAge}.`));
  }
  if (age !== null && maximumAge != null && age > maximumAge) {
    blockingErrors.push(blockingError('over_maximum_age', `Registrant must be no older than ${maximumAge}.`));
  }

  const experienceYears = effectiveExperienceYears(context);
  const requiredExperience = leagueMinimumExperienceConstraint(league.minExperienceYears);
  const maximumExperience = leagueMaximumExperienceConstraint(league.maxExperienceYears);
  if (requiredExperience != null && experienceYears < requiredExperience) {
    blockingErrors.push(blockingError('insufficient_experience', `League requires ${requiredExperience} years of experience.`));
  }
  if (maximumExperience != null && experienceYears > maximumExperience) {
    blockingErrors.push(
      blockingError('excessive_experience', `League allows at most ${maximumExperience} years of experience.`)
    );
  }
  if (context.experience.type === 'none_or_minimal' && league.format !== 'instructional' && requiredExperience != null) {
    blockingErrors.push(
      blockingError('insufficient_experience', 'None or minimal experience qualifies only for instructional leagues.')
    );
  }

  if (context.membershipOption === 'junior_recreational') {
    blockingErrors.push(
      blockingError('junior_recreational_exclusive', 'Junior Recreational participants cannot select other leagues.')
    );
  }

  if (mode === 'league_selection') {
    if (context.membershipOption === 'social') {
      blockingErrors.push(blockingError('social_membership_no_ice', 'Social membership does not include league ice privileges.'));
    }
    if (league.requiresClubMembership && !hasRegularMembershipPath(context)) {
      blockingErrors.push(blockingError('regular_membership_required', 'Regular membership is required for this league.'));
    }
  }

  return createDecision({
    status: blockingErrors.length > 0 ? 'ineligible' : 'eligible',
    eligible: blockingErrors.length === 0,
    blockingErrors,
  });
}

export function validateWaitlistEligibility(
  context: RegistrationContext,
  league: LeagueConfig
): BusinessDecision<'eligible' | 'ineligible'> {
  const blockingErrors: DecisionMessage[] = [];
  if (!context.registrant.hasUserAccount) {
    blockingErrors.push(blockingError('waitlist_requires_account', 'A user account is required to join a waitlist.'));
  }
  if (!league.allowsWaitlist) {
    blockingErrors.push(blockingError('waitlist_not_enabled', 'This league does not use waitlists.'));
  }

  const leagueEligibility = validateLeagueEligibility(context, league, 'waitlist');
  blockingErrors.push(...leagueEligibility.blockingErrors);

  return createDecision({
    status: blockingErrors.length > 0 ? 'ineligible' : 'eligible',
    eligible: blockingErrors.length === 0,
    blockingErrors,
  });
}
