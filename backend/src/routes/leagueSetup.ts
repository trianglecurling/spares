import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { successResponseSchema } from '../api/schemas.js';
import {
  divisionCreateBodySchema,
  divisionListResponseSchema,
  divisionSchema,
  divisionUpdateBodySchema,
  managerAddBodySchema,
  managerAddResponseSchema,
  managerListResponseSchema,
  managerSearchResponseSchema,
  memberSearchResponseSchema,
  rosterAddBodySchema,
  rosterAddResponseSchema,
  rosterBulkBodySchema,
  rosterBulkResponseSchema,
  rosterListResponseSchema,
  rosterSearchResponseSchema,
  rosterUnassignedResponseSchema,
  sheetCreateBodySchema,
  sheetListResponseSchema,
  sheetSchema,
  sheetUpdateBodySchema,
  teamCreateBodySchema,
  teamListResponseSchema,
  teamResponseSchema,
  teamRosterResponseSchema,
  teamRosterUpdateBodySchema,
  teamUpdateBodySchema,
} from '../api/leagueSetupSchemas.js';
import {
  hasClubLeagueAdministratorAccess,
  hasLeagueAdministratorAccess,
  hasLeagueSetupAccess,
} from '../utils/leagueAccess.js';

type DrizzleDb = ReturnType<typeof getDrizzleDb>['db'];
type DrizzleSchema = ReturnType<typeof getDrizzleDb>['schema'];
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type SheetRow = DrizzleSchema['sheets']['$inferSelect'];
type DivisionRow = DrizzleSchema['leagueDivisions']['$inferSelect'];
type LeagueRosterRow = DrizzleSchema['leagueRoster']['$inferSelect'];
type TeamRow = DrizzleSchema['leagueTeams']['$inferSelect'];
type TeamMemberRow = DrizzleSchema['teamMembers']['$inferSelect'];

const sheetCreateSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const sheetUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const divisionCreateSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
  isDefault: z.boolean().optional(),
});

const divisionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isDefault: z.boolean().optional(),
});

const teamMemberSchema = z.object({
  memberId: z.number().int().positive(),
  role: z.enum(['lead', 'second', 'third', 'fourth', 'player1', 'player2']),
  isSkip: z.boolean().optional(),
  isVice: z.boolean().optional(),
});

function getAffectedRows(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0;
  if ('changes' in result && typeof (result as { changes?: number }).changes === 'number') {
    return (result as { changes: number }).changes;
  }
  if ('rowCount' in result && typeof (result as { rowCount?: number }).rowCount === 'number') {
    return (result as { rowCount: number }).rowCount;
  }
  return 0;
}

const teamCreateSchema = z.object({
  name: z.string().optional(),
  divisionId: z.number().int().positive().optional(),
  members: z.array(teamMemberSchema).optional(),
});

const teamUpdateSchema = z.object({
  name: z.string().optional(),
  divisionId: z.number().int().positive().optional(),
});

const rosterUpdateSchema = z.object({
  members: z.array(teamMemberSchema),
});

const memberSearchQuerySchema = z.object({
  query: z.string().min(1),
  leagueId: z.coerce.number().int().positive().optional(),
});

const rosterSearchQuerySchema = z.object({
  query: z.string().min(1),
  rosterOnly: z.coerce.boolean().optional(),
});

const rosterAddSchema = z.object({
  memberId: z.number().int().positive(),
});

const rosterBulkAddSchema = z.object({
  names: z.array(z.string().min(1)).min(1),
});

const managerAddSchema = z.object({
  memberId: z.number().int().positive(),
});

const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const leagueDivisionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leagueId: { type: 'string' },
    divisionId: { type: 'string' },
  },
  required: ['leagueId', 'divisionId'],
} as const;

const leagueMemberParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    memberId: { type: 'string' },
  },
  required: ['id', 'memberId'],
} as const;

const teamIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { teamId: { type: 'string' } },
  required: ['teamId'],
} as const;

const rosterSearchQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    rosterOnly: { type: 'boolean' },
  },
  required: ['query'],
} as const;

const memberSearchQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    leagueId: { type: 'number' },
  },
  required: ['query'],
} as const;

type TeamMemberInput = z.infer<typeof teamMemberSchema>;

function normalizeOptionalName(name?: string | null): string | null {
  if (name === undefined || name === null) return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getLastName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || trimmed;
}

