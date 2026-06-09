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
  };
  isMinor: boolean;
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
  };
  icePrivilegesChoice: 'none' | 'league_play' | 'basic_ice';
};

export const REGISTRATION_FLOW_STEPS = new Set([
  'identity',
  'policies',
  'demographics',
  'guardian',
  'membership',
  'discounts',
  'experience',
  'basic-ice',
  'prior-league-selection',
  'league-selection',
  'league-requests',
  'basic-ice-fallback',
  'third-league-interest',
  'league-summary',
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
      if (payload.isMinor && !registration.guardian_email) return 'guardian';
      return 'membership';
    case 'shell_complete':
      return 'membership';
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

export function resolvePostShellResumeStepFromPayment(
  payment: RegistrationMembershipPaymentResumeShape,
  options?: { hasPriorSeasonReturnLeagues?: boolean },
): string {
  const option = payment.selection.membershipOption;

  if (option === 'none') return 'membership';
  if (option === 'social') return 'review';
  if (option === 'junior_recreational') return 'league-summary';
  if (option === 'regular_spare_only') return 'league-selection';

  const ice = payment.icePrivilegesChoice;
  if (ice && ice !== 'none') {
    return options?.hasPriorSeasonReturnLeagues ? 'prior-league-selection' : 'league-selection';
  }

  if (payment.selection.experienceType) {
    return 'basic-ice';
  }

  return 'discounts';
}

export function resolveResumeStepFromDraft(input: {
  draft: RegistrationShellResumePayload;
  pointer: RegistrationResumePointerV1 | null;
  membershipPayment?: RegistrationMembershipPaymentResumeShape | null;
  hasPriorSeasonReturnLeagues?: boolean;
}): string {
  if (input.pointer && resumePointerMatchesDraft(input.pointer, input.draft)) {
    return input.pointer.step;
  }

  const shellStep = nextStepFor(input.draft);
  if (shellStep !== 'membership' || input.draft.registration.status !== 'shell_complete') {
    return shellStep;
  }

  if (input.membershipPayment) {
    return resolvePostShellResumeStepFromPayment(input.membershipPayment, {
      hasPriorSeasonReturnLeagues: input.hasPriorSeasonReturnLeagues,
    });
  }

  return shellStep;
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
