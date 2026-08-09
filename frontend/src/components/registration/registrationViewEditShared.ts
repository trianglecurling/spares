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
  };
};

const ADD_WAITLIST_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'waitlist_add',
  'waitlist_add_auto_decline',
]);

const REPLACE_WAITLIST_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'waitlist_replace',
  'waitlist_replace_auto_decline',
]);

const SCHEDULED_FIRST_TWO_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'play_in_request',
]);

export type WaitlistEntryIntent = 'add' | 'replace';
export type WaitlistOfferPreference = 'auto_accept' | 'auto_decline';

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

export function isReplaceWaitlistSelectionType(selectionType: RegistrationSelectionType): boolean {
  return REPLACE_WAITLIST_SELECTION_TYPES.has(selectionType);
}

export function waitlistEntryTypeFromSelection(
  selection: RegistrationSelectionInput | undefined,
  fallback: WaitlistEntryIntent = 'add',
): WaitlistEntryIntent {
  if (!selection) return fallback;
  if (isReplaceWaitlistSelectionType(selection.selectionType)) return 'replace';
  if (
    selection.selectionType === 'waitlist_keep_auto_accept' ||
    selection.selectionType === 'waitlist_keep_auto_decline'
  ) {
    return selection.replacesLeagueId != null ? 'replace' : fallback;
  }
  if (isAddWaitlistSelectionType(selection.selectionType)) return 'add';
  return fallback;
}

export function isAddWaitlistSelection(selection: RegistrationSelectionInput): boolean {
  if (selection.leagueId == null) return false;
  if (selection.selectionType === 'waitlist_remove') return false;
  if (isAddWaitlistSelectionType(selection.selectionType)) return true;
  if (
    selection.selectionType === 'waitlist_keep_auto_accept' ||
    selection.selectionType === 'waitlist_keep_auto_decline'
  ) {
    return selection.replacesLeagueId == null;
  }
  return false;
}

