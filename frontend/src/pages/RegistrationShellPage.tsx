import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../utils/api';
import { post } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import FormField from '../components/FormField';
import FormCheckbox from '../components/FormCheckbox';
import ChoiceInput from '../components/ChoiceInput';
import Button from '../components/Button';
import { HiXMark } from 'react-icons/hi2';
import RegistrationImmediatePaymentConfirmationModal from '../components/registration/RegistrationImmediatePaymentConfirmationModal';
import RegistrationDemographicFields, {
  type RegistrationDemographicFieldsHandle,
} from '../components/registration/RegistrationDemographicFields';
import RegistrationDemographicsStep from '../components/registration/RegistrationDemographicsStep';
import RegistrationByotWaitlistFields from '../components/registration/RegistrationByotWaitlistFields';
import RegistrationWaitlistFulfillmentFields from '../components/registration/RegistrationWaitlistFulfillmentFields';
import {
  addWaitlistPriorityFromSelections,
  applyAddWaitlistPriorityOrder,
  defaultDesiredAddWaitlistLeagueCount,
  firstByotWaitlistRosterValidationMessage,
  firstDirectLeagueRequestRosterValidationMessage,
  filterDirectLeagueRequestEligibleLeagues,
  formatHybridByotRosterDisplay,
  formatWaitlistPositionSuffix,
  getAddWaitlistSelections,
  isBasicIceIncludedDaytimeLeague,
  isLeagueSelectionEligibleLeague,
  isThirdLeagueInterestEligibleLeague,
  calculateEstimatedTotalRange,
  formatEstimatedTotalRange,
  leagueSelectionsForSave,
  nextLeagueFlowStepAfterLeagueRequests,
  nextLeagueFlowStepAfterPriorLeagueSelection,
  nextLeagueFlowStepAfterSelections,
  nextLeagueFlowStepAfterThirdLeagueInterest,
  previousLeagueFlowStepBeforeBasicIceFallback,
  previousLeagueFlowStepBeforeSummary,
  previousLeagueFlowStepBeforeThirdLeagueInterest,
  remainingFirstTwoLeagueSlots,
  requiresWaitlistFulfillmentPreferences,
  shouldCollectBasicIceFallback,
  shouldCollectThirdLeagueInterest,
  shouldShowEstimatedTotalRange,
  submitRegistrationEdits,
  waitlistFulfillmentSummaryText,
  waitlistJoinOptionDescription,
  type LeagueEligibilityInput,
  type SubmitRegistrationEditsResult,
} from '../components/registration/registrationViewEditShared';
import type { WaitlistTeamMemberPlacementOptions } from '../components/waitlists/waitlistTeamRosterShared';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import {
  defaultRegistrationMailingAddressFormFields,
  parseRegistrationMailingAddressStored,
  registrationMailingAddressIsComplete,
  serializeRegistrationMailingAddress,
  DEFAULT_REGISTRATION_MAILING_STATE,
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
} from '../utils/registrationMailingAddress';
import {
  nextStepFor,
  parseRegistrationResumePointer,
  resolvePostShellResumeStepFromPayment,
  resolveResumeStepFromDraft,
  resumePointerMatchesDraft,
  resumePointerMatchesGuestDraft,
  type RegistrationResumePointerV1,
} from '../utils/registrationResume';
type RegistrationPriorityEditLocationState = {
  priorityEdit?: boolean;
  returnTo?: string;
  curlerMemberId?: number;
};

/** Returning identity ChoiceInput sentinel values */
const RETURNING_IDENTITY_OTHER_NEW_VALUE = '__returning_other_new_member__';
const RETURNING_IDENTITY_OTHER_RETURNING_VALUE = '__returning_other_returning_need_delegate__';

function returningEligibleProfileChoiceValue(profileId: number): string {
  return `profile:${profileId}`;
}

type RegistrationStatus =
  | 'identity_incomplete'
  | 'policies_incomplete'
  | 'demographics_incomplete'
  | 'shell_complete'
  | 'submitted'
  | 'awaiting_staff_review'
  | 'awaiting_placement'
  | 'awaiting_payment'
  | 'payment_started'
  | 'paid'
  | 'confirmed'
  | 'cancelled';

type MemberSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  mailingAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

type RegistrationShellPayload = {
  registration: {
    id: number;
    season_id: number;
    session_id: number;
    submitted_by_member_id: number | null;
    curler_member_id: number | null;
    returning_member_answer: number | null;
    registering_for_self: number | null;
    demographics_current_confirmed: number;
    status: RegistrationStatus;
    guardian_first_name: string | null;
    guardian_last_name: string | null;
    guardian_email: string | null;
    guardian_phone: string | null;
  };
  submitter: MemberSummary | null;
  curler: MemberSummary | null;
  policies: Array<{ type: string; url: string; accepted: boolean }>;
  policiesComplete: boolean;
  isMinor: boolean;
};

type RegistrationWindow = {
  state: 'closed' | 'priority' | 'open';
  season: { id: number; name: string };
  session: { id: number; name: string };
  previousRegistrationSessionDisplayName?: string | null;
  availableDiscounts?: {
    student: RegistrationDiscountSlot;
    reciprocal: RegistrationDiscountSlot;
  };
};

type RegistrationDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

type DemographicsForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingState: string;
  mailingCountry: string;
  mailingPostalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

type IcePrivilegesChoice = 'none' | 'league_play' | 'basic_ice';

type RegistrationFeeLineItem = {
  lineType: string;
  description: string;
  amountMinor: number;
  discountEligible: boolean;
};

type RegistrationMembershipPaymentPayload = {
  selection: {
    membershipOption: 'none' | 'regular' | 'social' | 'regular_spare_only' | 'junior_recreational';
    studentDiscountClaimed: boolean;
    studentInstitution: string | null;
    reciprocalDiscountClaimed: boolean;
    reciprocalClubName: string | null;
    experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null;
    experienceSelfReportedYears: number | null;
  };
  icePrivilegesChoice: IcePrivilegesChoice;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  spareOnlyIcePrivilegeFeeMinor?: number;
  feePreview: {
    lineItems: RegistrationFeeLineItem[];
    discountLineItems: RegistrationFeeLineItem[];
    subtotalMinor: number;
    discountTotalMinor: number;
    totalDueMinor: number;
    blockingErrors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  paymentDecision: {
    outcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required';
    deferralReasons: string[];
    totalDueMinor: number;
  };
};

type RegistrationPaymentStatusPayload = {
  registrationId: number | null;
  paymentStatus: 'confirming' | 'confirmed' | 'failed' | 'deferred' | 'no_payment_due' | 'unknown';
  registrationStatus: RegistrationStatus | null;
  invoiceStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
};

const REGISTRATION_PAYMENT_PROCESSING_GRACE_MS = 5000;
const REGISTRATION_PAYMENT_POLL_INTERVAL_MS = 1000;

function isRegistrationPaymentPending(
  status: RegistrationPaymentStatusPayload['paymentStatus'] | null | undefined,
): boolean {
  return status === 'confirming';
}

type RegistrationSelectionType =
  | 'guaranteed_return'
  | 'sabbatical'
  | 'drop'
  | 'return_subject_to_availability'
  | 'waitlist_add'
  | 'waitlist_replace'
  | 'waitlist_add_auto_decline'
  | 'waitlist_replace_auto_decline'
  | 'waitlist_keep_auto_accept'
  | 'waitlist_keep_auto_decline'
  | 'waitlist_remove'
  | 'third_league_interest'
  | 'byot_request'
  | 'play_in_request'
  | 'instructional_join'
  | 'junior_recreational'
  | 'spare_only';

type WaitlistPreference = 'auto_accept' | 'auto_decline' | 'remove';

const WAITLIST_SESSION_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'waitlist_add',
  'waitlist_replace',
  'waitlist_add_auto_decline',
  'waitlist_replace_auto_decline',
  'waitlist_keep_auto_accept',
  'waitlist_keep_auto_decline',
  'waitlist_remove',
]);

const WAITLIST_PREFERENCE_OPTIONS: Array<{ value: WaitlistPreference; label: string }> = [
  {
    value: 'auto_accept',
    label: 'If a spot becomes available for this session, automatically accept',
  },
  {
    value: 'auto_decline',
    label: 'If a spot becomes available for this session, automatically decline',
  },
  {
    value: 'remove',
    label: 'Remove myself from this waitlist',
  },
];

const PROTECTED_RETURN_SELECTION_TYPES = new Set<RegistrationSelectionType>(['guaranteed_return', 'sabbatical']);
const EMPTY_BYOT_PLACEMENT_OPTIONS: Record<number, WaitlistTeamMemberPlacementOptions> = {};
const NON_GUARANTEED_LEAGUE_INTEREST_TYPES = new Set<RegistrationSelectionType>([
  'third_league_interest',
  'return_subject_to_availability',
]);
const SCHEDULED_LEAGUE_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'play_in_request',
]);

const PLAY_IN_REPLACE_LABEL = 'Play-in (if successful, replaces one of your leagues)';
const PLAY_IN_ADD_WITH_REPLACE_LABEL = 'Play-in (if successful, add as an additional league)';
const PLAY_IN_ADD_ONLY_LABEL = 'Play-in';

function canRequestPlayInAdd(
  activeLeagueIds: number[],
  selections: RegistrationSelectionInput[],
  leagueId: number,
): boolean {
  const activeLeagueCount = activeLeagueIds.length;
  const otherScheduledCount = selections.filter(
    (selection) =>
      selection.leagueId != null &&
      selection.leagueId !== leagueId &&
      SCHEDULED_LEAGUE_SELECTION_TYPES.has(selection.selectionType),
  ).length;
  if (activeLeagueCount > 1) return false;
  return activeLeagueCount + otherScheduledCount <= 1;
}

function playInChoiceOptions(input: { showAdd: boolean; showReplace: boolean }): Array<{
  value: 'play_in_add' | 'play_in_replace';
  label: string;
  description: string;
}> {
  const options: Array<{ value: 'play_in_add' | 'play_in_replace'; label: string; description: string }> = [];
  if (input.showAdd) {
    options.push({
      value: 'play_in_add',
      label: input.showReplace ? PLAY_IN_ADD_WITH_REPLACE_LABEL : PLAY_IN_ADD_ONLY_LABEL,
      description: 'Register for the play-in.',
    });
  }
  if (input.showReplace) {
    options.push({
      value: 'play_in_replace',
      label: PLAY_IN_REPLACE_LABEL,
      description: 'Register for the play-in by replacing a league you already hold or selected.',
    });
  }
  return options;
}

function isThirdLeagueInterestSelection(selection: RegistrationSelectionInput): boolean {
  return NON_GUARANTEED_LEAGUE_INTEREST_TYPES.has(selection.selectionType);
}

function priorLeagueChoiceValue(selection: RegistrationSelectionInput | undefined): RegistrationSelectionType | null {
  if (!selection) return null;
  if (selection.selectionType === 'third_league_interest') return 'return_subject_to_availability';
  return selection.selectionType;
}

function hasPriorSeasonReturnLeagues(
  payload: Pick<RegistrationLeagueSelectionPayload, 'leagues' | 'participatedLeagueIds'> | null | undefined,
  registrationState: RegistrationWindow['state'] | undefined,
): boolean {
  if (!payload || registrationState !== 'priority') return false;
  return payload.leagues.some(
    (league) =>
      league.predecessorLeagueId != null && payload.participatedLeagueIds.includes(league.predecessorLeagueId),
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type MagicLinkMemberPick = { id: number; name: string };

/** Same contract as member login (/auth/request-code, /auth/verify-code responses). */
const isReturningLoginSelectionResponse = (
  value: unknown,
): value is { requiresSelection: true; tempToken: string; members: MagicLinkMemberPick[] } =>
  typeof value === 'object' &&
  value !== null &&
  (value as { requiresSelection?: boolean }).requiresSelection === true;

const isReturningLoginTokenResponse = (
  value: unknown,
): value is { accessToken: string; refreshToken: string; member: AuthenticatedMember } =>
  typeof value === 'object' &&
  value !== null &&
  'accessToken' in value &&
  'refreshToken' in value &&
  'member' in value &&
  typeof (value as { accessToken?: unknown }).accessToken === 'string' &&
  typeof (value as { refreshToken?: unknown }).refreshToken === 'string';

const normalizeReturningLoginThemePreference = (
  value: string | null | undefined,
): AuthenticatedMember['themePreference'] => {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
};

const normalizeReturningLoginMember = (value: AuthenticatedMember): AuthenticatedMember => ({
  ...value,
  themePreference: normalizeReturningLoginThemePreference(value.themePreference),
});

type ReturningLoginGuestPhase =
  | 'email'
  | 'code'
  | 'select'
  | 'unrecognized-followup'
  | 'different-email-help';

type ReturningUnrecognizedChoice = null | 'curled_prior_named_session' | 'curled_other_past_session' | 'first_time_here';

type RegistrationSelectionInput = {
  selectionType: RegistrationSelectionType;
  leagueId?: number | null;
  rank?: number | null;
  replacesLeagueId?: number | null;
  byotTeammateText?: string | null;
  teamRosterPlacements?: Array<{
    memberId: number;
    entryType: 'add' | 'replace';
    replacesLeagueId?: number | null;
  }> | null;
  isTemporarySabbaticalFill?: boolean;
};

type LeagueCatalogItem = {
  id: number;
  sessionId?: number | null;
  name: string;
  dayOfWeek?: number | null;
  registrationFeeMinor: number;
  leagueType: 'standard' | 'bring_your_own_team';
  format: 'teams' | 'doubles' | 'instructional';
  minExperienceYears?: number | null;
  maxExperienceYears?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  startDate?: string | null;
  firstDayOfPlay?: string | null;
  predecessorLeagueId?: number | null;
  allowsWaitlist: boolean;
  waitlistId?: number | null;
  activeWaitlistEntryCount?: number;
  isPlayInBased?: boolean;
  allowsSabbatical: boolean;
};

type ExistingWaitlistEntrySummary = {
  waitlistId: number;
  leagueId: number;
  entryType: 'add' | 'replace';
  replacesLeagueId?: number | null;
  status: string;
  position?: number | null;
  queueTotal?: number | null;
  declineCount?: number | null;
};

function waitlistAutoDeclineWarning(declineCount: number | null | undefined): string {
  if ((declineCount ?? 0) >= 1) {
    return 'If you receive a placement offer from this waitlist, it will be declined. Since this will be your second decline, you will be moved to the end of the waitlist.';
  }
  return 'If you receive a placement offer from this waitlist, it will be declined. This will be your first decline, and you will keep your spot on the waitlist.';
}

function isActiveExistingWaitlistEntry(entry: ExistingWaitlistEntrySummary): boolean {
  return entry.status === 'active' || entry.status === 'offered';
}

function waitlistPreferenceFromSelection(
  selection: RegistrationSelectionInput | undefined,
): WaitlistPreference | null {
  if (!selection) return null;
  switch (selection.selectionType) {
    case 'waitlist_remove':
      return 'remove';
    case 'waitlist_keep_auto_decline':
    case 'waitlist_add_auto_decline':
    case 'waitlist_replace_auto_decline':
      return 'auto_decline';
    case 'waitlist_keep_auto_accept':
    case 'waitlist_add':
    case 'waitlist_replace':
      return 'auto_accept';
    default:
      return null;
  }
}

function isJoinWaitlistSelectionType(selectionType: RegistrationSelectionType): boolean {
  return (
    selectionType === 'waitlist_add' ||
    selectionType === 'waitlist_replace' ||
    selectionType === 'waitlist_add_auto_decline' ||
    selectionType === 'waitlist_replace_auto_decline'
  );
}

function applyWaitlistPreferenceSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  preference: WaitlistPreference,
  existingEntry: ExistingWaitlistEntrySummary | undefined,
): RegistrationSelectionInput[] {
  const previous = selections.find((selection) => selection.leagueId === leagueId);
  const withoutLeague = selections.filter((selection) => selection.leagueId !== leagueId);

  if (preference === 'remove') {
    if (existingEntry) {
      return [
        ...withoutLeague,
        {
          selectionType: 'waitlist_remove',
          leagueId,
          replacesLeagueId: existingEntry.replacesLeagueId ?? null,
        },
      ];
    }
    return withoutLeague;
  }

  if (existingEntry) {
    return [
      ...withoutLeague,
      {
        selectionType: preference === 'auto_accept' ? 'waitlist_keep_auto_accept' : 'waitlist_keep_auto_decline',
        leagueId,
        replacesLeagueId: existingEntry.replacesLeagueId ?? null,
      },
    ];
  }

  const isReplace =
    previous?.selectionType === 'waitlist_replace' || previous?.selectionType === 'waitlist_replace_auto_decline';
  const preservedFields = {
    replacesLeagueId: previous?.replacesLeagueId ?? null,
    byotTeammateText: previous?.byotTeammateText ?? null,
    teamRosterPlacements: previous?.teamRosterPlacements ?? null,
  };

  if (preference === 'auto_accept') {
    return [
      ...withoutLeague,
      {
        selectionType: isReplace ? 'waitlist_replace' : 'waitlist_add',
        leagueId,
        ...preservedFields,
      },
    ];
  }

  return [
    ...withoutLeague,
    {
      selectionType: isReplace ? 'waitlist_replace_auto_decline' : 'waitlist_add_auto_decline',
      leagueId,
      ...preservedFields,
    },
  ];
}

type RegistrationLeagueSelectionPayload = {
  leagues: LeagueCatalogItem[];
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  desiredAddWaitlistLeagueCount?: number | null;
  basicIceFallbackInterest?: boolean | null;
  existingWaitlistEntries?: ExistingWaitlistEntrySummary[];
  evaluation: {
    feePreview: RegistrationMembershipPaymentPayload['feePreview'];
    paymentDecision: RegistrationMembershipPaymentPayload['paymentDecision'];
  };
};

type ReturningProfilesFetchStatus = 'idle' | 'loading' | 'ready' | 'error';

type LocalRegistrationDraftV1 = {
  v: 1;
  seasonId: number;
  sessionId: number;
  returningAnswer: 'no';
  registeringForSelf: 'self' | 'other';
  sameEmail: 'same' | 'different';
  demographics: DemographicsForm;
  guardian: { firstName: string; lastName: string; email: string; phone: string };
  membershipChoice: 'regular' | 'social';
  basicIcePrivileges: boolean;
  studentDiscountClaimed: boolean;
  studentInstitution: string;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string;
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceYears: string;
  step: string;
};

const LOCAL_DRAFT_KEY = 'thebroomstack.registrationDraft.v1';
const REGISTRATION_RESUME_POINTER_KEY = 'thebroomstack.registrationResumePointer.v1';

const emptyDemographics: DemographicsForm = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  ...defaultRegistrationMailingAddressFormFields(),
  emergencyContactName: '',
  emergencyContactPhone: '',
};

function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || fallback;
  }
  return fallback;
}

function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}

function formatRegistrationDiscountOffPhrase(slot: RegistrationDiscountSlot): string {
  if (slot.amountType === 'percent') {
    return `${slot.value}% off`;
  }
  return `${formatCurrency(Math.round(slot.value * 100))} off`;
}

function registrationDiscountLabel(baseLabel: string, slot: RegistrationDiscountSlot | undefined): string {
  if (!slot) return baseLabel;
  return `${baseLabel} (${formatRegistrationDiscountOffPhrase(slot)})`;
}

function hasClubExperienceRecord(knownExperienceYears: number | undefined | null): boolean {
  return (knownExperienceYears ?? 0) > 0;
}

function shouldSkipExperienceStep(
  membershipPayment: RegistrationMembershipPaymentPayload | null | undefined,
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing',
): boolean {
  return (
    hasClubExperienceRecord(membershipPayment?.knownExperienceYears) ||
    experienceChoice === 'known_existing'
  );
}

function stepAfterDiscounts(membershipPayment: RegistrationMembershipPaymentPayload): string {
  return hasClubExperienceRecord(membershipPayment.knownExperienceYears) ? 'basic-ice' : 'experience';
}

/** Schema/API default is `none` before the member picks an ice privileges option. */
function icePrivilegesChoiceForUi(
  stored: IcePrivilegesChoice | null | undefined,
  onIcePrivilegesStep: boolean,
): IcePrivilegesChoice | null {
  if (!stored || (stored === 'none' && onIcePrivilegesStep)) return null;
  return stored;
}

function leagueScheduleText(league: Pick<LeagueCatalogItem, 'dayOfWeek'>): string {
  if (typeof league.dayOfWeek !== 'number') return 'Schedule not configured';
  return DAY_NAMES[league.dayOfWeek] ?? 'Schedule not configured';
}

