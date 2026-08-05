import { getMenuTree, type MenuItemNode } from '../domains/public/queries/publicReadFacade.js';

const cache = new Map<string, MenuItemNode[]>();

/** In-memory menu trees for `/public/menus/:type` (navbar, member, …). */
export async function getCachedMenuTree(menuType: string): Promise<MenuItemNode[]> {
  const key = menuType.trim() || 'navbar';
  const hit = cache.get(key);
  if (hit) return hit;

  const tree = await getMenuTree(key);
  cache.set(key, tree);
  return tree;
}

export function invalidateMenuTreeCache(_reason?: string): void {
  cache.clear();
}
