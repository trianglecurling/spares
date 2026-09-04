import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import type { Member } from '../types.js';
import { hasScope } from '../utils/rbac.js';
import {
  addExpenseReportNote,
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
} from '../services/expenseReportService.js';
import {
  EXPENSE_REPORT_STATUSES,
} from '../services/expenseReportConstants.js';
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
            status: { type: 'string' },
            search: { type: 'string' },
          },
        },
        response: { 200: listResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      if (!requireExpensesRead(request, reply)) return;
      const query = listQuerySchema.parse(request.query);
      return listExpenseReportsForAdmin({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status || undefined,
        search: query.search,
      });
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
