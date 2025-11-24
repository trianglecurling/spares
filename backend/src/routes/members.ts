import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql, inArray, desc } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin } from '../utils/auth.js';
import { Member } from '../types.js';
import { sendWelcomeEmail } from '../services/email.js';
import { generateToken, generateEmailLinkToken } from '../utils/auth.js';

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  optedInSms: z.boolean().optional(),
});

const createMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  isAdmin: z.boolean().optional(),
});

const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  isAdmin: z.boolean().optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.number()).min(1),
});

const bulkCreateSchema = z.array(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  })
).min(1);

export async function memberRoutes(fastify: FastifyInstance) {
  // Get current member profile
  fastify.get('/members/me', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    return {
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      isAdmin: isAdmin(member),
      firstLoginCompleted: member.first_login_completed === 1,
      optedInSms: member.opted_in_sms === 1,
      emailSubscribed: member.email_subscribed === 1,
    };
  });

  // Update current member profile
  fastify.patch('/members/me', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = updateProfileSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const updateData: any = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.email !== undefined) {
      updateData.email = body.email;
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone;
    }
    if (body.optedInSms !== undefined) {
      updateData.opted_in_sms = body.optedInSms ? 1 : 0;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.members)
        .set(updateData)
        .where(eq(schema.members.id, member.id));
    }

    const updatedMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, member.id))
      .limit(1);
    
    const updatedMember = updatedMembers[0] as Member;

    return {
      id: updatedMember.id,
      name: updatedMember.name,
      email: updatedMember.email,
      phone: updatedMember.phone,
      isAdmin: isAdmin(updatedMember),
      firstLoginCompleted: updatedMember.first_login_completed === 1,
      optedInSms: updatedMember.opted_in_sms === 1,
      emailSubscribed: updatedMember.email_subscribed === 1,
    };
  });

  // Complete first login
  fastify.post('/members/me/complete-first-login', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    await db
      .update(schema.members)
      .set({ first_login_completed: 1 })
      .where(eq(schema.members.id, member.id));

    return { success: true };
  });

  // Unsubscribe from emails
  fastify.post('/members/me/unsubscribe', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    
    // Unsubscribe from emails and remove all availability
    await db
      .update(schema.members)
      .set({ email_subscribed: 0 })
      .where(eq(schema.members.id, member.id));
    await db
      .delete(schema.memberAvailability)
      .where(eq(schema.memberAvailability.member_id, member.id));

    return { success: true };
  });

  // Get all members (filtered for non-admins)
  fastify.get('/members', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const members = await db
      .select()
      .from(schema.members)
      .orderBy(schema.members.name) as Member[];

    const isCurrentUserAdmin = isAdmin(member);

    return members.map((m) => {
      // Basic info always visible
      const response: any = {
        id: m.id,
        name: m.name,
        isAdmin: isAdmin(m),
        emailSubscribed: m.email_subscribed === 1,
        optedInSms: m.opted_in_sms === 1,
        emailVisible: m.email_visible === 1,
        phoneVisible: m.phone_visible === 1,
      };

      // Sensitive info visibility logic
      if (isCurrentUserAdmin || m.id === member.id) {
        // Admins and self see everything
        response.email = m.email;
        response.phone = m.phone;
        response.createdAt = m.created_at;
      } else {
        // Others see based on privacy settings
        response.email = m.email_visible === 1 ? m.email : null;
        response.phone = m.phone_visible === 1 ? m.phone : null;
      }

      return response;
    });
  });

  // Admin: Create member
  fastify.post('/members', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createMemberSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const result = await db
      .insert(schema.members)
      .values({
        name: body.name,
        email: body.email,
        phone: body.phone || null,
        is_admin: body.isAdmin ? 1 : 0,
        opted_in_sms: 0,
        email_subscribed: 1,
        first_login_completed: 0,
        email_visible: 0,
        phone_visible: 0,
      })
      .returning();

    const newMember = result[0] as Member;

    return {
      id: newMember.id,
      name: newMember.name,
      email: newMember.email,
      phone: newMember.phone,
      isAdmin: isAdmin(newMember),
      emailSubscribed: newMember.email_subscribed === 1,
      optedInSms: newMember.opted_in_sms === 1,
    };
  });

  // Admin: Bulk create members
  fastify.post('/members/bulk', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkCreateSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Use a transaction to ensure atomicity
    const insertedIds = await db.transaction(async (tx: any) => {
      const ids: number[] = [];
      
      for (const memberData of body) {
        const result = await tx
          .insert(schema.members)
          .values({
            name: memberData.name,
            email: memberData.email,
            phone: memberData.phone || null,
            is_admin: 0,
            opted_in_sms: 0,
            email_subscribed: 1,
            first_login_completed: 0,
            email_visible: 0,
            phone_visible: 0,
          })
          .returning();
        
        ids.push(result[0].id);
      }
      
      return ids;
    });

    return {
      success: true,
      count: insertedIds.length,
      ids: insertedIds,
    };
  });

  // Admin: Update member
  fastify.patch('/members/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const memberId = parseInt(id, 10);
    const body = updateMemberSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);

    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    const updateData: any = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.email !== undefined) {
      updateData.email = body.email;
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone;
    }
    if (body.isAdmin !== undefined) {
      updateData.is_admin = body.isAdmin ? 1 : 0;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.members)
        .set(updateData)
        .where(eq(schema.members.id, memberId));
    }

    const updatedMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const updatedMember = updatedMembers[0] as Member;

    return {
      id: updatedMember.id,
      name: updatedMember.name,
      email: updatedMember.email,
      phone: updatedMember.phone,
      isAdmin: isAdmin(updatedMember),
      emailSubscribed: updatedMember.email_subscribed === 1,
      optedInSms: updatedMember.opted_in_sms === 1,
    };
  });

  // Admin: Delete member
  fastify.delete('/members/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    await db
      .delete(schema.members)
      .where(eq(schema.members.id, memberId));

    return { success: true };
  });

  // Admin: Bulk delete members
  fastify.post('/members/bulk-delete', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkDeleteSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get all members to check for admins
    const membersToDelete = await db
      .select({ id: schema.members.id, is_admin: schema.members.is_admin })
      .from(schema.members)
      .where(inArray(schema.members.id, body.ids));

    // Filter out admins
    const nonAdminIds = membersToDelete
      .filter((m: any) => m.is_admin === 0)
      .map((m: any) => m.id);

    if (nonAdminIds.length === 0) {
      return reply.code(400).send({ error: 'No non-admin members to delete' });
    }

    // Use a transaction to ensure atomicity
    await db.transaction(async (tx: any) => {
      // Delete related data first (cascade should handle most, but be explicit)
      await tx
        .delete(schema.memberAvailability)
        .where(inArray(schema.memberAvailability.member_id, nonAdminIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.requester_id, nonAdminIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.filled_by_member_id, nonAdminIds));
      
      await tx
        .delete(schema.spareRequestInvitations)
        .where(inArray(schema.spareRequestInvitations.member_id, nonAdminIds));
      
      await tx
        .delete(schema.spareResponses)
        .where(inArray(schema.spareResponses.member_id, nonAdminIds));
      
      // Finally delete the members
      await tx
        .delete(schema.members)
        .where(inArray(schema.members.id, nonAdminIds));
    });

    return { success: true, deletedCount: nonAdminIds.length };
  });

  // Admin: Send welcome email
  fastify.post('/members/:id/send-welcome', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember || !targetMember.email) {
      return reply.code(404).send({ error: 'Member not found or has no email' });
    }

    const token = generateEmailLinkToken(targetMember);
    await sendWelcomeEmail(targetMember.email, targetMember.name, token);

    return { success: true };
  });
}

