import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { eq } from 'drizzle-orm';

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

  (request as any).member = member;
}