export function getAddWaitlistSelections(selections: RegistrationSelectionInput[]): RegistrationSelectionInput[] {
  return selections.filter((selection) => isAddWaitlistSelection(selection));
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

export function isAddWaitlistAvailable(activeLeagueIds: number[], selections: RegistrationSelectionInput[]): boolean {
  return countFirstTwoLeagueSlots(activeLeagueIds, selections) <= 1;
}

export function buildReplaceableLeagueOptions(input: {
  activeLeagueIds: number[];
  selections: RegistrationSelectionInput[];
  leagueName: (leagueId: number) => string;
  selectionLabel?: (selection: RegistrationSelectionInput) => string;
  existingEntries?: Array<{
    leagueId: number;
    entryType: WaitlistEntryIntent;
    replacesLeagueId?: number | null;
    status?: string | null;
  }>;
  /** League IDs that cannot be REPLACE waitlist targets (play-in leagues). */
  excludedLeagueIds?: Iterable<number>;
}): Array<{ value: number; label: string; description?: string }> {
  const options: Array<{ value: number; label: string; description?: string }> = [];
  const seen = new Set<number>();
  const excluded = new Set(input.excludedLeagueIds ?? []);
  const addOption = (leagueId: number, description?: string) => {
    if (excluded.has(leagueId) || seen.has(leagueId)) return;
    seen.add(leagueId);
    options.push({
      value: leagueId,
      label: input.leagueName(leagueId),
      description,
    });
  };

  // Leagues already claimed for this session (return / BYOT / play-in).
  for (const selection of input.selections) {
    if (selection.leagueId == null || !SCHEDULED_FIRST_TWO_SELECTION_TYPES.has(selection.selectionType)) continue;
    addOption(selection.leagueId, input.selectionLabel?.(selection));
  }
  // Leagues already on the session roster.
  for (const leagueId of input.activeLeagueIds) {
    addOption(leagueId, 'Current league');
  }
  // Leagues already used as REPLACE targets — during draft these may not yet be on the roster.
  for (const selection of input.selections) {
    if (selection.replacesLeagueId == null) continue;
    if (
      !isReplaceWaitlistSelectionType(selection.selectionType) &&
      selection.selectionType !== 'waitlist_keep_auto_accept' &&
      selection.selectionType !== 'waitlist_keep_auto_decline' &&
      selection.selectionType !== 'play_in_request'
    ) {
      continue;
    }
    addOption(selection.replacesLeagueId, 'League held for REPLACE');
  }
  for (const entry of input.existingEntries ?? []) {
    if (entry.status != null && entry.status !== 'active' && entry.status !== 'offered') continue;
    if (entry.entryType !== 'replace' || entry.replacesLeagueId == null) continue;
    addOption(entry.replacesLeagueId, 'League held for REPLACE');
  }
  return options;
}

export function countReplaceWaitlistEntries(input: {
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  excludeLeagueId?: number;
}): number {
  const removedLeagueIds = new Set(
    input.selections
      .filter((selection) => selection.selectionType === 'waitlist_remove' && selection.leagueId != null)
      .map((selection) => selection.leagueId as number),
  );
  const counted = new Set<number>();
  for (const selection of input.selections) {
    if (selection.leagueId == null || selection.leagueId === input.excludeLeagueId) continue;
    if (selection.selectionType === 'waitlist_remove') continue;
    if (waitlistEntryTypeFromSelection(selection) !== 'replace') continue;
    counted.add(selection.leagueId);
  }
  for (const entry of input.existingEntries ?? []) {
    if (entry.leagueId === input.excludeLeagueId) continue;
    if (entry.entryType !== 'replace') continue;
    if (removedLeagueIds.has(entry.leagueId)) continue;
    if (entry.status != null && entry.status !== 'active' && entry.status !== 'offered') continue;
    counted.add(entry.leagueId);
  }
  return counted.size;
}

export function waitlistEntryTypeChoices(input: {
  activeLeagueIds: number[];
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  leagueId: number;
  replaceOptions: Array<{ value: number }>;
}): WaitlistEntryIntent[] {
  const choices: WaitlistEntryIntent[] = [];
  const addAvailable = isAddWaitlistAvailable(input.activeLeagueIds, input.selections);
  if (addAvailable) {
    choices.push('add');
  }
  if (input.replaceOptions.length === 0) {
    return choices;
  }
  // The two-REPLACE cap only applies when ADD is unavailable (already at two leagues).
  if (addAvailable) {
    choices.push('replace');
    return choices;
  }
  const replaceCount = countReplaceWaitlistEntries({
    selections: input.selections,
    existingEntries: input.existingEntries,
    excludeLeagueId: input.leagueId,
  });
  if (replaceCount < 2) {
    choices.push('replace');
  }
  return choices;
}

/** Explains surprising REPLACE unavailability (e.g. hit the 2-REPLACE cap while ADD is blocked). */
export function waitlistReplaceUnavailableReason(input: {
  activeLeagueIds: number[];
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  leagueId: number;
  replaceOptions: Array<{ value: number }>;
}): string | null {
  const choices = waitlistEntryTypeChoices(input);
  if (choices.includes('replace')) return null;
  if (isAddWaitlistAvailable(input.activeLeagueIds, input.selections)) return null;
  const replaceCount = countReplaceWaitlistEntries({
    selections: input.selections,
    existingEntries: input.existingEntries,
    excludeLeagueId: input.leagueId,
  });
  if (replaceCount >= 2) {
    return 'REPLACE is unavailable because you already have two REPLACE waitlists.';
  }
  return null;
}

export function waitlistSelectionTypeForEntry(input: {
  entryType: WaitlistEntryIntent;
  preference: WaitlistOfferPreference;
}): RegistrationSelectionType {
  if (input.entryType === 'replace') {
    return input.preference === 'auto_decline' ? 'waitlist_replace_auto_decline' : 'waitlist_replace';
  }
  return input.preference === 'auto_decline' ? 'waitlist_add_auto_decline' : 'waitlist_add';
}

export function waitlistOfferPreferenceFromSelection(
  selection: RegistrationSelectionInput | undefined,
): WaitlistOfferPreference | null {
  if (!selection) return null;
  switch (selection.selectionType) {
    case 'waitlist_remove':
      return null;
    case 'waitlist_add_auto_decline':
    case 'waitlist_replace_auto_decline':
    case 'waitlist_keep_auto_decline':
      return 'auto_decline';
    case 'waitlist_add':
    case 'waitlist_replace':
    case 'waitlist_keep_auto_accept':
      return 'auto_accept';
    default:
      return null;
  }
}

export function updateWaitlistEntryDetails(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  patch: {
    entryType: WaitlistEntryIntent;
    replacesLeagueId?: number | null;
    preference?: WaitlistOfferPreference;
  },
): RegistrationSelectionInput[] {
  const previous = selections.find((selection) => selection.leagueId === leagueId);
  const preference = patch.preference ?? waitlistOfferPreferenceFromSelection(previous) ?? 'auto_accept';
  const replacesLeagueId =
    patch.entryType === 'replace'
      ? patch.replacesLeagueId !== undefined
        ? patch.replacesLeagueId
        : (previous?.replacesLeagueId ?? null)
      : null;
  const withoutLeague = selections.filter((selection) => selection.leagueId !== leagueId);
  return [
    ...withoutLeague,
    {
      selectionType: waitlistSelectionTypeForEntry({ entryType: patch.entryType, preference }),
      leagueId,
      replacesLeagueId,
      rank: patch.entryType === 'add' ? previous?.rank ?? null : null,
      byotTeammateText: previous?.byotTeammateText ?? null,
      teamRosterPlacements: previous?.teamRosterPlacements ?? null,
    },
  ];
}

export type RegistrationLeagueFlowStep =
  | '/registration/league-requests'
  | '/registration/basic-ice-fallback'
  | '/registration/third-league-interest'
  | '/registration/league-summary';

export function shouldCollectBasicIceFallback(
  selections: RegistrationSelectionInput[],
  isBasicIceLeagueSelection: boolean,
  hasGuaranteedPlayInEntry = false,
): boolean {
  if (isBasicIceLeagueSelection) return false;
  if (hasGuaranteedPlayInEntry) return false;
  return selections.filter((selection) => selection.selectionType === 'guaranteed_return').length === 0;
}

/** True when a play-in request is currently evaluated as guaranteed entry. */
export function hasGuaranteedPlayInSelection(
  selections: RegistrationSelectionInput[],
  playInEntry: Record<number, { guaranteed?: boolean }> | null | undefined,
): boolean {
  return selections.some(
    (selection) =>
      selection.selectionType === 'play_in_request' &&
      selection.leagueId != null &&
      playInEntry?.[selection.leagueId]?.guaranteed === true,
  );
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
  hasGuaranteedPlayInEntry?: boolean;
}): '/registration/basic-ice-fallback' | '/registration/third-league-interest' | '/registration/league-summary' {
  if (shouldCollectThirdLeagueInterest(input.selections, input.desiredAddWaitlistLeagueCount)) {
    return '/registration/third-league-interest';
  }
  if (
    shouldCollectBasicIceFallback(
      input.selections,
      input.isBasicIceLeagueSelection,
      input.hasGuaranteedPlayInEntry === true,
    )
  ) {
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
  hasGuaranteedPlayInEntry?: boolean;
}): RegistrationLeagueFlowStep {
  return nextLeagueFlowStepAfterIntermediateSteps(input);
}

export function nextLeagueFlowStepAfterLeagueRequests(): '/registration/league-selection' {
  return '/registration/league-selection';
}

export function nextLeagueFlowStepAfterThirdLeagueInterest(input: {
  selections: RegistrationSelectionInput[];
  isBasicIceLeagueSelection: boolean;
  hasGuaranteedPlayInEntry?: boolean;
}): '/registration/basic-ice-fallback' | '/registration/league-summary' {
  if (
    shouldCollectBasicIceFallback(
      input.selections,
      input.isBasicIceLeagueSelection,
      input.hasGuaranteedPlayInEntry === true,
    )
  ) {
    return '/registration/basic-ice-fallback';
  }
  return '/registration/league-summary';
}

