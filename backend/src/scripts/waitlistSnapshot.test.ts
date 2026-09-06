import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'bun:test';
import {
  WAITLIST_SNAPSHOT_KIND,
  WAITLIST_SNAPSHOT_VERSION,
  buildSummaryMarkdown,
  deserializeCell,
  findLatestSnapshotFile,
  insertSql,
  isPreRestoreSnapshotFile,
  isWaitlistSnapshot,
  parseSnapshotFileName,
  quoteIdent,
  serializeCell,
  snapshotFileName,
  timestampForFileName,
  type WaitlistSnapshotFile,
} from './waitlistSnapshot.js';

function minimalSnapshot(overrides: Partial<WaitlistSnapshotFile> = {}): WaitlistSnapshotFile {
  return {
    version: WAITLIST_SNAPSHOT_VERSION,
    kind: WAITLIST_SNAPSHOT_KIND,
    createdAt: '2026-09-06T12:00:00.000Z',
    profile: 'default',
    database: { type: 'postgres', host: 'localhost', port: 5432, name: 'broomstack', username: 'postgres' },
    counts: { league_waitlists: 1, waitlist_entries: 1, waitlist_offers: 0, waitlist_audit_events: 0, leagueWaitlistAssignments: 1, outboundMessageLinks: 0 },
    tables: [],
    leagueWaitlistAssignments: [],
    outboundMessageLinks: [],
    queues: [
      {
        waitlistId: 3,
        name: 'Monday night',
        status: 'active',
        frozenEntryCount: 2,
        leagueIds: [10],
        leagueNames: ['Monday Open'],
        activeEntries: [
          { id: 1, memberId: 9, status: 'active', positionSortKey: '000001:1', storedPosition: 1, frozen: true },
        ],
      },
    ],
    ...overrides,
  };
}

describe('waitlist snapshot file names', () => {
  test('parses profile and stamp', () => {
    expect(parseSnapshotFileName('default-waitlists-2026-09-06T12-00-00-000Z.json')).toEqual({
      profile: 'default',
      stamp: '2026-09-06T12-00-00-000Z',
    });
    expect(parseSnapshotFileName('preview-waitlists-2026-09-06T12-00-00-000Z-pre-restore.json')).toEqual({
      profile: 'preview',
      stamp: '2026-09-06T12-00-00-000Z-pre-restore',
    });
    expect(parseSnapshotFileName('notes.md')).toBeNull();
  });

  test('identifies pre-restore backups', () => {
    expect(isPreRestoreSnapshotFile('default-waitlists-2026-09-06T12-00-00-000Z-pre-restore.json')).toBe(true);
    expect(isPreRestoreSnapshotFile('default-waitlists-2026-09-06T12-00-00-000Z.json')).toBe(false);
  });

  test('picks the latest snapshot for a profile and ignores pre-restore backups', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlist-snapshots-'));
    fs.writeFileSync(path.join(dir, snapshotFileName('default', '2026-09-06T01-00-00-000Z')), '{}');
    fs.writeFileSync(path.join(dir, snapshotFileName('default', '2026-09-06T03-00-00-000Z')), '{}');
    fs.writeFileSync(path.join(dir, snapshotFileName('default', '2026-09-06T04-00-00-000Z', '-pre-restore')), '{}');
    fs.writeFileSync(path.join(dir, snapshotFileName('preview', '2026-09-06T05-00-00-000Z')), '{}');
    expect(findLatestSnapshotFile(dir, 'default')).toBe(
      path.join(dir, 'default-waitlists-2026-09-06T03-00-00-000Z.json'),
    );
    expect(findLatestSnapshotFile(dir, 'preview')).toBe(
      path.join(dir, 'preview-waitlists-2026-09-06T05-00-00-000Z.json'),
    );
  });

  test('timestampForFileName is ISO-safe', () => {
    expect(timestampForFileName(new Date('2026-09-06T12:34:56.789Z'))).toBe('2026-09-06T12-34-56-789Z');
  });
});

describe('SQL helpers', () => {
  test('quotes identifiers', () => {
    expect(quoteIdent('waitlist_entries')).toBe('"waitlist_entries"');
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  test('builds identity inserts', () => {
    expect(insertSql('waitlist_entries', ['id', 'waitlist_id'], 2, true)).toBe(
      'INSERT INTO "waitlist_entries" ("id", "waitlist_id") OVERRIDING SYSTEM VALUE VALUES ($1, $2), ($3, $4)',
    );
    expect(insertSql('leagues', ['id', 'name'], 1, false)).toBe(
      'INSERT INTO "leagues" ("id", "name") VALUES ($1, $2)',
    );
  });
});

describe('cell serialization', () => {
  test('round-trips timestamps and jsonb', () => {
    const timestamp = {
      name: 'joined_at',
      formattedType: 'timestamp without time zone',
      udtName: 'timestamp',
      isIdentity: false,
    };
    const jsonb = {
      name: 'before_json',
      formattedType: 'jsonb',
      udtName: 'jsonb',
      isIdentity: false,
    };
    const iso = '2026-09-06T12:00:00.000Z';
    expect(serializeCell(new Date(iso))).toBe(iso);
    expect(deserializeCell(iso, timestamp)).toEqual(new Date(iso));
    expect(deserializeCell({ frozenEntryCount: 4 }, jsonb)).toEqual({ frozenEntryCount: 4 });
    expect(deserializeCell('{"frozenEntryCount":4}', jsonb)).toEqual({ frozenEntryCount: 4 });
  });
});

describe('snapshot document', () => {
  test('accepts versioned league waitlist snapshots', () => {
    expect(isWaitlistSnapshot(minimalSnapshot())).toBe(true);
    expect(isWaitlistSnapshot({ version: 2, kind: WAITLIST_SNAPSHOT_KIND })).toBe(false);
    expect(isWaitlistSnapshot({ hello: 'nope' })).toBe(false);
  });

  test('summary includes frozen rows', () => {
    const markdown = buildSummaryMarkdown(minimalSnapshot());
    expect(markdown).toContain('Monday night');
    expect(markdown).toContain('| 3 |');
    expect(markdown).toContain('| 1 | yes | 1 | 9 | active |');
  });
});
