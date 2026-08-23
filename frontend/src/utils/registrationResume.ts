export type RegistrationResumeOffer = 'none' | 'server' | 'local';

export type RegistrationStartScreenMode =
  | 'loading'
  | 'resume'
  | 'already_registered_self'
  | 'closed'
  | 'fresh_start';

export type RegistrationShellResumePayload = {
  id: number;
  registration: {
    season_id: number;
    session_id: number;
    status: string;
    curler_member_id: number | null;
    submitted_by_member_id: number | null;
    demographics_current_confirmed: number;
    guardian_email: string | null;
    returning_member_answer?: number | null;
  };
  isMinor: boolean;
  nameTagComplete?: boolean;
};

export type RegistrationResumePointerV1 = {
  v: 1;
  seasonId: number;
  sessionId: number;
  registrationId: number | null;
  step: string;
};

export type LocalRegistrationDraftResumeShape = {
  seasonId: number;
  sessionId: number;
  returningAnswer: 'no';
  step: string;
};

export type RegistrationMembershipPaymentResumeShape = {
  selection: {
    membershipOption: 'none' | 'regular' | 'social' | 'regular_spare_only' | 'junior_recreational';
    experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null;
    experienceSelfReportedYears?: number | null;
  };
  icePrivilegesChoice: 'none' | 'league_play' | 'basic_ice';
  hasLifetimeMembership?: boolean;
  knownExperienceYears?: number;
  noMembershipEligible?: boolean;
};

export const REGISTRATION_FLOW_STEPS = new Set([
  'identity',
  'policies',
  'demographics',
  'name-tag',
  'guardian',
  'membership',
  'discounts',
  'experience',
  'basic-ice',
  'league-priority-intro',
  'league-priority',
  'review',
]);

const DRAFT_RESUME_STATUSES = new Set([
  'identity_incomplete',
  'policies_incomplete',
  'demographics_incomplete',
  'shell_complete',
]);

export function isDraftRegistrationResumeStatus(status: string): boolean {
  return DRAFT_RESUME_STATUSES.has(status);
}

export function getRegistrationStartScreenMode(input: {
  startScreenPending: boolean;
  resumeOffer: RegistrationResumeOffer;
  completedSelfRegistrationId: number | null;
  registeringForSomeoneElse: boolean;
  registrationWindowOpen: boolean;
}): RegistrationStartScreenMode {
  if (input.startScreenPending) return 'loading';
  if (input.resumeOffer !== 'none') return 'resume';
  if (input.completedSelfRegistrationId != null && !input.registeringForSomeoneElse) {
    return 'already_registered_self';
  }
  if (!input.registrationWindowOpen) return 'closed';
  return 'fresh_start';
}

export function nextStepFor(payload: RegistrationShellResumePayload): string {
  const { registration } = payload;
  if (!registration.curler_member_id || !registration.submitted_by_member_id) return 'identity';

  switch (registration.status) {
    case 'identity_incomplete':
      return 'identity';
    case 'policies_incomplete':
      return 'policies';
    case 'demographics_incomplete':
      if (!registration.demographics_current_confirmed) return 'demographics';
      if (!payload.nameTagComplete) return 'name-tag';
      if (payload.isMinor && !registration.guardian_email) return 'guardian';
      return 'discounts';
    case 'shell_complete':
      return 'discounts';
    case 'submitted':
    case 'awaiting_staff_review':
    case 'awaiting_placement':
    case 'awaiting_payment':
    case 'payment_started':
    case 'paid':
    case 'confirmed':
      return 'review';
    default:
      return 'start';
  }
}

export function resumePointerMatchesDraft(
  pointer: RegistrationResumePointerV1,
  draft: { id: number; registration: { season_id: number; session_id: number } },
): boolean {
  return (
    pointer.seasonId === draft.registration.season_id &&
    pointer.sessionId === draft.registration.session_id &&
    pointer.registrationId === draft.id
  );
}

export function resumePointerMatchesGuestDraft(
  pointer: RegistrationResumePointerV1,
  draft: LocalRegistrationDraftResumeShape,
): boolean {
  return (
    pointer.registrationId === null &&
    pointer.seasonId === draft.seasonId &&
    pointer.sessionId === draft.sessionId &&
    draft.returningAnswer === 'no'
  );
}

