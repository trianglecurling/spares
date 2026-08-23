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
import InlineStateMessage from '../components/InlineStateMessage';
import FormField from '../components/FormField';
import ChoiceInput from '../components/ChoiceInput';
import Button from '../components/Button';
import RegistrationImmediatePaymentConfirmationModal from '../components/registration/RegistrationImmediatePaymentConfirmationModal';
import RecordOfflinePaymentModal from '../components/registration/RecordOfflinePaymentModal';
import RegistrationPayLaterConfirmationModal from '../components/registration/RegistrationPayLaterConfirmationModal';
import RegistrationDemographicFields, {
  type RegistrationDemographicFieldsHandle,
} from '../components/registration/RegistrationDemographicFields';
import RegistrationDemographicsStep from '../components/registration/RegistrationDemographicsStep';
import RegistrationNameTagStep from '../components/registration/RegistrationNameTagStep';
import RegistrationParentAssociationFields from '../components/registration/RegistrationParentAssociationFields';
import LeaguePriorityIntroStep from '../components/registration/LeaguePriorityIntroStep';
import LeaguePriorityStep from '../components/registration/LeaguePriorityStep';
import {
  byotGuaranteedReturnFootnoteId,
  byotGuaranteedReturnFootnotes,
  evaluatePriorityList,
  guaranteeChipLabel,
  isByotGuaranteedReturnCaveat,
  omitLeaveBehindDecisionsForListedLeagues,
  pendingRosterNames,
  shouldShowGuaranteeChip,
  type LeaguePriorityInput,
  type LeaguePrioritySavePayload,
  type RegistrationLeagueCatalogPayload as RegistrationLeagueCatalogPayloadBase,
} from '../components/registration/leaguePriorityShared';
import {
  editValidationErrorMessage,
  formatCurrency,
  formatEstimatedTotalRange,
  formatRegistrationDisplayDate,
  shouldShowLeaguePriorityIntro,
  submitRegistrationEdits,
  type LeagueEligibilityInput,
  type SubmitRegistrationEditsResult,
} from '../components/registration/registrationViewEditShared';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import {
  defaultRegistrationMailingAddressFormFields,
  parseRegistrationMailingAddressStored,
  registrationMailingAddressIsComplete,
  serializeRegistrationMailingAddress,
  DEFAULT_REGISTRATION_MAILING_STATE,
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
} from '../utils/registrationMailingAddress';
import { resolvePreferredPronounsForSave } from '../utils/preferredPronouns';
import {
  defaultUsaCurlingMembershipOptIn,
  defaultUswcaMembershipOptIn,
  membershipAppliesParentAssociations,
  shouldCollectParentAssociationOptIns,
} from '../utils/parentAssociationMemberships';
import {
  defaultNameTagPrintName,
  nameTagIsComplete,
  nameTagStepIsComplete,
  normalizeNameTagName,
  parseNameTagReplacementQuantity,
  resolveNameTagIncludePronounsForSave,
  type NameTagReplacementQuantity,
} from '../utils/nameTag';
import {
  USA_CURLING_COMPETITION_GENDER_DEFAULT,
  resolveUsaCurlingCompetitionGenderForSave,
} from '../utils/usaCurlingCompetitionGender';
import {
  nextStepFor,
  parseRegistrationResumePointer,
  membershipNeedsSabbaticalStep,
  experienceSkipsIcePrivilegesStep,
  shouldRecommendSaturdayInstructional,
  resolvePostShellResumeStepFromPayment,
  resolveResumeStepFromDraft,
  resumePointerMatchesDraft,
  resumePointerMatchesGuestDraft,
  staffRegistrationSearch,
  type RegistrationResumePointerV1,
} from '../utils/registrationResume';
import { computeDiscountedRegularMembershipFeeMinor } from '../utils/registrationMembershipFees';
import {
  registrationPaymentConfirmedMessage,
  registrationPaymentFailedMessage,
  registrationPaymentPendingMessage,
} from '../utils/paymentProcessorCopy';
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
  preferredPronouns: string | null;
  usaCurlingCompetitionGender: string | null;
  nameTagName: string | null;
  nameTagIncludePronouns: boolean | null;
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
    name_tag_replacement_quantity?: number | null;
  };
  submitter: MemberSummary | null;
  curler: MemberSummary | null;
  policies: Array<{ type: string; url: string; accepted: boolean }>;
  policiesComplete: boolean;
  isMinor: boolean;
};

