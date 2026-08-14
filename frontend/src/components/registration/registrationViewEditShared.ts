import axios from 'axios';
import api, { getApiErrorMessage } from '../../utils/api';
import type {
  LeaguePrioritySavePayload,
  RegistrationLeagueCatalogPayload,
} from './leaguePriorityShared';

export {
  expectedByotRosterSize,
  MIN_PLAY_IN_ROSTER_SIZE,
} from '../../../../backend/src/registration/leaguePriorityRules';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type LeagueCatalogItem = {
  id: number;
  sessionId?: number | null;
  name: string;
  dayOfWeek?: number | null;
  /** Recurring draw times as `HH:MM`, earliest first. */
  drawTimes?: string[];
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
  isJuniorRecreational?: boolean;
  allowsSabbatical: boolean;
  discountEligible?: boolean;
};

export type IcePrivilegesChoice = 'none' | 'league_play' | 'basic_ice';

export type RegistrationPaymentDecision = {
  outcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required';
  deferralReasons?: string[];
};

export type RegistrationLeagueEvaluation = {
  paymentDecision: RegistrationPaymentDecision;
  feePreview: {
    totalDueMinor: number;
    estimatedMaximumTotalDueMinor?: number;
    blockingErrors?: Array<{ code?: string; message: string }>;
  };
  priorityValidation?: {
    blockingErrors: Array<{ code?: string; message: string }>;
    warnings: Array<{ code?: string; message: string }>;
  };
};

export function projectedWaitlistPosition(activeWaitlistEntryCount: number | null | undefined): number {
  return Math.max(1, (activeWaitlistEntryCount ?? 0) + 1);
}

export function waitlistEntryCountLabel(count: number): string {
  return count === 1 ? '1 entry on waitlist' : `${count} entries on waitlist`;
}

export function formatWaitlistPositionSuffix(input: {
  isExisting: boolean;
  position?: number | null;
  activeWaitlistEntryCount?: number | null;
}): string | null {
  if (input.isExisting && typeof input.position === 'number') {
    return `(position #${input.position})`;
  }
  if (typeof input.activeWaitlistEntryCount === 'number') {
    return `(position #${projectedWaitlistPosition(input.activeWaitlistEntryCount)})`;
  }
  return null;
}

export type RegistrationFeePreviewLineItem = {
  lineType: string;
  amountMinor: number;
  discountEligible: boolean;
  relatedLeagueId?: number;
};

export type RegistrationFeePreviewShape = {
  lineItems: RegistrationFeePreviewLineItem[];
  discountTotalMinor: number;
  totalDueMinor: number;
};

export function formatEstimatedTotalRange(floorMinor: number, ceilingMinor: number, formatCurrency: (amountMinor: number) => string): string {
  if (floorMinor === ceilingMinor) {
    return formatCurrency(floorMinor);
  }
  return `${formatCurrency(floorMinor)} – ${formatCurrency(ceilingMinor)}`;
}

export type ContinuingSabbaticalSummary = {
  sabbaticalId: number;
  leagueId: number;
  leagueName: string;
  priorLeagueId: number;
  firstSabbaticalStartDate: string;
  canExtend: boolean;
  extensionBlockedMessage: string | null;
  sabbaticalFeeMinor: number;
};

export type RegistrationPlayInEntryTeamMember = {
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
  priorityRank: number | null;
};

export type RegistrationPlayInCommittedOtherMemberTeam = {
  memberId: number;
  team: {
    id: number;
    name: string | null;
    members: Array<{
      memberId: number | null;
      memberName: string | null;
      pendingName: string | null;
    }>;
  };
};

/** Live play-in entry evaluation for one play-in based league, keyed by league id in the payload. */
export type RegistrationPlayInEntrySummary = {
  leagueId: number;
  autoEntryCount: number;
  playInSpotCount: number;
  teamSize: number;
  onExistingTeam: boolean;
  existingTeam: {
    id: number;
    name: string | null;
    createdByName: string | null;
    members: RegistrationPlayInEntryTeamMember[];
  } | null;
  committedOtherMemberIds: number[];
  /** Active entry team roster for each member already committed to another team. */
  committedOtherMemberTeams?: RegistrationPlayInCommittedOtherMemberTeam[];
  teamTotalPoints: number | null;
  meetsReturningRule: boolean | null;
  guaranteed: boolean;
  guaranteeThresholdPoints: number | null;
};

