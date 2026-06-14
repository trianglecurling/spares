type RegistrationDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

function applyDiscountSlot(feeMinor: number, slot: RegistrationDiscountSlot): number {
  if (slot.amountType === 'percent') {
    return Math.max(0, feeMinor - Math.round((feeMinor * slot.value) / 100));
  }
  return Math.max(0, feeMinor - Math.round(slot.value * 100));
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
  let fee = input.baseRegularMinor;
  const discounts = input.availableDiscounts;
  if (!discounts) return fee;
  if (input.studentDiscountClaimed) {
    fee = applyDiscountSlot(fee, discounts.student);
  }
  if (input.reciprocalDiscountClaimed) {
    fee = applyDiscountSlot(fee, discounts.reciprocal);
  }
  return fee;
}
