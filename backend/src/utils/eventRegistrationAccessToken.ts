import crypto from 'crypto';

/** 128 bytes → 256 hex characters; keeps manage URLs from fitting fully in a browser address bar. */
const EVENT_REGISTRATION_ACCESS_TOKEN_BYTES = 128;

export const EVENT_REGISTRATION_ACCESS_TOKEN_CHAR_LENGTH = EVENT_REGISTRATION_ACCESS_TOKEN_BYTES * 2;

/** Fastify defaults maxParamLength to 100; manage-registration tokens exceed that. */
export const FASTIFY_MAX_PARAM_LENGTH = 512;

export const EVENT_REGISTRATION_ACCESS_TOKEN_MIN_LENGTH = 64;

export function generateEventRegistrationAccessToken(): string {
  return crypto.randomBytes(EVENT_REGISTRATION_ACCESS_TOKEN_BYTES).toString('hex');
}

export function isLegacyEventRegistrationAccessToken(token: string | null | undefined): boolean {
  const normalized = token?.trim() ?? '';
  return normalized.length > 0 && normalized.length < EVENT_REGISTRATION_ACCESS_TOKEN_MIN_LENGTH;
}