export type RegistrationMembershipPaymentPayload = {
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
  hasLifetimeMembership?: boolean;
  feePreview?: {
    totalDueMinor: number;
  };
  paymentDecision?: RegistrationPaymentDecision;
  paymentDeadlineAt?: string | null;
  paymentDeadlineDisplay?: string | null;
  payLaterAvailable?: boolean;
};

export const REGISTRATION_IMMEDIATE_PAYMENT_CONFIRMATION_MESSAGE =
  'After making these changes to your registration, your league placements no longer rely on waitlists, so payment can be taken immediately. Click continue to proceed to checkout. Your registration updates will be confirmed after payment is received.';

export function registrationWasPaymentDeferred(input: {
  registrationStatus?: string | null;
  paymentStatus?: string | null;
}): boolean {
  if (input.paymentStatus === 'deferred') return true;
  return ['awaiting_placement', 'awaiting_staff_review', 'awaiting_payment'].includes(input.registrationStatus ?? '');
}

export function requiresImmediatePaymentConfirmation(
  wasPaymentDeferred: boolean,
  paymentDecision: RegistrationPaymentDecision | undefined,
): boolean {
  return wasPaymentDeferred && paymentDecision?.outcome === 'immediate_payment';
}

export type RegistrationPaymentAdjustmentResult = {
  kind: 'none' | 'refund' | 'balance_due';
  priorPaidMinor: number;
  newTotalMinor: number;
  adjustmentMinor: number;
  refundIssued?: boolean;
  refundError?: string | null;
  checkoutUrl?: string | null;
};

export type SubmitRegistrationEditsResult = {
  checkoutUrl?: string;
  requiresCheckoutConfirmation?: boolean;
  message?: string;
  totalDueMinor?: number;
  payLater?: boolean;
  paymentAdjustment?: RegistrationPaymentAdjustmentResult;
};

export type RegistrationWindow = {
  state: 'closed' | 'priority' | 'open';
  season: { id: number; name: string; startDate?: string; endDate?: string };
  session: { id: number; name: string; startDate?: string; endDate?: string };
  availableDiscounts?: {
    student: { amountType: 'dollar' | 'percent'; value: number };
    reciprocal: { amountType: 'dollar' | 'percent'; value: number };
  };
  membershipFees?: {
    regularMinor: number;
    socialMinor: number;
    juniorRecreationalMinor: number;
    sabbaticalMinor: number;
    replacementNameTagMinor?: number;
  };
};

export type RegistrationShellCurler = {
  id: number;
  name: string;
  dateOfBirth: string | null;
};

export function isPlayInBasedLeague(league: Pick<LeagueCatalogItem, 'isPlayInBased'>): boolean {
  return league.isPlayInBased === true;
}
export function formatRegistrationDisplayDate(dateString: string): string {
  const date = new Date(`${dateString.slice(0, 10)}T12:00:00`);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [month, ...rest] = formatted.split(' ');
  if (!month || rest.length === 0) return formatted;
  return `${month}. ${rest.join(' ')}`;
}

export function continuingSabbaticalForLeague(
  payload: Pick<RegistrationLeagueCatalogPayload, 'continuingSabbaticals'> | null | undefined,
  leagueId: number,
): ContinuingSabbaticalSummary | undefined {
  return payload?.continuingSabbaticals?.find((entry) => entry.leagueId === leagueId);
}

