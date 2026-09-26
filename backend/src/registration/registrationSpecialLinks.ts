import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';
import { resolveFrontendBaseUrl } from '../utils/frontendUrl.js';
import { findRecognizedPersonMemberIdByEmail } from './registrationEmailRecognition.js';

export const REGISTRATION_SPECIAL_LINK_HEADER = 'x-registration-special-link';
export const REGISTRATION_SPECIAL_LINK_PATH = '/registration/start';

const REQUEST_LINK_KEY = 'registrationSpecialLink';

type SpecialLinkAlsStore = { token: string | null };

const specialLinkAls = new AsyncLocalStorage<SpecialLinkAlsStore>();

type SpecialLinkDecoratedRequest = FastifyRequest & {
  [REQUEST_LINK_KEY]?: string | null;
};

export class RegistrationSpecialLinkValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Special registration link validation failed');
  }
}

export type RegistrationSpecialLinkRow = {
  id: number;
  season_id: number;
  session_id: number;
  token: string;
  label: string | null;
  registrant_email: string;
  allow_league_registration: number;
  allowed_league_ids: unknown;
  used: number;
  invalidated: number;
  created_by_member_id: number | null;
  used_at: string | Date | null;
  created_at: string | Date;
};

export type RegistrationSpecialLinkConstraints = {
  id: number;
  seasonId: number;
  sessionId: number;
  email: string;
  allowLeagueRegistration: boolean;
  allowedLeagueIds: number[] | null;
};

export type PublicSpecialLinkStatus =
  | {
      valid: true;
      email: string;
      allowLeagueRegistration: boolean;
      allowedLeagueIds: number[] | null;
      requiresLogin: boolean;
      seasonId: number;
      sessionId: number;
      seasonName: string;
      sessionName: string;
    }
  | { valid: false; reason: 'used' | 'invalidated' | 'not_found' };

function normalizeDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function parseAllowedLeagueIds(value: unknown): number[] | null {
  if (value == null || value === '') return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const ids = parsed
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? [...new Set(ids)] : [];
}