export function membershipNeedsSabbaticalStep(input: {
  membershipOption: RegistrationMembershipPaymentResumeShape['selection']['membershipOption'] | null | undefined;
  noMembershipEligible?: boolean;
}): boolean {
  if (input.membershipOption === 'none') return true;
  return input.membershipOption === 'social' && input.noMembershipEligible === true;
}

/** Basic ice privileges are only offered once a new curler reports at least this many years. */
export const BASIC_ICE_MIN_EXPERIENCE_YEARS = 1;

/** Saturday Instructional is highlighted for new curlers at or below this many years. */
export const SATURDAY_INSTRUCTIONAL_MAX_EXPERIENCE_YEARS = 1;

function specifiedExperienceYears(experienceSelfReportedYears: number | null | undefined): number | null {
  if (experienceSelfReportedYears == null) return null;
  const years = Number(experienceSelfReportedYears);
  return Number.isFinite(years) ? years : null;
}

/**
 * New curlers skip the ice-privileges picker (and auto-enter league play) unless they
 * report at least one year of experience. Returning members with a club record still
 * see ice privileges.
 */
export function experienceSkipsIcePrivilegesStep(
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null | undefined,
  experienceSelfReportedYears?: number | null,
): boolean {
  if (experienceType === 'none_or_minimal') return true;
  if (experienceType === 'specified_years') {
    const years = specifiedExperienceYears(experienceSelfReportedYears);
    return years == null || years < BASIC_ICE_MIN_EXPERIENCE_YEARS;
  }
  return false;
}

/** Highlight Saturday Instructional for new curlers with one year of experience or less. */
export function shouldRecommendSaturdayInstructional(
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null | undefined,
  experienceSelfReportedYears?: number | null,
): boolean {
  if (experienceType === 'none_or_minimal' || experienceType == null) return true;
  if (experienceType === 'specified_years') {
    const years = specifiedExperienceYears(experienceSelfReportedYears);
    return years != null && years <= SATURDAY_INSTRUCTIONAL_MAX_EXPERIENCE_YEARS;
  }
  return false;
}

export function resolvePostShellResumeStepFromPayment(
  payment: RegistrationMembershipPaymentResumeShape,
): string {
  const option = payment.selection.membershipOption;

  if (option === 'none') return 'discounts';
  if (option === 'social') {
    return membershipNeedsSabbaticalStep({
      membershipOption: option,
      noMembershipEligible: payment.noMembershipEligible,
    })
      ? 'league-priority'
      : 'review';
  }
  if (option === 'junior_recreational') return 'review';
  if (option === 'regular_spare_only') return 'league-priority';

  const ice = payment.icePrivilegesChoice;
  if (
    ice === 'league_play' ||
    experienceSkipsIcePrivilegesStep(
      payment.selection.experienceType,
      payment.selection.experienceSelfReportedYears,
    )
  ) {
    return 'league-priority-intro';
  }
  if (ice === 'basic_ice') {
    return 'league-priority';
  }

  if (payment.selection.experienceType) {
    return 'basic-ice';
  }

  if (payment.hasLifetimeMembership) {
    return (payment.knownExperienceYears ?? 0) > 0 ? 'basic-ice' : 'experience';
  }

  return 'membership';
}

export function resolveResumeStepFromDraft(input: {
  draft: RegistrationShellResumePayload;
  pointer: RegistrationResumePointerV1 | null;
  membershipPayment?: RegistrationMembershipPaymentResumeShape | null;
}): string {
  if (input.pointer && resumePointerMatchesDraft(input.pointer, input.draft)) {
    return input.pointer.step;
  }

  const shellStep = nextStepFor(input.draft);
  if (shellStep !== 'discounts' || input.draft.registration.status !== 'shell_complete') {
    return shellStep;
  }

  if (input.membershipPayment) {
    return resolvePostShellResumeStepFromPayment(input.membershipPayment);
  }

  return shellStep;
}

export function staffRegistrationSearch(staffRegistrationId: number | null | undefined): string {
  return staffRegistrationId ? `?staffRegistrationId=${staffRegistrationId}` : '';
}

export function parseRegistrationResumePointer(raw: string | null): RegistrationResumePointerV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RegistrationResumePointerV1;
    if (parsed?.v !== 1 || !REGISTRATION_FLOW_STEPS.has(parsed.step)) return null;
    return parsed;
  } catch {
    return null;
  }
}
