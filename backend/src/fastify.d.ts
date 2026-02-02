import 'fastify';
import type { Member } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    member?: Member;
  }
}