export function previousLeagueFlowStepBeforeSummary(input: {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount: number | null;
  isBasicIceLeagueSelection: boolean;
  hasGuaranteedPlayInEntry?: boolean;
}): '/registration/league-selection' | '/registration/basic-ice-fallback' | '/registration/third-league-interest' {
  if (input.isBasicIceLeagueSelection) return '/registration/league-selection';
  if (
    shouldCollectBasicIceFallback(
      input.selections,
      input.isBasicIceLeagueSelection,
      input.hasGuaranteedPlayInEntry === true,
    )
  ) {
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

function isRemovedWaitlistLeagueId(selections: RegistrationSelectionInput[], leagueId: number): boolean {
  return selections.some(
    (selection) => selection.leagueId === leagueId && selection.selectionType === 'waitlist_remove',
  );
}

function isActiveWaitlistDraftSelection(selection: RegistrationSelectionInput): boolean {
  if (selection.leagueId == null) return false;
  if (selection.selectionType === 'waitlist_remove') return false;
  return (
    isAddWaitlistSelectionType(selection.selectionType) ||
    isReplaceWaitlistSelectionType(selection.selectionType) ||
    selection.selectionType === 'waitlist_keep_auto_accept' ||
    selection.selectionType === 'waitlist_keep_auto_decline'
  );
}

/**
 * Unified display/priority order for every active waitlist (ADD and REPLACE).
 * Preserves the caller's order when provided; type changes must not reshuffle.
 */
export function getActiveWaitlistLeagueIds(input: {
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  orderLeagueIds?: number[];
}): number[] {
  const activeIds = new Set<number>();

  for (const selection of input.selections) {
    if (!isActiveWaitlistDraftSelection(selection) || selection.leagueId == null) continue;
    activeIds.add(selection.leagueId);
  }
  for (const entry of input.existingEntries ?? []) {
    if (entry.status != null && entry.status !== 'active' && entry.status !== 'offered') continue;
    if (isRemovedWaitlistLeagueId(input.selections, entry.leagueId)) continue;
    activeIds.add(entry.leagueId);
  }

  const rankedFromSelections = input.selections
    .filter((selection) => isActiveWaitlistDraftSelection(selection) && selection.leagueId != null)
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((selection) => selection.leagueId as number);

  const preferredOrder = [...(input.orderLeagueIds ?? []), ...rankedFromSelections, ...activeIds];
  const ordered: number[] = [];
  const seen = new Set<number>();
  for (const leagueId of preferredOrder) {
    if (!activeIds.has(leagueId) || seen.has(leagueId)) continue;
    seen.add(leagueId);
    ordered.push(leagueId);
  }
  return ordered;
}

/** ADD-only ranks for the backend fulfillment API, taken from the unified waitlist order. */
export function addWaitlistPriorityFromOrder(input: {
  orderLeagueIds: number[];
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
}): number[] {
  return input.orderLeagueIds.filter((leagueId) => {
    const selection = input.selections.find((candidate) => candidate.leagueId === leagueId);
    const existing = input.existingEntries?.find((entry) => entry.leagueId === leagueId);
    if (selection?.selectionType === 'waitlist_remove') return false;
    return waitlistEntryTypeFromSelection(selection, existing?.entryType ?? 'add') === 'add';
  });
}

/** @deprecated Use getActiveWaitlistLeagueIds; kept for older call sites during migration. */
export function getActiveAddWaitlistLeagueIds(input: {
  selections: RegistrationSelectionInput[];
  existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
  priorityLeagueIds?: number[];
}): number[] {
  return addWaitlistPriorityFromOrder({
    orderLeagueIds: getActiveWaitlistLeagueIds({
      selections: input.selections,
      existingEntries: input.existingEntries,
      orderLeagueIds: input.priorityLeagueIds,
    }),
    selections: input.selections,
    existingEntries: input.existingEntries,
  });
}

export function applyAddWaitlistPriorityOrder(
  selections: RegistrationSelectionInput[],
  priorityLeagueIds: number[],
): RegistrationSelectionInput[] {
  // Store rank on every active waitlist selection so unified order survives reload.
  const rankByLeagueId = new Map(priorityLeagueIds.map((leagueId, index) => [leagueId, index + 1] as const));
  return selections.map((selection) => {
    if (!isActiveWaitlistDraftSelection(selection) || selection.leagueId == null) return selection;
    const rank = rankByLeagueId.get(selection.leagueId);
    return rank != null ? { ...selection, rank } : selection;
  });
}

export function moveWaitlistOrder(
  orderLeagueIds: number[],
  leagueId: number,
  direction: 'up' | 'down',
): number[] {
  const index = orderLeagueIds.indexOf(leagueId);
  if (index < 0) return orderLeagueIds;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= orderLeagueIds.length) return orderLeagueIds;
  const next = [...orderLeagueIds];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next;
}

/** @deprecated Use moveWaitlistOrder */
export function moveAddWaitlistPriority(
  priorityLeagueIds: number[],
  leagueId: number,
  direction: 'up' | 'down',
): number[] {
  return moveWaitlistOrder(priorityLeagueIds, leagueId, direction);
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
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
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

export type RegistrationLeagueSelectionPayload = {
  leagues: LeagueCatalogItem[];
  selections: RegistrationSelectionInput[];
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  continuingSabbaticals?: ContinuingSabbaticalSummary[];
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
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
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

export const PROTECTED_RETURN_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'sabbatical',
]);

export function countProtectedClaimSelections(selections: RegistrationSelectionInput[]): number {
  return selections.filter((selection) => PROTECTED_RETURN_SELECTION_TYPES.has(selection.selectionType)).length;
}

export function countPriorSeasonProtectedReturnSelections(
  selections: RegistrationSelectionInput[],
  priorSeasonReturnLeagueIds: ReadonlySet<number>,
): number {
  return selections.filter(
    (selection) =>
      selection.leagueId != null &&
      priorSeasonReturnLeagueIds.has(selection.leagueId) &&
      PROTECTED_RETURN_SELECTION_TYPES.has(selection.selectionType),
  ).length;
}

export const PLAY_IN_WITH_TWO_GUARANTEED_RETURNS_NOTICE =
  'You have selected two guaranteed-return leagues in addition to a play-in league. On the next page, you must choose which league to replace if you are successful entering the play-in league.';

export function hasPlayInWithTwoGuaranteedReturns(selections: RegistrationSelectionInput[]): boolean {
  const guaranteedReturnCount = selections.filter(
    (selection) => selection.selectionType === 'guaranteed_return',
  ).length;
  const hasPlayIn = selections.some((selection) => selection.selectionType === 'play_in_request');
  return hasPlayIn && guaranteedReturnCount >= 2;
}

export function isPlayInBasedLeague(league: Pick<LeagueCatalogItem, 'isPlayInBased'>): boolean {
  return league.isPlayInBased === true;
}

/**
 * Prior leagues stay off League requests, except play-in leagues which still need
 * team/ADD-REPLACE completion (or re-join after "Not joining").
 */
export function shouldExcludePriorLeagueFromLeagueRequests(
  league: Pick<LeagueCatalogItem, 'id' | 'isPlayInBased'>,
  priorSeasonReturnLeagueIds: ReadonlySet<number>,
): boolean {
  if (!priorSeasonReturnLeagueIds.has(league.id)) return false;
  if (isPlayInBasedLeague(league)) return false;
  return true;
}

const CONFIRMED_LEAGUE_PLACEMENT_STATUSES = new Set(['confirmed', 'placed']);

export const CONFIRMED_LEAGUE_PLACEMENT_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'instructional_join',
]);