export function serializeAllowedLeagueIds(ids: number[] | null | undefined): number[] | null {
  if (!ids || ids.length === 0) return null;
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

export function constraintsFromSpecialLinkRow(row: RegistrationSpecialLinkRow): RegistrationSpecialLinkConstraints {
  const allowLeagueRegistration = row.allow_league_registration === 1;
  return {
    id: row.id,
    seasonId: row.season_id,
    sessionId: row.session_id,
    email: normalizeEmail(row.registrant_email),
    allowLeagueRegistration,
    allowedLeagueIds: allowLeagueRegistration ? parseAllowedLeagueIds(row.allowed_league_ids) : null,
  };
}

export function specialLinkIsUsable(row: Pick<RegistrationSpecialLinkRow, 'used' | 'invalidated'>): boolean {
  return row.used !== 1 && row.invalidated !== 1;
}

export function emailsMatchForSpecialLink(expected: string, actual: string | null | undefined): boolean {
  if (!actual?.trim()) return false;
  return normalizeEmail(expected) === normalizeEmail(actual);
}

export function specialLinkAllowsMembershipOption(
  constraints: RegistrationSpecialLinkConstraints,
  membershipOption: string,
): boolean {
  if (constraints.allowLeagueRegistration) return true;
  return membershipOption === 'regular' || membershipOption === 'regular_spare_only' || membershipOption === 'social';
}

export function specialLinkAllowsIcePrivileges(
  constraints: RegistrationSpecialLinkConstraints,
  choice: string,
): boolean {
  if (constraints.allowLeagueRegistration) return true;
  return choice === 'basic_ice' || choice === 'none';
}

export function filterLeaguesForSpecialLink<T extends { id: number }>(
  leagues: Record<number, T>,
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
): Record<number, T> {
  if (!constraints) return leagues;
  if (!constraints.allowLeagueRegistration) return {};
  const allowed = new Set(constraints.allowedLeagueIds ?? []);
  if (allowed.size === 0) return {};
  return Object.fromEntries(Object.entries(leagues).filter(([, league]) => allowed.has(league.id)));
}

export function applySpecialLinkOverlayToWindowState(
  state: 'closed' | 'priority' | 'open',
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
  windowIds: { seasonId: number; sessionId: number },
): 'closed' | 'priority' | 'open' {
  if (state !== 'closed' || !constraints) return state;
  if (constraints.seasonId !== windowIds.seasonId || constraints.sessionId !== windowIds.sessionId) return state;
  return 'open';
}

export function readSpecialLinkTokenFromRequest(
  headers: FastifyRequest['headers'] | Record<string, unknown> | undefined,
): string | null {
  if (!headers) return null;
  const raw =
    (headers as Record<string, unknown>)[REGISTRATION_SPECIAL_LINK_HEADER] ??
    (headers as Record<string, unknown>)[REGISTRATION_SPECIAL_LINK_HEADER.toUpperCase()];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function specialLinkTokenFromRequest(request?: FastifyRequest): string | null {
  if (request) {
    const decorated = (request as SpecialLinkDecoratedRequest)[REQUEST_LINK_KEY];
    if (typeof decorated === 'string' && decorated.trim()) return decorated.trim();
  }
  return specialLinkAls.getStore()?.token ?? null;
}

export function bindSpecialLinkOnRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const token = readSpecialLinkTokenFromRequest(request.headers);
  (request as SpecialLinkDecoratedRequest)[REQUEST_LINK_KEY] = token;
  specialLinkAls.run({ token }, () => {
    done();
  });
}

export function buildSpecialLinkRegistrationUrl(token: string, request?: Pick<FastifyRequest, 'headers'> | null): string {
  const baseUrl = resolveFrontendBaseUrl(request);
  return `${baseUrl}${REGISTRATION_SPECIAL_LINK_PATH}?slk=${encodeURIComponent(token)}`;
}

async function loadSpecialLinkByToken(token: string): Promise<RegistrationSpecialLinkRow | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.registrationSpecialLinks)
    .where(eq(schema.registrationSpecialLinks.token, trimmed))
    .limit(1);
  return (row as RegistrationSpecialLinkRow | undefined) ?? null;
}

async function loadSpecialLinkById(id: number): Promise<RegistrationSpecialLinkRow | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.registrationSpecialLinks)
    .where(eq(schema.registrationSpecialLinks.id, id))
    .limit(1);
  return (row as RegistrationSpecialLinkRow | undefined) ?? null;
}

export async function getUsableSpecialLinkByToken(token: string | null | undefined): Promise<RegistrationSpecialLinkRow | null> {
  if (!token?.trim()) return null;
  const row = await loadSpecialLinkByToken(token);
  if (!row || !specialLinkIsUsable(row)) return null;
  return row;
}

export async function resolveSpecialLinkConstraints(input: {
  specialLinkId?: number | null;
  token?: string | null;
  seasonId?: number;
  sessionId?: number;
}): Promise<RegistrationSpecialLinkConstraints | null> {
  let row: RegistrationSpecialLinkRow | null = null;
  if (input.specialLinkId != null) {
    row = await loadSpecialLinkById(input.specialLinkId);
    if (row?.invalidated === 1) return null;
  } else {
    const token = input.token ?? specialLinkTokenFromRequest();
    row = await getUsableSpecialLinkByToken(token);
  }
  if (!row) return null;
  if (input.seasonId != null && row.season_id !== input.seasonId) return null;
  if (input.sessionId != null && row.session_id !== input.sessionId) return null;
  return constraintsFromSpecialLinkRow(row);
}

