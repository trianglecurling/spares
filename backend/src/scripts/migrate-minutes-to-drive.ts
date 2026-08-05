/**
 * Migrates board meeting minutes that still point at trianglecurling.com PDFs
 * into a Google Drive folder, then rewrites document_url / comment URLs in the DB.
 *
 * One-time setup:
 *   1. Google Cloud Console → enable Drive API → create OAuth Desktop client
 *   2. Save client JSON to backend/data/google-oauth.client.json
 *   3. Create/choose a Drive folder; copy its ID from the URL
 *
 * Run from backend/:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/migrate-minutes-to-drive.ts --list
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/migrate-minutes-to-drive.ts --limit=1
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/migrate-minutes-to-drive.ts
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/migrate-minutes-to-drive.ts --dry-run
 *
 * Env:
 *   GOOGLE_OAUTH_CLIENT_FILE (default: backend/data/google-oauth.client.json)
 *   GOOGLE_OAUTH_TOKEN_FILE  (default: backend/data/google-oauth.token.json)
 *   GOOGLE_DRIVE_MINUTES_FOLDER_ID or --folder-id=...
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { eq, or, like, sql } from 'drizzle-orm';
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');

const DEFAULT_CLIENT_FILE = path.join(DATA_DIR, 'google-oauth.client.json');
const DEFAULT_TOKEN_FILE = path.join(DATA_DIR, 'google-oauth.token.json');
const CACHE_DIR = path.join(DATA_DIR, 'minutes-migration-cache');
const MANIFEST_PATH = path.join(DATA_DIR, 'minutes-drive-migration-manifest.json');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const LEGACY_HOST = 'trianglecurling.com';
const URL_IN_TEXT_RE = /https?:\/\/[^\s)"']+/gi;

type CliOptions = {
  list: boolean;
  dryRun: boolean;
  apply: boolean;
  limit: number | null;
  folderId: string | null;
};

type MinutesRow = {
  id: number;
  meeting_date: string;
  document_url: string;
  comment: string | null;
};

type ManifestEntry = {
  oldUrl: string;
  newUrl: string | null;
  driveFileId: string | null;
  fileName: string;
  localPath: string | null;
  meetingDates: string[];
  rowIds: number[];
  status: 'pending' | 'downloaded' | 'uploaded' | 'applied' | 'skipped' | 'failed';
  error?: string;
};

type Manifest = {
  updatedAt: string;
  folderId: string | null;
  entries: Record<string, ManifestEntry>;
};

function parseArgs(argv: string[]): CliOptions {
  let list = false;
  let dryRun = false;
  let apply = false;
  let limit: number | null = null;
  let folderId: string | null = process.env.GOOGLE_DRIVE_MINUTES_FOLDER_ID?.trim() || null;

  for (const arg of argv) {
    if (arg === '--list') list = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--apply') apply = true;
    else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = n;
    } else if (arg.startsWith('--folder-id=')) {
      folderId = arg.slice('--folder-id='.length).trim() || null;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // Default mode is apply (full migrate) unless --list or --dry-run.
  if (!list && !dryRun) apply = true;

  return { list, dryRun, apply, limit, folderId };
}

function printHelp() {
  console.log(`Usage:
  bun run src/scripts/migrate-minutes-to-drive.ts [options]

Options:
  --list              List legacy trianglecurling.com URLs still in the DB
  --dry-run           Download + plan Drive uploads / DB rewrites (no writes)
  --apply             Full migrate (default when neither --list nor --dry-run)
  --limit=N           Process only N unique URLs
  --folder-id=ID      Google Drive destination folder ID
  -h, --help          Show this help
`);
}

function isLegacyMinutesUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === LEGACY_HOST || host.endsWith(`.${LEGACY_HOST}`);
  } catch {
    return url.toLowerCase().includes(LEGACY_HOST);
  }
}

function extractLegacyUrls(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    URL_IN_TEXT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_IN_TEXT_RE.exec(text)) != null) {
      const raw = match[0].replace(/[.,;:]+$/, '');
      if (isLegacyMinutesUrl(raw)) found.add(raw);
    }
  }
  return [...found];
}

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(pathname);
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return `minutes-${Buffer.from(url).toString('base64url').slice(0, 24)}.pdf`;
}

function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function loadManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { updatedAt: new Date().toISOString(), folderId: null, entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return { updatedAt: new Date().toISOString(), folderId: null, entries: {} };
  }
}

function saveManifest(manifest: Manifest) {
  manifest.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function replaceUrlsInText(text: string, urlMap: Map<string, string>): string {
  let next = text;
  for (const [oldUrl, newUrl] of urlMap) {
    if (oldUrl === newUrl) continue;
    next = next.split(oldUrl).join(newUrl);
  }
  return next;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 0) return;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'thebroomstack-minutes-migration/1.0',
      Accept: 'application/pdf,*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error(`Downloaded empty file for ${url}`);
  }
  fs.writeFileSync(destPath, buf);
}

type OAuthClientJson = {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
};

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
    } else if (platform === 'win32') {
      Bun.spawn(['cmd', '/c', 'start', '', url], { stdout: 'ignore', stderr: 'ignore' });
    } else {
      Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
    }
  } catch {
    // User can open the printed URL manually.
  }
}

async function authorizeDrive(): Promise<drive_v3.Drive> {
  const clientFile = process.env.GOOGLE_OAUTH_CLIENT_FILE?.trim() || DEFAULT_CLIENT_FILE;
  const tokenFile = process.env.GOOGLE_OAUTH_TOKEN_FILE?.trim() || DEFAULT_TOKEN_FILE;

  if (!fs.existsSync(clientFile)) {
    throw new Error(
      `OAuth client file not found at ${clientFile}. Download a Desktop OAuth client JSON from Google Cloud Console.`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(clientFile, 'utf8')) as OAuthClientJson;
  const creds = raw.installed ?? raw.web;
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error(`Invalid OAuth client JSON at ${clientFile}: expected installed/web client_id + client_secret`);
  }

  if (fs.existsSync(tokenFile)) {
    const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8')) as Record<string, unknown>;
    oauth2Client.setCredentials(token);
    oauth2Client.on('tokens', (tokens) => {
      const merged = { ...token, ...tokens };
      fs.writeFileSync(tokenFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirect = '';
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const authCode = reqUrl.searchParams.get('code');
        if (!authCode) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code parameter');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><p>Google authorization complete. You can close this tab.</p></body></html>');
        server.close();
        resolve({ code: authCode, redirectUri: redirect });
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind OAuth redirect server'));
        return;
      }
      redirect = `http://127.0.0.1:${addr.port}`;
      const bootstrapClient = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirect);
      const authUrl = bootstrapClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [DRIVE_SCOPE],
      });

      console.log('Authorize this app by visiting:');
      console.log(authUrl);
      void openBrowser(authUrl);
    });

    server.on('error', reject);
  });

  const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
  console.log(`Saved OAuth token to ${tokenFile}`);

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function findExistingDriveFile(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
): Promise<{ id: string; webViewLink?: string | null } | null> {
  const escaped = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const file = res.data.files?.[0];
  if (!file?.id) return null;
  return { id: file.id, webViewLink: file.webViewLink };
}

async function ensureAnyoneWithLink(drive: drive_v3.Drive, fileId: string): Promise<void> {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'anyone',
        role: 'reader',
      },
      supportsAllDrives: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Idempotent: permission may already exist.
    if (!/already|exists|duplicate/i.test(message)) {
      throw err;
    }
  }
}

async function uploadOrReuse(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  localPath: string,
): Promise<{ id: string; webViewLink: string; reused: boolean }> {
  const existing = await findExistingDriveFile(drive, folderId, fileName);
  if (existing) {
    await ensureAnyoneWithLink(drive, existing.id);
    const meta = await drive.files.get({
      fileId: existing.id,
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    const id = meta.data.id || existing.id;
    return {
      id,
      webViewLink: meta.data.webViewLink || existing.webViewLink || driveViewUrl(id),
      reused: true,
    };
  }

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(fs.readFileSync(localPath)),
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  const id = res.data.id;
  if (!id) throw new Error(`Drive upload returned no file id for ${fileName}`);
  await ensureAnyoneWithLink(drive, id);

  const meta = await drive.files.get({
    fileId: id,
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  return {
    id,
    webViewLink: meta.data.webViewLink || driveViewUrl(id),
    reused: false,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json (or DB_CONFIG_PROFILE).');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  const { db, schema } = getDrizzleDb();

  const pattern = `%${LEGACY_HOST}%`;
  const rows = (await db
    .select({
      id: schema.boardMeetingMinutes.id,
      meeting_date: schema.boardMeetingMinutes.meeting_date,
      document_url: schema.boardMeetingMinutes.document_url,
      comment: schema.boardMeetingMinutes.comment,
    })
    .from(schema.boardMeetingMinutes)
    .where(
      or(
        like(schema.boardMeetingMinutes.document_url, pattern),
        like(schema.boardMeetingMinutes.comment, pattern),
      ),
    )
    .orderBy(schema.boardMeetingMinutes.meeting_date)) as MinutesRow[];

  const urlToRows = new Map<string, MinutesRow[]>();
  for (const row of rows) {
    const urls = extractLegacyUrls(row.document_url, row.comment);
    for (const url of urls) {
      const list = urlToRows.get(url) ?? [];
      list.push(row);
      urlToRows.set(url, list);
    }
  }

  const allUrls = [...urlToRows.keys()].sort((a, b) => a.localeCompare(b));
  console.log(`Found ${rows.length} DB rows with legacy URLs (${allUrls.length} unique URLs).`);

  if (opts.list) {
    for (const url of allUrls) {
      const linked = urlToRows.get(url) ?? [];
      const dates = [...new Set(linked.map((r) => String(r.meeting_date)))].join(', ');
      console.log(`  ${fileNameFromUrl(url)}`);
      console.log(`    ${url}`);
      console.log(`    rows=${linked.map((r) => r.id).join(',')} dates=${dates}`);
    }
    return;
  }

  if (!opts.folderId && !opts.dryRun) {
    console.error('Missing Drive folder ID. Set GOOGLE_DRIVE_MINUTES_FOLDER_ID or pass --folder-id=...');
    process.exit(1);
  }

  const urlsToProcess = opts.limit ? allUrls.slice(0, opts.limit) : allUrls;
  if (opts.limit) {
    console.log(`Processing first ${urlsToProcess.length} of ${allUrls.length} unique URLs (--limit=${opts.limit}).`);
  }

  const manifest = loadManifest();
  manifest.folderId = opts.folderId;

  let drive: drive_v3.Drive | null = null;
  if (!opts.dryRun) {
    drive = await authorizeDrive();
  }

  const urlMap = new Map<string, string>();
  let downloaded = 0;
  let uploaded = 0;
  let reused = 0;
  let failed = 0;
  let skipped = 0;

  for (const oldUrl of urlsToProcess) {
    const linkedRows = urlToRows.get(oldUrl) ?? [];
    const fileName = fileNameFromUrl(oldUrl);
    const localPath = path.join(CACHE_DIR, fileName);
    const existingEntry = manifest.entries[oldUrl];

    const entry: ManifestEntry = {
      oldUrl,
      newUrl: existingEntry?.newUrl ?? null,
      driveFileId: existingEntry?.driveFileId ?? null,
      fileName,
      localPath,
      meetingDates: [...new Set(linkedRows.map((r) => String(r.meeting_date)))],
      rowIds: [...new Set(linkedRows.map((r) => r.id))],
      status: 'pending',
    };

    try {
      if (existingEntry?.status === 'applied' && existingEntry.newUrl) {
        urlMap.set(oldUrl, existingEntry.newUrl);
        entry.status = 'skipped';
        entry.newUrl = existingEntry.newUrl;
        entry.driveFileId = existingEntry.driveFileId;
        skipped++;
        console.log(`SKIP (already applied) ${fileName} -> ${existingEntry.newUrl}`);
        manifest.entries[oldUrl] = entry;
        continue;
      }

      await downloadFile(oldUrl, localPath);
      downloaded++;
      entry.status = 'downloaded';
      console.log(`DL  ${fileName}`);

      if (opts.dryRun) {
        console.log(`PLAN upload ${fileName} -> folder ${opts.folderId ?? '(unset)'}`);
        manifest.entries[oldUrl] = entry;
        continue;
      }

      if (!drive || !opts.folderId) {
        throw new Error('Drive client / folder id unavailable');
      }

      const result = await uploadOrReuse(drive, opts.folderId, fileName, localPath);
      const newUrl = result.webViewLink.includes('drive.google.com')
        ? result.webViewLink.split('?')[0]
        : driveViewUrl(result.id);

      entry.driveFileId = result.id;
      entry.newUrl = newUrl;
      entry.status = 'uploaded';
      urlMap.set(oldUrl, newUrl);
      if (result.reused) {
        reused++;
        console.log(`REUSE ${fileName} -> ${newUrl}`);
      } else {
        uploaded++;
        console.log(`UP  ${fileName} -> ${newUrl}`);
      }
    } catch (err) {
      failed++;
      entry.status = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${fileName}: ${entry.error}`);
    }

    manifest.entries[oldUrl] = entry;
    saveManifest(manifest);
  }

  // Include previously migrated URLs from manifest so comment/doc rewrites stay complete on partial runs.
  for (const [oldUrl, entry] of Object.entries(manifest.entries)) {
    if (entry.newUrl && !urlMap.has(oldUrl)) {
      urlMap.set(oldUrl, entry.newUrl);
    }
  }

  let rowsUpdated = 0;
  if (!opts.dryRun && urlMap.size > 0) {
    const affectedIds = new Set<number>();
    for (const oldUrl of urlMap.keys()) {
      for (const row of urlToRows.get(oldUrl) ?? []) {
        affectedIds.add(row.id);
      }
    }

    for (const rowId of affectedIds) {
      const row = rows.find((r) => r.id === rowId);
      if (!row) continue;

      const nextDocumentUrl = replaceUrlsInText(row.document_url, urlMap);
      const nextComment = row.comment ? replaceUrlsInText(row.comment, urlMap) : row.comment;

      if (nextDocumentUrl === row.document_url && nextComment === row.comment) {
        continue;
      }

      try {
        await db
          .update(schema.boardMeetingMinutes)
          .set({
            document_url: nextDocumentUrl,
            comment: nextComment,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.boardMeetingMinutes.id, row.id));
        rowsUpdated++;

        for (const [oldUrl, newUrl] of urlMap) {
          const entry = manifest.entries[oldUrl];
          if (!entry) continue;
          if (entry.rowIds.includes(row.id) && entry.newUrl === newUrl && entry.status !== 'failed') {
            entry.status = 'applied';
          }
        }
      } catch (err) {
        failed++;
        console.error(
          `FAIL DB update row ${row.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } else if (opts.dryRun) {
    const affectedIds = new Set<number>();
    for (const oldUrl of urlsToProcess) {
      for (const row of urlToRows.get(oldUrl) ?? []) affectedIds.add(row.id);
    }
    console.log(`PLAN would update up to ${affectedIds.size} DB rows.`);
  }

  saveManifest(manifest);

  console.log(
    `Done. downloaded=${downloaded} uploaded=${uploaded} reused=${reused} skipped=${skipped} rowsUpdated=${rowsUpdated} failed=${failed}`,
  );
  console.log(`Manifest: ${MANIFEST_PATH}`);
  if (opts.dryRun) {
    console.log('Dry run complete; no Drive uploads or DB updates were written.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