const LEAGUE_PLACEMENT_VIEW_STATUSES = new Set(['confirmed', 'placed', 'pending']);

export function isConfirmedLeaguePlacement(selection: {
  selectionType: RegistrationSelectionType | string;
  status: string;
}): boolean {
  return (
    CONFIRMED_LEAGUE_PLACEMENT_SELECTION_TYPES.has(selection.selectionType as RegistrationSelectionType) &&
    CONFIRMED_LEAGUE_PLACEMENT_STATUSES.has(selection.status)
  );
}

/** League placements shown on registration status (includes pending BYOT / instructional). */
export function isLeaguePlacementForStatusView(selection: {
  selectionType: RegistrationSelectionType | string;
  status: string;
}): boolean {
  return (
    CONFIRMED_LEAGUE_PLACEMENT_SELECTION_TYPES.has(selection.selectionType as RegistrationSelectionType) &&
    LEAGUE_PLACEMENT_VIEW_STATUSES.has(selection.status)
  );
}

type StatusViewPlayInSelection = {
  selectionType: RegistrationSelectionType | string;
  status?: string | null;
  leagueId?: number | null;
};

/** Play-in requests that count as confirmed placements on registration status views. */
export function isGuaranteedPlayInForStatusView(
  selection: StatusViewPlayInSelection,
  playInEntry: Record<number, { guaranteed?: boolean }> | null | undefined,
): boolean {
  if (selection.selectionType !== 'play_in_request') return false;
  if (selection.status === 'placed') return true;
  if (selection.status === 'not_placed') return false;
  return selection.leagueId != null && playInEntry?.[selection.leagueId]?.guaranteed === true;
}

/** Confirmed leagues section: standard placements plus guaranteed / placed play-ins. */
export function isConfirmedLeagueForStatusView(
  selection: StatusViewPlayInSelection & { status: string },
  playInEntry: Record<number, { guaranteed?: boolean }> | null | undefined,
): boolean {
  return isLeaguePlacementForStatusView(selection) || isGuaranteedPlayInForStatusView(selection, playInEntry);
}

/** League play-ins section: play-in requests that are not yet confirmed entry. */
export function isPendingPlayInForStatusView(
  selection: StatusViewPlayInSelection & { status: string },
  playInEntry: Record<number, { guaranteed?: boolean }> | null | undefined,
): boolean {
  return selection.selectionType === 'play_in_request' && !isGuaranteedPlayInForStatusView(selection, playInEntry);
}

/** Member-facing reason a play-in request is still under League play-ins. */
export function playInUnguaranteedStatusDetail(
  summary: Pick<RegistrationPlayInEntrySummary, 'teamTotalPoints' | 'meetsReturningRule'> | null | undefined,
): string {
  if (!summary || summary.teamTotalPoints == null) {
    return 'Team roster is incomplete · Placement depends on play-in results.';
  }
  if (summary.meetsReturningRule === false) {
    return 'Not enough returning members for automatic entry · Placement depends on play-in results.';
  }
  return 'Not enough points for automatic entry · Placement depends on play-in results.';
}

const NON_GUARANTEED_LEAGUE_INTEREST_TYPES = new Set<RegistrationSelectionType>([
  'third_league_interest',
  'return_subject_to_availability',
]);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isThirdLeagueInterestSelection(selection: RegistrationSelectionInput): boolean {
  return NON_GUARANTEED_LEAGUE_INTEREST_TYPES.has(selection.selectionType);
}

export function priorLeagueChoiceValue(
  selection: RegistrationSelectionInput | undefined,
  league?: Pick<LeagueCatalogItem, 'isPlayInBased'>,
): RegistrationSelectionType | null {
  if (!selection) return null;
  const choice =
    selection.selectionType === 'third_league_interest'
      ? ('return_subject_to_availability' as const)
      : selection.selectionType;
  if (league?.isPlayInBased === true) {
    if (choice !== 'play_in_request' && choice !== 'drop') return null;
  }
  return choice;
}

/** Prior-league selection types that are invalid for a play-in based league. */
const INVALID_PLAY_IN_PRIOR_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'sabbatical',
  'return_subject_to_availability',
  'third_league_interest',
]);

export function withoutInvalidPlayInPriorSelections(
  selections: RegistrationSelectionInput[],
  leagues: Array<Pick<LeagueCatalogItem, 'id' | 'isPlayInBased'>>,
): RegistrationSelectionInput[] {
  const playInLeagueIds = new Set(
    leagues.filter((league) => league.isPlayInBased === true).map((league) => league.id),
  );
  if (playInLeagueIds.size === 0) return selections;
  return selections.filter((selection) => {
    if (selection.leagueId == null || !playInLeagueIds.has(selection.leagueId)) return true;
    return !INVALID_PLAY_IN_PRIOR_SELECTION_TYPES.has(selection.selectionType);
  });
}

export function formatRegistrationDisplayDate(dateString: string): string {
  const date = new Date(`${dateString.slice(0, 10)}T12:00:00`);
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [month, ...rest] = formatted.split(' ');
  if (!month || rest.length === 0) return formatted;
  return `${month}. ${rest.join(' ')}`;
}

export function continuingSabbaticalForLeague(
  payload: Pick<RegistrationLeagueSelectionPayload, 'continuingSabbaticals'> | null | undefined,
  leagueId: number,
): ContinuingSabbaticalSummary | undefined {
  return payload?.continuingSabbaticals?.find((entry) => entry.leagueId === leagueId);
}

