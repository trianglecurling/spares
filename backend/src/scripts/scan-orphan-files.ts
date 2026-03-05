import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq } from 'drizzle-orm';

function extractReferencedFileIds(text: string | null | undefined): Set<number> {
  const ids = new Set<number>();
  if (!text) return ids;

  const regex = /(?:\/api)?\/public\/files\/(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const id = Number.parseInt(match[1], 10);
    if (!Number.isNaN(id)) ids.add(id);
  }
  return ids;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  const { db, schema } = getDrizzleDb();

  const [files, articles, siteConfigRows, showcaseImages, menuItems] = await Promise.all([
    db.select().from(schema.files),
    db.select({ content: schema.articles.content }).from(schema.articles),
    db.select().from(schema.siteConfig).where(eq(schema.siteConfig.id, 1)).limit(1),
    db.select({ url: schema.showcaseImages.url }).from(schema.showcaseImages),
    db.select({ url: schema.menuItems.url }).from(schema.menuItems),
  ]);

  const referencedIds = new Set<number>();
  for (const article of articles) {
    for (const id of extractReferencedFileIds(article.content)) referencedIds.add(id);
  }

  const siteConfig = siteConfigRows[0];
  for (const id of extractReferencedFileIds(siteConfig?.logo_url)) referencedIds.add(id);
  for (const id of extractReferencedFileIds(siteConfig?.footer_markdown)) referencedIds.add(id);

  for (const item of showcaseImages) {
    for (const id of extractReferencedFileIds(item.url)) referencedIds.add(id);
  }
  for (const item of menuItems) {
    for (const id of extractReferencedFileIds(item.url)) referencedIds.add(id);
  }

  const now = new Date();
  let suspectCount = 0;
  let referencedCount = 0;
  for (const file of files) {
    const isReferenced = referencedIds.has(file.id);
    if (isReferenced) referencedCount++;
    else suspectCount++;

    if (dryRun) continue;

    await db
      .update(schema.files)
      .set({
        suspected_orphan: isReferenced ? 0 : 1,
        last_referenced_at: isReferenced ? now : null,
      })
      .where(eq(schema.files.id, file.id));
  }

  if (dryRun) {
    console.log(`Dry run complete. Referenced: ${referencedCount}, suspected orphan: ${suspectCount}, total: ${files.length}`);
  } else {
    console.log(`Scan complete. Referenced: ${referencedCount}, suspected orphan: ${suspectCount}, total: ${files.length}`);
  }
}

main().catch((error) => {
  console.error('Orphan scan failed:', error);
  process.exit(1);
});
