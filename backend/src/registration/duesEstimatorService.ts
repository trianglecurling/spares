import { asc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { PriceConfigInput, RegistrationDiscountSettingsStored } from './registrationConfigValidation.js';
import { getDefaultRegistrationWindow } from './registrationShellService.js';
import {
  estimateAnnualDuesWithSettings,
  type DuesEstimateInput,
  type DuesEstimateResponse,
} from './duesEstimatorLogic.js';

export type {
  DuesSessionIceTime,
  DuesSessionMembershipType,
  DuesSessionSelection,
  DuesEstimateInput,
  DuesPaymentBreakdown,
  DuesEstimateResponse,
} from './duesEstimatorLogic.js';

export { buildBenefits, estimateAnnualDuesWithSettings } from './duesEstimatorLogic.js';

export type PublicDiscountSlot = {
  amountType: 'dollar' | 'percent';
  value: number;
};

export type PublicDuesScheduleResponse = {
  season: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  fallSession: { id: number; name: string };
  winterSession: { id: number; name: string } | null;
  fees: {
    regularMembershipDollars: number;
    leagueFeeDollars: number;
    spareOnlyIcePrivilegeDollars: number;
    socialMembershipDollars: number;
    juniorRecreationalDollars: number;
    sabbaticalFeeDollars: number;
  };
  discounts: {
    student: PublicDiscountSlot;
    reciprocal: PublicDiscountSlot;
    winterOnly: PublicDiscountSlot;
  };
};

function feeMinorToDollars(minor: number): number {
  return Math.round(minor) / 100;
}

function mapDiscountSlotForPublic(slot: { amountType: 'dollar' | 'percent'; amountValue: number }): PublicDiscountSlot {
  if (slot.amountType === 'dollar') {
    return { amountType: 'dollar', value: feeMinorToDollars(slot.amountValue) };
  }
  return { amountType: 'percent', value: slot.amountValue };
}

function formatDiscountDetails(slot: PublicDiscountSlot, scope: string): string {
  if (slot.amountType === 'percent') {
    return `${slot.value}% off ${scope}`;
  }
  return `$${slot.value.toFixed(2)} off ${scope}`;
}

export function formatPublicDiscountRows(discounts: PublicDuesScheduleResponse['discounts']): Array<{ type: string; details: string }> {
  return [
    { type: 'Student discount', details: formatDiscountDetails(discounts.student, 'membership and leagues') },
    { type: 'Reciprocal discount', details: formatDiscountDetails(discounts.reciprocal, 'membership') },
    { type: 'Winter-only discount', details: formatDiscountDetails(discounts.winterOnly, 'membership') },
  ];
}

async function loadRegistrationSettings(): Promise<{
  priceConfig: PriceConfigInput;
  discountSettings: RegistrationDiscountSettingsStored;
}> {
  const { db, schema } = getDrizzleDb();
  const [price] = await db.select().from(schema.registrationPriceSettings).limit(1);
  const [discount] = await db.select().from(schema.registrationDiscountSettings).limit(1);
  return {
    priceConfig: {
      regularMembershipFeeMinor: price?.regular_membership_fee_minor ?? 0,
      socialMembershipFeeMinor: price?.social_membership_fee_minor ?? 0,
      spareOnlyIcePrivilegeFeeMinor: price?.spare_only_ice_privilege_fee_minor ?? 0,
      sabbaticalFeeMinor: price?.sabbatical_fee_minor ?? 0,
      juniorRecreationalFeeMinor: price?.junior_recreational_fee_minor ?? 0,
      defaultLeagueFeeMinor: price?.default_league_fee_minor ?? 0,
    },
    discountSettings: {
      student: {
        amountType: discount?.student_discount_amount_type ?? 'dollar',
        amountValue: discount?.student_discount_amount_value ?? 0,
      },
      reciprocal: {
        amountType: discount?.reciprocal_discount_amount_type ?? 'dollar',
        amountValue: discount?.reciprocal_discount_amount_value ?? 0,
      },
      winterOnly: {
        amountType: discount?.winter_only_discount_amount_type ?? 'dollar',
        amountValue: discount?.winter_only_discount_amount_value ?? 0,
      },
    },
  };
}

async function loadOrderedSeasonSessions(seasonId: number) {
  const { db, schema } = getDrizzleDb();
  return db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
      seasonId: schema.curlingSessions.season_id,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.season_id, seasonId))
    .orderBy(asc(schema.curlingSessions.start_date), asc(schema.curlingSessions.id));
}

export async function getPublicDuesSchedule(): Promise<PublicDuesScheduleResponse | null> {
  const window = await getDefaultRegistrationWindow();
  if (!window) return null;

  const sessions = await loadOrderedSeasonSessions(window.season.id);
  const fallSession = sessions[0];
  const winterSession = sessions[1] ?? null;
  if (!fallSession) return null;

  const { priceConfig, discountSettings } = await loadRegistrationSettings();

  return {
    season: {
      id: window.season.id,
      name: window.season.name,
      startDate: window.season.startDate ?? '',
      endDate: window.season.endDate ?? '',
    },
    fallSession: { id: fallSession.id, name: fallSession.name ?? 'Fall' },
    winterSession: winterSession ? { id: winterSession.id, name: winterSession.name ?? 'Winter' } : null,
    fees: {
      regularMembershipDollars: feeMinorToDollars(priceConfig.regularMembershipFeeMinor),
      leagueFeeDollars: feeMinorToDollars(priceConfig.defaultLeagueFeeMinor),
      spareOnlyIcePrivilegeDollars: feeMinorToDollars(priceConfig.spareOnlyIcePrivilegeFeeMinor),
      socialMembershipDollars: feeMinorToDollars(priceConfig.socialMembershipFeeMinor),
      juniorRecreationalDollars: feeMinorToDollars(priceConfig.juniorRecreationalFeeMinor),
      sabbaticalFeeDollars: feeMinorToDollars(priceConfig.sabbaticalFeeMinor),
    },
    discounts: {
      student: mapDiscountSlotForPublic(discountSettings.student),
      reciprocal: mapDiscountSlotForPublic(discountSettings.reciprocal),
      winterOnly: mapDiscountSlotForPublic(discountSettings.winterOnly),
    },
  };
}

export async function estimateAnnualDues(input: DuesEstimateInput): Promise<DuesEstimateResponse | null> {
  const schedule = await getPublicDuesSchedule();
  if (!schedule) return null;

  const sessions = await loadOrderedSeasonSessions(schedule.season.id);
  const fallSessionRow = sessions[0];
  const winterSessionRow = sessions[1] ?? null;
  if (!fallSessionRow) return null;

  const { priceConfig, discountSettings } = await loadRegistrationSettings();
  const fallSession = {
    id: fallSessionRow.id,
    seasonId: fallSessionRow.seasonId,
    name: fallSessionRow.name,
    startDate: String(fallSessionRow.startDate),
    endDate: String(fallSessionRow.endDate),
  };
  const winterSession = winterSessionRow
    ? {
        id: winterSessionRow.id,
        seasonId: winterSessionRow.seasonId,
        name: winterSessionRow.name,
        startDate: String(winterSessionRow.startDate),
        endDate: String(winterSessionRow.endDate),
      }
    : null;

  return estimateAnnualDuesWithSettings(input, {
    priceConfig,
    discountSettings,
    season: schedule.season,
    fallSession,
    winterSession,
  });
}
