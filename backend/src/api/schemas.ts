export const successResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

export const memberProfileResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    validThrough: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    firstLoginCompleted: { type: 'boolean' },
    optedInSms: { type: 'boolean' },
    emailSubscribed: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    themePreference: { type: 'string' },
  },
  required: [
    'id',
    'name',
    'email',
    'phone',
    'validThrough',
    'spareOnly',
    'isAdmin',
    'isServerAdmin',
    'firstLoginCompleted',
    'optedInSms',
    'emailSubscribed',
    'emailVisible',
    'phoneVisible',
    'themePreference',
  ],
} as const;

export const memberSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    validThrough: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    isLeagueAdministratorGlobal: { type: 'boolean' },
    isInServerAdminsList: { type: 'boolean' },
    emailSubscribed: { type: 'boolean' },
    optedInSms: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    firstLoginCompleted: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'isAdmin',
    'isServerAdmin',
    'isLeagueAdministratorGlobal',
    'isInServerAdminsList',
    'emailSubscribed',
    'optedInSms',
    'emailVisible',
    'phoneVisible',
    'firstLoginCompleted',
  ],
} as const;

export const memberListResponseSchema = {
  type: 'array',
  items: memberSummarySchema,
} as const;

export const memberCreateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    validThrough: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    emailSubscribed: { type: 'boolean' },
    optedInSms: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'email',
    'phone',
    'validThrough',
    'spareOnly',
    'isAdmin',
    'emailSubscribed',
    'optedInSms',
  ],
} as const;

export const bulkCreateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    count: { type: 'number' },
    ids: { type: 'array', items: { type: 'number' } },
  },
  required: ['success', 'count', 'ids'],
} as const;

export const memberUpdateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    validThrough: { type: ['string', 'null'] },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
    emailSubscribed: { type: 'boolean' },
    optedInSms: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'email',
    'phone',
    'validThrough',
    'isAdmin',
    'isServerAdmin',
    'emailSubscribed',
    'optedInSms',
  ],
} as const;

export const bulkDeleteResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    deletedCount: { type: 'number' },
  },
  required: ['success', 'deletedCount'],
} as const;

export const loginLinkResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    loginLink: { type: 'string' },
  },
  required: ['loginLink'],
} as const;

export const bulkSendWelcomeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    sent: { type: 'number' },
  },
  required: ['success', 'sent'],
} as const;

export const availabilityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canSkip: { type: 'boolean' },
    leagues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          leagueId: { type: 'number' },
          available: { type: 'boolean' },
        },
        required: ['leagueId', 'available'],
      },
    },
  },
  required: ['canSkip', 'leagues'],
} as const;

export const memberAvailabilityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canSkip: { type: 'boolean' },
    availableLeagues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          leagueId: { type: 'number' },
          leagueName: { type: 'string' },
          dayOfWeek: { type: 'number' },
        },
        required: ['leagueId', 'leagueName', 'dayOfWeek'],
      },
    },
  },
  required: ['canSkip', 'availableLeagues'],
} as const;

export const memberLeaguesResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      leagueId: { type: 'number' },
      leagueName: { type: 'string' },
      dayOfWeek: { type: 'number' },
      teamId: { type: ['number', 'null'] },
      teamName: { type: ['string', 'null'] },
    },
    required: ['leagueId', 'leagueName', 'dayOfWeek', 'teamId', 'teamName'],
  },
} as const;

export const availabilityMembersResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      name: { type: 'string' },
      email: { type: ['string', 'null'] },
    },
    required: ['id', 'name', 'email'],
  },
} as const;

export const leagueResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    dayOfWeek: { type: 'number' },
    format: { type: 'string', enum: ['teams', 'doubles'] },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    drawTimes: { type: 'array', items: { type: 'string' } },
    exceptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'dayOfWeek', 'format', 'startDate', 'endDate', 'drawTimes', 'exceptions'],
} as const;

export const leagueListResponseSchema = {
  type: 'array',
  items: leagueResponseSchema,
} as const;

export const leagueExportResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leagues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          dayOfWeek: { type: 'number' },
          format: { type: 'string', enum: ['teams', 'doubles'] },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          drawTimes: { type: 'array', items: { type: 'string' } },
          exceptions: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'dayOfWeek', 'format', 'startDate', 'endDate', 'drawTimes', 'exceptions'],
      },
    },
  },
  required: ['leagues'],
} as const;

