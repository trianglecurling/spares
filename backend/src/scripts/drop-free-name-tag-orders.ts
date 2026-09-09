/**
 * Drop free replacement name-tag orders placed before the price was set.
 *
 * Around 2026-08-29 09:00 America/New_York the replacement name-tag fee was still
 * $0, so returning members who opted in were recorded as ordering a tag without
 * being charged. This sets `name_tag_replacement_quantity` to 0 on those
 * registrations, except people who confirmed they still want a tag at $15.00.
 *
 * Registrations that already have a charged replacement-name-tag invoice line
 * are also left alone so a paid tag is not dropped.
 *
 * Usage:
 *   bun run src/scripts/drop-free-name-tag-orders.ts --dry-run
 *   bun run src/scripts/drop-free-name-tag-orders.ts --apply
 *
 * Uses backend/data/db-config.json by default. For preview:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/drop-free-name-tag-orders.ts --dry-run
 */

import { inArray, sql } from 'drizzle-orm';
import { connectDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { closeDrizzleDb, getDrizzleDb } from '../db/drizzle-db.js';
import { formatMemberDisplayName, memberNamePartsFromStored, normalizePersonName } from '../utils/memberName.js';

/** Club-local instant the price should have been in effect. Stored timestamps are UTC. */
const CUTOFF_UTC_SQL = '2026-08-29 13:00:00';
const NAME_TAG_FEE_MINOR = 1500;

type KeepPerson = {
  label: string;
  aliases: string[];
};

const KEEP_PEOPLE: KeepPerson[] = [
  { label: "Brian O'Donnell", aliases: ["Brian O'Donnell", 'Brian ODonnell'] },
  { label: 'Kayla Soltis-Katella', aliases: ['Kayla Soltis-Katella'] },
  { label: 'Drew Tingen', aliases: ['Drew Tingen'] },
  { label: 'Hal Lagenbach', aliases: ['Hal Lagenbach', 'Hal Langenbach'] },
  { label: 'Hayley Herring', aliases: ['Hayley Herring'] },
  { label: 'Jessica Mullenix', aliases: ['Jessica Mullenix'] },
  { label: 'Alexander Lee Waldie', aliases: ['Alexander Lee Waldie', 'Alexander Waldie', 'Alex Waldie'] },
  { label: 'Diana Lewis', aliases: ['Diana Lewis'] },
  { label: 'Chris Lewis', aliases: ['Chris Lewis'] },
  { label: 'Mike Hartman', aliases: ['Mike Hartman'] },
  { label: "Kiera O'Donnell", aliases: ["Kiera O'Donnell", 'Kiera ODonnell'] },
];

type CandidateRow = {
  registrationId: number;
  status: string;
  quantity: number;
  submittedAt: string | null;
  createdAt: string;
  memberId: number;
  memberName: string;
  invoiceId: number | null;
  invoiceStatus: string | null;
  invoiceTotalMinor: number | null;
  nameTagLineMinor: number | null;
};

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normalizeMatchName(value: string): string {
  return normalizePersonName(value)
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function memberMatchNames(member: { name: string; first_name: string | null; last_name: string | null }): string[] {
  const parts = memberNamePartsFromStored(member);
  return [member.name, formatMemberDisplayName(parts.firstName, parts.lastName)]
    .map(normalizeMatchName)
    .filter(Boolean);
}

function keepKeys(person: KeepPerson): Set<string> {
  return new Set(person.aliases.map(normalizeMatchName));
}

async function loadCandidates(): Promise<CandidateRow[]> {
  const { db } = getDrizzleDb();
  const result = await db.execute(sql`
    SELECT
      r.id AS registration_id,
      r.status,
      r.name_tag_replacement_quantity AS quantity,
      r.submitted_at::text AS submitted_at,
      r.created_at::text AS created_at,
      m.id AS member_id,
      m.name AS member_name,
      m.first_name,
      m.last_name,
      i.id AS invoice_id,
      i.status AS invoice_status,
      i.total_minor AS invoice_total_minor,
      li.amount_minor AS name_tag_line_minor
    FROM curling_registrations r
    JOIN members m ON m.id = r.curler_member_id
    LEFT JOIN LATERAL (
      SELECT inv.id, inv.status, inv.total_minor
      FROM registration_invoices inv
      WHERE inv.registration_id = r.id
      ORDER BY inv.updated_at DESC, inv.id DESC
      LIMIT 1
    ) i ON true
    LEFT JOIN registration_invoice_line_items li
      ON li.invoice_id = i.id AND li.line_type = 'replacement_name_tag_fee'
    WHERE r.name_tag_replacement_quantity > 0
      AND COALESCE(r.submitted_at, r.created_at) < ${CUTOFF_UTC_SQL}::timestamp
    ORDER BY m.name, r.id
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    registrationId: Number(row.registration_id),
    status: String(row.status),
    quantity: Number(row.quantity),
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    createdAt: String(row.created_at),
    memberId: Number(row.member_id),
    memberName: String(row.member_name),
    invoiceId: row.invoice_id == null ? null : Number(row.invoice_id),
    invoiceStatus: row.invoice_status == null ? null : String(row.invoice_status),
    invoiceTotalMinor: row.invoice_total_minor == null ? null : Number(row.invoice_total_minor),
    nameTagLineMinor: row.name_tag_line_minor == null ? null : Number(row.name_tag_line_minor),
  }));
}

async function loadMembersForKeepers(): Promise<Array<{ id: number; name: string; first_name: string | null; last_name: string | null }>> {
  const { db, schema } = getDrizzleDb();
  return db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
    })
    .from(schema.members);
}

function resolveKeepers(
  members: Array<{ id: number; name: string; first_name: string | null; last_name: string | null }>,
): Map<string, { memberId: number; memberName: string }> {
  const resolved = new Map<string, { memberId: number; memberName: string }>();
  const missing: string[] = [];
  const ambiguous: string[] = [];

  for (const person of KEEP_PEOPLE) {
    const keys = keepKeys(person);
    const matches = members.filter((member) => memberMatchNames(member).some((name) => keys.has(name)));
    if (matches.length === 0) {
      missing.push(person.label);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push(`${person.label} -> ${matches.map((m) => `${m.name} (#${m.id})`).join(', ')}`);
      continue;
    }
    resolved.set(person.label, { memberId: matches[0].id, memberName: matches[0].name });
  }

  if (missing.length > 0 || ambiguous.length > 0) {
    const parts = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : null,
      ambiguous.length > 0 ? `ambiguous: ${ambiguous.join('; ')}` : null,
    ].filter(Boolean);
    throw new Error(`Could not uniquely resolve keep-list members (${parts.join('; ')}).`);
  }

  return resolved;
}

function classify(rows: CandidateRow[], keepersByLabel: Map<string, { memberId: number; memberName: string }>) {
  const keepMemberIds = new Set([...keepersByLabel.values()].map((keeper) => keeper.memberId));
  const keep: CandidateRow[] = [];
  const alreadyCharged: CandidateRow[] = [];
  const drop: CandidateRow[] = [];

  for (const row of rows) {
    if (keepMemberIds.has(row.memberId)) {
      keep.push(row);
      continue;
    }
    if ((row.nameTagLineMinor ?? 0) > 0) {
      alreadyCharged.push(row);
      continue;
    }
    drop.push(row);
  }

  const keepersWithoutCandidate: string[] = [];
  for (const [label, keeper] of keepersByLabel) {
    if (!keep.some((row) => row.memberId === keeper.memberId)) {
      keepersWithoutCandidate.push(`${label} (${keeper.memberName} #${keeper.memberId})`);
    }
  }

  return { keep, alreadyCharged, drop, keepersWithoutCandidate };
}

async function applyDrops(registrationIds: number[]): Promise<void> {
  if (registrationIds.length === 0) return;
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        name_tag_replacement_quantity: 0,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(inArray(schema.curlingRegistrations.id, registrationIds));
  });
}