function rosterEntries(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rosterTextDisplay(text: string | null | undefined): string {
  return rosterEntries(text).join(', ');
}

function rosterSummaryForSelection(
  selection: RegistrationSelectionInput,
  league: Pick<LeagueCatalogItem, 'leagueType'> | undefined,
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  if (selection.selectionType === 'byot_request') {
    const text = rosterTextDisplay(selection.byotTeammateText);
    return text || null;
  }
  if (
    selection.selectionType === 'play_in_request' ||
    selection.selectionType === 'waitlist_add' ||
    selection.selectionType === 'waitlist_replace'
  ) {
    if (league?.leagueType !== 'bring_your_own_team') return null;
    return (
      formatHybridByotRosterDisplay(selection, memberOptionById, memberOptionIdByName, registeringCurler) ??
      (rosterTextDisplay(selection.byotTeammateText) || null)
    );
  }
  return null;
}

function ageFromDateOfBirth(dateOfBirth: string): number | null {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function isMinorDate(dateOfBirth: string): boolean {
  const age = ageFromDateOfBirth(dateOfBirth);
  return age !== null && age < 18;
}

function isJuniorRecreationalEligibleDate(dateOfBirth: string): boolean {
  const age = ageFromDateOfBirth(dateOfBirth);
  return age !== null && age <= 21;
}

function demographicsFromMember(member: MemberSummary | null): DemographicsForm {
  if (!member) return emptyDemographics;
  const [firstFallback = '', ...lastParts] = member.name.split(' ');
  const mailingParts = parseRegistrationMailingAddressStored(member.mailingAddress);
  return {
    firstName: member.firstName || firstFallback,
    lastName: member.lastName || lastParts.join(' '),
    dateOfBirth: member.dateOfBirth || '',
    email: member.email || '',
    phone: member.phone || '',
    ...mailingParts,
    emergencyContactName: member.emergencyContactName || '',
    emergencyContactPhone: member.emergencyContactPhone || '',
  };
}

/** Local draft v1 sometimes stored legacy `mailingAddress` plus newer structured fields */
function normalizeDraftDemographics(raw: unknown): DemographicsForm {
  if (!raw || typeof raw !== 'object') return emptyDemographics;
  const o = raw as Record<string, unknown>;
  const legacyMailing = typeof o.mailingAddress === 'string' ? (o.mailingAddress as string) : undefined;
  const parsedFromLegacy = parseRegistrationMailingAddressStored(legacyMailing ?? null);
  const hasStructured =
    typeof o.mailingAddressLine1 === 'string' ||
    typeof o.mailingCity === 'string' ||
    typeof o.mailingPostalCode === 'string' ||
    typeof o.mailingState === 'string' ||
    typeof o.mailingCountry === 'string';

  const mailing = hasStructured
    ? {
        mailingAddressLine1: String(o.mailingAddressLine1 ?? ''),
        mailingAddressLine2: String(o.mailingAddressLine2 ?? ''),
        mailingCity: String(o.mailingCity ?? ''),
        mailingState: String(o.mailingState ?? '').trim() || DEFAULT_REGISTRATION_MAILING_STATE,
        mailingCountry: String(o.mailingCountry ?? '').trim() || DEFAULT_REGISTRATION_MAILING_COUNTRY,
        mailingPostalCode: String(o.mailingPostalCode ?? ''),
      }
    : parsedFromLegacy;

  return {
    firstName: String(o.firstName ?? ''),
    lastName: String(o.lastName ?? ''),
    dateOfBirth: String(o.dateOfBirth ?? ''),
    email: String(o.email ?? ''),
    phone: String(o.phone ?? ''),
    ...mailing,
    emergencyContactName: String(o.emergencyContactName ?? ''),
    emergencyContactPhone: String(o.emergencyContactPhone ?? ''),
  };
}

function normalizeRegistrationEmail(email: string): string {
  return email.toLowerCase().trim();
}

function resolveUseSubmitterEmailForCurler(
  sameEmailChoice: 'same' | 'different',
  curlerEmail: string,
  submitterEmail: string,
): boolean {
  if (sameEmailChoice === 'same') return true;
  if (!submitterEmail) return false;
  return normalizeRegistrationEmail(curlerEmail) === normalizeRegistrationEmail(submitterEmail);
}

function registrationDemographicsFormIsComplete(form: DemographicsForm): boolean {
  return (
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    form.dateOfBirth.trim() !== '' &&
    form.email.trim() !== '' &&
    form.phone.trim() !== '' &&
    form.emergencyContactName.trim() !== '' &&
    form.emergencyContactPhone.trim() !== '' &&
    registrationMailingAddressIsComplete(form)
  );
}

function guestNextStepAfterPolicies(demographics: DemographicsForm): string {
  if (!registrationDemographicsFormIsComplete(demographics)) return 'demographics';
  if (isMinorDate(demographics.dateOfBirth)) return 'guardian';
  return 'membership';
}

function demographicsPayloadForIdentityApi(form: DemographicsForm): Record<string, string> & { email: string } {
  const base = {
    firstName: form.firstName,
    lastName: form.lastName,
    dateOfBirth: form.dateOfBirth,
    email: form.email,
    phone: form.phone,
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
  };
  return registrationMailingAddressIsComplete(form)
    ? { ...base, mailingAddress: serializeRegistrationMailingAddress(form) }
    : base;
}

function demographicsPayloadForPersistedSave(form: DemographicsForm): {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
} {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    dateOfBirth: form.dateOfBirth,
    email: form.email,
    phone: form.phone,
    mailingAddress: serializeRegistrationMailingAddress(form),
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
  };
}

function loadLocalDraft(): LocalRegistrationDraftV1 | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalRegistrationDraftV1 & { demographics?: unknown };
    if (parsed?.v !== 1) return null;
    return { ...parsed, demographics: normalizeDraftDemographics(parsed.demographics) };
  } catch {
    return null;
  }
}

function saveLocalDraft(draft: LocalRegistrationDraftV1) {
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
}

function clearLocalDraft() {
  localStorage.removeItem(LOCAL_DRAFT_KEY);
  clearRegistrationResumePointer();
}

function loadRegistrationResumePointer(): RegistrationResumePointerV1 | null {
  return parseRegistrationResumePointer(localStorage.getItem(REGISTRATION_RESUME_POINTER_KEY));
}

function saveRegistrationResumePointer(pointer: RegistrationResumePointerV1) {
  localStorage.setItem(REGISTRATION_RESUME_POINTER_KEY, JSON.stringify(pointer));
}

function clearRegistrationResumePointer() {
  localStorage.removeItem(REGISTRATION_RESUME_POINTER_KEY);
}

function successCurlerNameStorageKey(registrationId: number): string {
  return `registration_success_curler_name_${registrationId}`;
}

function persistSuccessCurlerName(registrationId: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'Registering curler') return;
  try {
    sessionStorage.setItem(successCurlerNameStorageKey(registrationId), trimmed);
  } catch {
    // ignore quota / private mode
  }
}

function readSuccessCurlerName(registrationId: number): string | null {
  try {
    return sessionStorage.getItem(successCurlerNameStorageKey(registrationId));
  } catch {
    return null;
  }
}

function rememberRegistrationCurlerNameForSuccess(registrationId: number | null | undefined, name: string) {
  if (registrationId == null) return;
  persistSuccessCurlerName(registrationId, name);
}

async function resolvePostShellResumeStep(registrationId: number): Promise<string> {
  const { data: paymentData } = await api.get(`/registration/drafts/${registrationId}/membership-payment`);
  const payment = paymentData as RegistrationMembershipPaymentPayload;
  const ice = payment.icePrivilegesChoice;
  if (ice && ice !== 'none') {
    const [{ data: windowData }, { data: leagueData }] = await Promise.all([
      api.get('/registration/window'),
      api.get(`/registration/drafts/${registrationId}/league-catalog`),
    ]);
    const catalog = leagueData as RegistrationLeagueSelectionPayload;
    const window = windowData as RegistrationWindow;
    return resolvePostShellResumeStepFromPayment(payment, {
      hasPriorSeasonReturnLeagues: hasPriorSeasonReturnLeagues(catalog, window.state),
    });
  }
  return resolvePostShellResumeStepFromPayment(payment);
}

function shellResumePayload(
  shell: RegistrationShellPayload,
  id: number,
): Parameters<typeof nextStepFor>[0] {
  return {
    id,
    registration: shell.registration,
    isMinor: shell.isMinor,
  };
}

async function resolveResumeStepForDraft(draft: RegistrationShellPayload & { id: number }): Promise<string> {
  const pointer = loadRegistrationResumePointer();
  if (pointer && resumePointerMatchesDraft(pointer, draft)) {
    return resolveResumeStepFromDraft({ draft, pointer });
  }

  const shellStep = nextStepFor(draft);
  if (shellStep !== 'membership' || draft.registration.status !== 'shell_complete') {
    return shellStep;
  }

  try {
    return await resolvePostShellResumeStep(draft.id);
  } catch {
    return shellStep;
  }
}

function buildGuestDraftBase(
  windowState: RegistrationWindow,
  partial: Partial<Omit<LocalRegistrationDraftV1, 'v' | 'seasonId' | 'sessionId' | 'returningAnswer'>> & {
    step: string;
  },
): LocalRegistrationDraftV1 {
  return {
    v: 1,
    seasonId: windowState.season.id,
    sessionId: windowState.session.id,
    returningAnswer: 'no',
    registeringForSelf: partial.registeringForSelf ?? 'self',
    sameEmail: partial.sameEmail ?? 'different',
    demographics: partial.demographics ?? emptyDemographics,
    guardian: partial.guardian ?? { firstName: '', lastName: '', email: '', phone: '' },
    membershipChoice: partial.membershipChoice ?? 'regular',
    basicIcePrivileges: partial.basicIcePrivileges ?? false,
    studentDiscountClaimed: partial.studentDiscountClaimed ?? false,
    studentInstitution: partial.studentInstitution ?? '',
    reciprocalDiscountClaimed: partial.reciprocalDiscountClaimed ?? false,
    reciprocalClubName: partial.reciprocalClubName ?? '',
    experienceChoice: partial.experienceChoice ?? 'none_or_minimal',
    experienceYears: partial.experienceYears ?? '',
    step: partial.step,
  };
}

function RegistrationCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-100 bg-white/95 p-6 shadow-xl shadow-emerald-950/10 sm:p-8">
      {children}
    </div>
  );
}

function FieldInput({
  id,
  value,
  onChange,
  type = 'text',
  autoComplete,
  step,
  required = true,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  step?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      step={step}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="app-input"
      autoComplete={autoComplete}
      required={required}
      disabled={disabled}
    />
  );
}

