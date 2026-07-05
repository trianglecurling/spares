import type { RegistrationMembershipOption, RegistrationSelectionInput, LeagueConfig } from './registrationContext.js';
import { calculateRegistrationFees, type RegistrationFeePreview } from './registrationFeeCalculator.js';
import type { PriceConfigInput, RegistrationDiscountSettingsStored } from './registrationConfigValidation.js';
import { league, selection, registrationContext } from './registrationTestFixtures.js';

export type DuesSessionIceTime = 'none' | 'spare_only' | '1_league' | '2_leagues' | '3_leagues';

export type DuesSessionMembershipType = 'none' | 'regular' | 'social' | 'junior_recreational';

export type DuesSessionSelection = {
  membershipType: DuesSessionMembershipType;
  iceTime: DuesSessionIceTime;
};

export type DuesEstimateInput = {
  fall: DuesSessionSelection;
  winter: DuesSessionSelection;
  studentDiscount: boolean;
  reciprocalDiscount: boolean;
};

export type DuesPaymentBreakdown = {
  totalMinor: number;
  lineItems: Array<{ description: string; amountMinor: number }>;
  discountLineItems: Array<{ description: string; amountMinor: number }>;
};

export type DuesEstimateResponse = {
  fall: DuesPaymentBreakdown;
  winter: DuesPaymentBreakdown;
  annualTotalMinor: number;
  benefits: {
    annual: string[];
    fall: string[];
    winter: string[];
  };
};

function leagueCountForIceTime(iceTime: DuesSessionIceTime): number {
  if (iceTime === '1_league') return 1;
  if (iceTime === '2_leagues') return 2;
  if (iceTime === '3_leagues') return 3;
  return 0;
}

function buildSyntheticLeagues(count: number, sessionId: number, defaultFeeMinor: number): Record<number, LeagueConfig> {
  const leagues: Record<number, LeagueConfig> = {};
  for (let index = 0; index < count; index += 1) {
    const id = 90_000 + index;
    leagues[id] = league({
      id,
      sessionId,
      name: `League ${index + 1}`,
      registrationFeeMinor: defaultFeeMinor,
    });
  }
  return leagues;
}

function buildLeagueSelections(count: number): RegistrationSelectionInput[] {
  return Array.from({ length: count }, (_, index) =>
    selection({
      leagueId: 90_000 + index,
      selectionType: 'guaranteed_return',
    }),
  );
}

function resolveMembershipOption(
  sessionSelection: DuesSessionSelection,
  options: { fallPaidRegularMembership: boolean; isWinterSession: boolean },
): RegistrationMembershipOption {
  if (sessionSelection.membershipType === 'none') return 'none';

  if (options.fallPaidRegularMembership && options.isWinterSession) {
    if (sessionSelection.membershipType === 'social') return 'none';
    if (sessionSelection.membershipType === 'junior_recreational') return 'junior_recreational';
    if (sessionSelection.iceTime === 'spare_only') return 'regular_spare_only';
    if (sessionSelection.iceTime === 'none') return 'none';
    return 'none';
  }

  if (sessionSelection.membershipType === 'social') return 'social';
  if (sessionSelection.membershipType === 'junior_recreational') return 'junior_recreational';

  if (sessionSelection.iceTime === 'spare_only') return 'regular_spare_only';
  return 'regular';
}

function sessionHasIcePrivileges(sessionSelection: DuesSessionSelection): boolean {
  if (sessionSelection.membershipType !== 'regular') return false;
  return (
    sessionSelection.iceTime === 'spare_only' ||
    sessionSelection.iceTime === '1_league' ||
    sessionSelection.iceTime === '2_leagues' ||
    sessionSelection.iceTime === '3_leagues'
  );
}

function sessionLeagueCount(sessionSelection: DuesSessionSelection): number {
  if (sessionSelection.membershipType !== 'regular') return 0;
  return leagueCountForIceTime(sessionSelection.iceTime);
}

