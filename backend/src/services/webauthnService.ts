import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { config } from '../config.js';
import type { Member } from '../types.js';
import {
  frontendOriginFromRequestHeaders,
  isAllowedFrontendBaseUrl,
  normalizeFrontendBaseUrl,
} from '../utils/frontendUrl.js';
import { isUniqueConstraintViolation } from '../api/errors.js';
import type { MemberPasskeySummary } from '../api/types.js';

export const PASSKEY_NAME_MAX_LENGTH = 80;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type WebAuthnChallengePurpose = 'registration' | 'authentication';

export class WebAuthnServiceError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'WebAuthnServiceError';
  }
}

export function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function getWebAuthnRpID(): string {
  if (config.webauthn.rpId) return config.webauthn.rpId;
  try {
    return new URL(config.frontendUrl).hostname;
  } catch {
    return 'localhost';
  }
}

export function getWebAuthnRpName(): string {
  return config.webauthn.rpName;
}

export function getConfiguredWebAuthnOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of [config.frontendUrl, ...config.frontendUrlAliases]) {
    const origin = originFromUrl(normalizeFrontendBaseUrl(url));
    if (origin) origins.add(origin);
  }
  if (origins.size === 0) {
    origins.add(`http://${getWebAuthnRpID()}`);
  }
  return [...origins];
}

export function resolveWebAuthnExpectedOrigins(
  request?: Pick<FastifyRequest, 'headers'> | null
): string[] {
  const origins = new Set(getConfiguredWebAuthnOrigins());
  if (request?.headers) {
    const candidate = frontendOriginFromRequestHeaders(request.headers);
    if (candidate && isAllowedFrontendBaseUrl(candidate)) {
      origins.add(candidate);
    }
  }
  return [...origins];
}

export function memberIdToUserHandle(memberId: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(String(memberId)) as Uint8Array<ArrayBuffer>;
}

export function userHandleToMemberId(userHandle: Uint8Array | string | null | undefined): number | null {
  if (userHandle == null) return null;
  const text = typeof userHandle === 'string' ? userHandle : new TextDecoder().decode(userHandle);
  const id = Number.parseInt(text, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function defaultPasskeyName(authenticatorAttachment?: string | null): string {
  if (authenticatorAttachment === 'platform') return 'This device';
  if (authenticatorAttachment === 'cross-platform') return 'Security key';
  return 'Passkey';
}

export function normalizePasskeyName(name: string | undefined | null, fallback: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, PASSKEY_NAME_MAX_LENGTH);
}

export function encodePublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString('base64url');
}

export function decodePublicKey(stored: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(stored, 'base64url')) as Uint8Array<ArrayBuffer>;
}

export function serializeTransports(transports: AuthenticatorTransportFuture[] | undefined): string | null {
  if (!transports || transports.length === 0) return null;
  return JSON.stringify(transports);
}

export function parseTransports(stored: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((value): value is AuthenticatorTransportFuture => typeof value === 'string');
  } catch {
    return undefined;
  }
}

function toIsoTimestamp(value: Date | string | number | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRegistrationResponse(credential: Record<string, unknown>): RegistrationResponseJSON {
  return credential as unknown as RegistrationResponseJSON;
}

function asAuthenticationResponse(credential: Record<string, unknown>): AuthenticationResponseJSON {
  return credential as unknown as AuthenticationResponseJSON;
}

async function deleteExpiredChallenges(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.webauthnChallenges)
    .where(sql`${schema.webauthnChallenges.expires_at} <= ${nowIso()}`);
}

