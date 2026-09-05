/**
 * Merge duplicate member records by remapping every FK onto the keeper, then
 * deleting the leftover member rows.
 *
 * Defaults to dry-run. Does not call initializeDatabase / migrations.
 *
 * Usage:
 *   bun run src/scripts/merge-duplicate-members.ts --dry-run --known
 *   bun run src/scripts/merge-duplicate-members.ts --apply --known
 *   bun run src/scripts/merge-duplicate-members.ts --dry-run --keep 587 --drop 586
 *   bun run src/scripts/merge-duplicate-members.ts --apply --keep 587 --drop 586 --force
 *
 * Preview:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/merge-duplicate-members.ts --dry-run --known
 */

import { Pool, type PoolClient } from 'pg';
import { getDatabaseConfig } from '../db/config.js';
import {
  KNOWN_MEMBER_MERGES,
  LOGICAL_UNIQUE_KEYS,
  conflictDeleteSql,
  parseMergeCliArgs,
  attachmentCountsSql,
  remapUpdateSql,
  resolveMergeGroups,
  sameFirstLastName,
  uniqueConflictFromIndex,
  validateKnownMemberMerges,
  type KnownMemberMerge,
  type UniqueConflictIndex,
} from './mergeDuplicateMembers.js';

type MemberFk = { table: string; column: string };
type MemberRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string;
  account_kind: string | null;
};

function usage(): never {
  console.error(`Usage:
  bun run src/scripts/merge-duplicate-members.ts --dry-run --known
  bun run src/scripts/merge-duplicate-members.ts --apply --known
  bun run src/scripts/merge-duplicate-members.ts --dry-run --keep <id> --drop <id> [--drop <id> ...]
  bun run src/scripts/merge-duplicate-members.ts --apply --keep <id> --drop <id> [--force]`);
  process.exit(1);
}

async function loadMemberFks(client: PoolClient): Promise<MemberFk[]> {
  const result = await client.query<MemberFk>(`
    SELECT src.relname AS table, a.attname AS column
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN LATERAL unnest(c.conkey, c.confkey) AS cols(src_attnum, tgt_attnum) ON true
    JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = cols.src_attnum
    JOIN pg_attribute t ON t.attrelid = tgt.oid AND t.attnum = cols.tgt_attnum
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND tgt.relname = 'members'
      AND t.attname = 'id'
    ORDER BY src.relname, a.attname
  `);
  return result.rows;
}

async function loadConflictIndexes(client: PoolClient, fks: MemberFk[]): Promise<UniqueConflictIndex[]> {
  const result = await client.query<{
    table_name: string;
    columns: string[];
    predicate: string | null;
  }>(`
    SELECT
      t.relname AS table_name,
      ARRAY(
        SELECT a.attname
        FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS columns,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate
    FROM pg_class t
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND ix.indisunique
      AND NOT ix.indisprimary
  `);

  const byTableColumn = new Map<string, UniqueConflictIndex>();
  const add = (index: UniqueConflictIndex) => {
    const key = `${index.table}.${index.column}:${index.otherColumns.join(',')}:${index.extraPredicates.join(',')}`;
    byTableColumn.set(key, index);
  };

  for (const fk of fks) {
    for (const row of result.rows) {
      if (row.table_name !== fk.table) continue;
      const index = uniqueConflictFromIndex({
        table: row.table_name,
        column: fk.column,
        columns: row.columns,
        predicate: row.predicate,
      });
      if (index) add(index);
    }
  }

  for (const logical of LOGICAL_UNIQUE_KEYS) {
    add({
      table: logical.table,
      column: logical.column,
      otherColumns: logical.withColumns,
      extraPredicates: [],
    });
  }

  return [...byTableColumn.values()];
}

async function loadMember(client: PoolClient, id: number): Promise<MemberRow> {
  const result = await client.query<MemberRow>(
    `SELECT id, first_name, last_name, name, email, account_kind
     FROM members
     WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Member ${id} was not found.`);
  return row;
}

async function loadAttachments(
  client: PoolClient,
  fks: MemberFk[],
  memberId: number,
): Promise<Array<MemberFk & { n: number }>> {
  const result = await client.query<{ table_name: string; column_name: string; n: number }>(
    attachmentCountsSql(fks),
    [memberId],
  );
  return result.rows
    .filter((row) => Number(row.n) > 0)
    .map((row) => ({ table: row.table_name, column: row.column_name, n: Number(row.n) }));
}

