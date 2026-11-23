import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isDonationsManager } from '../utils/auth.js';
import { toCsv } from '../utils/csv.js';
import {
  defaultDonationCollectionItemName,
  donationCollectionWindowStatus,
  formatDonationMoney,
  normalizeSuggestedAmountsMinor,
  parseStoredSuggestedAmounts,
  type DonationCollectionWindowStatus,
} from '../utils/donationCollections.js';
import { slugify } from '../utils/slugify.js';
import { getCurrentDateString } from '../utils/time.js';
import { config } from '../config.js';

export class DonationCollectionServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'DonationCollectionServiceError';
  }
}

export type DonationCollectionManagerSummary = {
  id: number;
  name: string;
  email: string | null;
};

export type DonationCollectionSummary = {
  id: number;
  name: string;
  slug: string;
  causeName: string;
  description: string | null;
  startDate: string;
  endDate: string;
  minimumAmountMinor: number;
  suggestedAmountsMinor: number[];
  paymentItemName: string | null;
  defaultItemName: string;
  status: DonationCollectionWindowStatus;
  totalRaisedMinor: number;
  donorCount: number;
  donationCount: number;
  managers: DonationCollectionManagerSummary[];
  createdAt: string;
  updatedAt: string;
};

export type DonationCollectionInput = {
  name: string;
  slug?: string | null;
  causeName: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  minimumAmountMinor: number;
  suggestedAmountsMinor: number[];
  managerIds: number[];
};

export type DonationCollectionDonor = {
  orderId: number;
  donorName: string;
  donorEmail: string;
  donorPhone: string;
  donatedAt: string;
  amountMinor: number;
  currency: string;
};

type CollectionRow = {
  id: number;
  name: string;
  slug: string;
  cause_name: string;
  description: string | null;
  start_date: unknown;
  end_date: unknown;
  minimum_amount_minor: number;
  suggested_amounts_minor: string;
  payment_item_name: string | null;
  created_at: unknown;
  updated_at: unknown;
};

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
  return null;
}

function requireDateOnly(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new DonationCollectionServiceError(`Enter a valid ${label}.`);
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new DonationCollectionServiceError(`Enter a valid ${label}.`);
  }
  return trimmed;
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = String(value ?? '').trim();
  return raw || new Date(0).toISOString();
}

function metadataObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function metadataString(metadata: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseDonationInstant(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function formatDonationDateTime(value: Date): string {
  return value.toLocaleString('en-US', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function listManagedDonationCollectionIds(memberId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ collectionId: schema.donationCollectionManagers.collection_id })
    .from(schema.donationCollectionManagers)
    .where(eq(schema.donationCollectionManagers.member_id, memberId));
  return rows.map((row) => row.collectionId);
}

export async function memberCanManageDonationCollection(member: Member, collectionId: number): Promise<boolean> {
  if (isDonationsManager(member)) return true;
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.donationCollectionManagers.id })
    .from(schema.donationCollectionManagers)
    .where(
      and(
        eq(schema.donationCollectionManagers.collection_id, collectionId),
        eq(schema.donationCollectionManagers.member_id, member.id)
      )
    )
    .limit(1);
  return Boolean(row);
}

async function loadManagers(collectionIds: number[]): Promise<Map<number, DonationCollectionManagerSummary[]>> {
  const grouped = new Map<number, DonationCollectionManagerSummary[]>();
  if (collectionIds.length === 0) return grouped;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      collectionId: schema.donationCollectionManagers.collection_id,
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.donationCollectionManagers)
    .innerJoin(schema.members, eq(schema.members.id, schema.donationCollectionManagers.member_id))
    .where(inArray(schema.donationCollectionManagers.collection_id, collectionIds))
    .orderBy(asc(schema.members.name), asc(schema.members.id));
  for (const row of rows) {
    const list = grouped.get(row.collectionId) ?? [];
    list.push({ id: row.id, name: row.name, email: row.email });
    grouped.set(row.collectionId, list);
  }
  return grouped;
}

async function loadDonationStats(collectionIds: number[]): Promise<
  Map<number, { totalRaisedMinor: number; donorCount: number; donationCount: number }>
