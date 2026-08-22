import { validateDiscountClaims } from './registrationEligibility.js';
import type { DecisionMessage } from './registrationDecisionTypes.js';
import { evaluateLeaguePriorities, type LeaguePriorityEvaluation } from './leaguePriorityEvaluation.js';
import { immediateChargeEntries } from './leaguePriorityRules.js';
import {
  getLeague,
  getSelectionLeague,
  type RegistrationContext,
  type RegistrationInvoiceLineKind,
} from './registrationContext.js';
import { parseNameTagReplacementQuantity, replacementNameTagLineDescription } from '../utils/nameTag.js';

export type RegistrationFeeLineItem = {
  lineType: RegistrationInvoiceLineKind;
  description: string;
  amountMinor: number;
  discountEligible: boolean;
  relatedLeagueId?: number;
  discountScope?: 'eligible_invoice_items' | 'regular_membership';
};

export type RegistrationFeePreview = {
  lineItems: RegistrationFeeLineItem[];
  discountLineItems: RegistrationFeeLineItem[];
  subtotalMinor: number;
  discountTotalMinor: number;
  totalDueMinor: number;
  discountEligibleSubtotalMinor: number;
  nonDiscountableSubtotalMinor: number;
  blockingErrors: DecisionMessage[];
  warnings: DecisionMessage[];
  /**
   * What the registrant could still owe if every league they asked for comes
   * through, up to their desired league count. Equal to `totalDueMinor` when
   * every wanted league is already guaranteed.
   */
  estimatedMaximumTotalDueMinor: number;
};

function positiveMinor(value: number): number {
  return Math.max(0, Math.round(value));
}

/**
 * A curler gets the basic (spare-only) ice privilege fee when they explicitly chose basic ice
 * (regular_spare_only), or when they chose league play but every league they are being charged for
 * is free, which is equivalent to basic ice. In the latter case the fee is added silently.
 */
function qualifiesForSpareOnlyIce(context: RegistrationContext, chargedLeagueIds: number[]): boolean {
  if (context.membershipOption === 'regular_spare_only') return true;
  if (context.membershipOption !== 'regular') return false;
  if (chargedLeagueIds.length === 0) return false;
  return chargedLeagueIds.every((leagueId) => (context.leagues[leagueId]?.registrationFeeMinor ?? 0) === 0);
}

/**
 * The leagues that widen the estimate ceiling: the most expensive entries the
 * registrant could still be placed into, up to their desired league count.
 * Most expensive rather than next-by-priority so the quote is a true maximum.
 */
function ceilingLeagueIds(evaluation: LeaguePriorityEvaluation, chargedLeagueIds: number[]): number[] {
  const charged = new Set(chargedLeagueIds);
  const remainingSlots = Math.max(0, evaluation.desiredLeagueCount - chargedLeagueIds.length);
  return evaluation.entries
    .filter((entry) => !charged.has(entry.leagueId))
    .sort((a, b) => b.feeMinor - a.feeMinor)
    .slice(0, remainingSlots)
    .map((entry) => entry.leagueId);
}

function addCharge(
  lineItems: RegistrationFeeLineItem[],
  input: Omit<RegistrationFeeLineItem, 'amountMinor'> & { amountMinor: number }
): void {
  const amountMinor = positiveMinor(input.amountMinor);
  if (amountMinor === 0) return;
  lineItems.push({ ...input, amountMinor });
}

function addReplacementNameTagCharge(context: RegistrationContext, lineItems: RegistrationFeeLineItem[]): void {
  const quantity = parseNameTagReplacementQuantity(context.nameTagReplacementQuantity);
  if (quantity !== 1 && quantity !== 2 && quantity !== 3) return;
  addCharge(lineItems, {
    lineType: 'replacement_name_tag_fee',
    description: replacementNameTagLineDescription(quantity),
    amountMinor: context.priceConfig.replacementNameTagFeeMinor * quantity,
    discountEligible: false,
  });
}

type DiscountApplicationScope = 'eligible_invoice_items' | 'regular_membership' | 'eligible_non_membership';

function lineItemMatchesDiscountScope(
  lineItem: RegistrationFeeLineItem,
  scope: DiscountApplicationScope,
): boolean {
  if (!lineItem.discountEligible) return false;
  if (scope === 'regular_membership') return lineItem.lineType === 'regular_membership_fee';
  if (scope === 'eligible_non_membership') return lineItem.lineType !== 'regular_membership_fee';
  return true;
}

