import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentDateStringAsync, getCurrentTimeAsync } from '../utils/time.js';
import { formatDateInTimeZone } from '../utils/timeZone.js';
import { config } from '../config.js';
import { isCredentialsManager } from '../utils/auth.js';
import type { Member } from '../types.js';
import { ageInYearsOnDate } from '../utils/memberAge.js';
import { isArchivedAt, notArchivedCondition } from '../utils/softDelete.js';
import {
  memberHoldsSystemCredential,
  parseSystemCredentialKey,
  systemCredentialDefinition,
  type SystemCredentialKey,
} from '../utils/systemCredentials.js';
import { volunteerCredentialIsValidOn } from '../utils/volunteerCredentials.js';
import { normalizeMemberDateOfBirth } from './memberDemographics.js';
import {
  getMemberMembershipStatus,
  hasIcePrivilegesForRbac,
  isMemberActiveForRbac,
} from './memberMembershipStatusService.js';
import { CredentialServiceError } from './credentialServiceError.js';

export type CredentialSummary = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
  systemKey: SystemCredentialKey | null;
};

export type CredentialOption = {
  id: number;
  name: string;
};

export type HubCredential = CredentialSummary & {
  held: boolean;
  expiresAt: string | null;
};

export type MemberCredentialView = {
  id: number;
  name: string;
  description: string | null;
  expiresAt: string | null;
  systemKey: SystemCredentialKey | null;
};

export type CredentialMemberSummary = {
  id: number;
  name: string;
  email: string | null;
};

export type CredentialAdminView = CredentialSummary & {
  systemGrantRule: string | null;
  archivedAt: string | null;
  managers: CredentialMemberSummary[];
  grants: Array<{
    id: number;
    memberId: number;
    memberName: string;
    memberEmail: string | null;
    grantedAt: string;
    grantedByMemberId: number | null;
    expiresAt: string | null;
  }>;
};

function toIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function requireIso(value: string | Date | null | undefined, label: string): string {
  const iso = toIso(value);
  if (!iso) throw new CredentialServiceError(`${label} is required`);
  return iso;
}

function parseOptionalDateOnly(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CredentialServiceError(`Invalid ${label}`);
  }
  const d = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new CredentialServiceError(`Invalid ${label}`);
  }
  return trimmed;
}

function normalizeDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function clubDateOnly(instant: Date): string {
  return formatDateInTimeZone(instant, config.timeZone) ?? instant.toISOString().slice(0, 10);
}

async function getSystemCredentialRows(): Promise<Array<{ id: number; systemKey: SystemCredentialKey }>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerCredentials.id,
      systemKey: schema.volunteerCredentials.system_key,
    })
    .from(schema.volunteerCredentials)
    .where(isNotNull(schema.volunteerCredentials.system_key));
  return rows.flatMap((row) => {
    const systemKey = parseSystemCredentialKey(row.systemKey);
    return systemKey ? [{ id: row.id, systemKey }] : [];
  });
}

async function getHeldSystemCredentialGrants(
  memberId: number
): Promise<Array<{ credentialId: number; expiresAt: null }>> {
  const systemCredentials = await getSystemCredentialRows();
  if (systemCredentials.length === 0) return [];

  const { db, schema } = getDrizzleDb();
  const [member] = await db
    .select({
      id: schema.members.id,
      lifetime_member: schema.members.lifetime_member,
      dateOfBirth: schema.members.date_of_birth,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  if (!member) return [];

  const today = await getCurrentDateStringAsync();
  const membershipStatus = await getMemberMembershipStatus(memberId, {
    isLifetimeMember: (member.lifetime_member ?? 0) === 1,
    today,
  });
  const facts = {
    isCurrentMember: isMemberActiveForRbac(member, membershipStatus),
    hasIcePrivileges: hasIcePrivilegesForRbac(member, membershipStatus),
    ageYears: ageInYearsOnDate(normalizeMemberDateOfBirth(member.dateOfBirth), today),
  };

  return systemCredentials
    .filter((credential) => memberHoldsSystemCredential(credential.systemKey, facts))
    .map((credential) => ({ credentialId: credential.id, expiresAt: null }));
}

async function assertManualCredential(credentialId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.volunteerCredentials.id,
      systemKey: schema.volunteerCredentials.system_key,
    })
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, credentialId))
    .limit(1);
  if (!row) throw new CredentialServiceError('Credential not found', 404);
  if (parseSystemCredentialKey(row.systemKey)) {
    throw new CredentialServiceError('This credential is granted automatically', 400);
  }
}

