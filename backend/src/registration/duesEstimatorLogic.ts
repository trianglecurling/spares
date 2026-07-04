import type { RegistrationMembershipOption, RegistrationSelectionInput, LeagueConfig } from './registrationContext.js';
import { calculateRegistrationFees, type RegistrationFeePreview } from './registrationFeeCalculator.js';
import type { PriceConfigInput, RegistrationDiscountSettingsStored } from './registrationConfigValidation.js';
import { league, selection, registrationContext } from './registrationTestFixtures.js';

export type DuesSessionIceTime = 'none' | 'spare_only' | '1_league' | '2_leagues';

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
  if (sessionSelection.membershipType === 'social') return 'social';
  if (sessionSelection.membershipType === 'junior_recreational') return 'junior_recreational';

  if (options.fallPaidRegularMembership && options.isWinterSession) {
    if (sessionSelection.iceTime === 'spare_only') return 'regular_spare_only';
    if (sessionSelection.iceTime === 'none') return 'none';
    return 'none';
  }

  if (sessionSelection.iceTime === 'spare_only') return 'regular_spare_only';
  return 'regular';
}

function sessionHasIcePrivileges(sessionSelection: DuesSessionSelection): boolean {
  if (sessionSelection.membershipType !== 'regular') return false;
  return sessionSelection.iceTime === 'spare_only' || sessionSelection.iceTime === '1_league' || sessionSelection.iceTime === '2_leagues';
}

function sessionLeagueCount(sessionSelection: DuesSessionSelection): number {
  if (sessionSelection.membershipType !== 'regular') return 0;
  return leagueCountForIceTime(sessionSelection.iceTime);
}

const ANNUAL_BENEFITS = [
  'Inclusion on the official Triangle Curling Club roster of members',
  'Access to Triangle Curling membership online social groups',
  'Attendance at the Annual General Meeting and end-of-season celebration and board meetings',
  'Ability to volunteer as a bartender',
  'Dues paid on your behalf to USA Curling, GNCC, and USWCA (as applicable)',
  'Voting in elections to select board members, bylaws changes, and more (members 18+ only)',
  'Ability to participate in the Triangle Club Bonspiel (usually in March/April)',
];

const SESSION_ICE_BENEFITS = [
  'Building access (door and security codes)',
  'Unlimited practice when ice is available',
  'Participate in Tuesday and Wednesday daytime leagues at no extra cost',
  'Unlimited sparing',
  'Discounted rates on private rentals',
  'Ability to register for clinics run by the Training Committee',
];

export function buildBenefits(input: Pick<DuesEstimateInput, 'fall' | 'winter'>): DuesEstimateResponse['benefits'] {
  const fallLeagues = sessionLeagueCount(input.fall);
  const winterLeagues = sessionLeagueCount(input.winter);
  const fallIce = sessionHasIcePrivileges(input.fall);
  const winterIce = sessionHasIcePrivileges(input.winter);

  const annual = fallLeagues >= 1 && winterLeagues >= 1 ? ANNUAL_BENEFITS : [];

  const fall = fallIce
    ? [...SESSION_ICE_BENEFITS, `Participate in ${fallLeagues > 0 ? fallLeagues : 0} league${fallLeagues === 1 ? '' : 's'}`]
    : [];

  const winter = winterIce
    ? [...SESSION_ICE_BENEFITS, `Participate in ${winterLeagues > 0 ? winterLeagues : 0} league${winterLeagues === 1 ? '' : 's'}`]
    : [];

  return { annual, fall, winter };
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
    input.fall.membershipType === 'none' && input.winter.membershipType === 'regular';

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