function applyDiscountToRemaining(input: {
  remainingByIndex: Map<number, number>;
  lineItems: RegistrationFeeLineItem[];
  scope: DiscountApplicationScope;
  requestedAmountMinor: number;
}): number {
  let remainingDiscount = positiveMinor(input.requestedAmountMinor);
  let applied = 0;
  for (let index = 0; index < input.lineItems.length && remainingDiscount > 0; index += 1) {
    const lineItem = input.lineItems[index];
    if (!lineItemMatchesDiscountScope(lineItem, input.scope)) continue;

    const currentRemaining = input.remainingByIndex.get(index) ?? 0;
    const lineDiscount = Math.min(currentRemaining, remainingDiscount);
    input.remainingByIndex.set(index, currentRemaining - lineDiscount);
    remainingDiscount -= lineDiscount;
    applied += lineDiscount;
  }
  return applied;
}

function remainingSubtotalForScope(
  lineItems: RegistrationFeeLineItem[],
  remainingByIndex: Map<number, number>,
  scope: DiscountApplicationScope,
): number {
  return lineItems.reduce((sum, lineItem, index) => {
    if (!lineItemMatchesDiscountScope(lineItem, scope)) return sum;
    return sum + (remainingByIndex.get(index) ?? 0);
  }, 0);
}

function addOrdinaryDiscounts(context: RegistrationContext, lineItems: RegistrationFeeLineItem[]): RegistrationFeeLineItem[] {
  const discountLineItems: RegistrationFeeLineItem[] = [];
  const remainingByIndex = new Map<number, number>();
  lineItems.forEach((lineItem, index) => {
    remainingByIndex.set(index, lineItem.discountEligible ? lineItem.amountMinor : 0);
  });

  const studentClaimed = context.discountClaims.student?.claimed === true;
  const studentValid = Boolean(context.discountClaims.student?.institution?.trim());
  const studentSlot = context.discountSettings.student;

  const ordinaryDiscounts = [
    {
      claimed: studentClaimed,
      valid: studentValid,
      lineType: 'student_discount' as const,
      description: 'Student discount (membership)',
      scope: 'regular_membership' as const,
      slot: studentSlot,
    },
    {
      claimed: studentClaimed && studentSlot.amountType === 'percent',
      valid: studentValid,
      lineType: 'student_league_discount' as const,
      description: 'Student discount (leagues)',
      scope: 'eligible_non_membership' as const,
      slot: studentSlot,
    },
    {
      claimed: context.discountClaims.reciprocal?.claimed === true,
      valid: Boolean(context.discountClaims.reciprocal?.clubName?.trim()),
      lineType: 'reciprocal_discount' as const,
      description: 'Reciprocal club discount',
      scope:
        context.discountSettings.reciprocal.amountType === 'dollar'
          ? ('regular_membership' as const)
          : ('eligible_invoice_items' as const),
      slot: context.discountSettings.reciprocal,
    },
    {
      claimed: !context.isFirstSessionOfSeason && context.discountClaims.winterOnly?.claimed !== false,
      valid: true,
      lineType: 'winter_only_discount' as const,
      description: 'Winter-only discount',
      scope: 'regular_membership' as const,
      slot: context.discountSettings.winterOnly,
    },
  ];

  for (const discount of ordinaryDiscounts.filter((item) => item.claimed && item.valid && item.slot.amountType === 'dollar')) {
    const amountMinor = applyDiscountToRemaining({
      remainingByIndex,
      lineItems,
      scope: discount.scope,
      requestedAmountMinor: discount.slot.amountValue,
    });
    if (amountMinor > 0) {
      discountLineItems.push({
        lineType: discount.lineType,
        description: discount.description,
        amountMinor: -amountMinor,
        discountEligible: false,
      });
    }
  }

  for (const discount of ordinaryDiscounts.filter((item) => item.claimed && item.valid && item.slot.amountType === 'percent')) {
    const scopeRemaining = remainingSubtotalForScope(lineItems, remainingByIndex, discount.scope);
    const amountMinor = Math.round((scopeRemaining * discount.slot.amountValue) / 100);
    const appliedAmountMinor = applyDiscountToRemaining({
      remainingByIndex,
      lineItems,
      scope: discount.scope,
      requestedAmountMinor: amountMinor,
    });
    if (appliedAmountMinor > 0) {
      discountLineItems.push({
        lineType: discount.lineType,
        description: discount.description,
        amountMinor: -appliedAmountMinor,
        discountEligible: false,
      });
    }
  }

  return discountLineItems;
}