async function isAssignedCredentialManager(credentialId: number, memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.volunteerCredentialManagers.id })
    .from(schema.volunteerCredentialManagers)
    .where(
      and(
        eq(schema.volunteerCredentialManagers.credential_id, credentialId),
        eq(schema.volunteerCredentialManagers.member_id, memberId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function listAssignedManagedCredentialIds(memberId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ credentialId: schema.volunteerCredentialManagers.credential_id })
    .from(schema.volunteerCredentialManagers)
    .where(eq(schema.volunteerCredentialManagers.member_id, memberId));
  return rows.map((row) => row.credentialId);
}

export async function canManageCredential(member: Member, credentialId?: number): Promise<boolean> {
  if (isCredentialsManager(member)) return true;
  if (credentialId && member.id) return isAssignedCredentialManager(credentialId, member.id);
  return false;
}

export async function listManagedCredentialIds(member: Member): Promise<number[] | 'all'> {
  if (isCredentialsManager(member)) return 'all';
  return listAssignedManagedCredentialIds(member.id);
}

async function replaceCredentialManagers(credentialId: number, managerIds: number[]): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.volunteerCredentialManagers)
    .where(eq(schema.volunteerCredentialManagers.credential_id, credentialId));
  const unique = [...new Set(managerIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return;
  await db.insert(schema.volunteerCredentialManagers).values(
    unique.map((memberId) => ({
      credential_id: credentialId,
      member_id: memberId,
    }))
  );
}

export async function createCredential(input: {
  name: string;
  description?: string | null;
  pointOfContactEmail: string;
  managerIds?: number[];
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const name = input.name.trim();
  const email = input.pointOfContactEmail.trim();
  if (!name) throw new CredentialServiceError('Credential name is required');
  if (!email) throw new CredentialServiceError('Point of contact email is required');

  const [row] = await db
    .insert(schema.volunteerCredentials)
    .values({
      name,
      description: input.description?.trim() || null,
      point_of_contact_email: email,
    } as any)
    .returning({ id: schema.volunteerCredentials.id });

  await replaceCredentialManagers(row.id, input.managerIds ?? []);
  return { id: row.id };
}

export async function updateCredential(
  credentialId: number,
  input: {
    name?: string;
    description?: string | null;
    pointOfContactEmail?: string;
    managerIds?: number[];
  }
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, credentialId))
    .limit(1);
  if (!existing[0]) throw new CredentialServiceError('Credential not found', 404);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new CredentialServiceError('Credential name is required');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.pointOfContactEmail !== undefined) {
    const email = input.pointOfContactEmail.trim();
    if (!email) throw new CredentialServiceError('Point of contact email is required');
    patch.point_of_contact_email = email;
  }

  await db
    .update(schema.volunteerCredentials)
    .set(patch as any)
    .where(eq(schema.volunteerCredentials.id, credentialId));

  if (input.managerIds !== undefined) {
    await replaceCredentialManagers(credentialId, input.managerIds);
  }
}

export async function deleteCredential(credentialId: number): Promise<void> {
  await assertManualCredential(credentialId);
  throw new CredentialServiceError('Credentials cannot be deleted. Archive them instead.');
}

export async function archiveCredential(credentialId: number, archive: boolean): Promise<void> {
  await assertManualCredential(credentialId);
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.volunteerCredentials)
    .set({
      archived_at: archive ? new Date() : null,
      updated_at: new Date(),
    } as any)
    .where(eq(schema.volunteerCredentials.id, credentialId));
}

