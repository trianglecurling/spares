import axios from 'axios';
import api, { getApiErrorMessage } from '../../utils/api';
import {
  syncPlacementsWithMembers,
  toPlacementPayload,
  type WaitlistTeamMemberPlacement,
  type WaitlistTeamMemberPlacementOptions,
} from '../waitlists/waitlistTeamRosterShared';

export type RegistrationSelectionType =
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

export type RegistrationTeamRosterPlacementInput = {
  memberId: number;
  entryType: 'add' | 'replace';
  replacesLeagueId?: number | null;
};

export type RegistrationSelectionInput = {
  selectionType: RegistrationSelectionType;
  leagueId?: number | null;
  rank?: number | null;
  replacesLeagueId?: number | null;
  byotTeammateText?: string | null;
  teamRosterPlacements?: RegistrationTeamRosterPlacementInput[] | null;
  isTemporarySabbaticalFill?: boolean;
};

export type LeagueCatalogItem = {
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

export type IcePrivilegesChoice = 'none' | 'league_play' | 'basic_ice';

export type RegistrationPaymentDecision = {
  outcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required';
  deferralReasons?: string[];
};

export type RegistrationLeagueEvaluation = {
  paymentDecision: RegistrationPaymentDecision;
  feePreview: {
    totalDueMinor: number;
  };
};

const ADD_WAITLIST_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'waitlist_add',
  'waitlist_add_auto_decline',
  'waitlist_keep_auto_accept',
]);

const SCHEDULED_FIRST_TWO_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'play_in_request',
]);

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

export function waitlistJoinOptionDescription(
  league: Pick<LeagueCatalogItem, 'activeWaitlistEntryCount'>,
  scheduleText?: string | null,
): string {
  const parts = [scheduleText?.trim(), waitlistEntryCountLabel(league.activeWaitlistEntryCount ?? 0)].filter(Boolean);
  return parts.join(' · ');
}

export function isAddWaitlistSelectionType(selectionType: RegistrationSelectionType): boolean {
  return ADD_WAITLIST_SELECTION_TYPES.has(selectionType);
}

export function getAddWaitlistSelections(selections: RegistrationSelectionInput[]): RegistrationSelectionInput[] {
  return selections.filter((selection) => selection.leagueId != null && isAddWaitlistSelectionType(selection.selectionType));
}

export function countFirstTwoLeagueSlots(activeLeagueIds: number[], selections: RegistrationSelectionInput[]): number {
  const scheduledCount = selections.filter((selection) => SCHEDULED_FIRST_TWO_SELECTION_TYPES.has(selection.selectionType)).length;
  return activeLeagueIds.length + scheduledCount;
}

export function remainingFirstTwoLeagueSlots(activeLeagueIds: number[], selections: RegistrationSelectionInput[]): number {
  return Math.max(0, 2 - countFirstTwoLeagueSlots(activeLeagueIds, selections));
}

export function requiresWaitlistFulfillmentPreferences(selections: RegistrationSelectionInput[]): boolean {
  return getAddWaitlistSelections(selections).length >= 2;
}

export type RegistrationLeagueFlowStep =
  | '/registration/league-requests'
  | '/registration/basic-ice-fallback'
  | '/registration/third-league-interest'
  | '/registration/league-summary';

export function shouldCollectBasicIceFallback(
  selections: RegistrationSelectionInput[],
  isBasicIceLeagueSelection: boolean,
): boolean {
  if (isBasicIceLeagueSelection) return false;
  return selections.filter((selection) => selection.selectionType === 'guaranteed_return').length === 0;
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

const CEILING_LEAGUE_FEE_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'return_subject_to_availability',
  'waitlist_add',
  'waitlist_replace',
  'waitlist_add_auto_decline',
  'waitlist_replace_auto_decline',
  'waitlist_keep_auto_accept',
  'waitlist_keep_auto_decline',
  'third_league_interest',
  'byot_request',
  'play_in_request',
  'instructional_join',
]);

/** League choices treated as confirmed for the estimated-total floor. */
const FLOOR_LEAGUE_FEE_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
]);

export function maxPossibleLeagueCount(
  activeLeagueIds: number[],
  selections: RegistrationSelectionInput[],
  desiredAddWaitlistLeagueCount: number | null,
): number {
  if (shouldCollectThirdLeagueInterest(selections, desiredAddWaitlistLeagueCount)) {
    return 3;
  }
  const scheduled = countFirstTwoLeagueSlots(activeLeagueIds, selections);
  const remaining = remainingFirstTwoLeagueSlots(activeLeagueIds, selections);
  const addWaitlistCount = getAddWaitlistSelections(selections).length;
  let additionalFromWaitlists = 0;
  if (addWaitlistCount > 0 && remaining > 0) {
    additionalFromWaitlists =
      addWaitlistCount >= 2
        ? Math.min(remaining, desiredAddWaitlistLeagueCount ?? Math.min(remaining, 2))
        : Math.min(remaining, 1);
  }
  return Math.min(2, scheduled + additionalFromWaitlists);
}

