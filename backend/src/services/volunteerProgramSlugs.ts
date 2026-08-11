import { and, asc, eq, ne } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { slugify } from '../utils/slugify.js';

const PLACEHOLDER_SLUG_RE = /^program-\d+$/;

export async function ensureUniqueVolunteerProgramSlug(
  baseSlug: string,
  excludeId?: number
): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const normalized = slugify(baseSlug) || 'program';
  let slug = normalized;
  let suffix = 0;
  while (true) {
    const conditions = [eq(schema.volunteerPrograms.slug, slug)];
    if (excludeId != null) {
      conditions.push(ne(schema.volunteerPrograms.id, excludeId));
    }
    const [existing] = await db
      .select({ id: schema.volunteerPrograms.id })
      .from(schema.volunteerPrograms)
      .where(and(...conditions))
      .limit(1);
    if (!existing) return slug;
    suffix += 1;
    slug = `${normalized}-${suffix}`;
  }
}

/**
 * Replace temporary `program-{id}` placeholders (and any empty slugs) with
 * title-based slugs using the shared slugify rules.
 */
export async function ensureVolunteerProgramSlugsFromTitlesIfNeeded(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const programs = await db
    .select({
      id: schema.volunteerPrograms.id,
      title: schema.volunteerPrograms.title,
      slug: schema.volunteerPrograms.slug,
    })
    .from(schema.volunteerPrograms)
    .orderBy(asc(schema.volunteerPrograms.id));

  for (const program of programs) {
    const current = String(program.slug ?? '').trim();
    if (current && !PLACEHOLDER_SLUG_RE.test(current)) continue;
    const nextSlug = await ensureUniqueVolunteerProgramSlug(program.title || 'program', program.id);
    if (nextSlug === current) continue;
    await db
      .update(schema.volunteerPrograms)
      .set({ slug: nextSlug, updated_at: new Date() } as never)
      .where(eq(schema.volunteerPrograms.id, program.id));
  }
}