async function storeChallenge(input: {
  purpose: WebAuthnChallengePurpose;
  challenge: string;
  memberId?: number | null;
}): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const id = randomBytes(32).toString('base64url');
  await db.insert(schema.webauthnChallenges).values({
    id,
    challenge: input.challenge,
    purpose: input.purpose,
    member_id: input.memberId ?? null,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return id;
}

async function consumeChallenge(
  challengeId: string,
  purpose: WebAuthnChallengePurpose
): Promise<{ challenge: string; memberId: number | null }> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.webauthnChallenges)
    .where(
      and(eq(schema.webauthnChallenges.id, challengeId), eq(schema.webauthnChallenges.purpose, purpose))
    )
    .limit(1);

  if (!row) {
    throw new WebAuthnServiceError(401, 'Invalid or expired passkey challenge');
  }

  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, challengeId));
    throw new WebAuthnServiceError(401, 'Invalid or expired passkey challenge');
  }

  await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, challengeId));
  return { challenge: row.challenge, memberId: row.member_id ?? null };
}

function toPasskeySummary(row: {
  id: number;
  name: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
}): MemberPasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIsoTimestamp(row.created_at) ?? nowIso(),
    lastUsedAt: toIsoTimestamp(row.last_used_at),
  };
}

export async function listMemberPasskeys(memberId: number): Promise<MemberPasskeySummary[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.webauthnCredentials.id,
      name: schema.webauthnCredentials.name,
      created_at: schema.webauthnCredentials.created_at,
      last_used_at: schema.webauthnCredentials.last_used_at,
    })
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.member_id, memberId))
    .orderBy(sql`${schema.webauthnCredentials.created_at} desc`);

  return rows.map(toPasskeySummary);
}

export async function beginPasskeyRegistration(
  member: Member
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  await deleteExpiredChallenges();
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.webauthnChallenges)
    .where(
      and(
        eq(schema.webauthnChallenges.member_id, member.id),
        eq(schema.webauthnChallenges.purpose, 'registration')
      )
    );

  const existing = await db
    .select({
      credential_id: schema.webauthnCredentials.credential_id,
      transports: schema.webauthnCredentials.transports,
    })
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.member_id, member.id));

  const options = await generateRegistrationOptions({
    rpName: getWebAuthnRpName(),
    rpID: getWebAuthnRpID(),
    userName: member.email || `member-${member.id}`,
    userDisplayName: member.name,
    userID: memberIdToUserHandle(member.id),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: parseTransports(row.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  const challengeId = await storeChallenge({
    purpose: 'registration',
    challenge: options.challenge,
    memberId: member.id,
  });

  return { challengeId, options };
}

export async function finishPasskeyRegistration(input: {
  member: Member;
  challengeId: string;
  credential: Record<string, unknown>;
  name?: string;
  request?: Pick<FastifyRequest, 'headers'> | null;
}): Promise<MemberPasskeySummary> {
  const pending = await consumeChallenge(input.challengeId, 'registration');
  if (pending.memberId !== input.member.id) {
    throw new WebAuthnServiceError(401, 'Invalid or expired passkey challenge');
  }

  const response = asRegistrationResponse(input.credential);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: resolveWebAuthnExpectedOrigins(input.request),
      expectedRPID: getWebAuthnRpID(),
      requireUserVerification: true,
    });
  } catch {
    throw new WebAuthnServiceError(400, 'Unable to verify that passkey');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new WebAuthnServiceError(400, 'Unable to verify that passkey');
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
  const fallbackName = defaultPasskeyName(
    typeof response.authenticatorAttachment === 'string' ? response.authenticatorAttachment : null
  );
  const name = normalizePasskeyName(input.name, fallbackName);
  const { db, schema } = getDrizzleDb();

  try {
    const [row] = await db
      .insert(schema.webauthnCredentials)
      .values({
        member_id: input.member.id,
        credential_id: credential.id,
        public_key: encodePublicKey(credential.publicKey),
        counter: credential.counter,
        device_type: credentialDeviceType ?? null,
        backed_up: credentialBackedUp ? 1 : 0,
        transports: serializeTransports(credential.transports ?? response.response.transports),
        aaguid: aaguid ?? null,
        name,
      })
      .returning();

    if (!row) {
      throw new WebAuthnServiceError(500, 'Failed to save passkey');
    }
    return toPasskeySummary(row);
  } catch (error) {
    if (error instanceof WebAuthnServiceError) throw error;
    if (isUniqueConstraintViolation(error)) {
      throw new WebAuthnServiceError(409, 'That passkey is already registered');
    }
    throw error;
  }
}

