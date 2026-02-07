import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { hasLeagueSetupAccess } from '../utils/leagueAccess.js';
import {
  teamByeRequestCreateBodySchema,
  teamByeRequestListResponseSchema,
  teamByeRequestsReplaceBodySchema,
  teamByeRequestUpdateBodySchema,
} from '../api/schedulingSchemas.js';
import { successResponseSchema } from '../api/schemas.js';
import { sendByeRequestsConfirmationEmail } from '../services/email.js';

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return typeof value === 'string' ? value : String(value ?? '');
}

function formatTimeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[1]?.slice(0, 5) ?? '';
  }
  if (typeof value === 'string') {
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value ?? '');
}

const byeRequestCreateSchema = z.object({
  teamId: z.number().int().positive(),
  drawDate: z.string().min(1),
  drawTime: z.string().min(1),
  priority: z.number().int().min(1),
  note: z.string().optional().nullable(),
});

const byeRequestUpdateSchema = z.object({
  drawDate: z.string().min(1).optional(),
  drawTime: z.string().min(1).optional(),
  priority: z.number().int().min(1).optional(),
  note: z.string().optional().nullable(),
});

const teamByeRequestsReplaceSchema = z.object({
  requests: z.array(
    z.object({
      drawDate: z.string().min(1),
      drawTime: z.string().min(1),
      priority: z.number().int().min(1),
    })
  ),
});

async function isMemberOnTeam(
  db: ReturnType<typeof getDrizzleDb>['db'],
  schema: ReturnType<typeof getDrizzleDb>['schema'],
  memberId: number,
  teamId: number
): Promise<boolean> {
  const rows = await db
    .select({ member_id: schema.teamMembers.member_id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.team_id, teamId), eq(schema.teamMembers.member_id, memberId)))
    .limit(1);
  return rows.length > 0;
}

