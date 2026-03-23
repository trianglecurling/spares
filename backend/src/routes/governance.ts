import { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { governanceSummaryResponseSchema, successResponseSchema } from '../api/schemas.js';
import {
  ApiErrorResponse,
  GovernanceCreateBoardMemberBody,
  GovernanceCreateCommitteeBody,
  GovernanceCreateCommitteeChairBody,
  GovernanceOfficerPosition,
  GovernanceSummaryResponse,
  GovernanceUpdateBoardMemberBody,
  GovernanceUpdateCommitteeBody,
  GovernanceUpdateCommitteeChairBody,
  GovernanceUpsertOfficerBody,
  GovernanceUpsertSettingsBody,
} from '../api/types.js';
import { isAdmin } from '../utils/auth.js';
import { Member } from '../types.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const mmddRegex = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const officerPositions: GovernanceOfficerPosition[] = ['president', 'vice_president', 'treasurer', 'secretary'];

const governanceSettingsSchema = z.object({
  fiscalYearStartMmdd: z.string().regex(mmddRegex),
  boardTurnoverMmdd: z.string().regex(mmddRegex),
});

const boardMemberCreateSchema = z.object({
  memberId: z.number().int().positive(),
  publicEmail: z.string().email().nullable().optional(),
  firstFiscalYear: z.number().int().min(1900).max(3000),
  lastFiscalYear: z.number().int().min(1900).max(3000),
  manualInactive: z.boolean().optional(),
  committeeIds: z.array(z.number().int().positive()).optional(),
});

const boardMemberUpdateSchema = z.object({
  publicEmail: z.string().email().nullable().optional(),
  firstFiscalYear: z.number().int().min(1900).max(3000).optional(),
  lastFiscalYear: z.number().int().min(1900).max(3000).optional(),
  manualInactive: z.boolean().optional(),
  committeeIds: z.array(z.number().int().positive()).optional(),
});

const committeeCreateSchema = z.object({
  name: z.string().min(1),
  boardLiaisonBoardMemberId: z.number().int().positive().nullable().optional(),
  contactInfo: z.string().nullable().optional(),
  responsibilities: z.string().nullable().optional(),
});

const committeeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  boardLiaisonBoardMemberId: z.number().int().positive().nullable().optional(),
  contactInfo: z.string().nullable().optional(),
  responsibilities: z.string().nullable().optional(),
});

const committeeChairCreateSchema = z.object({
  memberId: z.number().int().positive(),
  publicEmail: z.string().email().nullable().optional(),
});

const committeeChairUpdateSchema = z.object({
  publicEmail: z.string().email().nullable().optional(),
});

const officerAssignSchema = z.object({
  boardMemberId: z.number().int().positive(),
});

const boardMemberParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

const committeeParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

const chairParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
  chairId: z.string().regex(/^\d+$/),
});

const officerParamsSchema = z.object({
  position: z.enum(['president', 'vice_president', 'treasurer', 'secretary']),
});

