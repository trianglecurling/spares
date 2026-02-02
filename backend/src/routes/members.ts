import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin, isServerAdmin, isInServerAdminsList } from '../utils/auth.js';
import { Member } from '../types.js';
import {
  bulkCreateResponseSchema,
  bulkDeleteResponseSchema,
  bulkSendWelcomeResponseSchema,
  loginLinkResponseSchema,
  memberCreateResponseSchema,
  memberListResponseSchema,
  memberProfileResponseSchema,
  memberUpdateResponseSchema,
  successResponseSchema,
} from '../api/schemas.js';
import type {
  ApiErrorResponse,
  BulkCreateBody,
  BulkCreateResponse,
  BulkDeleteBody,
  BulkDeleteResponse,
  BulkSendWelcomeResponse,
  CreateMemberBody,
  LoginLinkResponse,
  MemberCreateResponse,
  MemberProfileResponse,
  MemberSummaryResponse,
  MemberUpdateResponse,
  UpdateMemberBody,
  UpdateProfileBody,
} from '../api/types.js';
import { sendWelcomeEmail } from '../services/email.js';
import { generateEmailLinkToken } from '../utils/auth.js';
import { config } from '../config.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  optedInSms: z.boolean().optional(),
  emailVisible: z.boolean().optional(),
  phoneVisible: z.boolean().optional(),
  themePreference: z.enum(['light', 'dark', 'system']).optional(),
});

const createMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  validThrough: z.string().nullable().optional(),
  spareOnly: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  isServerAdmin: z.boolean().optional(),
});

const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  validThrough: z.string().nullable().optional(),
  spareOnly: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  isServerAdmin: z.boolean().optional(),
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

const bulkCreateRequestSchema = z.union([
  bulkCreateSchema,
  z.object({
    members: bulkCreateSchema,
    validThrough: z.string().nullable().optional(),
    spareOnly: z.boolean().optional(),
  }),
]);

const directoryQuerySchema = z.object({
  leagueId: z.coerce.number().int().positive().optional(),
});

const updateProfileBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    optedInSms: { type: 'boolean' },
    emailVisible: { type: 'boolean' },
    phoneVisible: { type: 'boolean' },
    themePreference: { type: 'string', enum: ['light', 'dark', 'system'] },
  },
} as const;

const createMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    validThrough: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
  },
  required: ['name', 'email'],
} as const;

const updateMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string' },
    phone: { type: 'string' },
    validThrough: { type: ['string', 'null'] },
    spareOnly: { type: 'boolean' },
    isAdmin: { type: 'boolean' },
    isServerAdmin: { type: 'boolean' },
  },
} as const;

const bulkDeleteBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ids: { type: 'array', items: { type: 'number' }, minItems: 1 },
  },
  required: ['ids'],
} as const;

const bulkCreateBodySchema = {
  oneOf: [
    {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name', 'email'],
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        members: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1 },
              email: { type: 'string' },
              phone: { type: 'string' },
            },
            required: ['name', 'email'],
          },
          minItems: 1,
        },
        validThrough: { type: ['string', 'null'] },
        spareOnly: { type: 'boolean' },
      },
      required: ['members'],
    },
  ],
} as const;

const directoryQuerySchemaJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leagueId: { type: 'number' },
  },
} as const;

interface MemberUpdateData {
  name?: string;
  email?: string;
  phone?: string | null;
  valid_through?: string | null;
  spare_only?: number;
  opted_in_sms?: number;
  email_visible?: number;
  phone_visible?: number;
  theme_preference?: string;
  is_admin?: number;
  is_server_admin?: number;
  updated_at?: ReturnType<typeof sql>;
}