export async function schedulingRoutes(fastify: FastifyInstance) {
  const { db, schema } = getDrizzleDb();

  // List bye requests for a league (all teams in league)
  fastify.get(
    '/leagues/:id/bye-requests',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: teamByeRequestListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const leagueId = parseInt((request.params as { id: string }).id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const teamIds = await db
        .select({ id: schema.leagueTeams.id })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.league_id, leagueId));
      const ids = teamIds.map((r) => r.id);
      if (ids.length === 0) {
        return [];
      }

      const rows = await db
        .select({
          id: schema.teamByeRequests.id,
          team_id: schema.teamByeRequests.team_id,
          draw_date: schema.teamByeRequests.draw_date,
          draw_time: schema.teamByeRequests.draw_time,
          priority: schema.teamByeRequests.priority,
          note: schema.teamByeRequests.note,
          created_at: schema.teamByeRequests.created_at,
          updated_at: schema.teamByeRequests.updated_at,
          team_name: schema.leagueTeams.name,
        })
        .from(schema.teamByeRequests)
        .innerJoin(schema.leagueTeams, eq(schema.teamByeRequests.team_id, schema.leagueTeams.id))
        .where(inArray(schema.teamByeRequests.team_id, ids))
        .orderBy(asc(schema.teamByeRequests.draw_date), asc(schema.teamByeRequests.draw_time), asc(schema.teamByeRequests.priority));

      return rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name ?? null,
        drawDate: formatDateValue(row.draw_date),
        drawTime: formatTimeValue(row.draw_time),
        priority: row.priority,
        note: row.note ?? null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      }));
    }
  );

  // Create bye request
  fastify.post(
    '/leagues/:id/bye-requests',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: teamByeRequestCreateBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const leagueId = parseInt((request.params as { id: string }).id, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = byeRequestCreateSchema.parse(request.body);
      const team = await db
        .select({ id: schema.leagueTeams.id, league_id: schema.leagueTeams.league_id })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.id, body.teamId))
        .limit(1);
      if (team.length === 0 || team[0].league_id !== leagueId) {
        return reply.code(400).send({ error: 'Team not found in this league' });
      }

      await db.insert(schema.teamByeRequests).values({
        team_id: body.teamId,
        draw_date: body.drawDate,
        draw_time: body.drawTime,
        priority: body.priority,
        note: body.note ?? null,
      });
      return { success: true };
    }
  );

  // Update bye request
  fastify.patch(
    '/leagues/:leagueId/bye-requests/:requestId',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leagueId: { type: 'string' },
            requestId: { type: 'string' },
          },
          required: ['leagueId', 'requestId'],
        },
        body: teamByeRequestUpdateBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { leagueId: leagueIdRaw, requestId: requestIdRaw } = request.params as {
        leagueId: string;
        requestId: string;
      };
      const leagueId = parseInt(leagueIdRaw, 10);
      const requestId = parseInt(requestIdRaw, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const body = byeRequestUpdateSchema.parse(request.body ?? {});

      const existing = await db
        .select({
          id: schema.teamByeRequests.id,
          team_id: schema.teamByeRequests.team_id,
          league_id: schema.leagueTeams.league_id,
        })
        .from(schema.teamByeRequests)
        .innerJoin(schema.leagueTeams, eq(schema.teamByeRequests.team_id, schema.leagueTeams.id))
        .where(eq(schema.teamByeRequests.id, requestId))
        .limit(1);
      if (existing.length === 0 || existing[0].league_id !== leagueId) {
        return reply.code(404).send({ error: 'Bye request not found' });
      }

      const updateValues: Record<string, unknown> = {};
      if (body.drawDate !== undefined) updateValues.draw_date = body.drawDate;
      if (body.drawTime !== undefined) updateValues.draw_time = body.drawTime;
      if (body.priority !== undefined) updateValues.priority = body.priority;
      if (body.note !== undefined) updateValues.note = body.note;
      if (Object.keys(updateValues).length > 0) {
        await db
          .update(schema.teamByeRequests)
          .set(updateValues as Record<string, string | number | null>)
          .where(eq(schema.teamByeRequests.id, requestId));
      }
      return { success: true };
    }
  );

  // Delete bye request
  fastify.delete(
    '/leagues/:leagueId/bye-requests/:requestId',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leagueId: { type: 'string' },
            requestId: { type: 'string' },
          },
          required: ['leagueId', 'requestId'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { leagueId: leagueIdRaw, requestId: requestIdRaw } = request.params as {
        leagueId: string;
        requestId: string;
      };
      const leagueId = parseInt(leagueIdRaw, 10);
      const requestId = parseInt(requestIdRaw, 10);
      if (!(await hasLeagueSetupAccess(member, leagueId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const existing = await db
        .select({ id: schema.teamByeRequests.id, team_id: schema.teamByeRequests.team_id })
        .from(schema.teamByeRequests)
        .innerJoin(schema.leagueTeams, eq(schema.teamByeRequests.team_id, schema.leagueTeams.id))
        .where(and(eq(schema.teamByeRequests.id, requestId), eq(schema.leagueTeams.league_id, leagueId)))
        .limit(1);
      if (existing.length === 0) {
        return reply.code(404).send({ error: 'Bye request not found' });
      }
      await db.delete(schema.teamByeRequests).where(eq(schema.teamByeRequests.id, requestId));
      return { success: true };
    }
  );

  // List bye requests for a specific team (team members or league manager)
  fastify.get(
    '/leagues/:leagueId/teams/:teamId/bye-requests',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leagueId: { type: 'string' },
            teamId: { type: 'string' },
          },
          required: ['leagueId', 'teamId'],
        },
        response: {
          200: teamByeRequestListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { leagueId: leagueIdRaw, teamId: teamIdRaw } = request.params as {
        leagueId: string;
        teamId: string;
      };
      const leagueId = parseInt(leagueIdRaw, 10);
      const teamId = parseInt(teamIdRaw, 10);

      const teamRow = await db
        .select({ id: schema.leagueTeams.id, league_id: schema.leagueTeams.league_id, name: schema.leagueTeams.name })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.id, teamId))
        .limit(1);
      if (teamRow.length === 0 || teamRow[0].league_id !== leagueId) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const canAccess =
        (await hasLeagueSetupAccess(member, leagueId)) || (await isMemberOnTeam(db, schema, member.id, teamId));
      if (!canAccess) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const rows = await db
        .select({
          id: schema.teamByeRequests.id,
          team_id: schema.teamByeRequests.team_id,
          draw_date: schema.teamByeRequests.draw_date,
          draw_time: schema.teamByeRequests.draw_time,
          priority: schema.teamByeRequests.priority,
          note: schema.teamByeRequests.note,
          created_at: schema.teamByeRequests.created_at,
          updated_at: schema.teamByeRequests.updated_at,
          team_name: schema.leagueTeams.name,
        })
        .from(schema.teamByeRequests)
        .innerJoin(schema.leagueTeams, eq(schema.teamByeRequests.team_id, schema.leagueTeams.id))
        .where(eq(schema.teamByeRequests.team_id, teamId))
        .orderBy(asc(schema.teamByeRequests.draw_date), asc(schema.teamByeRequests.draw_time), asc(schema.teamByeRequests.priority));

      return rows.map((row) => ({
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name ?? null,
        drawDate: formatDateValue(row.draw_date),
        drawTime: formatTimeValue(row.draw_time),
        priority: row.priority,
        note: row.note ?? null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      }));
    }
  );

  // Replace a team's bye requests (team members or league manager); sends confirmation email only when a team member updates
  fastify.put(
    '/leagues/:leagueId/teams/:teamId/bye-requests',
    {
      schema: {
        tags: ['scheduling'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            leagueId: { type: 'string' },
            teamId: { type: 'string' },
          },
          required: ['leagueId', 'teamId'],
        },
        body: teamByeRequestsReplaceBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { leagueId: leagueIdRaw, teamId: teamIdRaw } = request.params as {
        leagueId: string;
        teamId: string;
      };
      const leagueId = parseInt(leagueIdRaw, 10);
      const teamId = parseInt(teamIdRaw, 10);

      const onTeam = await isMemberOnTeam(db, schema, member.id, teamId);
      const isManager = await hasLeagueSetupAccess(member, leagueId);
      if (!onTeam && !isManager) {
        return reply.code(403).send({ error: 'You can only update bye requests for a team you are on, or as a league manager' });
      }

      const teamRow = await db
        .select({ id: schema.leagueTeams.id, league_id: schema.leagueTeams.league_id, name: schema.leagueTeams.name })
        .from(schema.leagueTeams)
        .where(eq(schema.leagueTeams.id, teamId))
        .limit(1);
      if (teamRow.length === 0 || teamRow[0].league_id !== leagueId) {
        return reply.code(404).send({ error: 'Team not found' });
      }

      const body = teamByeRequestsReplaceSchema.parse(request.body);
      const leagueRow = await db
        .select({ name: schema.leagues.name })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, leagueId))
        .limit(1);
      const leagueName = leagueRow[0]?.name ?? 'League';
      const teamName = teamRow[0]?.name ?? `Team ${teamId}`;

      await db.delete(schema.teamByeRequests).where(eq(schema.teamByeRequests.team_id, teamId));

      for (const r of body.requests) {
        await db.insert(schema.teamByeRequests).values({
          team_id: teamId,
          draw_date: r.drawDate,
          draw_time: r.drawTime,
          priority: r.priority,
          note: null,
        });
      }

      const requestsForEmail = body.requests.map((r) => ({
        drawDate: r.drawDate,
        drawTime: r.drawTime,
        priority: r.priority,
      }));

      if (onTeam) {
        const roster = await db
          .select({
            member_id: schema.teamMembers.member_id,
            name: schema.members.name,
            email: schema.members.email,
          })
          .from(schema.teamMembers)
          .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
          .where(eq(schema.teamMembers.team_id, teamId));

        for (const row of roster as { member_id: number; name: string; email: string | null }[]) {
          if (row.email) {
            sendByeRequestsConfirmationEmail(
              row.email,
              row.name,
              leagueName,
              teamName,
              requestsForEmail,
              member.name
            ).catch((err) => {
              console.error('Failed to send bye confirmation email to', row.email, err);
            });
          }
        }
      }

      return { success: true };
    }
  );
}
