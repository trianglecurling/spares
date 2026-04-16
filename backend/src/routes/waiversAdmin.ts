import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hasScope } from '../utils/rbac.js';
import type { Member } from '../types.js';
import { normalizeEmail } from '../utils/auth.js';
import { config } from '../config.js';
import { apiErrorPayload } from '../api/errors.js';
import { waiversAdminBulkLookupResponseSchema } from '../api/schemas.js';
import type { ApiErrorResponse, WaiversAdminBulkLookupResponse } from '../api/types.js';
import {
  cleverWaiverFindSQL,
  cleverWaiverGetWaiver,
  scoreFirstNameMatch,
  signedDateFromRow,
  summarizeWaiverDetail,
  waiverIdFromRow,
} from '../services/cleverWaiverClient.js';

interface Authed extends FastifyRequest {
  member: Member;
}

const bulkLookupSchema = z.object({
  rawList: z.string().max(200_000),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  templateId: z.string().min(1).optional(),
});

const MAX_LINES = 150;
const MAX_CANDIDATES_PER_ROW = 35;

function localCalendarDateToUnixSeconds(dateStr: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error('Invalid date');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  function partsAt(ms: number) {
    const p = formatter.formatToParts(new Date(ms));
    const pick = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === type)?.value ?? '0');
    return {
      y: pick('year'),
      m: pick('month'),
      d: pick('day'),
      H: pick('hour'),
      Mi: pick('minute'),
      S: pick('second'),
    };
  }

  let t = Date.UTC(y, mo - 1, d, 12, 0, 0);
  for (let i = 0; i < 60; i++) {
    const parts = partsAt(t);
    if (parts.y === y && parts.m === mo && parts.d === d) {
      if (parts.H === 0 && parts.Mi === 0 && parts.S === 0) {
        return Math.floor(t / 1000);
      }
      t -= (parts.H * 3600 + parts.Mi * 60 + parts.S) * 1000;
      continue;
    }
    if (parts.y < y || (parts.y === y && parts.m < mo) || (parts.y === y && parts.m === mo && parts.d < d)) {
      t += 3600 * 1000;
    } else {
      t -= 3600 * 1000;
    }
  }
  return Math.floor(Date.UTC(y, mo - 1, d, 8, 0, 0) / 1000);
}

type ParsedInput = {
  rawLine: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  parseError: string | null;
};

function parseLine(line: string): ParsedInput {
  const rawLine = line;
  const trimmed = line.trim();
  if (!trimmed) {
    return { rawLine, firstName: null, lastName: null, email: null, parseError: 'Empty line' };
  }

  let namePart = trimmed;
  let email: string | null = null;
  if (trimmed.includes('\t')) {
    const tabIdx = trimmed.indexOf('\t');
    namePart = trimmed.slice(0, tabIdx).trim();
    const afterTab = trimmed.slice(tabIdx + 1).trim();
    if (afterTab.includes('@')) {
      email = normalizeEmail(afterTab);
    }
  }

  if (!namePart && email) {
    return {
      rawLine,
      firstName: null,
      lastName: null,
      email,
      parseError: 'Name is required. CleverWaiver lookup uses last name only (email is kept for your reference).',
    };
  }

  if (!namePart) {
    return { rawLine, firstName: null, lastName: null, email, parseError: 'Missing name' };
  }

  let firstName: string | null = null;
  let lastName: string | null = null;
  if (namePart.includes(',')) {
    const [last, rest] = namePart.split(',').map((s) => s.trim());
    lastName = last || null;
    firstName = rest || null;
  } else {
    const tokens = namePart.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      lastName = tokens[0];
    } else {
      firstName = tokens[0];
      lastName = tokens.slice(1).join(' ');
    }
  }

  return { rawLine, firstName, lastName, email, parseError: null };
}

function parseIsoOrEpochToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isNaN(t)) return t;
  return null;
}

