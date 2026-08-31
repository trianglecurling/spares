import type { NavMenuItemNode } from '../components/DesktopFlyoutNav';

export type { NavMenuItemNode };

const EMERGENCY_INFO_LABEL_CLASS =
  '!text-red-600 hover:!text-red-700 dark:!text-red-400 dark:hover:!text-red-300';

const ACTIVE_MEMBER_ONLY_PATHS = new Set(['/building-access', '/member-communications']);
const SOCIAL_HIDDEN_PATHS = new Set(['/book-ice']);
const SPARE_PATHS = new Set(['/availability', '/my-requests', '/request-spare']);

function pathOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split('?')[0]?.trim() || null;
  return path || null;
}

function isEmergencyInfoLabel(label: string): boolean {
  return label.toLowerCase().includes('emergency info');
}

function withEmergencyStyle(item: NavMenuItemNode): NavMenuItemNode {
  return {
    ...item,
    labelClassName: isEmergencyInfoLabel(item.label) ? EMERGENCY_INFO_LABEL_CLASS : item.labelClassName,
    children: item.children.map(withEmergencyStyle),
  };
}

function mapTree(
  items: NavMenuItemNode[],
  mapItem: (item: NavMenuItemNode) => NavMenuItemNode | null,
): NavMenuItemNode[] {
  const result: NavMenuItemNode[] = [];
  for (const item of items) {
    const mappedChildren = mapTree(item.children, mapItem);
    const next = mapItem({ ...item, children: mappedChildren });
    if (next) result.push(next);
  }
  return result;
}

function sectionLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function hasChildPath(item: NavMenuItemNode, path: string): boolean {
  return item.children.some((child) => pathOnly(child.url) === path);
}

function isLeaguesSection(item: NavMenuItemNode): boolean {
  return sectionLabelKey(item.label) === 'leagues' || hasChildPath(item, '/leagues');
}

function isSparesSection(item: NavMenuItemNode): boolean {
  // Label-based: spare path children may already be filtered out for social members.
  return sectionLabelKey(item.label) === 'spares';
}

function isAdminSection(item: NavMenuItemNode): boolean {
  return sectionLabelKey(item.label) === 'admin';
}

function infoRow(id: number, label: string): NavMenuItemNode {
  return { id, label, linkType: null, url: null, openInNewTab: false, children: [] };
}

function internalLink(id: number, label: string, url: string): NavMenuItemNode {
  return { id, label, linkType: 'internal', url, openInNewTab: false, children: [] };
}

function section(id: number, label: string, children: NavMenuItemNode[]): NavMenuItemNode {
  return { id, label, linkType: null, url: null, openInNewTab: false, children };
}

interface ResolveMemberNavMenuItemsInput {
  menuTree: NavMenuItemNode[];
  navMyLeaguesInCurrentSession: Array<{ id: number; name: string }>;
  isSocialMember: boolean;
  isActiveMember: boolean;
  adminLinks: Array<{ to: string; label: string }>;
  hasAdminLinks: boolean;
}

/**
 * Applies membership gates, injects personal leagues and admin links, and styles
 * emergency-info labels on a DB-backed members-area menu tree.
 */
export function resolveMemberNavMenuItems({
  menuTree,
  navMyLeaguesInCurrentSession,
  isSocialMember,
  isActiveMember,
  adminLinks,
  hasAdminLinks,
}: ResolveMemberNavMenuItemsInput): NavMenuItemNode[] {
  let syntheticId = -1;
  const nextId = () => {
    const id = syntheticId;
    syntheticId -= 1;
    return id;
  };

  const gated = mapTree(menuTree, (item) => {
    const path = pathOnly(item.url);

    if (!isActiveMember && path && ACTIVE_MEMBER_ONLY_PATHS.has(path)) {
      return null;
    }
    if (isSocialMember && path && SOCIAL_HIDDEN_PATHS.has(path)) {
      return null;
    }
    if (isSocialMember && path && SPARE_PATHS.has(path)) {
      return null;
    }

    if (isAdminSection(item)) {
      if (!hasAdminLinks) return null;
      return {
        ...item,
        children: adminLinks.map((link) => internalLink(nextId(), link.label, link.to)),
      };
    }

    if (isSparesSection(item) && isSocialMember) {
      return {
        ...item,
        children: [
          infoRow(nextId(), 'Social memberships do not include sparing or spare requests.'),
        ],
      };
    }

    if (isLeaguesSection(item)) {
      const leagueChildren = navMyLeaguesInCurrentSession.map((league) =>
        internalLink(1_000_000 + league.id, league.name, `/leagues/${league.id}`),
      );
      return {
        ...item,
        children: [...item.children, ...leagueChildren],
      };
    }

    return item;
  });

  const hasAdminSection = gated.some((item) => isAdminSection(item));
  if (hasAdminLinks && !hasAdminSection) {
    gated.push(
      section(
        nextId(),
        'Admin',
        adminLinks.map((link) => internalLink(nextId(), link.label, link.to)),
      ),
    );
  }

  return gated.map(withEmergencyStyle);
}

