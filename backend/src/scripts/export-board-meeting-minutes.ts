/**
 * Exports board_meeting_minutes rows to a JSON file.
 *
 * Run from backend/:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/export-board-meeting-minutes.ts
 *   bun run src/scripts/export-board-meeting-minutes.ts --out=./data/board-meeting-minutes-export.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { asc } from 'drizzle-orm';
import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUT = path.resolve(__dirname, '../../data/board-meeting-minutes-export.json');

type ExportItem = {
  meetingDate: string;
  documentUrl: string;
  comment: string | null;
};

type ExportFile = {
  exportedAt: string;
  count: number;
  minutes: ExportItem[];
};

function parseArgs(argv: string[]): { outPath: string } {
  let outPath = DEFAULT_OUT;
  for (const arg of argv) {
    if (arg.startsWith('--out=')) {
      outPath = path.resolve(arg.slice('--out='.length));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  bun run src/scripts/export-board-meeting-minutes.ts [--out=path.json]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { outPath };
}

function toDateOnly(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json (or DB_CONFIG_PROFILE).');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  const { db, schema } = getDrizzleDb();

  const rows = await db
    .select({
      meeting_date: schema.boardMeetingMinutes.meeting_date,
      document_url: schema.boardMeetingMinutes.document_url,
      comment: schema.boardMeetingMinutes.comment,
    })
    .from(schema.boardMeetingMinutes)
    .orderBy(asc(schema.boardMeetingMinutes.meeting_date), asc(schema.boardMeetingMinutes.id));

  const minutes: ExportItem[] = rows.map((row) => ({
    meetingDate: toDateOnly(row.meeting_date),
    documentUrl: row.document_url,
    comment: row.comment ?? null,
  }));

  const payload: ExportFile = {
    exportedAt: new Date().toISOString(),
    count: minutes.length,
    minutes,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Exported ${minutes.length} board meeting minutes to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
