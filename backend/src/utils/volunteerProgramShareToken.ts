import crypto from 'crypto';

const VOLUNTEER_PROGRAM_SHARE_TOKEN_BYTES = 32;

export function generateVolunteerProgramShareToken(): string {
  return crypto.randomBytes(VOLUNTEER_PROGRAM_SHARE_TOKEN_BYTES).toString('hex');
}

/** Constant-time check for the unguessable token on an unlisted sign-up URL. */
export function volunteerProgramShareTokensMatch(
  expected: string | null | undefined,
  provided: string | null | undefined
): boolean {
  const actual = Buffer.from(String(expected ?? '').trim());
  const candidate = Buffer.from(String(provided ?? '').trim());
  if (actual.length === 0 || actual.length !== candidate.length) return false;
  return crypto.timingSafeEqual(actual, candidate);
}
