export type DecisionSeverity = 'blocking' | 'warning' | 'info';

export type RegistrationReasonCode =
  | 'registration_closed'
  | 'not_priority_registration'
  | 'returning_member_login_required'
  | 'under_minimum_age'
  | 'over_maximum_age'
  | 'insufficient_experience'
  | 'excessive_experience'
  | 'junior_recreational_exclusive'
  | 'social_membership_no_ice'
  | 'regular_membership_required'
  | 'spare_only_requires_regular_membership'
  | 'byot_requires_full_roster'
  | 'byot_must_outrank_standard_leagues'
  | 'byot_play_in_requires_full_roster'
  | 'byot_play_in_requires_minimum_roster'
  | 'play_in_not_enabled'
  | 'play_in_placement_pending'
  | 'play_in_teammate_already_committed'
  | 'instructional_join_requires_instructional'
  | 'byot_no_sabbatical'
  | 'waitlist_requires_account'
  | 'waitlist_not_enabled'
  | 'sabbatical_requires_return_right'
  | 'sabbatical_limit_exceeded'
  | 'sabbatical_only_no_priority_list'
  | 'sabbatical_duration_limit_exceeded'
  | 'continuing_sabbatical_decision_required'
  | 'sabbatical_staff_override_required'
  | 'sabbatical_not_for_temporary_fill'
  | 'protected_claim_limit_exceeded'
  | 'guaranteed_return_requires_predecessor'
  | 'guaranteed_return_requires_predecessor_participation'
  | 'desired_league_count_required'
  | 'desired_league_count_out_of_range'
  | 'priority_list_too_short'
  | 'priority_list_has_superfluous_leagues'
  | 'priority_list_duplicate_league'
  | 'priority_rank_not_contiguous'
  | 'priority_league_not_eligible'
  | 'sabbatical_league_on_priority_list'
  | 'prior_league_decision_required'
  | 'league_not_in_registration_session'
  | 'junior_financial_assistance_requires_review'
  | 'non_guaranteed_league_defers_payment'
  | 'waitlist_placement_pending'
  | 'staff_review_required'
  | 'registration_has_pending_placement'
  | 'student_discount_requires_institution'
  | 'reciprocal_discount_requires_club'
  | 'all_items_guaranteed'
  | 'no_payment_due';

export type BusinessDecisionStatus =
  | 'eligible'
  | 'ineligible'
  | 'allowed'
  | 'blocked'
  | 'valid'
  | 'invalid'
  | 'cleanup_required'
  | 'immediate_payment'
  | 'deferred_payment'
  | 'no_payment_required'
  | 'requires_staff_review';

export type DecisionMessage = {
  code: RegistrationReasonCode;
  message: string;
  severity: DecisionSeverity;
};

export type BusinessDecision<TStatus extends BusinessDecisionStatus = BusinessDecisionStatus> = {
  status: TStatus;
  eligible?: boolean;
  allowed?: boolean;
  reasonCodes: RegistrationReasonCode[];
  messages: string[];
  blockingErrors: DecisionMessage[];
  warnings: DecisionMessage[];
  requiresStaffReview?: boolean;
};

export function createDecision<TStatus extends BusinessDecisionStatus>(input: {
  status: TStatus;
  eligible?: boolean;
  allowed?: boolean;
  reasonCodes?: RegistrationReasonCode[];
  messages?: string[];
  blockingErrors?: DecisionMessage[];
  warnings?: DecisionMessage[];
  requiresStaffReview?: boolean;
}): BusinessDecision<TStatus> {
  const reasonCodes = Array.from(
    new Set([
      ...(input.reasonCodes ?? []),
      ...(input.blockingErrors ?? []).map((error) => error.code),
      ...(input.warnings ?? []).map((warning) => warning.code),
    ])
  );

  return {
    status: input.status,
    eligible: input.eligible,
    allowed: input.allowed,
    reasonCodes,
    messages: input.messages ?? [],
    blockingErrors: input.blockingErrors ?? [],
    warnings: input.warnings ?? [],
    requiresStaffReview: input.requiresStaffReview,
  };
}

export function blockingError(code: RegistrationReasonCode, message: string): DecisionMessage {
  return { code, message, severity: 'blocking' };
}

export function warning(code: RegistrationReasonCode, message: string): DecisionMessage {
  return { code, message, severity: 'warning' };
}

export function mergeDecisions<TStatus extends BusinessDecisionStatus>(
  status: TStatus,
  decisions: BusinessDecision[]
): BusinessDecision<TStatus> {
  const blockingErrors = decisions.flatMap((decision) => decision.blockingErrors);
  const warnings = decisions.flatMap((decision) => decision.warnings);
  return createDecision({
    status,
    allowed: blockingErrors.length === 0,
    eligible: blockingErrors.length === 0,
    messages: decisions.flatMap((decision) => decision.messages),
    blockingErrors,
    warnings,
    requiresStaffReview: decisions.some((decision) => decision.requiresStaffReview),
  });
}
