const sheetSchema = { type: ['string', 'null'], enum: ['A', 'B', 'C', 'D', null] } as const;
const colorSchema = { type: ['string', 'null'], enum: ['red', 'yellow', null] } as const;
const rockNumberSchema = { type: ['integer', 'null'], minimum: 1, maximum: 8 } as const;
const sideSchema = { type: 'string', enum: ['A', 'B'] } as const;
const dateOnlySchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const activityTypeSchema = {
  type: 'string',
  enum: ['texturing', 'band_narrowing', 'imprinting'],
} as const;
const sandpaperConditionSchema = {
  type: ['string', 'null'],
  enum: ['new', 'used_once', 'used_twice', null],
} as const;
const placementChangeTypeSchema = {
  type: 'string',
  enum: ['added', 'moved', 'swapped', 'rotated', 'flipped'],
} as const;

export const curlingStoneIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^\\d+$' } },
  required: ['id'],
} as const;

export const curlingStoneCurrentPlacementSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    sheet: sheetSchema,
    color: colorSchema,
    rockNumber: rockNumberSchema,
    side: sideSchema,
    effectiveDate: { type: 'string' },
  },
  required: ['sheet', 'color', 'rockNumber', 'side', 'effectiveDate'],
} as const;

export const curlingStoneSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer' },
    wcfRegistrationNumber: { type: 'string' },
    alSerialNumber: { type: 'string' },
    notes: { type: ['string', 'null'] },
    current: curlingStoneCurrentPlacementSchema,
    lastMaintenance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        texturing: { type: ['string', 'null'] },
        bandNarrowing: { type: ['string', 'null'] },
        imprinting: { type: ['string', 'null'] },
      },
      required: ['texturing', 'bandNarrowing', 'imprinting'],
    },
  },
  required: ['id', 'wcfRegistrationNumber', 'alSerialNumber', 'notes', 'current', 'lastMaintenance'],
} as const;

export const curlingStonePlacementSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer' },
    sheet: sheetSchema,
    color: colorSchema,
    rockNumber: rockNumberSchema,
    side: sideSchema,
    effectiveDate: { type: 'string' },
    changeType: placementChangeTypeSchema,
    relatedStone: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        id: { type: 'integer' },
        wcfRegistrationNumber: { type: 'string' },
      },
      required: ['id', 'wcfRegistrationNumber'],
    },
    notes: { type: ['string', 'null'] },
    groupSize: { type: 'integer' },
    dateRange: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: ['string', 'null'] },
        max: { type: ['string', 'null'] },
      },
      required: ['min', 'max'],
    },
    canUndo: { type: 'boolean' },
  },
  required: [
    'id',
    'sheet',
    'color',
    'rockNumber',
    'side',
    'effectiveDate',
    'changeType',
    'relatedStone',
    'notes',
    'groupSize',
    'dateRange',
    'canUndo',
  ],
} as const;

export const curlingStonePlacementUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    effectiveDate: dateOnlySchema,
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  required: ['effectiveDate'],
} as const;

export const curlingStonePlacementChangeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    affected: { type: 'integer' },
  },
  required: ['affected'],
} as const;

export const curlingStoneMaintenanceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer' },
    stoneId: { type: 'integer' },
    activityType: activityTypeSchema,
    side: sideSchema,
    performedOn: { type: 'string' },
    passes: { type: ['integer', 'null'] },
    rotations: { type: ['integer', 'null'] },
    sandpaperGrit: { type: ['integer', 'null'] },
    sandpaperCondition: sandpaperConditionSchema,
    bandWidthsMm: {
      type: 'array',
      items: { type: ['number', 'null'] },
    },
    comments: { type: ['string', 'null'] },
  },
  required: [
    'id',
    'stoneId',
    'activityType',
    'side',
    'performedOn',
    'passes',
    'rotations',
    'sandpaperGrit',
    'sandpaperCondition',
    'bandWidthsMm',
    'comments',
  ],
} as const;

export const curlingStoneListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stones: { type: 'array', items: curlingStoneSummarySchema },
  },
  required: ['stones'],
} as const;

export const curlingStoneDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stone: curlingStoneSummarySchema,
    placements: { type: 'array', items: curlingStonePlacementSchema },
    maintenance: { type: 'array', items: curlingStoneMaintenanceSchema },
  },
  required: ['stone', 'placements', 'maintenance'],
} as const;

const activityPositionSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: { sheet: sheetSchema, color: colorSchema, rockNumber: rockNumberSchema },
  required: ['sheet', 'color', 'rockNumber'],
} as const;

