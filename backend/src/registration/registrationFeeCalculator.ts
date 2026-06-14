import { validateDiscountClaims } from './registrationEligibility.js';
import type { DecisionMessage } from './registrationDecisionTypes.js';
import { getSelectionLeague, type RegistrationContext, type RegistrationInvoiceLineKind } from './registrationContext.js';

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
};

function positiveMinor(value: number): number {
  return Math.max(0, Math.round(value));
}

const REAL_LEAGUE_SELECTION_TYPES = new Set([
  'guaranteed_return',
  'return_subject_to_availability',
  'waitlist_add',
  'waitlist_replace',
  'byot_request',
  'play_in_request',
  'instructional_join',
]);

/**
 * A curler gets the basic (spare-only) ice privilege fee when they explicitly chose basic ice
 * (regular_spare_only), or when they chose league play but only selected fee-0 leagues, which is
 * equivalent to basic ice. In the latter case the fee is added silently.
 */
function qualifiesForSpareOnlyIce(context: RegistrationContext): boolean {
  if (context.membershipOption === 'regular_spare_only') return true;
  if (context.membershipOption !== 'regular') return false;
  const realSelections = context.selections.filter(
    (selection) => selection.leagueId != null && REAL_LEAGUE_SELECTION_TYPES.has(selection.selectionType)
  );
  if (realSelections.length === 0) return false;
  return realSelections.every((selection) => (context.leagues[selection.leagueId!]?.registrationFeeMinor ?? 0) === 0);
}

function addCharge(
  lineItems: RegistrationFeeLineItem[],
  input: Omit<RegistrationFeeLineItem, 'amountMinor'> & { amountMinor: number }
): void {
  const amountMinor = positiveMinor(input.amountMinor);
  if (amountMinor === 0) return;
  lineItems.push({ ...input, amountMinor });
}

function applyDiscountToRemaining(input: {
  remainingByIndex: Map<number, number>;
  lineItems: RegistrationFeeLineItem[];
  scope: 'eligible_invoice_items' | 'regular_membership';
  requestedAmountMinor: number;
}): number {
  let remainingDiscount = positiveMinor(input.requestedAmountMinor);
  let applied = 0;
  for (let index = 0; index < input.lineItems.length && remainingDiscount > 0; index += 1) {
    const lineItem = input.lineItems[index];
    if (!lineItem.discountEligible) continue;
    if (input.scope === 'regular_membership' && lineItem.lineType !== 'regular_membership_fee') continue;

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
  scope: 'eligible_invoice_items' | 'regular_membership'
): number {
  return lineItems.reduce((sum, lineItem, index) => {
    if (!lineItem.discountEligible) return sum;
    if (scope === 'regular_membership' && lineItem.lineType !== 'regular_membership_fee') return sum;
    return sum + (remainingByIndex.get(index) ?? 0);
  }, 0);
}

function addOrdinaryDiscounts(context: RegistrationContext, lineItems: RegistrationFeeLineItem[]): RegistrationFeeLineItem[] {
  const discountLineItems: RegistrationFeeLineItem[] = [];
  const remainingByIndex = new Map<number, number>();
  lineItems.forEach((lineItem, index) => {
    remainingByIndex.set(index, lineItem.discountEligible ? lineItem.amountMinor : 0);
  });

  const ordinaryDiscounts = [
    {
      claimed: context.discountClaims.student?.claimed === true,
      valid: Boolean(context.discountClaims.student?.institution?.trim()),
      lineType: 'student_discount' as const,
      description: 'Student discount',
      scope: 'eligible_invoice_items' as const,
      slot: context.discountSettings.student,
    },
    {
      claimed: context.discountClaims.reciprocal?.claimed === true,
      valid: Boolean(context.discountClaims.reciprocal?.clubName?.trim()),
      lineType: 'reciprocal_discount' as const,
      description: 'Reciprocal club discount',
      scope: 'eligible_invoice_items' as const,
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

function addSelectionCharges(context: RegistrationContext, lineItems: RegistrationFeeLineItem[]): void {
  for (const selection of context.selections) {
    const league = getSelectionLeague(context, selection);
    if (
      league &&
      ['guaranteed_return', 'byot_request', 'play_in_request', 'instructional_join'].includes(selection.selectionType)
    ) {
      addCharge(lineItems, {
        lineType: 'league_fee',
        description: `${league.name} league fee`,
        amountMinor: league.registrationFeeMinor,
        discountEligible: league.discountEligible !== false,
        relatedLeagueId: league.id,
        discountScope: 'eligible_invoice_items',
      });
    }
    if (league && selection.selectionType === 'sabbatical') {
      addCharge(lineItems, {
        lineType: 'sabbatical_fee',
        description: `${league.name} sabbatical fee`,
        amountMinor: context.priceConfig.sabbaticalFeeMinor,
        discountEligible: false,
        relatedLeagueId: league.id,
      });
    }
  }
}

function addSabbaticalFillDiscounts(context: RegistrationContext): RegistrationFeeLineItem[] {
  const discountLineItems: RegistrationFeeLineItem[] = [];
  for (const selection of context.selections) {
    const league = getSelectionLeague(context, selection);
    if (!league || !selection.isTemporarySabbaticalFill) continue;
    discountLineItems.push({
      lineType: 'sabbatical_fill_discount',
      description: `${league.name} temporary sabbatical-fill discount`,
      amountMinor: -positiveMinor(context.priceConfig.sabbaticalFeeMinor),
      discountEligible: false,
      relatedLeagueId: league.id,
    });
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
  };
}

export function calculateRegistrationFees(context: RegistrationContext): RegistrationFeePreview {
  if (context.registrant.hasLifetimeMembership) {
    return zeroRegistrationFeePreview();
  }

  const lineItems: RegistrationFeeLineItem[] = [];
  const blockingErrors = validateDiscountClaims(context).blockingErrors;

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
  if (qualifiesForSpareOnlyIce(context)) {
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

  addSelectionCharges(context, lineItems);

  const ordinaryDiscounts = context.isSocialToRegularUpgrade ? [] : addOrdinaryDiscounts(context, lineItems);
  const sabbaticalFillDiscounts = addSabbaticalFillDiscounts(context);
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

  return {
    lineItems,
    discountLineItems,
    subtotalMinor,
    discountTotalMinor,
    totalDueMinor: Math.max(0, subtotalMinor - discountTotalMinor),
    discountEligibleSubtotalMinor,
    nonDiscountableSubtotalMinor,
    blockingErrors,
    warnings: [],
  };
}