function normalizeDateString(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function normalizeTimestamp(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isMemberExpired(member: Member): boolean {
  // Admins/server-admins are always valid
  if (isAdmin(member) || isServerAdmin(member)) return false;

  const validThrough = normalizeDateString(member.valid_through);
  if (!validThrough) return false;

  // Compare as YYYY-MM-DD to avoid TZ issues. Valid through is inclusive.
  const today = new Date().toISOString().split('T')[0];
  return today > validThrough;
}

export async function memberRoutes(fastify: FastifyInstance) {
  // Get current member profile
  fastify.get<{ Reply: MemberProfileResponse | ApiErrorResponse }>(
    '/members/me',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberProfileResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    return {
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      validThrough: normalizeDateString(member.valid_through),
      spareOnly: member.spare_only === 1,
      isAdmin: isAdmin(member),
      isServerAdmin: isServerAdmin(member),
      firstLoginCompleted: member.first_login_completed === 1,
      optedInSms: member.opted_in_sms === 1,
      emailSubscribed: member.email_subscribed === 1,
      emailVisible: member.email_visible === 1,
      phoneVisible: member.phone_visible === 1,
      themePreference: member.theme_preference || 'system',
    };
    }
  );

  // Update current member profile
  fastify.patch<{ Body: UpdateProfileBody; Reply: MemberProfileResponse | ApiErrorResponse }>(
    '/members/me',
    {
      schema: {
        tags: ['members'],
        body: updateProfileBodySchema,
        response: {
          200: memberProfileResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    const body = updateProfileSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const updateData: MemberUpdateData = {};

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
    if (body.emailVisible !== undefined) {
      updateData.email_visible = body.emailVisible ? 1 : 0;
    }
    if (body.phoneVisible !== undefined) {
      updateData.phone_visible = body.phoneVisible ? 1 : 0;
    }
    if (body.themePreference !== undefined) {
      updateData.theme_preference = body.themePreference;
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
      validThrough: normalizeDateString(updatedMember.valid_through),
      spareOnly: updatedMember.spare_only === 1,
      isAdmin: isAdmin(updatedMember),
      isServerAdmin: isServerAdmin(updatedMember),
      firstLoginCompleted: updatedMember.first_login_completed === 1,
      optedInSms: updatedMember.opted_in_sms === 1,
      emailSubscribed: updatedMember.email_subscribed === 1,
      emailVisible: updatedMember.email_visible === 1,
      phoneVisible: updatedMember.phone_visible === 1,
      themePreference: updatedMember.theme_preference || 'system',
    };
    }
  );

  // Complete first login
  fastify.post<{ Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/me/complete-first-login',
    {
      schema: {
        tags: ['members'],
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    const { db, schema } = getDrizzleDb();
    await db
      .update(schema.members)
      .set({ first_login_completed: 1 })
      .where(eq(schema.members.id, member.id));

    return { success: true };
    }
  );

  // Unsubscribe from emails
  fastify.post<{ Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/me/unsubscribe',
    {
      schema: {
        tags: ['members'],
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

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
    }
  );

  // Get all members (filtered for non-admins)
  fastify.get<{ Reply: MemberSummaryResponse[] | ApiErrorResponse }>(
    '/members',
    {
      schema: {
        tags: ['members'],
        response: {
          200: memberListResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    const { db, schema } = getDrizzleDb();
    const members = await db
      .select()
      .from(schema.members)
      .orderBy(schema.members.name) as Member[];

    const isCurrentUserAdmin = isAdmin(member);

    return members.map((m) => {
      // Basic info always visible
      // Ensure proper boolean conversion
      const response: MemberSummaryResponse = {
        id: m.id,
        name: m.name,
        isAdmin: isAdmin(m),
        isServerAdmin: isServerAdmin(m),
        isInServerAdminsList: isInServerAdminsList(m),
        emailSubscribed: Boolean(m.email_subscribed === 1),
        optedInSms: Boolean(m.opted_in_sms === 1),
        emailVisible: Boolean(m.email_visible === 1),
        phoneVisible: Boolean(m.phone_visible === 1),
        firstLoginCompleted: Boolean(m.first_login_completed === 1),
      };

      // Sensitive info visibility logic
      if (isCurrentUserAdmin || m.id === member.id) {
        // Admins and self see everything
        response.email = m.email;
        response.phone = m.phone;
        response.createdAt = normalizeTimestamp(m.created_at);
        response.validThrough = normalizeDateString(m.valid_through);
        response.spareOnly = m.spare_only === 1;
      } else {
        // Others see based on privacy settings
        response.email = m.email_visible === 1 ? m.email : null;
        response.phone = m.phone_visible === 1 ? m.phone : null;
      }

      return response;
    });
    }
  );

  // Directory: active members only (expired members excluded)
  fastify.get<{ Querystring: { leagueId?: number }; Reply: MemberSummaryResponse[] | ApiErrorResponse }>(
    '/members/directory',
    {
      schema: {
        tags: ['members'],
        querystring: directoryQuerySchemaJson,
        response: {
          200: memberListResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;

    const { db, schema } = getDrizzleDb();
    const { leagueId } = directoryQuerySchema.parse(request.query ?? {});

    // Explicit selection so joins don't create ambiguous column names
    const memberSelect = {
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      phone: schema.members.phone,
      valid_through: schema.members.valid_through,
      spare_only: schema.members.spare_only,
      is_admin: schema.members.is_admin,
      is_server_admin: schema.members.is_server_admin,
      opted_in_sms: schema.members.opted_in_sms,
      email_subscribed: schema.members.email_subscribed,
      first_login_completed: schema.members.first_login_completed,
      email_visible: schema.members.email_visible,
      phone_visible: schema.members.phone_visible,
      theme_preference: schema.members.theme_preference,
      created_at: schema.members.created_at,
      updated_at: schema.members.updated_at,
    };

    let members: Member[];
    if (leagueId) {
      members = await db
        .select(memberSelect)
        .from(schema.members)
        .innerJoin(
          schema.memberAvailability,
          eq(schema.memberAvailability.member_id, schema.members.id)
        )
        .where(
          and(
            eq(schema.memberAvailability.league_id, leagueId),
            eq(schema.memberAvailability.available, 1)
          )
        )
        .orderBy(schema.members.name) as unknown as Member[];
    } else {
      members = await db
        .select(memberSelect)
        .from(schema.members)
        .orderBy(schema.members.name) as unknown as Member[];
    }

    const isCurrentUserAdmin = isAdmin(member);
    const activeMembers = members.filter((m) => !isMemberExpired(m));

    return activeMembers.map((m) => {
      const response: MemberSummaryResponse = {
        id: m.id,
        name: m.name,
        isAdmin: isAdmin(m),
        isServerAdmin: isServerAdmin(m),
        isInServerAdminsList: isInServerAdminsList(m),
        emailSubscribed: Boolean(m.email_subscribed === 1),
        optedInSms: Boolean(m.opted_in_sms === 1),
        emailVisible: Boolean(m.email_visible === 1),
        phoneVisible: Boolean(m.phone_visible === 1),
        firstLoginCompleted: Boolean(m.first_login_completed === 1),
      };

      if (isCurrentUserAdmin || m.id === member.id) {
        response.email = m.email;
        response.phone = m.phone;
        response.createdAt = normalizeTimestamp(m.created_at);
        response.validThrough = normalizeDateString(m.valid_through);
      } else {
        response.email = m.email_visible === 1 ? m.email : null;
        response.phone = m.phone_visible === 1 ? m.phone : null;
      }

      return response;
    });
    }
  );

  // Admin: Create member
  fastify.post<{ Body: CreateMemberBody; Reply: MemberCreateResponse | ApiErrorResponse }>(
    '/members',
    {
      schema: {
        tags: ['members'],
        body: createMemberBodySchema,
        response: {
          200: memberCreateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member || !isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createMemberSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Only server admins can create server admins
    if (body.isServerAdmin && !isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Only server admins can create server admins' });
    }

    const result = await db
      .insert(schema.members)
      .values({
        name: body.name,
        email: body.email,
        phone: body.phone || null,
        valid_through: body.validThrough ?? null,
        spare_only: body.spareOnly ? 1 : 0,
        is_admin: body.isAdmin ? 1 : 0,
        is_server_admin: body.isServerAdmin ? 1 : 0,
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
      validThrough: normalizeDateString(newMember.valid_through),
      spareOnly: newMember.spare_only === 1,
      isAdmin: isAdmin(newMember),
      emailSubscribed: newMember.email_subscribed === 1,
      optedInSms: newMember.opted_in_sms === 1,
    };
    }
  );

  // Admin: Bulk create members
  fastify.post<{ Body: BulkCreateBody; Reply: BulkCreateResponse | ApiErrorResponse }>(
    '/members/bulk',
    {
      schema: {
        tags: ['members'],
        body: bulkCreateBodySchema,
        response: {
          200: bulkCreateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const parsed = bulkCreateRequestSchema.parse(request.body);
    const body = Array.isArray(parsed) ? parsed : parsed.members;
    const bulkValidThrough = Array.isArray(parsed) ? undefined : (parsed.validThrough ?? undefined);
    const bulkSpareOnly = Array.isArray(parsed) ? undefined : (parsed.spareOnly ?? undefined);
    const { db, schema } = getDrizzleDb();

    // Use a transaction to ensure atomicity
    const insertedIds = await db.transaction(async (tx) => {
      const ids: number[] = [];
      
      for (const memberData of body) {
        const result = await tx
          .insert(schema.members)
          .values({
            name: memberData.name,
            email: memberData.email,
            phone: memberData.phone || null,
            valid_through: bulkValidThrough === undefined ? null : bulkValidThrough,
            spare_only: bulkSpareOnly ? 1 : 0,
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
      return {
        success: true,
        count: insertedIds.length,
        ids: insertedIds,
      };
    }
  );

  // Admin: Update member
  fastify.patch<{ Params: { id: string }; Body: UpdateMemberBody; Reply: MemberUpdateResponse | ApiErrorResponse }>(
    '/members/:id',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: updateMemberBodySchema,
        response: {
          200: memberUpdateResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
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
      return _reply.code(404).send({ error: 'Member not found' });
    }

    // Prevent users from changing their own role
    if (memberId === member.id && (body.isAdmin !== undefined || body.isServerAdmin !== undefined)) {
      return _reply.code(400).send({ error: 'You cannot change your own role' });
    }
    // Prevent users from changing their own valid-through date
    if (memberId === member.id && body.validThrough !== undefined) {
      return _reply.code(400).send({ error: 'You cannot change your own valid through date' });
    }
    // Prevent users from changing their own spare-only flag
    if (memberId === member.id && body.spareOnly !== undefined) {
      return _reply.code(400).send({ error: 'You cannot change your own spare-only status' });
    }

    // Prevent changing role for users in SERVER_ADMINS (they are always server admins)
    if (isInServerAdminsList(targetMember)) {
      // Cannot change server admin status - they are always server admins
      if (body.isServerAdmin !== undefined && body.isServerAdmin === false) {
        return _reply.code(400).send({ error: 'Cannot remove server admin status from users in SERVER_ADMINS' });
      }
      // If trying to set isAdmin=true, ensure isServerAdmin is also true
      if (body.isAdmin === true) {
        // Force isServerAdmin to true for SERVER_ADMINS users
        body.isServerAdmin = true;
      }
    }

    // Regular admins cannot modify server admin roles
    if (!isServerAdmin(member) && (targetMember.is_server_admin === 1 || isServerAdmin(targetMember))) {
      // Regular admin trying to modify a server admin - only allow non-role fields
      if (body.isAdmin !== undefined || body.isServerAdmin !== undefined) {
        return _reply.code(403).send({ error: 'Only server admins can modify server admin roles' });
      }
    }

    // Only server admins can update server admin status
    if (body.isServerAdmin !== undefined && !isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Only server admins can change server admin status' });
    }

    const updateData: MemberUpdateData = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.email !== undefined) {
      updateData.email = body.email;
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone;
    }
    if (body.validThrough !== undefined) {
      updateData.valid_through = body.validThrough;
    }
    if (body.spareOnly !== undefined) {
      updateData.spare_only = body.spareOnly ? 1 : 0;
    }
    if (body.isAdmin !== undefined) {
      updateData.is_admin = body.isAdmin ? 1 : 0;
    }
    if (body.isServerAdmin !== undefined) {
      // If user is in SERVER_ADMINS, force is_server_admin to 1
      if (isInServerAdminsList(targetMember)) {
        updateData.is_server_admin = 1;
      } else {
        updateData.is_server_admin = body.isServerAdmin ? 1 : 0;
      }
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
      validThrough: normalizeDateString(updatedMember.valid_through),
      isAdmin: isAdmin(updatedMember),
      isServerAdmin: isServerAdmin(updatedMember),
      emailSubscribed: updatedMember.email_subscribed === 1,
      optedInSms: updatedMember.opted_in_sms === 1,
    };
      return {
        id: updatedMember.id,
        name: updatedMember.name,
        email: updatedMember.email,
        phone: updatedMember.phone,
        validThrough: normalizeDateString(updatedMember.valid_through),
        isAdmin: isAdmin(updatedMember),
        isServerAdmin: isServerAdmin(updatedMember),
        emailSubscribed: updatedMember.email_subscribed === 1,
        optedInSms: updatedMember.opted_in_sms === 1,
      };
    }
  );

  // Admin: Delete member
  fastify.delete<{ Params: { id: string }; Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/:id',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member || !isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);

    // Prevent self-deletion
    if (memberId === member.id) {
      return _reply.code(400).send({ error: 'You cannot delete yourself' });
    }

    const { db, schema } = getDrizzleDb();

    // Get target member to check permissions
    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1) as Member[];

    const targetMember = targetMembers[0];
    if (!targetMember) {
      return _reply.code(404).send({ error: 'Member not found' });
    }

    const isCurrentUserServerAdmin = isServerAdmin(member);

    // Check deletion permissions
    if (!isCurrentUserServerAdmin) {
      // Regular admin can only delete regular users (not admins or server admins)
      if (isAdmin(targetMember) || isServerAdmin(targetMember)) {
        return _reply.code(403).send({ error: 'You can only delete regular members' });
      }
    } else {
      // Server admin can delete anyone except SERVER_ADMINS
      if (isInServerAdminsList(targetMember)) {
        return _reply.code(403).send({ error: 'Cannot delete server admin' });
      }
    }

    await db
      .delete(schema.members)
      .where(eq(schema.members.id, memberId));

    return { success: true };
      return { success: true };
    }
  );

  // Admin: Bulk delete members
  fastify.post<{ Body: BulkDeleteBody; Reply: BulkDeleteResponse | ApiErrorResponse }>(
    '/members/bulk-delete',
    {
      schema: {
        tags: ['members'],
        body: bulkDeleteBodySchema,
        response: {
          200: bulkDeleteResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkDeleteSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get all members to check permissions
    const membersToDelete = await db
      .select()
      .from(schema.members)
      .where(inArray(schema.members.id, body.ids)) as Member[];

    const isCurrentUserServerAdmin = isServerAdmin(member);

    // Filter based on permissions
    const deletableIds = membersToDelete
      .filter((m: Member) => {
        // Can't delete self
        if (m.id === member.id) return false;

        if (!isCurrentUserServerAdmin) {
          // Regular admin can only delete regular users (not admins or server admins)
          return !isAdmin(m) && !isServerAdmin(m);
        } else {
          // Server admin can delete anyone except SERVER_ADMINS
          return !isInServerAdminsList(m);
        }
      })
      .map((m: Member) => m.id);

    if (deletableIds.length === 0) {
      return _reply.code(400).send({ error: 'No members can be deleted with your permissions' });
    }

    // Use a transaction to ensure atomicity
    await db.transaction(async (tx) => {
      // Delete related data first (cascade should handle most, but be explicit)
      await tx
        .delete(schema.memberAvailability)
        .where(inArray(schema.memberAvailability.member_id, deletableIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.requester_id, deletableIds));
      
      await tx
        .delete(schema.spareRequests)
        .where(inArray(schema.spareRequests.filled_by_member_id, deletableIds));
      
      await tx
        .delete(schema.spareRequestInvitations)
        .where(inArray(schema.spareRequestInvitations.member_id, deletableIds));
      
      await tx
        .delete(schema.spareResponses)
        .where(inArray(schema.spareResponses.member_id, deletableIds));
      
      // Finally delete the members
      await tx
        .delete(schema.members)
        .where(inArray(schema.members.id, deletableIds));
    });

    return { success: true, deletedCount: deletableIds.length };
      return { success: true, deletedCount: deletableIds.length };
    }
  );

  // Server admin only: Get login link for member
  fastify.get<{ Params: { id: string }; Reply: LoginLinkResponse | ApiErrorResponse }>(
    '/members/:id/login-link',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: loginLinkResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isServerAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember) {
      return _reply.code(404).send({ error: 'Member not found' });
    }

    const token = generateEmailLinkToken(targetMember);
    const loginLink = `${config.frontendUrl}?token=${token}`;

    return { loginLink };
      return { loginLink };
    }
  );

  // Admin: Send welcome email
  fastify.post<{ Params: { id: string }; Reply: { success: boolean } | ApiErrorResponse }>(
    '/members/:id/send-welcome',
    {
      schema: {
        tags: ['members'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params;
    const memberId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    
    const targetMember = targetMembers[0] as Member | undefined;

    if (!targetMember || !targetMember.email) {
      return _reply.code(404).send({ error: 'Member not found or has no email' });
    }

    const token = generateEmailLinkToken(targetMember);
    // Send welcome email asynchronously (fire-and-forget) to avoid blocking the response
    sendWelcomeEmail(targetMember.email, targetMember.name, token).catch((error) => {
      console.error('Error sending welcome email:', error);
    });

    return { success: true };
      return { success: true };
    }
  );

  // Admin: Bulk send welcome emails
  fastify.post<{ Body: BulkDeleteBody; Reply: BulkSendWelcomeResponse | ApiErrorResponse }>(
    '/members/bulk-send-welcome',
    {
      schema: {
        tags: ['members'],
        body: bulkDeleteBodySchema,
        response: {
          200: bulkSendWelcomeResponseSchema,
        },
      },
    },
    async (request, _reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!isAdmin(member)) {
      return _reply.code(403).send({ error: 'Forbidden' });
    }

    const body = bulkDeleteSchema.parse(request.body); // Reuse the schema for IDs array
    const { db, schema } = getDrizzleDb();

    // Get all selected members with email addresses
    const targetMembers = await db
      .select()
      .from(schema.members)
      .where(
        and(
          inArray(schema.members.id, body.ids),
          sql`${schema.members.email} IS NOT NULL AND ${schema.members.email} != ''`
        )
      ) as Member[];

    if (targetMembers.length === 0) {
      return _reply.code(400).send({ error: 'No members with email addresses found' });
    }

    // Send welcome emails asynchronously (fire-and-forget) to avoid blocking the response
    for (const targetMember of targetMembers) {
      if (targetMember.email) {
        const token = generateEmailLinkToken(targetMember);
        sendWelcomeEmail(targetMember.email, targetMember.name, token).catch((error) => {
          console.error(`Error sending welcome email to ${targetMember.email}:`, error);
        });
      }
    }

    return {
      success: true,
      sent: targetMembers.length,
    };
      return {
        success: true,
        sent: targetMembers.length,
      };
    }
  );
}

