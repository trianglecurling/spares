import crypto from 'crypto';

const VOLUNTEER_SIGNUP_ACCESS_TOKEN_BYTES = 32;

export function generateVolunteerSignupAccessToken(): string {
  return crypto.randomBytes(VOLUNTEER_SIGNUP_ACCESS_TOKEN_BYTES).toString('hex');
}
