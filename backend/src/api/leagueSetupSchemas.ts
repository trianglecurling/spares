export const sheetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    sortOrder: { type: 'number' },
    isActive: { type: 'boolean' },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'sortOrder', 'isActive', 'createdAt', 'updatedAt'],
} as const;

export const sheetListResponseSchema = {
  type: 'array',
  items: sheetSchema,
} as const;

export const sheetCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    isActive: { type: 'boolean' },
  },
  required: ['name'],
} as const;

export const sheetUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    isActive: { type: 'boolean' },
  },
} as const;

export const divisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    name: { type: 'string' },
    sortOrder: { type: 'number' },
    isDefault: { type: 'boolean' },
  },
  required: ['id', 'leagueId', 'name', 'sortOrder', 'isDefault'],
} as const;

export const divisionListResponseSchema = {
  type: 'array',
  items: divisionSchema,
} as const;

export const divisionCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    isDefault: { type: 'boolean' },
  },
  required: ['name'],
} as const;

export const divisionUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    isDefault: { type: 'boolean' },
  },
} as const;

export const rosterMemberSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    name: { type: 'string' },
    email: { type: ['string', 'null'] },
    assignedTeamId: { type: ['number', 'null'] },
    assignedTeamName: { type: ['string', 'null'] },
  },
  required: ['memberId', 'name', 'email', 'assignedTeamId', 'assignedTeamName'],
} as const;

export const rosterListResponseSchema = {
  type: 'array',
  items: rosterMemberSchema,
} as const;

export const rosterUnassignedResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memberId: { type: 'number' },
      name: { type: 'string' },
      email: { type: ['string', 'null'] },
    },
    required: ['memberId', 'name', 'email'],
  },
} as const;

export const rosterSearchResponseSchema = {
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

export const rosterAddBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
  },
  required: ['memberId'],
} as const;

export const rosterAddResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    memberId: { type: 'number' },
  },
  required: ['id', 'leagueId', 'memberId'],
} as const;

export const rosterBulkBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    names: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
  },
  required: ['names'],
} as const;

export const rosterBulkResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    addedCount: { type: 'number' },
    alreadyOnRosterCount: { type: 'number' },
    matchedCount: { type: 'number' },
    matchedNames: { type: 'array', items: { type: 'string' } },
    unmatched: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          candidates: {
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
          },
        },
        required: ['name', 'candidates'],
      },
    },
  },
  required: ['addedCount', 'alreadyOnRosterCount', 'matchedCount', 'matchedNames', 'unmatched'],
} as const;

export const managerListResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memberId: { type: 'number' },
      name: { type: 'string' },
      email: { type: ['string', 'null'] },
    },
    required: ['memberId', 'name', 'email'],
  },
} as const;

export const managerSearchResponseSchema = rosterSearchResponseSchema;

export const managerAddBodySchema = rosterAddBodySchema;

export const managerAddResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: ['number', 'null'] },
    leagueId: { type: 'number' },
    memberId: { type: 'number' },
  },
  required: ['leagueId', 'memberId'],
} as const;

export const teamMemberSchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    role: { type: 'string', enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] },
    isSkip: { type: 'boolean' },
    isVice: { type: 'boolean' },
  },
  required: ['memberId', 'role'],
} as const;

export const teamCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    divisionId: { type: 'number' },
    members: { type: 'array', items: teamMemberSchemaJson },
  },
} as const;

export const teamUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    divisionId: { type: 'number' },
  },
} as const;

export const teamRosterUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    members: { type: 'array', items: teamMemberSchemaJson },
  },
  required: ['members'],
} as const;

export const teamRosterEntrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    memberId: { type: 'number' },
    name: { type: 'string' },
    role: { type: 'string', enum: ['lead', 'second', 'third', 'fourth', 'player1', 'player2'] },
    isSkip: { type: 'boolean' },
    isVice: { type: 'boolean' },
  },
  required: ['memberId', 'name', 'role', 'isSkip', 'isVice'],
} as const;

export const teamRosterResponseSchema = {
  type: 'array',
  items: teamRosterEntrySchema,
} as const;

export const teamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    divisionId: { type: 'number' },
    divisionName: { type: 'string' },
    name: { type: ['string', 'null'] },
    roster: { type: 'array', items: teamRosterEntrySchema },
  },
  required: ['id', 'leagueId', 'divisionId', 'divisionName', 'name', 'roster'],
} as const;

export const teamListResponseSchema = {
  type: 'array',
  items: teamSchema,
} as const;

export const teamResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    leagueId: { type: 'number' },
    divisionId: { type: 'number' },
    name: { type: ['string', 'null'] },
  },
  required: ['id', 'leagueId', 'divisionId', 'name'],
} as const;

export const memberSearchResponseSchema = rosterSearchResponseSchema;
