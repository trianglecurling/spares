import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../../db/drizzle-db.js';

/** Menu type for authenticated / members-area navigation. */
export const MEMBER_MENU_TYPE = 'member';

type MemberMenuSeedNode = {
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  children?: MemberMenuSeedNode[];
};

/**
 * Default members-area nav mirroring the former hardcoded menu.
 * App routes use linkType `external` (admin "Other") with root-relative URLs,
 * matching public navbar custom-path items. Runtime treats these as SPA links.
 */
export const DEFAULT_MEMBER_MENU: MemberMenuSeedNode[] = [
  { label: 'Dashboard', linkType: 'external', url: '/dashboard' },
  {
    label: 'Leagues',
    linkType: null,
    url: null,
    children: [
      { label: 'View all', linkType: 'external', url: '/leagues' },
      { label: 'Waitlists', linkType: 'external', url: '/waitlists' },
    ],
  },
  {
    label: 'Spares',
    linkType: null,
    url: null,
    children: [
      { label: 'My availability', linkType: 'external', url: '/availability' },
      { label: 'My requests', linkType: 'external', url: '/my-requests' },
      { label: 'Request a spare', linkType: 'external', url: '/request-spare' },
    ],
  },
  {
    label: 'Club info',
    linkType: null,
    url: null,
    children: [
      { label: 'Club membership', linkType: 'external', url: '/members' },
      { label: 'Club governance', linkType: 'external', url: '/governance' },
      { label: 'Board meeting minutes', linkType: 'external', url: '/board-meeting-minutes' },
      { label: 'Building access', linkType: 'external', url: '/building-access' },
      { label: 'Member communications', linkType: 'external', url: '/member-communications' },
      { label: 'Emergency info', linkType: 'external', url: '/members-area/club-info/emergency-info' },
    ],
  },
  {
    label: 'Calendar',
    linkType: null,
    url: null,
    children: [
      { label: 'Full calendar', linkType: 'external', url: '/calendar' },
      { label: 'Book ice time', linkType: 'external', url: '/book-ice' },
    ],
  },
  {
    label: 'Volunteering',
    linkType: null,
    url: null,
    children: [
      { label: 'Volunteering & sign-ups', linkType: 'external', url: '/volunteering' },
      { label: 'My volunteering', linkType: 'external', url: '/volunteering?tab=shifts' },
      { label: 'Expense reports', linkType: 'external', url: '/expenses' },
    ],
  },
  {
    label: 'Admin',
    linkType: null,
    url: null,
    children: [],
  },
];

async function insertMemberMenuNode(
  node: MemberMenuSeedNode,
  parentId: number | null,
  sortOrder: number,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .insert(schema.menuItems)
    .values({
      menu_type: MEMBER_MENU_TYPE,
      parent_id: parentId,
      label: node.label,
      sort_order: sortOrder,
      link_type: node.linkType,
      url: node.url,
      open_in_new_tab: 0,
      article_id: null,
      use_article_title_for_label: 0,
    })
    .returning({ id: schema.menuItems.id });

  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    await insertMemberMenuNode(children[i]!, row!.id, i);
  }
}

/** Idempotent: seeds the members-area menu when no `member` menu items exist. */
export async function seedMemberMenuIfNeeded(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    .where(eq(schema.menuItems.menu_type, MEMBER_MENU_TYPE))
    .limit(1);
  if (existing.length > 0) return;

  for (let i = 0; i < DEFAULT_MEMBER_MENU.length; i++) {
    await insertMemberMenuNode(DEFAULT_MEMBER_MENU[i]!, null, i);
  }
}
