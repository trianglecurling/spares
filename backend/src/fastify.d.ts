import 'fastify';
import type { AuthzClaims, Member } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    member?: Member;
    authz?: AuthzClaims;
    rawBody?: string | Buffer;
  }
}