function discountEligibleSubtotalMinor(lineItems: RegistrationFeePreviewLineItem[]): number {
  return lineItems.reduce((sum, lineItem) => (lineItem.discountEligible ? sum + lineItem.amountMinor : sum), 0);
}

function scaledDiscountTotalMinor(
  feePreview: RegistrationFeePreviewShape,
  proposedDiscountEligibleMinor: number,
): number {
  const originalEligible = discountEligibleSubtotalMinor(feePreview.lineItems);
  if (originalEligible <= 0 || proposedDiscountEligibleMinor <= 0 || feePreview.discountTotalMinor <= 0) {
    return 0;
  }
  return Math.min(
    feePreview.discountTotalMinor,
    Math.round((feePreview.discountTotalMinor * proposedDiscountEligibleMinor) / originalEligible),
  );
}

function totalAfterDiscounts(subtotalMinor: number, discountEligibleMinor: number, feePreview: RegistrationFeePreviewShape): number {
  const discountTotal = scaledDiscountTotalMinor(feePreview, discountEligibleMinor);
  return Math.max(0, subtotalMinor - discountTotal);
}

function countConfirmedLeagueFeeSelections(selections: RegistrationSelectionInput[]): number {
  return selections.filter(
    (selection) => selection.leagueId != null && FLOOR_LEAGUE_FEE_SELECTION_TYPES.has(selection.selectionType),
  ).length;
}

function topLeagueFeesMinor(
  leagues: LeagueCatalogItem[],
  selections: RegistrationSelectionInput[],
  maxLeagues: number,
  eligibleSelectionTypes: Set<RegistrationSelectionType> = CEILING_LEAGUE_FEE_SELECTION_TYPES,
): { totalMinor: number; discountEligibleMinor: number } {
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const rankedFees = selections
    .filter(
      (selection) =>
        selection.leagueId != null && eligibleSelectionTypes.has(selection.selectionType),
    )
    .map((selection) => {
      const league = leagueById.get(selection.leagueId as number);
      const amountMinor = league?.registrationFeeMinor ?? 0;
      return {
        amountMinor,
        discountEligible: league?.discountEligible !== false,
      };
    })
    .filter((entry) => entry.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, maxLeagues);

  return {
    totalMinor: rankedFees.reduce((sum, entry) => sum + entry.amountMinor, 0),
    discountEligibleMinor: rankedFees.reduce(
      (sum, entry) => (entry.discountEligible ? sum + entry.amountMinor : sum),
      0,
    ),
  };
}

export function shouldShowEstimatedTotalRange(
  paymentOutcome: 'immediate_payment' | 'deferred_payment' | 'no_payment_required',
): boolean {
  return paymentOutcome === 'deferred_payment';
}

export function calculateEstimatedTotalRange(input: {
  feePreview: RegistrationFeePreviewShape;
  leagues: LeagueCatalogItem[];
  activeLeagueIds: number[];
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
  basicIceFallbackInterest: boolean | null;
  spareOnlyIcePrivilegeFeeMinor?: number;
}): { floorMinor: number; ceilingMinor: number } {
  const nonLeagueLineItems = input.feePreview.lineItems.filter((lineItem) => lineItem.lineType !== 'league_fee');
  const nonLeagueSubtotalMinor = nonLeagueLineItems.reduce((sum, lineItem) => sum + lineItem.amountMinor, 0);
  const nonLeagueDiscountEligibleMinor = discountEligibleSubtotalMinor(nonLeagueLineItems);

  const maxLeagues = maxPossibleLeagueCount(
    input.activeLeagueIds,
    input.selections,
    input.desiredAddWaitlistLeagueCount,
  );
  const leagueCeiling = topLeagueFeesMinor(input.leagues, input.selections, maxLeagues);

  const ceilingSubtotalMinor = nonLeagueSubtotalMinor + leagueCeiling.totalMinor;
  const ceilingDiscountEligibleMinor = nonLeagueDiscountEligibleMinor + leagueCeiling.discountEligibleMinor;
  const ceilingMinor = totalAfterDiscounts(ceilingSubtotalMinor, ceilingDiscountEligibleMinor, input.feePreview);

  if (input.basicIceFallbackInterest === true) {
    const floorLineItems = nonLeagueLineItems.filter((lineItem) =>
      ['regular_membership_fee', 'spare_only_fee'].includes(lineItem.lineType),
    );
    let floorSubtotalMinor = floorLineItems.reduce((sum, lineItem) => sum + lineItem.amountMinor, 0);
    let floorDiscountEligibleMinor = discountEligibleSubtotalMinor(floorLineItems);
    const hasSpareOnlyLine = floorLineItems.some((lineItem) => lineItem.lineType === 'spare_only_fee');
    const spareOnlyFeeMinor = input.spareOnlyIcePrivilegeFeeMinor ?? 0;
    if (!hasSpareOnlyLine && spareOnlyFeeMinor > 0) {
      floorSubtotalMinor += spareOnlyFeeMinor;
      floorDiscountEligibleMinor += spareOnlyFeeMinor;
    }
    const floorMinor = totalAfterDiscounts(floorSubtotalMinor, floorDiscountEligibleMinor, input.feePreview);
    return { floorMinor, ceilingMinor };
  }

  const confirmedLeagueCount = countConfirmedLeagueFeeSelections(input.selections);
  if (confirmedLeagueCount > 0) {
    const leagueFloor = topLeagueFeesMinor(
      input.leagues,
      input.selections,
      confirmedLeagueCount,
      FLOOR_LEAGUE_FEE_SELECTION_TYPES,
    );
    const floorSubtotalMinor = nonLeagueSubtotalMinor + leagueFloor.totalMinor;
    const floorDiscountEligibleMinor = nonLeagueDiscountEligibleMinor + leagueFloor.discountEligibleMinor;
    const floorMinor = totalAfterDiscounts(floorSubtotalMinor, floorDiscountEligibleMinor, input.feePreview);
    return { floorMinor, ceilingMinor };
  }

  return { floorMinor: 0, ceilingMinor };
}

