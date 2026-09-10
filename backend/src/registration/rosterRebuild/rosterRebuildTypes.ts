import type { LeagueRosterPlacementTypeSqlite } from '../../db/drizzle-schema.js';
import type { WaitlistOfferResponsePreference } from '../waitlistOfferPreference.js';
import type { PriorityPeriodEndSource } from './rosterRebuildPriorityPeriod.js';

export type LeagueCategory =
  | 'normal'
  | 'doubles'
  | 'junior_rec'
  | 'junior_adv'
  | 'tuesday_evening'
  | 'day_league'
  | 'instructional'
  | 'unresolved';

export type RosterRebuildStage = 'returning' | 'waitlists' | 'open-registration' | 'third-leagues';

export type RosterRebuildLeague = {
  id: number;
  name: string;
  sessionId: number;
  format: 'teams' | 'doubles' | 'instructional';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  waitlistId: number | null;
  predecessorLeagueId: number | null;
  predecessorName: string | null;
  isPlayInBased: boolean;
  isJuniorRecreational: boolean;
  category: LeagueCategory;
  /** Effective registration fee in cents; 0 is a free (typically daytime) league. */
  registrationFeeMinor: number;
};

export type RosterRebuildRosterRow = {
  leagueId: number;
  memberId: number;
  status: string;
  placementType: string | null;
  isTemporarySabbaticalFill: boolean;
  sourceRegistrationId: number | null;
  relatedSabbaticalId?: number | null;
  createdAt?: string | null;
};

export type RosterRebuildPriority = {
  leagueId: number;
  rank: number;
  teammateMemberIds: number[];
  teammateText: string | null;
};

export type RosterRebuildRegistration = {
  id: number;
  memberId: number;
  status: string;
  desiredLeagueCount: number | null;
  membershipOption: string;
  priorities: RosterRebuildPriority[];
  juniorRecreationalSelection: boolean;
  sabbaticalLeagueIds: number[];
  submittedAt: string | null;
  receivedDuringPriorityPeriod: boolean;
  icePrivilegesChoice: string;
};

export type RosterRebuildWaitlistEntry = {
  id: number;
  waitlistId: number;
  memberId: number;
  position: number;
  declineCount: number;
  priorityRankSnapshot: number | null;
  desiredLeagueCountSnapshot: number | null;
  status: string;
};

export type RosterRebuildMember = {
  memberId: number;
  name: string;
  email: string;
  isLifetimeMember: boolean;
  clubTenureYears: number;
  totalExperienceYears: number;
};

export type RosterRebuildSabbatical = {
  id: number;
  leagueId: number;
  memberId: number;
  status: string;
};

export type RosterRebuildPendingOffer = {
  id: number;
  leagueId: number;
  memberId: number;
  waitlistEntryId: number;
};

export type RosterRebuildSnapshot = {
  sessionId: number;
  sessionName: string;
  leagues: RosterRebuildLeague[];
  currentRosters: RosterRebuildRosterRow[];
  predecessorRosters: RosterRebuildRosterRow[];
  registrations: RosterRebuildRegistration[];
  waitlistEntriesByWaitlistId: Map<number, RosterRebuildWaitlistEntry[]>;
  members: Map<number, RosterRebuildMember>;
  tuesdayEveningRosterMemberIds: Set<number>;
  /**
   * Play-in / Tuesday seats that still occupy a desired-count slot even when
   * `league_roster` is not active: declared entry teams and league team
   * membership. Keys are `${leagueId}:${memberId}`.
   */
  unmanagedOccupiedKeys: Set<string>;
  activeSabbaticals: RosterRebuildSabbatical[];
  pendingOffers: RosterRebuildPendingOffer[];
  duplicateRegistrationMemberIds: number[];
  guaranteedReturnPlacementCount: number;
  waitlistPlacementCount: number;
  priorityPeriodEndAt: string;
  priorityPeriodEndSource: PriorityPeriodEndSource;
};

export type RosterRebuildPlacementType = Extract<
  LeagueRosterPlacementTypeSqlite,
  'guaranteed_return' | 'new_placement' | 'waitlist' | 'temporary_sabbatical_fill'
>;

export type RosterRebuildPlacement = {
  sequence: number;
  stage: RosterRebuildStage;
  pass: number | null;
  leagueId: number;
  memberId: number;
  placementType: RosterRebuildPlacementType;
  reason: string;
  sourceRegistrationId: number | null;
  waitlistEntryId: number | null;
  isRank3PlusReturner: boolean;
  isTemporarySabbaticalFill: boolean;
  relatedSabbaticalId: number | null;
};

export type WaitlistEventOutcome =
  | 'staged'
  | 'held'
  | 'moved_up'
  | 'released'
  | 'placed'
  | 'declined'
  | 'declined_immune'
  | 'auto_declined'
  | 'skipped_allowance'
  | 'already_rostered'
  | 'placed_temporary'
  | 'sabbatical_fallback'
  | 'skipped_open_registration'
  | 'skipped_ice_privileges';

export type RosterRebuildWaitlistEvent = {
  pass: number;
  leagueId: number;
  position: number | null;
  entryId: number | null;
  memberId: number;
  preference: WaitlistOfferResponsePreference | null;
  outcome: WaitlistEventOutcome;
  declineCountBefore: number | null;
  declineCountAfter: number | null;
  immune: boolean;
  reason: string;
};

export type WaitlistMutation = {
  entryId: number;
  memberId: number;
  leagueId: number;
  kind: 'placed' | 'declined' | 'temporary_fill';
  immune: boolean;
  declineCountBefore: number;
  declineCountAfter: number;
};

export type RosterRebuildSabbaticalMutation = {
  syntheticId: number;
  memberId: number;
  leagueId: number;
  sourceRegistrationId: number | null;
  waitlistEntryId: number | null;
  replacedByLeagueId: number;
  reason: string;
};

export type RosterRebuildNote = {
  code: string;
  leagueId?: number;
  memberId?: number;
  detail: string;
};

export type LeagueVacancySnapshot = {
  leagueId: number;
  capacity: number;
  rostered: number;
  holds: number;
  sabbaticals: number;
  vacancy: number;
  permanentVacancy: number;
  temporaryVacancy: number;
};

export type RosterRebuildResult = {
  stage: RosterRebuildStage;
  placements: RosterRebuildPlacement[];
  waitlistEvents: RosterRebuildWaitlistEvent[];
  waitlistMutations: WaitlistMutation[];
  sabbaticalMutations: RosterRebuildSabbaticalMutation[];
  notes: RosterRebuildNote[];
  warnings: string[];
  haltedLeagueIds: number[];
  leagueVacancies: LeagueVacancySnapshot[];
  randomSeed: number | null;
};

export type RosterRebuildEngineOptions = {
  randomSeed?: number;
};

export type RosterDiffChange = 'added' | 'removed' | 'unchanged';

export type RosterDiffRow = {
  leagueId: number;
  memberId: number;
  change: RosterDiffChange;
  reason: string | null;
  stage: string | null;
};
