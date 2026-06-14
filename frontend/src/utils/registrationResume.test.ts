import { describe, expect, test } from 'bun:test';
import {
  getRegistrationStartScreenMode,
  isDraftRegistrationResumeStatus,
  nextStepFor,
  resolvePostShellResumeStepFromPayment,
  resolveResumeStepFromDraft,
  resumePointerMatchesDraft,
  resumePointerMatchesGuestDraft,
} from './registrationResume';

function shellDraft(overrides: Partial<{
  id: number;
  status: string;
  curlerMemberId: number | null;
  submittedByMemberId: number | null;
  demographicsConfirmed: number;
  guardianEmail: string | null;
  isMinor: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 42,
    registration: {
      season_id: 1,
      session_id: 10,
      status: overrides.status ?? 'shell_complete',
      curler_member_id: overrides.curlerMemberId ?? 100,
      submitted_by_member_id: overrides.submittedByMemberId ?? 100,
      demographics_current_confirmed: overrides.demographicsConfirmed ?? 1,
      guardian_email: overrides.guardianEmail ?? null,
    },
    isMinor: overrides.isMinor ?? false,
  };
}

describe('registration start screen mode', () => {
  test('in-progress registration limits the start page to resume or discard', () => {
    expect(
      getRegistrationStartScreenMode({
        startScreenPending: false,
        resumeOffer: 'server',
        completedSelfRegistrationId: 99,
        registeringForSomeoneElse: false,
        registrationWindowOpen: true,
      }),
    ).toBe('resume');
  });

  test('completed self registration allows a fresh start only for someone else', () => {
    expect(
      getRegistrationStartScreenMode({
        startScreenPending: false,
        resumeOffer: 'none',
        completedSelfRegistrationId: 99,
        registeringForSomeoneElse: false,
        registrationWindowOpen: true,
      }),
    ).toBe('already_registered_self');

    expect(
      getRegistrationStartScreenMode({
        startScreenPending: false,
        resumeOffer: 'none',
        completedSelfRegistrationId: 99,
        registeringForSomeoneElse: true,
        registrationWindowOpen: true,
      }),
    ).toBe('fresh_start');
  });

  test('a new registration is offered only when no draft is in progress', () => {
    expect(
      getRegistrationStartScreenMode({
        startScreenPending: false,
        resumeOffer: 'none',
        completedSelfRegistrationId: null,
        registeringForSomeoneElse: false,
        registrationWindowOpen: true,
      }),
    ).toBe('fresh_start');
  });
});

describe('registration resume targeting', () => {
  test('completed registrations are not treated as draft resume targets', () => {
    expect(isDraftRegistrationResumeStatus('shell_complete')).toBe(true);
    expect(isDraftRegistrationResumeStatus('awaiting_payment')).toBe(false);
    expect(isDraftRegistrationResumeStatus('confirmed')).toBe(false);
  });

  test('resume pointer must match the active draft id', () => {
    const pointer = {
      v: 1 as const,
      seasonId: 1,
      sessionId: 10,
      registrationId: 42,
      step: 'discounts',
    };
    const draft = shellDraft({ id: 42 });

    expect(resumePointerMatchesDraft(pointer, draft)).toBe(true);
    expect(resumePointerMatchesDraft({ ...pointer, registrationId: 7 }, draft)).toBe(false);
  });

  test('guest resume pointer never matches a server draft id', () => {
    const pointer = {
      v: 1 as const,
      seasonId: 1,
      sessionId: 10,
      registrationId: null,
      step: 'discounts',
    };

    expect(
      resumePointerMatchesGuestDraft(pointer, {
        seasonId: 1,
        sessionId: 10,
        returningAnswer: 'no',
        step: 'membership',
      }),
    ).toBe(true);
    expect(resumePointerMatchesDraft(pointer, shellDraft())).toBe(false);
  });

  test('continue resolves to the saved step for the active draft, not a completed registration', () => {
    const draft = shellDraft({ status: 'shell_complete' });
    const pointer = {
      v: 1 as const,
      seasonId: 1,
      sessionId: 10,
      registrationId: 42,
      step: 'discounts',
    };

    expect(
      resolveResumeStepFromDraft({
        draft,
        pointer,
      }),
    ).toBe('discounts');
    expect(nextStepFor(draft)).toBe('discounts');
  });

  test('post-shell resume falls back to membership after discounts are saved', () => {
    const draft = shellDraft({ status: 'shell_complete' });

    expect(
      resolveResumeStepFromDraft({
        draft,
        pointer: null,
        membershipPayment: {
          selection: {
            membershipOption: 'regular',
            experienceType: null,
          },
          icePrivilegesChoice: 'none',
        },
      }),
    ).toBe('membership');
  });

  test('resolvePostShellResumeStepFromPayment maps saved membership state to the next step', () => {
    expect(
      resolvePostShellResumeStepFromPayment({
        selection: { membershipOption: 'none', experienceType: null },
        icePrivilegesChoice: 'none',
      }),
    ).toBe('discounts');

    expect(
      resolvePostShellResumeStepFromPayment({
        selection: { membershipOption: 'regular', experienceType: 'specified_years' },
        icePrivilegesChoice: 'none',
      }),
    ).toBe('basic-ice');

    expect(
      resolvePostShellResumeStepFromPayment(
        {
          selection: { membershipOption: 'regular', experienceType: null },
          icePrivilegesChoice: 'league_play',
        },
        { hasPriorSeasonReturnLeagues: true },
      ),
    ).toBe('prior-league-selection');

    expect(
      resolvePostShellResumeStepFromPayment({
        selection: { membershipOption: 'regular', experienceType: null },
        icePrivilegesChoice: 'none',
        hasLifetimeMembership: true,
        knownExperienceYears: 2,
      }),
    ).toBe('basic-ice');

    expect(
      resolvePostShellResumeStepFromPayment({
        selection: { membershipOption: 'regular', experienceType: null },
        icePrivilegesChoice: 'none',
        hasLifetimeMembership: true,
        knownExperienceYears: 0,
      }),
    ).toBe('experience');
  });
});
