export type AuthRequestCodeBody = {
  contact: string;
};

export type AuthRequestCodeResponse = {
  success: boolean;
  multipleMembers: boolean;
};

export type AuthVerifyCodeBody = {
  contact: string;
  code: string;
};

export type AuthMemberOption = {
  id: number;
  name: string;
};

export type AuthVerifySelectionResponse = {
  requiresSelection: true;
  tempToken: string;
  members: AuthMemberOption[];
};

export type AuthSelectMemberBody = {
  memberId: number;
  tempToken: string;
};

export type AuthVerifySuccessResponse<TMember> = {
  token: string;
  member: TMember;
};

export type AuthVerifyCodeResponse<TMember> =
  | AuthVerifySelectionResponse
  | AuthVerifySuccessResponse<TMember>;

export type AuthVerifyTokenResponse<TMember> = {
  member: TMember;
};

export type MemberProfileResponse = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  validThrough: string | null;
  spareOnly: boolean;
  isAdmin: boolean;
  isServerAdmin: boolean;
  firstLoginCompleted: boolean;
  optedInSms: boolean;
  emailSubscribed: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
  themePreference: string;
};

export type MemberLeaguesResponse = Array<{
  leagueId: number;
  leagueName: string;
  dayOfWeek: number;
  teamId: number | null;
  teamName: string | null;
}>;

export type MemberSummaryResponse = {
  id: number;
  name: string;
  isAdmin: boolean;
  isServerAdmin: boolean;
  isLeagueAdministratorGlobal?: boolean;
  isInServerAdminsList: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
  firstLoginCompleted: boolean;
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  validThrough?: string | null;
  spareOnly?: boolean;
};

export type MemberCreateResponse = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  validThrough: string | null;
  spareOnly: boolean;
  isAdmin: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
};

export type MemberUpdateResponse = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  validThrough: string | null;
  isAdmin: boolean;
  isServerAdmin: boolean;
  emailSubscribed: boolean;
  optedInSms: boolean;
};

export type BulkCreateResponse = {
  success: boolean;
  count: number;
  ids: number[];
};

export type BulkDeleteResponse = {
  success: boolean;
  deletedCount: number;
};

export type LoginLinkResponse = {
  loginLink: string;
};

export type BulkSendWelcomeResponse = {
  success: boolean;
  sent: number;
};

export type ApiErrorResponse = {
  error: string;
  message?: string;
  details?: unknown;
  requiresInstallation?: boolean;
};

export type PublicConfigResponse = {
  disableSms: boolean;
  captureFrontendLogs: boolean;
  dashboardAlertTitle: string | null;
  dashboardAlertBody: string | null;
  dashboardAlertExpiresAt: string | null;
  dashboardAlertVariant: string | null;
  dashboardAlertIcon: string | null;
};

export type InstallStatusResponse = {
  configured: boolean;
};

export type InstallConfigResponse =
  | null
  | {
      type: 'sqlite' | 'postgres';
      sqlite?: { path: string };
      postgres?: {
        host: string;
        port: number;
        database: string;
        username: string;
        password?: string | null;
        ssl?: boolean;
      };
      adminEmails: string[];
    };

export type InstallCreateAdminResponse = {
  success: boolean;
  created: number;
  updated: number;
  total: number;
};

export type FeedbackCaptchaResponse = {
  token: string;
  question: string;
  expiresAt: string;
};

export type FeedbackSubmitResponse = {
  ok: boolean;
};

export type FeedbackEntryResponse = {
  id: number;
  category: string;
  body: string;
  email: string | null;
  memberId: number | null;
  pagePath: string | null;
  userAgent: string | null;
  createdAt: string;
  memberName: string | null;
  memberEmail: string | null;
};

export type ConfigResponse = {
  twilioApiKeySid: string | null;
  twilioApiKeySecret: string | null;
  twilioAccountSid: string | null;
  twilioCampaignSid: string | null;
  azureConnectionString: string | null;
  azureSenderEmail: string | null;
  dashboardAlertTitle: string | null;
  dashboardAlertBody: string | null;
  dashboardAlertExpiresAt: string | null;
  dashboardAlertVariant: string | null;
  dashboardAlertIcon: string | null;
  testMode: boolean;
  disableEmail: boolean;
  disableSms: boolean;
  frontendOtelEnabled: boolean;
  captureFrontendLogs: boolean;
  captureBackendLogs: boolean;
  testCurrentTime: string | null;
  notificationDelaySeconds: number;
  updatedAt: string | null;
};

export type UpdateConfigBody = {
  twilioApiKeySid?: string;
  twilioApiKeySecret?: string;
  twilioAccountSid?: string;
  twilioCampaignSid?: string;
  azureConnectionString?: string;
  azureSenderEmail?: string | null;
  azureSenderDisplayName?: string;
  dashboardAlertTitle?: string | null;
  dashboardAlertBody?: string | null;
  dashboardAlertExpiresAt?: string | null;
  dashboardAlertVariant?: 'info' | 'warning' | 'success' | 'danger' | null;
  dashboardAlertIcon?: 'none' | 'info' | 'warning' | 'announcement' | 'success' | 'error' | null;
  testMode?: boolean;
  disableEmail?: boolean;
  disableSms?: boolean;
  frontendOtelEnabled?: boolean;
  captureFrontendLogs?: boolean;
  captureBackendLogs?: boolean;
  testCurrentTime?: string | null;
  notificationDelaySeconds?: number;
};

export type DatabaseConfigBody = {
  databaseType: 'sqlite' | 'postgres';
  sqlite?: { path?: string };
  postgres?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password?: string;
    ssl?: boolean;
  };
  adminEmails: string[];
};

