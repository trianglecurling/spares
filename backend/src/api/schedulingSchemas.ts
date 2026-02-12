export const teamByeRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    teamId: { type: 'number' },
    teamName: { type: ['string', 'null'] },
    drawDate: { type: 'string' },
    priority: { type: 'number' },
    note: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'teamId', 'drawDate', 'priority'],
} as const;

export const teamByeRequestListResponseSchema = {
  type: 'array',
  items: teamByeRequestSchema,
} as const;

/** Response for GET league bye-requests: list of requests plus per-team prefer late draw */
export const leagueByeRequestsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requests: teamByeRequestListResponseSchema,
    preferLateDrawByTeam: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
      description: 'Map of team id to prefer late draw',
    },
  },
  required: ['requests', 'preferLateDrawByTeam'],
} as const;

/** Response for GET team bye-requests: bye requests plus draw preference */
export const teamByeRequestsWithPreferenceResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    byeRequests: teamByeRequestListResponseSchema,
    preferLateDraw: { type: 'boolean' },
  },
  required: ['byeRequests', 'preferLateDraw'],
} as const;

export const teamByeRequestCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teamId: { type: 'number' },
    drawDate: { type: 'string' },
    priority: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['teamId', 'drawDate', 'priority'],
} as const;

export const teamByeRequestUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    drawDate: { type: 'string' },
    priority: { type: 'number' },
    note: { type: 'string' },
  },
} as const;

export const teamByeRequestsReplaceBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          drawDate: { type: 'string' },
          priority: { type: 'number' },
        },
        required: ['drawDate', 'priority'],
      },
    },
    preferLateDraw: { type: 'boolean' },
  },
  required: ['requests'],
} as const;
