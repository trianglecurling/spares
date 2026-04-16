import type { FastifyReply } from 'fastify';

export function apiErrorPayload(error: string, details?: unknown) {
  return details === undefined ? { error } : { error, details };
}

export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  details?: unknown
) {
  return reply.code(statusCode).send(apiErrorPayload(error, details));
}

export function sendValidationError(reply: FastifyReply, error: string, details: unknown) {
  return sendApiError(reply, 400, error, details);
}

/** Postgres 23505 = unique_violation; also handles SQLite and wrapped driver errors. */
export function isUniqueConstraintViolation(err: unknown): boolean {
  const visit = (e: unknown, depth: number): boolean => {
    if (depth > 8 || e == null) return false;
    if (typeof e !== 'object') return false;
    const o = e as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = String(o.message ?? '').toLowerCase();
    const code = String(o.code ?? '');
    if (code === '23505') return true;
    if (
      msg.includes('unique') ||
      msg.includes('duplicate key') ||
      msg.includes('sql_constraint_unique') ||
      msg.includes('sqlite_constraint')
    ) {
      return true;
    }
    return visit(o.cause, depth + 1);
  };
  return visit(err, 0);
}