export async function grantCredential(input: {
  credentialId: number;
  memberId: number;
  grantedByMemberId: number;
  expiresAt?: string | null;
}): Promise<{ id: number; expiresAt: string | null }> {
  await assertManualCredential(input.credentialId);
  const { db, schema } = getDrizzleDb();
  const [credential] = await db
    .select({ archivedAt: schema.volunteerCredentials.archived_at })
    .from(schema.volunteerCredentials)
    .where(eq(schema.volunteerCredentials.id, input.credentialId))
    .limit(1);
  if (credential && isArchivedAt(credential.archivedAt)) {
    throw new CredentialServiceError('This credential is archived');
  }

  const member = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member[0]) throw new CredentialServiceError('Member not found', 404);

  const existing = await db
    .select({ id: schema.memberVolunteerCredentials.id })
    .from(schema.memberVolunteerCredentials)
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, input.memberId),
        eq(schema.memberVolunteerCredentials.credential_id, input.credentialId)
      )
    )
    .limit(1);
  if (existing[0]) throw new CredentialServiceError('Member already has this credential', 409);

  const expiresAt = parseOptionalDateOnly(input.expiresAt, 'expiration date');
  const [row] = await db
    .insert(schema.memberVolunteerCredentials)
    .values({
      member_id: input.memberId,
      credential_id: input.credentialId,
      granted_by_member_id: input.grantedByMemberId,
      expires_at: expiresAt,
    } as any)
    .returning({ id: schema.memberVolunteerCredentials.id });

  return { id: row.id, expiresAt };
}

export async function updateCredentialGrant(
  credentialId: number,
  memberId: number,
  expiresAt: string | null
): Promise<void> {
  await assertManualCredential(credentialId);
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.memberVolunteerCredentials.id })
    .from(schema.memberVolunteerCredentials)
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, memberId),
        eq(schema.memberVolunteerCredentials.credential_id, credentialId)
      )
    )
    .limit(1);
  if (!existing[0]) throw new CredentialServiceError('Credential grant not found', 404);
  const nextExpiresAt = parseOptionalDateOnly(expiresAt, 'expiration date');
  await db
    .update(schema.memberVolunteerCredentials)
    .set({ expires_at: nextExpiresAt } as any)
    .where(eq(schema.memberVolunteerCredentials.id, existing[0].id));
}

export async function revokeCredential(credentialId: number, memberId: number): Promise<void> {
  await assertManualCredential(credentialId);
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.memberVolunteerCredentials.id })
    .from(schema.memberVolunteerCredentials)
    .where(
      and(
        eq(schema.memberVolunteerCredentials.member_id, memberId),
        eq(schema.memberVolunteerCredentials.credential_id, credentialId)
      )
    )
    .limit(1);
  if (!existing[0]) throw new CredentialServiceError('Credential grant not found', 404);
  await db
    .delete(schema.memberVolunteerCredentials)
    .where(eq(schema.memberVolunteerCredentials.id, existing[0].id));
}