const ANNUAL_BENEFITS_BASE = [
  'Inclusion on the official Triangle Curling Club roster of members',
  'Access to Triangle Curling membership online social groups',
  'Attendance at the Annual General Meeting and end-of-season celebration and board meetings',
  'Ability to volunteer as a bartender',
  'Dues paid on your behalf to USA Curling, GNCC, and USWCA (as applicable)',
  'Voting in elections to select board members, bylaws changes, and more (members 18+ only)',
];

const BONSPIEL_ANNUAL_BENEFIT =
  'Ability to participate in the Triangle Club Bonspiel (usually in March/April)';

function hasIceTimeSelection(input: Pick<DuesEstimateInput, 'fall' | 'winter'>): boolean {
  return sessionHasIcePrivileges(input.fall) || sessionHasIcePrivileges(input.winter);
}

function buildAnnualBenefits(input: Pick<DuesEstimateInput, 'fall' | 'winter'>): string[] {
  if (!hasMembershipSelection(input.fall) && !hasMembershipSelection(input.winter)) {
    return [];
  }
  const benefits = [...ANNUAL_BENEFITS_BASE];
  if (hasIceTimeSelection(input)) {
    benefits.push(BONSPIEL_ANNUAL_BENEFIT);
  }
  return benefits;
}

const SESSION_ICE_BENEFITS = [
  'Building access (door and security codes)',
  'Unlimited practice when ice is available',
  'Participate in Tuesday and Wednesday daytime leagues at no extra cost',
  'Unlimited sparing',
  'Discounted rates on private rentals',
  'Ability to register for clinics run by the Training Committee',
];

function hasMembershipSelection(sessionSelection: DuesSessionSelection): boolean {
  return sessionSelection.membershipType !== 'none';
}

function sessionBenefits(sessionSelection: DuesSessionSelection): string[] {
  if (!sessionHasIcePrivileges(sessionSelection)) return [];

  const leagueCount = sessionLeagueCount(sessionSelection);
  const benefits = [...SESSION_ICE_BENEFITS];
  if (leagueCount > 0) {
    benefits.push(`Participate in ${leagueCount} league${leagueCount === 1 ? '' : 's'}`);
  } else if (sessionSelection.iceTime === 'spare_only') {
    benefits.push('Practice, sparing, and daytime league access');
  }
  return benefits;
}

export function buildBenefits(input: Pick<DuesEstimateInput, 'fall' | 'winter'>): DuesEstimateResponse['benefits'] {
  return {
    annual: buildAnnualBenefits(input),
    fall: sessionBenefits(input.fall),
    winter: sessionBenefits(input.winter),
  };
}

function subtractRegularMembershipCharge(preview: RegistrationFeePreview): RegistrationFeePreview {
  const membershipLine = preview.lineItems.find((item) => item.lineType === 'regular_membership_fee');
  if (!membershipLine) return preview;

  const membershipMinor = membershipLine.amountMinor;
  const lineItems = preview.lineItems.filter((item) => item.lineType !== 'regular_membership_fee');
  const discountLineItems = preview.discountLineItems.filter((item) => item.lineType !== 'winter_only_discount');
  const removedWinterOnlyMinor = preview.discountLineItems.find((item) => item.lineType === 'winter_only_discount')?.amountMinor ?? 0;
  const subtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const discountTotalMinor = discountLineItems.reduce((sum, item) => sum + item.amountMinor, 0);

  return {
    ...preview,
    lineItems,
    discountLineItems,
    subtotalMinor,
    discountTotalMinor,
    totalDueMinor: Math.max(0, preview.totalDueMinor - membershipMinor - removedWinterOnlyMinor),
    blockingErrors: [],
    warnings: preview.warnings,
  };
}

