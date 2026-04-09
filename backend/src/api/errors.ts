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