type RegistrationWindow = {
  state: 'closed' | 'priority' | 'open';
  season: { id: number; name: string; startDate?: string; endDate?: string };
  session: { id: number; name: string; startDate?: string; endDate?: string };
  previousRegistrationSessionDisplayName?: string | null;
  availableDiscounts?: {
    student: RegistrationDiscountSlot;
    reciprocal: RegistrationDiscountSlot;
  };
  membershipFees?: {
    regularMinor: number;
    socialMinor: number;
    juniorRecreationalMinor: number;
    sabbaticalMinor: number;
    replacementNameTagMinor: number;
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
  preferredPronouns: string;
  usaCurlingCompetitionGender: string;
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
    usaCurlingMembershipOptIn?: boolean | null;
    uswcaMembershipOptIn?: boolean | null;
  };
  icePrivilegesChoice: IcePrivilegesChoice;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  spareOnlyIcePrivilegeFeeMinor?: number;
  noMembershipEligible?: boolean;
  hasLifetimeMembership?: boolean;
  feePreview: {
    lineItems: RegistrationFeeLineItem[];
    discountLineItems: RegistrationFeeLineItem[];
    subtotalMinor: number;
    discountTotalMinor: number;
    totalDueMinor: number;
    /** Ceiling of the quoted range while league placement is still unsettled. */
    estimatedMaximumTotalDueMinor?: number;
    blockingErrors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  paymentDecision: {
    outcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required';
    deferralReasons: string[];
    totalDueMinor: number;
  };
  paymentDeadlineAt?: string | null;
  paymentDeadlineDisplay?: string | null;
  payLaterAvailable?: boolean;
};

type RegistrationPaymentStatusPayload = {
  registrationId: number | null;
  paymentStatus:
    | 'confirming'
    | 'confirmed'
    | 'failed'
    | 'deferred'
    | 'no_payment_due'
    | 'cancelled'
    | 'payment_unapplied'
    | 'unknown';
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

type RegistrationLeagueCatalogPayload = RegistrationLeagueCatalogPayloadBase & {
  evaluation?: {
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
  nameTagName: string;
  nameTagIncludePronouns: boolean | null;
  membershipChoice: 'regular' | 'social' | null;
  usaCurlingMembershipOptIn: boolean;
  uswcaMembershipOptIn: boolean;
  basicIcePrivileges: boolean;
  icePrivilegesChoice: IcePrivilegesChoice | null;
  studentDiscountClaimed: boolean;
  studentInstitution: string;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string;
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceYears: string;
  desiredLeagueCount: number | null;
  leaguePriorities: LeaguePriorityInput[];
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
  preferredPronouns: '',
  usaCurlingCompetitionGender: USA_CURLING_COMPETITION_GENDER_DEFAULT,
};

function errorMessage(error: unknown, fallback: string): string {
  return editValidationErrorMessage(error, fallback);
}

function isRegistrationInProgressConflict(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
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

function membershipOptionTextValue(label: string, feeMinor: number | undefined): string {
  if (feeMinor == null) return label;
  return `${label}, ${formatCurrency(feeMinor)}`;
}

function renderMembershipChoiceContent(label: string, description: string, feeMinor: number | undefined) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-gray-900">{label}</div>
        <div className="mt-0.5 text-xs leading-4 text-gray-500">{description}</div>
      </div>
      {feeMinor != null ? (
        <span className="ms-auto shrink-0 self-center text-base font-semibold tabular-nums text-[#121033]">
          {formatCurrency(feeMinor)}
        </span>
      ) : null}
    </div>
  );
}

function hasClubExperienceRecord(knownExperienceYears: number | undefined | null): boolean {
  return (knownExperienceYears ?? 0) > 0;
}

function membershipUsesLeagueExperience(
  membershipOption: RegistrationMembershipPaymentPayload['selection']['membershipOption'] | null | undefined,
): boolean {
  return membershipOption !== 'social' && membershipOption !== 'junior_recreational';
}

function isSelfReportedExperienceType(
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing' | null | undefined,
): boolean {
  return experienceType === 'none_or_minimal' || experienceType === 'specified_years';
}

function parseReportedExperienceYearsInput(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldSkipExperienceStep(
  membershipPayment: RegistrationMembershipPaymentPayload | null | undefined,
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing',
): boolean {
  // A new-member self-report must stay editable. Self-reported years also raise
  // `knownExperienceYears`, so that field cannot be used as "has a club record".
  if (
    isSelfReportedExperienceType(experienceChoice) ||
    isSelfReportedExperienceType(membershipPayment?.selection.experienceType)
  ) {
    return false;
  }
  return (
    experienceChoice === 'known_existing' ||
    membershipPayment?.selection.experienceType === 'known_existing' ||
    hasClubExperienceRecord(membershipPayment?.knownExperienceYears)
  );
}

function reportedExperienceYears(
  experienceChoice: 'none_or_minimal' | 'specified_years' | 'known_existing',
  experienceYears: string,
  membershipPayment?: RegistrationMembershipPaymentPayload | null,
): number | null {
  if (experienceChoice === 'specified_years') {
    return parseReportedExperienceYearsInput(experienceYears);
  }
  if (membershipPayment?.selection.experienceType === 'specified_years') {
    return parseReportedExperienceYearsInput(membershipPayment.selection.experienceSelfReportedYears);
  }
  return null;
}

function leaguePlayContinuePath(
  leagues: RegistrationLeagueCatalogPayload['leagues'] | null | undefined,
  eligibility: LeagueEligibilityInput,
): string {
  return shouldShowLeaguePriorityIntro(leagues, eligibility)
    ? '/registration/league-priority-intro'
    : '/registration/league-priority';
}

function stepAfterDiscounts(membershipPayment: RegistrationMembershipPaymentPayload): string {
  const savedType = membershipPayment.selection.experienceType;
  if (savedType === 'none_or_minimal' || savedType === 'specified_years') return 'experience';
  return hasClubExperienceRecord(membershipPayment.knownExperienceYears) ? 'basic-ice' : 'experience';
}

/** Schema/API default is `none` before the member picks an ice privileges option. */
function icePrivilegesChoiceForUi(
  stored: IcePrivilegesChoice | null | undefined,
): IcePrivilegesChoice | null {
  if (!stored || stored === 'none') return null;
  return stored;
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

function signedInMemberFullName(
  member: { name: string } | null,
  submitter?: Pick<MemberSummary, 'firstName' | 'lastName'> | null,
): string {
  const first = submitter?.firstName?.trim() ?? '';
  const last = submitter?.lastName?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return member?.name?.trim() ?? '';
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
    preferredPronouns: member.preferredPronouns || '',
    usaCurlingCompetitionGender: resolveUsaCurlingCompetitionGenderForSave(member.usaCurlingCompetitionGender),
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
    preferredPronouns: String(o.preferredPronouns ?? ''),
    usaCurlingCompetitionGender: resolveUsaCurlingCompetitionGenderForSave(
      typeof o.usaCurlingCompetitionGender === 'string' ? o.usaCurlingCompetitionGender : '',
    ),
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

function resolvedCurlerDateOfBirth(
  curlerDateOfBirth: string | null | undefined,
  demographics: DemographicsForm,
): string {
  return curlerDateOfBirth || demographics.dateOfBirth || '';
}

function registrationDemographicsFormIsComplete(
  form: DemographicsForm,
  curlerDateOfBirth?: string | null,
): boolean {
  const minor = isMinorDate(resolvedCurlerDateOfBirth(curlerDateOfBirth, form));
  return (
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    (!curlerDateOfBirth ? form.dateOfBirth.trim() !== '' : true) &&
    form.email.trim() !== '' &&
    form.phone.trim() !== '' &&
    (minor || (form.emergencyContactName.trim() !== '' && form.emergencyContactPhone.trim() !== '')) &&
    registrationMailingAddressIsComplete(form)
  );
}

function guestNextStepAfterPolicies(
  demographics: DemographicsForm,
  curlerDateOfBirth: string | null | undefined,
  nameTagName: string,
  nameTagIncludePronouns: boolean | null,
): string {
  if (!registrationDemographicsFormIsComplete(demographics, curlerDateOfBirth)) return 'demographics';
  if (!nameTagIsComplete(nameTagName || defaultNameTagPrintName(demographics.firstName, demographics.lastName), nameTagIncludePronouns)) return 'name-tag';
  if (isMinorDate(resolvedCurlerDateOfBirth(curlerDateOfBirth, demographics))) return 'guardian';
  return 'discounts';
}

function demographicsPayloadForIdentityApi(
  form: DemographicsForm,
  curlerStoredDateOfBirth?: string | null,
): Record<string, string> & { email: string } {
  const base = {
    firstName: form.firstName,
    lastName: form.lastName,
    email: form.email,
    phone: form.phone,
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
    preferredPronouns: resolvePreferredPronounsForSave(form.preferredPronouns),
    usaCurlingCompetitionGender: resolveUsaCurlingCompetitionGenderForSave(form.usaCurlingCompetitionGender),
  };
  const withMailing = registrationMailingAddressIsComplete(form)
    ? { ...base, mailingAddress: serializeRegistrationMailingAddress(form) }
    : base;
  if (!curlerStoredDateOfBirth && form.dateOfBirth.trim()) {
    return { ...withMailing, dateOfBirth: form.dateOfBirth };
  }
  return withMailing;
}

function demographicsPayloadForPersistedSave(
  form: DemographicsForm,
  curlerStoredDateOfBirth?: string | null,
): {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  preferredPronouns: string;
  usaCurlingCompetitionGender: string;
  dateOfBirth?: string;
} {
  const payload = {
    firstName: form.firstName,
    lastName: form.lastName,
    email: form.email,
    phone: form.phone,
    mailingAddress: serializeRegistrationMailingAddress(form),
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
    preferredPronouns: resolvePreferredPronounsForSave(form.preferredPronouns),
    usaCurlingCompetitionGender: resolveUsaCurlingCompetitionGenderForSave(form.usaCurlingCompetitionGender),
  };
  if (!curlerStoredDateOfBirth && form.dateOfBirth.trim()) {
    return { ...payload, dateOfBirth: form.dateOfBirth };
  }
  return payload;
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
  return resolvePostShellResumeStepFromPayment(paymentData as RegistrationMembershipPaymentPayload);
}

function shellResumePayload(
  shell: RegistrationShellPayload,
  id: number,
): Parameters<typeof nextStepFor>[0] {
  return {
    id,
    registration: shell.registration,
    isMinor: shell.isMinor,
    nameTagComplete: nameTagStepIsComplete({
      isReturningMember: shell.registration.returning_member_answer === 1,
      name: shell.curler?.nameTagName,
      includePronouns: shell.curler?.nameTagIncludePronouns,
      replacementQuantity: shell.registration.name_tag_replacement_quantity,
    }),
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
    nameTagName: partial.nameTagName ?? '',
    nameTagIncludePronouns: partial.nameTagIncludePronouns ?? null,
    membershipChoice: partial.membershipChoice ?? null,
    usaCurlingMembershipOptIn: partial.usaCurlingMembershipOptIn ?? defaultUsaCurlingMembershipOptIn(),
    uswcaMembershipOptIn:
      partial.uswcaMembershipOptIn ?? defaultUswcaMembershipOptIn(partial.demographics?.preferredPronouns),
    basicIcePrivileges: partial.basicIcePrivileges ?? false,
    icePrivilegesChoice: partial.icePrivilegesChoice ?? null,
    studentDiscountClaimed: partial.studentDiscountClaimed ?? false,
    studentInstitution: partial.studentInstitution ?? '',
    reciprocalDiscountClaimed: partial.reciprocalDiscountClaimed ?? false,
    reciprocalClubName: partial.reciprocalClubName ?? '',
    experienceChoice: partial.experienceChoice ?? 'none_or_minimal',
    experienceYears: partial.experienceYears ?? '',
    desiredLeagueCount: partial.desiredLeagueCount ?? null,
    leaguePriorities: partial.leaguePriorities ?? [],
    step: partial.step,
  };
}

function overlayGuestLeagueSelection(
  catalog: RegistrationLeagueCatalogPayload,
  saved: { desiredLeagueCount: number | null; priorities: LeaguePriorityInput[] } | null,
): RegistrationLeagueCatalogPayload {
  if (!saved) return catalog;
  return {
    ...catalog,
    desiredLeagueCount: saved.desiredLeagueCount,
    priorities: saved.priorities,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { step: stepParam } = useParams<{ step: string }>();
  const { member, login, logout, isLoading: authLoading } = useAuth();
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
  const [nameTagName, setNameTagName] = useState('');
  const [nameTagIncludePronouns, setNameTagIncludePronouns] = useState<boolean | null>(null);
  const [nameTagReplacementQuantity, setNameTagReplacementQuantity] = useState<NameTagReplacementQuantity | null>(
    null,
  );
  const nameTagNameRef = useRef(nameTagName);
  const nameTagIncludePronounsRef = useRef(nameTagIncludePronouns);
  nameTagNameRef.current = nameTagName;
  nameTagIncludePronounsRef.current = nameTagIncludePronouns;
  const [membershipPayment, setMembershipPayment] = useState<RegistrationMembershipPaymentPayload | null>(null);
  const [reviewPaymentReady, setReviewPaymentReady] = useState(false);
  const [reviewCatalogReady, setReviewCatalogReady] = useState(false);
  const [membershipChoice, setMembershipChoice] = useState<
    'regular' | 'social' | 'junior_recreational' | 'none' | null
  >(null);
  const [juniorAssistancePercent, setJuniorAssistancePercent] = useState<'0' | '25' | '50' | '75'>('0');
  const [usaCurlingMembershipOptIn, setUsaCurlingMembershipOptIn] = useState(defaultUsaCurlingMembershipOptIn);
  const [uswcaMembershipOptIn, setUswcaMembershipOptIn] = useState(false);
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
  const [leaguePayload, setLeaguePayload] = useState<RegistrationLeagueCatalogPayload | null>(null);
  const guestLeagueSelectionRef = useRef<{
    desiredLeagueCount: number | null;
    priorities: LeaguePriorityInput[];
  } | null>(null);
  const [membershipCommitteeComments, setMembershipCommitteeComments] = useState('');
  /** Remounts identity fields after a fresh start so leftover parent details cannot stick. */
  const [registrationFormEpoch, setRegistrationFormEpoch] = useState(0);
  const [error, setError] = useState('');
  const [checkoutConfirmation, setCheckoutConfirmation] = useState<SubmitRegistrationEditsResult | null>(null);
  const [checkoutConfirmationMode, setCheckoutConfirmationMode] = useState<'submit' | 'priority-edit'>('submit');
  const [payLaterConfirmationOpen, setPayLaterConfirmationOpen] = useState(false);
  const [offlinePaymentOpen, setOfflinePaymentOpen] = useState(false);
  const [confirmingPayLater, setConfirmingPayLater] = useState(false);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [loading, setLoading] = useState(false);
  /** Suppresses one-shot auto-forward effects right after an explicit Back navigation. */
  const registrationNavigationIntentRef = useRef<'back' | null>(null);
  const noMembershipPathActiveRef = useRef(false);
  /** Keeps an in-progress discounts pick from being overwritten by a late membership-payment fetch. */
  const discountsTouchedRef = useRef(false);
  /** Keeps the experience step reachable after Back until the user leaves the step. */
  const suppressExperienceAutoSkipRef = useRef(false);

  const resetRegistrationFormState = useCallback(() => {
    setRegistrationId(null);
    setPayload(null);
    setMembershipPayment(null);
    setReviewPaymentReady(false);
    setReviewCatalogReady(false);
    setMembershipChoice(null);
    setJuniorAssistancePercent('0');
    setUsaCurlingMembershipOptIn(defaultUsaCurlingMembershipOptIn());
    setUswcaMembershipOptIn(false);
    setBasicIcePrivileges(false);
    setIcePrivilegesChoice(null);
    setNoIceConfirm(false);
    setStudentDiscountClaimed(false);
    setStudentInstitution('');
    setReciprocalDiscountClaimed(false);
    setReciprocalClubName('');
    setExperienceChoice('none_or_minimal');
    setExperienceYears('');
    setLeaguePayload(null);
    guestLeagueSelectionRef.current = null;
    setMembershipCommitteeComments('');
    setSameEmail('different');
    setDemographics(emptyDemographics);
    demographicsRef.current = emptyDemographics;
    setGuardian({ firstName: '', lastName: '', email: '', phone: '' });
    setNameTagName('');
    nameTagNameRef.current = '';
    setNameTagIncludePronouns(null);
    nameTagIncludePronounsRef.current = null;
    setNameTagReplacementQuantity(null);
    noMembershipPathActiveRef.current = false;
    discountsTouchedRef.current = false;
    suppressExperienceAutoSkipRef.current = false;
    setCheckoutConfirmation(null);
    setPayLaterConfirmationOpen(false);
    setError('');
    setRegistrationFormEpoch((epoch) => epoch + 1);
  }, []);
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
  const membershipCommitteeCommentsInputId = useId();
  const byotReturnCaveatIdPrefix = useId();

  const memberOptionById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option])),
    [memberOptions.options],
  );
  const registeringCurlerMemberId = payload?.registration.curler_member_id ?? null;
  const curlerStoredDateOfBirth = payload?.curler?.dateOfBirth || null;
  const registeringCurlerDateOfBirth = curlerStoredDateOfBirth || demographics.dateOfBirth || null;
  const experienceYearsNumeric = reportedExperienceYears(experienceChoice, experienceYears, membershipPayment);
  const skipsIcePrivileges = experienceSkipsIcePrivilegesStep(experienceChoice, experienceYearsNumeric);
  const recommendSaturdayInstructional = shouldRecommendSaturdayInstructional(
    experienceChoice,
    experienceYearsNumeric,
  );
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
  const staffRegistrationIdFromQuery = useMemo(() => {
    const raw = searchParams.get('staffRegistrationId');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);
  const [staffRegistrationId, setStaffRegistrationId] = useState<number | null>(staffRegistrationIdFromQuery);
  const isStaffCreate = staffRegistrationId != null;

  useEffect(() => {
    if (staffRegistrationIdFromQuery) setStaffRegistrationId(staffRegistrationIdFromQuery);
  }, [staffRegistrationIdFromQuery]);

  useEffect(() => {
    if (!staffRegistrationId) return;
    if (searchParams.get('staffRegistrationId') === String(staffRegistrationId)) return;
    const next = new URLSearchParams(searchParams);
    next.set('staffRegistrationId', String(staffRegistrationId));
    setSearchParams(next, { replace: true });
  }, [staffRegistrationId, searchParams, setSearchParams]);

  /** Logged-in users on new-curler identity setup are always registering someone else. */
  const identityRegisteringForOther =
    registeringForSomeoneElse || registeringForSelf === 'other' || Boolean(member);

  /**
   * Server-truth priority list re-labeled locally so the review screen shows the
   * same guarantee chips the priority page did. Teammate return rights must be
   * included: a BYOT doubles team is guaranteed only when every declared player
   * is returning, and omitting that map waitlists a team the priority page
   * already labeled guaranteed return.
   */
  const priorityEvaluation = useMemo(
    () =>
      evaluatePriorityList({
        priorities: leaguePayload?.priorities ?? [],
        leagues: leaguePayload?.leagues ?? [],
        desiredLeagueCount: leaguePayload?.desiredLeagueCount ?? null,
        returnRightLeagueIds: leaguePayload?.returnRightLeagueIds ?? [],
        returnEligibleMemberIdsByLeagueId: leaguePayload?.returnEligibleMemberIdsByLeagueId ?? {},
        playInEntry: leaguePayload?.playInEntry,
        priorLeagueDecisions: leaguePayload?.priorLeagueDecisions ?? [],
        registrantMemberId: registeringCurlerMemberId,
        registrationState: leaguePayload?.registrationState ?? windowState?.state,
      }),
    [leaguePayload, registeringCurlerMemberId, windowState?.state],
  );

  const priorityReviewEntries = priorityEvaluation.entries;
  const priorityReviewLeagueById = useMemo(
    () => new Map((leaguePayload?.leagues ?? []).map((league) => [league.id, league])),
    [leaguePayload?.leagues],
  );
  const byotReturnFootnotes = useMemo(
    () =>
      byotGuaranteedReturnFootnotes(
        priorityReviewEntries.map((entry) => ({
          label: entry.label,
          league: priorityReviewLeagueById.get(entry.leagueId),
        })),
        byotReturnCaveatIdPrefix,
      ),
    [byotReturnCaveatIdPrefix, priorityReviewEntries, priorityReviewLeagueById],
  );

  const hideDroppedPriorLeagueDecisions =
    membershipPayment?.selection.membershipOption === 'social' ||
    membershipPayment?.selection.membershipOption === 'none' ||
    membershipChoice === 'social' ||
    membershipChoice === 'none';

  const priorLeagueDecisionSummary = useMemo(
    () =>
      omitLeaveBehindDecisionsForListedLeagues(
        leaguePayload?.priorLeagueDecisions ?? [],
        leaguePayload?.priorities ?? [],
      )
        .filter((decision) => !(hideDroppedPriorLeagueDecisions && decision.decision === 'drop'))
        .map((decision) => {
          const name = leaguePayload?.leagues.find((league) => league.id === decision.leagueId)?.name ?? 'League';
          return decision.decision === 'sabbatical' ? `${name}: sabbatical` : `${name}: dropped`;
        }),
    [hideDroppedPriorLeagueDecisions, leaguePayload],
  );

  const priorityRosterTextByLeagueId = useMemo(() => {
    const map = new Map<number, string>();
    for (const priority of leaguePayload?.priorities ?? []) {
      const names = [
        ...(priority.teamRosterPlacements ?? []).map(
          (placement) => memberOptionById.get(placement.memberId)?.name ?? 'Member',
        ),
        ...pendingRosterNames(priority.byotTeammateText),
      ];
      if (names.length > 0) map.set(priority.leagueId, names.join(', '));
    }
    return map;
  }, [leaguePayload?.priorities, memberOptionById]);

  const isGuestLocal = !member;
  const reviewQuoteReady = isGuestLocal ? reviewPaymentReady : reviewPaymentReady && reviewCatalogReady;

  const juniorRecreationalEligible = useMemo(
    () => isJuniorRecreationalEligibleDate(registeringCurlerDateOfBirth || ''),
    [registeringCurlerDateOfBirth],
  );

  const membershipOptions = useMemo(() => {
    const fees = windowState?.membershipFees;
    const regularMinor =
      fees?.regularMinor == null
        ? undefined
        : computeDiscountedRegularMembershipFeeMinor({
            baseRegularMinor: fees.regularMinor,
            studentDiscountClaimed,
            reciprocalDiscountClaimed,
            availableDiscounts: windowState?.availableDiscounts,
          });
    const regularDescription =
      'Choose this if the curler plans to curl, spare, practice, or register for leagues.';
    const socialDescription =
      'Choose this if the individual wants to be a member but will not curl this session. All social members will have association dues paid on their behalf.';
    const noMembershipDescription =
      'Register or extend a sabbatical from the previous session without purchasing membership for this session.';
    const juniorDescription = 'This special junior program skips normal league selection. For Junior Advanced Commitment, please select "Regular membership".';
    const options: Array<{
      value: 'regular' | 'social' | 'junior_recreational' | 'none';
      label: string;
      textValue: string;
      description: string;
      render: () => ReturnType<typeof renderMembershipChoiceContent>;
    }> = [
      {
        value: 'regular',
        label: 'Regular membership',
        textValue: membershipOptionTextValue('Regular membership', regularMinor),
        description: regularDescription,
        render: () => renderMembershipChoiceContent('Regular membership', regularDescription, regularMinor),
      },
      {
        value: 'social',
        label: 'Social membership',
        textValue: membershipOptionTextValue('Social membership', fees?.socialMinor),
        description: socialDescription,
        render: () => renderMembershipChoiceContent('Social membership', socialDescription, fees?.socialMinor),
      },
    ];
    if (membershipPayment?.noMembershipEligible) {
      options.push({
        value: 'none',
        label: 'Sabbatical only',
        textValue: membershipOptionTextValue('Sabbatical only', fees?.sabbaticalMinor),
        description: noMembershipDescription,
        render: () => renderMembershipChoiceContent('Sabbatical only', noMembershipDescription, fees?.sabbaticalMinor),
      });
    }
    if (juniorRecreationalEligible) {
      options.push({
        value: 'junior_recreational',
        label: 'Junior Recreational',
        textValue: membershipOptionTextValue('Junior Recreational', fees?.juniorRecreationalMinor),
        description: juniorDescription,
        render: () =>
          renderMembershipChoiceContent('Junior Recreational', juniorDescription, fees?.juniorRecreationalMinor),
      });
    }
    return options;
  }, [
    juniorRecreationalEligible,
    membershipPayment?.noMembershipEligible,
    windowState?.membershipFees,
    windowState?.availableDiscounts,
    studentDiscountClaimed,
    reciprocalDiscountClaimed,
  ]);

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
    if (data.curler) {
      setDemographics(demographicsFromMember(data.curler));
    }
    setGuardian({
      firstName: data.registration.guardian_first_name || '',
      lastName: data.registration.guardian_last_name || '',
      email: data.registration.guardian_email || '',
      phone: data.registration.guardian_phone || '',
    });
    setNameTagName(data.curler?.nameTagName || '');
    setNameTagIncludePronouns(data.curler?.nameTagIncludePronouns ?? null);
    setNameTagReplacementQuantity(parseNameTagReplacementQuantity(data.registration.name_tag_replacement_quantity));
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
    setNameTagName(draft.nameTagName || '');
    setNameTagIncludePronouns(draft.nameTagIncludePronouns ?? null);
    setMembershipChoice(draft.membershipChoice);
    setUsaCurlingMembershipOptIn(
      typeof draft.usaCurlingMembershipOptIn === 'boolean'
        ? draft.usaCurlingMembershipOptIn
        : defaultUsaCurlingMembershipOptIn(),
    );
    setUswcaMembershipOptIn(
      typeof draft.uswcaMembershipOptIn === 'boolean'
        ? draft.uswcaMembershipOptIn
        : defaultUswcaMembershipOptIn(draft.demographics?.preferredPronouns),
    );
    setBasicIcePrivileges(draft.basicIcePrivileges);
    setIcePrivilegesChoice(draft.icePrivilegesChoice ?? (draft.basicIcePrivileges ? 'basic_ice' : null));
    if (!discountsTouchedRef.current) {
      setStudentDiscountClaimed(draft.studentDiscountClaimed);
      setStudentInstitution(draft.studentInstitution);
      setReciprocalDiscountClaimed(draft.reciprocalDiscountClaimed);
      setReciprocalClubName(draft.reciprocalClubName);
    }
    setExperienceChoice(draft.experienceChoice);
    setExperienceYears(draft.experienceYears);
    if (
      experienceSkipsIcePrivilegesStep(
        draft.experienceChoice,
        parseReportedExperienceYearsInput(draft.experienceYears),
      ) &&
      !draft.basicIcePrivileges
    ) {
      setIcePrivilegesChoice('league_play');
      setBasicIcePrivileges(false);
    }
    if (draft.desiredLeagueCount != null || (draft.leaguePriorities && draft.leaguePriorities.length > 0)) {
      guestLeagueSelectionRef.current = {
        desiredLeagueCount: draft.desiredLeagueCount ?? null,
        priorities: draft.leaguePriorities ?? [],
      };
    }
  }, [member?.email]);

  const persistGuestDraft = useCallback(
    (step: string, overrides: Partial<LocalRegistrationDraftV1> = {}) => {
      if (!windowState || member) return;
      saveLocalDraft(
        buildGuestDraftBase(windowState, {
          registeringForSelf,
          sameEmail,
          demographics: identityDemographicFieldsRef.current?.getValue() ?? demographicsRef.current,
          guardian,
          nameTagName: nameTagNameRef.current,
          nameTagIncludePronouns: nameTagIncludePronounsRef.current,
          membershipChoice:
            membershipChoice === 'junior_recreational' || membershipChoice === 'none' || membershipChoice == null
              ? null
              : membershipChoice,
          usaCurlingMembershipOptIn,
          uswcaMembershipOptIn,
          basicIcePrivileges,
          icePrivilegesChoice,
          studentDiscountClaimed,
          studentInstitution,
          reciprocalDiscountClaimed,
          reciprocalClubName,
          experienceChoice,
          experienceYears,
          desiredLeagueCount: guestLeagueSelectionRef.current?.desiredLeagueCount ?? null,
          leaguePriorities: guestLeagueSelectionRef.current?.priorities ?? [],
          ...overrides,
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
      usaCurlingMembershipOptIn,
      uswcaMembershipOptIn,
      basicIcePrivileges,
      icePrivilegesChoice,
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
      if (staffRegistrationId) {
        finishResumeCheck();
        return;
      }
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
  }, [currentStep, member, windowState, authLoading, startBootstrapKey, staffRegistrationId]);

  useEffect(() => {
    if (!isPriorityEdit || !member || currentStep === 'start' || currentStep === 'success' || currentStep === 'cancel') return;
    if (registrationId !== null && payload) return;
    let canceled = false;
    void (async () => {
      try {
        const { data: current } = await api.get<{ registration: { id: number } }>('/registration/member/registrations/current', {
          params: priorityEditCurlerMemberId != null ? { curlerMemberId: priorityEditCurlerMemberId } : undefined,
        });
        if (canceled) return;
        await hydrateDraftFromServerById(current.registration.id);
        const membershipSteps = new Set([
          'membership',
          'discounts',
          'experience',
          'basic-ice',
          'ice-privileges',
          'league-priority-intro',
          'review',
        ]);
        if (membershipSteps.has(currentStep)) {
          const response = await api.get(`/registration/drafts/${current.registration.id}/membership-payment`);
          if (!canceled) setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        }
        if (currentStep === 'league-priority') {
          const response = await api.get(`/registration/drafts/${current.registration.id}/league-catalog`);
          if (!canceled) setLeaguePayload(response.data as RegistrationLeagueCatalogPayload);
        }
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to load this registration for editing.'));
      }
    })();
    return () => {
      canceled = true;
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
    let canceled = false;
    (async () => {
      try {
        if (staffRegistrationId) {
          await hydrateDraftFromServerById(staffRegistrationId);
          if (canceled) return;
          return;
        }
        const { data } = await api.get<{ draft: (RegistrationShellPayload & { id: number }) | null }>('/registration/drafts/me');
        if (canceled) return;
        if (!data.draft) {
          navigate('/registration/start', { replace: true });
          return;
        }
        hydrateFromServerPayload(data.draft);
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to load this registration draft.'));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    member?.id,
    currentStep,
    navigate,
    hydrateFromServerPayload,
    hydrateDraftFromServerById,
    isPriorityEdit,
    staffRegistrationId,
  ]);

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
    let canceled = false;
    api
      .get('/registration/returning-profiles', {
        params: {
          seasonId: windowState?.season.id ?? payload?.registration.season_id,
          sessionId: windowState?.session.id ?? payload?.registration.session_id,
        },
      })
      .then((response) => {
        if (canceled) return;
        setProfiles(response.data);
        setReturningProfilesFetchStatus('ready');
      })
      .catch((err) => {
        if (canceled) return;
        setProfiles([]);
        setReturningProfilesFetchStatus('error');
        setError(errorMessage(err, 'Unable to load eligible curler profiles.'));
      });
    return () => {
      canceled = true;
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
    const live = identityDemographicFieldsRef.current?.getValue();
    if (value === 'same' && submitterEmailForCurler) {
      setDemographics((current) => ({
        ...(live ?? current),
        email: submitterEmailForCurler,
      }));
      return;
    }
    if (live) setDemographics(live);
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
    if (!member?.id) return;
    setReturningGuestLoginPhase(null);
    setReturningLoginEmail('');
    setReturningLoginCode('');
    setReturningLoginMultipleMembers([]);
    setReturningLoginTempToken('');
    setReturningLoginUnrecognizedChoice(null);
  }, [member?.id]);

  useEffect(() => {
    if (currentStep !== 'membership') return;
    if (membershipChoice === 'junior_recreational' && !juniorRecreationalEligible) {
      setMembershipChoice(null);
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
      'league-priority-intro',
      'league-priority',
      'review',
    ];
    if (!member || !registrationId || !payload || !membershipSteps.includes(currentStep)) return;
    if (
      !isPriorityEdit &&
      payload.registration.status !== 'shell_complete' &&
      nextStepFor(shellResumePayload(payload, registrationId)) !== 'discounts'
    )
      return;

    let canceled = false;
    (async () => {
      try {
        if (payload.registration.status !== 'shell_complete' && !isPriorityEdit) {
          await api.post(`/registration/drafts/${registrationId}/complete-shell`);
          if (canceled) return;
          const { data } = await api.get<RegistrationShellPayload>(`/registration/drafts/${registrationId}`);
          if (canceled) return;
          hydrateFromServerPayload({ id: registrationId, ...data });
        }
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to continue registration.'));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [member, registrationId, payload, currentStep, hydrateFromServerPayload, isPriorityEdit]);

  useEffect(() => {
    setReviewPaymentReady(false);
    setReviewCatalogReady(false);
  }, [currentStep, registrationId]);

  useEffect(() => {
    if (currentStep !== 'discounts') {
      discountsTouchedRef.current = false;
    }
  }, [currentStep]);

  useEffect(() => {
    const membershipPaymentFlowSteps = [
      'membership',
      'discounts',
      'experience',
      'basic-ice',
      'league-priority-intro',
      'league-priority',
      'review',
    ];
    if (!member || !registrationId || !membershipPaymentFlowSteps.includes(currentStep)) return;
    if (payload && payload.registration.status !== 'shell_complete' && !isPriorityEdit) return;
    let canceled = false;
    if (currentStep === 'review') setReviewPaymentReady(false);
    api
      .get(`/registration/drafts/${registrationId}/membership-payment`)
      .then((response) => {
        if (canceled) return;
        const data = response.data as RegistrationMembershipPaymentPayload;
        setMembershipPayment(data);
        const membershipOption = data.selection.membershipOption;
        // Only hydrate an explicit saved choice. The DB default is `none` before selection;
        // leave local state alone so we do not auto-select or clobber a pending UI pick.
        if (membershipOption === 'none' && data.noMembershipEligible && noMembershipPathActiveRef.current) {
          setMembershipChoice('none');
        } else if (membershipOption === 'junior_recreational') {
          setMembershipChoice('junior_recreational');
        } else if (membershipOption === 'social') {
          setMembershipChoice('social');
        } else if (membershipOption === 'regular' || membershipOption === 'regular_spare_only') {
          setMembershipChoice('regular');
        }
        if (shouldCollectParentAssociationOptIns(membershipOption, data.hasLifetimeMembership)) {
          setUsaCurlingMembershipOptIn(
            data.selection.usaCurlingMembershipOptIn ?? defaultUsaCurlingMembershipOptIn(),
          );
          setUswcaMembershipOptIn(
            data.selection.uswcaMembershipOptIn ??
              defaultUswcaMembershipOptIn(demographicsRef.current.preferredPronouns),
          );
        }
        setBasicIcePrivileges(membershipOption === 'regular_spare_only');
        setIcePrivilegesChoice((current) => {
          const onIcePrivilegesStep = currentStep === 'basic-ice';
          // Keep a pick the registrant already made on this screen, including
          // an in-progress "no ice privileges" click, across a refetch.
          if (onIcePrivilegesStep && current !== null) return current;
          // Schema default `none` means "not chosen yet". Do not treat it as a
          // selected option on this step or earlier ones, or it arrives
          // pre-selected when the registrant first reaches ice privileges.
          return icePrivilegesChoiceForUi(data.icePrivilegesChoice);
        });
        // Keep a pick the registrant already made on this screen across a late
        // membership-payment fetch (complete-shell + hydrate can land after click).
        if (!discountsTouchedRef.current) {
          setStudentDiscountClaimed(data.selection.studentDiscountClaimed);
          setStudentInstitution(data.selection.studentInstitution || '');
          setReciprocalDiscountClaimed(data.selection.reciprocalDiscountClaimed);
          setReciprocalClubName(data.selection.reciprocalClubName || '');
        }
        setExperienceChoice(data.selection.experienceType || (data.knownExperienceYears > 0 ? 'known_existing' : 'none_or_minimal'));
        setExperienceYears(data.selection.experienceSelfReportedYears?.toString() || '');
        if (currentStep === 'review') setReviewPaymentReady(true);
      })
      .catch((err) => {
        if (!canceled) setError(errorMessage(err, 'Unable to load membership details.'));
      });
    return () => {
      canceled = true;
    };
  }, [registrationId, member, currentStep, payload?.registration.status, isPriorityEdit]);

  useEffect(() => {
    if (currentStep !== 'experience' || !shouldSkipExperienceStep(membershipPayment, experienceChoice)) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      suppressExperienceAutoSkipRef.current = true;
      return;
    }
    if (suppressExperienceAutoSkipRef.current) return;
    if (!membershipUsesLeagueExperience(membershipPayment?.selection.membershipOption)) {
      navigate('/registration/review', { replace: true });
      return;
    }

    let canceled = false;
    (async () => {
      setError('');
      try {
        if (member && registrationId !== null) {
          if (membershipPayment?.selection.experienceType !== 'known_existing') {
            const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
              experienceType: 'known_existing',
              experienceSelfReportedYears: null,
            });
            if (canceled) return;
            setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
          }
          setExperienceChoice('known_existing');
        }
        if (!canceled) navigate('/registration/basic-ice', { replace: true });
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to apply club curling experience record.'));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [currentStep, member, registrationId, membershipPayment, experienceChoice, navigate]);

  useEffect(() => {
    if (currentStep !== 'basic-ice') return;
    if (!skipsIcePrivileges) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      navigate('/registration/experience', { replace: true });
      return;
    }

    let canceled = false;
    (async () => {
      try {
        if (
          member &&
          registrationId !== null &&
          membershipPayment &&
          membershipPayment.icePrivilegesChoice !== 'league_play'
        ) {
          const response = await api.patch(`/registration/drafts/${registrationId}/ice-privileges`, {
            choice: 'league_play',
          });
          if (canceled) return;
          setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
          setIcePrivilegesChoice('league_play');
          setBasicIcePrivileges(false);
        } else {
          setIcePrivilegesChoice('league_play');
          setBasicIcePrivileges(false);
        }
        if (!canceled) {
          navigate(leaguePlayContinuePath(leaguePayload?.leagues, leagueEligibilityInput), { replace: true });
        }
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to continue to league selection.'));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    currentStep,
    member,
    registrationId,
    membershipPayment,
    leaguePayload?.leagues,
    leagueEligibilityInput,
    skipsIcePrivileges,
    navigate,
  ]);

  useEffect(() => {
    if (currentStep !== 'league-priority-intro') return;
    if (!leaguePayload || shouldShowLeaguePriorityIntro(leaguePayload.leagues, leagueEligibilityInput)) return;
    if (registrationNavigationIntentRef.current === 'back') {
      registrationNavigationIntentRef.current = null;
      navigate(
        skipsIcePrivileges ? '/registration/experience' : '/registration/basic-ice',
        { replace: true },
      );
      return;
    }
    navigate('/registration/league-priority', { replace: true });
  }, [currentStep, leagueEligibilityInput, leaguePayload, skipsIcePrivileges, navigate]);

  useEffect(() => {
    const leagueSteps = ['experience', 'basic-ice', 'league-priority-intro', 'league-priority', 'review'];
    if (!member || !registrationId || !leagueSteps.includes(currentStep)) return;
    let canceled = false;
    if (currentStep === 'review') setReviewCatalogReady(false);
    api
      .get(`/registration/drafts/${registrationId}/league-catalog`)
      .then((response) => {
        if (canceled) return;
        setLeaguePayload(response.data as RegistrationLeagueCatalogPayload);
        if (currentStep === 'review') setReviewCatalogReady(true);
      })
      .catch((err) => {
        if (!canceled) {
          setError(errorMessage(err, 'Unable to load league choices.'));
          if (currentStep === 'review') setReviewCatalogReady(true);
        }
      });
    return () => {
      canceled = true;
    };
  }, [registrationId, member?.id, currentStep]);

  useEffect(() => {
    const leagueSteps = ['experience', 'basic-ice', 'league-priority-intro', 'league-priority', 'review'];
    if (authLoading || !isGuestLocal || !windowState || !leagueSteps.includes(currentStep)) return;
    if (!registeringCurlerDateOfBirth?.trim()) return;
    let canceled = false;
    if (currentStep === 'review') setReviewCatalogReady(false);
    const saved = guestLeagueSelectionRef.current;
    api
      .post('/registration/guest/preview-league-catalog', {
        seasonId: windowState.season.id,
        sessionId: windowState.session.id,
        curlerDateOfBirth: registeringCurlerDateOfBirth,
        membershipChoice: membershipChoice === 'social' ? 'social' : 'regular',
        basicIcePrivileges,
        studentDiscountClaimed,
        studentInstitution: studentInstitution || null,
        reciprocalDiscountClaimed,
        reciprocalClubName: reciprocalClubName || null,
        experienceType: experienceChoice,
        experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        usaCurlingMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
          ? usaCurlingMembershipOptIn
          : null,
        uswcaMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
          ? uswcaMembershipOptIn
          : null,
        desiredLeagueCount: saved?.desiredLeagueCount ?? null,
        priorities: saved?.priorities ?? [],
      })
      .then((response) => {
        if (canceled) return;
        setLeaguePayload(
          overlayGuestLeagueSelection(response.data as RegistrationLeagueCatalogPayload, guestLeagueSelectionRef.current),
        );
        setError('');
        if (currentStep === 'review') setReviewCatalogReady(true);
      })
      .catch((err) => {
        if (!canceled) {
          setError(errorMessage(err, 'Unable to load league choices.'));
          if (currentStep === 'review') setReviewCatalogReady(true);
        }
      });
    return () => {
      canceled = true;
    };
  }, [
    authLoading,
    isGuestLocal,
    windowState,
    currentStep,
    registeringCurlerDateOfBirth,
    membershipChoice,
    basicIcePrivileges,
    studentDiscountClaimed,
    studentInstitution,
    reciprocalDiscountClaimed,
    reciprocalClubName,
    experienceChoice,
    experienceYears,
    usaCurlingMembershipOptIn,
    uswcaMembershipOptIn,
  ]);

  useEffect(() => {
    const guestPhaseSteps = [
      'discounts',
      'membership',
      'experience',
      'basic-ice',
      'league-priority-intro',
      'league-priority',
      'review',
    ];
    // Wait for auth + local draft restore so we do not preview with an empty DOB (Zod "Validation failed").
    if (authLoading || !isGuestLocal || !windowState || !guestPhaseSteps.includes(currentStep)) return;
    if (!registeringCurlerDateOfBirth?.trim()) return;
    let canceled = false;
    if (currentStep === 'review') setReviewPaymentReady(false);
    (async () => {
      try {
        const { data } = await api.post<RegistrationMembershipPaymentPayload>('/registration/guest/preview-membership-payment', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          curlerDateOfBirth: registeringCurlerDateOfBirth,
          // Preview only; UI membership choice stays unselected until the curler picks one.
          membershipChoice: membershipChoice === 'social' ? 'social' : 'regular',
          basicIcePrivileges,
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
          usaCurlingMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
            ? usaCurlingMembershipOptIn
            : null,
          uswcaMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
            ? uswcaMembershipOptIn
            : null,
          desiredLeagueCount:
            guestLeagueSelectionRef.current?.desiredLeagueCount ?? leaguePayload?.desiredLeagueCount ?? null,
          priorities: guestLeagueSelectionRef.current?.priorities ?? leaguePayload?.priorities ?? [],
        });
        if (!canceled) {
          setMembershipPayment(data);
          if (currentStep !== 'league-priority-intro' && currentStep !== 'league-priority') {
            setError('');
          }
          if (currentStep === 'review') setReviewPaymentReady(true);
        }
      } catch (err) {
        if (!canceled) setError(errorMessage(err, 'Unable to load membership preview.'));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    authLoading,
    currentStep,
    isGuestLocal,
    windowState,
    registeringCurlerDateOfBirth,
    membershipChoice,
    basicIcePrivileges,
    studentDiscountClaimed,
    studentInstitution,
    reciprocalDiscountClaimed,
    reciprocalClubName,
    experienceChoice,
    experienceYears,
    usaCurlingMembershipOptIn,
    uswcaMembershipOptIn,
    leaguePayload?.desiredLeagueCount,
    leaguePayload?.priorities,
  ]);

  useEffect(() => {
    if (currentStep !== 'complete') return;
    if (member && registrationId !== null) {
      let canceled = false;
      (async () => {
        setLoading(true);
        setError('');
        try {
          if (payload?.registration.status !== 'shell_complete') {
            await api.post(`/registration/drafts/${registrationId}/complete-shell`);
          }
          if (!canceled) navigate('/registration/discounts', { replace: true });
        } catch (err) {
          if (!canceled) {
            setError(errorMessage(err, 'Unable to continue registration.'));
            if (payload) {
              const target = nextStepFor(shellResumePayload(payload, registrationId));
              if (target !== 'membership') navigate(`/registration/${target}`, { replace: true });
            }
          }
        } finally {
          if (!canceled) setLoading(false);
        }
      })();
      return () => {
        canceled = true;
      };
    }
    navigate('/registration/discounts', { replace: true });
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

    let canceled = false;
    let pollTimeoutId: number | null = null;
    let resolveAttempted = false;
    setPaymentStatusPolling(true);
    setShowDetailedPaymentPending(false);

    const detailTimerId = window.setTimeout(() => {
      if (canceled) return;
      setShowDetailedPaymentPending(true);
    }, REGISTRATION_PAYMENT_PROCESSING_GRACE_MS);

    const tryResolveFromCheckoutReturn = async (): Promise<boolean> => {
      if (resolveAttempted) return false;
      resolveAttempted = true;

      try {
        const { data } = await api.post<RegistrationPaymentStatusPayload>(
          `/registration/payment-status/${encodeURIComponent(paymentOrderToken)}/resolve`,
          paymentSessionId ? { sessionId: paymentSessionId } : {},
        );
        if (canceled) return false;
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
        if (canceled) return;
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
        if (canceled) return;
        setPaymentStatusPolling(false);
        setError(errorMessage(err, 'Unable to confirm payment status.'));
      }
    };

    void poll();

    return () => {
      canceled = true;
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

    let canceled = false;
    void api
      .get<RegistrationShellPayload>(`/registration/drafts/${id}`)
      .then(({ data }) => {
        if (canceled) return;
        hydrateFromServerPayload({ id, ...data });
      })
      .catch(() => {
        // Header falls back to sessionStorage when present.
      });

    return () => {
      canceled = true;
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
    if (!windowState) return '';
    return windowState.session.name;
  }, [windowState]);

  const seasonName = useMemo(() => {
    if (!windowState) return '';
    return windowState.season.name;
  }, [windowState]);

  const membershipValidityLabel = useMemo(() => {
    const startDate = windowState?.season.startDate;
    const endDate = windowState?.season.endDate;
    if (!startDate || !endDate) return null;
    return `This membership will be valid from ${formatRegistrationDisplayDate(startDate)} to ${formatRegistrationDisplayDate(endDate)}.`;
  }, [windowState?.season.endDate, windowState?.season.startDate]);

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
    if (!windowState) return '';
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
    windowState,
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
      await login(accessToken, refreshToken, normalized, '/registration/identity', { suppressNavigation: true });

      if (await continueExistingServerDraftFromMe()) {
        return;
      }

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
      if (isRegistrationInProgressConflict(err) && (await continueExistingServerDraftFromMe().catch(() => false))) {
        return;
      }
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
      title: isStaffCreate ? 'Cancel this registration?' : 'Start over?',
      message: isStaffCreate
        ? 'This cancels the in-progress staff registration and returns you to registration management. This cannot be undone.'
        : 'This clears your in-progress registration and returns you to the registration start page. This cannot be undone.',
      confirmText: isStaffCreate ? 'Cancel registration' : 'Start over',
      variant: 'warning',
    });
    if (!accepted) return;
    setError('');
    setLoading(true);
    try {
      if (member) {
        try {
          if (staffRegistrationId) {
            await api.delete(`/registration/drafts/${staffRegistrationId}`);
          } else {
            const { data } = await api.get<{ draft: { id: number } | null }>('/registration/drafts/me');
            if (data.draft) {
              await api.delete(`/registration/drafts/${data.draft.id}`);
            }
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
      resetRegistrationFormState();
      setResumeOffer('none');
      setServerResume(null);
      setReturningAnswer(null);
      resetReturningGuestLoginFlow();
      setReturningIdentityAuxMode(null);
      setReturningRegistrarProfileChoice(null);
      navigate(isStaffCreate ? '/admin/registrations/list' : '/registration/start', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to clear registration.'));
    } finally {
      setLoading(false);
    }
  }

  function handleIdentityLogout() {
    clearLocalDraft();
    resetRegistrationFormState();
    setResumeOffer('none');
    setServerResume(null);
    setReturningAnswer(null);
    resetReturningGuestLoginFlow();
    setReturningIdentityAuxMode(null);
    setReturningRegistrarProfileChoice(null);
    logout('/registration/start');
  }

  const navigateRegistrationBack = useCallback(
    (path: string) => {
      registrationNavigationIntentRef.current = 'back';
      if (staffRegistrationId && path.startsWith('/registration/')) {
        navigate(`${path}${staffRegistrationSearch(staffRegistrationId)}`);
        return;
      }
      navigate(path);
    },
    [navigate, staffRegistrationId],
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
      resetRegistrationFormState();
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
  }, [member, navigate, registrationId, resetRegistrationFormState]);

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
    clearLocalDraft();
    resetRegistrationFormState();
    setReturningAnswer(null);
    resetReturningGuestLoginFlow();
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

  async function continueExistingServerDraftFromMe(): Promise<boolean> {
    const { data } = await api.get<{ draft: (RegistrationShellPayload & { id: number }) | null }>(
      '/registration/drafts/me',
    );
    if (!data.draft) return false;
    hydrateFromServerPayload(data.draft);
    const target = await resolveResumeStepForDraft(data.draft);
    resetReturningGuestLoginFlow();
    setResumeOffer('none');
    navigate(`/registration/${target}`, { replace: true });
    return true;
  }

  async function startDraft(answer: 'yes' | 'no') {
    if (!windowState) return;
    if (answer === 'yes' && !member) return;
    setLoading(true);
    setError('');
    resetRegistrationFormState();
    try {
      if (member && (await continueExistingServerDraftFromMe())) {
        return;
      }
      if (answer === 'yes') {
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
      if (member && isRegistrationInProgressConflict(err) && (await continueExistingServerDraftFromMe().catch(() => false))) {
        return;
      }
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
      if (!registrationDemographicsFormIsComplete(form, curlerStoredDateOfBirth)) {
        setError('Enter all required curler information before continuing.');
        return;
      }
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/identity-new`, {
          registeringForSelf: identityRegisteringForOther ? false : registeringForSelf === 'self',
          curler: demographicsPayloadForIdentityApi(form, curlerStoredDateOfBirth),
          submitter: member ? undefined : demographicsPayloadForIdentityApi(form, curlerStoredDateOfBirth),
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
      if (!registrationDemographicsFormIsComplete(form, curlerStoredDateOfBirth)) {
        setError('Enter all required curler information before continuing.');
        return;
      }
      await api.patch(`/registration/drafts/${registrationId}/identity-new`, {
        registeringForSelf: false,
        curler: demographicsPayloadForIdentityApi(form, curlerStoredDateOfBirth),
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
        const nextStep = guestNextStepAfterPolicies(
          demographics,
          registeringCurlerDateOfBirth,
          nameTagName,
          nameTagIncludePronouns,
        );
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
          demographicsPayloadForPersistedSave(form, curlerStoredDateOfBirth),
        );
        const data = response.data as RegistrationShellPayload;
        hydrateFromServerPayload({ id: registrationId, ...data });
        navigate('/registration/name-tag');
      } else {
        persistGuestDraftRef.current('name-tag');
        navigate('/registration/name-tag');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save demographic information.'));
    } finally {
      setLoading(false);
    }
  }, [member, registrationId, navigate, curlerStoredDateOfBirth, hydrateFromServerPayload]);

  const handleRegistrationDemographicsBack = useCallback(() => {
    navigateRegistrationBack('/registration/policies');
  }, [navigateRegistrationBack]);

  const submitNameTag = useCallback(
    async (value: {
      nameTagName: string;
      nameTagIncludePronouns: boolean;
      replacementQuantity?: NameTagReplacementQuantity;
    }) => {
      const name = normalizeNameTagName(value.nameTagName);
      setNameTagName(name);
      setNameTagIncludePronouns(value.nameTagIncludePronouns);
      nameTagNameRef.current = name;
      nameTagIncludePronounsRef.current = value.nameTagIncludePronouns;
      if (value.replacementQuantity !== undefined) {
        setNameTagReplacementQuantity(value.replacementQuantity);
      }
      setLoading(true);
      setError('');
      try {
        if (member && registrationId !== null) {
          const response = await api.patch(`/registration/drafts/${registrationId}/name-tag`, {
            nameTagName: name,
            nameTagIncludePronouns: value.nameTagIncludePronouns,
            ...(value.replacementQuantity !== undefined
              ? { replacementQuantity: value.replacementQuantity }
              : {}),
          });
          const data = response.data as RegistrationShellPayload;
          hydrateFromServerPayload({ id: registrationId, ...data });
          if (data.isMinor) {
            navigate('/registration/guardian');
          } else {
            await api.post(`/registration/drafts/${registrationId}/complete-shell`);
            navigate('/registration/discounts');
          }
        } else if (isMinorDate(resolvedCurlerDateOfBirth(curlerStoredDateOfBirth, demographicsRef.current))) {
          persistGuestDraftRef.current('guardian');
          navigate('/registration/guardian');
        } else {
          persistGuestDraftRef.current('discounts');
          navigate('/registration/discounts');
        }
      } catch (err) {
        setError(errorMessage(err, 'Unable to save name tag details.'));
      } finally {
        setLoading(false);
      }
    },
    [member, registrationId, navigate, curlerStoredDateOfBirth, hydrateFromServerPayload],
  );

  const handleRegistrationNameTagBack = useCallback(() => {
    navigateRegistrationBack('/registration/demographics');
  }, [navigateRegistrationBack]);

  async function submitGuardian(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        await api.patch(`/registration/drafts/${registrationId}/guardian`, guardian);
        await api.post(`/registration/drafts/${registrationId}/complete-shell`);
        navigate('/registration/discounts');
      } else {
        persistGuestDraft('discounts');
        navigate('/registration/discounts');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save parent/guardian information.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveMembership(event: React.FormEvent) {
    event.preventDefault();
    const isLifetimeMember = membershipPayment?.hasLifetimeMembership === true;
    if (!isLifetimeMember && membershipChoice == null) {
      setError('Choose a membership type.');
      return;
    }
    const selectedMembership = membershipChoice ?? 'regular';
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const appliesParentAssociations = shouldCollectParentAssociationOptIns(
          selectedMembership,
          isLifetimeMember,
        );
        const response = await api.patch(`/registration/drafts/${registrationId}/membership`, {
          membershipOption: selectedMembership,
          basicIcePrivileges: false,
          juniorAssistancePercent: selectedMembership === 'junior_recreational' ? Number(juniorAssistancePercent) : 0,
          ...(appliesParentAssociations
            ? { usaCurlingMembershipOptIn, uswcaMembershipOptIn }
            : {}),
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        const paymentPayload = response.data as RegistrationMembershipPaymentPayload;
        const goToSabbaticalStep = membershipNeedsSabbaticalStep({
          membershipOption: selectedMembership,
          noMembershipEligible: paymentPayload.noMembershipEligible,
        });
        navigate(
          goToSabbaticalStep
            ? '/registration/league-priority'
            : selectedMembership === 'social' || selectedMembership === 'junior_recreational'
              ? '/registration/review'
              : `/registration/${stepAfterDiscounts(paymentPayload)}`,
        );
        if (selectedMembership === 'none') {
          noMembershipPathActiveRef.current = true;
        } else {
          noMembershipPathActiveRef.current = false;
        }
      } else {
        const guestNextStep =
          selectedMembership === 'social'
            ? 'review'
            : isSelfReportedExperienceType(experienceChoice) || !membershipPayment
              ? 'experience'
              : stepAfterDiscounts(membershipPayment);
        persistGuestDraft(guestNextStep);
        navigate(`/registration/${guestNextStep}`);
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
        // Self-reported years raise `knownExperienceYears`. Only returning members
        // with a club record (and no self-report) skip the experience question.
        if (
          membershipUsesLeagueExperience(data.selection.membershipOption) &&
          !isSelfReportedExperienceType(data.selection.experienceType) &&
          hasClubExperienceRecord(data.knownExperienceYears)
        ) {
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
        navigate('/registration/membership');
      } else {
        persistGuestDraft('membership');
        navigate('/registration/membership');
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
      const skipIcePrivileges = skipsIcePrivileges;
      const nextPath = skipIcePrivileges
        ? leaguePlayContinuePath(leaguePayload?.leagues, leagueEligibilityInput)
        : '/registration/basic-ice';
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/experience`, {
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
        });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
        if (skipIcePrivileges) {
          setIcePrivilegesChoice('league_play');
          setBasicIcePrivileges(false);
        }
        if (isPriorityEdit) {
          await finishPriorityEdit();
          return;
        }
        navigate(nextPath);
      } else {
        if (skipIcePrivileges) {
          setIcePrivilegesChoice('league_play');
          setBasicIcePrivileges(false);
        }
        persistGuestDraft(skipIcePrivileges ? 'league-priority-intro' : 'basic-ice', {
          ...(skipIcePrivileges ? { icePrivilegesChoice: 'league_play' as const, basicIcePrivileges: false } : {}),
        });
        navigate(nextPath);
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to save curling experience.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveIcePrivileges(choice: IcePrivilegesChoice) {
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const response = await api.patch(`/registration/drafts/${registrationId}/ice-privileges`, { choice });
        setMembershipPayment(response.data as RegistrationMembershipPaymentPayload);
      }
      setIcePrivilegesChoice(choice);
      setBasicIcePrivileges(choice === 'basic_ice');
      if (choice === 'none') {
        setNoIceConfirm(false);
        if (!member) persistGuestDraft('review', { icePrivilegesChoice: 'none', basicIcePrivileges: false });
        navigate('/registration/review');
        return;
      }
      const nextPath =
        choice === 'league_play'
          ? leaguePlayContinuePath(leaguePayload?.leagues, leagueEligibilityInput)
          : '/registration/league-priority';
      if (!member) {
        persistGuestDraft(choice === 'league_play' ? 'league-priority-intro' : 'league-priority', {
          icePrivilegesChoice: choice,
          basicIcePrivileges: choice === 'basic_ice',
        });
      }
      navigate(nextPath);
    } catch (err) {
      setError(errorMessage(err, 'Unable to save ice privileges.'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Persists the priority list. Rethrows so the step can surface the failure
   * inline while keeping the list the registrant typed.
   */
  async function saveLeaguePriorities(
    input: LeaguePrioritySavePayload,
    onSaved?: () => void | Promise<void>,
  ) {
    if (!member || registrationId === null) {
      setLoading(true);
      setError('');
      try {
        guestLeagueSelectionRef.current = {
          desiredLeagueCount: input.desiredLeagueCount,
          priorities: input.priorities,
        };
        setLeaguePayload((prev) =>
          prev
            ? {
                ...prev,
                desiredLeagueCount: input.desiredLeagueCount,
                priorities: input.priorities,
                priorLeagueDecisions: input.priorLeagueDecisions,
                basicIceFallbackInterest: input.basicIceFallbackInterest ?? prev.basicIceFallbackInterest,
              }
            : prev,
        );
        persistGuestDraft('review');
        if (onSaved) {
          await onSaved();
          return;
        }
        navigate('/registration/review');
      } catch (err) {
        const message = errorMessage(err, 'Unable to save your league priorities.');
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.put(`/registration/drafts/${registrationId}/league-priorities`, input);
      setLeaguePayload(response.data as RegistrationLeagueCatalogPayload);
      if (onSaved) {
        await onSaved();
        return;
      }
      navigate('/registration/review');
    } catch (err) {
      const message = editValidationErrorMessage(err, 'Unable to save your league priorities.');
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
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
      const result = await submitRegistrationEdits(registrationId, {
        confirmImmediatePayment: true,
        membershipCommitteeComments: membershipCommitteeComments.trim() || null,
      });
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

  async function submitRegistration(options?: {
    payLater?: boolean;
    recordOfflinePayment?: boolean;
    offlinePaymentNote?: string;
  }) {
    setLoading(true);
    setError('');
    try {
      if (member && registrationId !== null) {
        const result = await submitRegistrationEdits(registrationId, {
          payLater: options?.payLater,
          membershipCommitteeComments: membershipCommitteeComments.trim() || null,
          recordOfflinePayment: options?.recordOfflinePayment,
          offlinePaymentNote: options?.offlinePaymentNote,
        });
        if (result.requiresCheckoutConfirmation) {
          setPayLaterConfirmationOpen(false);
          setConfirmingPayLater(false);
          setCheckoutConfirmationMode('submit');
          setCheckoutConfirmation(result);
          return;
        }
        if (result.recordedOfflinePayment || (isStaffCreate && !result.checkoutUrl)) {
          setOfflinePaymentOpen(false);
          showAlert(
            result.recordedOfflinePayment
              ? 'Registration submitted and payment recorded.'
              : 'Registration submitted.',
            'success',
            'Registration submitted',
          );
          navigate(`/admin/registrations/${registrationId}`, { replace: true });
          return;
        }
        if (result.payLater) {
          setPayLaterConfirmationOpen(false);
          setConfirmingPayLater(false);
          rememberRegistrationCurlerNameForSuccess(registrationId, registeringCurlerName);
          navigate('/registration/success', { state: { payLater: true } });
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
        const { data } = await api.post<{
          outcome: string;
          checkoutUrl?: string;
          registrationId?: number;
          payLater?: boolean;
        }>('/registration/guest/submit', {
          seasonId: windowState.season.id,
          sessionId: windowState.session.id,
          registeringForSelf: registeringForSelf === 'self',
          useSubmitterEmailForCurler,
          submitter: registeringForSelf === 'self' ? undefined : demographicsPayloadForIdentityApi(demographics, curlerStoredDateOfBirth),
          curler: demographicsPayloadForPersistedSave(demographics, curlerStoredDateOfBirth),
          nameTagName: normalizeNameTagName(nameTagName) || defaultNameTagPrintName(demographics.firstName, demographics.lastName),
          nameTagIncludePronouns: resolveNameTagIncludePronounsForSave(
            demographics.preferredPronouns,
            nameTagIncludePronouns,
          ),
          guardian: isMinorDate(registeringCurlerDateOfBirth || '') ? guardian : undefined,
          membershipChoice: membershipChoice === 'social' ? 'social' : 'regular',
          basicIcePrivileges,
          icePrivilegesChoice:
            icePrivilegesChoice ?? (basicIcePrivileges ? 'basic_ice' : skipsIcePrivileges ? 'league_play' : undefined),
          studentDiscountClaimed,
          studentInstitution: studentInstitution || null,
          reciprocalDiscountClaimed,
          reciprocalClubName: reciprocalClubName || null,
          experienceType: experienceChoice,
          experienceSelfReportedYears: experienceChoice === 'specified_years' ? Number(experienceYears) : null,
          usaCurlingMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
            ? usaCurlingMembershipOptIn
            : undefined,
          uswcaMembershipOptIn: membershipAppliesParentAssociations(membershipChoice)
            ? uswcaMembershipOptIn
            : undefined,
          payLater: options?.payLater ?? false,
          membershipCommitteeComments: membershipCommitteeComments.trim() || null,
          desiredLeagueCount:
            membershipChoice === 'social'
              ? null
              : guestLeagueSelectionRef.current?.desiredLeagueCount ?? leaguePayload?.desiredLeagueCount ?? null,
          priorities:
            membershipChoice === 'social'
              ? []
              : guestLeagueSelectionRef.current?.priorities ?? leaguePayload?.priorities ?? [],
          basicIceFallbackInterest: leaguePayload?.basicIceFallbackInterest ?? null,
        });
        rememberRegistrationCurlerNameForSuccess(data.registrationId, registeringCurlerName);
        clearLocalDraft();
        if (data.payLater) {
          setPayLaterConfirmationOpen(false);
          setConfirmingPayLater(false);
          navigate('/registration/success', { state: { payLater: true } });
          return;
        }
        if (data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
          return;
        }
        navigate('/registration/success');
      }
    } catch (err) {
      setError(errorMessage(err, 'Unable to submit registration.'));
      setConfirmingPayLater(false);
    } finally {
      setLoading(false);
    }
  }

  async function confirmPayLaterSubmission() {
    setConfirmingPayLater(true);
    setError('');
    await submitRegistration({ payLater: true });
  }

  function openPayLaterConfirmation() {
    setError('');
    setPayLaterConfirmationOpen(true);
  }

  function openStaffOfflinePayment() {
    setError('');
    setOfflinePaymentOpen(true);
  }

  async function submitStaffOfflinePayment(note: string) {
    await submitRegistration({ recordOfflinePayment: true, offlinePaymentNote: note });
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
      return { label: 'Back', onClick: () => navigate(priorityEditReturnTo) };
    }

    if (isStaffCreate && (currentStep === 'identity' || currentStep === 'policies' || currentStep === 'demographics')) {
      if (currentStep === 'identity') {
        return { label: 'Back to registrations', onClick: () => navigate('/admin/registrations/list') };
      }
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
      const curlerIsMinor = payload?.isMinor ?? isMinorDate(registeringCurlerDateOfBirth || '');
      const guardianCollected = Boolean(payload?.registration.guardian_email || guardian.email.trim());
      if (curlerIsMinor && guardianCollected) return '/registration/guardian';
      return '/registration/name-tag';
    };

    switch (currentStep) {
      case 'policies':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/identity') };
      case 'demographics':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/policies') };
      case 'name-tag':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/demographics') };
      case 'guardian':
        return {
          label: 'Back',
          onClick: () => navigateRegistrationBack('/registration/name-tag'),
        };
      case 'complete':
      case 'discounts':
        return { label: 'Back', onClick: () => navigateRegistrationBack(membershipBackTarget()) };
      case 'membership':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/discounts') };
      case 'experience':
        return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/membership') };
      case 'basic-ice':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              shouldSkipExperienceStep(membershipPayment, experienceChoice)
                ? '/registration/membership'
                : '/registration/experience',
            ),
        };
      case 'league-priority-intro':
        return {
          label: 'Back',
          onClick: () =>
            navigateRegistrationBack(
              skipsIcePrivileges ? '/registration/experience' : '/registration/basic-ice',
            ),
        };
      case 'league-priority':
        return {
          label: 'Back',
          onClick: () => {
            if (isPriorityEdit) {
              navigateRegistrationBack(priorityEditReturnTo);
              return;
            }
            if (
              membershipPayment?.selection.membershipOption === 'none' ||
              membershipPayment?.selection.membershipOption === 'social' ||
              membershipChoice === 'none' ||
              membershipChoice === 'social'
            ) {
              if (membershipPayment?.selection.membershipOption === 'none' || membershipChoice === 'none') {
                noMembershipPathActiveRef.current = true;
              }
              navigateRegistrationBack('/registration/membership');
              return;
            }
            navigateRegistrationBack(
              (icePrivilegesChoice === 'league_play' || skipsIcePrivileges) &&
                shouldShowLeaguePriorityIntro(leaguePayload?.leagues, leagueEligibilityInput)
                ? '/registration/league-priority-intro'
                : skipsIcePrivileges
                  ? '/registration/experience'
                  : '/registration/basic-ice',
            );
          },
        };
      case 'review': {
        const membershipOption =
          membershipPayment?.selection.membershipOption ??
          (membershipChoice === 'none'
            ? 'none'
            : membershipChoice === 'junior_recreational'
              ? 'junior_recreational'
              : membershipChoice === 'social'
                ? 'social'
                : null);
        if (
          membershipNeedsSabbaticalStep({
            membershipOption,
            noMembershipEligible: membershipPayment?.noMembershipEligible,
          })
        ) {
          return {
            label: 'Back',
            onClick: () => navigateRegistrationBack('/registration/league-priority'),
          };
        }
        if (membershipOption === 'social' || membershipOption === 'junior_recreational') {
          return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/membership') };
        }
        const iceChoice = membershipPayment?.icePrivilegesChoice ?? icePrivilegesChoice;
        if (iceChoice === 'none' && membershipOption !== 'none') {
          return { label: 'Back', onClick: () => navigateRegistrationBack('/registration/basic-ice') };
        }
        return {
          label: 'Back',
          onClick: () => navigateRegistrationBack('/registration/league-priority'),
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
    registeringCurlerDateOfBirth,
    experienceChoice,
    guardian.email,
    icePrivilegesChoice,
    skipsIcePrivileges,
    isPriorityEdit,
    leagueEligibilityInput,
    leaguePayload?.leagues,
    membershipChoice,
    membershipPayment,
    membershipPayment?.selection.membershipOption,
    navigateRegistrationBack,
    noIceConfirm,
    payload?.isMinor,
    payload?.registration.guardian_email,
    paymentRegistrationId,
    priorityEditReturnTo,
    returningIdentityAuxMode,
    handleBackToRegistrationStart,
    isStaffCreate,
    navigate,
  ]);

  function RegistrationFlowHeader() {
    if (currentStep === 'start') return null;
    const back = resolveRegistrationFlowBackAction();
    return (
      <>
        {isStaffCreate ? (
          <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
            <p className="font-medium">Creating registration for {registeringCurlerName}</p>
            <p className="mt-1">
              You are completing this registration as staff. After you submit, you can record a check or cash payment
              or send a payment link.
            </p>
          </div>
        ) : null}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-emerald-100 pb-4">
          <div className="order-1 shrink-0">
            {back ? (
              <Button type="button" variant="secondary" className="text-sm" onClick={back.onClick}>
                {back.label}
              </Button>
            ) : null}
          </div>
          {registrationFlowHeaderTitle ? (
            <p className="order-3 w-full basis-full text-center text-sm font-medium text-gray-700 sm:order-2 sm:w-auto sm:flex-1 sm:basis-auto">
              {registrationFlowHeaderTitle}
            </p>
          ) : null}
          <div className="order-2 ms-auto shrink-0 sm:order-3 sm:ms-0">
            {showStartOver ? (
              <Button type="button" variant="secondary" className="text-sm" disabled={loading} onClick={handleStartOver}>
                {isStaffCreate ? 'Cancel' : 'Start over'}
              </Button>
            ) : null}
          </div>
        </div>
      </>
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
        key={`${registrationId ?? 'guest'}-identity-${identityKey}-${registrationFormEpoch}`}
        ref={identityDemographicFieldsRef}
        initialValue={demographics}
        curlerDateOfBirth={curlerStoredDateOfBirth}
        lockCurlerEmailToSubmitter={syncCurlerEmailChoice && lockCurlerEmailToSubmitter}
        submitterEmailForCurler={submitterEmailForCurler}
        onSubmitterEmailMatch={syncCurlerEmailChoice ? handleSubmitterEmailMatch : undefined}
        onCommit={commitDemographicsDraft}
      />
    );
  }

  function renderFeeSummary() {
    if (!membershipPayment || !reviewQuoteReady) {
      return (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
          <h2 className="text-lg font-semibold text-[#121033]">Charges</h2>
          <div className="mt-3">
            <InlineStateMessage title="Calculating your registration total." />
          </div>
        </div>
      );
    }
    const allLines = [...membershipPayment.feePreview.lineItems, ...membershipPayment.feePreview.discountLineItems];
    const floorMinor = membershipPayment.feePreview.totalDueMinor;
    const ceilingMinor = membershipPayment.feePreview.estimatedMaximumTotalDueMinor ?? floorMinor;
    // Only quote a range while placement is unsettled and an unguaranteed league could still add cost.
    const showEstimatedRange =
      membershipPayment.paymentDecision.outcome === 'deferred_payment' && ceilingMinor > floorMinor;
    const totalLabel =
      membershipPayment.paymentDecision.outcome === 'no_payment_required'
        ? 'Total due now'
        : showEstimatedRange
          ? 'Estimated total'
          : 'Total due now';
    const totalDisplay =
      membershipPayment.paymentDecision.outcome === 'no_payment_required'
        ? formatCurrency(0)
        : showEstimatedRange
          ? formatEstimatedTotalRange(floorMinor, ceilingMinor, formatCurrency)
          : formatCurrency(floorMinor);
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
        {showEstimatedRange ? (
          <p className="mt-2 text-sm text-gray-600">Final payment depends on league placement.</p>
        ) : null}
      </div>
    );
  }

  function leagueName(leagueId: number | null | undefined): string {
    return leaguePayload?.leagues.find((league) => league.id === leagueId)?.name ?? 'League';
  }

  function deferralReasonText(reason: string): string {
    switch (reason) {
      case 'waitlist_placement_pending':
        return 'One or more leagues on your list are not guaranteed yet, so payment waits until placement settles.';
      case 'play_in_placement_pending':
        return 'A play-in league choice depends on play-in results before payment can be finalized.';
      case 'non_guaranteed_league_defers_payment':
      case 'return_subject_to_availability':
        return 'One or more league choices is subject to availability, so payment waits until placement is confirmed.';
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
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-teal-link">Registration</p>
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
          {member || !returningGuestLoginPhase ? (
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
                <a href="mailto:membership@trianglecurling.com" className="font-medium text-primary-teal-link underline">
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
      <RegistrationCard>
        <RegistrationFlowHeader />
        <div className="mt-12 flex min-h-[200px] flex-col items-center justify-start">
          <span
            className="h-10 w-10 animate-spin rounded-full border-2 border-primary-teal border-t-transparent"
            aria-hidden
          />
          <p className="mt-4 text-sm text-gray-600" role="status">
            Loading registration…
          </p>
        </div>
      </RegistrationCard>
    );
  } else if (windowState.state === 'closed') {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">Registration is closed</h1>
        <p className="mt-3 min-h-[200px] text-gray-600">
          Registration for {seasonSessionLabel} is not open yet.
        </p>
      </RegistrationCard>
    );
  } else if (currentStep === 'identity') {
    if (member && !payload) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <div className="mt-12 flex min-h-[200px] flex-col items-center justify-start">
            <span
              className="h-10 w-10 animate-spin rounded-full border-2 border-primary-teal border-t-transparent"
              aria-hidden
            />
            <p className="mt-4 text-sm text-gray-600" role="status">
              Loading registration…
            </p>
          </div>
        </RegistrationCard>
      );
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
            value: RETURNING_IDENTITY_OTHER_RETURNING_VALUE,
            label: 'Someone else who is a returning member from Winter 2026',
            description: 'They will need to give you permission to register on their behalf.',
          },
          {
            value: RETURNING_IDENTITY_OTHER_NEW_VALUE,
            label: 'Someone else who is joining as a new member or returning from a previous season',
            description: 'The curler needs a new club member account.',
          },
        ];

      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <h1 className="text-3xl font-bold text-[#121033]">Who are you registering?</h1>
          {member ? (
            <p className="mt-3 text-gray-600">
              You are currently signed in as {signedInMemberFullName(member, payload.submitter)}. If this is not you,{' '}
              <button
                type="button"
                className="font-medium text-primary-teal-link underline underline-offset-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30 rounded-sm"
                onClick={handleIdentityLogout}
              >
                log out
              </button>{' '}
              to continue.
            </p>
          ) : null}
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
              <input type="checkbox" required className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-teal-link focus:ring-primary-teal" />
              <span>
                I agree to the{' '}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary-teal-link underline"
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
        curlerDateOfBirth={curlerStoredDateOfBirth}
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
  } else if (currentStep === 'name-tag') {
    content = (
      <RegistrationNameTagStep
        headerTitle={registrationFlowHeaderTitle}
        showStartOver={Boolean(showStartOver)}
        loading={loading}
        error={error}
        firstName={demographics.firstName}
        lastName={demographics.lastName}
        preferredPronouns={demographics.preferredPronouns}
        initialName={nameTagName}
        initialIncludePronouns={nameTagIncludePronouns}
        isReturningMember={payload?.registration.returning_member_answer === 1}
        replacementPriceMinor={windowState?.membershipFees?.replacementNameTagMinor ?? 0}
        initialReplacementQuantity={nameTagReplacementQuantity}
        onBack={handleRegistrationNameTagBack}
        onStartOver={handleStartOver}
        onSubmit={submitNameTag}
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
    if (member && registrationId && !membershipPayment) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Loading membership" description="Checking membership options for this curler." />
        </RegistrationCard>
      );
    } else {
    const isLifetimeMember = membershipPayment?.hasLifetimeMembership === true;
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">
          Choose {seasonName ? `${seasonName} ` : ''}membership
        </h1>
        <p className="mt-3 text-gray-600">
          {isLifetimeMember
            ? 'Your lifetime membership applies to this registration.'
            : (membershipValidityLabel ?? 'Choose the membership for this curler.')}
        </p>
        <form onSubmit={saveMembership} className="mt-6 space-y-6">
          {isLifetimeMember ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Your Lifetime Membership has been applied. No membership or league fees will be charged for this
              registration.
            </p>
          ) : (
            <FormField label="Membership type" htmlFor={membershipInputId} required tone="public">
              <ChoiceInput
                inputId={membershipInputId}
                layout="block"
                value={membershipChoice}
                onChange={(value) => {
                  const next = (Array.isArray(value) ? value[0] : value) as
                    | 'regular'
                    | 'social'
                    | 'junior_recreational'
                    | 'none'
                    | null
                    | undefined;
                  const resolved = next ?? null;
                  const wasShowingParentAssociations = membershipAppliesParentAssociations(membershipChoice);
                  setMembershipChoice(resolved);
                  if (resolved != null && resolved !== 'none') {
                    noMembershipPathActiveRef.current = false;
                  }
                  if (membershipAppliesParentAssociations(resolved) && !wasShowingParentAssociations) {
                    setUsaCurlingMembershipOptIn(
                      membershipPayment?.selection.usaCurlingMembershipOptIn ??
                        defaultUsaCurlingMembershipOptIn(),
                    );
                    setUswcaMembershipOptIn(
                      membershipPayment?.selection.uswcaMembershipOptIn ??
                        defaultUswcaMembershipOptIn(demographics.preferredPronouns),
                    );
                  }
                }}
                options={membershipOptions}
              />
            </FormField>
          )}
          {!isLifetimeMember && membershipChoice === 'junior_recreational' ? (
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
          {shouldCollectParentAssociationOptIns(membershipChoice, isLifetimeMember) ? (
            <RegistrationParentAssociationFields
              usaCurlingOptIn={usaCurlingMembershipOptIn}
              uswcaOptIn={uswcaMembershipOptIn}
              onUsaCurlingChange={setUsaCurlingMembershipOptIn}
              onUswcaChange={setUswcaMembershipOptIn}
            />
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading || (!isLifetimeMember && membershipChoice == null)}>
              {isPriorityEdit ? 'Save and return' : 'Continue'}
            </Button>
          </div>
        </form>
      </RegistrationCard>
    );
    }
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
              discountsTouchedRef.current = true;
              setStudentDiscountClaimed(selected.includes('student'));
              setReciprocalDiscountClaimed(selected.includes('reciprocal'));
            }}
            options={discountChoiceOptions}
          />
          {studentDiscountClaimed ? (
            <FormField label="Institution of study" htmlFor="student-institution" required tone="public">
              <FieldInput
                id="student-institution"
                value={studentInstitution}
                onChange={(next) => {
                  discountsTouchedRef.current = true;
                  setStudentInstitution(next);
                }}
              />
            </FormField>
          ) : null}
          {reciprocalDiscountClaimed ? (
            <FormField label="Other curling club" htmlFor="reciprocal-club" required tone="public">
              <FieldInput
                id="reciprocal-club"
                value={reciprocalClubName}
                onChange={(next) => {
                  discountsTouchedRef.current = true;
                  setReciprocalClubName(next);
                }}
              />
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
    if (skipsIcePrivileges) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Continuing registration" description="Opening league selection." />
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
                value={icePrivilegesChoice}
                onChange={(raw) => {
                  setIcePrivilegesChoice((raw as IcePrivilegesChoice | null) ?? null);
                  setError('');
                }}
                options={[
                  {
                    value: 'league_play',
                    label: 'League play or instructional programs',
                    description: recommendSaturdayInstructional
                      ? 'Evening and weekend leagues. Includes Saturday Instructional and Junior Advanced Commitment programs.'
                      : 'Evening and weekend leagues and instructional programs.',
                  },
                  ...(!skipsIcePrivileges
                    ? [
                        {
                          value: 'basic_ice',
                          label: 'Basic ice privileges',
                          description: 'Sparing, practice, and daytime leagues.',
                        },
                      ]
                    : []),
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
  } else if (currentStep === 'league-priority-intro') {
    if (!leaguePayload && !error && (!isGuestLocal || Boolean(registeringCurlerDateOfBirth?.trim()))) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Loading registration" description="Checking which leagues are available." />
        </RegistrationCard>
      );
    } else if (
      leaguePayload &&
      !shouldShowLeaguePriorityIntro(leaguePayload.leagues, leagueEligibilityInput)
    ) {
      content = (
        <RegistrationCard>
          <RegistrationFlowHeader />
          <PublicStateCard title="Continuing registration" description="Opening league selection." />
        </RegistrationCard>
      );
    } else {
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">How league selection works</h1>
        <p className="mt-3 text-gray-600">
          {payload?.registration.returning_member_answer === 1
            ? 'Before you build your list, here is what the next step asks for and how protected return spots work.'
            : 'Before you build your list, here is what the next step asks for and how waitlists fill remaining spots.'}
        </p>
        <div className="mt-6">
          <LeaguePriorityIntroStep
            audience={payload?.registration.returning_member_answer === 1 ? 'returning' : 'new'}
            recommendSaturdayInstructional={recommendSaturdayInstructional}
            onContinue={() => {
              if (isPriorityEdit) {
                navigate('/registration/league-priority', { state: location.state });
                return;
              }
              navigate('/registration/league-priority');
            }}
          />
        </div>
      </RegistrationCard>
    );
    }
  } else if (currentStep === 'league-priority') {
    const sabbaticalOnly =
      membershipPayment?.selection.membershipOption === 'none' ||
      membershipPayment?.selection.membershipOption === 'social' ||
      membershipChoice === 'none' ||
      membershipChoice === 'social';
    content = (
      <RegistrationCard>
        <RegistrationFlowHeader />
        <h1 className="text-3xl font-bold text-[#121033]">
          {sabbaticalOnly ? 'Sabbaticals for this session' : 'Leagues you want to play'}
        </h1>
        <p className="mt-3 text-gray-600">
          {sabbaticalOnly
            ? 'You are not registering to play this session. For each eligible league, take or extend a sabbatical, or drop it. You can hold at most two sabbaticals.'
            : (membershipPayment?.icePrivilegesChoice ?? icePrivilegesChoice) === 'basic_ice'
              ? 'Basic ice privileges include sparing, practice, and free daytime leagues. List only those free leagues, and decide what to do with any paid leagues you played last session.'
              : 'Tell us how many leagues/instructional programs you want this session, then list them in the order you want them. We work down your list, so put the league you want most at the top.'}
        </p>
        <div className="mt-6">
          {error && !leaguePayload ? null : (
          <LeaguePriorityStep
            payload={leaguePayload}
            eligibility={leagueEligibilityInput}
            registeringCurler={{ id: registeringCurlerMemberId, name: registeringCurlerName }}
            saving={loading}
            continueLabel={isPriorityEdit ? 'Save and return' : 'Continue'}
            restrictToFreeLeagues={
              !sabbaticalOnly &&
              ((membershipPayment?.icePrivilegesChoice ?? icePrivilegesChoice) === 'basic_ice' ||
                membershipPayment?.selection.membershipOption === 'regular_spare_only')
            }
            sabbaticalOnly={sabbaticalOnly}
            registrationState={leaguePayload?.registrationState ?? windowState?.state}
            discountClaims={{
              studentDiscountClaimed:
                membershipPayment?.selection.studentDiscountClaimed ?? studentDiscountClaimed,
              reciprocalDiscountClaimed:
                membershipPayment?.selection.reciprocalDiscountClaimed ?? reciprocalDiscountClaimed,
              availableDiscounts: windowState?.availableDiscounts,
            }}
            onSave={(input) => saveLeaguePriorities(input, isPriorityEdit ? finishPriorityEdit : undefined)}
          />
          )}
        </div>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
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
                : membershipPayment?.selection.membershipOption === 'none'
                  ? 'None'
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
          {priorityReviewEntries.length > 0 ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <h2 className="font-semibold text-[#121033]">League priority list</h2>
              <div className="mt-2 space-y-2">
                {priorityReviewEntries.map((entry, index) => {
                  const rosterText = priorityRosterTextByLeagueId.get(entry.leagueId);
                  const league = priorityReviewLeagueById.get(entry.leagueId);
                  return (
                    <div key={entry.leagueId} className="rounded-xl bg-gray-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-gray-900">
                          {index + 1}. {leagueName(entry.leagueId)}
                        </p>
                        {shouldShowGuaranteeChip(entry.label) ? (
                          <span
                            className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary-teal shadow-sm"
                            aria-describedby={
                              isByotGuaranteedReturnCaveat(entry.label, league)
                                ? byotGuaranteedReturnFootnoteId(league, byotReturnCaveatIdPrefix)
                                : undefined
                            }
                          >
                            {guaranteeChipLabel(entry.label, league)}
                          </span>
                        ) : null}
                      </div>
                      {rosterText ? <p className="mt-1 text-gray-600">Team roster: {rosterText}</p> : null}
                    </div>
                  );
                })}
              </div>
              {byotReturnFootnotes.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {byotReturnFootnotes.map((footnote) => (
                    <p key={footnote.id} id={footnote.id} className="text-gray-600">
                      {footnote.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {priorLeagueDecisionSummary.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-gray-600">
                  {priorLeagueDecisionSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {leaguePayload?.basicIceFallbackInterest === true ? (
                <p className="mt-3 text-gray-600">
                  If none of these leagues can be placed, this curler asked to be offered basic ice privileges instead.
                </p>
              ) : null}
            </div>
          ) : priorLeagueDecisionSummary.length > 0 ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <h2 className="font-semibold text-[#121033]">Sabbaticals</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                {priorLeagueDecisionSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : membershipPayment?.selection.membershipOption === 'junior_recreational' ? (
            <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700">
              <span className="font-medium text-gray-900">League choices:</span> Junior Recreational skips normal league selection.
            </div>
          ) : null}
          {renderFeeSummary()}
          {reviewQuoteReady && membershipPayment ? (
            <>
              <p className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                {membershipPayment.paymentDecision.outcome === 'deferred_payment'
                  ? 'Payment is deferred. We will contact you when your registration is ready for payment.'
                  : membershipPayment.paymentDecision.outcome === 'no_payment_required'
                    ? 'No payment is required now.'
                    : membershipPayment.payLaterAvailable
                      ? `You can pay now, or choose Pay later to receive an invoice by email. All invoices must be paid ${membershipPayment.paymentDeadlineDisplay ?? 'before leagues begin'}.`
                      : 'Payment is due now to complete this registration.'}
              </p>
              {membershipPayment.paymentDecision.outcome === 'deferred_payment' &&
              membershipPayment.paymentDecision.deferralReasons.length > 0 ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
                  <h2 className="font-semibold">Why payment is deferred</h2>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {membershipPayment.paymentDecision.deferralReasons.map((reason) => (
                      <li key={reason}>{deferralReasonText(reason)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
          <FormField
            label="Comments for the Membership Committee"
            htmlFor={membershipCommitteeCommentsInputId}
            optional
            tone="public"
          >
            <textarea
              id={membershipCommitteeCommentsInputId}
              className="app-input min-h-24"
              value={membershipCommitteeComments}
              onChange={(event) => setMembershipCommitteeComments(event.target.value)}
              maxLength={2000}
            />
          </FormField>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={loading || !reviewQuoteReady || !membershipPayment} onClick={() => void submitRegistration()}>
              {reviewQuoteReady && membershipPayment?.paymentDecision.outcome === 'immediate_payment' ? 'Submit and pay' : 'Submit registration'}
            </Button>
            {isStaffCreate && reviewQuoteReady && membershipPayment?.paymentDecision.outcome !== 'no_payment_required' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={loading || !reviewQuoteReady || !membershipPayment}
                onClick={openStaffOfflinePayment}
              >
                Submit and record payment
              </Button>
            ) : null}
            {reviewQuoteReady && membershipPayment?.payLaterAvailable ? (
              <Button
                type="button"
                variant="secondary"
                disabled={loading || !reviewQuoteReady || !membershipPayment}
                onClick={openPayLaterConfirmation}
              >
                Pay later
              </Button>
            ) : null}
          </div>
        </div>
      </RegistrationCard>
    );
  } else if (currentStep === 'success') {
    const submittedPayLater = Boolean((location.state as { payLater?: boolean } | null)?.payLater);
    const isPaymentPending = paymentOrderToken ? isRegistrationPaymentPending(paymentStatus?.paymentStatus) : false;
    const showPaymentProcessingScreen = Boolean(paymentOrderToken && isPaymentPending && !showDetailedPaymentPending && !error);
    const title =
      paymentStatus?.paymentStatus === 'confirmed'
        ? 'Payment confirmed'
        : paymentStatus?.paymentStatus === 'payment_unapplied'
          ? 'Payment received'
          : paymentStatus?.paymentStatus === 'cancelled'
            ? 'Registration canceled'
            : paymentStatus?.paymentStatus === 'failed'
              ? 'Payment was not completed'
              : showPaymentProcessingScreen
                ? 'Confirming payment'
                : 'Registration submitted';
    const description = paymentOrderToken
      ? paymentStatus?.paymentStatus === 'confirmed'
        ? registrationPaymentConfirmedMessage()
        : paymentStatus?.paymentStatus === 'payment_unapplied'
          ? 'Your registration was canceled before checkout finished. Your payment was received but could not be applied to this registration. Please contact treasurer@trianglecurling.com for help with a refund.'
          : paymentStatus?.paymentStatus === 'cancelled'
            ? 'This registration was canceled. No payment was applied.'
            : paymentStatus?.paymentStatus === 'failed'
              ? registrationPaymentFailedMessage()
              : showPaymentProcessingScreen
                ? 'Processing your payment confirmation...'
                : registrationPaymentPendingMessage()
      : submittedPayLater
        ? 'Your registration has been submitted. Check your email for an invoice and payment link. You must pay by the deadline to secure your league selections.'
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
        <Link className="mt-6 inline-flex rounded-lg bg-primary-teal-solid px-4 py-2 text-sm font-medium text-white" to="/dashboard">
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
          className="mt-6 inline-flex rounded-lg bg-primary-teal-solid px-4 py-2 text-sm font-medium text-white"
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
      <RegistrationPayLaterConfirmationModal
        isOpen={payLaterConfirmationOpen}
        saving={confirmingPayLater || loading}
        paymentDeadlineDisplay={membershipPayment?.paymentDeadlineDisplay ?? 'before leagues begin'}
        error={payLaterConfirmationOpen ? error || null : null}
        onClose={() => {
          if (confirmingPayLater || loading) return;
          setPayLaterConfirmationOpen(false);
        }}
        onPayNow={() => {
          setPayLaterConfirmationOpen(false);
          void submitRegistration();
        }}
        onSubmitWithoutPayment={() => void confirmPayLaterSubmission()}
      />
      <RecordOfflinePaymentModal
        isOpen={offlinePaymentOpen}
        saving={loading}
        description="This submits the registration and marks the invoice as paid. Use this when payment was received by check, cash, or another offline method. No checkout link will be created."
        confirmText="Record payment and submit"
        confirmBusyText="Recording payment"
        error={offlinePaymentOpen ? error || null : null}
        onClose={() => {
          if (loading) return;
          setOfflinePaymentOpen(false);
        }}
        onSubmit={(note) => void submitStaffOfflinePayment(note)}
      />
    </PublicLayout>
  );
}