export async function listCredentialsAdmin(
  member: Member,
  options?: { includeArchived?: boolean }
): Promise<CredentialAdminView[]> {
  const { db, schema } = getDrizzleDb();
  const managedIds = await listManagedCredentialIds(member);

  let credentials = await db.select().from(schema.volunteerCredentials).orderBy(asc(schema.volunteerCredentials.name));
  if (managedIds !== 'all') {
    const idSet = new Set(managedIds);
    credentials = credentials.filter((c) => idSet.has(c.id));
  }
  if (!options?.includeArchived) {
    credentials = credentials.filter((c) => !isArchivedAt(c.archived_at));
  }

  if (credentials.length === 0) return [];

  const credentialIds = credentials.map((c) => c.id);
  const managers = await db
    .select({
      credentialId: schema.volunteerCredentialManagers.credential_id,
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.volunteerCredentialManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.volunteerCredentialManagers.member_id))
    .where(inArray(schema.volunteerCredentialManagers.credential_id, credentialIds));

  const grants = await db
    .select({
      id: schema.memberVolunteerCredentials.id,
      credentialId: schema.memberVolunteerCredentials.credential_id,
      memberId: schema.members.id,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
      grantedAt: schema.memberVolunteerCredentials.granted_at,
      grantedByMemberId: schema.memberVolunteerCredentials.granted_by_member_id,
      expiresAt: schema.memberVolunteerCredentials.expires_at,
    })
    .from(schema.memberVolunteerCredentials)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberVolunteerCredentials.member_id))
    .where(inArray(schema.memberVolunteerCredentials.credential_id, credentialIds));

  return credentials.map((c) => {
    const systemKey = parseSystemCredentialKey(c.system_key);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      pointOfContactEmail: c.point_of_contact_email,
      systemKey,
      systemGrantRule: systemKey ? systemCredentialDefinition(systemKey).grantRule : null,
      archivedAt: toIso(c.archived_at),
      managers: managers
        .filter((m) => m.credentialId === c.id)
        .map((m) => ({ id: m.id, name: m.name, email: m.email })),
      grants: systemKey
        ? []
        : grants
            .filter((g) => g.credentialId === c.id)
            .map((g) => ({
              id: g.id,
              memberId: g.memberId,
              memberName: g.memberName,
              memberEmail: g.memberEmail,
              grantedAt: requireIso(g.grantedAt as any, 'grantedAt'),
              grantedByMemberId: g.grantedByMemberId,
              expiresAt: normalizeDateOnly(g.expiresAt),
            })),
    };
  });
}

export async function getCredentialAdmin(member: Member, credentialId: number): Promise<CredentialAdminView> {
  if (!(await canManageCredential(member, credentialId))) {
    throw new CredentialServiceError('Forbidden', 403);
  }
  const credentials = await listCredentialsAdmin(member, { includeArchived: true });
  const found = credentials.find((credential) => credential.id === credentialId);
  if (!found) throw new CredentialServiceError('Credential not found', 404);
  return found;
}

export async function listCredentialOptions(): Promise<CredentialOption[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.volunteerCredentials.id,
      name: schema.volunteerCredentials.name,
    })
    .from(schema.volunteerCredentials)
    .where(notArchivedCondition(schema.volunteerCredentials.archived_at))
    .orderBy(asc(schema.volunteerCredentials.name));
  return rows;
}

