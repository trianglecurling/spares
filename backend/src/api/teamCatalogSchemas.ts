/** OpenAPI/response schemas for the current league and bonspiel team catalog. */

export const catalogPlayerPositionSchema = {
  type: 'string',
  enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'],
} as const;

export const catalogPlayerSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    homeClub: { type: 'string' },
    position: catalogPlayerPositionSchema,
    isVice: { type: 'boolean' },
    isSkip: { type: 'boolean' },
  },
  required: ['firstName', 'lastName', 'homeClub', 'position', 'isVice', 'isSkip'],
} as const;

export const catalogTeamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teamName: { type: 'string' },
    players: { type: 'array', items: catalogPlayerSchema },
  },
  required: ['teamName', 'players'],
} as const;

export const catalogContextSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    teams: { type: 'array', items: catalogTeamSchema },
  },
  required: ['id', 'name', 'teams'],
} as const;

export const teamCatalogResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    events: { type: 'array', items: catalogContextSchema },
    leagues: { type: 'array', items: catalogContextSchema },
  },
  required: ['events', 'leagues'],
} as const;

export const teamCatalogErrorSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;
