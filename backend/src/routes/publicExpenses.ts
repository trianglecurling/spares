import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';
import {
  createExpenseReport,
  ExpenseReportError,
  getExpenseFormOptions,
  getExpenseReceiptFileByAccessToken,
  getExpenseReportByAccessToken,
  streamExpenseReceiptFile,
  updateExpenseReportRecord,
  type ExpenseDocumentFileUpload,
} from '../services/expenseReportService.js';
import type { ExpenseItemInput, ExpenseReportPayloadInput } from '../services/expenseReportValidation.js';

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;

const mailingAddressJsonSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    addressLine1: { type: 'string' },
    addressLine2: { type: 'string' },
    city: { type: 'string' },
    state: { type: 'string' },
    country: { type: 'string' },
    postalCode: { type: 'string' },
  },
} as const;

const mailingAddressSchema = z.object({
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  postalCode: z.string(),
});

const expenseDocumentSchema = z.object({
  id: z.number().int().positive().optional(),
  documentType: z.enum(['receipt', 'invoice', 'other_supporting_evidence']),
});

const expenseItemSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string(),
  expenseDate: z.string(),
  amountMinor: z.number().int(),
  currency: z.enum(['usd', 'cad', 'other']),
  currencyOther: z.string().nullable().optional(),
  includesDurableGood: z.boolean().optional(),
  noReceiptExplanation: z.string().nullable().optional(),
  documents: z.array(expenseDocumentSchema),
});

export const expensePayloadSchema = z.object({
  kind: z.enum(['expense', 'mileage']),
  submitterName: z.string(),
  submitterEmail: z.string(),
  submitterPhone: z.string().nullable().optional(),
  mailingAddress: mailingAddressSchema.nullable().optional(),
  comments: z.string().nullable().optional(),
  committeeId: z.number().int().positive().nullable().optional(),
  committeeCustom: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  requestedAmountMinor: z.number().int(),
  requestedCurrency: z.string().nullable().optional(),
  amountJustification: z.string().nullable().optional(),
  usedClubCreditCard: z.boolean().nullable().optional(),
  clubCreditCardOwnerName: z.string().nullable().optional(),
  clubCreditCardOwnerMemberId: z.number().int().positive().nullable().optional(),
  expenses: z.array(expenseItemSchema).optional(),
  removeExpenseIds: z.array(z.number().int().positive()).optional(),
  removeDocumentIds: z.array(z.number().int().positive()).optional(),
  activityDate: z.string().nullable().optional(),
  fromKind: z.enum(['home', 'other']).nullable().optional(),
  fromOther: z.string().nullable().optional(),
  toKind: z.enum(['club', 'other']).nullable().optional(),
  toOther: z.string().nullable().optional(),
  roundTripMiles: z.number().nullable().optional(),
  tripPurpose: z.string().nullable().optional(),
  tripPurposeOther: z.string().nullable().optional(),
});

export type ParsedExpenseWrite = {
  payload: ExpenseReportPayloadInput;
  files: ExpenseDocumentFileUpload[];
  removeExpenseIds: number[];
  removeDocumentIds: number[];
};

export function toServicePayload(
  body: z.infer<typeof expensePayloadSchema>,
  filesByIndex: Map<string, ExpenseDocumentFileUpload>,
  options: { askClubCreditCard: boolean }
): ExpenseReportPayloadInput {
  const expenses: ExpenseItemInput[] = (body.expenses ?? []).map((expense, expenseIndex) => ({
    id: expense.id,
    name: expense.name,
    expenseDate: expense.expenseDate,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    currencyOther: expense.currencyOther,
    includesDurableGood: expense.includesDurableGood === true,
    noReceiptExplanation: expense.noReceiptExplanation,
    documents: expense.documents.map((document, documentIndex) => ({
      id: document.id,
      documentType: document.documentType,
      hasFile: filesByIndex.has(`${expenseIndex}:${documentIndex}`) || Boolean(document.id),
    })),
  }));
  return {
    kind: body.kind,
    submitterName: body.submitterName,
    submitterEmail: body.submitterEmail,
    submitterPhone: body.submitterPhone,
    mailingAddress: body.mailingAddress,
    comments: body.comments,
    committeeId: body.committeeId,
    committeeCustom: body.committeeCustom,
    purpose: body.purpose,
    requestedAmountMinor: body.requestedAmountMinor,
    requestedCurrency: body.requestedCurrency,
    amountJustification: body.amountJustification,
    usedClubCreditCard: body.usedClubCreditCard,
    clubCreditCardOwnerName: body.clubCreditCardOwnerName,
    clubCreditCardOwnerMemberId: body.clubCreditCardOwnerMemberId,
    askClubCreditCard: options.askClubCreditCard,
    expenses,
    activityDate: body.activityDate,
    fromKind: body.fromKind,
    fromOther: body.fromOther,
    toKind: body.toKind,
    toOther: body.toOther,
    roundTripMiles: body.roundTripMiles,
    tripPurpose: body.tripPurpose,
    tripPurposeOther: body.tripPurposeOther,
  };
}