function validateRoster(format: 'teams' | 'doubles', members: TeamMemberInput[]): TeamMemberInput[] {
  const normalized = members.map((m) => ({
    ...m,
    isSkip: Boolean(m.isSkip),
    isVice: Boolean(m.isVice),
  }));

  const memberIds = new Set<number>();
  for (const member of normalized) {
    if (memberIds.has(member.memberId)) {
      throw new Error('Roster has duplicate members.');
    }
    memberIds.add(member.memberId);
  }

  const roles = normalized.map((m) => m.role);
  const roleSet = new Set(roles);
  if (roleSet.size !== roles.length) {
    throw new Error('Roster roles must be unique.');
  }

  if (format === 'teams') {
    const allowedRoles = new Set(['lead', 'second', 'third', 'fourth']);
    if (!normalized.every((m) => allowedRoles.has(m.role))) {
      throw new Error('Teams roster roles must be lead, second, third, or fourth.');
    }

    if (normalized.length !== 3 && normalized.length !== 4) {
      throw new Error('Teams rosters must have 3 or 4 players.');
    }

    if (!roleSet.has('lead') || !roleSet.has('third') || !roleSet.has('fourth')) {
      throw new Error('Teams rosters must include lead, third, and fourth.');
    }

    if (normalized.length === 4 && !roleSet.has('second')) {
      throw new Error('Four-person teams must include a second.');
    }

    if (normalized.length === 3 && roleSet.has('second')) {
      throw new Error('Three-person teams may not include a second.');
    }

    const skips = normalized.filter((m) => m.isSkip);
    const vices = normalized.filter((m) => m.isVice);

    if (skips.length !== 1) {
      throw new Error('Teams rosters must have exactly one skip.');
    }
    if (vices.length !== 1) {
      throw new Error('Teams rosters must have exactly one vice.');
    }
    if (skips[0].memberId === vices[0].memberId) {
      throw new Error('Skip and vice must be different players.');
    }

    return normalized;
  }

  if (normalized.length !== 2) {
    throw new Error('Doubles rosters must have exactly two players.');
  }

  if (!(roleSet.has('player1') && roleSet.has('player2'))) {
    throw new Error('Doubles rosters must include player1 and player2.');
  }

  if (normalized.some((m) => m.isSkip || m.isVice)) {
    throw new Error('Doubles rosters do not support skip or vice.');
  }

  return normalized;
}

function computeDefaultTeamName(
  format: 'teams' | 'doubles',
  roster: TeamMemberInput[],
  memberNamesById: Map<number, string>
): string | null {
  if (format === 'teams') {
    const skip = roster.find((member) => member.isSkip);
    if (!skip) return null;
    const name = memberNamesById.get(skip.memberId) || '';
    const lastName = getLastName(name);
    return lastName ? `Team ${lastName}` : null;
  }

  const player1 = roster.find((member) => member.role === 'player1');
  const player2 = roster.find((member) => member.role === 'player2');
  if (!player1 || !player2) return null;
  const lastName1 = getLastName(memberNamesById.get(player1.memberId) || '');
  const lastName2 = getLastName(memberNamesById.get(player2.memberId) || '');
  if (!lastName1 || !lastName2) return null;
  return `${lastName1}/${lastName2}`;
}

async function ensureRosterMembership(
  tx: DrizzleTx,
  schema: DrizzleSchema,
  leagueId: number,
  memberIds: number[]
): Promise<void> {
  if (memberIds.length === 0) return;

  const rosterRows = await tx
    .select({ member_id: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.league_id, leagueId), inArray(schema.leagueRoster.member_id, memberIds)));

  if (rosterRows.length !== memberIds.length) {
    throw new Error('One or more roster members are not on the league roster.');
  }
}

