import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import type { Member } from '../types.js';
import { hasScope } from '../utils/rbac.js';
import {
  addExpenseReportNote,
  createExpenseReport,
  deleteExpenseReportForAdmin,
  downloadExpenseDocumentsForAdmin,
  exportExpenseReportsForAdmin,
  getExpenseAdminSummary,
  getExpenseReceiptFileForAdmin,
  getExpenseReceiptFileForMember,
  getExpenseReportForAdmin,
  getExpenseReportForMember,
  listExpenseReportsForAdmin,
  listExpenseReportsForMember,
  streamExpenseReceiptFile,
  updateExpenseReportAdmin,
  updateExpenseReportRecord,
  updateExpenseReportStatusesForAdmin,
  ExpenseReportError,
} from '../services/expenseReportService.js';
import {
  EXPENSE_REPORT_STATUSES,
} from '../services/expenseReportConstants.js';
import { EXPENSE_DATE_RANGES } from '../services/expenseReportDateRange.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';
import {
  expenseListItemSchema,
  expenseReportViewSchema,
  handleExpenseError,
  parseExpenseWriteRequest,
} from './publicExpenses.js';

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;

const listResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: expenseListItemSchema },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['items', 'page', 'pageSize', 'total'],
} as const;

const summaryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unprocessedCount: { type: 'number' },
    awaitingReimbursementCount: { type: 'number' },
    monthToDateAmountMinor: { type: 'number' },
  },
  required: ['unprocessedCount', 'awaitingReimbursementCount', 'monthToDateAmountMinor'],
} as const;

function requireMember(request: FastifyRequest, reply: FastifyReply): Member | null {
  const member = request.member;
  if (!member) {
    sendApiError(reply, 401, 'Unauthorized');
    return null;
  }
  return member;
}

function requireExpensesRead(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member || !hasScope(member.authz, 'expenses.read')) {
    sendApiError(reply, 403, 'Forbidden');
    return false;
  }
  return true;
}

function requireExpensesManage(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member || !hasScope(member.authz, 'expenses.manage')) {
    sendApiError(reply, 403, 'Forbidden');
    return false;
  }
  return true;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const receiptParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  receiptId: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(EXPENSE_REPORT_STATUSES).optional().or(z.literal('')),
  search: z.string().optional(),
});

const adminFilterQuerySchema = z.object({
  status: z.enum(EXPENSE_REPORT_STATUSES).optional().or(z.literal('')),
  search: z.string().optional(),
  range: z.enum(EXPENSE_DATE_RANGES).optional().or(z.literal('')),
  from: z.string().optional(),
  to: z.string().optional(),
});

const adminListQuerySchema = adminFilterQuerySchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const adminFilterQuerystringProperties = {
  status: { type: 'string' },
  search: { type: 'string' },
  range: { type: 'string', enum: ['', ...EXPENSE_DATE_RANGES] },
  from: { type: 'string' },
  to: { type: 'string' },
} as const;

const adminSelectionQuerystringProperties = {
  ...adminFilterQuerystringProperties,
  ids: {
    type: 'string',
    description: 'Comma-separated expense report ids. When present, the other filters are ignored.',
  },
} as const;

const MAX_SELECTED_EXPENSE_REPORTS = 500;

const adminSelectionQuerySchema = adminFilterQuerySchema.extend({
  ids: z.string().max(12_000).optional(),
});

function selectedReportIdsFromQuery(value: string | undefined): number[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length > MAX_SELECTED_EXPENSE_REPORTS) {
    throw new ExpenseReportError('Select 500 expense reports or fewer.', 400);
  }
  const ids = new Set<number>();
  for (const part of parts) {
    if (!/^[1-9]\d*$/.test(part)) {
      throw new ExpenseReportError('Expense report ids must be positive integers.', 400);
    }
    const id = Number(part);
    if (!Number.isSafeInteger(id)) {
      throw new ExpenseReportError('Expense report ids must be positive integers.', 400);
    }
    ids.add(id);
  }
  return [...ids];
}

const bulkStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_SELECTED_EXPENSE_REPORTS),
  status: z.enum(EXPENSE_REPORT_STATUSES),
});

const bulkStatusResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    updatedCount: { type: 'number' },
    unchangedCount: { type: 'number' },
  },
  required: ['updatedCount', 'unchangedCount'],
} as const;

function adminFiltersFromQuery(query: z.infer<typeof adminFilterQuerySchema>) {
  return {
    status: query.status || undefined,
    search: query.search,
    range: query.range || undefined,
    from: query.from,
    to: query.to,
  };
}

function adminSelectionFromQuery(query: z.infer<typeof adminSelectionQuerySchema>) {
  return {
    ...adminFiltersFromQuery(query),
    ids: selectedReportIdsFromQuery(query.ids),
  };
}

const adminPatchSchema = z.object({
  status: z.enum(EXPENSE_REPORT_STATUSES).optional(),
});

const adminNoteSchema = z.object({
  body: z.string(),
});

function staffActorFromMember(member: Member): { id: number; name: string } {
  return { id: member.id, name: member.name };
}

export async function protectedExpenseRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/expenses',
    {
      schema: {
        tags: ['expenses'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'number' },
            pageSize: { type: 'number' },
          },
        },
        response: { 200: listResponseSchema, 401: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const member = requireMember(request, reply);
      if (!member) return;
      const query = listQuerySchema.parse(request.query);
      return listExpenseReportsForMember(member, query);
    }
  );

  fastify.post(
    '/expenses',
    {
      config: { rateLimit: abuseRouteRateLimits.expenseSubmit },
      schema: {
        tags: ['expenses'],
        response: {
          200: expenseReportViewSchema,
          400: apiErrorResponseSchema,
          401: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = requireMember(request, reply);
      if (!member) return;
      try {
        const parsed = await parseExpenseWriteRequest(request);
        return await createExpenseReport({
          payload: parsed.payload,
          files: parsed.files,
          memberId: member.id,
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/expenses/:id',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: expenseReportViewSchema,
          401: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = requireMember(request, reply);
      if (!member) return;
      try {
        const params = idParamSchema.parse(request.params);
        return await getExpenseReportForMember(params.id, member);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/expenses/:id',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: expenseReportViewSchema,
          400: apiErrorResponseSchema,
          401: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = requireMember(request, reply);
      if (!member) return;
      try {
        const params = idParamSchema.parse(request.params);
        await getExpenseReportForMember(params.id, member);
        const parsed = await parseExpenseWriteRequest(request);
        return await updateExpenseReportRecord({
          reportId: params.id,
          payload: parsed.payload,
          files: parsed.files,
          removeExpenseIds: parsed.removeExpenseIds,
          removeDocumentIds: parsed.removeDocumentIds,
          memberId: member.id,
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { id: string; receiptId: string } }>(
    '/expenses/:id/receipts/:receiptId',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, receiptId: { type: 'string' } },
          required: ['id', 'receiptId'],
        },
      },
    },
    async (request, reply) => {
      const member = requireMember(request, reply);
      if (!member) return;
      try {
        const params = receiptParamsSchema.parse(request.params);
        const file = await getExpenseReceiptFileForMember(params.id, params.receiptId, member);
        return streamExpenseReceiptFile(file, reply);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get(
    '/admin/expenses',
    {
      schema: {
        tags: ['expenses'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'number' },
            pageSize: { type: 'number' },
            ...adminFilterQuerystringProperties,
          },
        },
        response: {
          200: listResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      try {
        const query = adminListQuerySchema.parse(request.query);
        return await listExpenseReportsForAdmin({
          page: query.page,
          pageSize: query.pageSize,
          ...adminFiltersFromQuery(query),
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get(
    '/admin/expenses/export',
    {
      schema: {
        tags: ['expenses'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: adminSelectionQuerystringProperties,
        },
        response: {
          200: { type: 'string', description: 'CSV of expense reports matching the filters or selection' },
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      try {
        const query = adminSelectionQuerySchema.parse(request.query);
        const result = await exportExpenseReportsForAdmin(adminSelectionFromQuery(query));
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .header('Cache-Control', 'private, no-store')
          .send(result.csv);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get(
    '/admin/expenses/documents',
    {
      schema: {
        tags: ['expenses'],
        description: 'ZIP of receipts and other documents for the filtered or selected expense reports',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: adminSelectionQuerystringProperties,
        },
        response: {
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      try {
        const query = adminSelectionQuerySchema.parse(request.query);
        const result = await downloadExpenseDocumentsForAdmin(adminSelectionFromQuery(query));
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Length', String(result.zip.length))
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .header('Cache-Control', 'private, no-store')
          .send(result.zip);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.post(
    '/admin/expenses/status',
    {
      schema: {
        tags: ['expenses'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids', 'status'],
          properties: {
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_SELECTED_EXPENSE_REPORTS,
              items: { type: 'number' },
            },
            status: { type: 'string', enum: [...EXPENSE_REPORT_STATUSES] },
          },
        },
        response: {
          200: bulkStatusResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesManage(request, reply)) return;
      const member = request.member;
      if (!member) {
        sendApiError(reply, 401, 'Unauthorized');
        return;
      }
      const parsed = bulkStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(reply, 400, 'Choose a status and at least one expense report.');
        return;
      }
      try {
        return await updateExpenseReportStatusesForAdmin(
          parsed.data.ids,
          parsed.data.status,
          staffActorFromMember(member)
        );
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get(
    '/admin/expenses/summary',
    {
      schema: {
        tags: ['expenses'],
        response: { 200: summaryResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      return getExpenseAdminSummary();
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/admin/expenses/:id',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: expenseReportViewSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      try {
        const params = idParamSchema.parse(request.params);
        return await getExpenseReportForAdmin(params.id);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/admin/expenses/:id',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: [...EXPENSE_REPORT_STATUSES] },
          },
        },
        response: {
          200: expenseReportViewSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesManage(request, reply)) return;
      const member = request.member;
      if (!member) {
        sendApiError(reply, 401, 'Unauthorized');
        return;
      }
      try {
        const params = idParamSchema.parse(request.params);
        const body = adminPatchSchema.parse(request.body);
        return await updateExpenseReportAdmin(params.id, body, staffActorFromMember(member));
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/admin/expenses/:id',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          204: { type: 'null' },
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesManage(request, reply)) return;
      try {
        const params = idParamSchema.parse(request.params);
        await deleteExpenseReportForAdmin(params.id);
        return reply.code(204).send();
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/admin/expenses/:id/report',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
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
      if (!requireExpensesManage(request, reply)) return;
      const member = request.member;
      if (!member) {
        sendApiError(reply, 401, 'Unauthorized');
        return;
      }
      try {
        const params = idParamSchema.parse(request.params);
        const parsed = await parseExpenseWriteRequest(request);
        return await updateExpenseReportRecord({
          reportId: params.id,
          payload: parsed.payload,
          files: parsed.files,
          removeExpenseIds: parsed.removeExpenseIds,
          removeDocumentIds: parsed.removeDocumentIds,
          memberId: null,
          skipEditableCheck: true,
          staffActor: staffActorFromMember(member),
        });
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/admin/expenses/:id/notes',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            body: { type: 'string' },
          },
          required: ['body'],
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
      if (!requireExpensesManage(request, reply)) return;
      const member = request.member;
      if (!member) {
        sendApiError(reply, 401, 'Unauthorized');
        return;
      }
      try {
        const params = idParamSchema.parse(request.params);
        const body = adminNoteSchema.parse(request.body);
        return await addExpenseReportNote(params.id, body.body, staffActorFromMember(member));
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { id: string; receiptId: string } }>(
    '/admin/expenses/:id/receipts/:receiptId',
    {
      schema: {
        tags: ['expenses'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, receiptId: { type: 'string' } },
          required: ['id', 'receiptId'],
        },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      try {
        const params = receiptParamsSchema.parse(request.params);
        const file = await getExpenseReceiptFileForAdmin(params.id, params.receiptId);
        return streamExpenseReceiptFile(file, reply);
      } catch (err) {
        return handleExpenseError(reply, err);
      }
    }
  );
}
