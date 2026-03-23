import { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { isServerAdmin, isSponsorAdmin } from '../utils/auth.js';
import { publicFileUrl } from '../utils/managedFiles.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const levelSchema = z.object({
  name: z.string().min(1),
  amount: z.number().int().nonnegative().nullable().optional(),
});

const sponsorSchema = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().url(),
  logoFileId: z.number().int().positive().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
});

const sponsorshipSchema = z.object({
  sponsorId: z.number().int().positive(),
  sponsorshipLevelId: z.number().int().positive(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

function canManage(member: Member): boolean {
  return isServerAdmin(member) || isSponsorAdmin(member);
}

export async function sponsorshipRoutes(fastify: FastifyInstance) {
  fastify.get('/sponsorship/levels', async () => {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.sponsorshipLevels)
      .orderBy(asc(schema.sponsorshipLevels.sort_order), asc(schema.sponsorshipLevels.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      amount: row.amount === 0 ? null : row.amount,
      sortOrder: row.sort_order,
    }));
  });

  fastify.post('/sponsorship/levels', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const body = levelSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const [maxSort] = await db
      .select({ maxSortOrder: sql<number>`COALESCE(MAX(${schema.sponsorshipLevels.sort_order}), -1)` })
      .from(schema.sponsorshipLevels);
    const [created] = await db.insert(schema.sponsorshipLevels).values({
      name: body.name,
      amount: body.amount ?? 0,
      sort_order: (maxSort?.maxSortOrder ?? -1) + 1,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).returning();
    return created;
  });

  fastify.patch<{ Params: { id: string } }>('/sponsorship/levels/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const levelId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(levelId)) return reply.code(400).send({ error: 'Invalid id' });
    const body = levelSchema.partial().parse(request.body);
    const { db, schema } = getDrizzleDb();
    await db.update(schema.sponsorshipLevels).set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.amount !== undefined ? { amount: body.amount ?? 0 } : {}),
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(schema.sponsorshipLevels.id, levelId));
    return { success: true };
  });

  fastify.post('/sponsorship/levels/reorder', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const body = z.object({ ids: z.array(z.number().int().positive()) }).parse(request.body);
    const { db, schema } = getDrizzleDb();
    await db.transaction(async (tx) => {
      for (let i = 0; i < body.ids.length; i += 1) {
        await tx.update(schema.sponsorshipLevels).set({
          sort_order: i,
          updated_at: sql`CURRENT_TIMESTAMP`,
        }).where(eq(schema.sponsorshipLevels.id, body.ids[i]));
      }
    });
    return { success: true };
  });

  fastify.delete<{ Params: { id: string } }>('/sponsorship/levels/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const levelId = Number.parseInt(request.params.id, 10);
    const { db, schema } = getDrizzleDb();
    const [inUse] = await db.select({ id: schema.sponsorships.id }).from(schema.sponsorships).where(eq(schema.sponsorships.sponsorship_level_id, levelId)).limit(1);
    if (inUse) return reply.code(409).send({ error: 'Cannot delete a level in use by sponsorships' });
    await db.delete(schema.sponsorshipLevels).where(eq(schema.sponsorshipLevels.id, levelId));
    return { success: true };
  });

  fastify.get('/sponsorship/sponsors', async () => {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.sponsors.id,
        name: schema.sponsors.name,
        website_url: schema.sponsors.website_url,
        logo_file_id: schema.sponsors.logo_file_id,
        contact_name: schema.sponsors.contact_name,
        contact_email: schema.sponsors.contact_email,
        logoId: schema.files.id,
        logoChecksumSha256: schema.files.checksum_sha256,
        logoDisplayName: schema.files.display_name,
        logoOriginalFilename: schema.files.original_filename,
      })
      .from(schema.sponsors)
      .leftJoin(schema.files, eq(schema.sponsors.logo_file_id, schema.files.id))
      .orderBy(asc(schema.sponsors.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      websiteUrl: row.website_url,
      logoFileId: row.logo_file_id,
      logoUrl: row.logoId
        ? publicFileUrl(
            row.logoId,
            row.logoDisplayName || row.logoOriginalFilename || `file-${row.logoId}`,
            row.logoChecksumSha256
          )
        : null,
      contactName: row.contact_name ?? null,
      contactEmail: row.contact_email ?? null,
    }));
  });

  fastify.post('/sponsorship/sponsors', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const body = sponsorSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const [created] = await db.insert(schema.sponsors).values({
      name: body.name,
      website_url: body.websiteUrl,
      logo_file_id: body.logoFileId ?? null,
      contact_name: body.contactName ?? null,
      contact_email: body.contactEmail ?? null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).returning();
    return created;
  });

  fastify.patch<{ Params: { id: string } }>('/sponsorship/sponsors/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const sponsorId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(sponsorId)) return reply.code(400).send({ error: 'Invalid id' });
    const body = sponsorSchema.partial().parse(request.body);
    const { db, schema } = getDrizzleDb();
    await db.update(schema.sponsors).set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.websiteUrl !== undefined ? { website_url: body.websiteUrl } : {}),
      ...(body.logoFileId !== undefined ? { logo_file_id: body.logoFileId } : {}),
      ...(body.contactName !== undefined ? { contact_name: body.contactName } : {}),
      ...(body.contactEmail !== undefined ? { contact_email: body.contactEmail } : {}),
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(schema.sponsors.id, sponsorId));
    return { success: true };
  });

  fastify.delete<{ Params: { id: string } }>('/sponsorship/sponsors/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const sponsorId = Number.parseInt(request.params.id, 10);
    const { db, schema } = getDrizzleDb();
    const [inUse] = await db.select({ id: schema.sponsorships.id }).from(schema.sponsorships).where(eq(schema.sponsorships.sponsor_id, sponsorId)).limit(1);
    if (inUse) return reply.code(409).send({ error: 'Cannot delete a sponsor in use by sponsorships' });
    await db.delete(schema.sponsors).where(eq(schema.sponsors.id, sponsorId));
    return { success: true };
  });

  fastify.get('/sponsorship/sponsorships', async () => {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.sponsorships.id,
        sponsorId: schema.sponsorships.sponsor_id,
        sponsorshipLevelId: schema.sponsorships.sponsorship_level_id,
        startDate: schema.sponsorships.start_date,
        endDate: schema.sponsorships.end_date,
        sponsorName: schema.sponsors.name,
        levelName: schema.sponsorshipLevels.name,
      })
      .from(schema.sponsorships)
      .innerJoin(schema.sponsors, eq(schema.sponsorships.sponsor_id, schema.sponsors.id))
      .innerJoin(schema.sponsorshipLevels, eq(schema.sponsorships.sponsorship_level_id, schema.sponsorshipLevels.id))
      .orderBy(asc(schema.sponsorshipLevels.sort_order), asc(schema.sponsors.name));
    return rows;
  });

  fastify.post('/sponsorship/sponsorships', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const body = sponsorshipSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const [existing] = await db
      .select({ id: schema.sponsorships.id })
      .from(schema.sponsorships)
      .where(
        and(
          eq(schema.sponsorships.sponsor_id, body.sponsorId),
          eq(schema.sponsorships.sponsorship_level_id, body.sponsorshipLevelId)
        )
      )
      .limit(1);
    if (existing) {
      return reply
        .code(409)
        .send({ error: 'A sponsorship for this sponsor and level already exists' });
    }
    const [created] = await db.insert(schema.sponsorships).values({
      sponsor_id: body.sponsorId,
      sponsorship_level_id: body.sponsorshipLevelId,
      start_date: body.startDate ?? null,
      end_date: body.endDate ?? null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).returning();
    return created;
  });

  fastify.patch<{ Params: { id: string } }>('/sponsorship/sponsorships/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const sponsorshipId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(sponsorshipId)) return reply.code(400).send({ error: 'Invalid id' });
    const body = sponsorshipSchema.partial().parse(request.body);
    const { db, schema } = getDrizzleDb();
    const [current] = await db
      .select()
      .from(schema.sponsorships)
      .where(eq(schema.sponsorships.id, sponsorshipId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Sponsorship not found' });

    const nextSponsorId = body.sponsorId ?? current.sponsor_id;
    const nextLevelId = body.sponsorshipLevelId ?? current.sponsorship_level_id;
    const [duplicate] = await db
      .select({ id: schema.sponsorships.id })
      .from(schema.sponsorships)
      .where(
        and(
          eq(schema.sponsorships.sponsor_id, nextSponsorId),
          eq(schema.sponsorships.sponsorship_level_id, nextLevelId)
        )
      )
      .limit(1);
    if (duplicate && duplicate.id !== sponsorshipId) {
      return reply
        .code(409)
        .send({ error: 'A sponsorship for this sponsor and level already exists' });
    }
    await db.update(schema.sponsorships).set({
      ...(body.sponsorId !== undefined ? { sponsor_id: body.sponsorId } : {}),
      ...(body.sponsorshipLevelId !== undefined ? { sponsorship_level_id: body.sponsorshipLevelId } : {}),
      ...(body.startDate !== undefined ? { start_date: body.startDate } : {}),
      ...(body.endDate !== undefined ? { end_date: body.endDate } : {}),
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(schema.sponsorships.id, sponsorshipId));
    return { success: true };
  });

  fastify.delete<{ Params: { id: string } }>('/sponsorship/sponsorships/:id', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!canManage(member)) return reply.code(403).send({ error: 'Forbidden' });
    const sponsorshipId = Number.parseInt(request.params.id, 10);
    const { db, schema } = getDrizzleDb();
    await db.delete(schema.sponsorships).where(eq(schema.sponsorships.id, sponsorshipId));
    return { success: true };
  });
}
