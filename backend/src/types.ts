type DbDate = string | Date;

export type ScopeEffect = 'allow' | 'deny';

export interface ScopeContext {
  resourceType?: string | null;
  resourceId?: number | null;
}

export interface AuthzRule {
  scope: string;
  effect: ScopeEffect;
  resourceType?: string | null;
  resourceId?: number | null;
}

export interface AuthzClaims {
  roleCodes: string[];
  roleNames: string[];
  scopeRules: AuthzRule[];
  isServerAdmin: boolean;
}

export interface Member {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  valid_through: DbDate | null;
  spare_only: number;
  social_member: number;
  is_admin: number;
  is_server_admin: number;
  is_calendar_admin?: number;
  is_content_admin?: number;
  is_sponsor_admin?: number;
  opted_in_sms: number;
  email_subscribed: number;
  first_login_completed: number;
  email_visible: number;
  phone_visible: number;
  theme_preference: string | null;
  created_at: DbDate;
  updated_at: DbDate;
  authz?: AuthzClaims;
  /** When true, permission helpers must not use legacy flags or email-based server admin outside {@link AuthzClaims}. */
  impersonationSession?: boolean;
}

export interface AuthCode {
  id: number;
  contact: string;
  code: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface AuthToken {
  id: number;
  member_id: number;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface League {
  id: number;
  session_id: number | null;
  name: string;
  day_of_week: number;
  format: 'teams' | 'doubles';
  start_date: DbDate;
  end_date: DbDate;
  league_type: 'standard' | 'bring_your_own_team';
  capacity_type: 'individual' | 'team';
  capacity_value: number;
  registration_fee_minor: number;
  requires_club_membership: number;
  is_instructional: number;
  min_experience_years: number | null;
  min_age: number | null;
  max_age: number | null;
  first_day_of_play: DbDate | null;
  last_day_of_play: DbDate | null;
  allows_waitlist: number;
  allows_sabbatical: number;
  predecessor_league_id: number | null;
  successor_league_id: number | null;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface LeagueDrawTime {
  id: number;
  league_id: number;
  draw_time: string;
}

export interface LeagueException {
  id: number;
  league_id: number;
  exception_date: DbDate;
}

export interface Sheet {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LeagueDivision {
  id: number;
  league_id: number;
  name: string;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface LeagueTeam {
  id: number;
  league_id: number;
  division_id: number;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: number;
  league_id: number;
  team1_id: number;
  team2_id: number;
  game_date: DbDate | null;
  game_time: string | null;
  sheet_id: number | null;
  status: 'scheduled' | 'unscheduled';
  created_at: DbDate;
  updated_at: DbDate;
}

export interface LeagueExtraDraw {
  id: number;
  league_id: number;
  draw_date: DbDate;
  draw_time: string;
  created_at: DbDate;
}

export interface DrawSheetAvailability {
  id: number;
  league_id: number;
  draw_date: DbDate;
  draw_time: string;
  sheet_id: number;
  is_available: number;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface TeamMember {
  id: number;
  team_id: number;
  member_id: number;
  role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
  is_skip: number;
  is_vice: number;
  created_at: string;
  updated_at: string;
}

export interface LeagueMemberRole {
  id: number;
  member_id: number;
  league_id: number | null;
  role: 'league_manager' | 'league_administrator';
  created_at: string;
  updated_at: string;
}

export interface LeagueRosterMember {
  id: number;
  league_id: number;
  member_id: number;
  created_at: string;
  updated_at: string;
}

export interface MemberAvailability {
  id: number;
  member_id: number;
  league_id: number;
  available: number;
  can_skip: number;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface SpareRequest {
  id: number;
  requester_id: number;
  league_id: number | null;
  game_id: number | null;
  requested_for_name: string;
  requested_for_member_id: number | null;
  game_date: DbDate;
  game_time: string;
  position: 'lead' | 'second' | 'vice' | 'skip' | null;
  message: string | null;
  request_type: 'public' | 'private';
  status: 'open' | 'filled' | 'cancelled';
  filled_by_member_id: number | null;
  cancelled_by_member_id: number | null;
  filled_at: DbDate | null;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface SpareRequestInvitation {
  id: number;
  spare_request_id: number;
  member_id: number;
  created_at: DbDate;
}

export interface SpareResponse {
  id: number;
  spare_request_id: number;
  member_id: number;
  comment: string | null;
  created_at: DbDate;
}

export interface JWTPayload {
  memberId: number;
  /** Real authenticated member when {@link memberId} is an impersonation target. */
  actorMemberId?: number;
  email: string | null;
  phone: string | null;
  isAdmin?: boolean;
  authz?: AuthzClaims;
  issuedAtEpochMs?: number;
}

export interface AuthenticatedMember {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  spareOnly: boolean;
  socialMember: boolean;
  isAdmin: boolean;
  isServerAdmin: boolean;
  isCalendarAdmin: boolean;
  isContentAdmin: boolean;
  isSponsorAdmin: boolean;
  leagueManagerLeagueIds: number[];
  isLeagueAdministrator: boolean;
  isLeagueAdministratorGlobal: boolean;
  roleCodes: string[];
  roleNames: string[];
  scopeRules: AuthzRule[];
  firstLoginCompleted: boolean;
  optedInSms: boolean;
  emailSubscribed: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
  themePreference: 'light' | 'dark' | 'system';
}

export interface MemberSummary {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  validThrough?: string | null;
  spareOnly?: boolean;
  socialMember?: boolean;
  isAdmin: boolean;
  isServerAdmin?: boolean;
  isCalendarAdmin?: boolean;
  isContentAdmin?: boolean;
  isSponsorAdmin?: boolean;
  isLeagueAdministratorGlobal?: boolean;
  isInServerAdminsList?: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
  createdAt: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  firstLoginCompleted: boolean;
}

export interface SponsorshipLevel {
  id: number;
  name: string;
  amount: number;
  sort_order: number;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface Sponsor {
  id: number;
  name: string;
  website_url: string;
  logo_file_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  created_at: DbDate;
  updated_at: DbDate;
}

export interface Sponsorship {
  id: number;
  sponsor_id: number;
  sponsorship_level_id: number;
  start_date: DbDate | null;
  end_date: DbDate | null;
  created_at: DbDate;
  updated_at: DbDate;
}