export type ObservabilityResponse = {
  rangeDays: number;
  startDate: string;
  endDate: string;
  totals: {
    membersTotal: number;
    dauToday: number;
    dau7DayAvg: number;
    emailsToday: number;
    emailsSentToday: number;
    emailsLoggedToday: number;
    spareRequestsCreatedToday: number;
    spareRequestsFilledToday: number;
    avgTimeToFillMinutes: number | null;
  };
  series: Array<{
    date: string;
    dau: number;
    emailsSent: number;
    emailsLogged: number;
    smsSent: number;
    smsLogged: number;
    spareRequestsCreated: number;
    spareRequestsFilled: number;
    spareOffersCancelled: number;
    spareRequestsCancelled: number;
    logins: number;
    authCodesRequested: number;
  }>;
};

export type TestMessageResponse = {
  success: boolean;
  message: string;
};

export type DatabaseConfigResponse = {
  type: 'sqlite' | 'postgres';
  sqlite?: { path: string };
  postgres?: {
    host: string;
    port: number;
    database: string;
    username: string;
    ssl?: boolean;
  };
  adminEmails: string[];
};

export type SpareCcResponse = Array<{
  id: number;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName: string | null;
  position: string | null;
  message: string | null;
  requestType: string;
  status: string;
  filledByName: string | null;
  filledAt: string | null;
  createdAt: string;
}>;

export type SpareListResponse = Array<{
  id: number;
  requesterName: string;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName: string | null;
  position: string | null;
  message: string | null;
  requestType: string;
  inviteStatus?: string;
  createdAt: string;
}>;

export type SpareInvitationResponse = Array<{
  memberId: number;
  name: string;
  email: string;
  status: string;
  declinedAt: string | null;
  declineComment: string | null;
  invitedAt: string;
}>;

export type SpareStatusResponse = {
  id: number;
  status: string;
};

export type SpareInviteResponse = {
  success: boolean;
  invited: number;
};

export type SpareMakePublicResponse = {
  success: boolean;
  notificationsSent?: number;
  notificationsQueued?: number;
  notificationStatus?: string;
};

export type SpareMyRequestsResponse = Array<{
  id: number;
  requestedForName: string;
  requestedForMemberId: number | null;
  gameDate: string;
  gameTime: string;
  leagueName: string | null;
  position: string | null;
  message: string | null;
  requestType: string;
  status: string;
  requesterId: number;
  requesterName: string | null;
  cancelledByName: string | null;
  filledByName: string | null;
  filledByEmail: string | null;
  filledByPhone: string | null;
  filledAt: string | null;
  sparerComment: string | null;
  notificationsSentAt: string | null;
  hadCancellation: boolean;
  invites?: Array<{ name: string; status: string }>;
  inviteCounts?: { total: number; pending: number; declined: number };
  createdAt: string;
}>;

export type SpareMyRequestsPastResponse = Array<{
  id: number;
  requestedForName: string;
  requestedForMemberId: number | null;
  gameDate: string;
  gameTime: string;
  position: string | null;
  message: string | null;
  requestType: string;
  status: string;
  requesterId: number;
  requesterName: string | null;
  cancelledByName: string | null;
  filledByName: string | null;
  filledByEmail: string | null;
  filledByPhone: string | null;
  filledAt: string | null;
  sparerComment: string | null;
  notificationsSentAt: string | null;
  hadCancellation: boolean;
  createdAt: string;
}>;

export type SpareMySparingResponse = Array<{
  id: number;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName: string | null;
  position: string | null;
  message: string | null;
  requestType: string;
  createdAt: string;
}>;

export type SpareFilledUpcomingResponse = Array<{
  id: number;
  requesterName: string;
  requestedForName: string;
  gameDate: string;
  gameTime: string;
  leagueName: string | null;
  position: string | null;
  message: string | null;
  requestType: string;
  filledByName: string | null;
  filledAt: string | null;
  createdAt: string;
}>;

export type SpareCreateResponse =
  | {
      duplicate: true;
      existingRequest: {
        id: number;
        leagueName: string | null;
        requestedForName: string;
        gameDate: string;
        gameTime: string;
      };
    }
  | {
      id: number;
      success: boolean;
      notificationsSent: number;
    }
  | {
      id: number;
      success: boolean;
      notificationsQueued: number;
      notificationStatus: string;
      notificationMode: string;
      message?: string;
    };

export type SpareNotificationStatusResponse = {
  notificationStatus: string | null;
  totalMembers: number;
  notifiedMembers: number;
  nextNotificationAt: string | null;
  notificationPaused: boolean;
};

export type UpdateProfileBody = {
  name?: string;
  email?: string;
  phone?: string;
  optedInSms?: boolean;
  emailVisible?: boolean;
  phoneVisible?: boolean;
  themePreference?: 'light' | 'dark' | 'system';
};

export type CreateMemberBody = {
  name: string;
  email: string;
  phone?: string;
  validThrough?: string | null;
  spareOnly?: boolean;
  isAdmin?: boolean;
  isServerAdmin?: boolean;
};

export type UpdateMemberBody = {
  name?: string;
  email?: string;
  phone?: string;
  validThrough?: string | null;
  spareOnly?: boolean;
  isAdmin?: boolean;
  isServerAdmin?: boolean;
};

export type BulkDeleteBody = {
  ids: number[];
};

export type BulkCreateBody =
  | Array<{ name: string; email: string; phone?: string }>
  | {
      members: Array<{ name: string; email: string; phone?: string }>;
      validThrough?: string | null;
      spareOnly?: boolean;
    };