> {
  const stats = new Map<number, { totalRaisedMinor: number; donorCount: number; donationCount: number }>();
  if (collectionIds.length === 0) return stats;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      subjectId: schema.paymentOrders.subject_id,
      amountMinor: schema.paymentOrders.amount_minor,
      metadata: schema.paymentOrders.metadata,
    })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'donation'),
        eq(schema.paymentOrders.status, 'succeeded'),
        inArray(schema.paymentOrders.subject_id, collectionIds)
      )
    );
  const donors = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.subjectId == null) continue;
    const current = stats.get(row.subjectId) ?? { totalRaisedMinor: 0, donorCount: 0, donationCount: 0 };
    current.totalRaisedMinor += row.amountMinor;
    current.donationCount += 1;
    stats.set(row.subjectId, current);
    const email = metadataString(metadataObject(row.metadata), 'donorEmail', 'donor_email').toLowerCase();
    const donorKey = email || `order-${current.donationCount}`;
    const set = donors.get(row.subjectId) ?? new Set<string>();
    set.add(donorKey);
    donors.set(row.subjectId, set);
  }
  for (const [collectionId, set] of donors) {
    const current = stats.get(collectionId);
    if (current) current.donorCount = set.size;
  }
  return stats;
}

function toSummary(
  row: CollectionRow,
  managers: DonationCollectionManagerSummary[],
  stats: { totalRaisedMinor: number; donorCount: number; donationCount: number } | undefined,
  today: string
): DonationCollectionSummary {
  const startDate = normalizeDateOnly(row.start_date) ?? '';
  const endDate = normalizeDateOnly(row.end_date) ?? '';
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    causeName: row.cause_name,
    description: row.description,
    startDate,
    endDate,
    minimumAmountMinor: row.minimum_amount_minor,
    suggestedAmountsMinor: parseStoredSuggestedAmounts(row.suggested_amounts_minor),
    paymentItemName: row.payment_item_name,
    defaultItemName: defaultDonationCollectionItemName(row.cause_name),
    status: donationCollectionWindowStatus(today, startDate, endDate),
    totalRaisedMinor: stats?.totalRaisedMinor ?? 0,
    donorCount: stats?.donorCount ?? 0,
    donationCount: stats?.donationCount ?? 0,
    managers,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

async function assertManagersExist(managerIds: number[]): Promise<number[]> {
  const unique = [...new Set(managerIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(inArray(schema.members.id, unique));
  if (rows.length !== unique.length) {
    throw new DonationCollectionServiceError('One or more managers could not be found.');
  }
  return unique;
}

async function replaceManagers(collectionId: number, managerIds: number[]): Promise<void> {
  const nextIds = await assertManagersExist(managerIds);
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ memberId: schema.donationCollectionManagers.member_id })
    .from(schema.donationCollectionManagers)
    .where(eq(schema.donationCollectionManagers.collection_id, collectionId));
  const existingIds = new Set(existing.map((row) => row.memberId));
  const next = new Set(nextIds);
  const toRemove = [...existingIds].filter((id) => !next.has(id));
  const toAdd = nextIds.filter((id) => !existingIds.has(id));
  if (toRemove.length > 0) {
    await db
      .delete(schema.donationCollectionManagers)
      .where(
        and(
          eq(schema.donationCollectionManagers.collection_id, collectionId),
          inArray(schema.donationCollectionManagers.member_id, toRemove)
        )
      );
  }
  if (toAdd.length > 0) {
    await db.insert(schema.donationCollectionManagers).values(
      toAdd.map((memberId) => ({
        collection_id: collectionId,
        member_id: memberId,
      }))
    );
  }
}

function normalizeInput(input: DonationCollectionInput): {
  name: string;
  slug: string;
  causeName: string;
  description: string | null;
  startDate: string;
  endDate: string;
  minimumAmountMinor: number;
  suggestedAmountsMinor: number[];
  managerIds: number[];
} {
  const name = input.name.trim();
  if (!name || name.length > 160) {
    throw new DonationCollectionServiceError('Enter a name.');
  }
  const causeName = input.causeName.trim();
  if (!causeName || causeName.length > 160) {
    throw new DonationCollectionServiceError('Enter the fundraising cause.');
  }
  const slugSource = input.slug?.trim() ? input.slug : name;
  const slug = slugify(slugSource);
  if (!slug) {
    throw new DonationCollectionServiceError('Enter a slug.');
  }
  const startDate = requireDateOnly(input.startDate, 'start date');
  const endDate = requireDateOnly(input.endDate, 'end date');
  if (endDate < startDate) {
    throw new DonationCollectionServiceError('The end date must be on or after the start date.');
  }
  if (
    !Number.isInteger(input.minimumAmountMinor) ||
    input.minimumAmountMinor < 100 ||
    input.minimumAmountMinor > 5_000_000
  ) {
    throw new DonationCollectionServiceError('Minimum donation must be at least $1.00.');
  }
  const suggested = normalizeSuggestedAmountsMinor(input.suggestedAmountsMinor, input.minimumAmountMinor);
  if (!suggested.ok) {
    throw new DonationCollectionServiceError(suggested.error);
  }
  const description = input.description?.trim() ? input.description.trim() : null;
  return {
    name,
    slug,
    causeName,
    description,
    startDate,
    endDate,
    minimumAmountMinor: input.minimumAmountMinor,
    suggestedAmountsMinor: suggested.amounts,
    managerIds: input.managerIds,
  };
}

async function assertSlugAvailable(slug: string, exceptId?: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.donationCollections.id })
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.slug, slug))
    .limit(1);
  if (existing && existing.id !== exceptId) {
    throw new DonationCollectionServiceError('That slug is already in use.', 409);
  }
}

