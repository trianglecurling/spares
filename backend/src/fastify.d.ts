import 'fastify';
import type { AuthzClaims, Member } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    member?: Member;
    authz?: AuthzClaims;
    /** Stable login identity for the current JWT (equals {@link Member.id} when not impersonating). */
    actorMemberId?: number;
    isImpersonating?: boolean;
    rawBody?: string | Buffer;
  }
}
