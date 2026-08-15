type RegistrationDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

export type RegistrationDiscountClaims = {
  studentDiscountClaimed: boolean;
  reciprocalDiscountClaimed: boolean;
  availableDiscounts?: {
    student: RegistrationDiscountSlot;
    reciprocal: RegistrationDiscountSlot;
  };
};

function applyDiscountSlot(
  feeMinor: number,
  slot: RegistrationDiscountSlot,
  applyDollarDiscounts: boolean,
): number {
  if (slot.amountType === 'percent') {
    return Math.max(0, feeMinor - Math.round((feeMinor * slot.value) / 100));
  }
  if (!applyDollarDiscounts) return feeMinor;
  return Math.max(0, feeMinor - Math.round(slot.value * 100));
}

function applyClaimedDiscounts(
  baseFeeMinor: number,
  input: RegistrationDiscountClaims,
  applyDollarDiscounts: boolean,
): number {
  let fee = baseFeeMinor;
  const discounts = input.availableDiscounts;
  if (!discounts) return fee;
  if (input.studentDiscountClaimed) {
    fee = applyDiscountSlot(fee, discounts.student, applyDollarDiscounts);
  }
  if (input.reciprocalDiscountClaimed) {
    fee = applyDiscountSlot(fee, discounts.reciprocal, applyDollarDiscounts);
  }
  return fee;
}

/** League and other non-membership prices: percentage discounts only. */
export function computeDiscountedEligibleFeeMinor(
  baseFeeMinor: number,
  input: RegistrationDiscountClaims,
  discountEligible = true,
): number {
  if (!discountEligible) return baseFeeMinor;
  return applyClaimedDiscounts(baseFeeMinor, input, false);
}

export function computeDiscountedRegularMembershipFeeMinor(input: {
  baseRegularMinor: number;
  studentDiscountClaimed: boolean;
  reciprocalDiscountClaimed: boolean;
  availableDiscounts?: {
    student: RegistrationDiscountSlot;
    reciprocal: RegistrationDiscountSlot;
  };
}): number {
  return applyClaimedDiscounts(input.baseRegularMinor, input, true);
}