/** Fallback when the members-area menu has not been seeded yet. */
export function buildMemberNavMenuItemsFallback({
  navMyLeaguesInCurrentSession,
  isSocialMember,
  isActiveMember,
  adminLinks,
  hasAdminLinks,
}: Omit<ResolveMemberNavMenuItemsInput, 'menuTree'>): NavMenuItemNode[] {
  const leagueChildren: NavMenuItemNode[] = [
    internalLink(21, 'View all', '/leagues'),
    internalLink(22, 'Waitlists', '/waitlists'),
    ...navMyLeaguesInCurrentSession.map((league) =>
      internalLink(1000 + league.id, league.name, `/leagues/${league.id}`),
    ),
  ];

  const sparesChildren: NavMenuItemNode[] = isSocialMember
    ? [infoRow(31, 'Social memberships do not include sparing or spare requests.')]
    : [
        internalLink(32, 'My availability', '/availability'),
        internalLink(33, 'My requests', '/my-requests'),
        internalLink(34, 'Request a spare', '/request-spare'),
      ];

  const items: NavMenuItemNode[] = [
    internalLink(1, 'Dashboard', '/dashboard'),
    section(2, 'Leagues', leagueChildren),
    section(3, 'Spares', sparesChildren),
    section(4, 'Club info', [
      internalLink(41, 'Club membership', '/members'),
      internalLink(42, 'Club governance', '/governance'),
      internalLink(46, 'Board meeting minutes', '/board-meeting-minutes'),
      ...(isActiveMember
        ? [
            internalLink(43, 'Building access', '/building-access'),
            internalLink(45, 'Member communications', '/member-communications'),
          ]
        : []),
      {
        ...internalLink(44, 'Emergency info', '/members-area/club-info/emergency-info'),
        labelClassName: EMERGENCY_INFO_LABEL_CLASS,
      },
    ]),
    section(5, 'Calendar', [
      internalLink(51, 'Full calendar', '/calendar'),
      ...(isSocialMember ? [] : [internalLink(52, 'Book ice time', '/book-ice')]),
    ]),
    section(7, 'Volunteering', [
      internalLink(71, 'Volunteering hub', '/volunteering'),
      internalLink(72, 'My volunteering', '/volunteering?tab=shifts'),
      internalLink(73, 'Expense reports', '/expenses'),
    ]),
  ];

  if (hasAdminLinks) {
    items.push(
      section(
        6,
        'Admin',
        adminLinks.map((link, index) => internalLink(60 + index, link.label, link.to)),
      ),
    );
  }

  return items;
}

/** Lowercase and strip non-letters — used to match `/members-area/:navLabel/...` to top-level nav. */
export function normalizeMemberNavLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z]/g, '');
}

export function parseMembersAreaArticlePath(
  pathname: string,
): { navLabel: string; articleSlug: string } | null {
  const match = pathname.match(/^\/members-area\/([^/]+)\/([^/]+)\/?$/);
  if (!match?.[1] || !match[2]) return null;
  return { navLabel: match[1], articleSlug: match[2] };
}

/** Readable URL segment for a top-level nav label (`Club info` → `club-info`). */
export function toMembersAreaNavLabelParam(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'nav';
}

export function buildMembersAreaArticlePath(navLabel: string, articleSlug: string): string {
  return `/members-area/${toMembersAreaNavLabelParam(navLabel)}/${articleSlug}`;
}

export function isMemberNavItemActive(item: NavMenuItemNode, pathname: string): boolean {
  const membersArea = parseMembersAreaArticlePath(pathname);
  if (membersArea) {
    return normalizeMemberNavLabel(item.label) === normalizeMemberNavLabel(membersArea.navLabel);
  }

  const path = pathOnly(item.url);
  if (path && item.linkType) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      return true;
    }
  }
  return item.children.some((child) => isMemberNavItemActive(child, pathname));
}
