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
  dayOfWeek?: number | null;
  leagueType: 'standard' | 'bring_your_own_team';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  registrationFeeMinor: number;
  requiresClubMembership: boolean;
  format: 'teams' | 'doubles' | 'instructional';
  minExperienceYears?: number | null;
  maxExperienceYears?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  firstDayOfPlay?: string | null;
  lastDayOfPlay?: string | null;
  allowsWaitlist: boolean;
  waitlistId?: number | null;
  activeWaitlistEntryCount?: number;
  isPlayInBased: boolean;
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
  teamRosterText?: string | null;
  teamRosterPlacements?: Array<{
    memberId: number;
    entryType: 'add' | 'replace';
    replacesLeagueId?: number | null;
  }> | null;
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
  waitlistId: number;
  leagueId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLineageStartLeagueId?: number | null;
  replacesLeagueId?: number | null;
  status: 'active' | 'offered' | 'accepted' | 'declined' | 'placed' | 'removed' | 'moved_to_bottom' | 'rolled_over' | 'cancelled';
  position?: number | null;
  queueTotal?: number | null;
  declineCount?: number | null;
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
  status?: 'none' | 'pending' | 'approved' | 'partially_approved' | 'denied' | 'withdrawn';
};

export type RegistrationContext = {
  desiredAddWaitlistLeagueCount?: number | null;
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
    hasLifetimeMembership?: boolean;
  };
  submittedByMemberId?: number | null;
  membershipOption: RegistrationMembershipOption;
  isSocialToRegularUpgrade?: boolean;
  experience: {
    type: CurlingExperienceTypeSqlite;
    selfReportedYears?: number | null;
    baselineOtherClubExperienceYears: number;
    baselineClubExperienceYears: number;
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

export function replaceWaitlistDefersPayment(
  context: RegistrationContext,
  selection: RegistrationSelectionInput
): boolean {
  if (selection.selectionType !== 'waitlist_replace') return false;
  if (selection.leagueId == null || selection.replacesLeagueId == null) return true;

  const targetLeague = getLeague(context, selection.leagueId);
  const replacedLeague = getLeague(context, selection.replacesLeagueId);
  if (!targetLeague || !replacedLeague) return true;

  return targetLeague.registrationFeeMinor !== replacedLeague.registrationFeeMinor;
}

export function playInSelectionDefersPayment(
  context: RegistrationContext,
  selection: RegistrationSelectionInput,
): boolean {
  if (selection.selectionType !== 'play_in_request') return false;
  if (!selection.replacesLeagueId) return true;
  if (selection.leagueId == null) return true;

  const playInLeague = getLeague(context, selection.leagueId);
  const replacedLeague = getLeague(context, selection.replacesLeagueId);
  if (!playInLeague || !replacedLeague) return true;

  return playInLeague.registrationFeeMinor !== replacedLeague.registrationFeeMinor;
}

export function waitlistSelectionDefersPayment(
  context: RegistrationContext,
  selection: RegistrationSelectionInput
): boolean {
  if (
    selection.selectionType === 'waitlist_add' ||
    selection.selectionType === 'waitlist_add_auto_decline' ||
    selection.selectionType === 'waitlist_keep_auto_accept' ||
    selection.selectionType === 'waitlist_keep_auto_decline'
  ) {
    return true;
  }
  if (selection.selectionType === 'waitlist_replace' || selection.selectionType === 'waitlist_replace_auto_decline') {
    return replaceWaitlistDefersPayment(context, selection);
  }
  return false;
}