export function hasPriorSeasonReturnLeagues(
  payload: Pick<RegistrationLeagueSelectionPayload, 'leagues' | 'participatedLeagueIds' | 'continuingSabbaticals'> | null | undefined,
  registrationState: RegistrationWindow['state'] | undefined,
): boolean {
  if (!payload || registrationState !== 'priority') return false;
  if ((payload.continuingSabbaticals?.length ?? 0) > 0) return true;
  return payload.leagues.some(
    (league) =>
      league.predecessorLeagueId != null && payload.participatedLeagueIds.includes(league.predecessorLeagueId),
  );
}

export function priorSeasonReturnLeaguesFromPayload(
  payload: Pick<RegistrationLeagueSelectionPayload, 'leagues' | 'participatedLeagueIds' | 'continuingSabbaticals'> | null | undefined,
  registrationState: RegistrationWindow['state'] | undefined,
): LeagueCatalogItem[] {
  if (!payload || registrationState !== 'priority') return [];

  const byId = new Map<number, LeagueCatalogItem>();
  for (const league of payload.leagues) {
    if (league.predecessorLeagueId != null && payload.participatedLeagueIds.includes(league.predecessorLeagueId)) {
      byId.set(league.id, league);
    }
  }
  for (const summary of payload.continuingSabbaticals ?? []) {
    const league = payload.leagues.find((entry) => entry.id === summary.leagueId);
    if (league) byId.set(league.id, league);
  }
  return [...byId.values()];
}

export function priorSeasonSabbaticalExtensionLeaguesFromPayload(
  payload: Pick<RegistrationLeagueSelectionPayload, 'leagues' | 'participatedLeagueIds' | 'continuingSabbaticals'> | null | undefined,
  registrationState: RegistrationWindow['state'] | undefined,
): LeagueCatalogItem[] {
  return priorSeasonReturnLeaguesFromPayload(payload, registrationState).filter((league) => {
    if (continuingSabbaticalForLeague(payload, league.id)) return true;
    return (
      league.allowsSabbatical &&
      league.predecessorLeagueId != null &&
      Boolean(payload?.participatedLeagueIds.includes(league.predecessorLeagueId))
    );
  });
}

export function leagueHasReturnRights(
  payload: Pick<RegistrationLeagueSelectionPayload, 'participatedLeagueIds' | 'continuingSabbaticals'> | null | undefined,
  registrationState: RegistrationWindow['state'] | undefined,
  league: Pick<LeagueCatalogItem, 'id' | 'predecessorLeagueId'>,
): boolean {
  if (registrationState !== 'priority' || !payload) return false;
  if (league.predecessorLeagueId != null && payload.participatedLeagueIds.includes(league.predecessorLeagueId)) {
    return true;
  }
  return Boolean(continuingSabbaticalForLeague(payload, league.id));
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
  // Play-in leagues use their own entry path and cannot be third-league interest.
  if (league.isPlayInBased === true) return false;
  if (league.format === 'instructional') return false;
  return isLeagueSelectionEligibleLeague(league, input);
}

export function isDirectLeagueRequestLeague(league: LeagueCatalogItem): boolean {
  if (league.isPlayInBased === true) return true;
  // Bring-your-own-team leagues join via play-in or waitlist, not a legacy guaranteed request.
  if (league.leagueType === 'bring_your_own_team') return false;
  return !league.allowsWaitlist;
}

export function filterDirectLeagueRequestEligibleLeagues(
  leagues: LeagueCatalogItem[],
  eligibilityInput: LeagueEligibilityInput,
  priorSeasonReturnLeagueIds: Set<number>,
): LeagueCatalogItem[] {
  return leagues
    .filter(
      (league) =>
        isLeagueSelectionEligibleLeague(league, eligibilityInput) &&
        isDirectLeagueRequestLeague(league) &&
        !shouldExcludePriorLeagueFromLeagueRequests(league, priorSeasonReturnLeagueIds),
    )
    .sort((left, right) => Number(right.isPlayInBased === true) - Number(left.isPlayInBased === true));
}

