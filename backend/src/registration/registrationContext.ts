import type {
  CurlingExperienceTypeSqlite,
  CurlingMembershipOptionSqlite,
  CurlingRegistrationSelectionKindSqlite,
  LeaguePriorityGuaranteeLabel,
  RegistrationInvoiceLineKindSqlite,
  RegistrationPeriodStateSqlite,
} from '../db/drizzle-schema.js';
import type { PriceConfigInput, RegistrationDiscountSettingsStored } from './registrationConfigValidation.js';

export type RegistrationMembershipOption = CurlingMembershipOptionSqlite;
export type RegistrationSelectionKind = CurlingRegistrationSelectionKindSqlite;
export type RegistrationPeriodState = RegistrationPeriodStateSqlite;
export type RegistrationInvoiceLineKind = RegistrationInvoiceLineKindSqlite;
export type { LeaguePriorityGuaranteeLabel };

export type LeagueConfig = {
  id: number;
  sessionId?: number | null;
  name: string;
  dayOfWeek?: number | null;
  /** Recurring draw times for this league, earliest first, as `HH:MM`. */
  drawTimes?: string[];
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
  /** Remaining permanent spots (capacity minus rostered members and sabbaticals). */
  openSpotCount?: number;
  /** Unfilled temporary spots created by active sabbaticals. */
  temporarySabbaticalFillVacancyCount?: number;
  isPlayInBased: boolean;
  /** When true, Junior Recreational membership places registrants on this roster. */
  isJuniorRecreational?: boolean;
  allowsSabbatical: boolean;
  predecessorLeagueId?: number | null;
  successorLeagueId?: number | null;
  discountEligible?: boolean;
};

export type TeamRosterPlacement = {
  memberId: number;
};

/**
 * A non-league registration answer: what to do with a league the registrant is
 * leaving behind, or a program choice. Leagues the registrant wants live in
 * `priorities`.
 */
export type RegistrationSelectionInput = {
  selectionType: RegistrationSelectionKind;
  leagueId?: number | null;
  isTemporarySabbaticalFill?: boolean;
};

/** One league on the registrant's prioritized list, most wanted first. */
export type LeaguePriorityInput = {
  leagueId: number;
  /** 1-based and contiguous across the list. */
  priorityRank: number;
  /** Newline-separated names of teammates without member accounts. */
  byotTeammateText?: string | null;
  teamRosterPlacements?: TeamRosterPlacement[] | null;
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
  status: 'active' | 'offered' | 'accepted' | 'declined' | 'placed' | 'removed' | 'moved_to_bottom' | 'rolled_over' | 'cancelled';
  position?: number | null;
  queueTotal?: number | null;
  declineCount?: number | null;
  priorityRank?: number | null;
  desiredLeagueCount?: number | null;
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

/** Declared play-in team a selected teammate already belongs to. */
export type PlayInCommittedOtherMemberTeam = {
  memberId: number;
  team: {
    id: number;
    name: string | null;
    members: Array<{
      memberId: number | null;
      memberName: string | null;
      pendingName: string | null;
    }>;
  };
};

/** Play-in (TLINE) entry state for a play-in based league the registrant selected. */
export type PlayInEntryContext = {
  /** The registrant is already listed on a declared entry team for this league. */
  onExistingTeam: boolean;
  existingTeamId?: number | null;
  /** Members (other than the registrant) already committed to other active entry teams. */
  committedOtherMemberIds: number[];
  /** Full roster for each committed other member, used to allow joining incomplete teams. */
  committedOtherMemberTeams?: PlayInCommittedOtherMemberTeam[];
  /** Expected roster size for this play-in league. */
  teamSize?: number | null;
  /** The registrant's declared/drafted team is pessimistically guaranteed auto entry. */
  guaranteed: boolean;
};

export type RegistrationContext = {
  /** How many leagues the registrant wants to play in, 1..MAX_DESIRED_LEAGUE_COUNT. */
  desiredLeagueCount?: number | null;
  /** Returning-member replacement name tags: 0 declined, 1–3 purchased, null unanswered. */
  nameTagReplacementQuantity?: number | null;
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
  /**
   * For each bring-your-own-team league id, member ids that hold a return right
   * for that league (played the predecessor, or hold a matching sabbatical).
   * Used to decide whether a declared BYOT roster earns a guaranteed return.
   */
  returnEligibleMemberIdsByLeagueId?: Record<number, number[]>;
  existingSabbaticals: ExistingSabbatical[];
  existingWaitlistEntries: ExistingWaitlistEntry[];
  leagues: Record<number, LeagueConfig>;
  /** Leagues the registrant wants, most wanted first. Source of truth for demand. */
  priorities: LeaguePriorityInput[];
  /** Sabbatical, drop, and program answers. Never leagues the registrant wants. */
  selections: RegistrationSelectionInput[];
  discountClaims: DiscountClaims;
  juniorAssistance?: JuniorAssistanceRequest;
  /** Keyed by league id; present for play-in based leagues with a play_in_request selection. */
  playInEntry?: Record<number, PlayInEntryContext>;
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

export function getPriorityLeague(
  context: RegistrationContext,
  priority: LeaguePriorityInput
): LeagueConfig | undefined {
  return getLeague(context, priority.leagueId);
}

export function isActiveWaitlistEntry(entry: ExistingWaitlistEntry): boolean {
  return entry.status === 'active' || entry.status === 'offered';
}

export function activeLeagueCount(context: RegistrationContext): number {
  return context.activeLeagueIds.length;
}

/** Priority entries sorted by rank, most wanted first. */
export function orderedPriorities(context: RegistrationContext): LeaguePriorityInput[] {
  return [...context.priorities].sort((a, b) => a.priorityRank - b.priorityRank);
}
