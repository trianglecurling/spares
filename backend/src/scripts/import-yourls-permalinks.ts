/**
 * Import short links from YOURLS (or any TSV/CSV with keyword + URL) into `permalinks`.
 *
 * YOURLS has no built-in export; data lives in MySQL. Typical table: `yourls_url`
 * with columns `keyword`, `url`, `title` (and clicks, timestamp, etc.).
 *
 * 1) Export from MySQL (tab-separated — safest when URLs contain commas):
 *
 *    mysql -h HOST -u USER -p YOURLS_DB --batch --raw \
 *      -e "SELECT keyword, url, title, timestamp, clicks FROM yourls_url ORDER BY keyword" \
 *      > yourls-export.tsv
 *
 *    The first row must be a header. Save as UTF-8.
 *
 * 2) Dry run (no DB writes):
 *
 *    bun run src/scripts/import-yourls-permalinks.ts --dry-run path/to/yourls-export.tsv
 *
 * 3) Import:
 *
 *    bun run src/scripts/import-yourls-permalinks.ts path/to/yourls-export.tsv
 *
 * Options:
 *   --dry-run              Print actions only
 *   --permanent            Use 301-style permalinks (destination_may_change = false). Default is temporary (302).
 *   --delimiter=tab|comma  Default tab
 *
 * Optional columns: `timestamp`, `clicks` (YOURLS). Clicks are stored as legacy_click_count and added to both
 * total and “unique” hit counts in the admin UI. Timestamp sets created_at and updated_at when parseable.
 *
 * Slugs: keywords are lowercased; `_` becomes `-`; other invalid characters become `-`.
 * Rows that collide after normalization or violate slug rules are reported and skipped.
 *
 * Uses `getDrizzleDb()` only (no full `initializeDatabase()` run). Ensure the DB is already
 * initialized (`bun run db:migrate` / app install) so `permalinks` exists, and rerun
 * `bun run db:migrate` after upgrading so the `legacy_click_count` column is applied.
 */

import * as fs from 'fs';
import { eq } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

const SLUG_REGEX = /^[a-z0-9-]+$/;

function normalizeKeyword(keyword: string): string {
  let s = keyword.trim().toLowerCase();
  s = s.replace(/_/g, '-');
  s = s.replace(/[^a-z0-9-]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

function isAllowedDestination(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.startsWith('/')) return true;
  try {
    const u = new URL(t);
    const bad = ['javascript:', 'data:', 'vbscript:'].includes(u.protocol.toLowerCase());
    return !bad;
  } catch {
    return false;
  }
}

function parseDelimited(content: string, delimiter: '\t' | ','): string[][] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.map((line) => {
    if (delimiter === '\t') {
      return line.split('\t').map((c) => c.replace(/\r$/, '').trim());
    }
    // Minimal CSV: split on comma; does not handle quoted commas (use TSV for YOURLS).
    return line.split(',').map((c) => c.trim());
  });
}