export const leagueImportResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    imported: { type: 'number' },
    leagues: { type: 'array', items: leagueResponseSchema },
  },
  required: ['success', 'imported', 'leagues'],
} as const;

export const upcomingGamesResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      date: { type: 'string' },
      time: { type: 'string' },
    },
    required: ['date', 'time'],
  },
} as const;

export const publicConfigResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    disableSms: { type: 'boolean' },
    captureFrontendLogs: { type: 'boolean' },
    dashboardAlertTitle: { type: ['string', 'null'] },
    dashboardAlertBody: { type: ['string', 'null'] },
    dashboardAlertExpiresAt: { type: ['string', 'null'] },
    dashboardAlertVariant: { type: ['string', 'null'] },
    dashboardAlertIcon: { type: ['string', 'null'] },
  },
  required: [
    'disableSms',
    'captureFrontendLogs',
    'dashboardAlertTitle',
    'dashboardAlertBody',
    'dashboardAlertExpiresAt',
    'dashboardAlertVariant',
    'dashboardAlertIcon',
  ],
} as const;

export const installStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    configured: { type: 'boolean' },
  },
  required: ['configured'],
} as const;

export const installConfigResponseSchema = {
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['sqlite', 'postgres'] },
        sqlite: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
        postgres: {
          type: 'object',
          additionalProperties: false,
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: ['string', 'null'] },
            ssl: { type: 'boolean' },
          },
          required: ['host', 'port', 'database', 'username'],
        },
        adminEmails: { type: 'array', items: { type: 'string' } },
      },
      required: ['type', 'adminEmails'],
    },
  ],
} as const;

export const installCreateAdminResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    created: { type: 'number' },
    updated: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['success', 'created', 'updated', 'total'],
} as const;

export const captchaResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    token: { type: 'string' },
    question: { type: 'string' },
    expiresAt: { type: 'string' },
  },
  required: ['token', 'question', 'expiresAt'],
} as const;

export const feedbackSubmitResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
} as const;

export const feedbackListResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      category: { type: 'string' },
      body: { type: 'string' },
      email: { type: ['string', 'null'] },
      memberId: { type: ['number', 'null'] },
      pagePath: { type: ['string', 'null'] },
      userAgent: { type: ['string', 'null'] },
      createdAt: { type: 'string' },
      memberName: { type: ['string', 'null'] },
      memberEmail: { type: ['string', 'null'] },
    },
    required: ['id', 'category', 'body', 'createdAt'],
  },
} as const;

export const configResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    twilioApiKeySid: { type: ['string', 'null'] },
    twilioApiKeySecret: { type: ['string', 'null'] },
    twilioAccountSid: { type: ['string', 'null'] },
    twilioCampaignSid: { type: ['string', 'null'] },
    azureConnectionString: { type: ['string', 'null'] },
    azureSenderEmail: { type: ['string', 'null'] },
    dashboardAlertTitle: { type: ['string', 'null'] },
    dashboardAlertBody: { type: ['string', 'null'] },
    dashboardAlertExpiresAt: { type: ['string', 'null'] },
    dashboardAlertVariant: { type: ['string', 'null'] },
    dashboardAlertIcon: { type: ['string', 'null'] },
    testMode: { type: 'boolean' },
    disableEmail: { type: 'boolean' },
    disableSms: { type: 'boolean' },
    frontendOtelEnabled: { type: 'boolean' },
    captureFrontendLogs: { type: 'boolean' },
    captureBackendLogs: { type: 'boolean' },
    testCurrentTime: { type: ['string', 'null'] },
    notificationDelaySeconds: { type: 'number' },
    updatedAt: { type: ['string', 'null'] },
  },
  required: [
    'twilioApiKeySid',
    'twilioApiKeySecret',
    'twilioAccountSid',
    'twilioCampaignSid',
    'azureConnectionString',
    'azureSenderEmail',
    'dashboardAlertTitle',
    'dashboardAlertBody',
    'dashboardAlertExpiresAt',
    'dashboardAlertVariant',
    'dashboardAlertIcon',
    'testMode',
    'disableEmail',
    'disableSms',
    'frontendOtelEnabled',
    'captureFrontendLogs',
    'captureBackendLogs',
    'testCurrentTime',
    'notificationDelaySeconds',
    'updatedAt',
  ],
} as const;