function addLeagueCharges(
  context: RegistrationContext,
  lineItems: RegistrationFeeLineItem[],
  chargedLeagueIds: number[],
): void {
  for (const leagueId of chargedLeagueIds) {
    const league = getLeague(context, leagueId);
    if (!league) continue;
    addCharge(lineItems, {
      lineType: 'league_fee',
      description: `${league.name} league fee`,
      amountMinor: league.registrationFeeMinor,
      discountEligible: league.discountEligible !== false,
      relatedLeagueId: league.id,
      discountScope: 'eligible_invoice_items',
    });
  }

  for (const selection of context.selections) {
    if (selection.selectionType !== 'sabbatical') continue;
    const league = getSelectionLeague(context, selection);
    if (!league) continue;
    addCharge(lineItems, {
      lineType: 'sabbatical_fee',
      description: `${league.name} sabbatical fee`,
      amountMinor: context.priceConfig.sabbaticalFeeMinor,
      discountEligible: false,
      relatedLeagueId: league.id,
    });
  }
}

function addSabbaticalFillDiscounts(
  context: RegistrationContext,
  chargedLeagueIds: number[],
  temporaryFillLeagueIds: number[] = [],
): RegistrationFeeLineItem[] {
  const discountLineItems: RegistrationFeeLineItem[] = [];
  const addedLeagueIds = new Set<number>();
  const amountMinor = -positiveMinor(context.priceConfig.sabbaticalFeeMinor);
  if (amountMinor === 0) return discountLineItems;

  const pushDiscount = (league: { id: number; name: string }) => {
    if (addedLeagueIds.has(league.id)) return;
    addedLeagueIds.add(league.id);
    discountLineItems.push({
      lineType: 'sabbatical_fill_discount',
      description: `${league.name} temporary sabbatical-fill discount`,
      amountMinor,
      discountEligible: false,
      relatedLeagueId: league.id,
    });
  };

  for (const selection of context.selections) {
    const league = getSelectionLeague(context, selection);
    if (!league || !selection.isTemporarySabbaticalFill) continue;
    pushDiscount(league);
  }

  const charged = new Set(chargedLeagueIds);
  for (const leagueId of temporaryFillLeagueIds) {
    if (!charged.has(leagueId)) continue;
    const league = getLeague(context, leagueId);
    if (!league) continue;
    pushDiscount(league);
  }
  for (const entry of evaluateLeaguePriorities(context).entries) {
    if (entry.label !== 'temporary_spot_available' || !charged.has(entry.leagueId)) continue;
    const league = getLeague(context, entry.leagueId);
    if (!league) continue;
    pushDiscount(league);
  }

  return discountLineItems;
}

function zeroRegistrationFeePreview(): RegistrationFeePreview {
  return {
    lineItems: [],
    discountLineItems: [],
    subtotalMinor: 0,
    discountTotalMinor: 0,
    totalDueMinor: 0,
    discountEligibleSubtotalMinor: 0,
    nonDiscountableSubtotalMinor: 0,
    blockingErrors: [],
    warnings: [],
    estimatedMaximumTotalDueMinor: 0,
  };
}