export function formatEstimatedTotalRange(floorMinor: number, ceilingMinor: number, formatCurrency: (amountMinor: number) => string): string {
  if (floorMinor === ceilingMinor) {
    return formatCurrency(floorMinor);
  }
  return `${formatCurrency(floorMinor)} – ${formatCurrency(ceilingMinor)}`;
}

export function shouldCollectThirdLeagueInterest(
  selections: RegistrationSelectionInput[],
  desiredAddWaitlistLeagueCount: number | null,
): boolean {
  const guaranteedReturnCount = selections.filter((selection) => selection.selectionType === 'guaranteed_return').length;
  const addWaitlistCount = getAddWaitlistSelections(selections).length;

  if (guaranteedReturnCount >= 2) return true;
  if (guaranteedReturnCount === 1 && addWaitlistCount >= 1) return true;
  if (guaranteedReturnCount === 0 && addWaitlistCount >= 2 && desiredAddWaitlistLeagueCount === 2) return true;
  return false;
}

export function stripThirdLeagueInterestSelections(selections: RegistrationSelectionInput[]): RegistrationSelectionInput[] {
  return selections.filter((selection) => selection.selectionType !== 'third_league_interest');
}

export function leagueSelectionsForSave(
  selections: RegistrationSelectionInput[],
  desiredAddWaitlistLeagueCount: number | null,
): RegistrationSelectionInput[] {
  if (shouldCollectThirdLeagueInterest(selections, desiredAddWaitlistLeagueCount)) {
    return selections;
  }
  return stripThirdLeagueInterestSelections(selections);
}

function nextLeagueFlowStepAfterIntermediateSteps(input: {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
  isBasicIceLeagueSelection: boolean;
}): '/registration/basic-ice-fallback' | '/registration/third-league-interest' | '/registration/league-summary' {
  if (shouldCollectThirdLeagueInterest(input.selections, input.desiredAddWaitlistLeagueCount)) {
    return '/registration/third-league-interest';
  }
  if (shouldCollectBasicIceFallback(input.selections, input.isBasicIceLeagueSelection)) {
    return '/registration/basic-ice-fallback';
  }
  return '/registration/league-summary';
}

export function nextLeagueFlowStepAfterPriorLeagueSelection(input: {
  hasDirectLeagueRequests: boolean;
}): '/registration/league-requests' | '/registration/league-selection' {
  if (input.hasDirectLeagueRequests) return '/registration/league-requests';
  return '/registration/league-selection';
}

export function nextLeagueFlowStepAfterSelections(input: {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
  isBasicIceLeagueSelection: boolean;
}): RegistrationLeagueFlowStep {
  return nextLeagueFlowStepAfterIntermediateSteps(input);
}

export function nextLeagueFlowStepAfterLeagueRequests(): '/registration/league-selection' {
  return '/registration/league-selection';
}

export function nextLeagueFlowStepAfterThirdLeagueInterest(input: {
  selections: RegistrationSelectionInput[];
  isBasicIceLeagueSelection: boolean;
}): '/registration/basic-ice-fallback' | '/registration/league-summary' {
  if (shouldCollectBasicIceFallback(input.selections, input.isBasicIceLeagueSelection)) {
    return '/registration/basic-ice-fallback';
  }
  return '/registration/league-summary';
}

