export const memberCommunicationsEmailSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    subject: { type: 'string' },
    sortDate: { type: ['string', 'null'] },
    previewUrl: { type: 'string' },
  },
  required: ['id', 'name', 'subject', 'sortDate', 'previewUrl'],
} as const;

export const memberCommunicationsSeasonGroupSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seasonId: { type: ['number', 'null'] },
    seasonName: { type: 'string' },
    emails: { type: 'array', items: memberCommunicationsEmailSchema },
  },
  required: ['seasonId', 'seasonName', 'emails'],
} as const;

export const memberCommunicationsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seasons: { type: 'array', items: memberCommunicationsSeasonGroupSchema },
  },
  required: ['seasons'],
} as const;