export async function getPublicSpecialLinkStatus(token: string): Promise<PublicSpecialLinkStatus> {
  const row = await loadSpecialLinkByToken(token);
  if (!row) return { valid: false, reason: 'not_found' };
  if (row.invalidated === 1) return { valid: false, reason: 'invalidated' };
  if (row.used === 1) return { valid: false, reason: 'used' };

  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonId: schema.curlingSeasons.id,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, row.session_id))
    .limit(1);
  if (!session) return { valid: false, reason: 'not_found' };

  const constraints = constraintsFromSpecialLinkRow(row);
  const recognizedMemberId = await findRecognizedPersonMemberIdByEmail(constraints.email);
  return {
    valid: true,
    email: constraints.email,
    allowLeagueRegistration: constraints.allowLeagueRegistration,
    allowedLeagueIds: constraints.allowedLeagueIds,
    requiresLogin: recognizedMemberId != null,
    seasonId: session.seasonId,
    sessionId: session.id,
    seasonName: session.seasonName,
    sessionName: session.name,
  };
}

export async function listSessionLeaguesForSpecialLinkPicker(sessionId: number): Promise<Array<{ id: number; name: string }>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.leagues.id, name: schema.leagues.name })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, sessionId));
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

async function assertLeaguesBelongToSession(sessionId: number, leagueIds: number[]): Promise<void> {
  if (leagueIds.length === 0) return;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.leagues.id })
    .from(schema.leagues)
    .where(and(eq(schema.leagues.session_id, sessionId), inArray(schema.leagues.id, leagueIds)));
  const found = new Set(rows.map((row) => row.id));
  const missing = leagueIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new RegistrationSpecialLinkValidationError({
      allowedLeagueIds: 'Choose leagues from the selected session.',
    });
  }
}

export async function createRegistrationSpecialLink(input: {
  sessionId: number;
  email: string;
  label?: string | null;
  allowLeagueRegistration: boolean;
  allowedLeagueIds?: number[] | null;
  createdByMemberId: number;
}): Promise<RegistrationSpecialLinkRow> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes('@')) {
    throw new RegistrationSpecialLinkValidationError({ email: 'Enter a valid email address.' });
  }

  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select({ id: schema.curlingSessions.id, seasonId: schema.curlingSessions.season_id })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationSpecialLinkValidationError({ sessionId: 'Select a registration session.' });
  }

  const allowLeagueRegistration = input.allowLeagueRegistration === true;
  const allowedLeagueIds = allowLeagueRegistration ? serializeAllowedLeagueIds(input.allowedLeagueIds) : null;
  if (allowLeagueRegistration && (!allowedLeagueIds || allowedLeagueIds.length === 0)) {
    throw new RegistrationSpecialLinkValidationError({
      allowedLeagueIds: 'Select at least one league when league registration is allowed.',
    });
  }
  if (allowedLeagueIds) {
    await assertLeaguesBelongToSession(session.id, allowedLeagueIds);
  }

  const token = crypto.randomUUID();
  const [row] = await db
    .insert(schema.registrationSpecialLinks)
    .values({
      season_id: session.seasonId,
      session_id: session.id,
      token,
      label: input.label?.trim() || null,
      registrant_email: email,
      allow_league_registration: allowLeagueRegistration ? 1 : 0,
      allowed_league_ids:
        allowedLeagueIds == null
          ? null
          : getDatabaseConfig()?.type === 'postgres'
            ? allowedLeagueIds
            : JSON.stringify(allowedLeagueIds),
      created_by_member_id: input.createdByMemberId,
    } as never)
    .returning();
  return row as RegistrationSpecialLinkRow;
}

export async function listRegistrationSpecialLinks(sessionId: number, request?: Pick<FastifyRequest, 'headers'> | null) {
  const { db, schema } = getDrizzleDb();
  const links = await db
    .select()
    .from(schema.registrationSpecialLinks)
    .where(eq(schema.registrationSpecialLinks.session_id, sessionId))
    .orderBy(desc(schema.registrationSpecialLinks.created_at));
  const usedRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      specialLinkId: schema.curlingRegistrations.special_link_id,
    })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.session_id, sessionId));
  const usedByRegistrationId = new Map<number, number>();
  for (const row of usedRows) {
    if (row.specialLinkId != null && !usedByRegistrationId.has(row.specialLinkId)) {
      usedByRegistrationId.set(row.specialLinkId, row.id);
    }
  }
  return (links as RegistrationSpecialLinkRow[]).map((link) =>
    formatStaffSpecialLinkRow(link, usedByRegistrationId.get(link.id) ?? null, request),
  );
}