function summarizeRow(row: CandidateRow) {
  return {
    registrationId: row.registrationId,
    memberId: row.memberId,
    name: row.memberName,
    status: row.status,
    quantity: row.quantity,
    submittedAt: row.submittedAt,
    invoiceId: row.invoiceId,
    invoiceStatus: row.invoiceStatus,
    nameTagLineMinor: row.nameTagLineMinor,
  };
}

async function main() {
  const apply = argvFlag('--apply');
  if (apply && argvFlag('--dry-run')) {
    console.error('Pass either --dry-run or --apply, not both.');
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await connectDatabase(dbConfig);
  try {
    const members = await loadMembersForKeepers();
    const keepersByLabel = resolveKeepers(members);
    const candidates = await loadCandidates();
    const classified = classify(candidates, keepersByLabel);
    if (classified.keepersWithoutCandidate.length > 0) {
      throw new Error(
        `Keep-list members have no name-tag order before the cutoff: ${classified.keepersWithoutCandidate.join(', ')}.`,
      );
    }

    const keepersNeedingCharge = classified.keep.filter((row) => (row.nameTagLineMinor ?? 0) < NAME_TAG_FEE_MINOR);

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          profile: process.env.DB_CONFIG_PROFILE ?? 'default',
          cutoffUtc: CUTOFF_UTC_SQL,
          replacementNameTagFeeMinor: NAME_TAG_FEE_MINOR,
          candidates: candidates.length,
          dropCount: classified.drop.length,
          keepCount: classified.keep.length,
          alreadyChargedCount: classified.alreadyCharged.length,
          keepers: [...keepersByLabel.entries()].map(([label, keeper]) => ({
            requestedAs: label,
            memberId: keeper.memberId,
            memberName: keeper.memberName,
          })),
          keep: classified.keep.map(summarizeRow),
          alreadyCharged: classified.alreadyCharged.map(summarizeRow),
          keepersNeedingCharge: keepersNeedingCharge.map((row) => ({
            name: row.memberName,
            registrationId: row.registrationId,
            invoiceStatus: row.invoiceStatus,
            invoiceTotalMinor: row.invoiceTotalMinor,
          })),
          drop: classified.drop.map(summarizeRow),
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log(`Dry-run only. Would set name_tag_replacement_quantity=0 on ${classified.drop.length} registrations.`);
      return;
    }

    await applyDrops(classified.drop.map((row) => row.registrationId));

    const { db, schema } = getDrizzleDb();
    const remaining = classified.drop.length
      ? await db
          .select({
            id: schema.curlingRegistrations.id,
            quantity: schema.curlingRegistrations.name_tag_replacement_quantity,
          })
          .from(schema.curlingRegistrations)
          .where(inArray(schema.curlingRegistrations.id, classified.drop.map((row) => row.registrationId)))
      : [];
    const stillOrdered = remaining.filter((row) => (row.quantity ?? 0) > 0);
    if (stillOrdered.length > 0) {
      throw new Error(
        `Apply finished but ${stillOrdered.length} registrations still have a name-tag quantity: ${stillOrdered
          .map((row) => row.id)
          .join(', ')}.`,
      );
    }

    const kept = await db
      .select({
        id: schema.curlingRegistrations.id,
        quantity: schema.curlingRegistrations.name_tag_replacement_quantity,
      })
      .from(schema.curlingRegistrations)
      .where(inArray(schema.curlingRegistrations.id, [...classified.keep, ...classified.alreadyCharged].map((row) => row.registrationId)));
    const lostKeep = kept.filter((row) => (row.quantity ?? 0) <= 0);
    if (lostKeep.length > 0) {
      throw new Error(`Apply cleared a keep/already-charged registration: ${lostKeep.map((row) => row.id).join(', ')}.`);
    }

    console.log(`Applied. Cleared name-tag orders on ${classified.drop.length} registrations.`);
  } finally {
    await closeDrizzleDb();
  }
}

await main();
