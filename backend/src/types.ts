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
  isInServerAdminsList?: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
  createdAt: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  firstLoginCompleted: boolean;
}
