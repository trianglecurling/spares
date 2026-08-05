/**
 * Imports historical board meeting minutes from repo-root minutes.md.
 *
 * Run from repo root or backend:
 *   bun run backend/src/scripts/import-board-meeting-minutes.ts [--dry-run]
 *   DB_CONFIG_PROFILE=preview bun run backend/src/scripts/import-board-meeting-minutes.ts
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
const MINUTES_PATH = path.resolve(__dirname, '../../../minutes.md');

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  februrary: 2,
  febraury: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  uly: 7, // broken "J[uly" markdown
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  decembrer: 12,
};

type ParsedMinute = {
  meetingDate: string;
  documentUrl: string;
  comment: string | null;
  sourceLine: string;
};

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function normalizeDateText(raw: string): string {
  return raw
    .replace(/^J\[uly/i, 'July')
    .replace(/\bFebrurary\b/i, 'February')
    .replace(/\bFebraury\b/i, 'February')
    .replace(/\bDecembrer\b/i, 'December')
    .replace(/(\d{1,2})\.\s+(\d{4})/, '$1, $2') // "October 8. 2023"
    .replace(/(\w+)\s+(\d{1,2}),(\d{4})/, '$1 $2, $3') // "August 17,2015"
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMeetingDate(text: string): string | null {
  const normalized = normalizeDateText(text);
  const match = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/,
  );
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function markdownLinksToPlain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '$1 ($2)')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMinutesMarkdown(markdown: string): ParsedMinute[] {
  const results: ParsedMinute[] = [];
  const lines = markdown.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('-')) continue;
    if (/no board meeting/i.test(line)) continue;

    const content = line.replace(/^-\s*/, '').trim();
    const links: Array<{ label: string; url: string; index: number; length: number }> = [];
    LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LINK_RE.exec(content)) != null) {
      links.push({
        label: match[1].trim(),
        url: match[2].trim(),
        index: match.index,
        length: match[0].length,
      });
    }
    if (links.length === 0) continue;

    let meetingDate: string | null = null;
    let primary = links[0];

    for (const link of links) {
      const fromLabel = parseMeetingDate(link.label);
      if (fromLabel) {
        meetingDate = fromLabel;
        primary = link;
        break;
      }
    }

    if (!meetingDate) {
      const beforeFirstLink = content.slice(0, links[0].index).trim();
      // e.g. "May 21, 2022 - Annual General Membership Meeting (...)"
      const fromPrefix = parseMeetingDate(beforeFirstLink.replace(/\s*[-–—].*$/, '').trim());
      if (fromPrefix) {
        meetingDate = fromPrefix;
        primary = links[0];
      }
    }

    if (!meetingDate) continue;

    // Comment: text around the primary link (prefix notes + trailing notes), plus other links.
    const before = content.slice(0, primary.index).trim();
    const after = content.slice(primary.index + primary.length).trim();
    const otherLinks = links
      .filter((link) => link.url !== primary.url)
      .map((link) => `${link.label}: ${link.url}`);

    const commentParts: string[] = [];
    if (before) {
      // Strip a bare date prefix when the date was in the link label.
      const cleanedBefore = before
        .replace(/^[-–—]\s*/, '')
        .replace(new RegExp(`^${primary.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—]?\\s*`, 'i'), '')
        .trim();
      if (cleanedBefore) commentParts.push(markdownLinksToPlain(cleanedBefore));
    }
    if (after) commentParts.push(markdownLinksToPlain(after));
    // Prefer structured other-link list when after already captured them as plain text.
    if (!after && otherLinks.length > 0) {
      commentParts.push(otherLinks.join('; '));
    }

    const comment = commentParts.join(' ').replace(/\s+/g, ' ').trim() || null;

    results.push({
      meetingDate,
      documentUrl: primary.url,
      comment,
      sourceLine: content,
    });
  }

  return results;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(MINUTES_PATH)) {
    console.error(`minutes.md not found at ${MINUTES_PATH}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(MINUTES_PATH, 'utf8');
  const parsed = parseMinutesMarkdown(markdown);
  console.log(`Parsed ${parsed.length} minutes entries from ${MINUTES_PATH}`);

  if (dryRun) {
    for (const row of parsed.slice(0, 10)) {
      console.log(`  ${row.meetingDate} -> ${row.documentUrl}${row.comment ? ` (${row.comment})` : ''}`);
    }
    if (parsed.length > 10) console.log(`  … and ${parsed.length - 10} more`);
    console.log('Dry run complete; no database changes.');
    return;
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json (or DB_CONFIG_PROFILE).');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  const { db, schema } = getDrizzleDb();

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const row of parsed) {
    try {
      const existing = await db
        .select({ id: schema.boardMeetingMinutes.id })
        .from(schema.boardMeetingMinutes)
        .where(eq(schema.boardMeetingMinutes.document_url, row.documentUrl))
        .limit(1);

      if (existing[0]) {
        await db
          .update(schema.boardMeetingMinutes)
          .set({
            meeting_date: row.meetingDate,
            comment: row.comment,
            updated_at: new Date(),
          })
          .where(eq(schema.boardMeetingMinutes.id, existing[0].id));
        updated++;
      } else {
        await db.insert(schema.boardMeetingMinutes).values({
          meeting_date: row.meetingDate,
          document_url: row.documentUrl,
          comment: row.comment,
        });
        inserted++;
      }
    } catch (err) {
      failed++;
      console.error(`Failed ${row.meetingDate} ${row.documentUrl}:`, err);
    }
  }

  console.log(`Done. inserted=${inserted} updated=${updated} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