export async function renameMemberPasskey(
  memberId: number,
  passkeyId: number,
  name: string
): Promise<MemberPasskeySummary> {
  const normalized = normalizePasskeyName(name, '');
  if (!normalized) {
    throw new WebAuthnServiceError(400, 'Passkey name is required');
  }

  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select()
    .from(schema.webauthnCredentials)
    .where(
      and(eq(schema.webauthnCredentials.id, passkeyId), eq(schema.webauthnCredentials.member_id, memberId))
    )
    .limit(1);

  if (!existing) {
    throw new WebAuthnServiceError(404, 'Passkey not found');
  }

  const [row] = await db
    .update(schema.webauthnCredentials)
    .set({ name: normalized })
    .where(eq(schema.webauthnCredentials.id, passkeyId))
    .returning();

  if (!row) {
    throw new WebAuthnServiceError(404, 'Passkey not found');
  }
  return toPasskeySummary(row);
}

export async function deleteMemberPasskey(memberId: number, passkeyId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const deleted = await db
    .delete(schema.webauthnCredentials)
    .where(
      and(eq(schema.webauthnCredentials.id, passkeyId), eq(schema.webauthnCredentials.member_id, memberId))
    )
    .returning({ id: schema.webauthnCredentials.id });

  if (deleted.length === 0) {
    throw new WebAuthnServiceError(404, 'Passkey not found');
  }
}

export async function beginPasskeyAuthentication(): Promise<{
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  await deleteExpiredChallenges();
  const options = await generateAuthenticationOptions({
    rpID: getWebAuthnRpID(),
    userVerification: 'required',
  });
  const challengeId = await storeChallenge({
    purpose: 'authentication',
    challenge: options.challenge,
  });
  return { challengeId, options };
}

export async function finishPasskeyAuthentication(input: {
  challengeId: string;
  credential: Record<string, unknown>;
  request?: Pick<FastifyRequest, 'headers'> | null;
}): Promise<Member> {
  const pending = await consumeChallenge(input.challengeId, 'authentication');
  const response = asAuthenticationResponse(input.credential);
  const credentialId = typeof response.id === 'string' ? response.id : null;
  if (!credentialId) {
    throw new WebAuthnServiceError(400, 'Unable to verify that passkey');
  }

  const { db, schema } = getDrizzleDb();
  const [passkey] = await db
    .select()
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.credential_id, credentialId))
    .limit(1);

  if (!passkey) {
    throw new WebAuthnServiceError(401, 'Invalid passkey');
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: resolveWebAuthnExpectedOrigins(input.request),
      expectedRPID: getWebAuthnRpID(),
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: decodePublicKey(passkey.public_key),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
      },
    });
  } catch {
    throw new WebAuthnServiceError(401, 'Invalid passkey');
  }

  if (!verification.verified || !verification.authenticationInfo) {
    throw new WebAuthnServiceError(401, 'Invalid passkey');
  }

  const handleMemberId = userHandleToMemberId(
    response.response.userHandle
      ? new Uint8Array(Buffer.from(response.response.userHandle, 'base64url'))
      : null
  );
  if (handleMemberId != null && handleMemberId !== passkey.member_id) {
    throw new WebAuthnServiceError(401, 'Invalid passkey');
  }

  await db
    .update(schema.webauthnCredentials)
    .set({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date(),
    })
    .where(eq(schema.webauthnCredentials.id, passkey.id));

  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, passkey.member_id))
    .limit(1);

  if (!member) {
    throw new WebAuthnServiceError(401, 'Invalid passkey');
  }

  return member as Member;
}