export function formatStaffSpecialLinkRow(
  link: RegistrationSpecialLinkRow,
  usedByRegistrationId: number | null,
  request?: Pick<FastifyRequest, 'headers'> | null,
) {
  const constraints = constraintsFromSpecialLinkRow(link);
  return {
    id: link.id,
    token: link.token,
    label: link.label,
    email: constraints.email,
    allowLeagueRegistration: constraints.allowLeagueRegistration,
    allowedLeagueIds: constraints.allowedLeagueIds,
    used: link.used === 1,
    invalidated: link.invalidated === 1,
    usedByRegistrationId,
    createdAt: normalizeDateTime(link.created_at) ?? '',
    usedAt: normalizeDateTime(link.used_at),
    registrationUrl: buildSpecialLinkRegistrationUrl(link.token, request),
  };
}

export async function invalidateRegistrationSpecialLink(linkId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.registrationSpecialLinks.id })
    .from(schema.registrationSpecialLinks)
    .where(eq(schema.registrationSpecialLinks.id, linkId))
    .limit(1);
  if (!row) {
    throw new RegistrationSpecialLinkValidationError({ linkId: 'Special registration link was not found.' });
  }
  await db
    .update(schema.registrationSpecialLinks)
    .set({ invalidated: 1 })
    .where(eq(schema.registrationSpecialLinks.id, linkId));
}

export async function markRegistrationSpecialLinkUsed(linkId: number, executor?: { update: Function }): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const client = executor ?? db;
  await client
    .update(schema.registrationSpecialLinks)
    .set({
      used: 1,
      used_at: new Date() as never,
    })
    .where(eq(schema.registrationSpecialLinks.id, linkId));
}

export function assertSpecialLinkEmail(
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
  email: string | null | undefined,
  field = 'email',
): void {
  if (!constraints) return;
  if (!emailsMatchForSpecialLink(constraints.email, email)) {
    throw new RegistrationSpecialLinkValidationError({
      [field]: `This registration link is assigned to ${constraints.email}.`,
    });
  }
}

export function assertSpecialLinkMembership(
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
  membershipOption: string,
): void {
  if (!constraints) return;
  if (!specialLinkAllowsMembershipOption(constraints, membershipOption)) {
    throw new RegistrationSpecialLinkValidationError({
      membershipOption: 'This registration link only allows basic ice, regular with no ice, or social membership.',
    });
  }
}

export function assertSpecialLinkIcePrivileges(
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
  choice: string,
): void {
  if (!constraints) return;
  if (!specialLinkAllowsIcePrivileges(constraints, choice)) {
    throw new RegistrationSpecialLinkValidationError({
      icePrivileges: 'This registration link does not include league registration.',
    });
  }
}

export function assertSpecialLinkLeagues(
  constraints: RegistrationSpecialLinkConstraints | null | undefined,
  leagueIds: number[],
): void {
  if (!constraints) return;
  if (!constraints.allowLeagueRegistration) {
    if (leagueIds.length > 0) {
      throw new RegistrationSpecialLinkValidationError({
        iceLeagues: 'This registration link does not include league registration.',
      });
    }
    return;
  }
  const allowed = new Set(constraints.allowedLeagueIds ?? []);
  const disallowed = leagueIds.filter((id) => !allowed.has(id));
  if (disallowed.length > 0) {
    throw new RegistrationSpecialLinkValidationError({
      iceLeagues: 'One or more selected leagues are not available on this registration link.',
    });
  }
}