async function mergeOne(
  client: PoolClient,
  group: KnownMemberMerge,
  fks: MemberFk[],
  conflicts: UniqueConflictIndex[],
  options: { apply: boolean; force: boolean },
): Promise<void> {
  const keep = await loadMember(client, group.keep);
  if ((keep.account_kind ?? 'person') !== 'person') {
    throw new Error(`Keeper ${keep.id} is not a person account.`);
  }

  const drops: MemberRow[] = [];
  for (const dropId of group.drop) {
    const drop = await loadMember(client, dropId);
    if ((drop.account_kind ?? 'person') !== 'person') {
      throw new Error(`Drop ${drop.id} is not a person account.`);
    }
    if (!options.force && !sameFirstLastName(keep, drop)) {
      throw new Error(
        `Refusing to merge ${drop.id} (${drop.first_name} ${drop.last_name}) into ${keep.id} (${keep.first_name} ${keep.last_name}) without --force.`,
      );
    }
    drops.push(drop);
  }

  console.log(`\n${group.name}: keep ${keep.id} <${keep.email}>, drop ${drops.map((row) => `${row.id} <${row.email}>`).join(', ')}`);
  console.log(`  ${group.note}`);

  for (const drop of drops) {
    const attachments = await loadAttachments(client, fks, drop.id);
    if (attachments.length === 0) {
      console.log(`  ${drop.id}: no FK rows`);
    } else {
      console.log(
        `  ${drop.id}: ${attachments.map((row) => `${row.table}.${row.column}=${row.n}`).join(', ')}`,
      );
    }
  }

  if (!options.apply) return;

  for (const drop of drops) {
    await client.query(
      `
      UPDATE members AS k
      SET
        lifetime_member = GREATEST(k.lifetime_member, d.lifetime_member),
        is_server_admin = GREATEST(k.is_server_admin, d.is_server_admin),
        is_calendar_admin = GREATEST(k.is_calendar_admin, d.is_calendar_admin),
        is_content_admin = GREATEST(k.is_content_admin, d.is_content_admin),
        is_sponsor_admin = GREATEST(k.is_sponsor_admin, d.is_sponsor_admin),
        opted_in_sms = GREATEST(k.opted_in_sms, d.opted_in_sms),
        baseline_club_experience_years = GREATEST(k.baseline_club_experience_years, d.baseline_club_experience_years),
        baseline_other_club_experience_years = GREATEST(
          k.baseline_other_club_experience_years,
          d.baseline_other_club_experience_years
        ),
        phone = COALESCE(NULLIF(BTRIM(k.phone), ''), d.phone),
        date_of_birth = COALESCE(k.date_of_birth, d.date_of_birth),
        mailing_address = COALESCE(NULLIF(BTRIM(k.mailing_address), ''), d.mailing_address),
        emergency_contact_name = COALESCE(NULLIF(BTRIM(k.emergency_contact_name), ''), d.emergency_contact_name),
        emergency_contact_phone = COALESCE(NULLIF(BTRIM(k.emergency_contact_phone), ''), d.emergency_contact_phone),
        guardian_first_name = COALESCE(NULLIF(BTRIM(k.guardian_first_name), ''), d.guardian_first_name),
        guardian_last_name = COALESCE(NULLIF(BTRIM(k.guardian_last_name), ''), d.guardian_last_name),
        guardian_email = COALESCE(NULLIF(BTRIM(k.guardian_email), ''), d.guardian_email),
        guardian_phone = COALESCE(NULLIF(BTRIM(k.guardian_phone), ''), d.guardian_phone),
        name_tag_name = COALESCE(NULLIF(BTRIM(k.name_tag_name), ''), d.name_tag_name),
        updated_at = CURRENT_TIMESTAMP
      FROM members AS d
      WHERE k.id = $1 AND d.id = $2
      `,
      [keep.id, drop.id],
    );
  }

  for (const drop of drops) {
    for (const conflict of conflicts) {
      const deleted = await client.query(conflictDeleteSql(conflict), [drop.id, keep.id]);
      if ((deleted.rowCount ?? 0) > 0) {
        console.log(
          `  dropped ${deleted.rowCount} conflicting ${conflict.table}.${conflict.column} row(s) from ${drop.id}`,
        );
      }
    }

    for (const fk of fks) {
      const updated = await client.query(remapUpdateSql(fk.table, fk.column), [keep.id, drop.id]);
      if ((updated.rowCount ?? 0) > 0) {
        console.log(`  remapped ${updated.rowCount} ${fk.table}.${fk.column} row(s) ${drop.id} -> ${keep.id}`);
      }
    }

    const selfDelegations = await client.query(
      `DELETE FROM member_account_access_delegations
       WHERE grantor_member_id = $1 AND grantee_member_id = $1`,
      [keep.id],
    );
    if ((selfDelegations.rowCount ?? 0) > 0) {
      console.log(`  removed ${selfDelegations.rowCount} self-delegation(s) on ${keep.id}`);
    }

    const leftovers = await loadAttachments(client, fks, drop.id);
    if (leftovers.length > 0) {
      throw new Error(
        `Refusing to delete member ${drop.id}; leftover FKs: ${leftovers
          .map((fk) => `${fk.table}.${fk.column}`)
          .join(', ')}`,
      );
    }

    await client.query('DELETE FROM members WHERE id = $1', [drop.id]);
    console.log(`  deleted member ${drop.id}`);
  }
}

async function main() {
  let args;
  try {
    args = parseMergeCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
  }

  const knownErrors = validateKnownMemberMerges(KNOWN_MEMBER_MERGES);
  if (knownErrors.length > 0) {
    throw new Error(knownErrors.join('\n'));
  }

  let groups: KnownMemberMerge[];
  try {
    groups = resolveMergeGroups(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig?.postgres) {
    console.error('This script requires Postgres. Expected backend/data/db-config.json.');
    process.exit(1);
  }

  const pool = new Pool({
    host: dbConfig.postgres.host,
    port: dbConfig.postgres.port,
    database: dbConfig.postgres.database,
    user: dbConfig.postgres.username,
    password: dbConfig.postgres.password,
    ssl: dbConfig.postgres.ssl ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    console.log(
      JSON.stringify({
        mode: args.apply ? 'apply' : 'dry-run',
        profile: process.env.DB_CONFIG_PROFILE ?? 'default',
        database: dbConfig.postgres.database,
        groups: groups.length,
      }),
    );

    const fks = await loadMemberFks(client);
    const conflicts = await loadConflictIndexes(client, fks);

    if (args.apply) await client.query('BEGIN');
    try {
      for (const group of groups) {
        await mergeOne(client, group, fks, conflicts, { apply: args.apply, force: args.force });
      }
      if (args.apply) {
        await client.query('COMMIT');
        console.log('\nCommitted.');
      } else {
        console.log('\nDry run only. Pass --apply to write.');
      }
    } catch (error) {
      if (args.apply) await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
