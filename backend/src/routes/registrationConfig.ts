import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import type { ApiReply } from '../api/types.js';
import {
  registrationDiscountSettingsSchema,
  registrationPriceSettingsSchema,
  registrationSeasonListResponseSchema,
  registrationSeasonSchema,
  registrationSessionListResponseSchema,
  registrationSessionSchema,
  registrationStateTransitionListResponseSchema,
  registrationStateTransitionSchema,
} from '../api/schemas.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin } from '../utils/auth.js';
import {
  RegistrationConfigValidationError,
  assertRegistrationStateTransition,
  assertSessionWithinSeason,
  assertValidDateRange,
  assertValidPriceConfig,
  assertValidRegistrationDiscountSettingsStored,
  type PriceConfigInput,
  type RegistrationDiscountSettingsStored,
} from '../registration/registrationConfigValidation.js';

const SINGLETON_SCOPE = 'singleton';

type RegistrationWindowState = 'closed' | 'priority' | 'open';

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (!isAdmin(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function handleValidationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationConfigValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  return false;
}

function parseId(id: string): number {
  return Number.parseInt(id, 10);
}

function normalizeDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapSeason(row: any) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: any) {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStateTransition(row: any) {
  return {
    id: row.id,
    seasonId: row.season_id,
    sessionId: row.session_id,
    effectiveAt: normalizeDateTime(row.effective_at) ?? '',
    state: row.state as RegistrationWindowState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Converts UI/API dollar amounts to integer cents (minor units). */
function dollarsToFeeMinor(dollars: number): number {
  return Math.round(dollars * 100);
}

function feeMinorToDollars(minor: number): number {
  return minor / 100;
}

type DiscountSlotApi = { amountType: 'dollar' | 'percent'; value: number };

function storedDiscountSlotToApi(slot: {
  amountType: 'dollar' | 'percent';
  amountValue: number;
}): DiscountSlotApi {
  if (slot.amountType === 'dollar') {
    return { amountType: 'dollar', value: feeMinorToDollars(slot.amountValue) };
  }
  return { amountType: 'percent', value: slot.amountValue };
}

function apiDiscountSlotToStored(slot: DiscountSlotApi) {
  if (slot.amountType === 'dollar') {
    return { amountType: 'dollar' as const, amountValue: dollarsToFeeMinor(slot.value) };
  }
  return { amountType: 'percent' as const, amountValue: Math.round(slot.value) };
}

function mapPriceRowToResponse(row: {
  scope: string;
  regular_membership_fee_minor: number;
  social_membership_fee_minor: number;
  spare_only_ice_privilege_fee_minor: number;
  sabbatical_fee_minor: number;
  junior_recreational_fee_minor: number;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    scope: row.scope,
    regularMembershipFeeDollars: feeMinorToDollars(row.regular_membership_fee_minor),
    socialMembershipFeeDollars: feeMinorToDollars(row.social_membership_fee_minor),
    spareOnlyIcePrivilegeFeeDollars: feeMinorToDollars(row.spare_only_ice_privilege_fee_minor),
    sabbaticalFeeDollars: feeMinorToDollars(row.sabbatical_fee_minor),
    juniorRecreationalFeeDollars: feeMinorToDollars(row.junior_recreational_fee_minor),
    createdAt: normalizeDateTime(row.created_at) ?? '',
    updatedAt: normalizeDateTime(row.updated_at) ?? '',
  };
}

function mapDiscountRowToResponse(row: {
  scope: string;
  student_discount_amount_type: 'dollar' | 'percent';
  student_discount_amount_value: number;
  reciprocal_discount_amount_type: 'dollar' | 'percent';
  reciprocal_discount_amount_value: number;
  winter_only_discount_amount_type: 'dollar' | 'percent';
  winter_only_discount_amount_value: number;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    scope: row.scope,
    studentDiscount: storedDiscountSlotToApi({
      amountType: row.student_discount_amount_type,
      amountValue: row.student_discount_amount_value,
    }),
    reciprocalDiscount: storedDiscountSlotToApi({
      amountType: row.reciprocal_discount_amount_type,
      amountValue: row.reciprocal_discount_amount_value,
    }),
    winterOnlyDiscount: storedDiscountSlotToApi({
      amountType: row.winter_only_discount_amount_type,
      amountValue: row.winter_only_discount_amount_value,
    }),
    createdAt: normalizeDateTime(row.created_at) ?? '',
    updatedAt: normalizeDateTime(row.updated_at) ?? '',
  };
}

async function loadOrInsertRegistrationPriceSettings() {
  const { db, schema } = getDrizzleDb();
  let [row] = await db
    .select()
    .from(schema.registrationPriceSettings)
    .where(eq(schema.registrationPriceSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (row) return row;
  await db
    .insert(schema.registrationPriceSettings)
    .values({
      scope: SINGLETON_SCOPE,
      regular_membership_fee_minor: 0,
      social_membership_fee_minor: 0,
      spare_only_ice_privilege_fee_minor: 0,
      sabbatical_fee_minor: 0,
      junior_recreational_fee_minor: 0,
    })
    .onConflictDoNothing();
  [row] = await db
    .select()
    .from(schema.registrationPriceSettings)
    .where(eq(schema.registrationPriceSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (!row) {
    throw new Error('Could not load registration_price_settings singleton row.');
  }
  return row;
}

async function loadOrInsertRegistrationDiscountSettings() {
  const { db, schema } = getDrizzleDb();
  let [row] = await db
    .select()
    .from(schema.registrationDiscountSettings)
    .where(eq(schema.registrationDiscountSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (row) return row;
  await db
    .insert(schema.registrationDiscountSettings)
    .values({
      scope: SINGLETON_SCOPE,
      student_discount_amount_type: 'dollar',
      student_discount_amount_value: 0,
      reciprocal_discount_amount_type: 'dollar',
      reciprocal_discount_amount_value: 0,
      winter_only_discount_amount_type: 'dollar',
      winter_only_discount_amount_value: 0,
    })
    .onConflictDoNothing();
  [row] = await db
    .select()
    .from(schema.registrationDiscountSettings)
    .where(eq(schema.registrationDiscountSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (!row) {
    throw new Error('Could not load registration_discount_settings singleton row.');
  }
  return row;
}

const seasonBodySchema = z.object({
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

const seasonPatchSchema = seasonBodySchema.partial();

const sessionBodySchema = z.object({
  seasonId: z.number().int().positive(),
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

const sessionPatchSchema = sessionBodySchema.partial();

const stateTransitionBodySchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  effectiveAt: z.string().min(1),
  state: z.enum(['closed', 'priority', 'open']),
});

const stateTransitionPatchSchema = stateTransitionBodySchema.partial();

const registrationStateApplyNowBodySchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  state: z.enum(['closed', 'priority', 'open']),
});

const dollarAmountSchema = z.number().finite().nonnegative();

const pricePatchSchema = z.object({
  regularMembershipFeeDollars: dollarAmountSchema.optional(),
  socialMembershipFeeDollars: dollarAmountSchema.optional(),
  spareOnlyIcePrivilegeFeeDollars: dollarAmountSchema.optional(),
  sabbaticalFeeDollars: dollarAmountSchema.optional(),
  juniorRecreationalFeeDollars: dollarAmountSchema.optional(),
});

const discountSlotPatchSchema = z
  .object({
    amountType: z.enum(['dollar', 'percent']).optional(),
    value: z.number().finite().nonnegative().optional(),
  })
  .strict();

const discountPatchSchema = z
  .object({
    studentDiscount: discountSlotPatchSchema.optional(),
    reciprocalDiscount: discountSlotPatchSchema.optional(),
    winterOnlyDiscount: discountSlotPatchSchema.optional(),
  })
  .strict();

async function loadSeasonOr404(seasonId: number, reply: FastifyReply) {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.curlingSeasons).where(eq(schema.curlingSeasons.id, seasonId)).limit(1);
  const season = rows[0];
  if (!season) {
    reply.code(404).send({ error: 'Season not found' });
    return null;
  }
  return season;
}

async function loadSessionOr404(sessionId: number, reply: FastifyReply) {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.curlingSessions).where(eq(schema.curlingSessions.id, sessionId)).limit(1);
  const session = rows[0];
  if (!session) {
    reply.code(404).send({ error: 'Session not found' });
    return null;
  }
  return session;
}

async function loadStateTransitionOr404(id: number, reply: FastifyReply) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.registrationStateTransitions)
    .where(eq(schema.registrationStateTransitions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    reply.code(404).send({ error: 'Registration state transition not found' });
    return null;
  }
  return row;
}

async function assertSessionBelongsToSeason(seasonId: number, sessionId: number, reply: FastifyReply): Promise<boolean> {
  const season = await loadSeasonOr404(seasonId, reply);
  if (!season) return false;
  const session = await loadSessionOr404(sessionId, reply);
  if (!session) return false;
  try {
    assertSessionWithinSeason({
      selectedSeasonId: seasonId,
      sessionSeasonId: session.season_id,
      sessionStartDate: session.start_date,
      sessionEndDate: session.end_date,
      seasonStartDate: season.start_date,
      seasonEndDate: season.end_date,
    });
  } catch (error) {
    return !handleValidationError(reply, error);
  }
  return true;
}

export async function registrationConfigRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/registration-config/seasons',
    {
      schema: {
        tags: ['registration-config'],
        response: { 200: registrationSeasonListResponseSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { db, schema } = getDrizzleDb();
      const rows = await db.select().from(schema.curlingSeasons).orderBy(schema.curlingSeasons.start_date);
      return rows.map(mapSeason);
    }
  );

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/registration-config/seasons',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
          required: ['name', 'startDate', 'endDate'],
        },
        response: { 200: registrationSeasonSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = seasonBodySchema.parse(request.body);
      try {
        assertValidDateRange(body.startDate, body.endDate, 'seasonDates');
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const { db, schema } = getDrizzleDb();
      const inserted = await db
        .insert(schema.curlingSeasons)
        .values({
          name: body.name,
          start_date: body.startDate,
          end_date: body.endDate,
        })
        .returning();
      return mapSeason(inserted[0]);
    }
  );

  fastify.get<{ Params: { id: string }; Reply: ApiReply<unknown, 404> }>(
    '/registration-config/seasons/:id',
    {
      schema: {
        tags: ['registration-config'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        response: { 200: registrationSeasonSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const season = await loadSeasonOr404(parseId(request.params.id), reply);
      if (!season) return;
      return mapSeason(season);
    }
  );

  fastify.patch<{ Params: { id: string }; Reply: ApiReply<unknown, 404> }>(
    '/registration-config/seasons/:id',
    {
      schema: {
        tags: ['registration-config'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
        },
        response: { 200: registrationSeasonSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = parseId(request.params.id);
      const existing = await loadSeasonOr404(id, reply);
      if (!existing) return;
      const body = seasonPatchSchema.parse(request.body);
      const next = {
        name: body.name ?? existing.name,
        startDate: body.startDate ?? existing.start_date,
        endDate: body.endDate ?? existing.end_date,
      };
      try {
        assertValidDateRange(next.startDate, next.endDate, 'seasonDates');
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const { db, schema } = getDrizzleDb();
      const updateData: Partial<{
        name: string;
        start_date: string;
        end_date: string;
        updated_at: SQL<unknown>;
      }> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      const rows = await db.update(schema.curlingSeasons).set(updateData).where(eq(schema.curlingSeasons.id, id)).returning();
      return mapSeason(rows[0]);
    }
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/registration-config/sessions',
    {
      schema: { tags: ['registration-config'], response: { 200: registrationSessionListResponseSchema } },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { db, schema } = getDrizzleDb();
      const rows = await db
        .select()
        .from(schema.curlingSessions)
        .orderBy(asc(schema.curlingSessions.season_id), asc(schema.curlingSessions.start_date));
      return rows.map(mapSession);
    }
  );

  fastify.post<{ Reply: ApiReply<unknown, 404> }>(
    '/registration-config/sessions',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seasonId: { type: 'number' },
            name: { type: 'string', minLength: 1 },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
          required: ['seasonId', 'name', 'startDate', 'endDate'],
        },
        response: { 200: registrationSessionSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = sessionBodySchema.parse(request.body);
      const season = await loadSeasonOr404(body.seasonId, reply);
      if (!season) return;
      try {
        assertValidDateRange(body.startDate, body.endDate, 'sessionDates');
        assertSessionWithinSeason({
          selectedSeasonId: body.seasonId,
          sessionSeasonId: body.seasonId,
          sessionStartDate: body.startDate,
          sessionEndDate: body.endDate,
          seasonStartDate: season.start_date,
          seasonEndDate: season.end_date,
        });
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const { db, schema } = getDrizzleDb();
      const inserted = await db
        .insert(schema.curlingSessions)
        .values({
          season_id: body.seasonId,
          name: body.name,
          start_date: body.startDate,
          end_date: body.endDate,
        })
        .returning();
      return mapSession(inserted[0]);
    }
  );

  fastify.patch<{ Params: { id: string }; Reply: ApiReply<unknown, 404> }>(
    '/registration-config/sessions/:id',
    {
      schema: {
        tags: ['registration-config'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seasonId: { type: 'number' },
            name: { type: 'string', minLength: 1 },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
        },
        response: { 200: registrationSessionSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = parseId(request.params.id);
      const existing = await loadSessionOr404(id, reply);
      if (!existing) return;
      const body = sessionPatchSchema.parse(request.body);
      const seasonId = body.seasonId ?? existing.season_id;
      const season = await loadSeasonOr404(seasonId, reply);
      if (!season) return;
      const nextStart = body.startDate ?? existing.start_date;
      const nextEnd = body.endDate ?? existing.end_date;
      try {
        assertValidDateRange(nextStart, nextEnd, 'sessionDates');
        assertSessionWithinSeason({
          selectedSeasonId: seasonId,
          sessionSeasonId: seasonId,
          sessionStartDate: nextStart,
          sessionEndDate: nextEnd,
          seasonStartDate: season.start_date,
          seasonEndDate: season.end_date,
        });
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const { db, schema } = getDrizzleDb();
      const updateData: Partial<{
        season_id: number;
        name: string;
        start_date: string;
        end_date: string;
        updated_at: SQL<unknown>;
      }> = {};
      if (body.seasonId !== undefined) updateData.season_id = body.seasonId;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      const rows = await db.update(schema.curlingSessions).set(updateData).where(eq(schema.curlingSessions.id, id)).returning();
      return mapSession(rows[0]);
    }
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/registration-config/registration-state-transitions',
    {
      schema: { tags: ['registration-config'], response: { 200: registrationStateTransitionListResponseSchema } },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { db, schema } = getDrizzleDb();
      const rows = await db
        .select()
        .from(schema.registrationStateTransitions)
        .orderBy(
          asc(schema.registrationStateTransitions.season_id),
          asc(schema.registrationStateTransitions.session_id),
          asc(schema.registrationStateTransitions.effective_at),
          asc(schema.registrationStateTransitions.id)
        );
      return rows.map(mapStateTransition);
    }
  );

  fastify.post<{ Reply: ApiReply<unknown, 404> }>(
    '/registration-config/registration-state-transitions/apply-now',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seasonId: { type: 'number' },
            sessionId: { type: 'number' },
            state: { type: 'string', enum: ['closed', 'priority', 'open'] },
          },
          required: ['seasonId', 'sessionId', 'state'],
        },
        response: { 200: registrationStateTransitionSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = registrationStateApplyNowBodySchema.parse(request.body);
      if (!(await assertSessionBelongsToSeason(body.seasonId, body.sessionId, reply))) return;
      const effectiveDate = new Date();
      try {
        assertRegistrationStateTransition({ effectiveAt: effectiveDate.toISOString() });
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const { db, schema } = getDrizzleDb();
      const inserted = await db
        .insert(schema.registrationStateTransitions)
        .values({
          season_id: body.seasonId,
          session_id: body.sessionId,
          effective_at: effectiveDate,
          state: body.state,
        })
        .returning();
      return mapStateTransition(inserted[0]);
    }
  );

  fastify.post<{ Reply: ApiReply<unknown, 404> }>(
    '/registration-config/registration-state-transitions',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seasonId: { type: 'number' },
            sessionId: { type: 'number' },
            effectiveAt: { type: 'string' },
            state: { type: 'string', enum: ['closed', 'priority', 'open'] },
          },
          required: ['seasonId', 'sessionId', 'effectiveAt', 'state'],
        },
        response: { 200: registrationStateTransitionSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = stateTransitionBodySchema.parse(request.body);
      if (!(await assertSessionBelongsToSeason(body.seasonId, body.sessionId, reply))) return;
      try {
        assertRegistrationStateTransition({ effectiveAt: body.effectiveAt });
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const effectiveDate = new Date(body.effectiveAt);
      const { db, schema } = getDrizzleDb();
      const inserted = await db
        .insert(schema.registrationStateTransitions)
        .values({
          season_id: body.seasonId,
          session_id: body.sessionId,
          effective_at: effectiveDate,
          state: body.state,
        })
        .returning();
      return mapStateTransition(inserted[0]);
    }
  );

  fastify.patch<{ Params: { id: string }; Reply: ApiReply<unknown, 404> }>(
    '/registration-config/registration-state-transitions/:id',
    {
      schema: {
        tags: ['registration-config'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            seasonId: { type: 'number' },
            sessionId: { type: 'number' },
            effectiveAt: { type: 'string' },
            state: { type: 'string', enum: ['closed', 'priority', 'open'] },
          },
        },
        response: { 200: registrationStateTransitionSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = parseId(request.params.id);
      const existing = await loadStateTransitionOr404(id, reply);
      if (!existing) return;
      const body = stateTransitionPatchSchema.parse(request.body);
      const nextSeasonId = body.seasonId ?? existing.season_id;
      const nextSessionId = body.sessionId ?? existing.session_id;
      if (!(await assertSessionBelongsToSeason(nextSeasonId, nextSessionId, reply))) return;
      const nextEffective = body.effectiveAt ?? existing.effective_at;
      try {
        assertRegistrationStateTransition({ effectiveAt: String(nextEffective) });
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const effectiveDate = new Date(String(nextEffective));
      const { db, schema } = getDrizzleDb();
      const updateData: Partial<{
        season_id: number;
        session_id: number;
        effective_at: Date;
        state: RegistrationWindowState;
        updated_at: SQL<unknown>;
      }> = {};
      if (body.seasonId !== undefined) updateData.season_id = body.seasonId;
      if (body.sessionId !== undefined) updateData.session_id = body.sessionId;
      if (body.effectiveAt !== undefined) updateData.effective_at = effectiveDate;
      if (body.state !== undefined) updateData.state = body.state;
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      const rows = await db
        .update(schema.registrationStateTransitions)
        .set(updateData)
        .where(eq(schema.registrationStateTransitions.id, id))
        .returning();
      return mapStateTransition(rows[0]);
    }
  );

  fastify.delete<{ Params: { id: string }; Reply: ApiReply<unknown, 404> }>(
    '/registration-config/registration-state-transitions/:id',
    {
      schema: {
        tags: ['registration-config'],
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: { success: { type: 'boolean' } },
            required: ['success'],
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = parseId(request.params.id);
      const existing = await loadStateTransitionOr404(id, reply);
      if (!existing) return;
      const { db, schema } = getDrizzleDb();
      await db.delete(schema.registrationStateTransitions).where(eq(schema.registrationStateTransitions.id, id));
      return { success: true };
    }
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/registration-config/prices',
    {
      schema: { tags: ['registration-config'], response: { 200: registrationPriceSettingsSchema } },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const row = await loadOrInsertRegistrationPriceSettings();
      return mapPriceRowToResponse(row);
    }
  );

  fastify.patch<{ Reply: ApiReply<unknown> }>(
    '/registration-config/prices',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            regularMembershipFeeDollars: { type: 'number' },
            socialMembershipFeeDollars: { type: 'number' },
            spareOnlyIcePrivilegeFeeDollars: { type: 'number' },
            sabbaticalFeeDollars: { type: 'number' },
            juniorRecreationalFeeDollars: { type: 'number' },
          },
        },
        response: { 200: registrationPriceSettingsSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = pricePatchSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      const existingRow = await loadOrInsertRegistrationPriceSettings();
      const current = mapPriceRowToResponse(existingRow);
      const nextDollars = {
        regularMembershipFeeDollars: body.regularMembershipFeeDollars ?? current.regularMembershipFeeDollars,
        socialMembershipFeeDollars: body.socialMembershipFeeDollars ?? current.socialMembershipFeeDollars,
        spareOnlyIcePrivilegeFeeDollars:
          body.spareOnlyIcePrivilegeFeeDollars ?? current.spareOnlyIcePrivilegeFeeDollars,
        sabbaticalFeeDollars: body.sabbaticalFeeDollars ?? current.sabbaticalFeeDollars,
        juniorRecreationalFeeDollars: body.juniorRecreationalFeeDollars ?? current.juniorRecreationalFeeDollars,
      };
      const priceConfigMinor: PriceConfigInput = {
        regularMembershipFeeMinor: dollarsToFeeMinor(nextDollars.regularMembershipFeeDollars),
        socialMembershipFeeMinor: dollarsToFeeMinor(nextDollars.socialMembershipFeeDollars),
        spareOnlyIcePrivilegeFeeMinor: dollarsToFeeMinor(nextDollars.spareOnlyIcePrivilegeFeeDollars),
        sabbaticalFeeMinor: dollarsToFeeMinor(nextDollars.sabbaticalFeeDollars),
        juniorRecreationalFeeMinor: dollarsToFeeMinor(nextDollars.juniorRecreationalFeeDollars),
      };
      try {
        assertValidPriceConfig(priceConfigMinor);
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const rows = await db
        .update(schema.registrationPriceSettings)
        .set({
          regular_membership_fee_minor: priceConfigMinor.regularMembershipFeeMinor,
          social_membership_fee_minor: priceConfigMinor.socialMembershipFeeMinor,
          spare_only_ice_privilege_fee_minor: priceConfigMinor.spareOnlyIcePrivilegeFeeMinor,
          sabbatical_fee_minor: priceConfigMinor.sabbaticalFeeMinor,
          junior_recreational_fee_minor: priceConfigMinor.juniorRecreationalFeeMinor,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationPriceSettings.scope, SINGLETON_SCOPE))
        .returning();
      return mapPriceRowToResponse(rows[0]);
    }
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/registration-config/discounts',
    {
      schema: { tags: ['registration-config'], response: { 200: registrationDiscountSettingsSchema } },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const row = await loadOrInsertRegistrationDiscountSettings();
      return mapDiscountRowToResponse(row);
    }
  );

  fastify.patch<{ Reply: ApiReply<unknown> }>(
    '/registration-config/discounts',
    {
      schema: {
        tags: ['registration-config'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            studentDiscount: {
              type: 'object',
              additionalProperties: false,
              properties: {
                amountType: { type: 'string', enum: ['dollar', 'percent'] },
                value: { type: 'number' },
              },
            },
            reciprocalDiscount: {
              type: 'object',
              additionalProperties: false,
              properties: {
                amountType: { type: 'string', enum: ['dollar', 'percent'] },
                value: { type: 'number' },
              },
            },
            winterOnlyDiscount: {
              type: 'object',
              additionalProperties: false,
              properties: {
                amountType: { type: 'string', enum: ['dollar', 'percent'] },
                value: { type: 'number' },
              },
            },
          },
        },
        response: { 200: registrationDiscountSettingsSchema },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = discountPatchSchema.parse(request.body);
      const { db, schema } = getDrizzleDb();
      const existingRow = await loadOrInsertRegistrationDiscountSettings();
      const current = mapDiscountRowToResponse(existingRow);
      const merged: RegistrationDiscountSettingsStored = {
        student: apiDiscountSlotToStored({
          ...current.studentDiscount,
          ...body.studentDiscount,
        }),
        reciprocal: apiDiscountSlotToStored({
          ...current.reciprocalDiscount,
          ...body.reciprocalDiscount,
        }),
        winterOnly: apiDiscountSlotToStored({
          ...current.winterOnlyDiscount,
          ...body.winterOnlyDiscount,
        }),
      };
      try {
        assertValidRegistrationDiscountSettingsStored(merged);
      } catch (error) {
        if (handleValidationError(reply, error)) return;
        throw error;
      }
      const rows = await db
        .update(schema.registrationDiscountSettings)
        .set({
          student_discount_amount_type: merged.student.amountType,
          student_discount_amount_value: merged.student.amountValue,
          reciprocal_discount_amount_type: merged.reciprocal.amountType,
          reciprocal_discount_amount_value: merged.reciprocal.amountValue,
          winter_only_discount_amount_type: merged.winterOnly.amountType,
          winter_only_discount_amount_value: merged.winterOnly.amountValue,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationDiscountSettings.scope, SINGLETON_SCOPE))
        .returning();
      return mapDiscountRowToResponse(rows[0]);
    }
  );
}