function findColumnIndex(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseLegacyClicks(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** YOURLS-style "2022-11-29 14:39:43" → ISO string for DB; null if missing/invalid. */
function parseYourlsTimestamp(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?/);
  if (m) {
    const iso = `${m[1]}T${m[2]}`;
    const d = Date.parse(iso);
    if (!Number.isNaN(d)) return new Date(d).toISOString();
  }
  const d = Date.parse(t);
  if (!Number.isNaN(d)) return new Date(d).toISOString();
  return null;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '');
  const dryRun = args.includes('--dry-run');
  const permanent = args.includes('--permanent');
  const delimArg = args.find((a) => a.startsWith('--delimiter='));
  const delimiter: '\t' | ',' =
    delimArg?.endsWith('comma') || delimArg?.endsWith(',') ? ',' : '\t';

  const filePath = args.find((a) => !a.startsWith('--'));
  if (!filePath) {
    console.error('Usage: bun run src/scripts/import-yourls-permalinks.ts [--dry-run] [--permanent] [--delimiter=tab|comma] <export.tsv>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = parseDelimited(raw, delimiter);
  if (rows.length < 2) {
    console.error('Expected a header row and at least one data row.');
    process.exit(1);
  }

  const header = rows[0];
  const ik = findColumnIndex(header, ['keyword', 'slug', 'shorturl']);
  const iu = findColumnIndex(header, ['url', 'longurl', 'destination', 'target']);
  const it = findColumnIndex(header, ['title', 'label']);
  const iclicks = findColumnIndex(header, ['clicks', 'click']);
  const its = findColumnIndex(header, ['timestamp', 'date', 'created', 'created_at']);

  if (ik < 0 || iu < 0) {
    console.error(
      'Header must include keyword (or slug) and url (or longurl) columns. Found:',
      header.join(delimiter === '\t' ? '\t' : ',')
    );
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found (backend/data/db-config.json).');
    process.exit(1);
  }

  const { db, schema } = dryRun ? { db: null as never, schema: null as never } : getDrizzleDb();

  const mayChange = permanent ? 0 : 1;
  let inserted = 0;
  let skippedConflict = 0;
  let skippedBad = 0;
  const seenNormalized = new Map<string, string>();

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const originalKeyword = cols[ik] ?? '';
    const url = (cols[iu] ?? '').trim();
    const titleCol = it >= 0 ? (cols[it] ?? '').trim() : '';
    const clicksCol = iclicks >= 0 ? (cols[iclicks] ?? '').trim() : '';
    const tsCol = its >= 0 ? (cols[its] ?? '').trim() : '';
    const legacyClickCount = parseLegacyClicks(clicksCol);
    const importedAt = parseYourlsTimestamp(tsCol);

    const slug = normalizeKeyword(originalKeyword);
    if (!slug || !SLUG_REGEX.test(slug)) {
      console.error(`  Row ${i + 1}: invalid slug after normalize "${originalKeyword}" -> "${slug}"`);
      skippedBad++;
      continue;
    }

    if (!isAllowedDestination(url)) {
      console.error(`  Row ${i + 1}: invalid or empty URL for keyword "${originalKeyword}"`);
      skippedBad++;
      continue;
    }

    const prev = seenNormalized.get(slug);
    if (prev !== undefined) {
      console.error(`  Row ${i + 1}: duplicate normalized slug "${slug}" (also "${prev}" and "${originalKeyword}")`);
      skippedBad++;
      continue;
    }
    seenNormalized.set(slug, originalKeyword);

    if (originalKeyword.trim().toLowerCase() !== slug) {
      console.log(`  Map keyword "${originalKeyword}" -> slug "${slug}"`);
    }

    const label = titleCol || null;
    const notes = `Imported from YOURLS (original keyword: ${originalKeyword.trim()})`;

    if (dryRun) {
      const extra =
        legacyClickCount > 0 || importedAt
          ? ` legacy_clicks=${legacyClickCount}${importedAt ? ` at=${importedAt}` : ''}`
          : '';
      console.log(
        `  [dry-run] would insert slug=${slug} url=${url.slice(0, 80)}${url.length > 80 ? '…' : ''}${extra}`
      );
      inserted++;
      continue;
    }

    try {
      const [existing] = await db
        .select({ id: schema.permalinks.id })
        .from(schema.permalinks)
        .where(eq(schema.permalinks.slug, slug))
        .limit(1);
      if (existing) {
        console.warn(`  Skipped (slug already exists): ${slug}`);
        skippedConflict++;
        continue;
      }

      const at = importedAt ? new Date(importedAt) : undefined;
      await db.insert(schema.permalinks).values({
        slug,
        label,
        notes,
        destination_url: url.trim(),
        destination_may_change: mayChange,
        legacy_click_count: legacyClickCount,
        ...(at ? { created_at: at, updated_at: at } : {}),
      });
      inserted++;
    } catch (e) {
      console.error(`  Row ${i + 1}: insert failed for "${slug}":`, e);
      skippedBad++;
    }
  }

  console.log(
    `\nDone. ${dryRun ? 'Would import' : 'Imported'} ${inserted} row(s).` +
      (skippedConflict ? ` Skipped ${skippedConflict} existing slug(s).` : '') +
      (skippedBad ? ` Skipped/failed ${skippedBad} row(s).` : '')
  );

  if (skippedBad > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
