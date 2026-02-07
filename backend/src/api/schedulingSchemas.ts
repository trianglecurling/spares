export const teamByeRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    teamId: { type: 'number' },
    teamName: { type: ['string', 'null'] },
    drawDate: { type: 'string' },
    drawTime: { type: 'string' },
    priority: { type: 'number' },
    note: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'teamId', 'drawDate', 'drawTime', 'priority'],
} as const;

export const teamByeRequestListResponseSchema = {
  type: 'array',
  items: teamByeRequestSchema,
} as const;

export const teamByeRequestCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teamId: { type: 'number' },
    drawDate: { type: 'string' },
    drawTime: { type: 'string' },
    priority: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['teamId', 'drawDate', 'drawTime', 'priority'],
} as const;

export const teamByeRequestUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    drawDate: { type: 'string' },
    drawTime: { type: 'string' },
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
          drawTime: { type: 'string' },
          priority: { type: 'number' },
        },
        required: ['drawDate', 'drawTime', 'priority'],
      },
    },
  },
  required: ['requests'],
} as const;
