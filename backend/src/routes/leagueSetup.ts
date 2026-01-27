import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { hasClubLeagueManagerAccess, hasLeagueManagerAccess } from '../utils/leagueAccess.js';

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

export async function leagueSetupRoutes(fastify: FastifyInstance) {
  // Sheets
  fastify.get('/sheets', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const sheets = await db
      .select()
      .from(schema.sheets)
      .orderBy(schema.sheets.sort_order, schema.sheets.name);

    return sheets.map((sheet: any) => ({
      id: sheet.id,
      name: sheet.name,
      sortOrder: sheet.sort_order,
      isActive: sheet.is_active === 1,
      createdAt: sheet.created_at,
      updatedAt: sheet.updated_at,
    }));
  });

  fastify.post('/sheets', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !(await hasClubLeagueManagerAccess(member))) {
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
  });

  fastify.patch('/sheets/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !(await hasClubLeagueManagerAccess(member))) {
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
  });

  fastify.delete('/sheets/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !(await hasClubLeagueManagerAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const sheetId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    await db.delete(schema.sheets).where(eq(schema.sheets.id, sheetId));
    return { success: true };
  });

  // Divisions
  fastify.get('/leagues/:id/divisions', async (request, reply) => {
    const member = (request as any).member as Member;
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
      .orderBy(schema.leagueDivisions.sort_order, schema.leagueDivisions.name);

    return divisions.map((division: any) => ({
      id: division.id,
      leagueId: division.league_id,
      name: division.name,
      sortOrder: division.sort_order,
      isDefault: division.is_default === 1,
    }));
  });

  fastify.post('/leagues/:id/divisions', async (request, reply) => {
    const member = (request as any).member as Member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueManagerAccess(member, leagueId))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = divisionCreateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const existingDivisions = await db
      .select({ id: schema.leagueDivisions.id, is_default: schema.leagueDivisions.is_default })
      .from(schema.leagueDivisions)
      .where(eq(schema.leagueDivisions.league_id, leagueId));

    const shouldBeDefault = body.isDefault === true || existingDivisions.length === 0;

    const result = await db
      .insert(schema.leagueDivisions)
      .values({
        league_id: leagueId,
        name: body.name.trim(),
        sort_order: body.sortOrder ?? 0,
        is_default: shouldBeDefault ? 1 : 0,
      })
      .returning();

    const division = result[0];

    if (shouldBeDefault) {
      await db
        .update(schema.leagueDivisions)
        .set({ is_default: 0 })
        .where(
          and(
            eq(schema.leagueDivisions.league_id, leagueId),
            ne(schema.leagueDivisions.id, division.id)
          )
        );
    }

    return {
      id: division.id,
      leagueId: division.league_id,
      name: division.name,
      sortOrder: division.sort_order,
      isDefault: division.is_default === 1,
    };
  });

  fastify.patch('/leagues/:leagueId/divisions/:divisionId', async (request, reply) => {
    const member = (request as any).member as Member;
    const { leagueId: leagueIdRaw, divisionId: divisionIdRaw } = request.params as {
      leagueId: string;
      divisionId: string;
    };
    const leagueId = parseInt(leagueIdRaw, 10);
    const divisionId = parseInt(divisionIdRaw, 10);

    if (!member || !(await hasLeagueManagerAccess(member, leagueId))) {
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

    if (body.isDefault !== undefined) {
      if (!body.isDefault && division.is_default === 1) {
        const otherDefaults = await db
          .select({ id: schema.leagueDivisions.id })
          .from(schema.leagueDivisions)
          .where(
            and(
              eq(schema.leagueDivisions.league_id, leagueId),
              ne(schema.leagueDivisions.id, divisionId),
              eq(schema.leagueDivisions.is_default, 1)
            )
          )
          .limit(1);

        if (otherDefaults.length === 0) {
          return reply.code(400).send({ error: 'A league must have a default division.' });
        }

        updateData.is_default = 0;
      } else {
        updateData.is_default = 1;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updateData.updated_at = sql`CURRENT_TIMESTAMP`;
    await db.update(schema.leagueDivisions).set(updateData).where(eq(schema.leagueDivisions.id, divisionId));

    if (body.isDefault === true) {
      await db
        .update(schema.leagueDivisions)
        .set({ is_default: 0 })
        .where(
          and(
            eq(schema.leagueDivisions.league_id, leagueId),
            ne(schema.leagueDivisions.id, divisionId)
          )
        );
    }

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
  });

  fastify.delete('/leagues/:leagueId/divisions/:divisionId', async (request, reply) => {
    const member = (request as any).member as Member;
    const { leagueId: leagueIdRaw, divisionId: divisionIdRaw } = request.params as {
      leagueId: string;
      divisionId: string;
    };
    const leagueId = parseInt(leagueIdRaw, 10);
    const divisionId = parseInt(divisionIdRaw, 10);

    if (!member || !(await hasLeagueManagerAccess(member, leagueId))) {
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

    if (division.is_default === 1) {
      const remaining = await db
        .select({ id: schema.leagueDivisions.id })
        .from(schema.leagueDivisions)
        .where(eq(schema.leagueDivisions.league_id, leagueId))
        .orderBy(schema.leagueDivisions.sort_order, schema.leagueDivisions.name)
        .limit(1);

      if (remaining.length > 0) {
        await db
          .update(schema.leagueDivisions)
          .set({ is_default: 1 })
          .where(eq(schema.leagueDivisions.id, remaining[0].id));
      }
    }

    return { success: true };
  });

  // Teams and rosters
  fastify.get('/leagues/:id/teams', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const teams = await db
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
      .orderBy(schema.leagueDivisions.sort_order, schema.leagueTeams.name);

    const teamIds = teams.map((team) => team.id);
    const rosterRows = teamIds.length
      ? await db
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
          .orderBy(schema.teamMembers.team_id, schema.teamMembers.role)
      : [];

    const rosterByTeam = new Map<number, any[]>();
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
  });

  fastify.post('/leagues/:id/teams', async (request, reply) => {
    const member = (request as any).member as Member;
    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);

    if (!member || !(await hasLeagueManagerAccess(member, leagueId))) {
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
        await db.transaction(async (tx: any) => {
          await tx
            .delete(schema.teamMembers)
            .where(eq(schema.teamMembers.team_id, team.id));

          const memberIds = roster.map((entry) => entry.memberId);
          const existingMembers = await tx
            .select({ id: schema.members.id, name: schema.members.name })
            .from(schema.members)
            .where(inArray(schema.members.id, memberIds));

          if (existingMembers.length !== memberIds.length) {
            throw new Error('One or more roster members do not exist.');
          }

          const memberNameMap = new Map(existingMembers.map((entry) => [entry.id, entry.name]));

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
      } catch (error: any) {
        return reply.code(400).send({ error: error?.message || 'Invalid roster' });
      }
    }

    return {
      id: team.id,
      leagueId: team.league_id,
      divisionId: team.division_id,
      name: team.name,
    };
  });

  fastify.patch('/teams/:teamId', async (request, reply) => {
    const member = (request as any).member as Member;
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

    if (!member || !(await hasLeagueManagerAccess(member, team.league_id))) {
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
  });

  fastify.delete('/teams/:teamId', async (request, reply) => {
    const member = (request as any).member as Member;
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

    if (!member || !(await hasLeagueManagerAccess(member, team.league_id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await db.delete(schema.leagueTeams).where(eq(schema.leagueTeams.id, id));
    return { success: true };
  });

  fastify.get('/teams/:teamId/roster', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { teamId } = request.params as { teamId: string };
    const id = parseInt(teamId, 10);
    const { db, schema } = getDrizzleDb();

    const roster = await db
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
      .orderBy(schema.teamMembers.role);

    return roster.map((entry) => ({
      memberId: entry.member_id,
      name: entry.member_name,
      role: entry.role,
      isSkip: entry.is_skip === 1,
      isVice: entry.is_vice === 1,
    }));
  });

  fastify.put('/teams/:teamId/roster', async (request, reply) => {
    const member = (request as any).member as Member;
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

    if (!member || !(await hasLeagueManagerAccess(member, team.league_id))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    try {
      const roster = validateRoster(team.format, body.members);
      const memberIds = roster.map((entry) => entry.memberId);

      await db.transaction(async (tx: any) => {
        const existingMembers = await tx
          .select({ id: schema.members.id, name: schema.members.name })
          .from(schema.members)
          .where(inArray(schema.members.id, memberIds));

        if (existingMembers.length !== memberIds.length) {
          throw new Error('One or more roster members do not exist.');
        }

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
          const memberNameMap = new Map(existingMembers.map((entry) => [entry.id, entry.name]));
          const defaultName = computeDefaultTeamName(team.format, roster, memberNameMap);
          if (defaultName) {
            await tx
              .update(schema.leagueTeams)
              .set({ name: defaultName, updated_at: sql`CURRENT_TIMESTAMP` })
              .where(eq(schema.leagueTeams.id, id));
          }
        }
      });
    } catch (error: any) {
      return reply.code(400).send({ error: error?.message || 'Invalid roster' });
    }

    return { success: true };
  });

  // Member search (autocomplete)
  fastify.get('/members/search', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { query, leagueId } = memberSearchQuerySchema.parse((request as any).query || {});

    if (leagueId) {
      if (!(await hasLeagueManagerAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } else if (!(await hasClubLeagueManagerAccess(member))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const search = `%${query.toLowerCase()}%`;
    const { db, schema } = getDrizzleDb();

    const rows = await db
      .select({ id: schema.members.id, name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(
        or(
          sql`LOWER(${schema.members.name}) LIKE ${search}`,
          sql`LOWER(COALESCE(${schema.members.email}, '')) LIKE ${search}`
        )
      )
      .orderBy(schema.members.name, desc(schema.members.id))
      .limit(20);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }));
  });
}
