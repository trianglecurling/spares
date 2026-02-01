import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, asc } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member, MemberAvailability } from '../types.js';

const setAvailabilitySchema = z.object({
  leagueId: z.number(),
  available: z.boolean(),
});

const setCanSkipSchema = z.object({
  canSkip: z.boolean(),
});

export async function availabilityRoutes(fastify: FastifyInstance) {
  // Get current member's availability
  fastify.get('/availability', async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const availability = await db
      .select()
      .from(schema.memberAvailability)
      .where(eq(schema.memberAvailability.member_id, member.id)) as MemberAvailability[];

    // Get can_skip value (should be same across all records for a member)
    const canSkip = availability.length > 0 ? availability[0].can_skip === 1 : false;

    return {
      canSkip,
      leagues: availability.map((a) => ({
        leagueId: a.league_id,
        available: a.available === 1,
      })),
    };
  });

  // Set availability for a league
  fastify.post('/availability/league', async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = setAvailabilitySchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Check if record exists
    const existing = await db
      .select()
      .from(schema.memberAvailability)
      .where(
        and(
          eq(schema.memberAvailability.member_id, member.id),
          eq(schema.memberAvailability.league_id, body.leagueId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.memberAvailability)
        .set({
          available: body.available ? 1 : 0,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(schema.memberAvailability.member_id, member.id),
            eq(schema.memberAvailability.league_id, body.leagueId)
          )
        );
    } else {
      // Get existing can_skip value from any other record for this member
      const existingRecords = await db
        .select({ can_skip: schema.memberAvailability.can_skip })
        .from(schema.memberAvailability)
        .where(eq(schema.memberAvailability.member_id, member.id))
        .limit(1);
      
      const canSkipValue = existingRecords.length > 0 ? existingRecords[0].can_skip : 0;

      await db.insert(schema.memberAvailability).values({
        member_id: member.id,
        league_id: body.leagueId,
        available: body.available ? 1 : 0,
        can_skip: canSkipValue,
      });
    }

    return { success: true };
  });

  // Set can skip preference
  fastify.post('/availability/can-skip', async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = setCanSkipSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Check if member has any availability records
    const existingRecords = await db
      .select()
      .from(schema.memberAvailability)
      .where(eq(schema.memberAvailability.member_id, member.id))
      .limit(1);

    if (existingRecords.length > 0) {
      // Update all existing availability records for this member
      await db
        .update(schema.memberAvailability)
        .set({
          can_skip: body.canSkip ? 1 : 0,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.memberAvailability.member_id, member.id));
    } else {
      // No records exist - create records for all leagues with can_skip set
      const leagues = await db
        .select()
        .from(schema.leagues);

      if (leagues.length > 0) {
        await db.insert(schema.memberAvailability).values(
          leagues.map((league) => ({
            member_id: member.id,
            league_id: league.id,
            available: 0,
            can_skip: body.canSkip ? 1 : 0,
          }))
        );
      }
    }

    return { success: true };
  });

  // Get a specific member's availability
  fastify.get('/members/:memberId/availability', async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { memberId } = request.params as { memberId: string };
    const targetMemberId = parseInt(memberId, 10);
    const { db, schema } = getDrizzleDb();

    // Get the target member's availability
    const availability = await db
      .select({
        league_id: schema.memberAvailability.league_id,
        available: schema.memberAvailability.available,
        can_skip: schema.memberAvailability.can_skip,
        league_name: schema.leagues.name,
        league_day_of_week: schema.leagues.day_of_week,
      })
      .from(schema.memberAvailability)
      .innerJoin(
        schema.leagues,
        eq(schema.memberAvailability.league_id, schema.leagues.id)
      )
      .where(eq(schema.memberAvailability.member_id, targetMemberId))
      .orderBy(schema.leagues.day_of_week, schema.leagues.name);

    // Get can_skip value (should be same across all records for a member)
    const canSkip = availability.length > 0 ? availability[0].can_skip === 1 : false;

    // Get only leagues where member is available
    const availableLeagues = availability
      .filter((a) => a.available === 1)
      .map((a) => ({
        leagueId: a.league_id,
        leagueName: a.league_name,
        dayOfWeek: a.league_day_of_week,
      }));

    return {
      canSkip,
      availableLeagues,
    };
  });

  // Get members available for a specific league
  fastify.get('/availability/league/:leagueId/members', async (request, reply) => {
    const member = request.member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { leagueId } = request.params as { leagueId: string };
    const leagueIdNum = parseInt(leagueId, 10);
    const { position } = request.query as { position?: string };
    const { db, schema } = getDrizzleDb();

    // Build where conditions
    const conditions = [
      eq(schema.memberAvailability.league_id, leagueIdNum),
      eq(schema.memberAvailability.available, 1),
      sql`${schema.members.id} != ${member.id}`,
    ];
    
    // If position is skip, only show members who can skip
    if (position === 'skip') {
      conditions.push(eq(schema.memberAvailability.can_skip, 1));
    }
    
    const availableMembers = await db
      .select({
        id: schema.members.id,
        name: schema.members.name,
        email: schema.members.email,
      })
      .from(schema.members)
      .innerJoin(
        schema.memberAvailability,
        eq(schema.members.id, schema.memberAvailability.member_id)
      )
      .where(and(...conditions))
      .orderBy(asc(schema.members.name));

    return availableMembers.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
    }));
  });
}

