/** Dispatched when admin updates public shell content (nav, site config, etc.). */
export const PUBLIC_BOOTSTRAP_INVALIDATED_EVENT = 'public-bootstrap-invalidated';

export const publicBootstrapFetchConfig = {
  headers: {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  },
} as const;

export function notifyPublicBootstrapChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT));
}