function calculateSessionDues(input: {
  sessionSelection: DuesSessionSelection;
  season: { id: number; name: string; startDate: string; endDate: string };
  session: { id: number; seasonId: number; name: string; startDate: string; endDate: string };
  isFirstSessionOfSeason: boolean;
  fallPaidRegularMembership: boolean;
  isWinterSession: boolean;
  winterOnlyDiscountEligible: boolean;
  studentDiscount: boolean;
  reciprocalDiscount: boolean;
  priceConfig: PriceConfigInput;
  discountSettings: RegistrationDiscountSettingsStored;
  subtractRegularMembership: boolean;
}): RegistrationFeePreview {
  if (input.sessionSelection.membershipType === 'none') {
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

  const membershipOption = resolveMembershipOption(input.sessionSelection, {
    fallPaidRegularMembership: input.fallPaidRegularMembership,
    isWinterSession: input.isWinterSession,
  });
  const leagueCount =
    input.sessionSelection.membershipType === 'regular'
      ? leagueCountForIceTime(input.sessionSelection.iceTime)
      : 0;
  const leagues = buildSyntheticLeagues(leagueCount, input.session.id, input.priceConfig.defaultLeagueFeeMinor);
  const selections = buildLeagueSelections(leagueCount);

  const context = registrationContext({
    season: input.season,
    session: input.session,
    isFirstSessionOfSeason: input.isFirstSessionOfSeason,
    membershipOption,
    selections,
    leagues,
    priceConfig: input.priceConfig,
    discountSettings: input.discountSettings,
    registrant: {
      memberId: null,
      hasUserAccount: false,
      isReturningMember: false,
      dateOfBirth: '1990-01-01',
    },
    discountClaims: {
      student: input.studentDiscount ? { claimed: true, institution: 'Estimator' } : { claimed: false },
      reciprocal: input.reciprocalDiscount ? { claimed: true, clubName: 'Other club' } : { claimed: false },
      winterOnly: {
        claimed: input.winterOnlyDiscountEligible && input.isWinterSession,
      },
    },
  });

  let preview = calculateRegistrationFees(context);
  if (input.subtractRegularMembership) {
    preview = subtractRegularMembershipCharge(preview);
  }
  return preview;
}

function mapPreviewToBreakdown(preview: RegistrationFeePreview): DuesPaymentBreakdown {
  return {
    totalMinor: preview.totalDueMinor,
    lineItems: preview.lineItems.map((item) => ({
      description: item.description,
      amountMinor: item.amountMinor,
    })),
    discountLineItems: preview.discountLineItems.map((item) => ({
      description: item.description,
      amountMinor: item.amountMinor,
    })),
  };
}

export function estimateAnnualDuesWithSettings(
  input: DuesEstimateInput,
  settings: {
    priceConfig: PriceConfigInput;
    discountSettings: RegistrationDiscountSettingsStored;
    season: { id: number; name: string; startDate: string; endDate: string };
    fallSession: { id: number; seasonId: number; name: string; startDate: string; endDate: string };
    winterSession: { id: number; seasonId: number; name: string; startDate: string; endDate: string } | null;
  },
): DuesEstimateResponse {
  const { priceConfig, discountSettings, season, fallSession, winterSession } = settings;
  const fallPaidRegularMembership = input.fall.membershipType === 'regular';
  const winterOnlyDiscountEligible =
    input.winter.membershipType === 'regular' && input.fall.membershipType !== 'regular';

  const fallPreview = calculateSessionDues({
    sessionSelection: input.fall,
    season,
    session: fallSession,
    isFirstSessionOfSeason: true,
    fallPaidRegularMembership: false,
    isWinterSession: false,
    winterOnlyDiscountEligible: false,
    studentDiscount: input.studentDiscount,
    reciprocalDiscount: input.reciprocalDiscount,
    priceConfig,
    discountSettings,
    subtractRegularMembership: false,
  });

  const winterPreview =
    winterSession && input.winter.membershipType !== 'none'
      ? calculateSessionDues({
          sessionSelection: input.winter,
          season,
          session: winterSession,
          isFirstSessionOfSeason: false,
          fallPaidRegularMembership,
          isWinterSession: true,
          winterOnlyDiscountEligible,
          studentDiscount: input.studentDiscount,
          reciprocalDiscount: input.reciprocalDiscount,
          priceConfig,
          discountSettings,
          subtractRegularMembership:
            fallPaidRegularMembership &&
            input.winter.membershipType === 'regular' &&
            input.winter.iceTime === 'spare_only',
        })
      : {
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

  const fall = mapPreviewToBreakdown(fallPreview);
  const winter = mapPreviewToBreakdown(winterPreview);

  return {
    fall,
    winter,
    annualTotalMinor: fall.totalMinor + winter.totalMinor,
    benefits: buildBenefits(input),
  };
}
