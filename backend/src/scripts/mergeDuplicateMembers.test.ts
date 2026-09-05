import { describe, expect, test } from 'bun:test';
import {
  KNOWN_MEMBER_MERGES,
  assertSqlIdent,
  conflictDeleteSql,
  parseMergeCliArgs,
  remainingFkCountSql,
  attachmentCountsSql,
  remapUpdateSql,
  resolveMergeGroups,
  sameFirstLastName,
  uniqueConflictFromIndex,
  validateKnownMemberMerges,
  normalizePgTextArray,
} from './mergeDuplicateMembers.js';

describe('KNOWN_MEMBER_MERGES', () => {
  test('has unique keep and drop ids', () => {
    expect(validateKnownMemberMerges(KNOWN_MEMBER_MERGES)).toEqual([]);
  });
});

describe('name matching', () => {
  test('matches first and last name case-insensitively', () => {
    expect(
      sameFirstLastName({ first_name: 'Kara', last_name: 'Davidson' }, { first_name: 'kara', last_name: ' davidson ' }),
    ).toBe(true);
  });

  test('rejects different last names', () => {
    expect(
      sameFirstLastName({ first_name: 'Karl', last_name: 'Lindekugel IV' }, { first_name: 'Karl', last_name: 'Lindekugel V' }),
    ).toBe(false);
  });
});

describe('SQL helpers', () => {
  test('parses Postgres text arrays', () => {
    expect(normalizePgTextArray(['league_id', 'member_id'])).toEqual(['league_id', 'member_id']);
    expect(normalizePgTextArray('{league_id,member_id}')).toEqual(['league_id', 'member_id']);
  });

  test('rejects unsafe identifiers', () => {
    expect(() => assertSqlIdent('members;drop')).toThrow(/unsafe SQL identifier/);
  });

  test('builds remap and count SQL', () => {
    expect(remapUpdateSql('season_memberships', 'member_id')).toBe(
      'UPDATE "season_memberships" SET "member_id" = $1 WHERE "member_id" = $2',
    );
    expect(remainingFkCountSql('league_roster', 'member_id')).toBe(
      'SELECT count(*)::int AS n FROM "league_roster" WHERE "member_id" = $1',
    );
    expect(attachmentCountsSql([{ table: 'league_roster', column: 'member_id' }])).toContain(
      'FROM "league_roster" WHERE "member_id" = $1',
    );
  });

  test('deletes unique conflicts on the other key columns', () => {
    const index = uniqueConflictFromIndex({
      table: 'league_roster',
      column: 'member_id',
      columns: ['league_id', 'member_id'],
      predicate: null,
    });
    expect(index).not.toBeNull();
    expect(conflictDeleteSql(index!)).toBe(
      'DELETE FROM "league_roster" AS d USING "league_roster" AS k WHERE d."member_id" = $1 AND k."member_id" = $2 AND d."league_id" IS NOT DISTINCT FROM k."league_id"',
    );
  });

  test('handles the active waitlist partial unique index', () => {
    const index = uniqueConflictFromIndex({
      table: 'waitlist_entries',
      column: 'member_id',
      columns: ['member_id', 'waitlist_id'],
      predicate: "(status = 'active'::text)",
    });
    expect(index?.extraPredicates).toEqual(['"d"."status" = \'active\'', '"k"."status" = \'active\'']);
  });

  test('rejects unknown partial unique predicates', () => {
    expect(() =>
      uniqueConflictFromIndex({
        table: 'waitlist_entries',
        column: 'member_id',
        columns: ['member_id', 'waitlist_id'],
        predicate: "(status = 'frozen'::text)",
      }),
    ).toThrow(/Unsupported partial unique index/);
  });
});

describe('CLI args', () => {
  test('parses known dry-run', () => {
    expect(parseMergeCliArgs(['--known'])).toEqual({
      apply: false,
      known: true,
      force: false,
      keep: null,
      drop: [],
    });
  });

  test('parses keep/drop apply', () => {
    expect(parseMergeCliArgs(['--apply', '--keep', '587', '--drop', '586', '--drop', '584'])).toEqual({
      apply: true,
      known: false,
      force: false,
      keep: 587,
      drop: [586, 584],
    });
  });

  test('rejects mixing apply and dry-run', () => {
    expect(() => parseMergeCliArgs(['--apply', '--dry-run'])).toThrow(/either --dry-run or --apply/);
  });

  test('resolves the known merge list', () => {
    expect(resolveMergeGroups({ apply: false, known: true, force: false, keep: null, drop: [] })).toBe(
      KNOWN_MEMBER_MERGES,
    );
  });
});
