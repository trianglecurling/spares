export interface NavMenuItemNode {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: NavMenuItemNode[];
}

export const MEMBER_NAV_IDS = {
  dashboard: 1,
  leagues: 2,
  spares: 3,
  directory: 4,
  calendar: 5,
  admin: 6,
} as const;

function internalLink(
  id: number,
  label: string,
  url: string,
  children: NavMenuItemNode[] = [],
): NavMenuItemNode {
  return { id, label, linkType: 'internal', url, openInNewTab: false, children };
}

function section(id: number, label: string, children: NavMenuItemNode[]): NavMenuItemNode {
  return { id, label, linkType: null, url: null, openInNewTab: false, children };
}

function infoRow(id: number, label: string): NavMenuItemNode {
  return { id, label, linkType: null, url: null, openInNewTab: false, children: [] };
}

interface BuildMemberNavMenuItemsInput {
  navMyLeaguesInCurrentSession: Array<{ id: number; name: string }>;
  isSocialMember: boolean;
  adminLinks: Array<{ to: string; label: string }>;
  hasAdminLinks: boolean;
}

export function buildMemberNavMenuItems({
  navMyLeaguesInCurrentSession,
  isSocialMember,
  adminLinks,
  hasAdminLinks,
}: BuildMemberNavMenuItemsInput): NavMenuItemNode[] {
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
    internalLink(MEMBER_NAV_IDS.dashboard, 'Dashboard', '/dashboard'),
    section(MEMBER_NAV_IDS.leagues, 'Leagues', leagueChildren),
    section(MEMBER_NAV_IDS.spares, 'Spares', sparesChildren),
    section(MEMBER_NAV_IDS.directory, 'Directory', [
      internalLink(41, 'Club membership', '/members'),
      internalLink(42, 'Club governance', '/governance'),
    ]),
    section(MEMBER_NAV_IDS.calendar, 'Calendar', [
      internalLink(51, 'Full calendar', '/calendar'),
      ...(isSocialMember ? [] : [internalLink(52, 'Book ice time', '/book-ice')]),
    ]),
  ];

  if (hasAdminLinks) {
    items.push(
      section(
        MEMBER_NAV_IDS.admin,
        'Admin',
        adminLinks.map((link, index) => internalLink(60 + index, link.label, link.to)),
      ),
    );
  }

  return items;
}

export function isMemberNavItemActive(item: NavMenuItemNode, pathname: string): boolean {
  switch (item.id) {
    case MEMBER_NAV_IDS.dashboard:
      return pathname === '/dashboard';
    case MEMBER_NAV_IDS.leagues:
      return pathname === '/leagues' || pathname.startsWith('/leagues/') || pathname.startsWith('/waitlists');
    case MEMBER_NAV_IDS.spares:
      return (
        pathname === '/availability' ||
        pathname === '/my-requests' ||
        pathname.startsWith('/request-spare')
      );
    case MEMBER_NAV_IDS.directory:
      return pathname === '/members' || pathname === '/governance';
    case MEMBER_NAV_IDS.calendar:
      return pathname === '/calendar' || pathname === '/book-ice';
    case MEMBER_NAV_IDS.admin:
      return pathname.startsWith('/admin');
    default:
      if (item.linkType === 'internal' && item.url) {
        return pathname === item.url || pathname.startsWith(`${item.url}/`);
      }
      return false;
  }
}