export async function parseExpenseWriteRequest(request: FastifyRequest): Promise<ParsedExpenseWrite> {
  const files: ExpenseDocumentFileUpload[] = [];
  let rawPayload = '';

  if (request.isMultipart()) {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'payload') {
          rawPayload = String(part.value ?? '');
        }
        continue;
      }
      const match = /^expenseFile_(\d+)_(\d+)$/.exec(part.fieldname);
      if (!match) continue;
      const expenseIndex = Number.parseInt(match[1], 10);
      const documentIndex = Number.parseInt(match[2], 10);
      const buffer = await part.toBuffer();
      files.push({
        expenseIndex,
        documentIndex,
        originalFilename: part.filename || 'expense-document.bin',
        mimeType: part.mimetype,
        buffer,
      });
    }
  } else {
    rawPayload = JSON.stringify(request.body ?? {});
  }

  let parsedJson: unknown;
  try {
    parsedJson = rawPayload ? JSON.parse(rawPayload) : request.body;
  } catch {
    throw new ExpenseReportError('Invalid expense report payload.', 400);
  }
  const body = expensePayloadSchema.parse(parsedJson);
  const filesByIndex = new Map(files.map((file) => [`${file.expenseIndex}:${file.documentIndex}`, file]));
  return {
    payload: toServicePayload(body, filesByIndex, { askClubCreditCard: false }),
    files,
    removeExpenseIds: body.removeExpenseIds ?? [],
    removeDocumentIds: body.removeDocumentIds ?? [],
  };
}

export function handleExpenseError(reply: FastifyReply, err: unknown) {
  if (err instanceof ExpenseReportError) {
    return sendApiError(reply, err.statusCode, err.message, err.details);
  }
  if (err instanceof z.ZodError) {
    return sendApiError(reply, 400, 'Invalid expense report payload.', err.flatten());
  }
  throw err;
}

const expenseDocumentViewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    documentType: { type: 'string', enum: ['receipt', 'invoice', 'other_supporting_evidence'] },
    originalFilename: { type: 'string' },
    mimeType: { type: 'string' },
    byteSize: { type: 'number' },
    sortOrder: { type: 'number' },
  },
} as const;

const expenseItemViewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    expenseDate: { type: 'string' },
    amountMinor: { type: 'number' },
    currency: { type: 'string' },
    currencyOther: { type: ['string', 'null'] },
    includesDurableGood: { type: 'boolean' },
    noReceiptExplanation: { type: ['string', 'null'] },
    sortOrder: { type: 'number' },
    documents: { type: 'array', items: expenseDocumentViewSchema },
  },
} as const;

