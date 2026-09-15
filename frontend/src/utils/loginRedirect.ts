export type LoginRedirectLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

type LoginRedirectSearchParams = {
  get: (name: string) => string | null;
};

function isLoginPath(pathAndSearch: string): boolean {
  return pathAndSearch === '/login' || pathAndSearch.startsWith('/login?');
}

/** Relative in-app paths only. Reject protocol-relative and login-loop targets. */
export function isSafeInternalRedirect(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return false;
  if (trimmed.includes('\\')) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('/http:') || lower.startsWith('/https:')) return false;
  if (isLoginPath(trimmed)) return false;
  return true;
}

export function decodeRedirectParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith('%2F') || value.startsWith('%2f')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return isSafeInternalRedirect(value) ? value : null;
}

export function locationToRedirectPath(
  from: Partial<LoginRedirectLocation> | null | undefined
): string | null {
  if (!from?.pathname) return null;
  const path = `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  return isSafeInternalRedirect(path) ? path : null;
}

function appendSpareRequestIdIfMissing(redirect: string, requestId: string | null): string {
  if (!requestId || !/^\d+$/.test(requestId)) return redirect;
  const pathOnly = redirect.split(/[?#]/)[0];
  if (pathOnly !== '/spare-request/respond' && pathOnly !== '/spare-request/decline') {
    return redirect;
  }
  if (/(?:^|[?&])requestId=/.test(redirect)) return redirect;
  const separator = redirect.includes('?') ? '&' : '?';
  return `${redirect}${separator}requestId=${encodeURIComponent(requestId)}`;
}

export function resolvePostLoginRedirect(
  searchParams: LoginRedirectSearchParams,
  locationState: { from?: Partial<LoginRedirectLocation> } | null | undefined
): string | null {
  const fromQuery = decodeRedirectParam(searchParams.get('redirect'));
  if (fromQuery) {
    return appendSpareRequestIdIfMissing(fromQuery, searchParams.get('requestId'));
  }
  return locationToRedirectPath(locationState?.from);
}

export function buildLoginPath(fromPathAndSearch: string): string {
  return `/login?redirect=${encodeURIComponent(fromPathAndSearch)}`;
}

export function buildUnauthenticatedRedirect(
  unauthenticatedRedirectTo: string,
  from: LoginRedirectLocation
): string {
  if (unauthenticatedRedirectTo !== '/login' && !unauthenticatedRedirectTo.startsWith('/login?')) {
    return unauthenticatedRedirectTo;
  }
  const target = locationToRedirectPath(from);
  if (!target) return '/login';
  return buildLoginPath(target);
}