export function previousLeagueFlowStepBeforeSummary(input: {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
  isBasicIceLeagueSelection: boolean;
}): '/registration/league-selection' | '/registration/basic-ice-fallback' | '/registration/third-league-interest' {
  if (input.isBasicIceLeagueSelection) return '/registration/league-selection';
  if (shouldCollectBasicIceFallback(input.selections, input.isBasicIceLeagueSelection)) {
    return '/registration/basic-ice-fallback';
  }
  if (shouldCollectThirdLeagueInterest(input.selections, input.desiredAddWaitlistLeagueCount)) {
    return '/registration/third-league-interest';
  }
  return '/registration/league-selection';
}

export function previousLeagueFlowStepBeforeThirdLeagueInterest(): '/registration/league-selection' {
  return '/registration/league-selection';
}

export function previousLeagueFlowStepBeforeBasicIceFallback(input: {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
}): '/registration/league-selection' | '/registration/third-league-interest' {
  if (shouldCollectThirdLeagueInterest(input.selections, input.desiredAddWaitlistLeagueCount)) {
    return '/registration/third-league-interest';
  }
  return '/registration/league-selection';
}

export function defaultDesiredAddWaitlistLeagueCount(
  activeLeagueIds: number[],
  selections: RegistrationSelectionInput[],
): number | null {
  if (!requiresWaitlistFulfillmentPreferences(selections)) return null;
  const remaining = remainingFirstTwoLeagueSlots(activeLeagueIds, selections);
  if (remaining <= 0) return null;
  return Math.min(remaining, 2);
}

export function addWaitlistPriorityFromSelections(selections: RegistrationSelectionInput[]): number[] {
  return getAddWaitlistSelections(selections)
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((selection) => selection.leagueId as number);
}

export function applyAddWaitlistPriorityOrder(
  selections: RegistrationSelectionInput[],
  priorityLeagueIds: number[],
): RegistrationSelectionInput[] {
  const rankByLeagueId = new Map(priorityLeagueIds.map((leagueId, index) => [leagueId, index + 1] as const));
  return selections.map((selection) => {
    if (!isAddWaitlistSelectionType(selection.selectionType) || selection.leagueId == null) return selection;
    const rank = rankByLeagueId.get(selection.leagueId);
    return rank != null ? { ...selection, rank } : selection;
  });
}

export function moveAddWaitlistPriority(
  priorityLeagueIds: number[],
  leagueId: number,
  direction: 'up' | 'down',
): number[] {
  const index = priorityLeagueIds.indexOf(leagueId);
  if (index < 0) return priorityLeagueIds;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= priorityLeagueIds.length) return priorityLeagueIds;
  const next = [...priorityLeagueIds];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next;
}

export function waitlistFulfillmentSummaryText(input: {
  desiredAddWaitlistLeagueCount: number | null | undefined;
  priorityLeagueIds: number[];
  leagueName: (leagueId: number) => string;
  remainingFirstTwoSlots: number;
}): string | null {
  if (input.priorityLeagueIds.length < 2) return null;
  const priorityText = input.priorityLeagueIds
    .map((leagueId, index) => `${index + 1}. ${input.leagueName(leagueId)}`)
    .join(' · ');
  if (input.remainingFirstTwoSlots <= 1) {
    return `If multiple waitlist spots open, we will use this order to choose your second league: ${priorityText}.`;
  }
  const count = input.desiredAddWaitlistLeagueCount ?? Math.min(2, input.remainingFirstTwoSlots);
  return `If multiple waitlist spots open, place this curler in up to ${count} ${count === 1 ? 'league' : 'leagues'} using this priority order: ${priorityText}.`;
}

export type RegistrationLeagueSelectionPayload = {
  leagues: LeagueCatalogItem[];
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  desiredAddWaitlistLeagueCount?: number | null;
  existingWaitlistEntries?: Array<{
    waitlistId: number;
    leagueId: number;
    entryType: 'add' | 'replace';
    replacesLeagueId?: number | null;
    status: string;
    position?: number | null;
    queueTotal?: number | null;
    declineCount?: number | null;
  }>;
  evaluation?: RegistrationLeagueEvaluation;
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
  };
  icePrivilegesChoice: IcePrivilegesChoice;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  feePreview?: {
    totalDueMinor: number;
  };
  paymentDecision?: RegistrationPaymentDecision;
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
  paymentAdjustment?: RegistrationPaymentAdjustmentResult;
};

export type RegistrationWindow = {
  state: 'closed' | 'priority' | 'open';
  season: { id: number; name: string };
  session: { id: number; name: string };
  availableDiscounts?: {
    student: { amountType: 'dollar' | 'percent'; value: number };
    reciprocal: { amountType: 'dollar' | 'percent'; value: number };
  };
};

