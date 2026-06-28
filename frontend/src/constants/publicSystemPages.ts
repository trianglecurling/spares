import type { ChoiceRenderableOption } from '../components/ChoiceInput';

export type PublicSystemPagePath =
  | '/'
  | '/calendar/public'
  | '/leagues/public'
  | '/events'
  | '/donate'
  | '/contact'
  | '/feedback';

export const PUBLIC_SYSTEM_PAGES: Array<{ path: PublicSystemPagePath; label: string }> = [
  { path: '/', label: 'Home' },
  { path: '/calendar/public', label: 'Public calendar' },
  { path: '/leagues/public', label: 'Public leagues' },
  { path: '/events', label: 'Events' },
  { path: '/donate', label: 'Donate' },
  { path: '/contact', label: 'Contact' },
  { path: '/feedback', label: 'Feedback' },
];

export const PUBLIC_SYSTEM_PAGE_OPTIONS: ChoiceRenderableOption<PublicSystemPagePath>[] =
  PUBLIC_SYSTEM_PAGES.map((page) => ({
    value: page.path,
    label: page.label,
    textValue: `${page.label} ${page.path}`,
  }));

const publicSystemPagePaths = new Set(PUBLIC_SYSTEM_PAGES.map((page) => page.path));

/** Legacy frontend route kept for links saved before the /leagues/public rename. */
const LEGACY_PUBLIC_LEAGUES_PATH = '/public/leagues';

export function isPublicSystemPagePath(value: string | null | undefined): value is PublicSystemPagePath {
  return value != null && publicSystemPagePaths.has(value as PublicSystemPagePath);
}

export function normalizePublicSystemPagePath(pathname: string): PublicSystemPagePath | null {
  if (pathname === LEGACY_PUBLIC_LEAGUES_PATH || pathname.startsWith(`${LEGACY_PUBLIC_LEAGUES_PATH}/`)) {
    return '/leagues/public';
  }
  if (isPublicSystemPagePath(pathname)) {
    return pathname;
  }
  return null;
}