export function formatLeagueDrawTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time.trim();
  const hour = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(hour)) return time.trim();
  const minutes = match[2] ?? '00';
  const period = hour >= 12 ? 'pm' : 'am';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes}${period}`;
}

export function leagueScheduleText(
  league: Pick<LeagueCatalogItem, 'dayOfWeek' | 'drawTimes'>,
): string {
  const day =
    typeof league.dayOfWeek === 'number' ? (DAY_NAMES[league.dayOfWeek] ?? null) : null;
  const times = (league.drawTimes ?? [])
    .map((time) => formatLeagueDrawTime(time))
    .filter((time) => time.length > 0);
  const timeText =
    times.length === 0
      ? ''
      : times.length === 1
        ? (times[0] ?? '')
        : times.length === 2
          ? `${times[0]} and ${times[1]}`
          : `${times.slice(0, -1).join(', ')}, and ${times[times.length - 1]}`;
  if (day && timeText) return `${day} ${timeText}`;
  if (day) return day;
  if (timeText) return timeText;
  return 'Schedule not configured';
}

export function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountMinor / 100);
}

export function formatRegistrationDiscountOffPhrase(slot: { amountType: 'dollar' | 'percent'; value: number }): string {
  if (slot.amountType === 'percent') return `${slot.value}% off`;
  return `${formatCurrency(Math.round(slot.value * 100))} off`;
}

export function registrationDiscountLabel(
  baseLabel: string,
  slot: { amountType: 'dollar' | 'percent'; value: number } | undefined,
): string {
  if (!slot) return baseLabel;
  return `${baseLabel} (${formatRegistrationDiscountOffPhrase(slot)})`;
}

export function hasClubExperienceRecord(knownExperienceYears: number | undefined | null): boolean {
  return (knownExperienceYears ?? 0) > 0;
}

function ageFromDateOfBirth(dateOfBirth: string): number | null {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function isJuniorRecreationalEligibleDate(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const age = ageFromDateOfBirth(dateOfBirth);
  return age !== null && age <= 21;
}

function leagueFirstDay(league: Pick<LeagueCatalogItem, 'firstDayOfPlay' | 'startDate'>): string {
  return league.firstDayOfPlay ?? league.startDate ?? '';
}

function ageOnDate(dateOfBirth: string, targetDate: string): number {
  const birth = dateOfBirth.slice(0, 10);
  const target = targetDate.slice(0, 10);
  let age = Number(target.slice(0, 4)) - Number(birth.slice(0, 4));
  if (target.slice(5) < birth.slice(5)) {
    age -= 1;
  }
  return age;
}

export function ageOnLeagueStart(
  dateOfBirth: string | null | undefined,
  league: Pick<LeagueCatalogItem, 'firstDayOfPlay' | 'startDate'>,
): number | null {
  const firstDay = leagueFirstDay(league);
  if (!dateOfBirth || !firstDay) return null;
  return ageOnDate(dateOfBirth, firstDay);
}

export type LeagueEligibilityInput = {
  dateOfBirth: string | null | undefined;
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceSelfReportedYears?: number | null;
  knownExperienceYears?: number;
  membershipOption?: 'regular' | 'regular_spare_only' | 'social' | 'junior_recreational' | 'none' | null;
};

function leagueMinimumAgeConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

function leagueMaximumAgeConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

function leagueMinimumExperienceConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

function leagueMaximumExperienceConstraint(value: number | null | undefined): number | null {
  if (value == null || value <= 0) return null;
  return value;
}

function isLeagueAgeEligibleForCurler(
  league: Pick<LeagueCatalogItem, 'minAge' | 'maxAge' | 'firstDayOfPlay' | 'startDate'>,
  dateOfBirth: string | null | undefined,
): boolean {
  if (!dateOfBirth) return true;
  const age = ageOnLeagueStart(dateOfBirth, league);
  if (age === null) return true;
  const minimumAge = leagueMinimumAgeConstraint(league.minAge);
  const maximumAge = leagueMaximumAgeConstraint(league.maxAge);
  if (minimumAge != null && age < minimumAge) return false;
  if (maximumAge != null && age > maximumAge) return false;
  return true;
}

function effectiveExperienceYears(input: LeagueEligibilityInput): number {
  if (input.experienceType === 'specified_years') {
    return Math.max(0, input.experienceSelfReportedYears ?? 0);
  }
  if (input.experienceType === 'known_existing') {
    return Math.max(0, input.knownExperienceYears ?? 0);
  }
  return 0;
}

export function isLeagueSelectionEligibleLeague(league: LeagueCatalogItem, input: LeagueEligibilityInput): boolean {
  if (league.isJuniorRecreational === true) {
    return false;
  }
  if (input.membershipOption === 'junior_recreational' || input.membershipOption === 'social') {
    return false;
  }
  if (!isLeagueAgeEligibleForCurler(league, input.dateOfBirth)) {
    return false;
  }
  const experienceYears = effectiveExperienceYears(input);
  const requiredExperience = leagueMinimumExperienceConstraint(league.minExperienceYears);
  const maximumExperience = leagueMaximumExperienceConstraint(league.maxExperienceYears);
  if (requiredExperience != null && experienceYears < requiredExperience) {
    return false;
  }
  if (maximumExperience != null && experienceYears > maximumExperience) {
    return false;
  }
  if (input.experienceType === 'none_or_minimal' && league.format !== 'instructional' && requiredExperience != null) {
    return false;
  }
  return true;
}
export function isBasicIceIncludedDaytimeLeague(league: LeagueCatalogItem): boolean {
  return (
    league.registrationFeeMinor === 0 &&
    !league.allowsWaitlist &&
    league.isPlayInBased !== true &&
    league.leagueType !== 'bring_your_own_team' &&
    league.format !== 'instructional'
  );
}
export function rosterEntries(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function rosterTextDisplay(text: string | null | undefined): string {
  return rosterEntries(text).join(', ');
}

function rosterFirstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export function sortRosterNamesByFirstName(names: string[]): string[] {
  return [...names].sort((left, right) =>
    rosterFirstName(left).localeCompare(rosterFirstName(right), undefined, { sensitivity: 'base' }),
  );
}

/** "A and B" for two names; "A, B, C, and D" for larger teams. */
export function formatTeamRosterHeadline(text: string | null | undefined): string | null {
  const names = sortRosterNamesByFirstName(rosterEntries(text));
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')}, and ${last}`;
}
export function editValidationErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const details = error.response?.data?.details;
    if (details && typeof details === 'object') {
      const messages = Object.values(details as Record<string, unknown>)
        .flatMap((value) => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (messages.length > 0) return messages.join(' ');
    }
  }
  return getApiErrorMessage(error, fallback);
}

