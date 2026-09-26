import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export type ContactSettingsNudgeStatus = {
  visible: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
};

export function contactSettingsNudgeIsVisible(input: {
  emailVisible: boolean;
  phoneVisible: boolean;
  dismissed: boolean;
}): boolean {
  return !input.emailVisible && !input.phoneVisible && !input.dismissed;
}

export async function getContactSettingsNudgeStatus(
  memberId: number,
): Promise<ContactSettingsNudgeStatus> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      emailVisible: schema.members.email_visible,
      phoneVisible: schema.members.phone_visible,
      dismissed: schema.members.contact_settings_nudge_dismissed,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);

  const emailVisible = row?.emailVisible === 1;
  const phoneVisible = row?.phoneVisible === 1;
  const dismissed = row?.dismissed === 1;

  return {
    visible: contactSettingsNudgeIsVisible({ emailVisible, phoneVisible, dismissed }),
    emailVisible,
    phoneVisible,
  };
}

export async function dismissContactSettingsNudge(memberId: number): Promise<{ success: boolean }> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      contact_settings_nudge_dismissed: 1,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.members.id, memberId));

  return { success: true };
}

export async function confirmContactSettingsNudge(
  memberId: number,
  input: { emailVisible: boolean; phoneVisible: boolean },
): Promise<{ success: boolean; emailVisible: boolean; phoneVisible: boolean }> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      email_visible: input.emailVisible ? 1 : 0,
      phone_visible: input.phoneVisible ? 1 : 0,
      contact_settings_nudge_dismissed: 1,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.members.id, memberId));

  return {
    success: true,
    emailVisible: input.emailVisible,
    phoneVisible: input.phoneVisible,
  };
}