/** Returning competitive players already used a protected claim on Returning leagues. */
export function isReturningPlayInLeague(
  league: Pick<LeagueCatalogItem, 'id' | 'isPlayInBased'>,
  priorSeasonReturnLeagueIds: ReadonlySet<number>,
): boolean {
  return isPlayInBasedLeague(league) && priorSeasonReturnLeagueIds.has(league.id);
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

/** Minimum linked members + pending names required to declare a play-in team. */
export const MIN_PLAY_IN_ROSTER_SIZE = 2;

export function playInDraftRosterSize(
  selection: RegistrationSelectionInput,
  memberOptionIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
): number {
  const teammateIds = byotRosterMemberIds(selection, memberOptionIdByName, registeringCurlerMemberId);
  const pending = pendingByotRosterNames(selection, memberOptionIdByName, registeringCurlerMemberId);
  const registeringCount = registeringCurlerMemberId != null ? 1 : 0;
  return registeringCount + teammateIds.length + pending.length;
}

/** True when a play-in draft has a full team (linked members + pending names). */
export function isPlayInDraftRosterComplete(
  selection: RegistrationSelectionInput,
  league: Pick<LeagueCatalogItem, 'format'>,
  memberOptionIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
): boolean {
  const expectedSize = expectedByotRosterSize(league);
  if (expectedSize == null) return false;
  return playInDraftRosterSize(selection, memberOptionIdByName, registeringCurlerMemberId) === expectedSize;
}

/** True when a play-in draft meets the minimum size to continue (may still be incomplete). */
export function isPlayInDraftRosterAtLeastMinimum(
  selection: RegistrationSelectionInput,
  league: Pick<LeagueCatalogItem, 'format'>,
  memberOptionIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
): boolean {
  const expectedSize = expectedByotRosterSize(league);
  if (expectedSize == null) return false;
  const minSize = Math.min(MIN_PLAY_IN_ROSTER_SIZE, expectedSize);
  return playInDraftRosterSize(selection, memberOptionIdByName, registeringCurlerMemberId) >= minSize;
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

const ROSTER_CAPABLE_SELECTION_TYPES = new Set<RegistrationSelectionType>([
  'guaranteed_return',
  'byot_request',
  'play_in_request',
  'third_league_interest',
  'waitlist_add',
  'waitlist_replace',
  'waitlist_add_auto_decline',
  'waitlist_replace_auto_decline',
]);

function rosterFieldsFromSelection(
  selection: RegistrationSelectionInput | undefined,
): Partial<Pick<RegistrationSelectionInput, 'byotTeammateText' | 'teamRosterPlacements'>> {
  if (!selection) return {};
  const hasRoster =
    Boolean(selection.byotTeammateText?.trim()) || Boolean(selection.teamRosterPlacements?.length);
  if (!hasRoster) return {};
  return {
    byotTeammateText: selection.byotTeammateText ?? null,
    teamRosterPlacements: selection.teamRosterPlacements ?? null,
  };
}

export function updateLeagueSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  selectionType: RegistrationSelectionType | 'none',
  options?: { rosterSource?: RegistrationSelectionInput[] },
): RegistrationSelectionInput[] {
  const rosterSource = options?.rosterSource ?? selections;
  const previous = rosterSource.find((selection) => selection.leagueId === leagueId);
  const withoutLeague = selections.filter((selection) => selection.leagueId !== leagueId);
  if (selectionType === 'none') return withoutLeague;
  if (selectionType === 'return_subject_to_availability') {
    const interestCount = withoutLeague.filter((selection) => isThirdLeagueInterestSelection(selection)).length;
    return [
      ...withoutLeague,
      {
        selectionType: 'third_league_interest',
        leagueId,
        rank: interestCount + 1,
        ...rosterFieldsFromSelection(previous),
      },
    ];
  }
  return [
    ...withoutLeague,
    {
      selectionType,
      leagueId,
      ...(ROSTER_CAPABLE_SELECTION_TYPES.has(selectionType) ? rosterFieldsFromSelection(previous) : {}),
    },
  ];
}

/**
 * Syncs checkbox "return to these leagues" choices for prior leagues on the Returning leagues step.
 * Standard checked leagues become guaranteed returns (max 2). Play-in checked leagues become
 * play_in_request and do not consume a protected-return slot. When more than two standard priors
 * exist and two guaranteed returns are selected, remaining standard leagues stay undecided unless
 * they already have drop / subject-to-availability choices. Unchecked play-in leagues are dropped.
 */
export function applyPriorReturnCheckboxLeagueIds(
  selections: RegistrationSelectionInput[],
  checkboxPriorLeagueIds: readonly number[],
  playInLeagueIds: ReadonlySet<number>,
  nextCheckedLeagueIds: readonly number[],
): RegistrationSelectionInput[] {
  const checkboxIdSet = new Set(checkboxPriorLeagueIds);
  const standardPriorLeagueIds = checkboxPriorLeagueIds.filter((leagueId) => !playInLeagueIds.has(leagueId));
  const previousGuaranteedReturnIds = new Set(
    selections
      .filter(
        (selection) =>
          selection.leagueId != null &&
          checkboxIdSet.has(selection.leagueId) &&
          !playInLeagueIds.has(selection.leagueId) &&
          selection.selectionType === 'guaranteed_return',
      )
      .map((selection) => selection.leagueId as number),
  );
  const uniqueCheckedIds = nextCheckedLeagueIds
    .filter((leagueId) => checkboxIdSet.has(leagueId))
    .filter((leagueId, index, all) => all.indexOf(leagueId) === index);
  const nextGuaranteedReturnIds = uniqueCheckedIds
    .filter((leagueId) => !playInLeagueIds.has(leagueId))
    .slice(0, 2);
  const nextPlayInCheckedIds = uniqueCheckedIds.filter((leagueId) => playInLeagueIds.has(leagueId));
  const nextGuaranteedReturnSet = new Set(nextGuaranteedReturnIds);
  const nextPlayInCheckedSet = new Set(nextPlayInCheckedIds);
  const needsFollowUp = standardPriorLeagueIds.length > 2 && nextGuaranteedReturnSet.size === 2;

  let next = selections.filter(
    (selection) => selection.leagueId == null || !checkboxIdSet.has(selection.leagueId),
  );

  for (const leagueId of checkboxPriorLeagueIds) {
    if (playInLeagueIds.has(leagueId)) {
      next = updateLeagueSelection(
        next,
        leagueId,
        nextPlayInCheckedSet.has(leagueId) ? 'play_in_request' : 'drop',
        { rosterSource: selections },
      );
      continue;
    }
    if (nextGuaranteedReturnSet.has(leagueId)) {
      next = updateLeagueSelection(next, leagueId, 'guaranteed_return', { rosterSource: selections });
      continue;
    }
    if (!needsFollowUp) {
      next = updateLeagueSelection(next, leagueId, 'drop');
      continue;
    }
    if (previousGuaranteedReturnIds.has(leagueId)) {
      // Just unchecked from a return slot — require an explicit follow-up choice.
      continue;
    }
    const existing = selections.find((selection) => selection.leagueId === leagueId);
    if (!existing) continue;
    if (existing.selectionType === 'drop') {
      next = updateLeagueSelection(next, leagueId, 'drop');
    } else if (isThirdLeagueInterestSelection(existing)) {
      next = updateLeagueSelection(next, leagueId, 'return_subject_to_availability', {
        rosterSource: selections,
      });
    }
  }

  return next;
}

export function updateWaitlistReplaceSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  replacesLeagueId: number,
): RegistrationSelectionInput[] {
  return updateWaitlistEntryDetails(selections, leagueId, {
    entryType: 'replace',
    replacesLeagueId,
  });
}

export function joinWaitlistSelection(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  input: {
    activeLeagueIds: number[];
    existingEntries?: Array<{ leagueId: number; entryType: WaitlistEntryIntent; status?: string | null }>;
    replaceOptions: Array<{ value: number }>;
  },
): { selections: RegistrationSelectionInput[]; pendingReplacePick: boolean } {
  const choices = waitlistEntryTypeChoices({
    activeLeagueIds: input.activeLeagueIds,
    selections,
    existingEntries: input.existingEntries,
    leagueId,
    replaceOptions: input.replaceOptions,
  });
  if (choices.length === 0) {
    return { selections, pendingReplacePick: false };
  }
  if (choices.length === 1 && choices[0] === 'add') {
    return {
      selections: updateWaitlistEntryDetails(selections, leagueId, { entryType: 'add', preference: 'auto_accept' }),
      pendingReplacePick: false,
    };
  }
  if (choices.length === 1 && choices[0] === 'replace') {
    if (input.replaceOptions.length === 1) {
      return {
        selections: updateWaitlistEntryDetails(selections, leagueId, {
          entryType: 'replace',
          replacesLeagueId: input.replaceOptions[0].value,
          preference: 'auto_accept',
        }),
        pendingReplacePick: false,
      };
    }
    return {
      selections: updateWaitlistEntryDetails(selections, leagueId, {
        entryType: 'replace',
        replacesLeagueId: null,
        preference: 'auto_accept',
      }),
      pendingReplacePick: true,
    };
  }
  // Both ADD and REPLACE are available — default to ADD; the card editor can switch.
  return {
    selections: updateWaitlistEntryDetails(selections, leagueId, { entryType: 'add', preference: 'auto_accept' }),
    pendingReplacePick: false,
  };
}

