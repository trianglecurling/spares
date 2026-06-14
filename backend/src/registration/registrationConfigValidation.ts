import { validateHalfYearExperienceValue } from './curlingExperienceYears.js';

/** Resolved cents charged for a league in registration (override or club default). */
export function effectiveLeagueRegistrationFeeMinor(
  registrationFeeOverrideMinor: number | null | undefined,
  defaultLeagueFeeMinor: number
): number {
  const d = Math.max(0, Math.round(defaultLeagueFeeMinor));
  if (registrationFeeOverrideMinor === null || registrationFeeOverrideMinor === undefined) return d;
  return Math.max(0, Math.round(registrationFeeOverrideMinor));
}

export type LeagueRegistrationSettingsInput = {
  id?: number;
  format?: 'teams' | 'doubles' | 'instructional';
  leagueType: 'standard' | 'bring_your_own_team';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  /** When null, club default league fee from registration prices applies. */
  registrationFeeOverrideMinor: number | null;
  minExperienceYears?: number | null;
  maxExperienceYears?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  firstDayOfPlay?: string | null;
  lastDayOfPlay?: string | null;
  allowsWaitlist: boolean;
  isPlayInBased?: boolean;
  hasAttachedWaitlist?: boolean;
  allowsSabbatical: boolean;
  predecessorLeagueId?: number | null;
  successorLeagueId?: number | null;
};

export type LeagueContinuityRow = {
  id: number;
  predecessorLeagueId: number | null;
  successorLeagueId?: number | null;
};

export type PriceConfigInput = {
  regularMembershipFeeMinor: number;
  socialMembershipFeeMinor: number;
  spareOnlyIcePrivilegeFeeMinor: number;
  sabbaticalFeeMinor: number;
  juniorRecreationalFeeMinor: number;
  /** Default league registration fee (cents); leagues may override per-league. */
  defaultLeagueFeeMinor: number;
};

export type DiscountAmountType = 'dollar' | 'percent';

export type RegistrationDiscountSlotStored = {
  amountType: DiscountAmountType;
  /** Cents when dollar; whole-number percent (0–100) when percent */
  amountValue: number;
};

export type RegistrationDiscountSettingsStored = {
  student: RegistrationDiscountSlotStored;
  reciprocal: RegistrationDiscountSlotStored;
  winterOnly: RegistrationDiscountSlotStored;
};

export class RegistrationConfigValidationError extends Error {
  details: Record<string, string>;

  constructor(details: Record<string, string>) {
    super('Registration configuration validation failed');
    this.name = 'RegistrationConfigValidationError';
    this.details = details;
  }
}

function assertNoErrors(details: Record<string, string>): void {
  if (Object.keys(details).length > 0) {
    throw new RegistrationConfigValidationError(details);
  }
}

function compareDateLike(a: string, b: string): number {
  return a.localeCompare(b);
}

function isNegative(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && value < 0;
}

export function assertValidDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  fieldPrefix = 'dateRange'
): void {
  if (!start || !end || compareDateLike(start, end) <= 0) return;
  throw new RegistrationConfigValidationError({
    [fieldPrefix]: 'Start date must be on or before end date.',
  });
}

export function assertSessionWithinSeason(input: {
  sessionSeasonId: number;
  selectedSeasonId: number;
  sessionStartDate?: string | null;
  sessionEndDate?: string | null;
  seasonStartDate?: string | null;
  seasonEndDate?: string | null;
}): void {
  const details: Record<string, string> = {};
  if (input.sessionSeasonId !== input.selectedSeasonId) {
    details.sessionId = 'Selected session must belong to the selected season.';
  }
  if (
    input.sessionStartDate &&
    input.seasonStartDate &&
    compareDateLike(input.sessionStartDate, input.seasonStartDate) < 0
  ) {
    details.startDate = 'Session start date must be within the selected season.';
  }
  if (
    input.sessionEndDate &&
    input.seasonEndDate &&
    compareDateLike(input.sessionEndDate, input.seasonEndDate) > 0
  ) {
    details.endDate = 'Session end date must be within the selected season.';
  }
  assertNoErrors(details);
}

export function assertRegistrationStateTransition(input: { effectiveAt: string }): void {
  const trimmed = input.effectiveAt?.trim();
  if (!trimmed) {
    throw new RegistrationConfigValidationError({ effectiveAt: 'Effective date and time are required.' });
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new RegistrationConfigValidationError({ effectiveAt: 'Effective date and time must be a valid timestamp.' });
  }
}

