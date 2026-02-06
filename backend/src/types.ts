type DbDate = string | Date;

export interface Member {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  valid_through: DbDate | null;
  spare_only: number;
  is_admin: number;
  is_server_admin: number;
  opted_in_sms: number;
  email_subscribed: number;
  first_login_completed: number;
  email_visible: number;
  phone_visible: number;
  theme_preference: string | null;
  created_at: DbDate;
  updated_at: DbDate;
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
  name: string;
  day_of_week: number;
  format: 'teams' | 'doubles';
  start_date: DbDate;
  end_date: DbDate;
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
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
}

export interface AuthenticatedMember {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  spareOnly: boolean;
  isAdmin: boolean;
  isServerAdmin: boolean;
  leagueManagerLeagueIds: number[];
  isLeagueAdministrator: boolean;
  isLeagueAdministratorGlobal: boolean;
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
  isAdmin: boolean;
  isServerAdmin?: boolean;
  isLeagueAdministratorGlobal?: boolean;
  isInServerAdminsList?: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
  createdAt: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  firstLoginCompleted: boolean;
}
