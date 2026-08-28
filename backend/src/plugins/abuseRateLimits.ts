import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { isIpLimitBypassed } from '../utils/abuseProtection.js';

function clientIp(request: FastifyRequest): string {
  return request.ip || 'unknown';
}

function contactFromBody(request: FastifyRequest): string {
  const body = request.body as { contact?: unknown; email?: unknown } | undefined;
  if (typeof body?.contact === 'string' && body.contact.trim()) {
    return body.contact.trim().toLowerCase();
  }
  if (typeof body?.email === 'string' && body.email.trim()) {
    return body.email.trim().toLowerCase();
  }
  return '';
}

const rateLimitError = (message: string) => () => ({ error: message });

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function shouldBypassIpLimit(request: FastifyRequest): boolean {
  return isIpLimitBypassed(request.ip);
}

/**
 * Global + route-group rate limits. Requires Fastify `trustProxy` when behind nginx.
 *
 * Reads use a higher ceiling so SPA bootstrap/navigation (many parallel GETs) does not
 * 429 public pages; writes stay tighter. Abuse-sensitive POSTs have stricter route limits.
 * IPs in `IP_LIMIT_BYPASS_ALLOWLIST` skip these per-IP limits.
 */
export async function registerAbuseRateLimits(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    max: (request) => (isReadMethod(request.method) ? 600 : 120),
    keyGenerator: (request) =>
      `${clientIp(request)}:${isReadMethod(request.method) ? 'read' : 'write'}`,
    errorResponseBuilder: rateLimitError('Too many requests. Please try again later.'),
    allowList: (request) => {
      if (shouldBypassIpLimit(request)) return true;
      const path = request.url.split('?')[0] ?? '';
      return path === '/api/health' || path.startsWith('/api/payments/webhooks/');
    },
  });
}

/** Apply tighter limits on an already-declared route via `config.rateLimit`. */
export const abuseRouteRateLimits = {
  authRequestCode: {
    // preHandler so JSON body is available for IP+contact keys
    hook: 'preHandler' as const,
    max: 5,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => {
      const contact = contactFromBody(request);
      return `auth-request:${clientIp(request)}:${contact || 'none'}`;
    },
    errorResponseBuilder: rateLimitError('Too many login code requests. Please try again later.'),
  },
  authVerify: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => {
      const contact = contactFromBody(request);
      return `auth-verify:${clientIp(request)}:${contact || 'none'}`;
    },
    errorResponseBuilder: rateLimitError('Too many login attempts. Please try again later.'),
  },
  authSelect: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `auth-select:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many login attempts. Please try again later.'),
  },
  authToken: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `auth-token:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many login attempts. Please try again later.'),
  },
  authPasskey: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `auth-passkey:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many login attempts. Please try again later.'),
  },
  contact: {
    hook: 'preHandler' as const,
    max: 5,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `contact:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many contact requests. Please try again later.'),
  },
  mailingList: {
    hook: 'preHandler' as const,
    max: 5,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `mailing-list:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many subscription requests. Please try again later.'),
  },
  feedback: {
    hook: 'preHandler' as const,
    max: 5,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `feedback:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many feedback submissions. Please try again later.'),
  },
  eventRegister: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `event-register:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many registration attempts. Please try again later.'),
  },
  guestRegistration: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `guest-reg:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many registration attempts. Please try again later.'),
  },
  expenseSubmit: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '1 hour' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `expense-submit:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many expense submissions. Please try again later.'),
  },
  registrationEarlyAccessUnlock: {
    hook: 'preHandler' as const,
    max: 10,
    timeWindow: '15 minutes' as const,
    allowList: shouldBypassIpLimit,
    keyGenerator: (request: FastifyRequest) => `reg-early-access:${clientIp(request)}`,
    errorResponseBuilder: rateLimitError('Too many early access attempts. Please try again later.'),
  },
};
