import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { eq } from 'drizzle-orm';
import { isAdmin, isServerAdmin } from '../utils/auth.js';

function normalizeDateString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function isMemberExpired(member: Member): boolean {
  // Admins/server-admins are always valid
  if (isAdmin(member) || isServerAdmin(member)) return false;

  const validThrough = normalizeDateString((member as any).valid_through);
  if (!validThrough) return false;

  // Compare as YYYY-MM-DD (UTC) to avoid TZ issues. Valid through is inclusive.
  const today = new Date().toISOString().split('T')[0];
  return today > validThrough;
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const tokenFromQuery = (request.query as any)?.token;

  const token = authHeader?.replace('Bearer ', '') || tokenFromQuery;

  if (!token) {
    return reply.code(401).send({ error: 'No token provided' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { db, schema } = getDrizzleDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, payload.memberId))
    .limit(1);
  
  const member = members[0] as Member | undefined;

  if (!member) {
    return reply.code(401).send({ error: 'Member not found' });
  }

  if (isMemberExpired(member)) {
    return reply.code(403).send({ error: 'Membership expired' });
  }

  (request as any).member = member;
}