function computePreview(
  context: RegistrationContext,
  chargedLeagueIds: number[],
  temporaryFillLeagueIds: number[] = [],
): RegistrationFeePreview {
  const lineItems: RegistrationFeeLineItem[] = [];
  const skipOrdinaryDiscounts =
    context.membershipOption === 'junior_recreational' || context.membershipOption === 'social';
  const blockingErrors = skipOrdinaryDiscounts ? [] : validateDiscountClaims(context).blockingErrors;

  if (context.membershipOption === 'regular' || context.membershipOption === 'regular_spare_only') {
    addCharge(lineItems, {
      lineType: 'regular_membership_fee',
      description: 'Regular membership',
      amountMinor: context.priceConfig.regularMembershipFeeMinor,
      discountEligible: context.isSocialToRegularUpgrade !== true,
      discountScope: 'regular_membership',
    });
  }
  if (context.membershipOption === 'social') {
    addCharge(lineItems, {
      lineType: 'social_membership_fee',
      description: 'Social membership',
      amountMinor: context.priceConfig.socialMembershipFeeMinor,
      discountEligible: false,
    });
  }
  if (qualifiesForSpareOnlyIce(context, chargedLeagueIds)) {
    addCharge(lineItems, {
      lineType: 'spare_only_fee',
      description: 'Basic ice privileges',
      amountMinor: context.priceConfig.spareOnlyIcePrivilegeFeeMinor,
      discountEligible: context.isSocialToRegularUpgrade !== true,
      discountScope: 'eligible_invoice_items',
    });
  }
  if (context.membershipOption === 'junior_recreational') {
    addCharge(lineItems, {
      lineType: 'junior_recreational_fee',
      description: 'Junior Recreational program',
      amountMinor: context.priceConfig.juniorRecreationalFeeMinor,
      discountEligible: false,
    });
  }

  addLeagueCharges(context, lineItems, chargedLeagueIds);
  addReplacementNameTagCharge(context, lineItems);

  const ordinaryDiscounts =
    context.isSocialToRegularUpgrade || skipOrdinaryDiscounts ? [] : addOrdinaryDiscounts(context, lineItems);
  const sabbaticalFillDiscounts = addSabbaticalFillDiscounts(
    context,
    chargedLeagueIds,
    temporaryFillLeagueIds,
  );
  const assistancePercent =
    context.membershipOption === 'junior_recreational' &&
    (context.juniorAssistance?.status === 'approved' || context.juniorAssistance?.status === 'partially_approved')
      ? positiveMinor(context.juniorAssistance.approvedPercent ?? 0)
      : 0;
  const financialAssistanceDiscounts: RegistrationFeeLineItem[] =
    assistancePercent > 0
      ? [
          {
            lineType: 'financial_assistance_discount',
            description: 'Junior Recreational financial assistance',
            amountMinor: -Math.round((context.priceConfig.juniorRecreationalFeeMinor * assistancePercent) / 100),
            discountEligible: false,
          },
        ]
      : [];

  const discountLineItems = [...ordinaryDiscounts, ...sabbaticalFillDiscounts, ...financialAssistanceDiscounts];
  const subtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const discountTotalMinor = discountLineItems.reduce((sum, item) => sum + Math.abs(item.amountMinor), 0);
  const discountEligibleSubtotalMinor = lineItems
    .filter((item) => item.discountEligible)
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const nonDiscountableSubtotalMinor = subtotalMinor - discountEligibleSubtotalMinor;

  const totalDueMinor = Math.max(0, subtotalMinor - discountTotalMinor);

  return {
    lineItems,
    discountLineItems,
    subtotalMinor,
    discountTotalMinor,
    totalDueMinor,
    discountEligibleSubtotalMinor,
    nonDiscountableSubtotalMinor,
    blockingErrors,
    warnings: [],
    estimatedMaximumTotalDueMinor: totalDueMinor,
  };
}

/**
 * Fees for what the registrant is committed to today: membership, sabbaticals,
 * guaranteed leagues, and available or temporary-fill spots. Waitlisted,
 * play-in-pending, and subject-to-availability leagues are not billed; they
 * only widen `estimatedMaximumTotalDueMinor`.
 */
export function calculateRegistrationFees(
  context: RegistrationContext,
  options?: {
    /**
     * Bill exactly these leagues instead of the guaranteed ones. Used once
     * placement is settled, when the registrant owes for the leagues they were
     * actually placed into rather than the ones they were promised.
     */
    chargedLeagueIds?: number[];
    /** Leagues already placed as temporary sabbatical fills. */
    temporaryFillLeagueIds?: number[];
  },
): RegistrationFeePreview {
  if (context.registrant.hasLifetimeMembership) {
    const lineItems: RegistrationFeeLineItem[] = [];
    addReplacementNameTagCharge(context, lineItems);
    const subtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
    return {
      ...zeroRegistrationFeePreview(),
      lineItems,
      subtotalMinor,
      totalDueMinor: subtotalMinor,
      nonDiscountableSubtotalMinor: subtotalMinor,
      estimatedMaximumTotalDueMinor: subtotalMinor,
    };
  }

  if (options?.chargedLeagueIds) {
    return computePreview(context, options.chargedLeagueIds, options.temporaryFillLeagueIds);
  }

  const evaluation = evaluateLeaguePriorities(context);
  const billedLeagueIds = immediateChargeEntries(evaluation).map((entry) => entry.leagueId);
  const confirmed = computePreview(context, billedLeagueIds);

  const ceiling = ceilingLeagueIds(evaluation, billedLeagueIds);
  if (ceiling.length === 0) return confirmed;

  const maximum = computePreview(context, [...billedLeagueIds, ...ceiling]);
  return {
    ...confirmed,
    estimatedMaximumTotalDueMinor: Math.max(confirmed.totalDueMinor, maximum.totalDueMinor),
  };
}