export type RegistrationShellCurler = {
  id: number;
  name: string;
  dateOfBirth: string | null;
};

export const REAL_LEAGUE_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'return_subject_to_availability',
  'third_league_interest',
  'waitlist_add',
  'waitlist_replace',
  'byot_request',
  'play_in_request',
  'instructional_join',
]);

export const PROTECTED_RETURN_SELECTION_TYPES = new Set<RegistrationSelectionType>(['guaranteed_return', 'sabbatical']);

const CONFIRMED_LEAGUE_PLACEMENT_STATUSES = new Set(['confirmed', 'placed']);

export const CONFIRMED_LEAGUE_PLACEMENT_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'instructional_join',
]);

export function isConfirmedLeaguePlacement(selection: {
  selectionType: RegistrationSelectionType | string;
  status: string;
}): boolean {
  return (
    CONFIRMED_LEAGUE_PLACEMENT_SELECTION_TYPES.has(selection.selectionType as RegistrationSelectionType) &&
    CONFIRMED_LEAGUE_PLACEMENT_STATUSES.has(selection.status)
  );
}

const NON_GUARANTEED_LEAGUE_INTEREST_TYPES = new Set<RegistrationSelectionType>([
  'third_league_interest',
  'return_subject_to_availability',
]);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isThirdLeagueInterestSelection(selection: RegistrationSelectionInput): boolean {
  return NON_GUARANTEED_LEAGUE_INTEREST_TYPES.has(selection.selectionType);
}

export function priorLeagueChoiceValue(selection: RegistrationSelectionInput | undefined): RegistrationSelectionType | null {
  if (!selection) return null;
  if (selection.selectionType === 'third_league_interest') return 'return_subject_to_availability';
  return selection.selectionType;
}

