export interface Member {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  valid_through: string | null;
  spare_only: number;
  is_admin: number;
  is_server_admin: number;
  opted_in_sms: number;
  email_subscribed: number;
  first_login_completed: number;
  email_visible: number;
  phone_visible: number;
  theme_preference: string | null;
  created_at: string;
  updated_at: string;
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
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface LeagueDrawTime {
  id: number;
  league_id: number;
  draw_time: string;
}

export interface LeagueException {
  id: number;
  league_id: number;
  exception_date: string;
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
  role: 'league_manager';
  created_at: string;
  updated_at: string;
}

export interface MemberAvailability {
  id: number;
  member_id: number;
  league_id: number;
  available: number;
  can_skip: number;
  created_at: string;
  updated_at: string;
}

export interface SpareRequest {
  id: number;
  requester_id: number;
  requested_for_name: string;
  game_date: string;
  game_time: string;
  position: 'lead' | 'second' | 'vice' | 'skip' | null;
  message: string | null;
  request_type: 'public' | 'private';
  status: 'open' | 'filled' | 'cancelled';
  filled_by_member_id: number | null;
  filled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpareRequestInvitation {
  id: number;
  spare_request_id: number;
  member_id: number;
  created_at: string;
}

export interface SpareResponse {
  id: number;
  spare_request_id: number;
  member_id: number;
  comment: string | null;
  created_at: string;
}

export interface JWTPayload {
  memberId: number;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
}
