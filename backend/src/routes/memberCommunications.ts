import { FastifyInstance, FastifyRequest } from 'fastify';
import { desc } from 'drizzle-orm';
import { memberCommunicationsResponseSchema } from '../api/memberCommunicationsSchemas.js';
import type { ApiErrorResponse } from '../api/types.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import {
  isMauticConfigured,
  listMemberCommsEmails,
  MauticRequestError,
  type MauticMemberCommsEmail,
} from '../services/mauticService.js';
import { hasScope } from '../utils/rbac.js';

interface AuthenticatedRequest extends FastifyRequest {
  member?: Member;
}

type ApiReply<T> = T | ApiErrorResponse;

type SeasonRow = {
  id: number;
  name: string;
  start_date: string | Date;
  end_date: string | Date;
};

function requireActiveMember(
  member: Member | undefined,
  reply: { code: (n: number) => { send: (b: ApiErrorResponse) => unknown } },
) {
  if (!member) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (!hasScope(member.authz, 'member.active')) {
    return reply.code(403).send({
      error: 'Member communications are available only to current club members.',
    });
  }
  return null;
}

function toDateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function seasonContainsDate(season: SeasonRow, dateOnly: string): boolean {
  const start = toDateOnly(season.start_date);
  const end = toDateOnly(season.end_date);
  if (!start || !end) return false;
  return dateOnly >= start && dateOnly <= end;
}

function groupEmailsBySeason(seasons: SeasonRow[], emails: MauticMemberCommsEmail[]) {
  const groups = new Map<
    number | 'other',
    { seasonId: number | null; seasonName: string; emails: MauticMemberCommsEmail[] }
  >();

  for (const season of seasons) {
    groups.set(season.id, {
      seasonId: season.id,
      seasonName: season.name,
      emails: [],
    });
  }
  groups.set('other', {
    seasonId: null,
    seasonName: 'Older',
    emails: [],
  });

  for (const email of emails) {
    const dateOnly = toDateOnly(email.sortDate);
    const matchingSeason =
      dateOnly != null ? seasons.find((season) => seasonContainsDate(season, dateOnly)) : undefined;
    const key = matchingSeason ? matchingSeason.id : 'other';
    groups.get(key)?.emails.push(email);
  }

  const ordered: Array<{
    seasonId: number | null;
    seasonName: string;
    emails: MauticMemberCommsEmail[];
  }> = [];
  for (const season of seasons) {
    const group = groups.get(season.id);
    if (group && group.emails.length > 0) ordered.push(group);
  }
  const other = groups.get('other');
  if (other && other.emails.length > 0) ordered.push(other);
  return ordered;
}

export async function memberCommunicationsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/member-communications',
    {
      schema: {
        tags: ['member-communications'],
        response: {
          200: memberCommunicationsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      const denied = requireActiveMember(member, reply);
      if (denied) return denied;

      if (!isMauticConfigured()) {
        return reply.code(503).send({
          error: 'Member communications are temporarily unavailable.',
        });
      }

      try {
        const { db, schema } = getDrizzleDb();
        const [seasonRows, emails] = await Promise.all([
          db
            .select({
              id: schema.curlingSeasons.id,
              name: schema.curlingSeasons.name,
              start_date: schema.curlingSeasons.start_date,
              end_date: schema.curlingSeasons.end_date,
            })
            .from(schema.curlingSeasons)
            .orderBy(desc(schema.curlingSeasons.start_date), desc(schema.curlingSeasons.id)),
          listMemberCommsEmails(),
        ]);

        return {
          seasons: groupEmailsBySeason(seasonRows as SeasonRow[], emails),
        };
      } catch (err: unknown) {
        if (err instanceof MauticRequestError) {
          console.error('Member communications Mautic error', {
            status: err.statusCode,
            message: err.message,
            body: err.responseBody?.slice(0, 500),
          });
          return reply.code(503).send({
            error: 'Unable to load member communications from Mautic right now.',
          });
        }
        throw err;
      }
    },
  );
}
