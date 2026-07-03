/** API paths that are intentionally public and must not trigger session refresh or login redirects. */
export function isPublicApiRequestUrl(url: string): boolean {
  const path = (url.split('?')[0]?.split('#')[0] ?? '').trim();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  return (
    normalized.startsWith('/public/') ||
    normalized.startsWith('/registration/guest/') ||
    normalized.startsWith('/registration/window') ||
    normalized.startsWith('/registration/payment-status/') ||
    normalized.startsWith('/contact') ||
    normalized.startsWith('/install') ||
    normalized.startsWith('/mailing-list/') ||
    normalized === '/auth/request-code' ||
    normalized === '/auth/verify-code' ||
    normalized === '/auth/select-member' ||
    normalized === '/auth/refresh' ||
    normalized === '/auth/logout'
  );
}
