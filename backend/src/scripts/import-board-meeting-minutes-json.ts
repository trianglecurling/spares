/**
 * Imports board meeting minutes from a JSON export file.
 * Upserts by document URL (update meeting date/comment if URL exists).
 *
 * Run from backend/:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/import-board-meeting-minutes-json.ts
 *   bun run src/scripts/import-board-meeting-minutes-json.ts --file=./data/board-meeting-minutes-export.json
 *   bun run src/scripts/import-board-meeting-minutes-json.ts --dry-run
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
const DEFAULT_FILE = path.resolve(__dirname, '../../data/board-meeting-minutes-export.json');

type ExportItem = {
  meetingDate: string;
  documentUrl: string;
  comment: string | null;
};

type ExportFile = {
  exportedAt?: string;
  count?: number;
  minutes: ExportItem[];
};

function parseArgs(argv: string[]): { filePath: string; dryRun: boolean } {
  let filePath = DEFAULT_FILE;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--file=')) {
      filePath = path.resolve(arg.slice('--file='.length));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  bun run src/scripts/import-board-meeting-minutes-json.ts [--file=path.json] [--dry-run]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { filePath, dryRun };
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeItems(raw: unknown): ExportItem[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON root must be an object with a minutes array, or a bare minutes array');
  }

  const minutes = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as ExportFile).minutes)
      ? (raw as ExportFile).minutes
      : null;

  if (!minutes) {
    throw new Error('JSON must include a "minutes" array (or be an array of minute objects)');
  }

  const items: ExportItem[] = [];
  for (const [index, entry] of minutes.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`minutes[${index}] must be an object`);
    }
    const meetingDate = String((entry as ExportItem).meetingDate ?? '').trim();
    const documentUrl = String((entry as ExportItem).documentUrl ?? '').trim();
    const commentRaw = (entry as ExportItem).comment;
    const comment =
      commentRaw == null || String(commentRaw).trim() === '' ? null : String(commentRaw).trim();

    if (!isValidDate(meetingDate)) {
      throw new Error(`minutes[${index}].meetingDate must be YYYY-MM-DD (got ${JSON.stringify(meetingDate)})`);
    }
    if (!documentUrl) {
      throw new Error(`minutes[${index}].documentUrl is required`);
    }

    items.push({ meetingDate, documentUrl, comment });
  }

  return items;
}

async function main() {
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(filePath)) {
    console.error(`Export file not found: ${filePath}`);
    process.exit(1);
  }

  const parsedJson = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const items = normalizeItems(parsedJson);
  console.log(`Loaded ${items.length} minutes from ${filePath}`);

  if (dryRun) {
    for (const row of items.slice(0, 10)) {
      console.log(`  ${row.meetingDate} -> ${row.documentUrl}${row.comment ? ` (${row.comment})` : ''}`);
    }
    if (items.length > 10) console.log(`  … and ${items.length - 10} more`);
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

  for (const row of items) {
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
