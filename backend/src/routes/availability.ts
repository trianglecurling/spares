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
    const member = (request as any).member as Member;
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
    const member = (request as any).member as Member;
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
      await db.insert(schema.memberAvailability).values({
        member_id: member.id,
        league_id: body.leagueId,
        available: body.available ? 1 : 0,
        can_skip: 0,
      });
    }

    return { success: true };
  });

  // Set can skip preference
  fastify.post('/availability/can-skip', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = setCanSkipSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Update all availability records for this member
    await db
      .update(schema.memberAvailability)
      .set({
        can_skip: body.canSkip ? 1 : 0,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.memberAvailability.member_id, member.id));

    return { success: true };
  });

  // Get members available for a specific league
  fastify.get('/availability/league/:leagueId/members', async (request, reply) => {
    const member = (request as any).member as Member;
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

    return availableMembers.map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email,
    }));
  });
}