async function loadSummary(collectionId: number): Promise<DonationCollectionSummary> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.id, collectionId))
    .limit(1);
  if (!row) throw new DonationCollectionServiceError('Donation collection not found.', 404);
  const [managers, stats] = await Promise.all([loadManagers([row.id]), loadDonationStats([row.id])]);
  return toSummary(row, managers.get(row.id) ?? [], stats.get(row.id), getCurrentDateString());
}

export async function listDonationCollectionsForMember(member: Member): Promise<DonationCollectionSummary[]> {
  const { db, schema } = getDrizzleDb();
  const managedIds = isDonationsManager(member) ? null : await listManagedDonationCollectionIds(member.id);
  if (managedIds && managedIds.length === 0) {
    throw new DonationCollectionServiceError('Forbidden', 403);
  }
  const rows = managedIds
    ? await db
        .select()
        .from(schema.donationCollections)
        .where(inArray(schema.donationCollections.id, managedIds))
        .orderBy(desc(schema.donationCollections.start_date), desc(schema.donationCollections.id))
    : await db
        .select()
        .from(schema.donationCollections)
        .orderBy(desc(schema.donationCollections.start_date), desc(schema.donationCollections.id));
  const ids = rows.map((row) => row.id);
  const [managers, stats] = await Promise.all([loadManagers(ids), loadDonationStats(ids)]);
  const today = getCurrentDateString();
  return rows.map((row) => toSummary(row, managers.get(row.id) ?? [], stats.get(row.id), today));
}

export async function getDonationCollectionForMember(
  member: Member,
  collectionId: number
): Promise<DonationCollectionSummary> {
  if (!(await memberCanManageDonationCollection(member, collectionId))) {
    throw new DonationCollectionServiceError('Forbidden', 403);
  }
  return loadSummary(collectionId);
}

export async function createDonationCollection(
  member: Member,
  input: DonationCollectionInput
): Promise<DonationCollectionSummary> {
  if (!isDonationsManager(member)) {
    throw new DonationCollectionServiceError('Forbidden', 403);
  }
  const normalized = normalizeInput(input);
  await assertSlugAvailable(normalized.slug);
  const { db, schema } = getDrizzleDb();
  const inserted = await db
    .insert(schema.donationCollections)
    .values({
      name: normalized.name,
      slug: normalized.slug,
      cause_name: normalized.causeName,
      description: normalized.description,
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      minimum_amount_minor: normalized.minimumAmountMinor,
      suggested_amounts_minor: JSON.stringify(normalized.suggestedAmountsMinor),
      created_by_member_id: member.id,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning({ id: schema.donationCollections.id });
  const id = inserted[0]?.id;
  if (!id) throw new DonationCollectionServiceError('Unable to create donation collection.', 500);
  await replaceManagers(id, normalized.managerIds);
  return loadSummary(id);
}

export async function updateDonationCollection(
  member: Member,
  collectionId: number,
  input: DonationCollectionInput
): Promise<DonationCollectionSummary> {
  if (!(await memberCanManageDonationCollection(member, collectionId))) {
    throw new DonationCollectionServiceError('Forbidden', 403);
  }
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.donationCollections.id })
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.id, collectionId))
    .limit(1);
  if (!existing) throw new DonationCollectionServiceError('Donation collection not found.', 404);
  const normalized = normalizeInput(input);
  await assertSlugAvailable(normalized.slug, collectionId);
  await db
    .update(schema.donationCollections)
    .set({
      name: normalized.name,
      slug: normalized.slug,
      cause_name: normalized.causeName,
      description: normalized.description,
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      minimum_amount_minor: normalized.minimumAmountMinor,
      suggested_amounts_minor: JSON.stringify(normalized.suggestedAmountsMinor),
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.donationCollections.id, collectionId));
  await replaceManagers(collectionId, normalized.managerIds);
  return loadSummary(collectionId);
}