export async function leagueSetupRoutes(fastify: FastifyInstance) {
  // Sheets
  fastify.get(
    '/sheets',
    {
      schema: {
        tags: ['league-setup'],
        response: {
          200: sheetListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const sheets = await db
      .select()
      .from(schema.sheets)
      .orderBy(schema.sheets.sort_order, schema.sheets.name);

    return sheets.map((sheet: SheetRow) => ({
      id: sheet.id,
      name: sheet.name,
      sortOrder: sheet.sort_order,
      isActive: sheet.is_active === 1,
      createdAt: sheet.created_at,
      updatedAt: sheet.updated_at,
    }));
    }
  );

  fastify.post(
    '/sheets',
    {
      schema: {
        tags: ['league-setup'],
        body: sheetCreateBodySchema,
        response: {
          200: sheetSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = sheetCreateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const result = await db
      .insert(schema.sheets)
      .values({
        name: body.name.trim(),
        sort_order: body.sortOrder ?? 0,
        is_active: body.isActive === false ? 0 : 1,
      })
      .returning();

    const sheet = result[0];
    return {
      id: sheet.id,
      name: sheet.name,
      sortOrder: sheet.sort_order,
      isActive: sheet.is_active === 1,
      createdAt: sheet.created_at,
      updatedAt: sheet.updated_at,
    };
    }
  );

  fastify.patch(
    '/sheets/:id',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: sheetUpdateBodySchema,
        response: {
          200: sheetSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const sheetId = parseInt(id, 10);
    const body = sheetUpdateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updateData.is_active = body.isActive ? 1 : 0;

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updateData.updated_at = sql`CURRENT_TIMESTAMP`;
    await db.update(schema.sheets).set(updateData).where(eq(schema.sheets.id, sheetId));

    const sheets = await db.select().from(schema.sheets).where(eq(schema.sheets.id, sheetId)).limit(1);
    if (sheets.length === 0) {
      return reply.code(404).send({ error: 'Sheet not found' });
    }

    const sheet = sheets[0];
    return {
      id: sheet.id,
      name: sheet.name,
      sortOrder: sheet.sort_order,
      isActive: sheet.is_active === 1,
      createdAt: sheet.created_at,
      updatedAt: sheet.updated_at,
    };
    }
  );

  fastify.delete(
    '/sheets/:id',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const sheetId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    await db.delete(schema.sheets).where(eq(schema.sheets.id, sheetId));
    return { success: true };
    }
  );

  // Divisions
  fastify.get(
    '/leagues/:id/divisions',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: divisionListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const divisions = await db
      .select()
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.league_id, leagueId))
      .orderBy(schema.leagueDivisions.name);

    return divisions.map((division: DivisionRow) => ({
      id: division.id,
      leagueId: division.league_id,
      name: division.name,
      sortOrder: division.sort_order,
      isDefault: division.is_default === 1,
    }));
    }
  );

  fastify.post(
    '/leagues/:id/divisions',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: divisionCreateBodySchema,
        response: {
          200: divisionSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = divisionCreateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const result = await db
      .insert(schema.leagueDivisions)
      .values({
        league_id: leagueId,
        name: body.name.trim(),
        sort_order: 0,
        is_default: 0,
      })
      .returning();
    const division = result[0];

    return {
      id: division.id,
      leagueId: division.league_id,
      name: division.name,
      sortOrder: division.sort_order,
      isDefault: division.is_default === 1,
    };
    }
  );

  fastify.patch(
    '/leagues/:leagueId/divisions/:divisionId',
    {
      schema: {
        tags: ['league-setup'],
        params: leagueDivisionParamsSchema,
        body: divisionUpdateBodySchema,
        response: {
          200: divisionSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { leagueId: leagueIdRaw, divisionId: divisionIdRaw } = request.params as {
      leagueId: string;
      divisionId: string;
    };
    const leagueId = parseInt(leagueIdRaw, 10);
    const divisionId = parseInt(divisionIdRaw, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = divisionUpdateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const divisions = await db
      .select()
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.id, divisionId))
      .limit(1);

    const division = divisions[0];
    if (!division || division.league_id !== leagueId) {
      return reply.code(404).send({ error: 'Division not found' });
    }

    const divisionCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.league_id, leagueId));

    if (Number(divisionCount[0]?.count || 0) <= 1) {
      return reply.code(400).send({ error: 'A league must have at least one division.' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder;

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updateData.updated_at = sql`CURRENT_TIMESTAMP`;
    await db.update(schema.leagueDivisions).set(updateData).where(eq(schema.leagueDivisions.id, divisionId));

    const updated = await db
      .select()
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.id, divisionId))
      .limit(1);

    const updatedDivision = updated[0];
    return {
      id: updatedDivision.id,
      leagueId: updatedDivision.league_id,
      name: updatedDivision.name,
      sortOrder: updatedDivision.sort_order,
      isDefault: updatedDivision.is_default === 1,
    };
    }
  );

  fastify.delete(
    '/leagues/:leagueId/divisions/:divisionId',
    {
      schema: {
        tags: ['league-setup'],
        params: leagueDivisionParamsSchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { leagueId: leagueIdRaw, divisionId: divisionIdRaw } = request.params as {
      leagueId: string;
      divisionId: string;
    };
    const leagueId = parseInt(leagueIdRaw, 10);
    const divisionId = parseInt(divisionIdRaw, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();

    const divisions = await db
      .select()
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.id, divisionId))
      .limit(1);

    const division = divisions[0];
    if (!division || division.league_id !== leagueId) {
      return reply.code(404).send({ error: 'Division not found' });
    }

    const teams = await db
      .select({ id: schema.leagueTeams.id })
      .from(schema.leagueTeams)
      .where(eq(schema.leagueTeams.division_id, divisionId))
      .limit(1);

    if (teams.length > 0) {
      return reply.code(400).send({ error: 'Cannot delete a division with teams.' });
    }

    await db.delete(schema.leagueDivisions).where(eq(schema.leagueDivisions.id, divisionId));

    return { success: true };
    }
  );

  // League roster
  fastify.get(
    '/leagues/:id/roster',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: rosterListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const rosterRows = (await db
      .select({
        member_id: schema.leagueRoster.member_id,
        name: schema.members.name,
        email: schema.members.email,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
      .where(eq(schema.leagueRoster.league_id, leagueId))
      .orderBy(schema.members.name)) as { member_id: number; name: string; email: string | null }[];

    const rosterMemberIds = rosterRows.map((row) => row.member_id);
    const assignments = rosterMemberIds.length
      ? ((await db
          .select({
            member_id: schema.teamMembers.member_id,
            team_id: schema.leagueTeams.id,
            team_name: schema.leagueTeams.name,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
          .where(
            and(eq(schema.leagueTeams.league_id, leagueId), inArray(schema.teamMembers.member_id, rosterMemberIds))
          )) as { member_id: number; team_id: number; team_name: string | null }[])
      : [];

    const assignmentMap = new Map<number, { teamId: number; teamName: string | null }>();
    for (const entry of assignments) {
      assignmentMap.set(entry.member_id, { teamId: entry.team_id, teamName: entry.team_name });
    }

    return rosterRows.map((row) => {
      const assignment = assignmentMap.get(row.member_id);
      return {
        memberId: row.member_id,
        name: row.name,
        email: row.email,
        assignedTeamId: assignment?.teamId ?? null,
        assignedTeamName: assignment?.teamName ?? null,
      };
    });
    }
  );

  fastify.get(
    '/leagues/:id/roster/unassigned',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: rosterUnassignedResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const assignedRows = (await db
      .select({ member_id: schema.teamMembers.member_id })
      .from(schema.teamMembers)
      .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
      .where(eq(schema.leagueTeams.league_id, leagueId))) as { member_id: number }[];

    const assignedIds = assignedRows.map((row) => row.member_id);
    const rosterRows = (await db
      .select({
        member_id: schema.leagueRoster.member_id,
        name: schema.members.name,
        email: schema.members.email,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
      .where(
        and(
          eq(schema.leagueRoster.league_id, leagueId),
          assignedIds.length > 0 ? notInArray(schema.leagueRoster.member_id, assignedIds) : sql`1=1`
        )
      )
      .orderBy(schema.members.name)) as { member_id: number; name: string; email: string | null }[];

    return rosterRows.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      email: row.email,
    }));
    }
  );

  fastify.get(
    '/leagues/:id/roster/search',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        querystring: rosterSearchQuerySchemaJson,
        response: {
          200: rosterSearchResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { query, rosterOnly } = rosterSearchQuerySchema.parse(request.query ?? {});

    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    if (rosterOnly) {
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } else if (!(await hasLeagueAdministratorAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const search = `%${query.toLowerCase()}%`;
    const { db, schema } = getDrizzleDb();

    if (rosterOnly) {
      const rows = (await db
        .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
        .from(schema.leagueRoster)
        .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
        .where(
          and(
            eq(schema.leagueRoster.league_id, leagueId),
            or(
              sql`LOWER(${schema.members.name}) LIKE ${search}`,
              sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
            )
          )
        )
        .orderBy(schema.members.name, desc(schema.members.id))
        .limit(20)) as { id: number; name: string; email: string | null }[];

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
      }));
    }

    const rosterIds = (await db
      .select({ member_id: schema.leagueRoster.member_id })
      .from(schema.leagueRoster)
      .where(eq(schema.leagueRoster.league_id, leagueId))) as { member_id: number }[];

    const rosterIdSet = rosterIds.map((row) => row.member_id);
    const rows = (await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(
        and(
          rosterIdSet.length > 0 ? notInArray(schema.members.id, rosterIdSet) : sql`1=1`,
          or(
            sql`LOWER(${schema.members.name}) LIKE ${search}`,
            sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
          )
        )
      )
      .orderBy(schema.members.name, desc(schema.members.id))
      .limit(20)) as { id: number; name: string; email: string | null }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
    }
  );

  fastify.post(
    '/leagues/:id/roster',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: rosterAddBodySchema,
        response: {
          200: rosterAddResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueAdministratorAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = rosterAddSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const existing = await db
      .select({ id: schema.leagueRoster.id })
      .from(schema.leagueRoster)
      .where(and(eq(schema.leagueRoster.league_id, leagueId), eq(schema.leagueRoster.member_id, body.memberId)))
      .limit(1);

    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Member is already on the league roster.' });
    }

    const memberRows = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.id, body.memberId))
      .limit(1);

    if (memberRows.length === 0) {
      return reply.code(404).send({ error: 'Member not found.' });
    }

    const result = await db
      .insert(schema.leagueRoster)
      .values({ league_id: leagueId, member_id: body.memberId })
      .returning();

    return { id: result[0].id, leagueId, memberId: body.memberId };
    }
  );

  fastify.post(
    '/leagues/:id/roster/bulk',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: rosterBulkBodySchema,
        response: {
          200: rosterBulkResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueAdministratorAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = rosterBulkAddSchema.parse(request.body);
    const rawNames = body.names.map((name) => name.trim()).filter(Boolean);
    if (rawNames.length === 0) {
      return reply.code(400).send({ error: 'No names provided.' });
    }

    const normalizedNames = rawNames.map((name) => name.toLowerCase());
    const uniqueNormalized = Array.from(new Set(normalizedNames));
    const { db, schema } = getDrizzleDb();

    const lowerName = sql<string>`LOWER(${schema.members.name})`;
    const exactRows = (await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email, lowerName })
      .from(schema.members)
      .where(inArray(lowerName, uniqueNormalized))
      .orderBy(schema.members.name)) as {
      id: number;
      name: string;
      email: string | null;
      lowerName: string;
    }[];

    const exactMap = new Map<string, { id: number; name: string; email: string | null }[]>();
    for (const row of exactRows) {
      const list = exactMap.get(row.lowerName) ?? [];
      list.push({ id: row.id, name: row.name, email: row.email });
      exactMap.set(row.lowerName, list);
    }

    const unmatched: { name: string; candidates: { id: number; name: string; email: string | null }[] }[] = [];
    const matchedIds: number[] = [];
    const matchedNames: string[] = [];

    rawNames.forEach((name, index) => {
      const normalized = normalizedNames[index];
      const matches = exactMap.get(normalized) ?? [];
      if (matches.length === 1) {
        matchedIds.push(matches[0].id);
        matchedNames.push(name);
      } else {
        unmatched.push({ name, candidates: matches });
      }
    });

    const uniqueMatchedIds = Array.from(new Set(matchedIds));
    const existingRows = uniqueMatchedIds.length
      ? ((await db
          .select({ member_id: schema.leagueRoster.member_id })
          .from(schema.leagueRoster)
          .where(and(eq(schema.leagueRoster.league_id, leagueId), inArray(schema.leagueRoster.member_id, uniqueMatchedIds)))) as {
          member_id: number;
        }[])
      : [];
    const existingIds = new Set(existingRows.map((row) => row.member_id));

    const toInsert = uniqueMatchedIds.filter((id) => !existingIds.has(id));
    if (toInsert.length > 0) {
      await db
        .insert(schema.leagueRoster)
        .values(toInsert.map((memberId) => ({ league_id: leagueId, member_id: memberId })))
        .onConflictDoNothing();
    }

    for (const entry of unmatched) {
      if (entry.candidates.length > 0) continue;
      const search = `%${entry.name.toLowerCase()}%`;
      const suggestions = (await db
        .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
        .from(schema.members)
        .where(
          or(
            sql`LOWER(${schema.members.name}) LIKE ${search}`,
            sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
          )
        )
        .orderBy(schema.members.name)
        .limit(5)) as { id: number; name: string; email: string | null }[];
      entry.candidates = suggestions;
    }

    return {
      addedCount: toInsert.length,
      alreadyOnRosterCount: existingIds.size,
      matchedCount: uniqueMatchedIds.length,
      matchedNames,
      unmatched,
    };
    }
  );

  fastify.delete(
    '/leagues/:id/roster/:memberId',
    {
      schema: {
        tags: ['league-setup'],
        params: leagueMemberParamsSchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id, memberId } = request.params as { id: string; memberId: string };
    const leagueId = parseInt(id, 10);
    const memberIdNum = parseInt(memberId, 10);

    if (!member || !(await hasLeagueAdministratorAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const assignments = await db
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
      .where(
        and(eq(schema.leagueTeams.league_id, leagueId), eq(schema.teamMembers.member_id, memberIdNum))
      )
      .limit(1);

    if (assignments.length > 0) {
      return reply.code(400).send({ error: 'Member is assigned to a team in this league.' });
    }

    const result = await db
      .delete(schema.leagueRoster)
      .where(and(eq(schema.leagueRoster.league_id, leagueId), eq(schema.leagueRoster.member_id, memberIdNum)));

    if (getAffectedRows(result) === 0) {
      return reply.code(404).send({ error: 'Roster member not found.' });
    }

    return { success: true };
    }
  );

  // League managers
  fastify.get(
    '/leagues/:id/managers',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: managerListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const rows = (await db
      .select({
        member_id: schema.leagueMemberRoles.member_id,
        name: schema.members.name,
        email: schema.members.email,
      })
      .from(schema.leagueMemberRoles)
      .innerJoin(schema.members, eq(schema.leagueMemberRoles.member_id, schema.members.id))
      .where(
        and(
          eq(schema.leagueMemberRoles.league_id, leagueId),
          eq(schema.leagueMemberRoles.role, 'league_manager')
        )
      )
      .orderBy(schema.members.name)) as { member_id: number; name: string; email: string | null }[];

    return rows.map((row: { member_id: number; name: string; email: string | null }) => ({
      memberId: row.member_id,
      name: row.name,
      email: row.email,
    }));
    }
  );

  fastify.get(
    '/leagues/:id/managers/search',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        querystring: rosterSearchQuerySchemaJson,
        response: {
          200: managerSearchResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { query } = rosterSearchQuerySchema.parse(request.query ?? {});

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const search = `%${query.toLowerCase()}%`;
    const { db, schema } = getDrizzleDb();
    const existingManagerRows = (await db
      .select({ member_id: schema.leagueMemberRoles.member_id })
      .from(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.league_id, leagueId),
          eq(schema.leagueMemberRoles.role, 'league_manager')
        )
      )) as { member_id: number }[];

    const existingIds = existingManagerRows.map((row) => row.member_id);
    const rows = (await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(
        and(
          existingIds.length > 0 ? notInArray(schema.members.id, existingIds) : sql`1=1`,
          or(
            sql`LOWER(${schema.members.name}) LIKE ${search}`,
            sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
          )
        )
      )
      .orderBy(schema.members.name, desc(schema.members.id))
      .limit(20)) as { id: number; name: string; email: string | null }[];

    return rows.map((row: { id: number; name: string; email: string | null }) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
    }
  );

  fastify.post(
    '/leagues/:id/managers',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: managerAddBodySchema,
        response: {
          200: managerAddResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = managerAddSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const memberRows = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.id, body.memberId))
      .limit(1);

    if (memberRows.length === 0) {
      return reply.code(404).send({ error: 'Member not found.' });
    }

    const result = await db
      .insert(schema.leagueMemberRoles)
      .values({ member_id: body.memberId, league_id: leagueId, role: 'league_manager' })
      .onConflictDoNothing()
      .returning();

    return {
      id: result[0]?.id,
      leagueId,
      memberId: body.memberId,
    };
    }
  );

  fastify.delete(
    '/leagues/:id/managers/:memberId',
    {
      schema: {
        tags: ['league-setup'],
        params: leagueMemberParamsSchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id, memberId } = request.params as { id: string; memberId: string };
    const leagueId = parseInt(id, 10);
    const memberIdNum = parseInt(memberId, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const result = await db
      .delete(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.member_id, memberIdNum),
          eq(schema.leagueMemberRoles.league_id, leagueId),
          eq(schema.leagueMemberRoles.role, 'league_manager')
        )
      );

    if (getAffectedRows(result) === 0) {
      return reply.code(404).send({ error: 'Manager not found.' });
    }

    return { success: true };
    }
  );

  // Teams and rosters
  fastify.get(
    '/leagues/:id/teams',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        response: {
          200: teamListResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const teams = (await db
      .select({
        id: schema.leagueTeams.id,
        league_id: schema.leagueTeams.league_id,
        division_id: schema.leagueTeams.division_id,
        name: schema.leagueTeams.name,
        division_name: schema.leagueDivisions.name,
      })
      .from(schema.leagueTeams)
      .innerJoin(schema.leagueDivisions, eq(schema.leagueTeams.division_id, schema.leagueDivisions.id))
      .where(eq(schema.leagueTeams.league_id, leagueId))
      .orderBy(schema.leagueDivisions.sort_order, schema.leagueTeams.name)) as {
        id: number;
        league_id: number;
        division_id: number;
        name: string | null;
        division_name: string;
      }[];

    const teamIds = teams.map((team) => team.id);
    const rosterRows = teamIds.length
      ? ((await db
          .select({
            team_id: schema.teamMembers.team_id,
            member_id: schema.teamMembers.member_id,
            member_name: schema.members.name,
            role: schema.teamMembers.role,
            is_skip: schema.teamMembers.is_skip,
            is_vice: schema.teamMembers.is_vice,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
          .where(inArray(schema.teamMembers.team_id, teamIds))
          .orderBy(schema.teamMembers.team_id, schema.teamMembers.role)) as {
          team_id: number;
          member_id: number;
          member_name: string;
          role: string;
          is_skip: number;
          is_vice: number;
        }[])
      : [];

    const rosterByTeam = new Map<
      number,
      Array<{ memberId: number; name: string; role: string; isSkip: boolean; isVice: boolean }>
    >();
    for (const row of rosterRows) {
      const list = rosterByTeam.get(row.team_id) ?? [];
      list.push({
        memberId: row.member_id,
        name: row.member_name,
        role: row.role,
        isSkip: row.is_skip === 1,
        isVice: row.is_vice === 1,
      });
      rosterByTeam.set(row.team_id, list);
    }

    return teams.map((team) => ({
      id: team.id,
      leagueId: team.league_id,
      divisionId: team.division_id,
      divisionName: team.division_name,
      name: team.name,
      roster: rosterByTeam.get(team.id) ?? [],
    }));
    }
  );

  fastify.post(
    '/leagues/:id/teams',
    {
      schema: {
        tags: ['league-setup'],
        params: idParamsSchema,
        body: teamCreateBodySchema,
        response: {
          200: teamResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueSetupAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = teamCreateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const leagues = await db
      .select({ format: schema.leagues.format })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);

    if (leagues.length === 0) {
      return reply.code(404).send({ error: 'League not found' });
    }

    const format = leagues[0].format;

    let divisionId = body.divisionId;
    if (!divisionId) {
      const defaultDivisions = await db
        .select({ id: schema.leagueDivisions.id })
        .from(schema.leagueDivisions)
        .where(and(eq(schema.leagueDivisions.league_id, leagueId), eq(schema.leagueDivisions.is_default, 1)))
        .limit(1);

      if (defaultDivisions.length === 0) {
        return reply.code(400).send({ error: 'Default division not found for league.' });
      }
      divisionId = defaultDivisions[0].id;
    } else {
      const divisions = await db
        .select({ id: schema.leagueDivisions.id })
        .from(schema.leagueDivisions)
        .where(and(eq(schema.leagueDivisions.id, divisionId), eq(schema.leagueDivisions.league_id, leagueId)))
        .limit(1);
      if (divisions.length === 0) {
        return reply.code(400).send({ error: 'Division does not belong to league.' });
      }
    }

    const normalizedName = normalizeOptionalName(body.name);

    const result = await db
      .insert(schema.leagueTeams)
      .values({
        league_id: leagueId,
        division_id: divisionId,
        name: normalizedName,
      })
      .returning();

    const team = result[0];

    if (body.members && body.members.length > 0) {
      try {
        const roster = validateRoster(format, body.members);
        await db.transaction(async (tx: DrizzleTx) => {
          await tx
            .delete(schema.teamMembers)
            .where(eq(schema.teamMembers.team_id, team.id));

          const memberIds = roster.map((entry) => entry.memberId);
          const existingMembers = (await tx
            .select({ id: schema.members.id, name: schema.members.name })
            .from(schema.members)
            .where(inArray(schema.members.id, memberIds))) as { id: number; name: string }[];

          if (existingMembers.length !== memberIds.length) {
            throw new Error('One or more roster members do not exist.');
          }

          await ensureRosterMembership(tx, schema, leagueId, memberIds);

          const memberNameMap = new Map<number, string>(existingMembers.map((entry) => [entry.id, entry.name]));

          const conflicts = await tx
            .select({
              member_id: schema.teamMembers.member_id,
              team_id: schema.teamMembers.team_id,
            })
            .from(schema.teamMembers)
            .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
            .where(
              and(
                eq(schema.leagueTeams.league_id, leagueId),
                inArray(schema.teamMembers.member_id, memberIds)
              )
            );

          if (conflicts.length > 0) {
            throw new Error('One or more members already belong to another team in this league.');
          }

          await tx.insert(schema.teamMembers).values(
            roster.map((entry) => ({
              team_id: team.id,
              member_id: entry.memberId,
              role: entry.role,
              is_skip: entry.isSkip ? 1 : 0,
              is_vice: entry.isVice ? 1 : 0,
            }))
          );

          if (!normalizedName) {
            const defaultName = computeDefaultTeamName(format, roster, memberNameMap);
            if (defaultName) {
              await tx
                .update(schema.leagueTeams)
                .set({ name: defaultName, updated_at: sql`CURRENT_TIMESTAMP` })
                .where(eq(schema.leagueTeams.id, team.id));
              team.name = defaultName;
            }
          }
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid roster';
        return reply.code(400).send({ error: message });
      }
    }

    return {
      id: team.id,
      leagueId: team.league_id,
      divisionId: team.division_id,
      name: team.name,
    };
    }
  );

  fastify.patch(
    '/teams/:teamId',
    {
      schema: {
        tags: ['league-setup'],
        params: teamIdParamsSchema,
        body: teamUpdateBodySchema,
        response: {
          200: teamResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { teamId } = request.params as { teamId: string };
    const id = parseInt(teamId, 10);

    const body = teamUpdateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const teams = await db
      .select({
        id: schema.leagueTeams.id,
        league_id: schema.leagueTeams.league_id,
        division_id: schema.leagueTeams.division_id,
      })
      .from(schema.leagueTeams)
      .where(eq(schema.leagueTeams.id, id))
      .limit(1);

    const team = teams[0];
    if (!team) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    if (!member || !(await hasLeagueSetupAccess(member, team.league_id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = normalizeOptionalName(body.name);

    if (body.divisionId !== undefined) {
      const divisions = await db
        .select({ id: schema.leagueDivisions.id })
        .from(schema.leagueDivisions)
        .where(and(eq(schema.leagueDivisions.id, body.divisionId), eq(schema.leagueDivisions.league_id, team.league_id)))
        .limit(1);
      if (divisions.length === 0) {
        return reply.code(400).send({ error: 'Division does not belong to league.' });
      }
      updateData.division_id = body.divisionId;
    }

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updateData.updated_at = sql`CURRENT_TIMESTAMP`;
    await db.update(schema.leagueTeams).set(updateData).where(eq(schema.leagueTeams.id, id));

    const updated = await db
      .select()
      .from(schema.leagueTeams)
      .where(eq(schema.leagueTeams.id, id))
      .limit(1);

    const updatedTeam = updated[0];
    return {
      id: updatedTeam.id,
      leagueId: updatedTeam.league_id,
      divisionId: updatedTeam.division_id,
      name: updatedTeam.name,
    };
    }
  );

  fastify.delete(
    '/teams/:teamId',
    {
      schema: {
        tags: ['league-setup'],
        params: teamIdParamsSchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { teamId } = request.params as { teamId: string };
    const id = parseInt(teamId, 10);

    const { db, schema } = getDrizzleDb();
    const teams = await db
      .select({ league_id: schema.leagueTeams.league_id })
      .from(schema.leagueTeams)
      .where(eq(schema.leagueTeams.id, id))
      .limit(1);

    const team = teams[0];
    if (!team) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    if (!member || !(await hasLeagueSetupAccess(member, team.league_id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await db.delete(schema.leagueTeams).where(eq(schema.leagueTeams.id, id));
    return { success: true };
    }
  );

  fastify.get(
    '/teams/:teamId/roster',
    {
      schema: {
        tags: ['league-setup'],
        params: teamIdParamsSchema,
        response: {
          200: teamRosterResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { teamId } = request.params as { teamId: string };
    const id = parseInt(teamId, 10);
    const { db, schema } = getDrizzleDb();

    const roster = (await db
      .select({
        member_id: schema.teamMembers.member_id,
        member_name: schema.members.name,
        role: schema.teamMembers.role,
        is_skip: schema.teamMembers.is_skip,
        is_vice: schema.teamMembers.is_vice,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
      .where(eq(schema.teamMembers.team_id, id))
      .orderBy(schema.teamMembers.role)) as {
      member_id: number;
      member_name: string;
      role: string;
      is_skip: number;
      is_vice: number;
    }[];

    return roster.map((entry) => ({
      memberId: entry.member_id,
      name: entry.member_name,
      role: entry.role,
      isSkip: entry.is_skip === 1,
      isVice: entry.is_vice === 1,
    }));
    }
  );

  fastify.put(
    '/teams/:teamId/roster',
    {
      schema: {
        tags: ['league-setup'],
        params: teamIdParamsSchema,
        body: teamRosterUpdateBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    const { teamId } = request.params as { teamId: string };
    const id = parseInt(teamId, 10);

    const body = rosterUpdateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const teams = await db
      .select({
        id: schema.leagueTeams.id,
        league_id: schema.leagueTeams.league_id,
        name: schema.leagueTeams.name,
        format: schema.leagues.format,
      })
      .from(schema.leagueTeams)
      .innerJoin(schema.leagues, eq(schema.leagueTeams.league_id, schema.leagues.id))
      .where(eq(schema.leagueTeams.id, id))
      .limit(1);

    const team = teams[0];
    if (!team) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    if (!member || !(await hasLeagueSetupAccess(member, team.league_id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    try {
      const roster = validateRoster(team.format, body.members);
      const memberIds = roster.map((entry) => entry.memberId);

      await db.transaction(async (tx: DrizzleTx) => {
        const existingMembers = (await tx
          .select({ id: schema.members.id, name: schema.members.name })
          .from(schema.members)
          .where(inArray(schema.members.id, memberIds))) as { id: number; name: string }[];

        if (existingMembers.length !== memberIds.length) {
          throw new Error('One or more roster members do not exist.');
        }

        await ensureRosterMembership(tx, schema, team.league_id, memberIds);

        const conflicts = await tx
          .select({
            member_id: schema.teamMembers.member_id,
            team_id: schema.teamMembers.team_id,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
          .where(
            and(
              eq(schema.leagueTeams.league_id, team.league_id),
              inArray(schema.teamMembers.member_id, memberIds),
              ne(schema.teamMembers.team_id, id)
            )
          );

        if (conflicts.length > 0) {
          throw new Error('One or more members already belong to another team in this league.');
        }

        await tx
          .delete(schema.teamMembers)
          .where(eq(schema.teamMembers.team_id, id));

        if (roster.length > 0) {
          await tx.insert(schema.teamMembers).values(
            roster.map((entry) => ({
              team_id: id,
              member_id: entry.memberId,
              role: entry.role,
              is_skip: entry.isSkip ? 1 : 0,
              is_vice: entry.isVice ? 1 : 0,
            }))
          );
        }

        if (!team.name || team.name.trim().length === 0) {
          const memberNameMap = new Map<number, string>(existingMembers.map((entry) => [entry.id, entry.name]));
          const defaultName = computeDefaultTeamName(team.format, roster, memberNameMap);
          if (defaultName) {
            await tx
              .update(schema.leagueTeams)
              .set({ name: defaultName, updated_at: sql`CURRENT_TIMESTAMP` })
              .where(eq(schema.leagueTeams.id, id));
          }
        }
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid roster';
      return reply.code(400).send({ error: message });
    }

    return { success: true };
    }
  );

  // Member search (autocomplete)
  fastify.get(
    '/members/search',
    {
      schema: {
        tags: ['league-setup'],
        querystring: memberSearchQuerySchemaJson,
        response: {
          200: memberSearchResponseSchema,
        },
      },
    },
    async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { query, leagueId } = memberSearchQuerySchema.parse(request.query ?? {});

    if (leagueId) {
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } else if (!(await hasClubLeagueAdministratorAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const search = `%${query.toLowerCase()}%`;
    const { db, schema } = getDrizzleDb();

    const rows = (await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(
        or(
          sql`LOWER(${schema.members.name}) LIKE ${search}`,
          sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
        )
      )
      .orderBy(schema.members.name, desc(schema.members.id))
      .limit(20)) as { id: number; name: string; email: string | null }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
    }
  );
}