export async function waiversAdminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: z.infer<typeof bulkLookupSchema>; Reply: WaiversAdminBulkLookupResponse | ApiErrorResponse }>(
    '/waivers/admin/bulk-lookup',
    {
      schema: {
        tags: ['waivers'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['rawList', 'validFrom'],
          properties: {
            rawList: { type: 'string' },
            validFrom: { type: 'string' },
            templateId: { type: 'string' },
          },
        },
        response: {
          200: waiversAdminBulkLookupResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as Authed).member;
      if (!hasScope(member.authz, 'members.manage') && !hasScope(member.authz, 'events.manage')) {
        return reply.code(403).send(apiErrorPayload('Forbidden'));
      }

      const body = bulkLookupSchema.parse(request.body);
      const startDate = localCalendarDateToUnixSeconds(body.validFrom, config.timeZone);
      const validFromMs = startDate * 1000;

      const lines = body.rawList.split(/\r?\n/);
      const nonEmptyLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().length > 0);

      if (nonEmptyLines.length > MAX_LINES) {
        return reply.code(400).send(
          apiErrorPayload('Too many lines', { maxLines: MAX_LINES, count: nonEmptyLines.length })
        );
      }

      const rows: WaiversAdminBulkLookupResponse['rows'] = [];

      for (const { l, i } of nonEmptyLines) {
        const input = parseLine(l);
        if (input.parseError) {
          rows.push({
            lineIndex: i,
            input: {
              rawLine: input.rawLine,
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
            },
            searchMode: 'skipped',
            error: input.parseError,
            candidates: [],
          });
          continue;
        }

        if (!config.cleverWaiver.accessToken?.trim()) {
          rows.push({
            lineIndex: i,
            input: {
              rawLine: input.rawLine,
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
            },
            searchMode: 'last_name',
            error: 'CleverWaiver is not configured on the server.',
            candidates: [],
          });
          continue;
        }

        const baseParams: Record<string, unknown> = { startDate };
        if (body.templateId) baseParams.templateId = body.templateId;

        const searchMode = 'last_name' as const;
        let findResult: Awaited<ReturnType<typeof cleverWaiverFindSQL>>;

        if (input.lastName?.trim()) {
          findResult = await cleverWaiverFindSQL({ ...baseParams, last_name: input.lastName.trim() });
        } else {
          rows.push({
            lineIndex: i,
            input: {
              rawLine: input.rawLine,
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
            },
            searchMode: 'last_name',
            error: 'Could not determine a last name to search.',
            candidates: [],
          });
          continue;
        }

        if (!findResult.ok) {
          rows.push({
            lineIndex: i,
            input: {
              rawLine: input.rawLine,
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
            },
            searchMode,
            error: findResult.message || 'CleverWaiver search failed.',
            candidates: [],
          });
          continue;
        }

        let ranked = findResult.rows
          .map((r) => ({
            row: r,
            id: waiverIdFromRow(r),
            signedMs: parseIsoOrEpochToMs(signedDateFromRow(r)),
 }))
          .filter((x) => x.id) as Array<{ row: unknown; id: string; signedMs: number | null }>;

        ranked = ranked.filter((x) => x.signedMs === null || x.signedMs >= validFromMs);
        ranked.sort((a, b) => (b.signedMs ?? 0) - (a.signedMs ?? 0));
        ranked = ranked.slice(0, MAX_CANDIDATES_PER_ROW);

        const candidates: WaiversAdminBulkLookupResponse['rows'][number]['candidates'] = [];

        for (const { row, id } of ranked) {
          const detailRes = await cleverWaiverGetWaiver(id);
          const detail = detailRes.ok ? detailRes.data : null;
          const summary = summarizeWaiverDetail(detail, row);
          const firstScore = scoreFirstNameMatch(input.firstName ?? undefined, detail);

          candidates.push({
            waiverId: id,
            templateId:
              typeof (row as Record<string, unknown>).templateId === 'string'
                ? ((row as Record<string, unknown>).templateId as string)
                : null,
            templateHeader:
              typeof (row as Record<string, unknown>).header === 'string'
                ? ((row as Record<string, unknown>).header as string)
                : null,
            templateUrl:
              typeof (row as Record<string, unknown>).templateUrl === 'string'
                ? ((row as Record<string, unknown>).templateUrl as string)
                : null,
            signedDate: summary.signedDate ?? signedDateFromRow(row),
            displayName: summary.fullName,
            email: summary.email,
            isMinor: summary.isMinor,
            minorAge: summary.minorAge,
            firstNameMatchScore: firstScore,
            detail: detail ?? undefined,
            fetchError: detailRes.ok ? null : detailRes.message ?? 'Failed to load waiver details',
          });
        }

        candidates.sort((a, b) => {
          if (b.firstNameMatchScore !== a.firstNameMatchScore) return b.firstNameMatchScore - a.firstNameMatchScore;
          const ad = a.signedDate ? Date.parse(a.signedDate) : 0;
          const bd = b.signedDate ? Date.parse(b.signedDate) : 0;
          return bd - ad;
        });

        rows.push({
          lineIndex: i,
          input: {
            rawLine: input.rawLine,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
          },
          searchMode,
          error: null,
          candidates,
        });
      }

      return {
        validFrom: body.validFrom,
        timeZone: config.timeZone,
        startDateUnix: startDate,
        rows,
      };
    }
  );
}