function parseId(value: string): number {
  return Number.parseInt(value, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

function currentFiscalYear(today: string, fiscalYearStartMmdd: string): number {
  const year = Number.parseInt(today.slice(0, 4), 10);
  const mmdd = today.slice(5, 10);
  return mmdd >= fiscalYearStartMmdd ? year + 1 : year;
}

function currentBoardYear(today: string, fiscalYearStartMmdd: string, boardTurnoverMmdd: string): number {
  const fiscalYear = currentFiscalYear(today, fiscalYearStartMmdd);
  const mmdd = today.slice(5, 10);
  if (mmdd < fiscalYearStartMmdd && mmdd >= boardTurnoverMmdd) {
    return fiscalYear + 1;
  }
  return fiscalYear;
}

function deriveActive(firstFiscalYear: number, lastFiscalYear: number, boardYear: number): boolean {
  return firstFiscalYear <= boardYear && lastFiscalYear >= boardYear;
}

async function setBoardMemberCommitteeAssignments(
  tx: ReturnType<typeof getDrizzleDb>['db'],
  schema: ReturnType<typeof getDrizzleDb>['schema'],
  boardMemberId: number,
  committeeIds: number[]
): Promise<void> {
  const currentRows = await tx
    .select({ committee_id: schema.governanceBoardMemberCommittees.committee_id })
    .from(schema.governanceBoardMemberCommittees)
    .where(eq(schema.governanceBoardMemberCommittees.board_member_id, boardMemberId));
  const currentIds = new Set(currentRows.map((row) => row.committee_id));
  const nextIds = new Set(committeeIds);

  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  const toAdd = [...nextIds].filter((id) => !currentIds.has(id));

  if (toRemove.length > 0) {
    await tx
      .delete(schema.governanceBoardMemberCommittees)
      .where(
        and(
          eq(schema.governanceBoardMemberCommittees.board_member_id, boardMemberId),
          inArray(schema.governanceBoardMemberCommittees.committee_id, toRemove)
        )
      );
    await tx
      .update(schema.governanceCommittees)
      .set({ board_liaison_board_member_id: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(schema.governanceCommittees.board_liaison_board_member_id, boardMemberId),
          inArray(schema.governanceCommittees.id, toRemove)
        )
      );
  }

  for (const committeeId of toAdd) {
    await tx
      .insert(schema.governanceBoardMemberCommittees)
      .values({ board_member_id: boardMemberId, committee_id: committeeId })
      .onConflictDoNothing();
    await tx
      .update(schema.governanceCommittees)
      .set({ board_liaison_board_member_id: boardMemberId, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.governanceCommittees.id, committeeId));
  }
}

async function buildGovernanceSummary(): Promise<GovernanceSummaryResponse> {
  const { db, schema } = getDrizzleDb();

  const [settingsRow] = await db
    .select()
    .from(schema.governanceSettings)
    .where(eq(schema.governanceSettings.id, 1))
    .limit(1);

  const settings = settingsRow ?? {
    id: 1,
    fiscal_year_start_mmdd: '09-01',
    board_turnover_mmdd: '09-01',
  };

  const boardRows = await db
    .select({
      id: schema.governanceBoardMembers.id,
      memberId: schema.governanceBoardMembers.member_id,
      publicEmail: schema.governanceBoardMembers.public_email,
      firstFiscalYear: schema.governanceBoardMembers.first_fiscal_year,
      lastFiscalYear: schema.governanceBoardMembers.last_fiscal_year,
      manualInactive: schema.governanceBoardMembers.manual_inactive,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
    })
    .from(schema.governanceBoardMembers)
    .innerJoin(schema.members, eq(schema.governanceBoardMembers.member_id, schema.members.id))
    .orderBy(asc(schema.members.name));

  const committeeLinks = await db
    .select({
      boardMemberId: schema.governanceBoardMemberCommittees.board_member_id,
      committeeId: schema.governanceBoardMemberCommittees.committee_id,
    })
    .from(schema.governanceBoardMemberCommittees);
  const committeeIdsByBoardMember = new Map<number, number[]>();
  for (const link of committeeLinks) {
    const existing = committeeIdsByBoardMember.get(link.boardMemberId) ?? [];
    existing.push(link.committeeId);
    committeeIdsByBoardMember.set(link.boardMemberId, existing);
  }

  const officers = await db
    .select({
      position: schema.governanceOfficers.position,
      boardMemberId: schema.governanceOfficers.board_member_id,
    })
    .from(schema.governanceOfficers);

  const committees = await db
    .select({
      id: schema.governanceCommittees.id,
      name: schema.governanceCommittees.name,
      boardLiaisonBoardMemberId: schema.governanceCommittees.board_liaison_board_member_id,
      contactInfo: schema.governanceCommittees.contact_info,
      responsibilities: schema.governanceCommittees.responsibilities,
    })
    .from(schema.governanceCommittees)
    .orderBy(asc(schema.governanceCommittees.sort_order), asc(schema.governanceCommittees.name));

  const chairs = await db
    .select({
      id: schema.governanceCommitteeChairs.id,
      committeeId: schema.governanceCommitteeChairs.committee_id,
      memberId: schema.governanceCommitteeChairs.member_id,
      publicEmail: schema.governanceCommitteeChairs.public_email,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
    })
    .from(schema.governanceCommitteeChairs)
    .innerJoin(schema.members, eq(schema.governanceCommitteeChairs.member_id, schema.members.id));

  const chairsByCommitteeId = new Map<number, GovernanceSummaryResponse['committees'][number]['chairs']>();
  for (const row of chairs) {
    const bucket = chairsByCommitteeId.get(row.committeeId) ?? [];
    bucket.push({
      id: row.id,
      memberId: row.memberId,
      memberName: row.memberName,
      memberEmail: row.memberEmail,
      publicEmail: row.publicEmail,
      effectivePublicEmail: row.publicEmail ?? row.memberEmail,
    });
    chairsByCommitteeId.set(row.committeeId, bucket);
  }

  const today = todayIsoDate();
  const fiscalYear = currentFiscalYear(today, settings.fiscal_year_start_mmdd);
  const boardYear = currentBoardYear(today, settings.fiscal_year_start_mmdd, settings.board_turnover_mmdd);

  return {
    today,
    currentFiscalYear: fiscalYear,
    currentBoardYear: boardYear,
    settings: {
      fiscalYearStartMmdd: settings.fiscal_year_start_mmdd,
      boardTurnoverMmdd: settings.board_turnover_mmdd,
    },
    boardMembers: boardRows.map((row) => {
      const derived = deriveActive(row.firstFiscalYear, row.lastFiscalYear, boardYear);
      const manualInactive = (row.manualInactive ?? 0) === 1;
      return {
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
        memberEmail: row.memberEmail,
        publicEmail: row.publicEmail,
        effectivePublicEmail: row.publicEmail ?? row.memberEmail,
        firstFiscalYear: row.firstFiscalYear,
        lastFiscalYear: row.lastFiscalYear,
        manualInactive,
        derivedActive: derived,
        isActive: !manualInactive && derived,
        committeeIds: committeeIdsByBoardMember.get(row.id) ?? [],
      };
    }),
    officers: officers.map((row) => ({
      position: row.position as GovernanceOfficerPosition,
      boardMemberId: row.boardMemberId,
    })),
    committees: committees.map((committee) => ({
      id: committee.id,
      name: committee.name,
      boardLiaisonBoardMemberId: committee.boardLiaisonBoardMemberId,
      contactInfo: committee.contactInfo,
      responsibilities: committee.responsibilities,
      chairs: chairsByCommitteeId.get(committee.id) ?? [],
    })),
  };
}

export async function governanceRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async () => buildGovernanceSummary()
  );

  fastify.put<{ Body: GovernanceUpsertSettingsBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/settings',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const body = governanceSettingsSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      await db
        .insert(schema.governanceSettings)
        .values({
          id: 1,
          fiscal_year_start_mmdd: body.fiscalYearStartMmdd,
          board_turnover_mmdd: body.boardTurnoverMmdd,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .onConflictDoUpdate({
          target: schema.governanceSettings.id,
          set: {
            fiscal_year_start_mmdd: body.fiscalYearStartMmdd,
            board_turnover_mmdd: body.boardTurnoverMmdd,
            updated_at: sql`CURRENT_TIMESTAMP`,
          },
        });
      return buildGovernanceSummary();
    }
  );

  fastify.post<{ Body: GovernanceCreateBoardMemberBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/board-members',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const body = boardMemberCreateSchema.parse(request.body);
      if (body.firstFiscalYear > body.lastFiscalYear) {
        return reply.code(400).send({ error: 'firstFiscalYear cannot be greater than lastFiscalYear' });
      }
      const { db, schema } = getDrizzleDb();
      const [existing] = await db
        .select({ id: schema.governanceBoardMembers.id })
        .from(schema.governanceBoardMembers)
        .where(eq(schema.governanceBoardMembers.member_id, body.memberId))
        .limit(1);
      if (existing) return reply.code(409).send({ error: 'Board member already exists for this member' });

      const createdId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.governanceBoardMembers)
          .values({
            member_id: body.memberId,
            public_email: body.publicEmail ?? null,
            first_fiscal_year: body.firstFiscalYear,
            last_fiscal_year: body.lastFiscalYear,
            manual_inactive: body.manualInactive ? 1 : 0,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .returning({ id: schema.governanceBoardMembers.id });
        const boardMemberId = inserted[0].id;
        if (body.committeeIds) {
          await setBoardMemberCommitteeAssignments(tx, schema, boardMemberId, body.committeeIds);
        }
        return boardMemberId;
      });
      if (!createdId) return reply.code(500).send({ error: 'Failed to create board member' });
      return buildGovernanceSummary();
    }
  );

  fastify.patch<{ Params: { id: string }; Body: GovernanceUpdateBoardMemberBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/board-members/:id',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = boardMemberParamsSchema.parse(request.params);
      const boardMemberId = parseId(params.id);
      const body = boardMemberUpdateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      const [existing] = await db
        .select({ id: schema.governanceBoardMembers.id })
        .from(schema.governanceBoardMembers)
        .where(eq(schema.governanceBoardMembers.id, boardMemberId))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Board member not found' });

      const [current] = await db
        .select({
          firstFiscalYear: schema.governanceBoardMembers.first_fiscal_year,
          lastFiscalYear: schema.governanceBoardMembers.last_fiscal_year,
        })
        .from(schema.governanceBoardMembers)
        .where(eq(schema.governanceBoardMembers.id, boardMemberId))
        .limit(1);

      const firstFiscalYear = body.firstFiscalYear ?? current.firstFiscalYear;
      const lastFiscalYear = body.lastFiscalYear ?? current.lastFiscalYear;
      if (firstFiscalYear > lastFiscalYear) {
        return reply.code(400).send({ error: 'firstFiscalYear cannot be greater than lastFiscalYear' });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schema.governanceBoardMembers)
          .set({
            ...(body.publicEmail !== undefined ? { public_email: body.publicEmail } : {}),
            ...(body.firstFiscalYear !== undefined ? { first_fiscal_year: body.firstFiscalYear } : {}),
            ...(body.lastFiscalYear !== undefined ? { last_fiscal_year: body.lastFiscalYear } : {}),
            ...(body.manualInactive !== undefined ? { manual_inactive: body.manualInactive ? 1 : 0 } : {}),
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.governanceBoardMembers.id, boardMemberId));
        if (body.committeeIds) {
          await setBoardMemberCommitteeAssignments(tx, schema, boardMemberId, body.committeeIds);
        }
      });
      return buildGovernanceSummary();
    }
  );

  fastify.delete<{ Params: { id: string }; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/board-members/:id',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = boardMemberParamsSchema.parse(request.params);
      const boardMemberId = parseId(params.id);
      const { db, schema } = getDrizzleDb();
      await db.delete(schema.governanceBoardMembers).where(eq(schema.governanceBoardMembers.id, boardMemberId));
      return buildGovernanceSummary();
    }
  );

  fastify.put<{ Params: { position: string }; Body: GovernanceUpsertOfficerBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/officers/:position',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = officerParamsSchema.parse(request.params);
      const body = officerAssignSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();

      const [settingsRow] = await db
        .select()
        .from(schema.governanceSettings)
        .where(eq(schema.governanceSettings.id, 1))
        .limit(1);
      const fiscalStart = settingsRow?.fiscal_year_start_mmdd ?? '09-01';
      const turnover = settingsRow?.board_turnover_mmdd ?? '09-01';
      const boardYear = currentBoardYear(todayIsoDate(), fiscalStart, turnover);

      const [boardMember] = await db
        .select({
          id: schema.governanceBoardMembers.id,
          firstFiscalYear: schema.governanceBoardMembers.first_fiscal_year,
          lastFiscalYear: schema.governanceBoardMembers.last_fiscal_year,
          manualInactive: schema.governanceBoardMembers.manual_inactive,
        })
        .from(schema.governanceBoardMembers)
        .where(eq(schema.governanceBoardMembers.id, body.boardMemberId))
        .limit(1);
      if (!boardMember) return reply.code(404).send({ error: 'Board member not found' });

      const derived = deriveActive(boardMember.firstFiscalYear, boardMember.lastFiscalYear, boardYear);
      const isActive = (boardMember.manualInactive ?? 0) !== 1 && derived;
      if (!isActive) return reply.code(400).send({ error: 'Officer must be an active board member' });

      const [existingForMember] = await db
        .select({ position: schema.governanceOfficers.position })
        .from(schema.governanceOfficers)
        .where(eq(schema.governanceOfficers.board_member_id, body.boardMemberId))
        .limit(1);
      if (existingForMember && existingForMember.position !== params.position) {
        return reply.code(409).send({ error: 'Board member already holds another officer position' });
      }

      await db
        .insert(schema.governanceOfficers)
        .values({
          position: params.position,
          board_member_id: body.boardMemberId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .onConflictDoUpdate({
          target: schema.governanceOfficers.position,
          set: {
            board_member_id: body.boardMemberId,
            updated_at: sql`CURRENT_TIMESTAMP`,
          },
        });
      return buildGovernanceSummary();
    }
  );

  fastify.delete<{ Params: { position: string }; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/officers/:position',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = officerParamsSchema.parse(request.params);
      const { db, schema } = getDrizzleDb();
      await db.delete(schema.governanceOfficers).where(eq(schema.governanceOfficers.position, params.position));
      return buildGovernanceSummary();
    }
  );

  fastify.post<{ Body: GovernanceCreateCommitteeBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees',
    {
      schema: {
        tags: ['governance'],
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const body = committeeCreateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      await db.transaction(async (tx) => {
        const [maxSort] = await tx
          .select({ maxSortOrder: sql<number>`COALESCE(MAX(${schema.governanceCommittees.sort_order}), -1)` })
          .from(schema.governanceCommittees);
        const inserted = await tx
          .insert(schema.governanceCommittees)
          .values({
            name: body.name,
            board_liaison_board_member_id: body.boardLiaisonBoardMemberId ?? null,
            contact_info: body.contactInfo ?? null,
            responsibilities: body.responsibilities ?? null,
            sort_order: (maxSort?.maxSortOrder ?? -1) + 1,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .returning({ id: schema.governanceCommittees.id });
        const committeeId = inserted[0].id;
        if (body.boardLiaisonBoardMemberId) {
          await tx
            .insert(schema.governanceBoardMemberCommittees)
            .values({ board_member_id: body.boardLiaisonBoardMemberId, committee_id: committeeId })
            .onConflictDoNothing();
        }
      });
      return buildGovernanceSummary();
    }
  );

  fastify.patch<{ Params: { id: string }; Body: GovernanceUpdateCommitteeBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees/:id',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = committeeParamsSchema.parse(request.params);
      const committeeId = parseId(params.id);
      const body = committeeUpdateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();

      await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ boardMemberId: schema.governanceCommittees.board_liaison_board_member_id })
          .from(schema.governanceCommittees)
          .where(eq(schema.governanceCommittees.id, committeeId))
          .limit(1);
        if (!current) {
          throw new Error('Committee not found');
        }

        await tx
          .update(schema.governanceCommittees)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.boardLiaisonBoardMemberId !== undefined
              ? { board_liaison_board_member_id: body.boardLiaisonBoardMemberId }
              : {}),
            ...(body.contactInfo !== undefined ? { contact_info: body.contactInfo } : {}),
            ...(body.responsibilities !== undefined ? { responsibilities: body.responsibilities } : {}),
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.governanceCommittees.id, committeeId));

        if (body.boardLiaisonBoardMemberId !== undefined) {
          if (current.boardMemberId) {
            await tx
              .delete(schema.governanceBoardMemberCommittees)
              .where(
                and(
                  eq(schema.governanceBoardMemberCommittees.board_member_id, current.boardMemberId),
                  eq(schema.governanceBoardMemberCommittees.committee_id, committeeId)
                )
              );
          }
          if (body.boardLiaisonBoardMemberId) {
            await tx
              .insert(schema.governanceBoardMemberCommittees)
              .values({ board_member_id: body.boardLiaisonBoardMemberId, committee_id: committeeId })
              .onConflictDoNothing();
          }
        }
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Committee not found') {
          throw error;
        }
        throw error;
      });
      return buildGovernanceSummary();
    }
  );

  fastify.delete<{ Params: { id: string }; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees/:id',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = committeeParamsSchema.parse(request.params);
      const committeeId = parseId(params.id);
      const { db, schema } = getDrizzleDb();
      await db.delete(schema.governanceCommittees).where(eq(schema.governanceCommittees.id, committeeId));
      return buildGovernanceSummary();
    }
  );

  fastify.post<{ Params: { id: string }; Body: GovernanceCreateCommitteeChairBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees/:id/chairs',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = committeeParamsSchema.parse(request.params);
      const committeeId = parseId(params.id);
      const body = committeeChairCreateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      await db
        .insert(schema.governanceCommitteeChairs)
        .values({
          committee_id: committeeId,
          member_id: body.memberId,
          public_email: body.publicEmail ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .onConflictDoNothing();
      return buildGovernanceSummary();
    }
  );

  fastify.patch<{ Params: { id: string; chairId: string }; Body: GovernanceUpdateCommitteeChairBody; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees/:id/chairs/:chairId',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, chairId: { type: 'string' } },
          required: ['id', 'chairId'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = chairParamsSchema.parse(request.params);
      const committeeId = parseId(params.id);
      const chairId = parseId(params.chairId);
      const body = committeeChairUpdateSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      await db
        .update(schema.governanceCommitteeChairs)
        .set({
          ...(body.publicEmail !== undefined ? { public_email: body.publicEmail } : {}),
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(schema.governanceCommitteeChairs.id, chairId),
            eq(schema.governanceCommitteeChairs.committee_id, committeeId)
          )
        );
      return buildGovernanceSummary();
    }
  );

  fastify.delete<{ Params: { id: string; chairId: string }; Reply: GovernanceSummaryResponse | ApiErrorResponse }>(
    '/governance/committees/:id/chairs/:chairId',
    {
      schema: {
        tags: ['governance'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' }, chairId: { type: 'string' } },
          required: ['id', 'chairId'],
        },
        response: { 200: governanceSummaryResponseSchema },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!isAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
      const params = chairParamsSchema.parse(request.params);
      const committeeId = parseId(params.id);
      const chairId = parseId(params.chairId);
      const { db, schema } = getDrizzleDb();
      await db
        .delete(schema.governanceCommitteeChairs)
        .where(
          and(
            eq(schema.governanceCommitteeChairs.id, chairId),
            eq(schema.governanceCommitteeChairs.committee_id, committeeId)
          )
        );
      return buildGovernanceSummary();
    }
  );

  fastify.get<{ Reply: { positions: GovernanceOfficerPosition[] } }>(
    '/governance/officer-positions',
    {
      schema: {
        tags: ['governance'],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: {
              positions: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['positions'],
          },
        },
      },
    },
    async () => ({ positions: officerPositions })
  );

  fastify.post<{ Reply: { success: boolean } }>(
    '/governance/ensure-default-settings',
    {
      schema: {
        tags: ['governance'],
        response: { 200: successResponseSchema },
      },
    },
    async () => {
      const { db, schema } = getDrizzleDb();
      await db
        .insert(schema.governanceSettings)
        .values({
          id: 1,
          fiscal_year_start_mmdd: '09-01',
          board_turnover_mmdd: '09-01',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .onConflictDoNothing();
      return { success: true };
    }
  );
}

