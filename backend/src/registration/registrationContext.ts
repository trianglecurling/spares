import type {
  CurlingExperienceTypeSqlite,
  CurlingMembershipOptionSqlite,
  CurlingRegistrationSelectionKindSqlite,
  RegistrationInvoiceLineKindSqlite,
  RegistrationPeriodStateSqlite,
  WaitlistEntryTypeSqlite,
} from '../db/drizzle-schema.js';
import type { PriceConfigInput, RegistrationDiscountSettingsStored } from './registrationConfigValidation.js';

export type RegistrationMembershipOption = CurlingMembershipOptionSqlite;
export type RegistrationSelectionKind = CurlingRegistrationSelectionKindSqlite;
export type RegistrationPeriodState = RegistrationPeriodStateSqlite;
export type RegistrationInvoiceLineKind = RegistrationInvoiceLineKindSqlite;

export type LeagueConfig = {
  id: number;
  sessionId?: number | null;
  name: string;
  leagueType: 'standard' | 'bring_your_own_team';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  registrationFeeMinor: number;
  requiresClubMembership: boolean;
  isInstructional: boolean;
  minExperienceYears?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  firstDayOfPlay?: string | null;
  lastDayOfPlay?: string | null;
  allowsWaitlist: boolean;
  allowsSabbatical: boolean;
  predecessorLeagueId?: number | null;
  successorLeagueId?: number | null;
  discountEligible?: boolean;
};

export type RegistrationSelectionInput = {
  selectionType: RegistrationSelectionKind;
  leagueId?: number | null;
  rank?: number | null;
  replacesLeagueId?: number | null;
  byotTeammateText?: string | null;
  isTemporarySabbaticalFill?: boolean;
};

export type ExistingSabbatical = {
  id: number;
  originalLeagueId: number;
  currentLeagueId: number;
  firstSabbaticalLeagueId: number;
  firstSabbaticalStartDate: string;
  status: 'active' | 'returning' | 'released' | 'expired' | 'staff_overridden' | 'cancelled';
  staffOverride?: boolean;
};

export type ExistingWaitlistEntry = {
  leagueId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
  status: 'active' | 'offered' | 'accepted' | 'declined' | 'placed' | 'removed' | 'moved_to_bottom' | 'rolled_over' | 'cancelled';
};

export type CompletedLeagueSession = {
  leagueId: number;
  seasonKey: string;
};

export type DiscountClaims = {
  student?: {
    claimed: boolean;
    institution?: string | null;
  };
  reciprocal?: {
    claimed: boolean;
    clubName?: string | null;
  };
  winterOnly?: {
    claimed?: boolean;
  };
};

export type JuniorAssistanceRequest = {
  requestedPercent?: number | null;
  approvedPercent?: number | null;
  status?: 'none' | 'pending' | 'approved' | 'partially_approved' | 'denied';
};

export type RegistrationContext = {
  season: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  session: {
    id: number;
    seasonId: number;
    name: string;
    startDate: string;
    endDate: string;
  };
  registrationState: RegistrationPeriodState;
  isFirstSessionOfSeason: boolean;
  membershipSeasonStartYear?: number;
  registrant: {
    memberId?: number | null;
    hasUserAccount: boolean;
    isReturningMember: boolean;
    dateOfBirth?: string | null;
  };
  submittedByMemberId?: number | null;
  membershipOption: RegistrationMembershipOption;
  isSocialToRegularUpgrade?: boolean;
  experience: {
    type: CurlingExperienceTypeSqlite;
    selfReportedYears?: number | null;
    completedSessions: CompletedLeagueSession[];
  };
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  existingSabbaticals: ExistingSabbatical[];
  existingWaitlistEntries: ExistingWaitlistEntry[];
  leagues: Record<number, LeagueConfig>;
  selections: RegistrationSelectionInput[];
  discountClaims: DiscountClaims;
  juniorAssistance?: JuniorAssistanceRequest;
  priceConfig: PriceConfigInput;
  discountSettings: RegistrationDiscountSettingsStored;
  sabbaticalDurationLimitYears: number;
  staffOverrideSabbaticalDuration?: boolean;
};

export function getLeague(context: RegistrationContext, leagueId: number | null | undefined): LeagueConfig | undefined {
  if (leagueId === null || leagueId === undefined) return undefined;
  return context.leagues[leagueId];
}

export function getSelectionLeague(
  context: RegistrationContext,
  selection: RegistrationSelectionInput
): LeagueConfig | undefined {
  return getLeague(context, selection.leagueId);
}

export function isActiveWaitlistEntry(entry: ExistingWaitlistEntry): boolean {
  return entry.status === 'active' || entry.status === 'offered';
}

export function activeLeagueCount(context: RegistrationContext): number {
  return context.activeLeagueIds.length;
}