export const expenseReportViewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    kind: { type: 'string' },
    status: { type: 'string' },
    statusLabel: { type: 'string' },
    memberId: { type: ['number', 'null'] },
    submitterName: { type: 'string' },
    submitterEmail: { type: 'string' },
    submitterPhone: { type: ['string', 'null'] },
    mailingAddress: mailingAddressJsonSchema,
    committeeId: { type: ['number', 'null'] },
    committeeName: { type: ['string', 'null'] },
    committeeCustom: { type: ['string', 'null'] },
    purpose: { type: ['string', 'null'] },
    requestedAmountMinor: { type: 'number' },
    requestedCurrency: { type: 'string' },
    amountJustification: { type: ['string', 'null'] },
    usedClubCreditCard: { type: ['boolean', 'null'] },
    clubCreditCardOwnerMemberId: { type: ['number', 'null'] },
    clubCreditCardOwnerName: { type: ['string', 'null'] },
    comments: { type: ['string', 'null'] },
    activityDate: { type: ['string', 'null'] },
    fromKind: { type: ['string', 'null'] },
    fromOther: { type: ['string', 'null'] },
    toKind: { type: ['string', 'null'] },
    toOther: { type: ['string', 'null'] },
    roundTripMiles: { type: ['number', 'null'] },
    tripPurpose: { type: ['string', 'null'] },
    tripPurposeOther: { type: ['string', 'null'] },
    expenses: { type: 'array', items: expenseItemViewSchema },
    submittedAt: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    canEdit: { type: 'boolean' },
    statusChangedByName: { type: ['string', 'null'] },
    statusChangedAt: { type: ['string', 'null'] },
    lastUpdatedByName: { type: ['string', 'null'] },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number' },
          authorName: { type: 'string' },
          body: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['id', 'authorName', 'body', 'createdAt'],
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'number' },
          actorName: { type: 'string' },
          kind: { type: 'string', enum: ['fields', 'status'] },
          summary: { type: 'string' },
          details: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
              },
              required: ['field', 'from', 'to'],
            },
          },
          createdAt: { type: 'string' },
        },
        required: ['id', 'actorName', 'kind', 'summary', 'createdAt'],
      },
    },
    manageUrl: { type: 'string' },
    accessToken: { type: 'string' },
  },
} as const;

export const expenseListItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    kind: { type: 'string' },
    status: { type: 'string' },
    statusLabel: { type: 'string' },
    submitterName: { type: 'string' },
    submitterEmail: { type: 'string' },
    requestedAmountMinor: { type: 'number' },
    requestedCurrency: { type: 'string' },
    submittedAt: { type: 'string' },
  },
  required: [
    'id',
    'kind',
    'status',
    'statusLabel',
    'submitterName',
    'submitterEmail',
    'requestedAmountMinor',
    'requestedCurrency',
    'submittedAt',
  ],
} as const;

export async function publicExpenseRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/public/expenses/form-options',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['expenses'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: {
              committees: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'number' }, name: { type: 'string' } },
                },
              },
              clubName: { type: 'string' },
              mileageRateCentsPerMile: { type: 'number' },
              isClubCreditCardHolder: { type: 'boolean' },
              submitterPrefill: {
                type: ['object', 'null'],
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  email: { type: ['string', 'null'] },
                  phone: { type: ['string', 'null'] },
                  mailingAddress: mailingAddressJsonSchema,
                },
              },
            },
          },
          400: apiErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return getExpenseFormOptions(request.member?.id ?? null);
    }
  );

  fastify.post(
    '/public/expenses',
    {
      preHandler: optionalAuthMiddleware,
      config: { rateLimit: abuseRouteRateLimits.expenseSubmit },
      schema: {
        tags: ['expenses'],
        response: {
          200: expenseReportViewSchema,
          400: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const parsed = await parseExpenseWriteRequest(request);
        return await createExpenseReport({
          payload: parsed.payload,
          files: parsed.files,
          memberId: request.member?.id ?? null,
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { accessToken: string } }>(
    '/public/expenses/manage/:accessToken',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { accessToken: { type: 'string' } },
          required: ['accessToken'],
        },
        response: {
          200: expenseReportViewSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await getExpenseReportByAccessToken(request.params.accessToken);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { accessToken: string } }>(
    '/public/expenses/manage/:accessToken',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { accessToken: { type: 'string' } },
          required: ['accessToken'],
        },
        response: {
          200: expenseReportViewSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const existing = await getExpenseReportByAccessToken(request.params.accessToken);
        const parsed = await parseExpenseWriteRequest(request);
        return await updateExpenseReportRecord({
          reportId: existing.id,
          payload: parsed.payload,
          files: parsed.files,
          removeExpenseIds: parsed.removeExpenseIds,
          removeDocumentIds: parsed.removeDocumentIds,
          memberId: existing.memberId,
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { accessToken: string; receiptId: string } }>(
    '/public/expenses/manage/:accessToken/receipts/:receiptId',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            accessToken: { type: 'string' },
            receiptId: { type: 'string' },
          },
          required: ['accessToken', 'receiptId'],
        },
      },
    },
    async (request, reply) => {
      try {
        const receiptId = Number.parseInt(request.params.receiptId, 10);
        if (!Number.isFinite(receiptId)) {
          return sendApiError(reply, 400, 'Invalid receipt id.');
        }
        const file = await getExpenseReceiptFileByAccessToken(request.params.accessToken, receiptId);
        return streamExpenseReceiptFile(file, reply);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );
}
