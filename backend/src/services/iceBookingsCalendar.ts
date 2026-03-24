import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { ExpandedDirectCalendarEvent } from './calendarExpansion.js';

export type IceBookingsCalendarViewer = 'public' | 'member' | 'admin';

/** Display label for the booking purpose (visible to all calendar viewers). */
export function iceBookingPurposeLabel(purpose: string): string {
  const map: Record<string, string> = {
    practice: 'Practice',
    makeup_game: 'Make-up game',
    guests: 'Bringing guests',
    guests_new: 'Bringing guests: new curlers',
    guests_experienced: 'Bringing guests: experienced',
    other: 'Other',
  };
  return map[purpose] ?? purpose;
}

/** Guest names and free-form purpose notes — calendar / ice admins only. */
function buildAdminPurposeNotes(
  purpose: string,
  purposeOther: string | null | undefined,
  guestNames: string | null | undefined
): string | undefined {
  const parts: string[] = [];
  if (purpose === 'guests_new' || purpose === 'guests_experienced') {
    const g = guestNames?.trim();
    if (g) parts.push(`**Guests:** ${g}`);
  }
  if (purpose === 'other') {
    const o = purposeOther?.trim();
    if (o) parts.push(`**Purpose notes:** ${o}`);
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/** Member ice reservations as calendar payloads (visibility depends on viewer). */
export async function fetchIceBookingsAsCalendarEvents(
  rangeStart: Date,
  rangeEnd: Date,
  viewer: IceBookingsCalendarViewer
): Promise<ExpandedDirectCalendarEvent[]> {
  const { db, schema } = getDrizzleDb();
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();

  const rows = await db
    .select({
      id: schema.iceBookings.id,
      sheet_id: schema.iceBookings.sheet_id,
      sheet_name: schema.sheets.name,
      start_dt: schema.iceBookings.start_dt,
      end_dt: schema.iceBookings.end_dt,
      purpose: schema.iceBookings.purpose,
      purpose_other: schema.iceBookings.purpose_other,
      guest_names: schema.iceBookings.guest_names,
      member_name: schema.members.name,
    })
    .from(schema.iceBookings)
    .innerJoin(schema.members, eq(schema.iceBookings.member_id, schema.members.id))
    .innerJoin(schema.sheets, eq(schema.iceBookings.sheet_id, schema.sheets.id))
    .where(
      and(
        sql`${schema.iceBookings.start_dt} < ${rangeEndIso}`,
        sql`${schema.iceBookings.end_dt} > ${rangeStartIso}`
      )
    );

  return rows.map((row) => {
    const title =
      viewer === 'public' ? 'Member ice booking' : (row.member_name ?? 'Member ice booking');

    const purposeBlock = `**Purpose:** ${iceBookingPurposeLabel(row.purpose)}`;
    const adminNotes = buildAdminPurposeNotes(row.purpose, row.purpose_other, row.guest_names);
    const description =
      viewer === 'admin' && adminNotes
        ? `${purposeBlock}\n\n${adminNotes}`
        : purposeBlock;

    return {
      id: `ice-booking:${row.id}`,
      typeId: 'member-ice',
      title,
      start: row.start_dt,
      end: row.end_dt,
      allDay: false,
      description: description ?? undefined,
      locations: [
        {
          type: 'sheet' as const,
          sheetId: row.sheet_id,
          sheetName: row.sheet_name ?? undefined,
        },
      ],
      source: 'ice-booking',
    };
  });
}