export default function RegistrationShellPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const priorityEditState = location.state as RegistrationPriorityEditLocationState | null;
  const isPriorityEdit = priorityEditState?.priorityEdit === true;
  const priorityEditReturnTo = priorityEditState?.returnTo ?? '/registration/view/1';
  const priorityEditCurlerMemberId = priorityEditState?.curlerMemberId;
  const [searchParams] = useSearchParams();
  const { step: stepParam } = useParams<{ step: string }>();
  const { member, login, isLoading: authLoading } = useAuth();
  const { confirm } = useConfirm();
  const { showAlert } = useAlert();
  const memberOptions = useMemberOptions({ autoLoad: Boolean(member) });
  const [windowState, setWindowState] = useState<RegistrationWindow | null>(null);
  const [payload, setPayload] = useState<RegistrationShellPayload | null>(null);
  const [registrationId, setRegistrationId] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<MemberSummary[]>([]);
  const [returningAnswer, setReturningAnswer] = useState<'yes' | 'no' | null>(null);
  const [returningGuestLoginPhase, setReturningGuestLoginPhase] = useState<ReturningLoginGuestPhase | null>(null);
  const [returningLoginEmail, setReturningLoginEmail] = useState('');
  const [returningLoginCode, setReturningLoginCode] = useState('');
  const [returningLoginMultipleMembers, setReturningLoginMultipleMembers] = useState<MagicLinkMemberPick[]>([]);
  const [returningLoginTempToken, setReturningLoginTempToken] = useState('');
  const [returningLoginUnrecognizedChoice, setReturningLoginUnrecognizedChoice] =
    useState<ReturningUnrecognizedChoice>(null);
  /** Sub-screen on returning-member identity step (delegation message or new-member form). */
  const [returningIdentityAuxMode, setReturningIdentityAuxMode] = useState<
    null | 'other_new_member' | 'delegation_instructions'
  >(null);
  const [returningRegistrarProfileChoice, setReturningRegistrarProfileChoice] = useState<string | null>(null);
  /** Eligible returning curler profiles for identity step (must load before showing the picker). */
  const [returningProfilesFetchStatus, setReturningProfilesFetchStatus] = useState<ReturningProfilesFetchStatus>('idle');
  const [returningPickerSpinnerVisible, setReturningPickerSpinnerVisible] = useState(false);
  const [registeringForSelf, setRegisteringForSelf] = useState<'self' | 'other'>('self');
  const [sameEmail, setSameEmail] = useState<'same' | 'different'>('different');
  const [demographics, setDemographics] = useState<DemographicsForm>(emptyDemographics);
  const demographicsRef = useRef(demographics);
  demographicsRef.current = demographics;
  const identityDemographicFieldsRef = useRef<RegistrationDemographicFieldsHandle>(null);
  const commitDemographicsDraft = useCallback((form: DemographicsForm) => {
    demographicsRef.current = form;
    setDemographics(form);
  }, []);
  const [guardian, setGuardian] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [membershipPayment, setMembershipPayment] = useState<RegistrationMembershipPaymentPayload | null>(null);
  const [membershipChoice, setMembershipChoice] = useState<'regular' | 'social' | 'junior_recreational'>('regular');
  const [juniorAssistancePercent, setJuniorAssistancePercent] = useState<'0' | '25' | '50' | '75'>('0');
  const [basicIcePrivileges, setBasicIcePrivileges] = useState(false);
  const [icePrivilegesChoice, setIcePrivilegesChoice] = useState<IcePrivilegesChoice | null>(null);
  /** Sub-screen on the ice-privileges step: confirming "no ice privileges". */
  const [noIceConfirm, setNoIceConfirm] = useState(false);
  const [studentDiscountClaimed, setStudentDiscountClaimed] = useState(false);
  const [studentInstitution, setStudentInstitution] = useState('');
  const [reciprocalDiscountClaimed, setReciprocalDiscountClaimed] = useState(false);
  const [reciprocalClubName, setReciprocalClubName] = useState('');
  const [experienceChoice, setExperienceChoice] = useState<'none_or_minimal' | 'specified_years' | 'known_existing'>('none_or_minimal');
  const [experienceYears, setExperienceYears] = useState('');
  const [leaguePayload, setLeaguePayload] = useState<RegistrationLeagueSelectionPayload | null>(null);
  const [leagueSelections, setLeagueSelections] = useState<RegistrationSelectionInput[]>([]);
  const [desiredAddWaitlistLeagueCount, setDesiredAddWaitlistLeagueCount] = useState<number | null>(null);
  const [basicIceFallbackInterest, setBasicIceFallbackInterest] = useState<boolean | null>(null);
  const [addWaitlistPriority, setAddWaitlistPriority] = useState<number[]>([]);
  const [placementOptionsByLeagueId, setPlacementOptionsByLeagueId] = useState<
    Record<number, Record<number, WaitlistTeamMemberPlacementOptions>>
  >({});
  const [showPriorWaitlistAddPicker, setShowPriorWaitlistAddPicker] = useState(false);
  const [replacementWaitlistLeagueId, setReplacementWaitlistLeagueId] = useState<number | null>(null);
  const [playInReplaceLeagueId, setPlayInReplaceLeagueId] = useState<number | null>(null);
  const leagueCatalogAppliedKeyRef = useRef<string | null>(null);
  const handleByotPlacementOptionsLoaded = useCallback((leagueId: number, options: Record<number, WaitlistTeamMemberPlacementOptions>) => {
    const normalized = Object.fromEntries(
      Object.entries(options).map(([memberId, option]) => [Number(memberId), option]),
    ) as Record<number, WaitlistTeamMemberPlacementOptions>;
    setPlacementOptionsByLeagueId((current) => ({
      ...current,
      [leagueId]: {
        ...(current[leagueId] ?? {}),
        ...normalized,
      },
    }));
  }, []);
  const handleByotWaitlistSelectionsChange = useCallback(
    (updater: (current: RegistrationSelectionInput[]) => RegistrationSelectionInput[]) => {
      setLeagueSelections(updater);
    },
    [],
  );
  const [error, setError] = useState('');
  const [checkoutConfirmation, setCheckoutConfirmation] = useState<SubmitRegistrationEditsResult | null>(null);
  const [checkoutConfirmationMode, setCheckoutConfirmationMode] = useState<'submit' | 'priority-edit'>('submit');
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [loading, setLoading] = useState(false);
  /** Suppresses one-shot auto-forward effects right after an explicit Back navigation. */
  const registrationNavigationIntentRef = useRef<'back' | null>(null);
  /** Keeps the experience step reachable after Back until the user leaves the step. */
  const suppressExperienceAutoSkipRef = useRef(false);
  const backToStartInFlightRef = useRef(false);
  const [resumeOffer, setResumeOffer] = useState<'none' | 'server' | 'local'>('none');
  const [resumeCheckComplete, setResumeCheckComplete] = useState(false);
  const [completedSelfRegistrationId, setCompletedSelfRegistrationId] = useState<number | null>(null);
  /** Invalidates in-flight resume checks (e.g. React Strict Mode re-runs). */
  const resumeCheckGenerationRef = useRef(0);
  /** Last bootstrap key we started or finished; avoids redundant loading flashes. */
  const startBootstrapKeyRef = useRef('');
  const [serverResume, setServerResume] = useState<(RegistrationShellPayload & { id: number }) | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<RegistrationPaymentStatusPayload | null>(null);
  const [paymentStatusPolling, setPaymentStatusPolling] = useState(false);
  const [showDetailedPaymentPending, setShowDetailedPaymentPending] = useState(false);

  const profileInputId = useId();
  const choiceInputId = useId();
  const icePrivilegesInputId = useId();
  const returningEmailInputId = useId();
  const returningCodeInputId = useId();
  const unrecognizedChoiceInputId = useId();
  const membershipInputId = useId();
  const experienceInputId = useId();
  const discountsInputId = useId();
  const thirdLeagueInterestInputId = useId();
  const basicIceFallbackInputId = useId();

  const memberOptionById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option])),
    [memberOptions.options],
  );
  const memberOptionIdByName = useMemo(
    () =>
      new Map(
        memberOptions.options.map((option) => [option.name.trim().toLowerCase(), option.id]),
      ),
    [memberOptions.options],
  );
  const registeringCurlerMemberId = payload?.registration.curler_member_id ?? null;
  const registeringCurlerDateOfBirth = payload?.curler?.dateOfBirth || demographics.dateOfBirth || null;
  const leagueEligibilityInput = useMemo((): LeagueEligibilityInput => {
    const membershipOption =
      membershipPayment?.selection.membershipOption ??
      (membershipChoice === 'junior_recreational'
        ? 'junior_recreational'
        : membershipChoice === 'social'
          ? 'social'
          : basicIcePrivileges
            ? 'regular_spare_only'
            : 'regular');
    const experienceType =
      membershipPayment?.selection.experienceType ??
      (experienceChoice === 'specified_years'
        ? 'specified_years'
        : experienceChoice === 'known_existing'
          ? 'known_existing'
          : 'none_or_minimal');
    return {
      dateOfBirth: registeringCurlerDateOfBirth,
      experienceType,
      experienceSelfReportedYears:
        membershipPayment?.selection.experienceSelfReportedYears ??
        (experienceChoice === 'specified_years' ? Number(experienceYears) || 0 : null),
      knownExperienceYears: membershipPayment?.knownExperienceYears,
      membershipOption,
    };
  }, [
    registeringCurlerDateOfBirth,
    membershipPayment?.selection.membershipOption,
    membershipPayment?.selection.experienceType,
    membershipPayment?.selection.experienceSelfReportedYears,
    membershipPayment?.knownExperienceYears,
    membershipChoice,
    basicIcePrivileges,
    experienceChoice,
    experienceYears,
  ]);
  const demographicsCurlerName = [demographics.firstName, demographics.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const registeringCurlerName =
    payload?.curler?.name || demographicsCurlerName || 'Registering curler';

  const currentStep = useMemo(() => {
    if (location.pathname === '/registration/start') return 'start';
    if (location.pathname === '/registration/success') return 'success';
    if (location.pathname === '/registration/cancel') return 'cancel';
    return stepParam || 'start';
  }, [location.pathname, stepParam]);

  const paymentRegistrationId = useMemo(() => {
    const raw = searchParams.get('registration_id');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [searchParams]);

  const paymentOrderToken = searchParams.get('order_token');
  const paymentSessionId = searchParams.get('session_id')?.trim() || '';
  const registeringForSomeoneElse = searchParams.get('for') === 'other';
  /** Logged-in users on new-curler identity setup are always registering someone else. */
  const identityRegisteringForOther =
    registeringForSomeoneElse || registeringForSelf === 'other' || Boolean(member);

  const priorSeasonReturnLeagues = useMemo(() => {
    if (!hasPriorSeasonReturnLeagues(leaguePayload, windowState?.state)) return [];
    return (leaguePayload?.leagues ?? []).filter(
      (league) =>
        league.predecessorLeagueId != null &&
        leaguePayload?.participatedLeagueIds.includes(league.predecessorLeagueId),
    );
  }, [leaguePayload, windowState?.state]);

  const priorSeasonReturnLeagueIds = useMemo(
    () => new Set(priorSeasonReturnLeagues.map((league) => league.id)),
    [priorSeasonReturnLeagues],
  );

  const selectedLeagueIds = useMemo(
    () =>
      new Set(
        leagueSelections
          .filter(
            (selection) =>
              selection.leagueId != null &&
              !isThirdLeagueInterestSelection(selection) &&
              selection.selectionType !== 'waitlist_remove',
          )
          .map((selection) => selection.leagueId as number),
      ),
    [leagueSelections],
  );

  const waitlistEligibleLeagues = useMemo(
    () =>
      (leaguePayload?.leagues ?? []).filter(
        (league) => league.allowsWaitlist && isLeagueSelectionEligibleLeague(league, leagueEligibilityInput),
      ),
    [leaguePayload, leagueEligibilityInput],
  );

  const directLeagueRequestEligibleLeagues = useMemo(
    () =>
      filterDirectLeagueRequestEligibleLeagues(
        leaguePayload?.leagues ?? [],
        leagueEligibilityInput,
        priorSeasonReturnLeagueIds,
      ),
    [leaguePayload, leagueEligibilityInput, priorSeasonReturnLeagueIds],
  );

  const leagueCatalogOrder = useMemo(() => {
    const order = new Map<number, number>();
    (leaguePayload?.leagues ?? []).forEach((league, index) => order.set(league.id, index));
    return order;
  }, [leaguePayload]);

  const guaranteedReturnSelectionCount = useMemo(
    () => leagueSelections.filter((selection) => selection.selectionType === 'guaranteed_return').length,
    [leagueSelections],
  );

  const isBasicIceLeagueSelection = icePrivilegesChoice === 'basic_ice';

  const protectedReturnSelectionCount = useMemo(
    () =>
      leagueSelections.filter(
        (selection) =>
          selection.leagueId != null &&
          priorSeasonReturnLeagueIds.has(selection.leagueId) &&
          PROTECTED_RETURN_SELECTION_TYPES.has(selection.selectionType),
      ).length,
    [leagueSelections, priorSeasonReturnLeagueIds],
  );

  const scheduledLeagueSelections = useMemo(
    () =>
      leagueSelections
        .filter(
          (selection) =>
            selection.leagueId != null &&
            selectedLeagueIds.has(selection.leagueId) &&
            SCHEDULED_LEAGUE_SELECTION_TYPES.has(selection.selectionType),
        )
        .sort(
          (a, b) =>
            (leagueCatalogOrder.get(a.leagueId as number) ?? Number.MAX_SAFE_INTEGER) -
            (leagueCatalogOrder.get(b.leagueId as number) ?? Number.MAX_SAFE_INTEGER),
        ),
    [leagueCatalogOrder, leagueSelections, selectedLeagueIds],
  );

  const sortedLeagueSelections = useMemo(
    () =>
      leagueSelections
        .map((selection, index) => ({ selection, index }))
        .sort((a, b) => {
          const aOrder =
            a.selection.leagueId == null
              ? Number.MAX_SAFE_INTEGER
              : (leagueCatalogOrder.get(a.selection.leagueId) ?? Number.MAX_SAFE_INTEGER);
          const bOrder =
            b.selection.leagueId == null
              ? Number.MAX_SAFE_INTEGER
              : (leagueCatalogOrder.get(b.selection.leagueId) ?? Number.MAX_SAFE_INTEGER);
          return aOrder - bOrder || a.index - b.index;
        })
        .map(({ selection }) => selection),
    [leagueCatalogOrder, leagueSelections],
  );

  const isGuestLocal = !member;

  const juniorRecreationalEligible = useMemo(
    () => isJuniorRecreationalEligibleDate(demographics.dateOfBirth),
    [demographics.dateOfBirth],
  );

  const membershipOptions = useMemo(() => {
    const options: Array<{
      value: 'regular' | 'social' | 'junior_recreational';
      label: string;
      description: string;
    }> = [
      {
        value: 'regular',
        label: 'Regular membership',
        description: 'Choose this if the curler plans to curl, spare, practice, or register for leagues.',
      },
      {
        value: 'social',
        label: 'Social membership',
        description: 'Choose this if the curler wants to be a member but will not curl this session.',
      },
    ];
    if (juniorRecreationalEligible) {
      options.push({
        value: 'junior_recreational',
        label: 'Junior Recreational',
        description: 'Choose this special junior program. It skips normal league selection.',
      });
    }
    return options;
  }, [juniorRecreationalEligible]);

  const discountChoiceOptions = useMemo(() => {
    const studentSlot = windowState?.availableDiscounts?.student;
    const reciprocalSlot = windowState?.availableDiscounts?.reciprocal;
    return [
      {
        value: 'student' as const,
        label: registrationDiscountLabel('Student discount', studentSlot),
        description: 'Available for K-12 students and full-time college or university students.',
      },
      {
        value: 'reciprocal' as const,
        label: registrationDiscountLabel('Reciprocal discount', reciprocalSlot),
        description: 'Available to members of another dedicated ice or arena curling club.',
      },
    ];
  }, [windowState?.availableDiscounts]);

  const hydrateFromServerPayload = useCallback((data: RegistrationShellPayload & { id: number }) => {
    const { id, ...shell } = data;
    setRegistrationId(id);
    setPayload(shell as RegistrationShellPayload);
    setDemographics(demographicsFromMember(data.curler));
    setGuardian({
      firstName: data.registration.guardian_first_name || '',
      lastName: data.registration.guardian_last_name || '',
      email: data.registration.guardian_email || '',
      phone: data.registration.guardian_phone || '',
    });
  }, []);

  const hydrateDraftFromServerById = useCallback(
    async (draftId: number) => {
      const { data } = await api.get<RegistrationShellPayload>(`/registration/drafts/${draftId}`);
      hydrateFromServerPayload({ id: draftId, ...data } as RegistrationShellPayload & { id: number });
    },
    [hydrateFromServerPayload],
  );

  const applyGuestDraftToState = useCallback((draft: LocalRegistrationDraftV1) => {
    setRegisteringForSelf(draft.registeringForSelf);
    setSameEmail(draft.sameEmail);
    const submitterEmail = member?.email?.trim() ?? '';
    setDemographics(
      draft.sameEmail === 'same' && submitterEmail
        ? { ...draft.demographics, email: submitterEmail }
        : draft.demographics,
    );
    setGuardian(draft.guardian);
    setMembershipChoice(draft.membershipChoice);
    setBasicIcePrivileges(draft.basicIcePrivileges);
    setStudentDiscountClaimed(draft.studentDiscountClaimed);
    setStudentInstitution(draft.studentInstitution);
    setReciprocalDiscountClaimed(draft.reciprocalDiscountClaimed);
    setReciprocalClubName(draft.reciprocalClubName);
    setExperienceChoice(draft.experienceChoice);
    setExperienceYears(draft.experienceYears);
  }, [member?.email]);

  const persistGuestDraft = useCallback(
    (step: string) => {
      if (!windowState || member) return;
      saveLocalDraft(
        buildGuestDraftBase(windowState, {
          registeringForSelf,
          sameEmail,
          demographics: demographicsRef.current,
          guardian,
          membershipChoice: membershipChoice === 'junior_recreational' ? 'regular' : membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution,
          reciprocalDiscountClaimed,
          reciprocalClubName,
          experienceChoice,
          experienceYears,
          step,
        }),
      );
    },
    [
      windowState,
      member,
      registeringForSelf,
      sameEmail,
      guardian,
      membershipChoice,
      basicIcePrivileges,
      studentDiscountClaimed,
      studentInstitution,
      reciprocalDiscountClaimed,
      reciprocalClubName,
      experienceChoice,
      experienceYears,
    ],
  );

  const persistGuestDraftRef = useRef(persistGuestDraft);
  persistGuestDraftRef.current = persistGuestDraft;

  useEffect(() => {
    api
      .get('/registration/window')
      .then((response) => setWindowState(response.data))
      .catch((err) => setError(errorMessage(err, 'Registration is not available.')));
  }, []);

  const startBootstrapKey = useMemo(() => {
    if (!windowState) return '';
    return `${windowState.season.id}:${windowState.session.id}:${member?.id ?? 'guest'}`;
  }, [windowState, member?.id]);

  useEffect(() => {
    if (currentStep !== 'start') {
      startBootstrapKeyRef.current = '';
      setResumeCheckComplete(false);
      return;
    }
    if (!windowState || authLoading || !startBootstrapKey) return;

    // Only skip when a prior run finished for this key (ref is set on completion, not at start).
    if (startBootstrapKeyRef.current === startBootstrapKey) return;

    if (startBootstrapKeyRef.current !== '') {
      setResumeCheckComplete(false);
    }

    const generation = ++resumeCheckGenerationRef.current;

    const finishResumeCheck = () => {
      queueMicrotask(() => {
        if (generation !== resumeCheckGenerationRef.current) return;
        startBootstrapKeyRef.current = startBootstrapKey;
        setResumeCheckComplete(true);
      });
    };

    void (async () => {
      if (member) {
        try {
          const { data } = await api.get<{
            draft: (RegistrationShellPayload & { id: number }) | null;
            completedSelfRegistration: { id: number } | null;
          }>('/registration/drafts/me');
          if (generation !== resumeCheckGenerationRef.current) return;
          setCompletedSelfRegistrationId(data.completedSelfRegistration?.id ?? null);
          if (data.draft) {
            setServerResume(data.draft);
            setResumeOffer('server');
          } else {
            setServerResume(null);
            setResumeOffer('none');
          }
        } catch {
          if (generation !== resumeCheckGenerationRef.current) return;
          setCompletedSelfRegistrationId(null);
          setServerResume(null);
          setResumeOffer('none');
        }
      } else {
        const local = loadLocalDraft();
        if (generation !== resumeCheckGenerationRef.current) return;
        if (
          local &&
          local.seasonId === windowState.season.id &&
          local.sessionId === windowState.session.id &&
          local.returningAnswer === 'no'
        ) {
          setResumeOffer('local');
        } else {
          setResumeOffer('none');
        }
      }
      finishResumeCheck();
    })();

    return () => {
      resumeCheckGenerationRef.current += 1;
    };
  }, [currentStep, member, windowState, authLoading, startBootstrapKey]);

  useEffect(() => {
    if (!isPriorityEdit || !member || currentStep === 'start' || currentStep === 'success' || currentStep === 'cancel') return;
    if (registrationId !== null && payload) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data: current } = await api.get<{ registration: { id: number } }>('/registration/member/registrations/current', {
          params: priorityEditCurlerMemberId != null ? { curlerMemberId: priorityEditCurlerMemberId } : undefined,
        });
        if (cancelled) return;
        await hydrateDraftFromServerById(current.registration.id);
        const membershipSteps = new Set(['membership', 'discounts', 'experience', 'basic-ice', 'ice-privileges', 'review']);
        const leagueSteps = new Set(['prior-league-selection', 'league-selection', 'league-requests', 'basic-ice-fallback', 'third-league-interest', 'league-summary']);
        if (membershipSteps.has(currentStep)) {
          const response = await api.get(`/registration/drafts/${current.registration.id}/membership-payment`);
          if (!cancelled) setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        }
        if (leagueSteps.has(currentStep)) {
          const response = await api.get(`/registration/drafts/${current.registration.id}/league-catalog`);
          if (!cancelled) {
            const data = response.data as RegistrationLeagueSelectionPayload;
            setLeaguePayload(data);
            setLeagueSelections(data.selections);
            syncLeagueFlowStateFromPayload(data);
          }
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to load this registration for editing.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    hydrateDraftFromServerById,
    isPriorityEdit,
    member,
    payload,
    priorityEditCurlerMemberId,
    registrationId,
  ]);

  useEffect(() => {
    if (authLoading || !windowState || ['start', 'success', 'cancel'].includes(currentStep)) return;

    saveRegistrationResumePointer({
      v: 1,
      seasonId: windowState.season.id,
      sessionId: windowState.session.id,
      registrationId: member ? registrationId : null,
      step: currentStep,
    });

    if (!member) {
      persistGuestDraftRef.current(currentStep);
    }
  }, [
    authLoading,
    currentStep,
    windowState,
    member,
    registrationId,
  ]);

  useEffect(() => {
    if (isPriorityEdit) return;
    if (!member || currentStep === 'start' || currentStep === 'success' || currentStep === 'cancel') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<{ draft: (RegistrationShellPayload & { id: number }) | null }>('/registration/drafts/me');
        if (cancelled) return;
        if (!data.draft) {
          navigate('/registration/start', { replace: true });
          return;
        }
        hydrateFromServerPayload(data.draft);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to load this registration draft.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member?.id, currentStep, navigate, hydrateFromServerPayload, isPriorityEdit]);

  useEffect(() => {
    if (authLoading || !isGuestLocal || !windowState || ['start', 'success', 'cancel'].includes(currentStep)) return;
    const local = loadLocalDraft();
    if (!local || local.seasonId !== windowState.season.id || local.sessionId !== windowState.session.id) {
      navigate('/registration/start', { replace: true });
    } else {
      applyGuestDraftToState(local);
    }
  }, [authLoading, isGuestLocal, windowState, currentStep, navigate, applyGuestDraftToState]);

  useEffect(() => {
    if (currentStep !== 'identity' || !member || payload?.registration.returning_member_answer !== 1) {
      setReturningProfilesFetchStatus('idle');
      return;
    }
    setReturningProfilesFetchStatus('loading');
    let cancelled = false;
    api
      .get('/registration/returning-profiles', {
        params: {
          seasonId: windowState?.season.id ?? payload?.registration.season_id,
          sessionId: windowState?.session.id ?? payload?.registration.session_id,
        },
      })
      .then((response) => {
        if (cancelled) return;
        setProfiles(response.data);
        setReturningProfilesFetchStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setProfiles([]);
        setReturningProfilesFetchStatus('error');
        setError(errorMessage(err, 'Unable to load eligible curler profiles.'));
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    member,
    payload?.registration.returning_member_answer,
    payload?.registration.season_id,
    payload?.registration.session_id,
    returningIdentityAuxMode,
    windowState?.season.id,
    windowState?.session.id,
  ]);

  useEffect(() => {
    if (registeringForSomeoneElse || member) {
      setRegisteringForSelf('other');
    }
  }, [registeringForSomeoneElse, member]);

  const submitterEmailForCurler = member?.email?.trim() ?? '';
  const useSubmitterEmailForCurler = resolveUseSubmitterEmailForCurler(
    sameEmail,
    demographics.email,
    submitterEmailForCurler,
  );

  function handleSameEmailChange(value: 'same' | 'different') {
    setSameEmail(value);
    if (value === 'same' && submitterEmailForCurler) {
      setDemographics((current) => ({ ...current, email: submitterEmailForCurler }));
    }
  }

  useEffect(() => {
    const showDelayedSpinner =
      currentStep === 'identity' &&
      member &&
      payload?.registration.returning_member_answer === 1 &&
      !returningIdentityAuxMode &&
      (returningProfilesFetchStatus === 'loading' || returningProfilesFetchStatus === 'idle');
    if (!showDelayedSpinner) {
      setReturningPickerSpinnerVisible(false);
      return;
    }
    const id = window.setTimeout(() => setReturningPickerSpinnerVisible(true), 500);
    return () => window.clearTimeout(id);
  }, [
    currentStep,
    member,
    payload?.registration.returning_member_answer,
    returningIdentityAuxMode,
    returningProfilesFetchStatus,
  ]);

  useEffect(() => {
    if (currentStep !== 'identity' || payload?.registration.returning_member_answer !== 1 || !member) {
      setReturningIdentityAuxMode(null);
      setReturningRegistrarProfileChoice(null);
    }
  }, [currentStep, member, payload?.registration.returning_member_answer]);

  useEffect(() => {
    if (currentStep !== 'membership') return;
    if (membershipChoice === 'junior_recreational' && !juniorRecreationalEligible) {
      setMembershipChoice('regular');
    }
  }, [currentStep, membershipChoice, juniorRecreationalEligible]);

  useEffect(() => {
    if (currentStep !== 'basic-ice') setNoIceConfirm(false);
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== 'experience') {
      suppressExperienceAutoSkipRef.current = false;
    }
  }, [currentStep]);

  useEffect(() => {
    const membershipSteps = [
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
    ];
    if (!member || !registrationId || !payload || !membershipSteps.includes(currentStep)) return;
    if (
      !isPriorityEdit &&
      payload.registration.status !== 'shell_complete' &&
      nextStepFor(shellResumePayload(payload, registrationId)) !== 'membership'
    )
      return;

    let cancelled = false;
    (async () => {
      try {
        if (payload.registration.status !== 'shell_complete' && !isPriorityEdit) {
          await api.post(`/registration/drafts/${registrationId}/complete-shell`);
          if (cancelled) return;
          const { data } = await api.get<RegistrationShellPayload>(`/registration/drafts/${registrationId}`);
          if (cancelled) return;
          hydrateFromServerPayload({ id: registrationId, ...data });
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to continue registration.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member, registrationId, payload, currentStep, hydrateFromServerPayload, isPriorityEdit]);

  useEffect(() => {
    const membershipPaymentFlowSteps = [
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
    ];
    if (!member || !registrationId || !membershipPaymentFlowSteps.includes(currentStep)) return;
    if (payload && payload.registration.status !== 'shell_complete' && !isPriorityEdit) return;
    api
      .get(`/registration/drafts/${registrationId}/membership-payment`)
      .then((response) => {
        const data = response.data as RegistrationMembershipPaymentPayload;
        setMembershipPayment(data);
        const membershipOption = data.selection.membershipOption;
        setMembershipChoice(membershipOption === 'junior_recreational' ? 'junior_recreational' : membershipOption === 'social' ? 'social' : 'regular');
        setBasicIcePrivileges(membershipOption === 'regular_spare_only');
        setIcePrivilegesChoice((current) => {
          const onIcePrivilegesStep = currentStep === 'basic-ice';
          if (onIcePrivilegesStep && current !== null) return current;
          return icePrivilegesChoiceForUi(data.icePrivilegesChoice, onIcePrivilegesStep);
        });
        setStudentDiscountClaimed(data.selection.studentDiscountClaimed);
        setStudentInstitution(data.selection.studentInstitution || '');
        setReciprocalDiscountClaimed(data.selection.reciprocalDiscountClaimed);
        setReciprocalClubName(data.selection.reciprocalClubName || '');
        setExperienceChoice(data.selection.experienceType || (data.knownExperienceYears > 0 ? 'known_existing' : 'none_or_minimal'));
        setExperienceYears(data.selection.experienceSelfReportedYears?.toString() || '');
      })
      .catch((err) => setError(errorMessage(err, 'Unable to load membership details.')));
  }, [registrationId, member, currentStep, payload?.registration.status, isPriorityEdit]);

  useEffect(() => {
    if (currentStep !== 'experience' || !shouldSkipExperienceStep(membershipPayment, experienceChoice)) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      suppressExperienceAutoSkipRef.current = true;
      return;
    }
    if (suppressExperienceAutoSkipRef.current) return;

    let cancelled = false;
    (async () => {
      setError('');
      try {
        if (member && registrationId !== null) {
          if (membershipPayment?.selection.experienceType !== 'known_existing') {
            const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
              experienceType: 'known_existing',
              experienceSelfReportedYears: null,
            });
            if (cancelled) return;
            setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
          }
          setExperienceChoice('known_existing');
        }
        if (!cancelled) navigate('/registration/basic-ice', { replace: true });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to apply club curling experience record.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStep, member, registrationId, membershipPayment, experienceChoice, navigate]);

  useEffect(() => {
    const leagueSteps = ['prior-league-selection', 'league-selection', 'league-requests', 'basic-ice-fallback', 'third-league-interest', 'league-summary', 'review'];
    if (!member || !registrationId || !leagueSteps.includes(currentStep)) return;
    const loadKey = `${registrationId}:${currentStep}`;
    let cancelled = false;
    api
      .get(`/registration/drafts/${registrationId}/league-catalog`)
      .then((response) => {
        if (cancelled) return;
        const data = response.data as RegistrationLeagueSelectionPayload;
        setLeaguePayload(data);
        if (leagueCatalogAppliedKeyRef.current !== loadKey) {
          leagueCatalogAppliedKeyRef.current = loadKey;
          setLeagueSelections(data.selections);
          syncLeagueFlowStateFromPayload(data);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, 'Unable to load league choices.'));
      });
    return () => {
      cancelled = true;
    };
  }, [registrationId, member?.id, currentStep]);

  useEffect(() => {
    if (currentStep !== 'prior-league-selection' || !leaguePayload) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      return;
    }
    if (!hasPriorSeasonReturnLeagues(leaguePayload, windowState?.state)) {
      setError('');
      navigate(
        nextLeagueFlowStepAfterPriorLeagueSelection({
          hasDirectLeagueRequests: directLeagueRequestEligibleLeagues.length > 0,
        }),
        { replace: true },
      );
    }
  }, [currentStep, directLeagueRequestEligibleLeagues.length, leaguePayload, navigate, windowState?.state]);

  useEffect(() => {
    if (currentStep !== 'league-requests' || !leaguePayload) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      return;
    }
    if (directLeagueRequestEligibleLeagues.length === 0) {
      setError('');
      navigate('/registration/league-selection', { replace: true });
    }
  }, [
    currentStep,
    directLeagueRequestEligibleLeagues.length,
    leaguePayload,
    navigate,
  ]);

  useEffect(() => {
    const guestPhaseSteps = ['discounts', 'experience', 'basic-ice', 'review'];
    if (!isGuestLocal || !windowState || !guestPhaseSteps.includes(currentStep)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post<RegistrationMembershipPaymentPayload>('/registration/guest/preview-membership-payment', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          curlerDateOfBirth: demographics.dateOfBirth,
          membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        if (!cancelled) setMembershipPayment(data);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Unable to load membership preview.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    isGuestLocal,
    windowState,
    demographics.dateOfBirth,
    membershipChoice,
    basicIcePrivileges,
    studentDiscountClaimed,
    studentInstitution,
    reciprocalDiscountClaimed,
    reciprocalClubName,
    experienceChoice,
    experienceYears,
  ]);

  useEffect(() => {
    if (currentStep !== 'complete') return;
    if (member && registrationId !== null) {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setError('');
        try {
          if (payload?.registration.status !== 'shell_complete') {
            await api.post(`/registration/drafts/${registrationId}/complete-shell`);
          }
          if (!cancelled) navigate('/registration/membership', { replace: true });
        } catch (err) {
          if (!cancelled) {
            setError(errorMessage(err, 'Unable to continue registration.'));
            if (payload) {
              const target = nextStepFor(shellResumePayload(payload, registrationId));
              if (target !== 'membership') navigate(`/registration/${target}`, { replace: true });
            }
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    navigate('/registration/membership', { replace: true });
  }, [currentStep, member, registrationId, payload, navigate]);

  useEffect(() => {
    if (currentStep !== 'cancel' || !paymentRegistrationId || !member) return;
    api.post(`/registration/drafts/${paymentRegistrationId}/payment-cancelled`).catch(() => {});
  }, [currentStep, paymentRegistrationId, member]);

  useEffect(() => {
    if (currentStep !== 'success' || !paymentOrderToken) {
      setPaymentStatus(null);
      setPaymentStatusPolling(false);
      setShowDetailedPaymentPending(false);
      return;
    }

    let cancelled = false;
    let pollTimeoutId: number | null = null;
    let resolveAttempted = false;
    setPaymentStatusPolling(true);
    setShowDetailedPaymentPending(false);

    const detailTimerId = window.setTimeout(() => {
      if (cancelled) return;
      setShowDetailedPaymentPending(true);
    }, REGISTRATION_PAYMENT_PROCESSING_GRACE_MS);

    const tryResolveFromCheckoutReturn = async (): Promise<boolean> => {
      if (!paymentSessionId || resolveAttempted) return false;
      resolveAttempted = true;

      try {
        const { data } = await api.post<RegistrationPaymentStatusPayload>(
          `/registration/payment-status/${encodeURIComponent(paymentOrderToken)}/resolve`,
          { sessionId: paymentSessionId },
        );
        if (cancelled) return false;
        setPaymentStatus(data);
        setError('');
        if (!isRegistrationPaymentPending(data.paymentStatus)) {
          setPaymentStatusPolling(false);
          return true;
        }
      } catch {
        // Ignore return-path resolve failures and fall back to regular polling.
      }

      return false;
    };

    const poll = async () => {
      try {
        const resolved = await tryResolveFromCheckoutReturn();
        if (resolved) return;

        const { data } = await api.get<RegistrationPaymentStatusPayload>(
          `/registration/payment-status/${encodeURIComponent(paymentOrderToken)}`,
        );
        if (cancelled) return;
        setPaymentStatus(data);
        setError('');

        if (!isRegistrationPaymentPending(data.paymentStatus)) {
          setPaymentStatusPolling(false);
          return;
        }

        pollTimeoutId = window.setTimeout(() => {
          void poll();
        }, REGISTRATION_PAYMENT_POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setPaymentStatusPolling(false);
        setError(errorMessage(err, 'Unable to confirm payment status.'));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(detailTimerId);
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
      }
    };
  }, [currentStep, paymentOrderToken, paymentSessionId]);

  useEffect(() => {
    if (!['success', 'cancel'].includes(currentStep)) return;
    if (!member) return;
    const id = paymentRegistrationId ?? registrationId;
    if (id === null || payload?.curler?.name) return;

    let cancelled = false;
    void api
      .get<RegistrationShellPayload>(`/registration/drafts/${id}`)
      .then(({ data }) => {
        if (cancelled) return;
        hydrateFromServerPayload({ id, ...data });
      })
      .catch(() => {
        // Header falls back to sessionStorage when present.
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    member,
    paymentRegistrationId,
    registrationId,
    payload?.curler?.name,
    hydrateFromServerPayload,
  ]);

  const seasonSessionLabel = useMemo(() => {
    if (!windowState) return 'the upcoming season';
    return `${windowState.session.name}`;
  }, [windowState]);

  const resumeCurlerName = useMemo(() => {
    if (resumeOffer === 'server' && serverResume?.curler) {
      const fromName = serverResume.curler.name?.trim();
      if (fromName) return fromName;
      return [serverResume.curler.firstName, serverResume.curler.lastName].filter(Boolean).join(' ').trim();
    }
    if (resumeOffer === 'local') {
      const local = loadLocalDraft();
      if (local) {
        return [local.demographics.firstName, local.demographics.lastName].filter(Boolean).join(' ').trim();
      }
    }
    return '';
  }, [resumeOffer, serverResume]);

  const registrationFlowHeaderTitle = useMemo(() => {
    let curlerName = (payload?.curler?.name || demographicsCurlerName).trim();
    if (!curlerName && ['success', 'cancel'].includes(currentStep)) {
      const id = paymentRegistrationId ?? registrationId;
      if (id !== null) {
        curlerName = readSuccessCurlerName(id)?.trim() ?? '';
      }
    }
    if (!curlerName && returningRegistrarProfileChoice) {
      const matchedProfile = profiles.find(
        (profile) => returningEligibleProfileChoiceValue(profile.id) === returningRegistrarProfileChoice,
      );
      curlerName = matchedProfile?.name.trim() ?? '';
    }
    if (curlerName) {
      return `${seasonSessionLabel} registration for ${curlerName}`;
    }
    return `${seasonSessionLabel} registration`;
  }, [
    seasonSessionLabel,
    payload?.curler?.name,
    demographicsCurlerName,
    currentStep,
    paymentRegistrationId,
    registrationId,
    returningRegistrarProfileChoice,
    profiles,
  ]);

  const unrecognizedReturningEmailCopy = useMemo(() => {
    const explicit = windowState?.previousRegistrationSessionDisplayName?.trim();
    if (explicit) {
      return {
        question: `We do not recognize this email address. Did you curl in the ${explicit} session?`,
        yesOption: `Yes, I curled in ${explicit}`,
      };
    }
    return {
      question: 'We do not recognize this email address. Did you curl in the previous session?',
      yesOption: 'Yes, I curled in the previous session',
    };
  }, [windowState?.previousRegistrationSessionDisplayName]);

  function resetReturningGuestLoginFlow() {
    setReturningGuestLoginPhase(null);
    setReturningLoginEmail('');
    setReturningLoginCode('');
    setReturningLoginMultipleMembers([]);
    setReturningLoginTempToken('');
    setReturningLoginUnrecognizedChoice(null);
  }

  async function finalizeAuthenticatedReturningRegistration(
    accessToken: string,
    refreshToken: string,
    authMember: AuthenticatedMember,
  ) {
    if (!windowState) {
      setError('Registration is not available.');
      return;
    }
    const normalized = normalizeReturningLoginMember(authMember);
    setLoading(true);
    setError('');
    try {
      if (!normalized.firstLoginCompleted) {
        resetReturningGuestLoginFlow();
        await login(accessToken, refreshToken, normalized, '/registration/start');
        return;
      }

      await login(accessToken, refreshToken, normalized, '/registration/identity', { suppressNavigation: true });

      const createResponse = await api.post('/registration/drafts', {
        seasonId: windowState.season.id,
        sessionId: windowState.session.id,
        returningMember: true,
      });
      const draft = createResponse.data as { id?: number };
      if (typeof draft.id !== 'number') {
        setError('Unable to create a registration draft.');
        return;
      }
      await hydrateDraftFromServerById(draft.id);

      resetReturningGuestLoginFlow();
      navigate('/registration/identity');
    } catch (err) {
      setError(errorMessage(err, 'Unable to finish signing you in.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReturningUnrecognizedContinue(event: React.FormEvent) {
    event.preventDefault();
    if (!returningLoginUnrecognizedChoice) {
      setError('Choose an option to continue.');
      return;
    }
    setError('');
    if (returningLoginUnrecognizedChoice === 'curled_prior_named_session') {
      setReturningGuestLoginPhase('different-email-help');
      return;
    }
    await submitReturningGuestFreshRegistrationWithoutLogin();
  }

  async function submitReturningGuestFreshRegistrationWithoutLogin() {
    resetReturningGuestLoginFlow();
    await startDraft('no');
  }

  async function handleReturningGuestMagicLinkSendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!windowState || !returningLoginEmail.includes('@')) {
      setError('Enter your email address.');
      return;
    }
    const contact = returningLoginEmail.trim();
    setError('');
    setLoading(true);
    try {
      const response = await post('/auth/request-code', { contact });
      if (isReturningLoginTokenResponse(response)) {
        const memberNormalized = normalizeReturningLoginMember(response.member as AuthenticatedMember);
        await finalizeAuthenticatedReturningRegistration(response.accessToken, response.refreshToken, memberNormalized);
      } else if (isReturningLoginSelectionResponse(response)) {
        setReturningLoginMultipleMembers(response.members);
        setReturningLoginTempToken(response.tempToken);
        setReturningGuestLoginPhase('select');
      } else {
        const codeResponse = response as { success: boolean; multipleMembers: boolean };
        if (codeResponse.multipleMembers) {
          setReturningLoginMultipleMembers([]);
        }
        setReturningGuestLoginPhase('code');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setReturningLoginUnrecognizedChoice(null);
        setReturningGuestLoginPhase('unrecognized-followup');
      } else {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
        setError(typeof msg === 'string' ? msg : 'Unable to send a login code.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReturningGuestMagicLinkVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!returningLoginEmail.includes('@')) {
      setError('Enter your email address.');
      return;
    }
    const contact = returningLoginEmail.trim();
    setError('');
    setLoading(true);
    try {
      const response = await post('/auth/verify-code', { contact, code: returningLoginCode });
      if (isReturningLoginSelectionResponse(response)) {
        setReturningLoginMultipleMembers(response.members);
        setReturningLoginTempToken(response.tempToken);
        setReturningGuestLoginPhase('select');
      } else if (isReturningLoginTokenResponse(response)) {
        const memberNormalized = normalizeReturningLoginMember(response.member as AuthenticatedMember);
        await finalizeAuthenticatedReturningRegistration(response.accessToken, response.refreshToken, memberNormalized);
      } else {
        setError('Could not verify the code.');
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(typeof msg === 'string' ? msg : 'Invalid code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReturningGuestMagicLinkSelect(memberId: number) {
    if (!returningLoginTempToken) return;
    setError('');
    setLoading(true);
    try {
      const response = await post('/auth/select-member', { memberId, tempToken: returningLoginTempToken });
      if (isReturningLoginSelectionResponse(response)) {
        setReturningLoginMultipleMembers(response.members);
        setReturningLoginTempToken(response.tempToken);
        setReturningGuestLoginPhase('select');
      } else if (isReturningLoginTokenResponse(response)) {
        const memberNormalized = normalizeReturningLoginMember(response.member as AuthenticatedMember);
        await finalizeAuthenticatedReturningRegistration(response.accessToken, response.refreshToken, memberNormalized);
      } else {
        setError('Could not complete login.');
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(typeof msg === 'string' ? msg : 'Failed to login.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartScreenContinue() {
    if (!returningAnswer || !windowState) return;

    setError('');
    if (returningAnswer === 'yes' && member) {
      await startDraft('yes');
      return;
    }
    if (returningAnswer === 'yes' && !member) {
      if (!returningGuestLoginPhase) {
        setReturningGuestLoginPhase('email');
        return;
      }
      return;
    }
    resetReturningGuestLoginFlow();
    await startDraft('no');
  }

  async function handleStartOver() {
    const accepted = await confirm({
      title: 'Start over?',
      message:
        'This clears your in-progress registration and returns you to the registration start page. This cannot be undone.',
      confirmText: 'Start over',
      variant: 'warning',
    });
    if (!accepted) return;
    setError('');
    setLoading(true);
    try {
      if (member) {
        try {
          const { data } = await api.get<{ draft: { id: number } | null }>('/registration/drafts/me');
          if (data.draft) {
            await api.delete(`/registration/drafts/${data.draft.id}`);
          }
        } catch (err) {
          if (registrationId !== null) {
            await api.delete(`/registration/drafts/${registrationId}`);
          } else {
            throw err;
          }
        }
      }
      clearLocalDraft();
      setRegistrationId(null);
      setPayload(null);
      setMembershipPayment(null);
      setResumeOffer('none');
      setServerResume(null);
      setReturningAnswer(null);
      resetReturningGuestLoginFlow();
      setReturningIdentityAuxMode(null);
      setReturningRegistrarProfileChoice(null);
      navigate('/registration/start', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to clear registration.'));
    } finally {
      setLoading(false);
    }
  }

  const navigateRegistrationBack = useCallback(
    (path: string) => {
      registrationNavigationIntentRef.current = 'back';
      navigate(path);
    },
    [navigate],
  );

  const handleBackToRegistrationStart = useCallback(async () => {
    if (backToStartInFlightRef.current) return;
    backToStartInFlightRef.current = true;
    setError('');
    setLoading(true);
    try {
      if (member) {
        try {
          const { data } = await api.get<{ draft: { id: number } | null }>('/registration/drafts/me');
          if (data.draft) {
            await api.delete(`/registration/drafts/${data.draft.id}`);
          }
        } catch (err) {
          if (registrationId !== null) {
            await api.delete(`/registration/drafts/${registrationId}`);
          } else {
            throw err;
          }
        }
      }
      clearLocalDraft();
      clearRegistrationResumePointer();
      setRegistrationId(null);
      setPayload(null);
      setMembershipPayment(null);
      setServerResume(null);
      setResumeOffer('none');
      setReturningAnswer(null);
      resetReturningGuestLoginFlow();
      setReturningIdentityAuxMode(null);
      setReturningRegistrarProfileChoice(null);
      setReturningProfilesFetchStatus('idle');
      navigate('/registration/start', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to go back.'));
    } finally {
      backToStartInFlightRef.current = false;
      setLoading(false);
    }
  }, [member, navigate, registrationId]);

  async function handleResumeLocalContinue() {
    const local = loadLocalDraft();
    if (!local) {
      setResumeOffer('none');
      return;
    }
    applyGuestDraftToState(local);
    const pointer = loadRegistrationResumePointer();
    const resumeStep =
      pointer && resumePointerMatchesGuestDraft(pointer, local)
        ? pointer.step
        : local.step === 'complete'
          ? 'membership'
          : local.step;
    navigate(`/registration/${resumeStep}`, { replace: true });
  }

  async function handleResumeServerContinue() {
    if (!serverResume) return;
    hydrateFromServerPayload(serverResume);
    const target = await resolveResumeStepForDraft(serverResume);
    setResumeOffer('none');
    navigate(`/registration/${target}`, { replace: true });
  }

  function handleRegisterForSomeoneElse() {
    setReturningAnswer(null);
    resetReturningGuestLoginFlow();
    setError('');
    navigate('/registration/start?for=other', { replace: true });
  }

  async function handleResumeDiscard() {
    const accepted = await confirm({
      title: 'Start from the beginning?',
      message: 'Your saved progress will be removed.',
      confirmText: 'Discard progress',
      variant: 'warning',
    });
    if (!accepted) return;
    if (resumeOffer === 'server' && serverResume) {
      try {
        await api.delete(`/registration/drafts/${serverResume.id}`);
      } catch (err) {
        setError(errorMessage(err, 'Unable to discard registration.'));
        return;
      }
      clearRegistrationResumePointer();
    } else if (resumeOffer === 'local') {
      clearLocalDraft();
    }
    setServerResume(null);
    setResumeOffer('none');
  }

  async function startDraft(answer: 'yes' | 'no') {
    if (!windowState) return;
    setLoading(true);
    setError('');
    try {
      if (answer === 'yes') {
        if (!member) {
          return;
        }
        const response = await api.post('/registration/drafts', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          returningMember: true,
        });
        const draft = response.data as { id: number };
        await hydrateDraftFromServerById(draft.id);
        navigate('/registration/identity');
        return;
      }
      if (member) {
        const response = await api.post('/registration/drafts', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          returningMember: false,
        });
        const draft = response.data as { id: number };
        await hydrateDraftFromServerById(draft.id);
        navigate('/registration/identity');
        return;
      }
      saveLocalDraft(
        buildGuestDraftBase(windowState, {
          step: 'identity',
        }),
      );
      navigate('/registration/identity');
    } catch (err) {
      setError(errorMessage(err, 'Unable to start registration.'));
    } finally {
      setLoading(false);
    }
  }

  async function attachReturningProfile(curlerMemberId: number) {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    setReturningIdentityAuxMode(null);
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/identity-returning`, { curlerMemberId });
      const row = response.data as { id: number };
      const effectiveId = typeof row?.id === 'number' ? row.id : Number(registrationId);
      setRegistrationId(effectiveId);
      setReturningRegistrarProfileChoice(null);
      navigate('/registration/policies', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to select that curler profile.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReturningRegistrarContinue() {
    const value = returningRegistrarProfileChoice;
    if (!value) {
      setError('Choose who you are registering.');
      return;
    }
    setError('');
    if (value.startsWith('profile:')) {
      const id = Number(value.slice('profile:'.length));
      if (!Number.isFinite(id)) return;
      await attachReturningProfile(id);
      return;
    }
    if (value === RETURNING_IDENTITY_OTHER_NEW_VALUE) {
      setRegisteringForSelf('other');
      setReturningIdentityAuxMode('other_new_member');
      return;
    }
    if (value === RETURNING_IDENTITY_OTHER_RETURNING_VALUE) {
      setReturningIdentityAuxMode('delegation_instructions');
    }
  }

  function readIdentityDemographicsDraft(): DemographicsForm {
    return identityDemographicFieldsRef.current?.getValue() ?? demographicsRef.current;
  }

  async function submitNewIdentity(event: React.FormEvent) {
    event.preventDefault();
    const form = readIdentityDemographicsDraft();
    demographicsRef.current = form;
    setDemographics(form);
    setLoading(true);
    setError('');
    try {
      if (!registrationDemographicsFormIsComplete(form)) {
        setError('Enter all required curler information before continuing.');
        return;
      }
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/identity-new`, {
          registeringForSelf: identityRegisteringForOther ? false : registeringForSelf === 'self',
          curler: demographicsPayloadForIdentityApi(form),
          submitter: member ? undefined : demographicsPayloadForIdentityApi(form),
          useSubmitterEmailForCurler,
        });
        const { data } = await api.get<RegistrationShellPayload>(`/registration/drafts/${registrationId}`);
        hydrateFromServerPayload({ id: registrationId, ...data });
        navigate('/registration/policies');
      } else if (windowState) {
        persistGuestDraftRef.current('policies');
        navigate('/registration/policies');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to set up the registration account.'));
    } finally {
      setLoading(false);
    }
  }

  async function submitReturningOtherNewMemberIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!member || registrationId === null) return;
    const form = readIdentityDemographicsDraft();
    demographicsRef.current = form;
    setDemographics(form);
    setLoading(true);
    setError('');
    try {
      if (!registrationDemographicsFormIsComplete(form)) {
        setError('Enter all required curler information before continuing.');
        return;
      }
      await api.patch(`/registration/drafts/${registrationId}/identity-new`, {
        registeringForSelf: false,
        curler: demographicsPayloadForIdentityApi(form),
        useSubmitterEmailForCurler,
      });
      const { data } = await api.get<RegistrationShellPayload>(`/registration/drafts/${registrationId}`);
      hydrateFromServerPayload({ id: registrationId, ...data });
      setReturningIdentityAuxMode(null);
      setReturningRegistrarProfileChoice(null);
      navigate('/registration/policies');
    } catch (err) {
      setError(errorMessage(err, 'Unable to set up the registration account.'));
    } finally {
      setLoading(false);
    }
  }

  async function acceptPolicies(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/policies`, {
          acceptedPolicyTypes: ['code_of_conduct', 'maapp', 'privacy'],
        });
        const data = response.data as RegistrationShellPayload;
        hydrateFromServerPayload({ id: registrationId, ...data });
        navigate(`/registration/${nextStepFor(shellResumePayload(data, registrationId))}`);
      } else {
        const nextStep = guestNextStepAfterPolicies(demographics);
        persistGuestDraft(nextStep);
        navigate(`/registration/${nextStep}`);
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to record policy acceptance.'));
    } finally {
      setLoading(false);
    }
  }

  const submitDemographics = useCallback(async (form: DemographicsForm) => {
    demographicsRef.current = form;
    setDemographics(form);
    setLoading(true);
    setError('');
    try {
      if (!registrationMailingAddressIsComplete(form)) {
        setError('Enter your full mailing address, including street address, before continuing.');
        return;
      }
      if (member && registrationId !== null) {
        const response = await api.patch(
          `/registration/drafts/${registrationId}/demographics`,
          demographicsPayloadForPersistedSave(form),
        );
        const data = response.data as RegistrationShellPayload;
        if (data.isMinor) {
          navigate('/registration/guardian');
        } else {
          await api.post(`/registration/drafts/${registrationId}/complete-shell`);
          navigate('/registration/membership');
        }
      } else if (isMinorDate(form.dateOfBirth)) {
        persistGuestDraftRef.current('guardian');
        navigate('/registration/guardian');
      } else {
        persistGuestDraftRef.current('membership');
        navigate('/registration/membership');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save demographic information.'));
    } finally {
      setLoading(false);
    }
  }, [member, registrationId, navigate]);

  const handleRegistrationDemographicsBack = useCallback(() => {
    navigateRegistrationBack('/registration/policies');
  }, [navigateRegistrationBack]);

  async function submitGuardian(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/guardian`, guardian);
        await api.post(`/registration/drafts/${registrationId}/complete-shell`);
        navigate('/registration/membership');
      } else {
        persistGuestDraft('membership');
        navigate('/registration/membership');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save parent/guardian information.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveMembership(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
          membershipOption: membershipChoice,
          basicIcePrivileges: false,
          juniorAssistancePercent: membershipChoice === 'junior_recreational' ? Number(juniorAssistancePercent) : 0,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        navigate(
          membershipChoice === 'social'
            ? '/registration/review'
            : membershipChoice === 'junior_recreational'
              ? '/registration/league-summary'
              : '/registration/discounts'
        );
      } else {
        persistGuestDraft(membershipChoice === 'social' ? 'review' : 'discounts');
        navigate(membershipChoice === 'social' ? '/registration/review' : '/registration/discounts');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save membership choice.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveDiscounts(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/discounts`, {
          studentDiscountClaimed,
          studentInstitution,
          reciprocalDiscountClaimed,
          reciprocalClubName,
        });
        const data = response.data as RegistrationMembershipPaymentPayload;
        setMembershipPayment(data);
        if (hasClubExperienceRecord(data.knownExperienceYears)) {
          setExperienceChoice('known_existing');
          if (data.selection.experienceType !== 'known_existing') {
            const experienceResponse = await api.patch(`/registration/drafts/${registrationId}/experience`, {
              experienceType: 'known_existing',
              experienceSelfReportedYears: null,
            });
            setMembershipPayment(experienceResponse.data as RegistrationMembershipPaymentPayload);
          }
        }
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        navigate(`/registration/${stepAfterDiscounts(data)}`);
      } else {
        persistGuestDraft('experience');
        navigate('/registration/experience');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save discounts.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveExperience(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        navigate('/registration/basic-ice');
      } else {
        persistGuestDraft('basic-ice');
        navigate('/registration/basic-ice');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save curling experience.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveBasicIce(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
          membershipOption: 'regular',
          basicIcePrivileges,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        navigate('/registration/league-selection');
      } else {
        persistGuestDraft('review');
        navigate('/registration/review');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save basic ice privileges.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveIcePrivileges(choice: IcePrivilegesChoice) {
    if (!member || registrationId === null) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/ice-privileges`, { choice });
      setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
      setIcePrivilegesChoice(choice);
      setBasicIcePrivileges(choice === 'basic_ice');
      if (choice === 'none') {
        setLeagueSelections([]);
        setNoIceConfirm(false);
        navigate('/registration/review');
      } else if (choice === 'league_play') {
        const { data } = await api.get(`/registration/drafts/${registrationId}/league-catalog`);
        const catalog = data as RegistrationLeagueSelectionPayload;
        setLeaguePayload(catalog);
        setLeagueSelections(catalog.selections);
        const priorReturnLeagueIds = hasPriorSeasonReturnLeagues(catalog, windowState?.state)
          ? new Set(
              catalog.leagues
                .filter(
                  (league) =>
                    league.predecessorLeagueId != null &&
                    catalog.participatedLeagueIds.includes(league.predecessorLeagueId),
                )
                .map((league) => league.id),
            )
          : new Set<number>();
        navigate(
          hasPriorSeasonReturnLeagues(catalog, windowState?.state)
            ? '/registration/prior-league-selection'
            : nextLeagueFlowStepAfterPriorLeagueSelection({
                hasDirectLeagueRequests:
                  filterDirectLeagueRequestEligibleLeagues(
                    catalog.leagues,
                    leagueEligibilityInput,
                    priorReturnLeagueIds,
                  ).length > 0,
              }),
        );
      } else {
        navigate('/registration/league-selection');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save ice privileges.'));
    } finally {
      setLoading(false);
    }
  }

  function syncLeagueFlowStateFromPayload(data: RegistrationLeagueSelectionPayload) {
    const shouldCollectWaitlistFulfillment = requiresWaitlistFulfillmentPreferences(data.selections);
    setAddWaitlistPriority(shouldCollectWaitlistFulfillment ? addWaitlistPriorityFromSelections(data.selections) : []);
    setDesiredAddWaitlistLeagueCount(
      shouldCollectWaitlistFulfillment
        ? (data.desiredAddWaitlistLeagueCount ??
            defaultDesiredAddWaitlistLeagueCount(data.activeLeagueIds, data.selections))
        : null,
    );
    setBasicIceFallbackInterest(data.basicIceFallbackInterest ?? null);
  }

  useEffect(() => {
    if (!requiresWaitlistFulfillmentPreferences(leagueSelections)) {
      setAddWaitlistPriority([]);
      setDesiredAddWaitlistLeagueCount(null);
      return;
    }
    setAddWaitlistPriority((current) => {
      const activeIds = new Set(getAddWaitlistSelections(leagueSelections).map((selection) => selection.leagueId as number));
      const preserved = current.filter((id) => activeIds.has(id));
      const derived = addWaitlistPriorityFromSelections(leagueSelections);
      const missing = derived.filter((id) => !preserved.includes(id));
      const next = [...preserved, ...missing];
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      return next;
    });
    setDesiredAddWaitlistLeagueCount((current) => {
      const remaining = remainingFirstTwoLeagueSlots(leaguePayload?.activeLeagueIds ?? [], leagueSelections);
      if (remaining <= 0) return null;
      if (remaining <= 1) return 1;
      return current ?? defaultDesiredAddWaitlistLeagueCount(leaguePayload?.activeLeagueIds ?? [], leagueSelections);
    });
  }, [leagueSelections, leaguePayload?.activeLeagueIds]);

  async function saveLeagueSelections(nextStep = '/registration/third-league-interest', onSaved?: () => void | Promise<void>) {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    const selectionsToSave = leagueSelectionsForSave(leagueSelections, desiredAddWaitlistLeagueCount);
    const shouldCollectWaitlistFulfillment = requiresWaitlistFulfillmentPreferences(leagueSelections);
    try {
      const response = await api.put(`/registration/drafts/${registrationId}/league-selections`, {
        selections: selectionsToSave,
        desiredAddWaitlistLeagueCount: shouldCollectWaitlistFulfillment ? desiredAddWaitlistLeagueCount : null,
        addWaitlistPriority: shouldCollectWaitlistFulfillment ? addWaitlistPriority : [],
      });
      const data = response.data as RegistrationLeagueSelectionPayload;
      setLeaguePayload(data);
      setLeagueSelections(data.selections);
      syncLeagueFlowStateFromPayload(data);
      if (onSaved) {
        await onSaved();
        return;
      }
      navigate(nextStep);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save league selections.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveBasicIceFallback(
    interested: boolean,
    onSaved?: () => void | Promise<void>,
  ) {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.patch(`/registration/drafts/${registrationId}/basic-ice-fallback`, { interested });
      const data = response.data as RegistrationLeagueSelectionPayload;
      setLeaguePayload(data);
      setLeagueSelections(data.selections);
      syncLeagueFlowStateFromPayload(data);
      if (onSaved) {
        await onSaved();
        return;
      }
      navigate('/registration/league-summary');
    } catch (err) {
      setError(errorMessage(err, 'Unable to save basic ice fallback choice.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentStep !== 'third-league-interest' || !leaguePayload) return;
    if (shouldCollectThirdLeagueInterest(leagueSelections, desiredAddWaitlistLeagueCount)) return;
    setError('');
    const nextStep =
      shouldCollectBasicIceFallback(leagueSelections, isBasicIceLeagueSelection) && basicIceFallbackInterest == null
        ? '/registration/basic-ice-fallback'
        : '/registration/league-summary';
    const hasThirdLeagueInterest = leagueSelections.some((selection) => selection.selectionType === 'third_league_interest');
    if (hasThirdLeagueInterest) {
      void saveLeagueSelections(nextStep);
      return;
    }
    navigate(nextStep, { replace: true });
  }, [
    basicIceFallbackInterest,
    currentStep,
    desiredAddWaitlistLeagueCount,
    isBasicIceLeagueSelection,
    leaguePayload,
    leagueSelections,
    navigate,
  ]);

  useEffect(() => {
    if (currentStep !== 'basic-ice-fallback' || !leaguePayload) return;
    if (shouldCollectBasicIceFallback(leagueSelections, isBasicIceLeagueSelection)) return;
    setError('');
    if (basicIceFallbackInterest != null) {
      setBasicIceFallbackInterest(null);
    }
    navigate('/registration/league-summary', { replace: true });
  }, [
    basicIceFallbackInterest,
    currentStep,
    isBasicIceLeagueSelection,
    leaguePayload,
    leagueSelections,
    navigate,
  ]);

  function updateLeagueSelection(leagueId: number, selectionType: RegistrationSelectionType | 'none') {
    setLeagueSelections((current) => {
      const withoutLeague = current.filter((selection) => selection.leagueId !== leagueId);
      if (selectionType === 'none') return withoutLeague;
      if (selectionType === 'return_subject_to_availability') {
        const interestCount = withoutLeague.filter((selection) =>
          isThirdLeagueInterestSelection(selection),
        ).length;
        return [
          ...withoutLeague,
          { selectionType: 'third_league_interest', leagueId, rank: interestCount + 1 },
        ];
      }
      return [...withoutLeague, { selectionType, leagueId }];
    });
  }

  function updateWaitlistPreference(leagueId: number, preference: WaitlistPreference) {
    const existingEntry = leaguePayload?.existingWaitlistEntries?.find(
      (entry) => entry.leagueId === leagueId && isActiveExistingWaitlistEntry(entry),
    );
    setLeagueSelections((current) => applyWaitlistPreferenceSelection(current, leagueId, preference, existingEntry));
  }

  function updateWaitlistReplaceSelection(leagueId: number, replacesLeagueId: number) {
    setLeagueSelections((current) => {
      const withoutLeague = current.filter((selection) => selection.leagueId !== leagueId);
      return [...withoutLeague, { selectionType: 'waitlist_replace', leagueId, replacesLeagueId }];
    });
  }

  function updatePlayInReplaceSelection(leagueId: number, replacesLeagueId: number) {
    setLeagueSelections((current) => {
      const withoutLeague = current.filter((selection) => selection.leagueId !== leagueId);
      return [...withoutLeague, { selectionType: 'play_in_request', leagueId, replacesLeagueId }];
    });
  }

  function removeNewWaitlistEntry(leagueId: number) {
    updateLeagueSelection(leagueId, 'none');
    setPlacementOptionsByLeagueId((current) => {
      if (current[leagueId] === undefined) return current;
      const next = { ...current };
      delete next[leagueId];
      return next;
    });
    if (replacementWaitlistLeagueId === leagueId) {
      setReplacementWaitlistLeagueId(null);
    }
    setError('');
  }

  function setThirdLeagueInterestSelections(leagueIds: number[]) {
    setLeagueSelections((current) => {
      const selectedSet = new Set(leagueIds);
      const nonInterest = current.filter((selection) => !isThirdLeagueInterestSelection(selection));
      for (const leagueId of priorSeasonReturnLeagueIds) {
        const hadInterest = current.some(
          (selection) => selection.leagueId === leagueId && isThirdLeagueInterestSelection(selection),
        );
        const hasOtherSelection = nonInterest.some((selection) => selection.leagueId === leagueId);
        if (hadInterest && !selectedSet.has(leagueId) && !hasOtherSelection) {
          nonInterest.push({ selectionType: 'drop', leagueId });
        }
      }
      const interestSelections = leagueIds.map((leagueId, index) => ({
        selectionType: 'third_league_interest' as const,
        leagueId,
        rank: index + 1,
      }));
      return [...nonInterest, ...interestSelections];
    });
  }

  function updateByotTeammates(leagueId: number, text: string) {
    setLeagueSelections((current) =>
      current.map((selection) =>
        selection.leagueId === leagueId &&
        (selection.selectionType === 'byot_request' ||
          selection.selectionType === 'play_in_request' ||
          selection.selectionType === 'waitlist_add' ||
          selection.selectionType === 'waitlist_replace' ||
          selection.selectionType === 'waitlist_add_auto_decline' ||
          selection.selectionType === 'waitlist_replace_auto_decline')
          ? { ...selection, byotTeammateText: text }
          : selection,
      )
    );
  }

  function renderByotWaitlistRosterField(
    selection: RegistrationSelectionInput,
    league: LeagueCatalogItem,
    inputId: string,
  ) {
    return (
      <RegistrationByotWaitlistFields
        league={league}
        selection={selection}
        inputId={inputId}
        tone="public"
        revealRosterOnDemand
        registeringCurler={{ id: registeringCurlerMemberId, name: registeringCurlerName }}
        memberOptionById={memberOptionById}
        memberOptionIdByName={memberOptionIdByName}
        placementOptionsByMemberId={placementOptionsByLeagueId[league.id] ?? EMPTY_BYOT_PLACEMENT_OPTIONS}
        onPlacementOptionsLoaded={(options) => handleByotPlacementOptionsLoaded(league.id, options)}
        onSelectionsChange={handleByotWaitlistSelectionsChange}
      />
    );
  }

  function validateByotWaitlistRosters(): string | null {
    return firstByotWaitlistRosterValidationMessage(
      leagueSelections,
      leaguePayload?.leagues ?? [],
      memberOptionById,
      memberOptionIdByName,
      { id: registeringCurlerMemberId, name: registeringCurlerName },
    );
  }

  async function finishPriorityEdit() {
    if (!registrationId) return;
    setLoading(true);
    setError('');
    try {
      const result = await submitRegistrationEdits(registrationId);
      if (result.requiresCheckoutConfirmation) {
        setCheckoutConfirmationMode('priority-edit');
        setCheckoutConfirmation(result);
        return;
      }
      if (result.checkoutUrl) {
        rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
        window.location.assign(result.checkoutUrl);
        return;
      }
      showAlert('Your registration has been updated.', 'success', 'Changes saved');
      navigate(priorityEditReturnTo);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save registration changes.'));
    } finally {
      setLoading(false);
    }
  }

  async function confirmPriorityEditCheckout() {
    if (!registrationId) return;
    setConfirmingCheckout(true);
    try {
      const result = await submitRegistrationEdits(registrationId, { confirmImmediatePayment: true });
      if (result.checkoutUrl) {
        rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
        window.location.assign(result.checkoutUrl);
        return;
      }
      setCheckoutConfirmation(null);
      showAlert('Your registration has been updated.', 'success', 'Changes saved');
      navigate(priorityEditReturnTo);
    } catch (err) {
      setCheckoutConfirmation(null);
      setError(errorMessage(err, 'Unable to start checkout.'));
    } finally {
      setConfirmingCheckout(false);
    }
  }

  async function confirmRegistrationCheckout() {
    if (!registrationId) return;
    setConfirmingCheckout(true);
    try {
      const result = await submitRegistrationEdits(registrationId, { confirmImmediatePayment: true });
      if (result.checkoutUrl) {
        rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
        window.location.assign(result.checkoutUrl);
        return;
      }
      setCheckoutConfirmation(null);
      rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
      navigate('/registration/success');
    } catch (err) {
      setCheckoutConfirmation(null);
      setError(errorMessage(err, 'Unable to start checkout.'));
    } finally {
      setConfirmingCheckout(false);
    }
  }

  async function submitRegistration() {
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const result = await submitRegistrationEdits(registrationId);
        if (result.requiresCheckoutConfirmation) {
          setCheckoutConfirmationMode('submit');
          setCheckoutConfirmation(result);
          return;
        }
        if (result.checkoutUrl) {
          rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
          window.location.assign(result.checkoutUrl);
          return;
        }
        rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
        navigate('/registration/success');
      } else if (windowState) {
        if (!registrationMailingAddressIsComplete(demographics)) {
          setError('Enter your full mailing address before submitting.');
          setLoading(false);
          return;
        }
        const { data } = await api.post<{ outcome: string; checkoutUrl?: string; registrationId?: number }>('/registration/guest/submit', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          registeringForSelf: registeringForSelf === 'self',
          useSubmitterEmailForCurler,
          submitter: registeringForSelf === 'self' ? undefined : demographicsPayloadForIdentityApi(demographics),
          curler: demographicsPayloadForPersistedSave(demographics),
          guardian: isMinorDate(demographics.dateOfBirth) ? guardian : undefined,
          membershipChoice,
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        rememberRegistrationCurlerNameForSuccess(data.registrationId, registeringCurlerName);
        clearLocalDraft();
        if (data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
          return;
        }
        navigate('/registration/success');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit registration.'));
    } finally {
      setLoading(false);
    }
  }

  const showStartOver =
    windowState &&
    windowState.state !== 'closed' &&
    !isPriorityEdit &&
    !['start', 'success'].includes(currentStep) &&
    !(currentStep === 'cancel' && !member);

  const resolveRegistrationFlowBackAction = useCallback((): { label: string; onClick: () => void } | null => {
    if (currentStep === 'start') return null;

    if (isPriorityEdit) {
      return { label: 'Cancel', onClick: () => navigate(priorityEditReturnTo) };
    }

    if (currentStep === 'identity') {
      if (
        returningIdentityAuxMode === 'delegation_instructions' ||
        returningIdentityAuxMode === 'other_new_member'
      ) {
        return {
          label: 'Back',
          onClick: () => {
            setReturningIdentityAuxMode(null);
            setReturningRegistrarProfileChoice(null);
            setError('');
          },
        };
      }
      return { label: 'Back', onClick: () => void handleBackToRegistrationStart() };
    }

    if (currentStep === 'basic-ice' && noIceConfirm) {
      return {
        label: 'Back',
        onClick: () => {
          setNoIceConfirm(false);
          setError('');
        },
      };
    }

    const membershipBackTarget = (): string => {
      const curlerIsMinor = payload?.isMinor ?? isMinorDate(demographics.dateOfBirth);
      const guardianCollected = Boolean(payload?.registration.guardian_email || guardian.email.trim());
      return curlerIsMinor && guardianCollected ? '/registration/guardian' : '/registration/demographics';
    };

    switch (currentStep) {
      case 'policies':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/identity') };
      case 'demographics':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/policies') };
      case 'guardian':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/demographics') };
      case 'complete':
      case 'membership':
        return { label: 'Back', onClick: () => navigateRegistrationBack(membershipBackTarget()) };
      case 'discounts':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/membership') };
      case 'experience':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/discounts') };
      case 'basic-ice':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              shouldSkipExperienceStep(membershipPayment, experienceChoice)
                ? '/registration/discounts'
                : '/registration/experience',
            ),
        };
      case 'prior-league-selection':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/basic-ice') };
      case 'league-selection':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              directLeagueRequestEligibleLeagues.length > 0
                ? '/registration/league-requests'
                : icePrivilegesChoice === 'league_play' && priorSeasonReturnLeagues.length > 0
                  ? '/registration/prior-league-selection'
                  : '/registration/basic-ice',
            ),
        };
      case 'league-requests':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              icePrivilegesChoice === 'league_play' && priorSeasonReturnLeagues.length > 0
                ? '/registration/prior-league-selection'
                : '/registration/basic-ice',
            ),
        };
      case 'basic-ice-fallback':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              previousLeagueFlowStepBeforeBasicIceFallback({
                selections: leagueSelections,
                desiredAddWaitlistLeagueCount,
              }),
            ),
        };
      case 'third-league-interest':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(previousLeagueFlowStepBeforeThirdLeagueInterest()),
        };
      case 'league-summary':
        if (membershipChoice === 'junior_recreational') {
          return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/membership') };
        }
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              previousLeagueFlowStepBeforeSummary({
                selections: leagueSelections,
                desiredAddWaitlistLeagueCount,
                isBasicIceLeagueSelection: icePrivilegesChoice === 'basic_ice',
              }),
            ),
        };
      case 'review': {
        const membershipOption =
          membershipPayment?.selection.membershipOption ??
          (membershipChoice === 'junior_recreational'
            ? 'junior_recreational'
            : membershipChoice === 'social'
              ? 'social'
              : null);
        if (membershipOption === 'social') {
          return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/membership') };
        }
        if (membershipOption === 'junior_recreational') {
          return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/league-summary') };
        }
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              icePrivilegesChoice === 'none' ? '/registration/basic-ice' : '/registration/league-summary',
            ),
        };
      }
      case 'success':
        return null;
      case 'cancel':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(paymentRegistrationId ? '/registration/review' : '/registration/start'),
        };
      default:
        return null;
    }
  }, [
    currentStep,
    demographics.dateOfBirth,
    experienceChoice,
    guardian.email,
    icePrivilegesChoice,
    isPriorityEdit,
    membershipChoice,
    membershipPayment,
    membershipPayment?.selection.membershipOption,
    navigateRegistrationBack,
    noIceConfirm,
    payload?.isMinor,
    payload?.registration.guardian_email,
    paymentRegistrationId,
    desiredAddWaitlistLeagueCount,
    directLeagueRequestEligibleLeagues.length,
    isBasicIceLeagueSelection,
    leagueSelections,
    priorSeasonReturnLeagues.length,
    priorityEditReturnTo,
    returningIdentityAuxMode,
    handleBackToRegistrationStart,
  ]);

  function RegistrationFlowHeader() {
    if (currentStep === 'start') return null;
    const back = resolveRegistrationFlowBackAction();
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-emerald-100 pb-4">
        <div className="order-1 shrink-0">
          {back ? (
            <Button type="button" variant="secondary" className="text-sm" onClick={back.onClick}>
              {back.label}
            </Button>
          ) : null}
        </div>
        <p className="order-3 w-full basis-full text-center text-sm font-medium text-gray-700 sm:order-2 sm:w-auto sm:flex-1 sm:basis-auto">
          {registrationFlowHeaderTitle}
        </p>
        <div className="order-2 ms-auto shrink-0 sm:order-3 sm:ms-0">
          {showStartOver ? (
            <Button type="button" variant="secondary" className="text-sm" disabled={loading} onClick={handleStartOver}>
              Start over
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const handleSubmitterEmailMatch = useCallback(() => {
    setSameEmail('same');
  }, []);

  function renderIdentityDemographicFields(identityKey: string) {
    const syncCurlerEmailChoice =
      identityRegisteringForOther || returningIdentityAuxMode === 'other_new_member';
    const lockCurlerEmailToSubmitter = sameEmail === 'same' && Boolean(submitterEmailForCurler);
    return (
      <RegistrationDemographicFields
        key={`${registrationId ?? 'guest'}-identity-${identityKey}`}
        ref={identityDemographicFieldsRef}
        initialValue={demographics}
        lockCurlerEmailToSubmitter={syncCurlerEmailChoice && lockCurlerEmailToSubmitter}
        submitterEmailForCurler={submitterEmailForCurler}
        onSubmitterEmailMatch={syncCurlerEmailChoice ? handleSubmitterEmailMatch : undefined}
        onCommit={commitDemographicsDraft}
      />
    );
  }

  function renderFeeSummary() {
    if (!membershipPayment) {
      return <PublicStateCard title="Loading fees" description="Calculating your registration total." />;
    }
    const allLines = [...membershipPayment.feePreview.lineItems, ...membershipPayment.feePreview.discountLineItems];
    const showEstimatedRange = shouldShowEstimatedTotalRange(membershipPayment.paymentDecision.outcome);
    const estimatedRange = showEstimatedRange
      ? calculateEstimatedTotalRange({
          feePreview: membershipPayment.feePreview,
          leagues: leaguePayload?.leagues ?? [],
          activeLeagueIds: leaguePayload?.activeLeagueIds ?? [],
          selections: leagueSelections,
          desiredAddWaitlistLeagueCount,
          basicIceFallbackInterest,
          spareOnlyIcePrivilegeFeeMinor: membershipPayment.spareOnlyIcePrivilegeFeeMinor ?? 0,
        })
      : null;
    const totalLabel =
      membershipPayment.paymentDecision.outcome === 'no_payment_required'
        ? 'Total due now'
        : showEstimatedRange
          ? 'Estimated total'
          : 'Total due now';
    const totalDisplay =
      membershipPayment.paymentDecision.outcome === 'no_payment_required'
        ? formatCurrency(0)
        : showEstimatedRange && estimatedRange
          ? formatEstimatedTotalRange(estimatedRange.floorMinor, estimatedRange.ceilingMinor, formatCurrency)
          : formatCurrency(membershipPayment.feePreview.totalDueMinor);
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <h2 className="text-lg font-semibold text-[#121033]">Charges</h2>
        <div className="mt-3 divide-y divide-emerald-100">
          {allLines.map((line, index) => (
            <div key={`${line.lineType}-${index}`} className="flex items-start justify-between gap-4 py-2 text-sm">
              <span className="text-gray-700">{line.description}</span>
              <span className={line.amountMinor < 0 ? 'font-medium text-emerald-700' : 'font-medium text-gray-900'}>
                {formatCurrency(line.amountMinor)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-emerald-200 pt-3">
          <span className="font-semibold text-[#121033]">{totalLabel}</span>
          <span className="text-xl font-bold text-[#121033]">{totalDisplay}</span>
        </div>
        {showEstimatedRange && estimatedRange ? (
          <p className="mt-2 text-sm text-gray-600">
            {basicIceFallbackInterest === true
              ? 'Final payment depends on league placement.'
              : 'Final payment depends on league placement.'}
          </p>
        ) : null}
      </div>
    );
  }

  function selectionLabel(selection: RegistrationSelectionInput): string {
    switch (selection.selectionType) {
      case 'guaranteed_return':
        return 'Guaranteed return';
      case 'sabbatical':
        return 'Sabbatical';
      case 'drop':
        return 'Dropped';
      case 'return_subject_to_availability':
      case 'third_league_interest':
        return 'Subject to availability';
      case 'waitlist_add':
        return 'Waitlist: ADD';
      case 'waitlist_replace':
        return 'Waitlist: REPLACE';
      case 'waitlist_add_auto_decline':
        return 'Waitlist: ADD (auto-decline offers)';
      case 'waitlist_replace_auto_decline':
        return 'Waitlist: REPLACE (auto-decline offers)';
      case 'waitlist_keep_auto_accept':
        return 'Waitlist (auto-accept offers)';
      case 'waitlist_keep_auto_decline':
        return 'Waitlist (auto-decline offers)';
      case 'waitlist_remove':
        return 'Remove from waitlist';
      case 'byot_request':
        return 'BYOT request';
      case 'play_in_request':
        return selection.replacesLeagueId ? PLAY_IN_REPLACE_LABEL : PLAY_IN_ADD_WITH_REPLACE_LABEL;
      case 'instructional_join': {
        const league = leagueCatalogItem(selection.leagueId);
        if (league && isBasicIceIncludedDaytimeLeague(league)) {
          return 'Register for this league';
        }
        return 'Instructional join';
      }
      case 'junior_recreational':
        return 'Junior Recreational';
      case 'spare_only':
        return 'Spare-only';
      default:
        return 'League selection';
    }
  }

  function leagueName(leagueId: number | null | undefined): string {
    return leaguePayload?.leagues.find((league) => league.id === leagueId)?.name ?? 'League';
  }

  function leagueCatalogItem(leagueId: number | null | undefined): LeagueCatalogItem | undefined {
    return leaguePayload?.leagues.find((league) => league.id === leagueId);
  }

  function selectionStatusLabel(selection: RegistrationSelectionInput): string {
    switch (selection.selectionType) {
      case 'guaranteed_return':
        return 'Confirmed now';
      case 'byot_request':
      case 'play_in_request':
      case 'instructional_join':
        return 'Payable now';
      case 'sabbatical':
        return 'Sabbatical';
      case 'waitlist_add':
      case 'waitlist_replace':
      case 'waitlist_add_auto_decline':
      case 'waitlist_replace_auto_decline':
      case 'waitlist_keep_auto_accept':
      case 'waitlist_keep_auto_decline':
        return 'On waitlist';
      case 'waitlist_remove':
        return 'Removing from waitlist';
      case 'return_subject_to_availability':
      case 'third_league_interest':
        return 'Subject to availability';
      case 'spare_only':
      case 'junior_recreational':
        return 'Payable now';
      default:
        return selectionLabel(selection);
    }
  }

  function deferralReasonText(reason: string): string {
    switch (reason) {
      case 'waitlist_placement_pending':
        return 'One or more waitlist choices may change placement and payment.';
      case 'play_in_placement_pending':
        return 'A play-in league choice depends on play-in results before payment can be finalized.';
      case 'return_subject_to_availability':
      case 'third_league_interest_defers_payment':
        return 'One or more league choices is subject to availability.';
      case 'junior_financial_assistance_requires_review':
        return 'Junior Recreational financial assistance needs staff review.';
      case 'staff_review_required':
        return 'Staff review is required before payment can be finalized.';
      default:
        return 'Payment timing depends on placement review.';
    }
  }

  let content: React.ReactNode;

  if (error && !windowState) {
    content = <PublicStateCard title="Registration unavailable" description={error} tone="error" />;
  } else if (currentStep === 'start') {
    const startScreenPending = !windowState || authLoading || !resumeCheckComplete;
    content = (
      <RegistrationCard>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-teal">Registration</p>
        {startScreenPending ? (
          <>
            <h1 className="mt-3 text-3xl font-bold text-[#121033]">Start registration</h1>
            <p className="mt-3 min-h-[280px] text-gray-600" role="status">
              Checking for saved progress…
            </p>
          </>
        ) : resumeOffer !== 'none' ? (
          <>
            <h1 className="mt-3 text-3xl font-bold text-[#121033]">Resume registration?</h1>
            <p className="mt-3 text-gray-600">
              You have an in-progress registration for {seasonSessionLabel}
              {resumeCurlerName ? (
                <>
                  {' '}
                  for <strong>{resumeCurlerName}</strong>
                </>
              ) : null}
              .
            </p>
            <div className="mt-8 flex min-h-[280px] flex-col gap-3 sm:flex-row sm:flex-wrap sm:content-start">
              <Button
                onClick={() => {
                  if (resumeOffer === 'server') void handleResumeServerContinue();
                  else void handleResumeLocalContinue();
                }}
              >
                Continue where you left off
              </Button>
              <Button variant="secondary" onClick={() => void handleResumeDiscard()}>
                Start from the beginning
              </Button>
            </div>
          </>
        ) : completedSelfRegistrationId && !registeringForSomeoneElse ? (
          <>
            <h1 className="mt-3 text-3xl font-bold text-[#121033]">You have already registered</h1>
            <p className="mt-3 text-gray-600">
              Your registration for {seasonSessionLabel} has been submitted. You can review it or start a registration for
              someone else.
            </p>
            <div className="mt-8 flex min-h-[280px] flex-col gap-3 sm:flex-row sm:flex-wrap sm:content-start">
              <Link to="/dashboard">
                <Button>View registration on dashboard</Button>
              </Link>
              <Button variant="secondary" type="button" onClick={handleRegisterForSomeoneElse}>
                Register for someone else
              </Button>
            </div>
          </>
        ) : windowState?.state === 'closed' ? (
          <>
            <h1 className="mt-3 text-3xl font-bold text-[#121033]">Registration is closed</h1>
            <p className="mt-3 min-h-[280px] text-gray-600">
              Registration for {seasonSessionLabel} is not open yet.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-3xl font-bold text-[#121033]">Start registration</h1>
            <p className="mt-3 text-gray-600">This registration is for one curler for the {seasonSessionLabel} session.</p>
            <div className="mt-8 min-h-[280px]">
          {!returningGuestLoginPhase ? (
            <>
              <FormField label="Is the curler a returning member?" required tone="public">
                <ChoiceInput
                  inputId={choiceInputId}
                  layout="block"
                  value={returningAnswer}
                  onChange={(value) => {
                    resetReturningGuestLoginFlow();
                    setReturningAnswer(value as 'yes' | 'no');
                  }}
                  options={[
                    { value: 'yes', label: 'Yes', description: 'The curler has participated with the club before.' },
                    { value: 'no', label: 'No', description: 'The curler is new to the club.' },
                  ]}
                />
              </FormField>
              {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
              <Button
                className="mt-6"
                disabled={!returningAnswer || loading}
                type="button"
                onClick={() => void handleStartScreenContinue()}
              >
                Continue
              </Button>
            </>
          ) : returningGuestLoginPhase === 'email' ? (
            <>
              <h2 className="mt-8 text-xl font-semibold text-[#121033]">Returning member sign-in</h2>
              <p className="mt-3 text-gray-600">
                We'll email a login code to the Triangle Curling account on file so you can verify your returning member registration.
              </p>
              <form onSubmit={handleReturningGuestMagicLinkSendCode} className="mt-6 space-y-4">
                <FormField label="Email address" htmlFor={returningEmailInputId} required tone="public">
                  <FieldInput
                    id={returningEmailInputId}
                    type="email"
                    value={returningLoginEmail}
                    onChange={setReturningLoginEmail}
                    autoComplete="email"
                  />
                </FormField>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Sending…' : 'Send login code'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => {
                      setReturningGuestLoginPhase(null);
                      setError('');
                      setReturningLoginEmail('');
                    }}
                  >
                    Back
                  </Button>
                </div>
              </form>
            </>
          ) : returningGuestLoginPhase === 'code' ? (
            <>
              <h2 className="mt-8 text-xl font-semibold text-[#121033]">Enter your login code</h2>
              <p className="mt-3 text-gray-600">Check email for {returningLoginEmail.trim()}.</p>
              <form onSubmit={handleReturningGuestMagicLinkVerify} className="mt-6 space-y-4">
                <FormField label="Six-digit login code" htmlFor={returningCodeInputId} required tone="public">
                  <FieldInput
                    id={returningCodeInputId}
                    type="text"
                    value={returningLoginCode}
                    onChange={(v: string) => setReturningLoginCode(v.replace(/\D/g, '').slice(0, 6))}
                    autoComplete="one-time-code"
                    required={false}
                  />
                </FormField>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                  <Button type="submit" disabled={loading || returningLoginCode.length !== 6}>
                    {loading ? 'Verifying…' : 'Verify code'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => {
                      setReturningGuestLoginPhase('email');
                      setReturningLoginCode('');
                      setError('');
                    }}
                  >
                    Back
                  </Button>
                </div>
              </form>
            </>
          ) : returningGuestLoginPhase === 'select' ? (
            <>
              <h2 className="mt-8 text-xl font-semibold text-[#121033]">Choose your profile</h2>
              <p className="mt-3 text-gray-600">
                Multiple members share {returningLoginEmail.trim()}. Select the profile you usually use to sign in.
              </p>
              {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
              <div className="mt-6 space-y-2">
                {returningLoginMultipleMembers.map((pick) => (
                  <button
                    key={pick.id}
                    type="button"
                    disabled={loading}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-gray-900 transition hover:bg-gray-50 disabled:opacity-50"
                    onClick={() => void handleReturningGuestMagicLinkSelect(pick.id)}
                  >
                    {pick.name}
                  </button>
                ))}
              </div>
              <Button
                className="mt-6"
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => {
                  setReturningGuestLoginPhase('email');
                  setReturningLoginCode('');
                  setReturningLoginMultipleMembers([]);
                  setReturningLoginTempToken('');
                  setError('');
                }}
              >
                Back
              </Button>
            </>
          ) : returningGuestLoginPhase === 'unrecognized-followup' ? (
            <form className="mt-8 space-y-6" onSubmit={handleReturningUnrecognizedContinue}>
              <p className="text-gray-700">{unrecognizedReturningEmailCopy.question}</p>
              <FormField label="Tell us what applies" tone="public" htmlFor={unrecognizedChoiceInputId}>
                <ChoiceInput
                  inputId={unrecognizedChoiceInputId}
                  layout="block"
                  value={returningLoginUnrecognizedChoice}
                  onChange={(value) =>
                    setReturningLoginUnrecognizedChoice(value as Exclude<ReturningUnrecognizedChoice, null>)
                  }
                  options={[
                    { value: 'curled_prior_named_session', label: unrecognizedReturningEmailCopy.yesOption },
                    { value: 'curled_other_past_session', label: 'No, but I curled in a previous session' },
                    { value: 'first_time_here', label: 'No, this is my first time curling at Triangle Curling' },
                  ]}
                />
              </FormField>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <Button type="submit" disabled={loading}>
                  Continue
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => {
                    setReturningGuestLoginPhase('email');
                    setError('');
                  }}
                >
                  Back to email entry
                </Button>
              </div>
            </form>
          ) : returningGuestLoginPhase === 'different-email-help' ? (
            <div className="mt-8 space-y-6">
              <p className="text-gray-700">
                Please try a different email address. If you still can't access registration, please contact{' '}
                <a href="mailto:membership@trianglecurling.com" className="font-medium text-primary-teal underline">
                  membership@trianglecurling.com
                </a>
                .
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <Button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setReturningGuestLoginPhase('email');
                    setReturningLoginEmail('');
                    setError('');
                  }}
                >
                  Try another email address
                </Button>
              </div>
            </div>
          ) : null}
            </div>
          </>
        )}
      </RegistrationCard>
    );
  } else if (!windowState) {
    content = (
      <PublicStateCard title="Loading registration" description="Checking the current registration window." />
    );
  } else if (windowState.state === 'closed') {
    content = (
      <PublicStateCard
        title="Registration is closed"
        description={`Registration for ${seasonSessionLabel} is not open yet.`}
        tone="warning"
      />
    );
  } else if (currentStep === 'identity') {
    if (member && !payload) {
      content = <PublicStateCard title="Loading registration" description="Restoring your registration draft." />;
    } else if (payload?.registration.returning_member_answer === 1) {
      const returningPickerLoading =
        Boolean(member) &&
        !returningIdentityAuxMode &&
        (returningProfilesFetchStatus === 'loading' || returningProfilesFetchStatus === 'idle');

      if (returningPickerLoading) {
        content = (
          <RegistrationCard>
            <RegistrationFlowHeader />
            <div className="mt-12 flex min-h-[200px] flex-col items-center justify-start">
              {returningPickerSpinnerVisible ? (
                <>
                  <span
                    className="h-10 w-10 animate-spin rounded-full border-2 border-primary-teal border-t-transparent"
                    aria-hidden
                  />
                  <p className="mt-4 text-sm text-gray-600" role="status">
                    Loading registration choices…
                  </p>
                </>
              ) : null}
            </div>
          </RegistrationCard>
        );
      } else {
        const returningRegistrarOptions = [
          ...profiles.map((profile) => ({
            value: returningEligibleProfileChoiceValue(profile.id),
            label: profile.name,
            description: profile.email?.trim() || undefined,
          })),
          {
            value: RETURNING_IDENTITY_OTHER_NEW_VALUE,
            label: 'Someone else who is joining as a new member',
            description: 'The curler needs a new club member account.',
          },
          {
            value: RETURNING_IDENTITY_OTHER_RETURNING_VALUE,
            label: 'Someone else who is a returning member',
            description: 'They will need to give you permission to register on their behalf.',
          },
        ];

      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Who are you registering?</h1>
          {!member ? (
            <Button className="mt-6" onClick={() => navigate('/login', { state: { from: { pathname: '/registration/identity' } } })}>
              Log in to continue
            </Button>
          ) : returningIdentityAuxMode === 'delegation_instructions' ? (
            <div className="mt-8 space-y-6">
              <p className="text-gray-800">
                In order to register on behalf of another member, they must first add you as a delegated user. To do this, they need to follow these steps:
              </p>
              <ol className="list-decimal space-y-3 ps-6 text-gray-700">
                <li>Sign in to Triangle Curling with their own account.</li>
                <li>
                  Click their name in the top right corner to view the profile page.
                </li>
                <li>
                  Click the "Delegated access" tab.
                </li>
                <li>Enter your name as someone who may use their account and click "Save access list".</li>
                <li>After they&apos;ve saved access, use <strong>Back</strong> above to return to profile choices, then select their profile and tap <strong>Continue</strong>.</li>
              </ol>
            </div>
          ) : returningIdentityAuxMode === 'other_new_member' ? (
            <form onSubmit={submitReturningOtherNewMemberIdentity} className="mt-8 space-y-6">
              <h2 className="text-xl font-semibold text-[#121033]">New club member details</h2>
              <p className="text-gray-600">Enter details for someone else who doesn&apos;t have a club account yet.</p>
              <FormField label="Curler email" required tone="public">
                <ChoiceInput
                  layout="block"
                  value={sameEmail}
                  onChange={(value) => handleSameEmailChange(value as 'same' | 'different')}
                  options={[
                    { value: 'same', label: 'Use my email for the curler' },
                    { value: 'different', label: 'Use a different email for the curler' },
                  ]}
                />
              </FormField>
              {renderIdentityDemographicFields('other-new-member')}
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <Button type="submit" disabled={loading}>
                  Continue
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <FormField label="Profile" htmlFor={profileInputId} required tone="public">
                <ChoiceInput
                  inputId={profileInputId}
                  layout="block"
                  value={returningRegistrarProfileChoice}
                  onChange={(raw) => {
                    const value = raw as string | null;
                    setReturningRegistrarProfileChoice(value ?? null);
                    setError('');
                  }}
                  options={returningRegistrarOptions}
                  emptyText={
                    profiles.length === 0
                      ? 'No eligible profiles were found yet. Pick an option below to register someone new or to learn about delegated access.'
                      : undefined
                  }
                />
              </FormField>
              <Button
                type="button"
                disabled={loading || returningRegistrarProfileChoice === null}
                onClick={() => void handleReturningRegistrarContinue()}
              >
                Continue
              </Button>
            </div>
          )}
          {error && returningIdentityAuxMode !== 'other_new_member' ? (
            <p className="mt-4 text-sm text-red-600">{error}</p>
          ) : null}
        </RegistrationCard>
      );
      }
    } else {
      content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Account and curler setup</h1>
        <p className="mt-3 text-gray-600">Enter information for the person being registered.</p>
        <form onSubmit={submitNewIdentity} className="mt-6 space-y-6">
          {!member && !registeringForSomeoneElse ? (
            <FormField label="Who are you registering?" required tone="public">
              <ChoiceInput
                layout="block"
                value={registeringForSelf}
                onChange={(value) => setRegisteringForSelf(value as 'self' | 'other')}
                options={[
                  { value: 'self', label: 'I am registering myself' },
                  { value: 'other', label: 'I am registering someone else' },
                ]}
              />
            </FormField>
          ) : null}
          {identityRegisteringForOther ? (
            <FormField label="Curler email" required tone="public">
              <ChoiceInput
                layout="block"
                value={sameEmail}
                onChange={(value) => handleSameEmailChange(value as 'same' | 'different')}
                options={[
                  { value: 'same', label: 'Use my email for the curler' },
                  { value: 'different', label: 'Use a different email for the curler' },
                ]}
              />
            </FormField>
          ) : null}
          {renderIdentityDemographicFields('new-identity')}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            Continue
          </Button>
        </form>
      </RegistrationCard>
    );
    }
  } else if (currentStep === 'policies') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Required policies</h1>
        <p className="mt-3 text-gray-600">The person submitting this registration agrees on behalf of the curler.</p>
        <form onSubmit={acceptPolicies} className="mt-6 space-y-4">
          {[
            ['Code of Conduct', '/go/conduct'],
            ['Minor Athlete Abuse Prevention Policy', '/go/maapp'],
            ['Privacy Policy', '/go/privacy'],
          ].map(([label, href]) => (
            <label key={href} className="flex gap-3 rounded-2xl border border-gray-200 p-4 text-gray-800">
              <input type="checkbox" required className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-teal focus:ring-primary-teal" />
              <span>
                I agree to the{' '}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary-teal underline"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {label}
                </a>
                .
              </span>
            </label>
          ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={loading}>
            Accept and continue
          </Button>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'demographics') {
    content = (
      <RegistrationDemographicsStep
        registrationId={registrationId}
        initialDemographics={demographics}
        returningDemographics={payload?.registration.returning_member_answer === 1}
        headerTitle={registrationFlowHeaderTitle}
        showStartOver={Boolean(showStartOver)}
        loading={loading}
        error={error}
        backLabel="Back"
        onBack={handleRegistrationDemographicsBack}
        onStartOver={handleStartOver}
        onCommitDraft={commitDemographicsDraft}
        onSubmit={submitDemographics}
      />
    );
  } else if (currentStep === 'guardian') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Parent/guardian information</h1>
        <p className="mt-3 text-gray-600">This is required because the curler is under 18.</p>
        <form onSubmit={submitGuardian} className="mt-6 grid gap-4 sm:grid-cols-2">
          {([
            ['firstName', 'First name', 'given-name'],
            ['lastName', 'Last name', 'family-name'],
            ['email', 'Email address', 'email'],
            ['phone', 'Phone number', 'tel'],
          ] as const).map(([field, label, autoComplete]) => {
            const id = `guardian-${field}`;
            return (
              <FormField key={field} label={label} htmlFor={id} required tone="public">
                <FieldInput
                  id={id}
                  type={field === 'email' ? 'email' : 'text'}
                  value={guardian[field]}
                  onChange={(value) => setGuardian((current) => ({ ...current, [field]: value }))}
                  autoComplete={autoComplete}
                />
              </FormField>
            );
          })}
          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => setGuardian((current) => ({ ...current, email: demographics.email }))}>
              Use curler email
            </Button>
            <Button type="button" variant="secondary" onClick={() => setGuardian((current) => ({ ...current, phone: demographics.phone }))}>
              Use curler phone
            </Button>
          </div>
          <Button type="submit" disabled={loading} className="sm:col-span-2">
            Save and continue
          </Button>
          {error ? <p className="sm:col-span-2 text-sm text-red-600">{error}</p> : null}
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'complete') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <PublicStateCard title="Continuing registration" description="Taking you to membership selection." />
      </RegistrationCard>
    );
  } else if (currentStep === 'membership') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Choose membership</h1>
        <p className="mt-3 text-gray-600">Choose the membership or program path for this curler.</p>
        <form onSubmit={saveMembership} className="mt-6 space-y-6">
          <FormField label="Membership type" htmlFor={membershipInputId} required tone="public">
            <ChoiceInput
              inputId={membershipInputId}
              layout="block"
              value={membershipChoice}
              onChange={(value) => setMembershipChoice(value as 'regular' | 'social' | 'junior_recreational')}
              options={membershipOptions}
            />
          </FormField>
          {membershipChoice === 'social' ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Social members do not receive discounts, basic ice privileges, or league access.
            </p>
          ) : null}
          {membershipChoice === 'junior_recreational' ? (
            <FormField label="Financial assistance request" htmlFor={`${membershipInputId}-assistance`} tone="public">
              <ChoiceInput
                inputId={`${membershipInputId}-assistance`}
                layout="block"
                value={juniorAssistancePercent}
                onChange={(value) => setJuniorAssistancePercent(value as '0' | '25' | '50' | '75')}
                options={[
                  { value: '0', label: 'No assistance requested' },
                  { value: '25', label: 'Request 25% assistance' },
                  { value: '50', label: 'Request 50% assistance' },
                  { value: '75', label: 'Request 75% assistance' },
                ]}
              />
            </FormField>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'discounts') {
    const showWinterOnly = membershipPayment && !membershipPayment.isFirstSessionOfSeason;
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Discounts</h1>
        <p className="mt-3 text-gray-600">Any claimed discounts are subject to review and approval.</p>
        <form onSubmit={saveDiscounts} className="mt-6 space-y-5">
          {showWinterOnly ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              The winter-only discount is available for this session and will be applied to regular membership dues.
            </p>
          ) : null}
          <ChoiceInput
            inputId={discountsInputId}
            layout="block"
            maxSelectedItems={null}
            multiSelectionIndicatorStyle="checkboxes"
            ariaLabel="Available discounts"
            name="registration-discounts"
            value={[
              ...(studentDiscountClaimed ? ['student'] : []),
              ...(reciprocalDiscountClaimed ? ['reciprocal'] : []),
            ]}
            onChange={(nextValue) => {
              const selected = Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [];
              setStudentDiscountClaimed(selected.includes('student'));
              setReciprocalDiscountClaimed(selected.includes('reciprocal'));
            }}
            options={discountChoiceOptions}
          />
          {studentDiscountClaimed ? (
            <FormField label="Institution of study" htmlFor="student-institution" required tone="public">
              <FieldInput id="student-institution" value={studentInstitution} onChange={setStudentInstitution} />
            </FormField>
          ) : null}
          {reciprocalDiscountClaimed ? (
            <FormField label="Other curling club" htmlFor="reciprocal-club" required tone="public">
              <FieldInput id="reciprocal-club" value={reciprocalClubName} onChange={setReciprocalClubName} />
            </FormField>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>
              Continue
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
  } else if (currentStep === 'experience') {
    if (member && !membershipPayment) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Loading registration" description="Checking curling experience records." />
        </RegistrationCard>
      );
    } else if (shouldSkipExperienceStep(membershipPayment, experienceChoice)) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Continuing registration" description="Applying club curling experience record." />
        </RegistrationCard>
      );
    } else {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Curling experience</h1>
          <p className="mt-3 text-gray-600">This helps check league eligibility in the next registration phase.</p>
          <form onSubmit={saveExperience} className="mt-6 space-y-6">
            <FormField label="Previous curling experience" htmlFor={experienceInputId} required tone="public">
              <ChoiceInput
                inputId={experienceInputId}
                layout="block"
                value={experienceChoice}
                onChange={(value) => setExperienceChoice(value as 'none_or_minimal' | 'specified_years' | 'known_existing')}
                options={[
                  { value: 'none_or_minimal', label: 'None or minimal' },
                  { value: 'specified_years', label: 'I have curled before' },
                ]}
              />
            </FormField>
            {experienceChoice === 'specified_years' ? (
              <FormField label="Years of experience" htmlFor="experience-years" required tone="public">
                <FieldInput id="experience-years" type="number" step="0.5" value={experienceYears} onChange={setExperienceYears} />
              </FormField>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={loading}>
                Continue
              </Button>
            </div>
          </form>
        </RegistrationCard>
      );
    }
  } else if (currentStep === 'basic-ice') {
    if (!member) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Basic ice privileges</h1>
          <p className="mt-3 text-gray-600">
            Basic ice privileges cover sparing and practice for {seasonSessionLabel} without selecting a league in this phase.
          </p>
          <form onSubmit={saveBasicIce} className="mt-6 space-y-6">
            <FormCheckbox
              tone="public"
              label="I want basic ice privileges for this session"
              checked={basicIcePrivileges}
              onChange={setBasicIcePrivileges}
              helperText="This adds the configured spare-only ice privilege fee to regular membership."
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={loading}>
                Continue to league selection
              </Button>
            </div>
          </form>
        </RegistrationCard>
      );
    } else if (noIceConfirm) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Are you sure?</h1>
          <p className="mt-6 text-gray-800">
            While you are welcome to become a full member with no ice privileges, you may want to choose a social membership
            instead. A social membership conveys all the same benefits except the right to vote in the Club&apos;s annual
            election.
          </p>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={() => void saveIcePrivileges('none')}>
              Continue with no ice privileges
            </Button>
          </div>
        </RegistrationCard>
      );
    } else {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Ice privileges</h1>
          <p className="mt-3 text-gray-600">Choose how this curler wants to be on the ice for {seasonSessionLabel}.</p>
          <div className="mt-6 space-y-6">
            <FormField label="Ice privileges" htmlFor={icePrivilegesInputId} required tone="public">
              <ChoiceInput
                inputId={icePrivilegesInputId}
                layout="block"
                value={icePrivilegesChoiceForUi(icePrivilegesChoice, true)}
                onChange={(raw) => {
                  setIcePrivilegesChoice((raw as IcePrivilegesChoice | null) ?? null);
                  setError('');
                }}
                options={[
                  {
                    value: 'league_play',
                    label: 'League play',
                    description: 'Evening and weekend leagues.',
                  },
                  {
                    value: 'basic_ice',
                    label: 'Basic ice privileges',
                    description: 'Sparing, practice, and daytime leagues.',
                  },
                  {
                    value: 'none',
                    label: 'No ice privileges',
                    description: 'Full membership without on-ice access.',
                  },
                ]}
              />
            </FormField>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={loading || icePrivilegesChoice === null}
                onClick={() => {
                  if (!icePrivilegesChoice) {
                    setError('Choose an ice privileges option.');
                    return;
                  }
                  if (icePrivilegesChoice === 'none') {
                    setError('');
                    setNoIceConfirm(true);
                    return;
                  }
                  void saveIcePrivileges(icePrivilegesChoice);
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        </RegistrationCard>
      );
    }
  } else if (currentStep === 'prior-league-selection') {
    const showsAvailabilityReturn = priorSeasonReturnLeagues.length > 2;
    const addWaitlistSelections = leagueSelections
      .filter((selection) => selection.selectionType === 'waitlist_add' && selection.leagueId != null)
      .sort(
        (a, b) =>
          (leagueCatalogOrder.get(a.leagueId as number) ?? Number.MAX_SAFE_INTEGER) -
          (leagueCatalogOrder.get(b.leagueId as number) ?? Number.MAX_SAFE_INTEGER),
      );
    const priorAddWaitlistLeagueOptions = waitlistEligibleLeagues
      .filter((league) => !priorSeasonReturnLeagueIds.has(league.id) && !selectedLeagueIds.has(league.id))
      .map((league) => ({
        value: league.id,
        label: league.name,
        description: waitlistJoinOptionDescription(league, leagueScheduleText(league)),
      }));
    const continuePriorLeagueSelection = () => {
      if (!leaguePayload) return;
      const undecidedLeague = priorSeasonReturnLeagues.find(
        (league) => !leagueSelections.some((selection) => selection.leagueId === league.id),
      );
      if (undecidedLeague) {
        setError('Choose whether to return, take a sabbatical, or drop each prior league before continuing.');
        return;
      }
      if (protectedReturnSelectionCount > 2) {
        setError('You can protect at most two league spots. Choose subject-to-availability return for any additional leagues.');
        return;
      }
      const rosterMessage = validateByotWaitlistRosters();
      if (rosterMessage) {
        setError(rosterMessage);
        return;
      }
      void saveLeagueSelections(
        nextLeagueFlowStepAfterPriorLeagueSelection({
          hasDirectLeagueRequests: directLeagueRequestEligibleLeagues.length > 0,
        }),
        isPriorityEdit ? finishPriorityEdit : undefined,
      );
    };
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Returning leagues</h1>
        <p className="mt-3 text-gray-600">
          Decide what this curler wants to do with each guaranteed return spot from the prior season before choosing any new leagues for {seasonSessionLabel}.
        </p>
        {showsAvailabilityReturn ? (
          <p className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            A curler can protect up to two prior league spots. Additional prior leagues can still be requested subject to availability.
          </p>
        ) : null}
        <div className="mt-6 space-y-5">
          {!leaguePayload ? (
            error ? (
              <PublicStateCard title="Unable to load leagues" description={error} tone="warning" />
            ) : (
              <PublicStateCard title="Loading prior leagues" description="Checking this curler's guaranteed return spots." />
            )
          ) : priorSeasonReturnLeagues.length === 0 ? (
            <PublicStateCard title="No prior league spots" description="Continue to choose leagues for this session." />
          ) : (
            priorSeasonReturnLeagues.map((league) => {
              const currentSelection = leagueSelections.find((selection) => selection.leagueId === league.id);
              const value = priorLeagueChoiceValue(currentSelection);
              const selectedProtected = currentSelection
                ? PROTECTED_RETURN_SELECTION_TYPES.has(currentSelection.selectionType)
                : false;
              const protectedLimitReached = protectedReturnSelectionCount >= 2 && !selectedProtected;
              return (
                <div key={league.id} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <FormField label={league.name} htmlFor={`prior-league-${league.id}`} tone="public" required>
                    <ChoiceInput
                      inputId={`prior-league-${league.id}`}
                      layout="popover"
                      value={value}
                      onChange={(next) => updateLeagueSelection(league.id, (next ?? 'none') as RegistrationSelectionType | 'none')}
                      options={[
                        {
                          value: 'guaranteed_return',
                          label: showsAvailabilityReturn ? 'Return to league (guaranteed)' : 'Return to league',
                          description: protectedLimitReached
                            ? 'You have already selected two protected league spots.'
                            : 'Claim this guaranteed return spot.',
                          disabled: protectedLimitReached,
                        },
                        ...(showsAvailabilityReturn
                          ? [
                              {
                                value: 'return_subject_to_availability',
                                label: 'Attempt to return to the league (subject to availability)',
                                description: 'Request this league without using one of the two guaranteed return spots.',
                              },
                            ]
                          : []),
                        ...(league.allowsSabbatical
                          ? [
                              {
                                value: 'sabbatical',
                                label: 'Take a sabbatical for the league',
                                description: protectedLimitReached
                                  ? 'Sabbaticals also count toward the two protected league spots.'
                                  : 'Preserve the spot while stepping away for this session.',
                                disabled: protectedLimitReached,
                              },
                            ]
                          : []),
                        { value: 'drop', label: 'Drop the league', description: 'Release this guaranteed return spot.' },
                      ]}
                    />
                  </FormField>
                </div>
              );
            })
          )}
          {addWaitlistSelections.length > 0 ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <h2 className="text-base font-semibold text-[#121033]">New league waitlists</h2>
              <div className="mt-3 space-y-3">
                {addWaitlistSelections.map((selection) => {
                  const league = leaguePayload?.leagues.find((item) => item.id === selection.leagueId);
                  return (
                    <div
                      key={`prior-waitlist-add-${selection.leagueId}`}
                      className="space-y-3 rounded-xl bg-white p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#121033]">{leagueName(selection.leagueId)}</p>
                          <p className="text-gray-600">
                            Waitlist: ADD
                            {(() => {
                              const positionSuffix = formatWaitlistPositionSuffix({
                                isExisting: false,
                                activeWaitlistEntryCount: leagueCatalogItem(selection.leagueId)?.activeWaitlistEntryCount,
                              });
                              return positionSuffix ? ` ${positionSuffix}` : '';
                            })()}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => selection.leagueId != null && updateLeagueSelection(selection.leagueId, 'none')}
                        >
                          Remove
                        </Button>
                      </div>
                      {league?.leagueType === 'bring_your_own_team'
                        ? renderByotWaitlistRosterField(
                            selection,
                            league,
                            `prior-waitlist-roster-${league.id}`,
                          )
                        : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {guaranteedReturnSelectionCount < 2 && priorAddWaitlistLeagueOptions.length > 0 ? (
            <div className="space-y-3">
              {showPriorWaitlistAddPicker ? (
                <FormField label="Select a league to join its waitlist" htmlFor="prior-add-waitlist-league" tone="public">
                  <ChoiceInput
                    inputId="prior-add-waitlist-league"
                    layout="popover"
                    value={null}
                    onChange={(next) => {
                      if (typeof next !== 'number') return;
                      updateLeagueSelection(next, 'waitlist_add');
                      setShowPriorWaitlistAddPicker(false);
                    }}
                    options={priorAddWaitlistLeagueOptions}
                  />
                </FormField>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setShowPriorWaitlistAddPicker(true)}>
                  Add a new league
                </Button>
              )}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={continuePriorLeagueSelection}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'league-selection') {
    const leagues = (leaguePayload?.leagues ?? []).filter(
      (league) =>
        isLeagueSelectionEligibleLeague(league, leagueEligibilityInput) &&
        (isBasicIceLeagueSelection || !priorSeasonReturnLeagueIds.has(league.id)) &&
        (!isBasicIceLeagueSelection || league.registrationFeeMinor === 0),
    );
    const visibleWaitlistSelections = leagueSelections
      .filter(
        (selection) =>
          selection.leagueId != null && isJoinWaitlistSelectionType(selection.selectionType),
      )
      .sort(
        (a, b) =>
          (leagueCatalogOrder.get(a.leagueId as number) ?? Number.MAX_SAFE_INTEGER) -
          (leagueCatalogOrder.get(b.leagueId as number) ?? Number.MAX_SAFE_INTEGER),
      );
    const activeExistingWaitlists = (leaguePayload?.existingWaitlistEntries ?? []).filter(isActiveExistingWaitlistEntry);
    const onWaitlistLeagueIds = new Set<number>();
    for (const entry of activeExistingWaitlists) {
      const preference = waitlistPreferenceFromSelection(
        leagueSelections.find((selection) => selection.leagueId === entry.leagueId),
      );
      if (preference !== 'remove') {
        onWaitlistLeagueIds.add(entry.leagueId);
      }
    }
    for (const selection of leagueSelections) {
      if (selection.leagueId == null || !WAITLIST_SESSION_SELECTION_TYPES.has(selection.selectionType)) continue;
      if (selection.selectionType === 'waitlist_remove') continue;
      onWaitlistLeagueIds.add(selection.leagueId);
    }
    type DisplayedWaitlist = {
      leagueId: number;
      entryType: 'add' | 'replace';
      replacesLeagueId?: number | null;
      selection?: RegistrationSelectionInput;
      isExisting: boolean;
      position?: number | null;
      queueTotal?: number | null;
      declineCount?: number | null;
    };
    const displayedWaitlists: DisplayedWaitlist[] = [];
    const displayedWaitlistIds = new Set<number>();
    for (const entry of activeExistingWaitlists) {
      displayedWaitlists.push({
        leagueId: entry.leagueId,
        entryType: entry.entryType,
        replacesLeagueId: entry.replacesLeagueId,
        selection: leagueSelections.find((selection) => selection.leagueId === entry.leagueId),
        isExisting: true,
        position: entry.position,
        queueTotal: entry.queueTotal,
        declineCount: entry.declineCount,
      });
      displayedWaitlistIds.add(entry.leagueId);
    }
    for (const selection of visibleWaitlistSelections) {
      if (selection.leagueId == null || displayedWaitlistIds.has(selection.leagueId)) continue;
      displayedWaitlists.push({
        leagueId: selection.leagueId,
        entryType: selection.selectionType.startsWith('waitlist_replace') ? 'replace' : 'add',
        replacesLeagueId: selection.replacesLeagueId,
        selection,
        isExisting: false,
      });
      displayedWaitlistIds.add(selection.leagueId);
    }
    displayedWaitlists.sort(
      (a, b) =>
        (leagueCatalogOrder.get(a.leagueId) ?? Number.MAX_SAFE_INTEGER) -
        (leagueCatalogOrder.get(b.leagueId) ?? Number.MAX_SAFE_INTEGER),
    );
    const joinWaitlistLeagueOptions = waitlistEligibleLeagues
      .filter((league) => !onWaitlistLeagueIds.has(league.id) && !priorSeasonReturnLeagueIds.has(league.id))
      .map((league) => ({
        value: league.id,
        label: league.name,
        description: waitlistJoinOptionDescription(league, leagueScheduleText(league)),
      }));
    const replacementLeagueOptions = scheduledLeagueSelections
      .filter((selection) => selection.leagueId != null)
      .map((selection) => ({
        value: selection.leagueId as number,
        label: leagueName(selection.leagueId),
        description: selectionLabel(selection),
      }));
    const continueLeagueSelection = () => {
      if (isBasicIceLeagueSelection) {
        void saveLeagueSelections('/registration/league-summary', isPriorityEdit ? finishPriorityEdit : undefined);
        return;
      }
      for (const waitlist of displayedWaitlists.filter((item) => item.isExisting)) {
        if (waitlistPreferenceFromSelection(waitlist.selection) == null) {
          setError('Choose what to do with each current waitlist before continuing.');
          return;
        }
      }
      const rosterMessage = validateByotWaitlistRosters();
      if (rosterMessage) {
        setError(rosterMessage);
        return;
      }
      if (requiresWaitlistFulfillmentPreferences(leagueSelections)) {
        const remaining = remainingFirstTwoLeagueSlots(leaguePayload?.activeLeagueIds ?? [], leagueSelections);
        const resolvedCount = remaining <= 1 ? 1 : desiredAddWaitlistLeagueCount;
        if (resolvedCount == null) {
          setError('Choose how many waitlist leagues to accept if multiple spots open.');
          return;
        }
        if (addWaitlistPriority.length < 2) {
          setError('Rank each ADD waitlist in priority order.');
          return;
        }
      }
      const nextStep = nextLeagueFlowStepAfterSelections({
        selections: leagueSelections,
        desiredAddWaitlistLeagueCount,
        isBasicIceLeagueSelection,
      });
      void saveLeagueSelections(nextStep, isPriorityEdit ? finishPriorityEdit : undefined);
    };
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">
          {isBasicIceLeagueSelection ? 'Choose daytime leagues' : 'Waitlists'}
        </h1>
        <p className="mt-3 text-gray-600">
          {isBasicIceLeagueSelection
            ? `Basic ice privileges include the daytime leagues below for ${seasonSessionLabel}. Select any you want to join; eligibility is checked when you save.`
            : activeExistingWaitlists.length > 0
              ? 'Review current waitlists'
              : 'To join a league, you must first join its waitlist. When there is a spot available, you will be invited to join the league. League vacancies and waitlists are processed after the priority registration period each session.'}
        </p>
        <div className="mt-6 space-y-5">
          {!leaguePayload ? (
            error ? (
              <PublicStateCard title="Unable to load leagues" description={error} tone="warning" />
            ) : (
              <PublicStateCard title="Loading leagues" description="Checking available leagues for this session." />
            )
          ) : null}
          {isBasicIceLeagueSelection ? (
            leagues.length === 0 ? (
              <PublicStateCard title="No leagues available" description="There are no leagues configured for this registration session yet." tone="warning" />
            ) : (
              leagues.map((league) => {
                const currentSelection = leagueSelections.find((selection) => selection.leagueId === league.id);
                const hasReturnRight =
                  windowState?.state === 'priority' &&
                  Boolean(league.predecessorLeagueId && leaguePayload?.participatedLeagueIds.includes(league.predecessorLeagueId));
                const value =
                  currentSelection?.selectionType === 'third_league_interest'
                    ? 'return_subject_to_availability'
                    : currentSelection?.selectionType === 'instructional_join'
                      ? 'instructional_join'
                      : currentSelection?.selectionType ?? 'none';
                return (
                  <div key={league.id} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                    <FormField label={league.name} htmlFor={`league-${league.id}`} tone="public">
                      <ChoiceInput
                        inputId={`league-${league.id}`}
                        layout="block"
                        value={value}
                        onChange={(next) => updateLeagueSelection(league.id, next as RegistrationSelectionType | 'none')}
                        options={[
                          { value: 'none', label: 'No selection' },
                          ...(hasReturnRight
                            ? [
                                { value: 'guaranteed_return', label: 'Return', description: 'Claim an eligible guaranteed return spot.' },
                                ...(league.allowsSabbatical
                                  ? [{ value: 'sabbatical', label: 'Sabbatical', description: 'Preserve the spot while stepping away.' }]
                                  : []),
                                { value: 'drop', label: 'Drop', description: 'Release this protected spot.' },
                              ]
                            : []),
                          ...(league.isPlayInBased === true
                            ? [{ value: 'play_in_request', label: 'Play-in request', description: 'Register for the play-in to compete for a league spot.' }]
                            : league.format === 'instructional' && !league.allowsWaitlist
                              ? [{ value: 'instructional_join', label: 'Join instructional league', description: 'Request a spot in this instructional league.' }]
                              : league.leagueType === 'bring_your_own_team'
                                ? [{ value: 'byot_request', label: 'BYOT request', description: 'List teammates for coordinator review.' }]
                                : isBasicIceIncludedDaytimeLeague(league)
                                  ? [
                                      {
                                        value: 'instructional_join',
                                        label: 'Register for this league',
                                        description: 'Join this daytime league included with basic ice privileges.',
                                      },
                                    ]
                                  : [
                                      { value: 'waitlist_add', label: 'Waitlist: ADD', description: 'Try to add this as a first or second league.' },
                                      { value: 'return_subject_to_availability', label: 'Subject to availability', description: 'Request a non-guaranteed spot.' },
                                    ]),
                        ]}
                      />
                    </FormField>
                    {currentSelection?.selectionType === 'byot_request' ? (
                      <FormField label="Teammates" htmlFor={`league-${league.id}-teammates`} required tone="public">
                        <textarea
                          id={`league-${league.id}-teammates`}
                          className="app-input min-h-24"
                          value={currentSelection.byotTeammateText ?? ''}
                          onChange={(event) => updateByotTeammates(league.id, event.target.value)}
                          placeholder="List teammate names"
                        />
                      </FormField>
                    ) : null}
                    {currentSelection?.selectionType === 'play_in_request' && league.leagueType === 'bring_your_own_team'
                      ? renderByotWaitlistRosterField(currentSelection, league, `play-in-roster-${league.id}`)
                      : null}
                  </div>
                );
              })
            )
          ) : leaguePayload ? (
            <>
              {displayedWaitlists.length > 0 ? (
                <div className="space-y-4">
                  {displayedWaitlists.map((waitlist) => {
                    const league = leaguePayload.leagues.find((item) => item.id === waitlist.leagueId);
                    const preference = waitlistPreferenceFromSelection(waitlist.selection);
                    const waitlistSelection = leagueSelections.find(
                      (selection) =>
                        selection.leagueId === waitlist.leagueId && isJoinWaitlistSelectionType(selection.selectionType),
                    );
                    const positionSuffix = formatWaitlistPositionSuffix({
                      isExisting: waitlist.isExisting,
                      position: waitlist.position,
                      activeWaitlistEntryCount: leagueCatalogItem(waitlist.leagueId)?.activeWaitlistEntryCount,
                    });
                    const waitlistTypeLabel =
                      waitlist.entryType === 'replace'
                        ? `Waitlist: REPLACE — would replace ${waitlist.replacesLeagueId ? leagueName(waitlist.replacesLeagueId) : 'a selected league'}`
                        : 'Waitlist: ADD';
                    return (
                      <div key={`waitlist-preference-${waitlist.leagueId}`} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-base font-semibold text-[#121033]">{leagueName(waitlist.leagueId)}</p>
                            <p className="text-sm text-gray-600">
                              {waitlistTypeLabel}
                              {positionSuffix ? ` ${positionSuffix}` : ''}
                            </p>
                          </div>
                          {!waitlist.isExisting ? (
                            <button
                              type="button"
                              className="shrink-0 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                              aria-label={`Remove ${leagueName(waitlist.leagueId)} waitlist`}
                              onClick={() => removeNewWaitlistEntry(waitlist.leagueId)}
                            >
                              <HiXMark className="h-5 w-5" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                        {waitlist.isExisting ? (
                          <div className="mt-4">
                            <FormField
                              label="Waitlist confirmation"
                              htmlFor={`waitlist-preference-${waitlist.leagueId}`}
                              tone="public"
                              required
                            >
                              <ChoiceInput
                                inputId={`waitlist-preference-${waitlist.leagueId}`}
                                layout="block"
                                value={preference}
                                onChange={(next) => {
                                  if (next == null) return;
                                  updateWaitlistPreference(waitlist.leagueId, next as WaitlistPreference);
                                  setError('');
                                }}
                                options={WAITLIST_PREFERENCE_OPTIONS}
                              />
                            </FormField>
                            {preference === 'auto_decline' ? (
                              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                                {waitlistAutoDeclineWarning(waitlist.declineCount)}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {!waitlist.isExisting &&
                        league?.leagueType === 'bring_your_own_team' &&
                        waitlistSelection &&
                        preference !== 'remove'
                          ? renderByotWaitlistRosterField(
                              waitlistSelection,
                              league,
                              `waitlist-roster-${league.id}`,
                            )
                          : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <FormField
                label={displayedWaitlists.length > 0 ? 'Join another waitlist' : 'Join a waitlist'}
                htmlFor="join-waitlist-league"
                tone="public"
              >
                <ChoiceInput
                  inputId="join-waitlist-league"
                  layout="popover"
                  value={replacementWaitlistLeagueId}
                  onChange={(next) => {
                    if (typeof next !== 'number') {
                      setReplacementWaitlistLeagueId(null);
                      return;
                    }
                    if (replacementLeagueOptions.length === 0) {
                      updateLeagueSelection(next, 'waitlist_add');
                      setReplacementWaitlistLeagueId(null);
                      return;
                    }
                    setReplacementWaitlistLeagueId(next);
                    setError('');
                  }}
                  options={joinWaitlistLeagueOptions}
                  emptyText="No waitlist-eligible leagues remain."
                />
              </FormField>

              {replacementWaitlistLeagueId !== null ? (
                replacementLeagueOptions.length > 0 ? (
                  <FormField label="League to replace" htmlFor="replace-waitlist-replacement" tone="public" required>
                    <ChoiceInput
                      inputId="replace-waitlist-replacement"
                      layout="popover"
                      value={null}
                      onChange={(next) => {
                        if (replacementWaitlistLeagueId === null || typeof next !== 'number') return;
                        updateWaitlistReplaceSelection(replacementWaitlistLeagueId, next);
                        setReplacementWaitlistLeagueId(null);
                      }}
                      options={replacementLeagueOptions}
                    />
                  </FormField>
                ) : (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Select a returning league first before adding replacement waitlists.
                  </p>
                )
              ) : null}

              <RegistrationWaitlistFulfillmentFields
                selections={leagueSelections}
                activeLeagueIds={leaguePayload?.activeLeagueIds ?? []}
                desiredAddWaitlistLeagueCount={desiredAddWaitlistLeagueCount}
                addWaitlistPriority={addWaitlistPriority}
                leagueName={leagueName}
                onDesiredCountChange={setDesiredAddWaitlistLeagueCount}
                onPriorityChange={(nextPriority) => {
                  setAddWaitlistPriority(nextPriority);
                  setLeagueSelections((current) => applyAddWaitlistPriorityOrder(current, nextPriority));
                }}
              />
            </>
          ) : null}
          {error && leaguePayload ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !leaguePayload} onClick={continueLeagueSelection}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'league-requests') {
    const continueLeagueRequests = () => {
      const rosterMessage = firstDirectLeagueRequestRosterValidationMessage(
        leagueSelections,
        leaguePayload?.leagues ?? [],
        memberOptionById,
        memberOptionIdByName,
        { id: registeringCurlerMemberId, name: registeringCurlerName },
      );
      if (rosterMessage) {
        setError(rosterMessage);
        return;
      }
      const nextStep = nextLeagueFlowStepAfterLeagueRequests();
      void saveLeagueSelections(nextStep, isPriorityEdit ? finishPriorityEdit : undefined);
    };
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">League requests</h1>
        <p className="mt-3 text-gray-600">
          Choose instructional, play-in, BYOT, and other leagues that do not use waitlists for {seasonSessionLabel}.
        </p>
        <div className="mt-6 space-y-5">
          {!leaguePayload ? (
            error ? (
              <PublicStateCard title="Unable to load leagues" description={error} tone="warning" />
            ) : (
              <PublicStateCard title="Loading leagues" description="Checking available leagues for this session." />
            )
          ) : directLeagueRequestEligibleLeagues.length === 0 ? (
            <PublicStateCard
              title="No direct league requests"
              description="There are no non-waitlist leagues available for this registration session."
              tone="warning"
            />
          ) : (
            directLeagueRequestEligibleLeagues.map((league) => {
              const currentSelection = leagueSelections.find((selection) => selection.leagueId === league.id);
              const isInstructional = league.format === 'instructional';
              const isPlayIn = league.isPlayInBased === true;
              const isByot = league.leagueType === 'bring_your_own_team';
              const value =
                currentSelection?.selectionType === 'byot_request'
                  ? 'byot_request'
                  : currentSelection?.selectionType === 'return_subject_to_availability'
                    ? 'return_subject_to_availability'
                    : currentSelection?.selectionType === 'instructional_join'
                      ? 'instructional_join'
                      : currentSelection?.selectionType === 'play_in_request'
                        ? currentSelection.replacesLeagueId != null
                          ? 'play_in_replace'
                          : 'play_in_add'
                        : 'none';
              const playInReplacementOptions = scheduledLeagueSelections
                .filter((selection) => selection.leagueId != null && selection.leagueId !== league.id)
                .map((selection) => ({
                  value: selection.leagueId as number,
                  label: leagueName(selection.leagueId),
                  description: selectionLabel(selection),
                }));
              const showPlayInReplace = playInReplacementOptions.length > 0;
              const showPlayInAdd = canRequestPlayInAdd(
                leaguePayload?.activeLeagueIds ?? [],
                leagueSelections,
                league.id,
              );
              return (
                <div key={league.id} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <FormField label={league.name} htmlFor={`league-request-${league.id}`} tone="public">
                    <ChoiceInput
                      inputId={`league-request-${league.id}`}
                      layout="block"
                      value={value}
                      onChange={(next) => {
                        if (next === 'none') {
                          updateLeagueSelection(league.id, 'none');
                          if (playInReplaceLeagueId === league.id) setPlayInReplaceLeagueId(null);
                          return;
                        }
                        if (next === 'instructional_join') {
                          updateLeagueSelection(league.id, 'instructional_join');
                          return;
                        }
                        if (next === 'byot_request') {
                          updateLeagueSelection(league.id, 'byot_request');
                          return;
                        }
                        if (next === 'return_subject_to_availability') {
                          setLeagueSelections((current) => {
                            const withoutLeague = current.filter((selection) => selection.leagueId !== league.id);
                            return [
                              ...withoutLeague,
                              { selectionType: 'return_subject_to_availability', leagueId: league.id },
                            ];
                          });
                          return;
                        }
                        if (next === 'play_in_add') {
                          updateLeagueSelection(league.id, 'play_in_request');
                          if (playInReplaceLeagueId === league.id) setPlayInReplaceLeagueId(null);
                          return;
                        }
                        if (next === 'play_in_replace') {
                          if (playInReplacementOptions.length === 0) {
                            setError('Select a returning league first before requesting a play-in replacement.');
                            return;
                          }
                          setPlayInReplaceLeagueId(league.id);
                          setError('');
                        }
                      }}
                      options={[
                        { value: 'none', label: 'No selection' },
                        ...(isInstructional
                          ? [{ value: 'instructional_join', label: 'Join instructional league', description: 'Request a spot in this instructional league.' }]
                          : isPlayIn
                            ? playInChoiceOptions({ showAdd: showPlayInAdd, showReplace: showPlayInReplace })
                            : isByot
                              ? [{ value: 'byot_request', label: 'BYOT request', description: 'List teammates for coordinator review.' }]
                              : [
                                  {
                                    value: 'return_subject_to_availability',
                                    label: 'Join league',
                                    description: 'Request a spot in this league.',
                                  },
                                ]),
                      ]}
                    />
                  </FormField>
                  {currentSelection?.selectionType === 'byot_request' ? (
                    <FormField label="Teammates" htmlFor={`league-request-${league.id}-teammates`} required tone="public">
                      <textarea
                        id={`league-request-${league.id}-teammates`}
                        className="app-input min-h-24"
                        value={currentSelection.byotTeammateText ?? ''}
                        onChange={(event) => updateByotTeammates(league.id, event.target.value)}
                        placeholder="List teammate names"
                      />
                    </FormField>
                  ) : null}
                  {playInReplaceLeagueId === league.id && playInReplacementOptions.length > 0 ? (
                    <FormField label="League to replace" htmlFor={`play-in-replace-${league.id}`} tone="public" required>
                      <ChoiceInput
                        inputId={`play-in-replace-${league.id}`}
                        layout="popover"
                        value={currentSelection?.replacesLeagueId ?? null}
                        onChange={(next) => {
                          if (typeof next !== 'number') return;
                          updatePlayInReplaceSelection(league.id, next);
                          setPlayInReplaceLeagueId(null);
                        }}
                        options={playInReplacementOptions}
                      />
                    </FormField>
                  ) : null}
                  {currentSelection?.selectionType === 'play_in_request' && league.leagueType === 'bring_your_own_team'
                    ? renderByotWaitlistRosterField(currentSelection, league, `league-request-roster-${league.id}`)
                    : null}
                </div>
              );
            })
          )}
          {error && leaguePayload ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !leaguePayload} onClick={continueLeagueRequests}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'basic-ice-fallback') {
    const continueBasicIceFallback = () => {
      if (basicIceFallbackInterest == null) {
        setError('Choose whether to accept basic ice privileges if no league spots are available.');
        return;
      }
      void saveBasicIceFallback(basicIceFallbackInterest, isPriorityEdit ? finishPriorityEdit : undefined);
    };
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Basic ice fallback</h1>
        <p className="mt-3 text-gray-600">
          In the event that we cannot offer you any league spots based on your selections, would you be interested in purchasing basic ice privileges? This will allow unlimited sparing, practice, and participation in daytime leagues and early morning sessions.
        </p>
        <div className="mt-6 space-y-4">
          <FormField label="Basic ice fallback" htmlFor={basicIceFallbackInputId} required tone="public">
            <ChoiceInput
              inputId={basicIceFallbackInputId}
              layout="block"
              value={
                basicIceFallbackInterest == null ? null : basicIceFallbackInterest ? 'yes' : 'no'
              }
              onChange={(next) => {
                if (next === 'yes') setBasicIceFallbackInterest(true);
                else if (next === 'no') setBasicIceFallbackInterest(false);
                else setBasicIceFallbackInterest(null);
                setError('');
              }}
              options={[
                {
                  value: 'yes',
                  label: 'Yes',
                  description: 'Offer basic ice privileges if none of my league selections can be placed.',
                },
                {
                  value: 'no',
                  label: 'No',
                  description:
                    'If we cannot place me in any leagues, do not send an invoice and do not make me a member for this session.',
                },
              ]}
            />
          </FormField>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={continueBasicIceFallback}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'third-league-interest') {
    const thirdLeagueInterestOptions = (leaguePayload?.leagues ?? [])
      .filter((league) => isThirdLeagueInterestEligibleLeague(league, leagueEligibilityInput))
      .map((league) => ({
        value: league.id,
        label: league.name,
      }));
    const eligibleThirdLeagueIds = new Set(thirdLeagueInterestOptions.map((option) => option.value));
    const thirdLeagueSelectedIds = leagueSelections
      .filter(
        (selection) =>
          isThirdLeagueInterestSelection(selection) &&
          selection.leagueId != null &&
          eligibleThirdLeagueIds.has(selection.leagueId),
      )
      .map((selection) => selection.leagueId as number);
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Third-league interest</h1>
        <p className="mt-3 text-gray-600">
          These choices tell staff which additional standard leagues would be suitable if third-league spots are available. They are not waitlist entries.
        </p>
        <div className="mt-6 space-y-4">
          {thirdLeagueInterestOptions.length === 0 ? (
            <PublicStateCard
              title="No eligible leagues"
              description="There are no additional standard leagues available for this curler's age and experience path."
              tone="warning"
            />
          ) : (
            <ChoiceInput
              inputId={thirdLeagueInterestInputId}
              layout="block"
              maxSelectedItems={null}
              multiSelectionIndicatorStyle="checkboxes"
              ariaLabel="Third-league interest"
              value={thirdLeagueSelectedIds}
              onChange={(nextValue) => {
                const selected = Array.isArray(nextValue) ? nextValue : nextValue != null ? [nextValue] : [];
                setThirdLeagueInterestSelections(selected.filter((id): id is number => typeof id === 'number'));
              }}
              options={thirdLeagueInterestOptions}
            />
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={loading}
              onClick={() =>
                void saveLeagueSelections(
                  nextLeagueFlowStepAfterThirdLeagueInterest({
                    selections: leagueSelections,
                    isBasicIceLeagueSelection,
                  }),
                  isPriorityEdit ? finishPriorityEdit : undefined,
                )
              }
            >
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'league-summary') {
    const selections = sortedLeagueSelections;
    const waitlistFulfillmentSummary = waitlistFulfillmentSummaryText({
      desiredAddWaitlistLeagueCount,
      priorityLeagueIds: addWaitlistPriority,
      leagueName,
      remainingFirstTwoSlots: remainingFirstTwoLeagueSlots(leaguePayload?.activeLeagueIds ?? [], leagueSelections),
    });
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">League selection summary</h1>
        <p className="mt-3 text-gray-600">Review the curler's league choices before continuing to final review.</p>
        <div className="mt-6 space-y-4">
          {membershipChoice === 'junior_recreational' ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Junior Recreational skips normal league selection, waitlists, sparing, and third-league interest.
            </p>
          ) : selections.length === 0 ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No league choices have been saved.</p>
          ) : (
            <>
            <div className="divide-y divide-emerald-100 rounded-2xl border border-emerald-100">
              {selections.map((selection, index) => {
                const rosterSummary = rosterSummaryForSelection(
                  selection,
                  leagueCatalogItem(selection.leagueId),
                  memberOptionById,
                  memberOptionIdByName,
                  { id: registeringCurlerMemberId, name: registeringCurlerName },
                );
                return (
                  <div key={`${selection.selectionType}-${selection.leagueId ?? 'none'}-${index}`} className="p-4 text-sm">
                    <p className="font-medium text-[#121033]">{selection.leagueId ? leagueName(selection.leagueId) : selectionLabel(selection)}</p>
                    <p className="text-gray-700">{selectionLabel(selection)}</p>
                    {(selection.selectionType === 'waitlist_replace' || selection.selectionType === 'play_in_request') &&
                    selection.replacesLeagueId ? (
                      <p className="text-gray-600">Would replace {leagueName(selection.replacesLeagueId)}.</p>
                    ) : null}
                    {rosterSummary ? (
                      <p className="text-gray-600">Team roster: {rosterSummary}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {waitlistFulfillmentSummary ? (
              <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">{waitlistFulfillmentSummary}</p>
            ) : null}
            {basicIceFallbackInterest != null ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                {basicIceFallbackInterest
                  ? 'If none of the league selections above can be placed, this curler asked to be offered basic ice privileges instead.'
                  : 'If none of the league selections above can be placed, this curler declined basic ice privileges. No invoice or membership will be created for this session.'}
              </p>
            ) : null}
            </>
          )}
          {leaguePayload?.evaluation.paymentDecision.outcome === 'deferred_payment' ? (
            <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              Payment will be deferred because one or more choices require placement or staff review.
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading} onClick={() => navigate('/registration/review')}>
              Continue to review
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'review') {
    const curlerLabel = member ? payload?.curler?.name : `${demographics.firstName} ${demographics.lastName}`.trim() || 'this curler';
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Review and pay</h1>
        <p className="mt-3 text-gray-600">Review the registration for {curlerLabel} before payment.</p>
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">Membership:</span>{' '}
              {membershipPayment?.selection.membershipOption === 'social'
                ? 'Social membership'
                : membershipPayment?.selection.membershipOption === 'junior_recreational'
                  ? 'Junior Recreational'
                  : 'Regular membership'}
            </p>
            {membershipPayment?.feePreview.lineItems.some((item) => item.lineType === 'spare_only_fee') ? (
              <p>
                <span className="font-medium text-gray-900">Basic ice privileges:</span> Included for this session
              </p>
            ) : null}
            {membershipPayment?.selection.studentDiscountClaimed ? (
              <p>
                <span className="font-medium text-gray-900">Student discount:</span> {membershipPayment.selection.studentInstitution}
              </p>
            ) : null}
            {membershipPayment?.selection.reciprocalDiscountClaimed ? (
              <p>
                <span className="font-medium text-gray-900">Reciprocal discount:</span> {membershipPayment.selection.reciprocalClubName}
              </p>
            ) : null}
          </div>
          {leagueSelections.length > 0 ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <h2 className="font-semibold text-[#121033]">League choices</h2>
              <div className="mt-2 space-y-2">
                {sortedLeagueSelections.map((selection, index) => {
                  const rosterSummary = rosterSummaryForSelection(
                    selection,
                    leagueCatalogItem(selection.leagueId),
                    memberOptionById,
                    memberOptionIdByName,
                    { id: registeringCurlerMemberId, name: registeringCurlerName },
                  );
                  return (
                    <div key={`${selection.selectionType}-${selection.leagueId ?? 'none'}-${index}`} className="rounded-xl bg-gray-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-gray-900">{selection.leagueId ? leagueName(selection.leagueId) : selectionLabel(selection)}</p>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary-teal shadow-sm">
                          {selectionStatusLabel(selection)}
                        </span>
                      </div>
                      <p className="mt-1 text-gray-600">{selectionLabel(selection)}</p>
                      {(selection.selectionType === 'waitlist_replace' || selection.selectionType === 'play_in_request') &&
                      selection.replacesLeagueId ? (
                        <p className="mt-1 text-gray-600">Would replace {leagueName(selection.replacesLeagueId)}.</p>
                      ) : null}
                      {rosterSummary ? (
                        <p className="mt-1 text-gray-600">Team roster: {rosterSummary}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : membershipPayment?.selection.membershipOption === 'junior_recreational' ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <span className="font-medium text-gray-900">League choices:</span> Junior Recreational skips normal league selection.
            </div>
          ) : null}
          {renderFeeSummary()}
          <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            {membershipPayment?.paymentDecision.outcome === 'deferred_payment'
              ? 'Payment is deferred. We will contact you when your registration is ready for payment.'
              : membershipPayment?.paymentDecision.outcome === 'no_payment_required'
                ? 'No payment is required now.'
                : 'Payment is due now to complete this registration.'}
          </p>
          {membershipPayment?.paymentDecision.outcome === 'deferred_payment' && membershipPayment.paymentDecision.deferralReasons.length > 0 ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
              <h2 className="font-semibold">Why payment is deferred</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {membershipPayment.paymentDecision.deferralReasons.map((reason) => (
                  <li key={reason}>{deferralReasonText(reason)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !membershipPayment} onClick={submitRegistration}>
              {membershipPayment?.paymentDecision.outcome === 'immediate_payment' ? 'Submit and pay' : 'Submit registration'}
            </Button>
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'success') {
    const isPaymentPending = paymentOrderToken ? isRegistrationPaymentPending(paymentStatus?.paymentStatus) : false;
    const showPaymentProcessingScreen = Boolean(paymentOrderToken && isPaymentPending && !showDetailedPaymentPending && !error);
    const title =
      paymentStatus?.paymentStatus === 'confirmed'
        ? 'Payment confirmed'
        : paymentStatus?.paymentStatus === 'failed'
          ? 'Payment was not completed'
          : showPaymentProcessingScreen
            ? 'Confirming payment'
            : 'Registration submitted';
    const description = paymentOrderToken
      ? paymentStatus?.paymentStatus === 'confirmed'
        ? 'Stripe has confirmed your payment and your registration is confirmed.'
        : paymentStatus?.paymentStatus === 'failed'
          ? 'Stripe did not complete this payment. Your registration remains unpaid and unconfirmed.'
          : showPaymentProcessingScreen
            ? 'Processing your payment confirmation...'
            : 'Your payment was submitted. We are confirming it with Stripe. This usually takes a few moments.'
      : 'Your registration has been submitted. No payment is due right now, or payment will be handled after placement review.';
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">{title}</h1>
        <p className="mt-3 text-gray-600">{description}</p>
        {showPaymentProcessingScreen ? (
          <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            Processing your payment confirmation...
          </div>
        ) : null}
        {paymentOrderToken && isPaymentPending && showDetailedPaymentPending ? (
          <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            Your payment is still processing. This page auto-refreshes for a short time.
            {paymentStatusPolling ? (
              <span className="mt-2 block text-xs text-sky-800">Checking payment status again...</span>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        <Link className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white" to="/dashboard">
          Return to dashboard
        </Link>
      </RegistrationCard>
    );
  } else if (currentStep === 'cancel') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Payment was not completed</h1>
        <p className="mt-3 text-gray-600">Your registration is not confirmed yet. You can return to review and start checkout again.</p>
        <Link
          className="mt-6 inline-flex rounded-lg bg-primary-teal px-4 py-2 text-sm font-medium text-white"
          to={paymentRegistrationId ? `/registration/review` : '/registration/start'}
        >
          Return to review
        </Link>
      </RegistrationCard>
    );
  } else {
    content = (
      <PublicStateCard title="Registration step not found" description="Return to the start of registration and continue from the next incomplete step." tone="warning" />
    );
  }

  return (
    <PublicLayout>
      <div className="bg-gradient-to-b from-emerald-50 via-white to-white px-4 py-12">{content}</div>
      <RegistrationImmediatePaymentConfirmationModal
        isOpen={checkoutConfirmation != null}
        saving={confirmingCheckout}
        message={checkoutConfirmation?.message}
        onCancel={() => setCheckoutConfirmation(null)}
        onContinue={() =>
          void (checkoutConfirmationMode === 'submit' ? confirmRegistrationCheckout() : confirmPriorityEditCheckout())
        }
      />
    </PublicLayout>
  );
}
