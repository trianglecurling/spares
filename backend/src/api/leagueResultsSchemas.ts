/**
 * OpenAPI/response schemas for game results, lineups, standings, and league ranking settings.
 */

export const leagueSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leagueId: { type: 'number' },
    headToHeadFirst: { type: 'boolean' },
    resultLabels: { type: ['array', 'null'], items: { type: 'string' } },
    collectByeRequests: { type: 'boolean' },
  },
  required: ['leagueId', 'headToHeadFirst', 'resultLabels', 'collectByeRequests'],
} as const;

export const gameResultValueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resultOrder: { type: 'number' },
    value: { type: 'number' },
  },
  required: ['resultOrder', 'value'],
} as const;

export const gameResultsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gameId: { type: 'number' },
    team1Results: { type: 'array', items: gameResultValueSchema },
    team2Results: { type: 'array', items: gameResultValueSchema },
  },
  required: ['gameId', 'team1Results', 'team2Results'],
} as const;

export const gameResultsPutBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    team1Results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { resultOrder: { type: 'number' }, value: { type: 'number' } },
        required: ['resultOrder', 'value'],
      },
    },
    team2Results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { resultOrder: { type: 'number' }, value: { type: 'number' } },
        required: ['resultOrder', 'value'],
      },
    },
  },
  required: ['team1Results', 'team2Results'],
} as const;

export const lineupEntrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    memberName: { type: 'string' },
    role: { type: 'string', enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] },
    isSpare: { type: 'boolean' },
    sparingForMemberId: { type: ['number', 'null'] },
    sparingForMemberName: { type: ['string', 'null'] },
    isSkip: { type: 'boolean' },
    isVice: { type: 'boolean' },
  },
  required: ['memberId', 'memberName', 'role', 'isSpare', 'sparingForMemberId', 'sparingForMemberName', 'isSkip', 'isVice'],
} as const;

export const gameLineupsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gameId: { type: 'number' },
    team1Lineup: { type: 'array', items: lineupEntrySchema },
    team2Lineup: { type: 'array', items: lineupEntrySchema },
  },
  required: ['gameId', 'team1Lineup', 'team2Lineup'],
} as const;

export const gameLineupsPutBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    team1Lineup: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memberId: { type: 'number' },
          role: { type: 'string', enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] },
          isSpare: { type: 'boolean' },
          sparingForMemberId: { type: ['number', 'null'] },
        },
        required: ['memberId', 'role', 'isSpare', 'sparingForMemberId'],
      },
    },
    team2Lineup: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memberId: { type: 'number' },
          role: { type: 'string', enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] },
          isSpare: { type: 'boolean' },
          sparingForMemberId: { type: ['number', 'null'] },
        },
        required: ['memberId', 'role', 'isSpare', 'sparingForMemberId'],
      },
    },
  },
  required: ['team1Lineup', 'team2Lineup'],
} as const;

export const standingRowSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rank: { type: 'number' },
    teamId: { type: 'number' },
    teamName: { type: ['string', 'null'] },
    divisionId: { type: 'number' },
    divisionName: { type: 'string' },
    tiebreakerValues: { type: 'array', items: { type: 'number' } },
    gamesPlayed: { type: 'number' },
  },
  required: ['rank', 'teamId', 'teamName', 'divisionId', 'divisionName', 'tiebreakerValues', 'gamesPlayed'],
} as const;

export const standingsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    divisionId: { type: 'number' },
    divisionName: { type: 'string' },
    headToHeadFirst: { type: 'boolean' },
    resultLabels: { type: ['array', 'null'], items: { type: 'string' } },
    rows: { type: 'array', items: standingRowSchema },
  },
  required: ['divisionId', 'divisionName', 'headToHeadFirst', 'resultLabels', 'rows'],
} as const;

export const leagueStandingsResponseSchema = {
  type: 'array',
  items: standingsResponseSchema,
} as const;

export const leagueSettingsPutBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headToHeadFirst: { type: 'boolean' },
    resultLabels: { type: ['array', 'null'], items: { type: 'string' } },
    collectByeRequests: { type: 'boolean' },
  },
} as const;

export const teamStatsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teamId: { type: 'number' },
    teamName: { type: ['string', 'null'] },
    gamesPlayed: { type: 'number' },
    wins: { type: 'number' },
    losses: { type: 'number' },
    ties: { type: 'number' },
  },
  required: ['teamId', 'teamName', 'gamesPlayed', 'wins', 'losses', 'ties'],
} as const;

export const memberStatsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    memberName: { type: 'string' },
    gamesPlayed: { type: 'number' },
    wins: { type: 'number' },
    losses: { type: 'number' },
    ties: { type: 'number' },
  },
  required: ['memberId', 'memberName', 'gamesPlayed', 'wins', 'losses', 'ties'],
} as const;

export const memberStatsListResponseSchema = {
  type: 'array',
  items: memberStatsSchema,
} as const;

export const gameWithResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    team1Id: { type: 'number' },
    team2Id: { type: 'number' },
    team1Name: { type: ['string', 'null'] },
    team2Name: { type: ['string', 'null'] },
    gameDate: { type: ['string', 'null'] },
    gameTime: { type: ['string', 'null'] },
    sheetId: { type: ['number', 'null'] },
    sheetName: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['scheduled', 'unscheduled'] },
    hasResult: { type: 'boolean' },
    team1Results: { type: 'array', items: { type: 'number' } },
    team2Results: { type: 'array', items: { type: 'number' } },
  },
  required: [
    'id',
    'leagueId',
    'team1Id',
    'team2Id',
    'team1Name',
    'team2Name',
    'gameDate',
    'gameTime',
    'sheetId',
    'sheetName',
    'status',
    'hasResult',
    'team1Results',
    'team2Results',
  ],
} as const;

export const gameListWithResultsResponseSchema = {
  type: 'array',
  items: gameWithResultSchema,
} as const;
