export const gameSchema = {
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
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
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
    'createdAt',
    'updatedAt',
  ],
} as const;

export const gameListResponseSchema = {
  type: 'array',
  items: gameSchema,
} as const;

export const gameCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    team1Id: { type: 'number' },
    team2Id: { type: 'number' },
    gameDate: { type: 'string' },
    gameTime: { type: 'string' },
    sheetId: { type: 'number' },
    status: { type: 'string', enum: ['scheduled', 'unscheduled'] },
  },
  required: ['team1Id', 'team2Id'],
} as const;

export const gameUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    team1Id: { type: 'number' },
    team2Id: { type: 'number' },
    gameDate: { type: ['string', 'null'] },
    gameTime: { type: ['string', 'null'] },
    sheetId: { type: ['number', 'null'] },
    status: { type: 'string', enum: ['scheduled', 'unscheduled'] },
  },
} as const;

export const drawSlotSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string' },
    time: { type: 'string' },
    isExtra: { type: 'boolean' },
    extraDrawId: { type: ['number', 'null'] },
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          isAvailable: { type: 'boolean' },
        },
        required: ['id', 'name', 'isAvailable'],
      },
    },
  },
  required: ['date', 'time', 'isExtra', 'extraDrawId', 'sheets'],
} as const;

export const drawSlotListResponseSchema = {
  type: 'array',
  items: drawSlotSchema,
} as const;

export const extraDrawCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['date', 'time'],
} as const;

export const extraDrawResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    date: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['id', 'leagueId', 'date', 'time'],
} as const;

export const drawAvailabilityUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string' },
    time: { type: 'string' },
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sheetId: { type: 'number' },
          isAvailable: { type: 'boolean' },
        },
        required: ['sheetId', 'isAvailable'],
      },
    },
  },
  required: ['date', 'time', 'sheets'],
} as const;

export const memberUpcomingGameSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    leagueName: { type: 'string' },
    team1Id: { type: 'number' },
    team2Id: { type: 'number' },
    team1Name: { type: ['string', 'null'] },
    team2Name: { type: ['string', 'null'] },
    gameDate: { type: ['string', 'null'] },
    gameTime: { type: ['string', 'null'] },
    sheetId: { type: ['number', 'null'] },
    sheetName: { type: ['string', 'null'] },
  },
  required: [
    'id',
    'leagueId',
    'leagueName',
    'team1Id',
    'team2Id',
    'team1Name',
    'team2Name',
    'gameDate',
    'gameTime',
    'sheetId',
    'sheetName',
  ],
} as const;

export const memberUpcomingGamesResponseSchema = {
  type: 'array',
  items: memberUpcomingGameSchema,
} as const;