export function setThirdLeagueInterestSelections(
  selections: RegistrationSelectionInput[],
  leagueIds: number[],
  priorSeasonReturnLeagueIds: Set<number>,
): RegistrationSelectionInput[] {
  const selectedSet = new Set(leagueIds);
  const previousInterestByLeagueId = new Map(
    selections
      .filter((selection) => isThirdLeagueInterestSelection(selection) && selection.leagueId != null)
      .map((selection) => [selection.leagueId as number, selection]),
  );
  const nonInterest = selections.filter((selection) => !isThirdLeagueInterestSelection(selection));
  for (const leagueId of priorSeasonReturnLeagueIds) {
    const hadInterest = previousInterestByLeagueId.has(leagueId);
    const hasOtherSelection = nonInterest.some((selection) => selection.leagueId === leagueId);
    if (hadInterest && !selectedSet.has(leagueId) && !hasOtherSelection) {
      nonInterest.push({ selectionType: 'drop', leagueId });
    }
  }
  const interestSelections = leagueIds.map((leagueId, index) => {
    const previous = previousInterestByLeagueId.get(leagueId);
    return {
      selectionType: 'third_league_interest' as const,
      leagueId,
      rank: index + 1,
      byotTeammateText: previous?.byotTeammateText ?? null,
      teamRosterPlacements: previous?.teamRosterPlacements ?? null,
    };
  });
  return [...nonInterest, ...interestSelections];
}

function rerankStrictThirdLeagueInterestSelections(
  selections: RegistrationSelectionInput[],
): RegistrationSelectionInput[] {
  let rank = 1;
  return selections.map((selection) => {
    if (selection.selectionType !== 'third_league_interest') return selection;
    return { ...selection, rank: rank++ };
  });
}

function selectionHasByotRoster(selection: RegistrationSelectionInput | undefined): boolean {
  if (!selection) return false;
  return Boolean(selection.byotTeammateText?.trim()) || Boolean(selection.teamRosterPlacements?.length);
}

/**
 * Copy optional BYOT roster from a same-league guaranteed return (or other roster-bearing
 * selection) onto third-league interest rows that are still empty.
 */
export function syncThirdLeagueInterestRostersFromSiblingSelections(
  selections: RegistrationSelectionInput[],
): RegistrationSelectionInput[] {
  let changed = false;
  const next = selections.map((selection) => {
    if (selection.selectionType !== 'third_league_interest' || selection.leagueId == null) {
      return selection;
    }
    if (selectionHasByotRoster(selection)) return selection;
    const sibling = selections.find(
      (candidate) =>
        candidate.leagueId === selection.leagueId &&
        candidate.selectionType !== 'third_league_interest' &&
        selectionHasByotRoster(candidate),
    );
    if (!sibling) return selection;
    changed = true;
    return {
      ...selection,
      ...rosterFieldsFromSelection(sibling),
    };
  });
  return changed ? next : selections;
}

/** Toggle only `third_league_interest` rows (does not touch return_subject_to_availability). */
export function setStrictThirdLeagueInterestEnabled(
  selections: RegistrationSelectionInput[],
  leagueId: number,
  enabled: boolean,
  options?: { rosterFallback?: RegistrationSelectionInput },
): RegistrationSelectionInput[] {
  const withoutLeague = selections.filter(
    (selection) => !(selection.selectionType === 'third_league_interest' && selection.leagueId === leagueId),
  );
  if (!enabled) {
    return rerankStrictThirdLeagueInterestSelections(withoutLeague);
  }
  if (selections.some((selection) => selection.selectionType === 'third_league_interest' && selection.leagueId === leagueId)) {
    return syncThirdLeagueInterestRostersFromSiblingSelections(selections);
  }
  const maxRank = selections
    .filter((selection) => selection.selectionType === 'third_league_interest')
    .reduce((max, selection) => Math.max(max, selection.rank ?? 0), 0);
  const rosterSource =
    selections.find(
      (selection) =>
        selection.leagueId === leagueId &&
        selection.selectionType !== 'third_league_interest' &&
        selectionHasByotRoster(selection),
    ) ??
    selections.find(
      (selection) =>
        selection.selectionType === 'third_league_interest' &&
        selection.leagueId === leagueId &&
        selectionHasByotRoster(selection),
    ) ??
    options?.rosterFallback;
  return [
    ...withoutLeague,
    {
      selectionType: 'third_league_interest' as const,
      leagueId,
      rank: maxRank + 1,
      ...rosterFieldsFromSelection(rosterSource),
    },
  ];
}