export async function listMemberCredentials(memberId: number): Promise<MemberCredentialView[]> {
  const { db, schema } = getDrizzleDb();
  const [rows, grants] = await Promise.all([
    db
      .select({
        id: schema.volunteerCredentials.id,
        name: schema.volunteerCredentials.name,
        description: schema.volunteerCredentials.description,
        systemKey: schema.volunteerCredentials.system_key,
        expiresAt: schema.memberVolunteerCredentials.expires_at,
      })
      .from(schema.memberVolunteerCredentials)
      .innerJoin(
        schema.volunteerCredentials,
        eq(schema.volunteerCredentials.id, schema.memberVolunteerCredentials.credential_id)
      )
      .where(eq(schema.memberVolunteerCredentials.member_id, memberId)),
    getHeldSystemCredentialGrants(memberId),
  ]);

  const byId = new Map<number, MemberCredentialView>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description,
      expiresAt: normalizeDateOnly(row.expiresAt),
      systemKey: parseSystemCredentialKey(row.systemKey),
    });
  }

  if (grants.length > 0) {
    const missingIds = grants.map((grant) => grant.credentialId).filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      const systemRows = await db
        .select({
          id: schema.volunteerCredentials.id,
          name: schema.volunteerCredentials.name,
          description: schema.volunteerCredentials.description,
          systemKey: schema.volunteerCredentials.system_key,
        })
        .from(schema.volunteerCredentials)
        .where(inArray(schema.volunteerCredentials.id, missingIds));
      for (const row of systemRows) {
        byId.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          expiresAt: null,
          systemKey: parseSystemCredentialKey(row.systemKey),
        });
      }
    }
    for (const grant of grants) {
      const existing = byId.get(grant.credentialId);
      if (existing) existing.expiresAt = null;
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listMyCredentials(memberId: number): Promise<CredentialSummary[]> {
  const { db, schema } = getDrizzleDb();
  const today = clubDateOnly(await getCurrentTimeAsync());
  const [rows, grants] = await Promise.all([
    db
      .select({
        id: schema.volunteerCredentials.id,
        name: schema.volunteerCredentials.name,
        description: schema.volunteerCredentials.description,
        pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
        systemKey: schema.volunteerCredentials.system_key,
        expiresAt: schema.memberVolunteerCredentials.expires_at,
      })
      .from(schema.memberVolunteerCredentials)
      .innerJoin(
        schema.volunteerCredentials,
        eq(schema.volunteerCredentials.id, schema.memberVolunteerCredentials.credential_id)
      )
      .where(eq(schema.memberVolunteerCredentials.member_id, memberId)),
    getHeldSystemCredentialGrants(memberId),
  ]);

  const byId = new Map<number, CredentialSummary>();
  for (const row of rows) {
    if (!volunteerCredentialIsValidOn(normalizeDateOnly(row.expiresAt), today)) continue;
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description,
      pointOfContactEmail: row.pointOfContactEmail,
      systemKey: parseSystemCredentialKey(row.systemKey),
    });
  }

  if (grants.length > 0) {
    const missingIds = grants.map((grant) => grant.credentialId).filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      const systemRows = await db
        .select({
          id: schema.volunteerCredentials.id,
          name: schema.volunteerCredentials.name,
          description: schema.volunteerCredentials.description,
          pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
          systemKey: schema.volunteerCredentials.system_key,
        })
        .from(schema.volunteerCredentials)
        .where(inArray(schema.volunteerCredentials.id, missingIds));
      for (const row of systemRows) {
        byId.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          pointOfContactEmail: row.pointOfContactEmail,
          systemKey: parseSystemCredentialKey(row.systemKey),
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMemberCredentialGrants(
  memberId: number
): Promise<Array<{ credentialId: number; expiresAt: string | null }>> {
  const { db, schema } = getDrizzleDb();
  const [rows, systemGrants] = await Promise.all([
    db
      .select({
        credentialId: schema.memberVolunteerCredentials.credential_id,
        expiresAt: schema.memberVolunteerCredentials.expires_at,
      })
      .from(schema.memberVolunteerCredentials)
      .where(eq(schema.memberVolunteerCredentials.member_id, memberId)),
    getHeldSystemCredentialGrants(memberId),
  ]);
  const byId = new Map<number, { credentialId: number; expiresAt: string | null }>();
  for (const row of rows) {
    byId.set(row.credentialId, {
      credentialId: row.credentialId,
      expiresAt: normalizeDateOnly(row.expiresAt),
    });
  }
  for (const grant of systemGrants) {
    byId.set(grant.credentialId, grant);
  }
  return [...byId.values()];
}

export async function listHubCredentials(memberId: number): Promise<HubCredential[]> {
  const { db, schema } = getDrizzleDb();
  const today = clubDateOnly(await getCurrentTimeAsync());
  const [credentials, grants] = await Promise.all([
    db
      .select({
        id: schema.volunteerCredentials.id,
        name: schema.volunteerCredentials.name,
        description: schema.volunteerCredentials.description,
        pointOfContactEmail: schema.volunteerCredentials.point_of_contact_email,
        systemKey: schema.volunteerCredentials.system_key,
        archivedAt: schema.volunteerCredentials.archived_at,
      })
      .from(schema.volunteerCredentials)
      .orderBy(asc(schema.volunteerCredentials.name)),
    getMemberCredentialGrants(memberId),
  ]);
  const grantByCredentialId = new Map(grants.map((grant) => [grant.credentialId, grant]));
  return credentials
    .filter((c) => !isArchivedAt(c.archivedAt))
    .map((c) => {
    const grant = grantByCredentialId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      pointOfContactEmail: c.pointOfContactEmail,
      systemKey: parseSystemCredentialKey(c.systemKey),
      held: grant ? volunteerCredentialIsValidOn(grant.expiresAt, today) : false,
      expiresAt: grant?.expiresAt ?? null,
    };
  });
}