export async function getPublicDonationCollection(slug: string) {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.slug, slug))
    .limit(1);
  if (!row) return null;
  const startDate = normalizeDateOnly(row.start_date) ?? '';
  const endDate = normalizeDateOnly(row.end_date) ?? '';
  const today = getCurrentDateString();
  return {
    name: row.name,
    slug: row.slug,
    causeName: row.cause_name,
    description: row.description,
    startDate,
    endDate,
    minimumAmountMinor: row.minimum_amount_minor,
    suggestedAmountsMinor: parseStoredSuggestedAmounts(row.suggested_amounts_minor).filter(
      (amount) => amount >= row.minimum_amount_minor
    ),
    status: donationCollectionWindowStatus(today, startDate, endDate),
  };
}

export async function getDonationCollectionCheckoutContext(slug: string) {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.slug, slug))
    .limit(1);
  if (!row) return null;
  const startDate = normalizeDateOnly(row.start_date) ?? '';
  const endDate = normalizeDateOnly(row.end_date) ?? '';
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    causeName: row.cause_name,
    startDate,
    endDate,
    minimumAmountMinor: row.minimum_amount_minor,
    paymentItemName: row.payment_item_name,
    status: donationCollectionWindowStatus(getCurrentDateString(), startDate, endDate),
  };
}

export async function listDonationCollectionDonors(
  member: Member,
  collectionId: number
): Promise<{ totalRaisedMinor: number; donorCount: number; donors: DonationCollectionDonor[] }> {
  await getDonationCollectionForMember(member, collectionId);
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.paymentOrders.id,
      amountMinor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
      completedAt: schema.paymentOrders.completed_at,
      createdAt: schema.paymentOrders.created_at,
      metadata: schema.paymentOrders.metadata,
    })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'donation'),
        eq(schema.paymentOrders.subject_id, collectionId),
        eq(schema.paymentOrders.status, 'succeeded')
      )
    )
    .orderBy(desc(schema.paymentOrders.completed_at), desc(schema.paymentOrders.id));

  const donors: DonationCollectionDonor[] = rows.map((row) => {
    const metadata = metadataObject(row.metadata);
    const donatedAt = parseDonationInstant(row.completedAt) ?? parseDonationInstant(row.createdAt) ?? new Date();
    return {
      orderId: row.id,
      donorName: metadataString(metadata, 'donorName', 'donor_name') || 'Donor',
      donorEmail: metadataString(metadata, 'donorEmail', 'donor_email'),
      donorPhone: metadataString(metadata, 'donorPhone', 'donor_phone'),
      donatedAt: formatDonationDateTime(donatedAt),
      amountMinor: row.amountMinor,
      currency: row.currency,
    };
  });
  const donorKeys = new Set(donors.map((donor) => donor.donorEmail.toLowerCase() || `order-${donor.orderId}`));
  return {
    totalRaisedMinor: donors.reduce((sum, donor) => sum + donor.amountMinor, 0),
    donorCount: donorKeys.size,
    donors,
  };
}

export async function exportDonationCollectionDonorsCsv(
  member: Member,
  collectionId: number
): Promise<{ filename: string; csv: string }> {
  const collection = await getDonationCollectionForMember(member, collectionId);
  const { donors } = await listDonationCollectionDonors(member, collectionId);
  const csv = toCsv(
    ['Name', 'Email', 'Phone', 'Date and time', 'Amount'],
    donors.map((donor) => [
      donor.donorName,
      donor.donorEmail,
      donor.donorPhone,
      donor.donatedAt,
      formatDonationMoney(donor.amountMinor, donor.currency),
    ])
  );
  return {
    filename: `${collection.slug}-donors.csv`,
    csv,
  };
}

export async function listCurrentDonationCollectionsForPaymentItemNames() {
  const today = getCurrentDateString();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.donationCollections)
    .where(gte(schema.donationCollections.end_date, today))
    .orderBy(asc(schema.donationCollections.start_date), asc(schema.donationCollections.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    causeName: row.cause_name,
    startDate: normalizeDateOnly(row.start_date) ?? '',
    endDate: normalizeDateOnly(row.end_date) ?? '',
    paymentItemName: row.payment_item_name,
    defaultItemName: defaultDonationCollectionItemName(row.cause_name),
  }));
}

export async function updateDonationCollectionPaymentItemName(
  collectionId: number,
  paymentItemName: string | null
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.donationCollections.id })
    .from(schema.donationCollections)
    .where(eq(schema.donationCollections.id, collectionId))
    .limit(1);
  if (!existing) throw new DonationCollectionServiceError('Donation collection not found.', 404);
  const trimmed = paymentItemName?.trim() ?? '';
  const normalized = trimmed.length > 0 ? trimmed.slice(0, 512) : null;
  await db
    .update(schema.donationCollections)
    .set({
      payment_item_name: normalized,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.donationCollections.id, collectionId));
}