export const observabilityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rangeDays: { type: 'number' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    totals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        membersTotal: { type: 'number' },
        dauToday: { type: 'number' },
        dau7DayAvg: { type: 'number' },
        emailsToday: { type: 'number' },
        emailsSentToday: { type: 'number' },
        emailsLoggedToday: { type: 'number' },
        spareRequestsCreatedToday: { type: 'number' },
        spareRequestsFilledToday: { type: 'number' },
        avgTimeToFillMinutes: { type: ['number', 'null'] },
      },
      required: [
        'membersTotal',
        'dauToday',
        'dau7DayAvg',
        'emailsToday',
        'emailsSentToday',
        'emailsLoggedToday',
        'spareRequestsCreatedToday',
        'spareRequestsFilledToday',
        'avgTimeToFillMinutes',
      ],
    },
    series: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          dau: { type: 'number' },
          emailsSent: { type: 'number' },
          emailsLogged: { type: 'number' },
          smsSent: { type: 'number' },
          smsLogged: { type: 'number' },
          spareRequestsCreated: { type: 'number' },
          spareRequestsFilled: { type: 'number' },
          spareOffersCancelled: { type: 'number' },
          spareRequestsCancelled: { type: 'number' },
          logins: { type: 'number' },
          authCodesRequested: { type: 'number' },
        },
        required: [
          'date',
          'dau',
          'emailsSent',
          'emailsLogged',
          'smsSent',
          'smsLogged',
          'spareRequestsCreated',
          'spareRequestsFilled',
          'spareOffersCancelled',
          'spareRequestsCancelled',
          'logins',
          'authCodesRequested',
        ],
      },
    },
  },
  required: ['rangeDays', 'startDate', 'endDate', 'totals', 'series'],
} as const;

export const testMessageResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    message: { type: 'string' },
  },
  required: ['success', 'message'],
} as const;

export const databaseConfigResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['sqlite', 'postgres'] },
    sqlite: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    postgres: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
        database: { type: 'string' },
        username: { type: 'string' },
        ssl: { type: 'boolean' },
      },
      required: ['host', 'port', 'database', 'username'],
    },
    adminEmails: { type: 'array', items: { type: 'string' } },
  },
  required: ['type', 'adminEmails'],
} as const;

export const sparesCcResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requesterName: { type: 'string' },
      requesterEmail: { type: ['string', 'null'] },
      requesterPhone: { type: ['string', 'null'] },
      requestedForName: { type: 'string' },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      leagueName: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      status: { type: 'string' },
      filledByName: { type: ['string', 'null'] },
      filledAt: { type: ['string', 'null'] },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requesterName',
      'requesterEmail',
      'requesterPhone',
      'requestedForName',
      'gameDate',
      'gameTime',
      'leagueName',
      'position',
      'message',
      'requestType',
      'status',
      'filledByName',
      'filledAt',
      'createdAt',
    ],
  },
} as const;

export const sparesListResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requesterName: { type: 'string' },
      requestedForName: { type: 'string' },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      leagueName: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      inviteStatus: { type: 'string' },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requesterName',
      'requestedForName',
      'gameDate',
      'gameTime',
      'leagueName',
      'position',
      'message',
      'requestType',
      'createdAt',
    ],
  },
} as const;

export const spareInvitationsResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memberId: { type: 'number' },
      name: { type: 'string' },
      email: { type: 'string' },
      status: { type: 'string' },
      declinedAt: { type: ['string', 'null'] },
      declineComment: { type: ['string', 'null'] },
      invitedAt: { type: 'string' },
    },
    required: ['memberId', 'name', 'email', 'status', 'declinedAt', 'declineComment', 'invitedAt'],
  },
} as const;

export const spareStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    status: { type: 'string' },
  },
  required: ['id', 'status'],
} as const;

export const spareInviteResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    invited: { type: 'number' },
  },
  required: ['success', 'invited'],
} as const;

export const spareMakePublicResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    notificationsSent: { type: 'number' },
    notificationsQueued: { type: 'number' },
    notificationStatus: { type: 'string' },
  },
  required: ['success'],
} as const;

