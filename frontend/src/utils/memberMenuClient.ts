import type { NavMenuItemNode } from '../components/DesktopFlyoutNav';
import api from './api';

/** Dispatched when admin updates the members-area navigation menu. */
export const MEMBER_MENU_INVALIDATED_EVENT = 'member-menu-invalidated';

let cachedMemberMenuTree: NavMenuItemNode[] | null = null;
let memberMenuInflight: Promise<NavMenuItemNode[]> | null = null;

export function getCachedMemberMenuTree(): NavMenuItemNode[] | null {
  return cachedMemberMenuTree;
}

export function clearMemberMenuCache(): void {
  cachedMemberMenuTree = null;
  memberMenuInflight = null;
}

export function notifyMemberMenuChanged(): void {
  clearMemberMenuCache();
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MEMBER_MENU_INVALIDATED_EVENT));
}

function asMenuTree(data: unknown): NavMenuItemNode[] {
  if (!Array.isArray(data)) return [];
  return data as NavMenuItemNode[];
}

/** Shared fetch with module cache + in-flight dedupe across Layout / profile / mobile nav. */
export async function fetchMemberMenuTree(options?: {
  force?: boolean;
}): Promise<NavMenuItemNode[]> {
  if (!options?.force && cachedMemberMenuTree) {
    return cachedMemberMenuTree;
  }
  if (memberMenuInflight) {
    return memberMenuInflight;
  }

  const previous = cachedMemberMenuTree;
  memberMenuInflight = api
    .get<NavMenuItemNode[]>('/public/menus/member')
    .then((res) => {
      const tree = asMenuTree(res.data);
      cachedMemberMenuTree = tree;
      return tree;
    })
    .catch((error) => {
      if (previous) {
        cachedMemberMenuTree = previous;
        return previous;
      }
      throw error;
    })
    .finally(() => {
      memberMenuInflight = null;
    });

  return memberMenuInflight;
}