export function assertValidLeagueRegistrationSettings(input: LeagueRegistrationSettingsInput): void {
  const details: Record<string, string> = {};

  if (input.id !== undefined && input.predecessorLeagueId === input.id) {
    details.predecessorLeagueId = 'A league cannot be its own predecessor.';
  }
  if (input.id !== undefined && input.successorLeagueId === input.id) {
    details.successorLeagueId = 'A league cannot be its own successor.';
  }
  if (isNegative(input.capacityValue)) {
    details.capacityValue = 'Capacity cannot be negative.';
  }
  if (isNegative(input.registrationFeeOverrideMinor)) {
    details.registrationFeeOverrideMinor = 'League fee override cannot be negative.';
  }
  const minExperienceError = validateHalfYearExperienceValue(input.minExperienceYears, 'Minimum experience years');
  if (minExperienceError) {
    details.minExperienceYears = minExperienceError;
  }
  const maxExperienceError = validateHalfYearExperienceValue(input.maxExperienceYears, 'Maximum experience years');
  if (maxExperienceError) {
    details.maxExperienceYears = maxExperienceError;
  }
  if (
    input.minExperienceYears != null &&
    input.maxExperienceYears != null &&
    input.maxExperienceYears < input.minExperienceYears
  ) {
    details.maxExperienceYears = 'Maximum experience years cannot be less than minimum experience years.';
  }
  if (
    input.minAge !== null &&
    input.minAge !== undefined &&
    input.maxAge !== null &&
    input.maxAge !== undefined &&
    input.maxAge < input.minAge
  ) {
    details.maxAge = 'Maximum age cannot be less than minimum age.';
  }
  if (
    input.firstDayOfPlay &&
    input.lastDayOfPlay &&
    compareDateLike(input.firstDayOfPlay, input.lastDayOfPlay) > 0
  ) {
    details.lastDayOfPlay = 'Last day of play must be on or after first day of play.';
  }
  if (input.leagueType === 'bring_your_own_team') {
    if (input.allowsSabbatical) {
      details.allowsSabbatical = 'Bring-your-own-team leagues cannot use sabbaticals.';
    }
    if (input.capacityType !== 'team') {
      details.capacityType = 'Bring-your-own-team leagues must use team capacity.';
    }
  }
  if (input.leagueType === 'standard' && input.capacityType !== 'individual') {
    details.capacityType = 'Standard leagues must use individual capacity.';
  }

  const isPlayInBased = input.isPlayInBased === true;
  const hasAttachedWaitlist =
    input.hasAttachedWaitlist === true ||
    (input.hasAttachedWaitlist === undefined && input.allowsWaitlist === true);
  if (input.format === 'instructional' && isPlayInBased) {
    details.isPlayInBased = 'Instructional leagues cannot be play-in based.';
  }
  if (hasAttachedWaitlist && isPlayInBased) {
    details.isPlayInBased = 'A league cannot use both a waitlist and play-in based registration.';
  }

  assertNoErrors(details);
}

export function assertNoLeagueContinuityCycle(rows: LeagueContinuityRow[]): void {
  const predecessorByLeagueId = new Map<number, number | null>();
  for (const row of rows) {
    if (row.predecessorLeagueId === row.id) {
      throw new RegistrationConfigValidationError({
        predecessorLeagueId: 'A league cannot be its own predecessor.',
      });
    }
    if (row.successorLeagueId === row.id) {
      throw new RegistrationConfigValidationError({
        successorLeagueId: 'A league cannot be its own successor.',
      });
    }
    predecessorByLeagueId.set(row.id, row.predecessorLeagueId);
  }

  for (const row of rows) {
    const seen = new Set<number>();
    let current: number | null | undefined = row.id;
    while (current !== null && current !== undefined) {
      if (seen.has(current)) {
        throw new RegistrationConfigValidationError({
          predecessorLeagueId: 'League predecessor/successor links cannot form a circular chain.',
        });
      }
      seen.add(current);
      current = predecessorByLeagueId.get(current);
    }
  }
}

export function assertValidPriceConfig(input: PriceConfigInput): void {
  const details: Record<string, string> = {};
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === 'number' && value < 0) {
      details[field] = 'Amount cannot be negative.';
    }
  }
  assertNoErrors(details);
}

export function assertValidDiscountSlot(prefix: string, slot: RegistrationDiscountSlotStored): void {
  const details: Record<string, string> = {};
  const keyBase = `${prefix}Discount`;
  if (slot.amountType === 'dollar') {
    if (slot.amountValue < 0) {
      details[keyBase] = 'Dollar discount cannot be negative.';
    }
  } else {
    if (!Number.isInteger(slot.amountValue)) {
      details[keyBase] = 'Percentage must be a whole number (for example, 30 for 30% off).';
    } else if (slot.amountValue < 0 || slot.amountValue > 100) {
      details[keyBase] = 'Percentage must be between 0 and 100.';
    }
  }
  assertNoErrors(details);
}

export function assertValidRegistrationDiscountSettingsStored(input: RegistrationDiscountSettingsStored): void {
  assertValidDiscountSlot('student', input.student);
  assertValidDiscountSlot('reciprocal', input.reciprocal);
  assertValidDiscountSlot('winterOnly', input.winterOnly);
}