export function leagueScheduleText(league: Pick<LeagueCatalogItem, 'dayOfWeek'>): string {
  if (typeof league.dayOfWeek !== 'number') return 'Schedule not configured';
  return DAY_NAMES[league.dayOfWeek] ?? 'Schedule not configured';
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

export function isThirdLeagueInterestEligibleLeague(league: LeagueCatalogItem, input: LeagueEligibilityInput): boolean {
  if (league.leagueType === 'bring_your_own_team') return false;
  if (league.format === 'instructional') return false;
  return isLeagueSelectionEligibleLeague(league, input);
}

export function isDirectLeagueRequestLeague(league: LeagueCatalogItem): boolean {
  if (league.isPlayInBased === true) return true;
  return !league.allowsWaitlist;
}

export function filterDirectLeagueRequestEligibleLeagues(
  leagues: LeagueCatalogItem[],
  eligibilityInput: LeagueEligibilityInput,
  priorSeasonReturnLeagueIds: Set<number>,
): LeagueCatalogItem[] {
  return leagues.filter(
    (league) =>
      isLeagueSelectionEligibleLeague(league, eligibilityInput) &&
      isDirectLeagueRequestLeague(league) &&
      !priorSeasonReturnLeagueIds.has(league.id),
  );
}

/** Fee-0 standard leagues included with basic ice privileges (daytime leagues). */
export function isBasicIceIncludedDaytimeLeague(league: LeagueCatalogItem): boolean {
  return (
    league.registrationFeeMinor === 0 &&
    !league.allowsWaitlist &&
    league.isPlayInBased !== true &&
    league.leagueType !== 'bring_your_own_team' &&
    league.format !== 'instructional'
  );
}

export function isPlayInRequestSelection(selection: RegistrationSelectionInput): boolean {
  return selection.selectionType === 'play_in_request';
}

export function isInstructionalJoinSelection(selection: RegistrationSelectionInput): boolean {
  return selection.selectionType === 'instructional_join';
}

export function expectedByotRosterSize(league: Pick<LeagueCatalogItem, 'format'>): number | null {
  if (league.format === 'teams') return 4;
  if (league.format === 'doubles') return 2;
  return null;
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
    api.get<RegistrationLeagueSelectionPayload>(`/registration/drafts/${registrationId}/league-catalog`),
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
  options?: { confirmImmediatePayment?: boolean },
): Promise<SubmitRegistrationEditsResult> {
  const response = await api.post<{
    outcome: string;
    checkoutUrl?: string;
    requiresCheckoutConfirmation?: boolean;
    message?: string;
    totalDueMinor?: number;
    paymentAdjustment?: RegistrationPaymentAdjustmentResult;
  }>(`/registration/drafts/${registrationId}/submit`, {
    confirmImmediatePayment: options?.confirmImmediatePayment ?? false,
  });
  return {
    checkoutUrl: response.data.checkoutUrl,
    requiresCheckoutConfirmation: response.data.requiresCheckoutConfirmation,
    message: response.data.message,
    totalDueMinor: response.data.totalDueMinor,
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

export async function saveLeagueSelections(
  registrationId: number,
  input: {
    selections: RegistrationSelectionInput[];
    desiredAddWaitlistLeagueCount?: number | null;
    addWaitlistPriority?: number[];
  },
) {
  const shouldCollectWaitlistFulfillment = requiresWaitlistFulfillmentPreferences(input.selections);
  const desiredAddWaitlistLeagueCount = shouldCollectWaitlistFulfillment
    ? (input.desiredAddWaitlistLeagueCount ?? null)
    : null;
  const addWaitlistPriority = shouldCollectWaitlistFulfillment ? (input.addWaitlistPriority ?? []) : [];
  const selections = addWaitlistPriority.length
    ? applyAddWaitlistPriorityOrder(input.selections, addWaitlistPriority)
    : input.selections;
  const response = await api.put<RegistrationLeagueSelectionPayload>(
    `/registration/drafts/${registrationId}/league-selections`,
    {
      selections,
      desiredAddWaitlistLeagueCount,
      addWaitlistPriority,
    },
  );
  return response.data;
}

export function updateLeagueSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  selectionType: RegistrationSelectionType | 'none',
): RegistrationSelectionInput[] {
  const withoutLeague = selections.filter((selection) => selection.leagueId !== leagueId);
  if (selectionType === 'none') return withoutLeague;
  if (selectionType === 'return_subject_to_availability') {
    const interestCount = withoutLeague.filter((selection) => isThirdLeagueInterestSelection(selection)).length;
    return [...withoutLeague, { selectionType: 'third_league_interest', leagueId, rank: interestCount + 1 }];
  }
  return [...withoutLeague, { selectionType, leagueId }];
}

export function updateWaitlistReplaceSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  replacesLeagueId: number,
): RegistrationSelectionInput[] {
  const withoutLeague = selections.filter((selection) => selection.leagueId !== leagueId);
  return [...withoutLeague, { selectionType: 'waitlist_replace', leagueId, replacesLeagueId }];
}

export function setThirdLeagueInterestSelections(
  selections: RegistrationSelectionInput[],
  leagueIds: number[],
  priorSeasonReturnLeagueIds: Set<number>,
): RegistrationSelectionInput[] {
  const selectedSet = new Set(leagueIds);
  const nonInterest = selections.filter((selection) => !isThirdLeagueInterestSelection(selection));
  for (const leagueId of priorSeasonReturnLeagueIds) {
    const hadInterest = selections.some(
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
}

export function updateByotTeammates(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  text: string,
): RegistrationSelectionInput[] {
  return selections.map((selection) =>
    selection.leagueId === leagueId &&
    (selection.selectionType === 'byot_request' ||
      selection.selectionType === 'waitlist_add' ||
      selection.selectionType === 'waitlist_replace')
      ? { ...selection, byotTeammateText: text }
      : selection,
  );
}

export function pendingByotRosterNames(
  selection: RegistrationSelectionInput,
  memberOptionIdByName?: Map<string, number>,
  registeringCurlerMemberId?: number | null,
): string[] {
  const textNames = rosterEntries(selection.byotTeammateText);
  if (!selection.teamRosterPlacements?.length) {
    if (!memberOptionIdByName) return textNames;
    return textNames.filter((name) => {
      const memberId = memberOptionIdByName.get(name.toLowerCase());
      return memberId == null || memberId === registeringCurlerMemberId;
    });
  }
  return textNames;
}

function ensureRegisteringCurlerPlacement(
  selection: RegistrationSelectionInput,
  registeringCurler: { id: number | null; name: string },
): RegistrationSelectionInput {
  if (registeringCurler.id == null) return selection;
  const placements = selection.teamRosterPlacements ?? [];
  if (placements.some((placement) => placement.memberId === registeringCurler.id)) {
    return selection;
  }
  const entryType = selectionUsesReplacePlacement(selection) ? 'replace' : 'add';
  const replacesLeagueId = entryType === 'replace' ? selection.replacesLeagueId ?? null : null;
  return {
    ...selection,
    teamRosterPlacements: [
      {
        memberId: registeringCurler.id,
        entryType,
        replacesLeagueId,
      },
      ...placements,
    ],
  };
}

export function updatePendingByotRosterNames(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  names: string[],
  registeringCurler?: { id: number | null; name: string },
): RegistrationSelectionInput[] {
  const text = names.map((name) => name.trim()).filter(Boolean).join('\n');
  return selections.map((selection) => {
    if (selection.leagueId !== leagueId || !isByotRosterSelection(selection)) {
      return selection;
    }
    let nextSelection: RegistrationSelectionInput = { ...selection, byotTeammateText: text || null };
    if (registeringCurler && (text || (nextSelection.teamRosterPlacements?.length ?? 0) > 0)) {
      nextSelection = ensureRegisteringCurlerPlacement(nextSelection, registeringCurler);
    }
    return nextSelection;
  });
}

function isByotWaitlistSelection(selection: RegistrationSelectionInput): boolean {
  return (
    selection.selectionType === 'waitlist_add' ||
    selection.selectionType === 'waitlist_replace' ||
    selection.selectionType === 'waitlist_add_auto_decline' ||
    selection.selectionType === 'waitlist_replace_auto_decline'
  );
}

function isByotRosterSelection(selection: RegistrationSelectionInput): boolean {
  return isByotWaitlistSelection(selection) || selection.selectionType === 'play_in_request';
}

function selectionUsesReplacePlacement(selection: RegistrationSelectionInput): boolean {
  return (
    selection.selectionType === 'waitlist_replace' ||
    selection.selectionType === 'waitlist_replace_auto_decline' ||
    (selection.selectionType === 'play_in_request' && selection.replacesLeagueId != null)
  );
}

export function buildByotWaitlistMemberList(
  selection: RegistrationSelectionInput,
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): Array<{ memberId: number; memberName: string }> {
  if (registeringCurler.id == null) return [];
  const teammateIds = byotRosterMemberIds(selection, memberOptionIdByName, registeringCurler.id);
  const teammates = teammateIds
    .map((memberId) => {
      const name = memberOptionById.get(memberId)?.name;
      return name ? { memberId, memberName: name } : null;
    })
    .filter((member): member is { memberId: number; memberName: string } => member != null);
  return [{ memberId: registeringCurler.id, memberName: registeringCurler.name }, ...teammates];
}

export function hydrateByotWaitlistPlacements(
  selection: RegistrationSelectionInput,
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): WaitlistTeamMemberPlacement[] {
  const members = buildByotWaitlistMemberList(selection, memberOptionById, memberOptionIdByName, registeringCurler);
  if (selection.teamRosterPlacements?.length) {
    return syncPlacementsWithMembers(
      members,
      selection.teamRosterPlacements.map((placement) => ({
        memberId: placement.memberId,
        memberName: memberOptionById.get(placement.memberId)?.name ?? `Member #${placement.memberId}`,
        entryType: placement.entryType,
        replacesLeagueId: placement.replacesLeagueId ?? null,
      })),
    );
  }
  const fallbackType = selectionUsesReplacePlacement(selection) ? 'replace' : 'add';
  const fallbackReplaces = selectionUsesReplacePlacement(selection) ? selection.replacesLeagueId ?? null : null;
  return members.map((member) => {
    const isRegisteringCurler =
      registeringCurler.id != null && member.memberId === registeringCurler.id;
    return {
      ...member,
      entryType: isRegisteringCurler ? fallbackType : 'add',
      replacesLeagueId: isRegisteringCurler && fallbackType === 'replace' ? fallbackReplaces : null,
    };
  });
}

function applyPrimaryPlacementToSelection(
  selection: RegistrationSelectionInput,
  placements: WaitlistTeamMemberPlacement[],
  registeringCurlerMemberId: number | null,
): RegistrationSelectionInput {
  const primaryPlacement =
    registeringCurlerMemberId != null
      ? placements.find((placement) => placement.memberId === registeringCurlerMemberId)
      : placements[0];
  if (!primaryPlacement) return selection;
  if (selection.selectionType === 'play_in_request') {
    return {
      ...selection,
      replacesLeagueId: primaryPlacement.entryType === 'replace' ? primaryPlacement.replacesLeagueId : null,
      teamRosterPlacements: toPlacementPayload(placements),
    };
  }
  return {
    ...selection,
    selectionType: primaryPlacement.entryType === 'replace' ? 'waitlist_replace' : 'waitlist_add',
    replacesLeagueId: primaryPlacement.entryType === 'replace' ? primaryPlacement.replacesLeagueId : null,
    teamRosterPlacements: toPlacementPayload(placements),
  };
}

export function updateTeamRosterPlacements(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  placements: WaitlistTeamMemberPlacement[],
  registeringCurlerMemberId: number | null,
): RegistrationSelectionInput[] {
  return selections.map((selection) =>
    selection.leagueId === leagueId && isByotRosterSelection(selection)
      ? applyPrimaryPlacementToSelection(selection, placements, registeringCurlerMemberId)
      : selection,
  );
}

export function updateByotRosterMembers(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  memberIds: number[],
  memberNameById: Map<number, string>,
  registeringCurler: { id: number | null; name: string },
  memberOptionIdByName: Map<string, number>,
): RegistrationSelectionInput[] {
  return selections.map((selection) => {
    if (selection.leagueId !== leagueId || !isByotRosterSelection(selection)) {
      return selection;
    }
    const memberOptionById = new Map(Array.from(memberNameById.entries()).map(([id, name]) => [id, { name }]));
    const members = [
      ...(registeringCurler.id != null
        ? [{ memberId: registeringCurler.id, memberName: registeringCurler.name }]
        : []),
      ...memberIds
        .map((memberId) => {
          const memberName = memberNameById.get(memberId);
          return memberName ? { memberId, memberName } : null;
        })
        .filter((member): member is { memberId: number; memberName: string } => member != null),
    ];
    const placements = hydrateByotWaitlistPlacements(
      selection,
      memberOptionById,
      memberOptionIdByName,
      registeringCurler,
    );
    const synced = syncPlacementsWithMembers(members, placements);
    return applyPrimaryPlacementToSelection(selection, synced, registeringCurler.id);
  });
}

export function byotRosterMemberIds(
  selection: RegistrationSelectionInput,
  memberIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
): number[] {
  if (selection.teamRosterPlacements?.length) {
    return selection.teamRosterPlacements
      .map((placement) => placement.memberId)
      .filter((memberId) => memberId !== registeringCurlerMemberId);
  }
  return rosterEntries(selection.byotTeammateText)
    .map((entry) => memberIdByName.get(entry.toLowerCase()))
    .filter((memberId): memberId is number => typeof memberId === 'number' && memberId !== registeringCurlerMemberId);
}

function memberPlacementsAreComplete(
  placements: WaitlistTeamMemberPlacement[],
  expectedMemberCount: number,
): boolean {
  if (placements.length !== expectedMemberCount) return false;
  return placements.every(
    (placement) =>
      placement.entryType === 'add' ||
      (placement.entryType === 'replace' && placement.replacesLeagueId != null),
  );
}

export function formatHybridByotRosterDisplay(
  selection: RegistrationSelectionInput,
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  const parts: string[] = [];
  if (registeringCurler.name.trim()) {
    parts.push(registeringCurler.name.trim());
  }
  for (const memberId of byotRosterMemberIds(selection, memberOptionIdByName, registeringCurler.id)) {
    const name = memberOptionById.get(memberId)?.name;
    if (name) parts.push(name);
  }
  for (const pendingName of pendingByotRosterNames(selection, memberOptionIdByName, registeringCurler.id)) {
    parts.push(`${pendingName} (not yet registered)`);
  }
  if (parts.length === 0) return null;
  return parts.join(', ');
}

function firstByotRosterValidationMessageForSelections(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
  matchSelection: (selection: RegistrationSelectionInput) => boolean,
  emptyRosterMessage: string,
): string | null {
  for (const selection of selections) {
    if (selection.leagueId == null) continue;
    if (!matchSelection(selection)) continue;
    const league = leagues.find((item) => item.id === selection.leagueId);
    if (!league || league.leagueType !== 'bring_your_own_team') continue;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize === null) return emptyRosterMessage;
    const pending = pendingByotRosterNames(selection, memberOptionIdByName, registeringCurler.id);
    if (pending.some((name) => !name.trim())) {
      return `Enter a name for each teammate not yet registered on ${league.name}.`;
    }
    const pendingLower = pending.map((name) => name.trim().toLowerCase());
    if (new Set(pendingLower).size !== pendingLower.length) {
      return `Teammate names must be unique on ${league.name}.`;
    }
    const expectedMemberCount = expectedSize - pending.length;
    if (expectedMemberCount < 1) {
      return `Too many teammates listed for ${league.name}.`;
    }
    const placements = hydrateByotWaitlistPlacements(
      selection,
      memberOptionById,
      memberOptionIdByName,
      registeringCurler,
    );
    if (placements.length + pending.length !== expectedSize) {
      return `Enter the full team roster for ${league.name}.`;
    }
    if (!memberPlacementsAreComplete(placements, expectedMemberCount)) {
      return `Complete ADD or REPLACE details for every registered club member on ${league.name}.`;
    }
  }
  return null;
}

export function firstByotWaitlistRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  return firstByotRosterValidationMessageForSelections(
    selections,
    leagues,
    memberOptionById,
    memberOptionIdByName,
    registeringCurler,
    isByotWaitlistSelection,
    'Enter the full team roster for this BYOT waitlist.',
  );
}

export function firstPlayInRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  return firstByotRosterValidationMessageForSelections(
    selections,
    leagues,
    memberOptionById,
    memberOptionIdByName,
    registeringCurler,
    isPlayInRequestSelection,
    'Enter the full team roster for this play-in league.',
  );
}

export function firstDirectLeagueRequestRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  return (
    firstByotWaitlistRosterValidationMessage(
      selections,
      leagues,
      memberOptionById,
      memberOptionIdByName,
      registeringCurler,
    ) ??
    firstPlayInRosterValidationMessage(
      selections,
      leagues,
      memberOptionById,
      memberOptionIdByName,
      registeringCurler,
    )
  );
}

export type { WaitlistTeamMemberPlacementOptions };
