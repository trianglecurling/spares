export const boardMeetingMinutesItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    meetingDate: { type: 'string' },
    documentUrl: { type: 'string' },
    comment: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'meetingDate', 'documentUrl', 'comment', 'createdAt', 'updatedAt'],
} as const;

export const boardMeetingMinutesFiscalYearGroupSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fiscalYearStartYear: { type: 'number' },
    label: { type: 'string' },
    minutes: { type: 'array', items: boardMeetingMinutesItemSchema },
  },
  required: ['fiscalYearStartYear', 'label', 'minutes'],
} as const;

export const boardMeetingMinutesListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canManage: { type: 'boolean' },
    fiscalYearStartMmdd: { type: 'string' },
    fiscalYears: { type: 'array', items: boardMeetingMinutesFiscalYearGroupSchema },
  },
  required: ['canManage', 'fiscalYearStartMmdd', 'fiscalYears'],
} as const;

export const boardMeetingMinutesWriteBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meetingDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    documentUrl: { type: 'string', minLength: 1 },
    comment: { type: ['string', 'null'] },
  },
  required: ['meetingDate', 'documentUrl'],
} as const;
