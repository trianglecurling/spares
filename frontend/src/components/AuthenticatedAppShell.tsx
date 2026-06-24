import { Suspense } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import Layout from './Layout';
import AppStateCard from './AppStateCard';

/** Paths that render without the shared nav shell (legacy full-page flows). */
const BARE_ROUTE_PATTERNS = [
  '/unsubscribe',
  '/spare-request/respond',
  '/spare-request/decline',
] as const;

/** Paths that need full-width main content below the nav. */
const FULL_WIDTH_ROUTE_PATTERNS = ['/calendar', '/calendar/*'] as const;

function useAppShellLayoutOptions() {
  const { pathname } = useLocation();

  const bare = BARE_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: true }, pathname),
  );

  const fullWidth =
    FULL_WIDTH_ROUTE_PATTERNS.some((pattern) =>
      matchPath({ path: pattern, end: pattern !== '/calendar/*' }, pathname),
    ) || /^\/admin\/content\/articles\/\d+$/.test(pathname);

  return { bare, fullWidth };
}

export default function AuthenticatedAppShell() {
  const { bare, fullWidth } = useAppShellLayoutOptions();

  const outlet = (
    <Suspense fallback={<AppStateCard title="Loading..." />}>
      <Outlet />
    </Suspense>
  );

  return bare ? outlet : <Layout fullWidth={fullWidth}>{outlet}</Layout>;
}
