export const buildingAccessContentTypeSchema = {
  type: 'string',
  enum: ['markdown', 'html'],
} as const;

export const buildingAccessPageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contentType: buildingAccessContentTypeSchema,
    content: { type: 'string' },
    hasAccessCode: { type: 'boolean' },
  },
  required: ['contentType', 'content', 'hasAccessCode'],
} as const;

export const buildingAccessCodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessCode: { type: 'string', minLength: 4, maxLength: 4 },
  },
  required: ['accessCode'],
} as const;

export const buildingAccessAdminSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessCode: { type: 'string' },
    contentType: buildingAccessContentTypeSchema,
    content: { type: 'string' },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['accessCode', 'contentType', 'content', 'updatedAt'],
} as const;

export const buildingAccessAdminUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accessCode: { type: 'string', pattern: '^[0-9]{4}$' },
    contentType: buildingAccessContentTypeSchema,
    content: { type: 'string' },
  },
  required: ['accessCode', 'contentType', 'content'],
} as const;