export const spareMyRequestsResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requestedForName: { type: 'string' },
      requestedForMemberId: { type: ['number', 'null'] },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      leagueName: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      status: { type: 'string' },
      requesterId: { type: 'number' },
      requesterName: { type: ['string', 'null'] },
      cancelledByName: { type: ['string', 'null'] },
      filledByName: { type: ['string', 'null'] },
      filledByEmail: { type: ['string', 'null'] },
      filledByPhone: { type: ['string', 'null'] },
      filledAt: { type: ['string', 'null'] },
      sparerComment: { type: ['string', 'null'] },
      notificationsSentAt: { type: ['string', 'null'] },
      hadCancellation: { type: 'boolean' },
      invites: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['name', 'status'],
        },
      },
      inviteCounts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number' },
          pending: { type: 'number' },
          declined: { type: 'number' },
        },
        required: ['total', 'pending', 'declined'],
      },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requestedForName',
      'requestedForMemberId',
      'gameDate',
      'gameTime',
      'leagueName',
      'position',
      'message',
      'requestType',
      'status',
      'requesterId',
      'requesterName',
      'cancelledByName',
      'filledByName',
      'filledByEmail',
      'filledByPhone',
      'filledAt',
      'sparerComment',
      'notificationsSentAt',
      'hadCancellation',
      'createdAt',
    ],
  },
} as const;

export const spareMyRequestsPastResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requestedForName: { type: 'string' },
      requestedForMemberId: { type: ['number', 'null'] },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      status: { type: 'string' },
      requesterId: { type: 'number' },
      requesterName: { type: ['string', 'null'] },
      cancelledByName: { type: ['string', 'null'] },
      filledByName: { type: ['string', 'null'] },
      filledByEmail: { type: ['string', 'null'] },
      filledByPhone: { type: ['string', 'null'] },
      filledAt: { type: ['string', 'null'] },
      sparerComment: { type: ['string', 'null'] },
      notificationsSentAt: { type: ['string', 'null'] },
      hadCancellation: { type: 'boolean' },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requestedForName',
      'requestedForMemberId',
      'gameDate',
      'gameTime',
      'position',
      'message',
      'requestType',
      'status',
      'requesterId',
      'requesterName',
      'cancelledByName',
      'filledByName',
      'filledByEmail',
      'filledByPhone',
      'filledAt',
      'sparerComment',
      'notificationsSentAt',
      'hadCancellation',
      'createdAt',
    ],
  },
} as const;

export const spareMySparingResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requesterName: { type: 'string' },
      requesterEmail: { type: ['string', 'null'] },
      requesterPhone: { type: ['string', 'null'] },
      requestedForName: { type: 'string' },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      leagueName: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requesterName',
      'requesterEmail',
      'requesterPhone',
      'requestedForName',
      'gameDate',
      'gameTime',
      'leagueName',
      'position',
      'message',
      'requestType',
      'createdAt',
    ],
  },
} as const;

export const spareFilledUpcomingResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'number' },
      requesterName: { type: 'string' },
      requestedForName: { type: 'string' },
      gameDate: { type: 'string' },
      gameTime: { type: 'string' },
      leagueName: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      message: { type: ['string', 'null'] },
      requestType: { type: 'string' },
      filledByName: { type: ['string', 'null'] },
      filledAt: { type: ['string', 'null'] },
      createdAt: { type: 'string' },
    },
    required: [
      'id',
      'requesterName',
      'requestedForName',
      'gameDate',
      'gameTime',
      'leagueName',
      'position',
      'message',
      'requestType',
      'filledByName',
      'filledAt',
      'createdAt',
    ],
  },
} as const;

export const spareCreateResponseSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        duplicate: { type: 'boolean' },
        existingRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'number' },
            leagueName: { type: ['string', 'null'] },
            requestedForName: { type: 'string' },
            gameDate: { type: 'string' },
            gameTime: { type: 'string' },
          },
          required: ['id', 'leagueName', 'requestedForName', 'gameDate', 'gameTime'],
        },
      },
      required: ['duplicate', 'existingRequest'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'number' },
        success: { type: 'boolean' },
        notificationsSent: { type: 'number' },
      },
      required: ['id', 'success', 'notificationsSent'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'number' },
        success: { type: 'boolean' },
        notificationsQueued: { type: 'number' },
        notificationStatus: { type: 'string' },
        notificationMode: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['id', 'success', 'notificationsQueued', 'notificationStatus', 'notificationMode'],
    },
  ],
} as const;

export const spareNotificationStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notificationStatus: { type: ['string', 'null'] },
    totalMembers: { type: 'number' },
    notifiedMembers: { type: 'number' },
    nextNotificationAt: { type: ['string', 'null'] },
    notificationPaused: { type: 'boolean' },
  },
  required: [
    'notificationStatus',
    'totalMembers',
    'notifiedMembers',
    'nextNotificationAt',
    'notificationPaused',
  ],
} as const;
