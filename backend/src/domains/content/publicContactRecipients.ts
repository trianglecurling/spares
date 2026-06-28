import { asc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../../db/drizzle-db.js';

export type PublicContactRecipientRow = {
  id: number;
  slug: string;
  label: string;
  email: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_PUBLIC_CONTACT_RECIPIENTS: Array<{
  slug: string;
  label: string;
  email: string;
  sortOrder: number;
}> = [
  { slug: 'general', label: 'General info and questions', email: 'info@trianglecurling.com', sortOrder: 0 },
  { slug: 'membership', label: 'Leagues and membership inquiries', email: 'membership@trianglecurling.com', sortOrder: 10 },
  { slug: 'marketing', label: 'Media inquiries, advertising, merchandise', email: 'marketing@trianglecurling.com', sortOrder: 20 },
  { slug: 'rentals', label: 'Private events, team building, corporate outings', email: 'rentals@trianglecurling.com', sortOrder: 30 },
  { slug: 'juniors', label: 'Youth & junior programs', email: 'juniors@trianglecurling.com', sortOrder: 40 },
  { slug: 'operations', label: 'Facilities & contractors', email: 'operations@trianglecurling.com', sortOrder: 50 },
  { slug: 'learntocurl', label: 'Learn-to-curl events', email: 'learntocurl@trianglecurling.com', sortOrder: 60 },
  { slug: 'pickupandpizza', label: 'Pick-Up and Pizza/Pick-Up and Play', email: 'pickupandpizza@trianglecurling.com', sortOrder: 70 },
  { slug: 'web', label: 'Website issues', email: 'web@trianglecurling.com', sortOrder: 80 },
  { slug: 'president', label: 'Contact the president', email: 'president@trianglecurling.com', sortOrder: 90 },
];

function mapRow(row: {
  id: number;
  slug: string;
  label: string;
  email: string;
  sort_order: number;
  is_active: number;
  created_at: string | Date;
  updated_at: string | Date;
}): PublicContactRecipientRow {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    email: row.email,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function seedPublicContactRecipientsIfNeeded(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.publicContactRecipients.id })
    .from(schema.publicContactRecipients)
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(schema.publicContactRecipients).values(
    DEFAULT_PUBLIC_CONTACT_RECIPIENTS.map((recipient) => ({
      slug: recipient.slug,
      label: recipient.label,
      email: recipient.email,
      sort_order: recipient.sortOrder,
      is_active: 1,
    })),
  );
}

export async function listPublicContactRecipients(options?: { activeOnly?: boolean }): Promise<PublicContactRecipientRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.publicContactRecipients)
    .orderBy(asc(schema.publicContactRecipients.sort_order), asc(schema.publicContactRecipients.id));

  const mapped = rows.map(mapRow);
  if (options?.activeOnly) {
    return mapped.filter((row) => row.isActive);
  }
  return mapped;
}

export async function getPublicContactRecipientBySlug(
  slug: string,
  options?: { activeOnly?: boolean },
): Promise<PublicContactRecipientRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.publicContactRecipients)
    .where(eq(schema.publicContactRecipients.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const mapped = mapRow(row);
  if (options?.activeOnly && !mapped.isActive) return null;
  return mapped;
}
