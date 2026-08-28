import { eq } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';
import {
  formatMemberDisplayName,
  normalizeOptionalPersonName,
  normalizePersonName,
} from '../utils/memberName.js';

export type StoredMemberNameFields = {
  name: string;
  first_name: string | null;
  last_name: string | null;
  emergency_contact_name: string | null;
  name_tag_name: string | null;
  guardian_first_name: string | null;
  guardian_last_name: string | null;
};

function sameOptional(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null);
}

/** Returns repaired fields when any person-name column needs encoding cleanup. */
export function repairedMemberNameFields(row: StoredMemberNameFields): StoredMemberNameFields | null {
  const first_name = normalizeOptionalPersonName(row.first_name);
  const last_name = normalizeOptionalPersonName(row.last_name);
  const emergency_contact_name = normalizeOptionalPersonName(row.emergency_contact_name);
  const name_tag_name = normalizeOptionalPersonName(row.name_tag_name);
  const guardian_first_name = normalizeOptionalPersonName(row.guardian_first_name);
  const guardian_last_name = normalizeOptionalPersonName(row.guardian_last_name);
  const repairedFull = normalizePersonName(row.name) || row.name;
  const name = first_name && last_name ? formatMemberDisplayName(first_name, last_name) : repairedFull;

  if (
    name === row.name &&
    sameOptional(first_name, row.first_name) &&
    sameOptional(last_name, row.last_name) &&
    sameOptional(emergency_contact_name, row.emergency_contact_name) &&
    sameOptional(name_tag_name, row.name_tag_name) &&
    sameOptional(guardian_first_name, row.guardian_first_name) &&
    sameOptional(guardian_last_name, row.guardian_last_name)
  ) {
    return null;
  }

  return {
    name,
    first_name,
    last_name,
    emergency_contact_name,
    name_tag_name,
    guardian_first_name,
    guardian_last_name,
  };
}

/**
 * Persist encoding repairs for stored person names. Idempotent.
 * Does not bump updated_at so this is not treated as a profile edit.
 */
export async function repairStoredPersonNameEncoding(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const members = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
      emergency_contact_name: schema.members.emergency_contact_name,
      name_tag_name: schema.members.name_tag_name,
      guardian_first_name: schema.members.guardian_first_name,
      guardian_last_name: schema.members.guardian_last_name,
    })
    .from(schema.members);

  let memberUpdates = 0;
  for (const row of members) {
    const repaired = repairedMemberNameFields({
      name: row.name,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      emergency_contact_name: row.emergency_contact_name ?? null,
      name_tag_name: row.name_tag_name ?? null,
      guardian_first_name: row.guardian_first_name ?? null,
      guardian_last_name: row.guardian_last_name ?? null,
    });
    if (!repaired) continue;
    await db.update(schema.members).set(repaired as Record<string, unknown>).where(eq(schema.members.id, row.id));
    memberUpdates += 1;
  }

  const guestRows = await db
    .select({
      id: schema.volunteerSignups.id,
      guest_name: schema.volunteerSignups.guest_name,
    })
    .from(schema.volunteerSignups);

  let guestUpdates = 0;
  for (const row of guestRows) {
    if (row.guest_name == null) continue;
    const repaired = normalizeOptionalPersonName(row.guest_name);
    if (repaired === row.guest_name) continue;
    await db
      .update(schema.volunteerSignups)
      .set({ guest_name: repaired } as Record<string, unknown>)
      .where(eq(schema.volunteerSignups.id, row.id));
    guestUpdates += 1;
  }

  if (memberUpdates > 0 || guestUpdates > 0) {
    console.log(
      `Repaired person-name encoding on ${memberUpdates} member row(s) and ${guestUpdates} volunteer guest name(s)`
    );
  }
}
