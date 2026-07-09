import { asc, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { getDrizzleDb } from '../../db/drizzle-db.js';
import { isMauticSubscribeAvailableForSegment } from '../../services/mauticService.js';

export type MailingListRow = {
  id: number;
  slug: string;
  mauticSegmentId: number;
  mauticWelcomeEmailId: number | null;
  commentsRecipientEmail: string | null;
  name: string;
  description: string;
  includeQuestionsComments: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicMailingListRow = {
  slug: string;
  name: string;
  description: string;
  includeQuestionsComments: boolean;
  subscribeAvailable: boolean;
};

type MailingListDbRow = {
  id: number;
  slug: string;
  mautic_segment_id: number;
  mautic_welcome_email_id: number | null;
  comments_recipient_email: string | null;
  name: string;
  description: string;
  include_questions_comments: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export const DEFAULT_MAILING_LIST_SEEDS: Array<{
  slug: string;
  name: string;
  description: string;
  segmentId: number;
  includeQuestionsComments: boolean;
}> = [
  {
    slug: 'bonspiels',
    name: 'Bonspiel notifications',
    description:
      'Get email updates about upcoming bonspiels, registration windows, and related club events.',
    segmentId: config.mautic.segmentIds.bonspiels,
    includeQuestionsComments: false,
  },
  {
    slug: 'membership',
    name: 'Membership interest',
    description:
      'Hear from us about league play, annual membership, and how to get involved as a member at the club.',
    segmentId: config.mautic.segmentIds.membership,
    includeQuestionsComments: false,
  },
  {
    slug: 'learn-to-curl',
    name: 'Learn to curl notifications',
    description:
      'We will email you about learn-to-curl sessions, new dates, and beginner opportunities.',
    segmentId: config.mautic.segmentIds.learnToCurl,
    includeQuestionsComments: false,
  },
];

function mapRow(row: MailingListDbRow): MailingListRow {
  return {
    id: row.id,
    slug: row.slug,
    mauticSegmentId: row.mautic_segment_id,
    mauticWelcomeEmailId: row.mautic_welcome_email_id,
    commentsRecipientEmail: row.comments_recipient_email,
    name: row.name,
    description: row.description,
    includeQuestionsComments: row.include_questions_comments === 1,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function mapPublicRow(row: MailingListDbRow): PublicMailingListRow {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    includeQuestionsComments: row.include_questions_comments === 1,
    subscribeAvailable: isMauticSubscribeAvailableForSegment(row.mautic_segment_id),
  };
}

export async function seedMailingListsIfNeeded(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db.select({ id: schema.mailingLists.id }).from(schema.mailingLists).limit(1);
  if (existing.length > 0) return;

  const seeds = DEFAULT_MAILING_LIST_SEEDS.filter((seed) => seed.segmentId > 0);
  if (seeds.length === 0) return;

  await db.insert(schema.mailingLists).values(
    seeds.map((seed) => ({
      slug: seed.slug,
      mautic_segment_id: seed.segmentId,
      comments_recipient_email: null,
      name: seed.name,
      description: seed.description,
      include_questions_comments: seed.includeQuestionsComments ? 1 : 0,
    })),
  );
}

export async function listMailingLists(): Promise<MailingListRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.mailingLists)
    .orderBy(asc(schema.mailingLists.name), asc(schema.mailingLists.id));

  return rows.map(mapRow);
}

export async function getMailingListBySlug(slug: string): Promise<MailingListRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.mailingLists)
    .where(eq(schema.mailingLists.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function getMailingListById(id: number): Promise<MailingListRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.mailingLists)
    .where(eq(schema.mailingLists.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function getPublicMailingListBySlug(slug: string): Promise<PublicMailingListRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.mailingLists)
    .where(eq(schema.mailingLists.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapPublicRow(row);
}

export async function mailingListSlugExists(slug: string): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.mailingLists.id })
    .from(schema.mailingLists)
    .where(eq(schema.mailingLists.slug, slug))
    .limit(1);
  return row != null;
}

export async function buildMailingListSearchDocuments(): Promise<
  Array<{ id: string; title: string; url: string; description: string; keywords: string }>
> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      slug: schema.mailingLists.slug,
      name: schema.mailingLists.name,
      description: schema.mailingLists.description,
    })
    .from(schema.mailingLists)
    .orderBy(asc(schema.mailingLists.name), asc(schema.mailingLists.id));

  return rows.map((row) => ({
    id: `mailing-list-${row.slug}`,
    title: row.name,
    url: `/mailing-list/${row.slug}`,
    description: row.description,
    keywords: 'newsletter email subscribe mailing list',
  }));
}
