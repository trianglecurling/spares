/**
 * Imports scraped article JSON files into the CMS database.
 * Run: bun run src/scripts/import-articles.ts [--dry-run]
 * Requires: backend/data/scraped-articles/*.json (from scrape-articles.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARTICLES_DIR = path.resolve(__dirname, '../../data/scraped-articles');

const SLUG_REGEX = /^[a-z0-9-]+$/;

type ScrapedArticle = {
  title: string;
  slug: string;
  content: string;
};

function makeSnippet(content: string): string {
  return content
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  if (!fs.existsSync(ARTICLES_DIR)) {
    console.error(`Articles directory not found: ${ARTICLES_DIR}`);
    console.error('Run scrape-articles.ts first.');
    process.exit(1);
  }

  const files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`No JSON files in ${ARTICLES_DIR}`);
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  const { db, schema } = getDrizzleDb();

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files.sort()) {
    const filePath = path.join(ARTICLES_DIR, file);
    let data: ScrapedArticle;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`  ${file}: Invalid JSON -`, err);
      failed++;
      continue;
    }

    const { title, slug, content } = data;
    if (!title || !slug || !content) {
      console.error(`  ${file}: Missing title, slug, or content`);
      failed++;
      continue;
    }

    if (!SLUG_REGEX.test(slug)) {
      console.error(`  ${file}: Invalid slug (must match ^[a-z0-9-]+$): ${slug}`);
      failed++;
      continue;
    }

    const snippet = makeSnippet(content);

    if (dryRun) {
      console.log(`  [DRY-RUN] Would import: ${slug} (${title})`);
      success++;
      continue;
    }

    try {
      const existing = await db
        .select({ id: schema.articles.id })
        .from(schema.articles)
        .where(eq(schema.articles.slug, slug))
        .limit(1);

      if (existing.length > 0) {
        console.log(`  ${slug}: Skipped (already exists)`);
        skipped++;
        continue;
      }

      await db.insert(schema.articles).values({
        title,
        slug,
        content,
        snippet,
        featured: 0,
        published_at: null,
        created_by_member_id: null,
      });
      console.log(`  ${slug}: OK`);
      success++;
    } catch (err) {
      console.error(`  ${slug}: Failed -`, err);
      failed++;
    }
  }

  console.log(`\nDone. ${success} imported, ${skipped} skipped, ${failed} failed.`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
