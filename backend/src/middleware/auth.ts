import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { eq } from 'drizzle-orm';
import { recordDailyActivity } from '../services/observability.js';
import { buildAuthzClaimsForMember, buildAuthzClaimsForImpersonatedMember } from '../utils/rbac.js';
import { getMemberMembershipStatus } from '../services/memberMembershipStatusService.js';
import {
  findMemberByPersonalAccessToken,
  looksLikePersonalAccessToken,
} from '../services/personalAccessTokenService.js';

function readBearerToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  const tokenFromQuery = (() => {
    if (request.query && typeof request.query === 'object' && 'token' in request.query) {
      return (request.query as { token?: string }).token;
    }
    return undefined;
  })();
  return authHeader?.replace('Bearer ', '') || tokenFromQuery;
}

async function attachMember(
  request: FastifyRequest,
  member: Member,
  actorMemberId: number
): Promise<void> {
  const isImpersonating = actorMemberId !== member.id;
  member.impersonationSession = isImpersonating;
  member.membershipStatus = await getMemberMembershipStatus(member.id, {
    isLifetimeMember: (member.lifetime_member ?? 0) === 1,
  });
  member.authz = isImpersonating
    ? await buildAuthzClaimsForImpersonatedMember(member)
    : await buildAuthzClaimsForMember(member);
  request.authz = member.authz;
  request.actorMemberId = actorMemberId;
  request.isImpersonating = isImpersonating;
  request.member = member;
  recordDailyActivity(member.id).catch(() => {});
}

async function resolveAuthenticatedMember(
  token: string
): Promise<{ member: Member; actorMemberId: number } | null> {
  if (looksLikePersonalAccessToken(token)) {
    const member = await findMemberByPersonalAccessToken(token);
    if (!member) return null;
    return { member, actorMemberId: member.id };
  }

  const payload = verifyToken(token);
  if (!payload) return null;

  const { db, schema } = getDrizzleDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, payload.memberId))
    .limit(1);
  const member = members[0] as Member | undefined;
  if (!member) return null;

  return {
    member,
    actorMemberId: payload.actorMemberId ?? payload.memberId,
  };
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = readBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'No token provided' });
  }

  const resolved = await resolveAuthenticatedMember(token);
  if (!resolved) {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  await attachMember(request, resolved.member, resolved.actorMemberId);
}

/**
 * When a Bearer token is present and valid, sets `request.member` (and authz) like {@link authMiddleware}.
 * Missing or invalid auth leaves the request unauthenticated without an error response.
 */
export async function optionalAuthMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  const token = readBearerToken(request);
  if (!token) return;
  const resolved = await resolveAuthenticatedMember(token);
  if (!resolved) return;
  await attachMember(request, resolved.member, resolved.actorMemberId);
}