export const curlingStoneActivityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    since: { type: 'string' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          date: { type: 'string' },
          kind: { type: 'string', enum: ['added', 'moved', 'swapped', 'rotated', 'flipped', 'maintenance'] },
          activityType: { type: ['string', 'null'], enum: ['texturing', 'band_narrowing', 'imprinting', null] },
          passes: { type: ['integer', 'null'] },
          rotations: { type: ['integer', 'null'] },
          sandpaperGrit: { type: ['integer', 'null'] },
          sandpaperCondition: sandpaperConditionSchema,
          bandWidthsMm: { type: 'array', items: { type: ['number', 'null'] } },
          notes: { type: ['string', 'null'] },
          stones: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer' },
                wcfRegistrationNumber: { type: 'string' },
                side: sideSchema,
                from: activityPositionSchema,
                to: activityPositionSchema,
              },
              required: ['id', 'wcfRegistrationNumber', 'side', 'from', 'to'],
            },
          },
        },
        required: [
          'id',
          'date',
          'kind',
          'activityType',
          'passes',
          'rotations',
          'sandpaperGrit',
          'sandpaperCondition',
          'bandWidthsMm',
          'notes',
          'stones',
        ],
      },
    },
  },
  required: ['since', 'entries'],
} as const;

const positionBodyProperties = {
  sheet: sheetSchema,
  color: colorSchema,
  rockNumber: rockNumberSchema,
} as const;

export const curlingStoneCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wcfRegistrationNumber: { type: 'string', minLength: 1, maxLength: 100 },
    alSerialNumber: { type: 'string', minLength: 1, maxLength: 100 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
    ...positionBodyProperties,
    side: sideSchema,
    effectiveDate: dateOnlySchema,
  },
  required: ['wcfRegistrationNumber', 'alSerialNumber', 'sheet', 'color', 'rockNumber', 'side', 'effectiveDate'],
} as const;

export const curlingStoneImportBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    effectiveDate: dateOnlySchema,
    side: sideSchema,
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          wcfRegistrationNumber: { type: 'string', minLength: 1, maxLength: 100 },
          alSerialNumber: { type: 'string', minLength: 1, maxLength: 100 },
          ...positionBodyProperties,
        },
        required: ['wcfRegistrationNumber', 'alSerialNumber', 'sheet', 'color', 'rockNumber'],
      },
    },
  },
  required: ['effectiveDate', 'side', 'rows'],
} as const;

export const curlingStoneImportResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    created: { type: 'integer' },
  },
  required: ['created'],
} as const;

export const curlingStoneUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wcfRegistrationNumber: { type: 'string', minLength: 1, maxLength: 100 },
    alSerialNumber: { type: 'string', minLength: 1, maxLength: 100 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  required: ['wcfRegistrationNumber', 'alSerialNumber', 'notes'],
} as const;

export const curlingStoneMoveBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...positionBodyProperties,
    effectiveDate: dateOnlySchema,
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  required: ['sheet', 'color', 'rockNumber', 'effectiveDate'],
} as const;

export const curlingStoneFlipBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    effectiveDate: dateOnlySchema,
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  required: ['effectiveDate'],
} as const;

export const curlingStoneRotateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    effectiveDate: dateOnlySchema,
  },
  required: ['effectiveDate'],
} as const;

export const curlingStoneRotateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moved: { type: 'integer' },
  },
  required: ['moved'],
} as const;

const maintenanceFieldProperties = {
  activityType: activityTypeSchema,
  performedOn: dateOnlySchema,
  passes: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
  rotations: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
  sandpaperGrit: { type: ['integer', 'null'], enum: [60, 80, 100, null] },
  sandpaperCondition: sandpaperConditionSchema,
  bandWidthsMm: {
    type: ['array', 'null'],
    minItems: 4,
    maxItems: 4,
    items: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  },
  comments: { type: ['string', 'null'], maxLength: 2000 },
} as const;

export const curlingStoneMaintenanceCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stoneIds: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: { type: 'integer', minimum: 1 },
    },
    side: { type: 'string', enum: ['A', 'B', 'current'] },
    ...maintenanceFieldProperties,
  },
  required: ['stoneIds', 'side', 'activityType', 'performedOn'],
} as const;

export const curlingStoneMaintenanceCreateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    created: { type: 'integer' },
  },
  required: ['created'],
} as const;

export const curlingStoneMaintenanceUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    side: sideSchema,
    ...maintenanceFieldProperties,
  },
  required: ['side', 'activityType', 'performedOn'],
} as const;