export async function loadRegistrationEditContext(
  registrationId: number,
  windowQuery?: { seasonId: number; sessionId: number },
) {
  const [membershipResponse, leagueResponse, windowResponse, shellResponse] = await Promise.all([
    api.get<RegistrationMembershipPaymentPayload>(`/registration/drafts/${registrationId}/membership-payment`),
    api.get<RegistrationLeagueCatalogPayload>(`/registration/drafts/${registrationId}/league-catalog`),
    api.get<RegistrationWindow>('/registration/window', { params: windowQuery }),
    api.get<{ curler: RegistrationShellCurler | null }>(`/registration/drafts/${registrationId}`),
  ]);
  return {
    membership: membershipResponse.data,
    league: leagueResponse.data,
    window: windowResponse.data,
    curler: shellResponse.data.curler,
  };
}

export async function loadMembershipEditContext(registrationId: number) {
  const [membershipResponse, windowResponse, shellResponse] = await Promise.all([
    api.get<RegistrationMembershipPaymentPayload>(`/registration/drafts/${registrationId}/membership-payment`),
    api.get<RegistrationWindow>('/registration/window'),
    api.get<{ curler: RegistrationShellCurler | null }>(`/registration/drafts/${registrationId}`),
  ]);
  return {
    membership: membershipResponse.data,
    window: windowResponse.data,
    curler: shellResponse.data.curler,
  };
}

export async function submitRegistrationEdits(
  registrationId: number,
  options?: {
    confirmImmediatePayment?: boolean;
    payLater?: boolean;
    membershipCommitteeComments?: string | null;
  },
): Promise<SubmitRegistrationEditsResult> {
  const response = await api.post<{
    outcome: string;
    checkoutUrl?: string;
    requiresCheckoutConfirmation?: boolean;
    message?: string;
    totalDueMinor?: number;
    payLater?: boolean;
    paymentAdjustment?: RegistrationPaymentAdjustmentResult;
  }>(`/registration/drafts/${registrationId}/submit`, {
    confirmImmediatePayment: options?.confirmImmediatePayment ?? false,
    payLater: options?.payLater ?? false,
    membershipCommitteeComments: options?.membershipCommitteeComments,
  });
  return {
    checkoutUrl: response.data.checkoutUrl,
    requiresCheckoutConfirmation: response.data.requiresCheckoutConfirmation,
    message: response.data.message,
    totalDueMinor: response.data.totalDueMinor,
    payLater: response.data.payLater,
    paymentAdjustment: response.data.paymentAdjustment,
  };
}

export async function submitStaffRegistrationEdits(
  registrationId: number,
  options?: { confirmImmediatePayment?: boolean; changedSummary?: string },
): Promise<SubmitRegistrationEditsResult> {
  const response = await api.post<{
    outcome: string;
    checkoutUrl?: string;
    requiresCheckoutConfirmation?: boolean;
    message?: string;
    totalDueMinor?: number;
    paymentAdjustment?: RegistrationPaymentAdjustmentResult;
  }>(`/registration/staff/registrations/${registrationId}/submit`, {
    confirmImmediatePayment: options?.confirmImmediatePayment ?? false,
    changedSummary: options?.changedSummary,
  });
  return {
    checkoutUrl: response.data.checkoutUrl,
    requiresCheckoutConfirmation: response.data.requiresCheckoutConfirmation,
    message: response.data.message,
    totalDueMinor: response.data.totalDueMinor,
    paymentAdjustment: response.data.paymentAdjustment,
  };
}

export async function saveLeaguePriorities(registrationId: number, input: LeaguePrioritySavePayload) {
  const response = await api.put<RegistrationLeagueCatalogPayload>(
    `/registration/drafts/${registrationId}/league-priorities`,
    input,
  );
  return response.data;
}