/** When a play-in REPLACE target changes, move an existing third-league interest with it. */
export function migrateStrictThirdLeagueInterest(
  selections: RegistrationSelectionInput[],
  fromLeagueId: number | null,
  toLeagueId: number | null,
): RegistrationSelectionInput[] {
  if (fromLeagueId == null || fromLeagueId === toLeagueId) return selections;
  const fromInterest = selections.find(
    (selection) => selection.selectionType === 'third_league_interest' && selection.leagueId === fromLeagueId,
  );
  if (!fromInterest) return selections;
  let next = setStrictThirdLeagueInterestEnabled(selections, fromLeagueId, false);
  if (toLeagueId != null) {
    next = setStrictThirdLeagueInterestEnabled(next, toLeagueId, true, {
      rosterFallback: fromInterest,
    });
  }
  return next;
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
  return (
    isByotWaitlistSelection(selection) ||
    selection.selectionType === 'play_in_request' ||
    selection.selectionType === 'third_league_interest' ||
    selection.selectionType === 'guaranteed_return'
  );
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
  const fallbackType: WaitlistTeamMemberPlacement['entryType'] = selectionUsesReplacePlacement(selection)
    ? 'replace'
    : 'add';
  const fallbackReplaces = selectionUsesReplacePlacement(selection) ? selection.replacesLeagueId ?? null : null;
  const basePlacements: WaitlistTeamMemberPlacement[] = selection.teamRosterPlacements?.length
    ? syncPlacementsWithMembers(
        members,
        selection.teamRosterPlacements.map((placement) => ({
          memberId: placement.memberId,
          memberName: memberOptionById.get(placement.memberId)?.name ?? `Member #${placement.memberId}`,
          entryType: placement.entryType,
          replacesLeagueId: placement.replacesLeagueId ?? null,
        })),
      )
    : members.map((member) => {
        const isRegisteringCurler =
          registeringCurler.id != null && member.memberId === registeringCurler.id;
        return {
          ...member,
          entryType: isRegisteringCurler ? fallbackType : ('add' as const),
          replacesLeagueId: isRegisteringCurler && fallbackType === 'replace' ? fallbackReplaces : null,
        };
      });

  // Play-in REPLACE is chosen on the selection itself (not teammate placements). Keep the
  // registering curler's placement aligned so roster edits cannot clear replacesLeagueId.
  if (selection.selectionType === 'play_in_request' && registeringCurler.id != null) {
    return basePlacements.map((placement) => {
      if (placement.memberId !== registeringCurler.id) return placement;
      if (selection.replacesLeagueId != null) {
        return {
          ...placement,
          entryType: 'replace' as const,
          replacesLeagueId: selection.replacesLeagueId,
        };
      }
      return { ...placement, entryType: 'add' as const, replacesLeagueId: null };
    });
  }
  return basePlacements;
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
      // Selection-level REPLACE target is authoritative for play-in requests.
      replacesLeagueId: selection.replacesLeagueId ?? null,
      teamRosterPlacements: toPlacementPayload(placements),
    };
  }
  if (selection.selectionType === 'third_league_interest' || selection.selectionType === 'guaranteed_return') {
    return {
      ...selection,
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
    'Enter the full team roster for this bring-your-own-team waitlist.',
  );
}

export function firstPlayInRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
  skipRosterLeagueIds?: Set<number>,
): string | null {
  for (const selection of selections) {
    if (selection.leagueId == null) continue;
    if (!isPlayInRequestSelection(selection)) continue;
    if (skipRosterLeagueIds?.has(selection.leagueId)) continue;
    const league = leagues.find((item) => item.id === selection.leagueId);
    if (!league || league.leagueType !== 'bring_your_own_team') continue;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize == null) {
      return 'Enter a team roster for this play-in league.';
    }
    const pending = pendingByotRosterNames(selection, memberOptionIdByName, registeringCurler.id);
    if (pending.some((name) => !name.trim())) {
      return `Enter a name for each teammate not yet registered on ${league.name}.`;
    }
    const pendingLower = pending.map((name) => name.trim().toLowerCase());
    if (new Set(pendingLower).size !== pendingLower.length) {
      return `Teammate names must be unique on ${league.name}.`;
    }
    const size = playInDraftRosterSize(selection, memberOptionIdByName, registeringCurler.id);
    const minSize = Math.min(MIN_PLAY_IN_ROSTER_SIZE, expectedSize);
    if (size < minSize) {
      return `You must enter a roster for ${league.name} to continue.`;
    }
    if (size > expectedSize) {
      return `Too many teammates listed for ${league.name}.`;
    }
  }
  return null;
}

/** Play-in leagues with a valid but incomplete roster (min met, full team not yet listed). */
export function incompletePlayInLeagueNames(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionIdByName: Map<string, number>,
  registeringCurlerMemberId: number | null,
  skipRosterLeagueIds?: Set<number>,
): string[] {
  const names: string[] = [];
  for (const selection of selections) {
    if (selection.leagueId == null || !isPlayInRequestSelection(selection)) continue;
    if (skipRosterLeagueIds?.has(selection.leagueId)) continue;
    const league = leagues.find((item) => item.id === selection.leagueId);
    if (!league || league.leagueType !== 'bring_your_own_team') continue;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize == null) continue;
    const size = playInDraftRosterSize(selection, memberOptionIdByName, registeringCurlerMemberId);
    const minSize = Math.min(MIN_PLAY_IN_ROSTER_SIZE, expectedSize);
    if (size >= minSize && size < expectedSize) {
      names.push(league.name);
    }
  }
  return names;
}

/**
 * Optional BYOT roster (third-league interest or guaranteed return): empty is allowed;
 * if any teammates are listed, names must be unique and the total may not exceed size.
 */
export function firstOptionalByotRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
): string | null {
  for (const selection of selections) {
    if (selection.leagueId == null) continue;
    if (
      !isThirdLeagueInterestSelection(selection) &&
      selection.selectionType !== 'guaranteed_return'
    ) {
      continue;
    }
    const league = leagues.find((item) => item.id === selection.leagueId);
    if (!league || league.leagueType !== 'bring_your_own_team') continue;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize == null) continue;
    const pending = pendingByotRosterNames(selection, memberOptionIdByName, registeringCurler.id);
    if (pending.some((name) => !name.trim())) {
      return `Enter a name for each teammate not yet registered on ${league.name}.`;
    }
    const pendingLower = pending.map((name) => name.trim().toLowerCase());
    if (new Set(pendingLower).size !== pendingLower.length) {
      return `Teammate names must be unique on ${league.name}.`;
    }
    const size = playInDraftRosterSize(selection, memberOptionIdByName, registeringCurler.id);
    // registering curler alone with no teammates listed counts as no roster progress
    const teammateCount = size - (registeringCurler.id != null ? 1 : 0);
    if (teammateCount <= 0 && pending.length === 0) continue;
    if (size > expectedSize) {
      return `Too many teammates listed for ${league.name}.`;
    }
  }
  return null;
}

export function firstDirectLeagueRequestRosterValidationMessage(
  selections: RegistrationSelectionInput[],
  leagues: LeagueCatalogItem[],
  memberOptionById: Map<number, { name: string }>,
  memberOptionIdByName: Map<string, number>,
  registeringCurler: { id: number | null; name: string },
  /** Play-in leagues where the registrant is already on a declared entry team. */
  skipPlayInRosterLeagueIds?: Set<number>,
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
      memberOptionIdByName,
      registeringCurler,
      skipPlayInRosterLeagueIds,
    )
  );
}

export type { WaitlistTeamMemberPlacementOptions };
