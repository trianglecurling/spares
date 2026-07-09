import { Suspense } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import Layout from './Layout';
import AppStateCard from './AppStateCard';

/** Paths that render without the shared nav shell (legacy full-page flows). */
const BARE_ROUTE_PATTERNS = [
  '/spare-request/respond',
  '/spare-request/decline',
] as const;

/** Paths that need full-width main content below the nav. */
const FULL_WIDTH_ROUTE_PATTERNS = [
  '/calendar',
  '/calendar/*',
  '/admin/content/articles/:id',
  '/admin/events/:id/details',
] as const;

/** Paths that lock the shell to the viewport (internal scroll only). */
const FILL_VIEWPORT_ROUTE_PATTERNS = ['/calendar'] as const;

function useAppShellLayoutOptions() {
  const { pathname } = useLocation();

  const bare = BARE_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: true }, pathname),
  );

  const fullWidth = FULL_WIDTH_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: pattern !== '/calendar/*' }, pathname),
  );

  const fillViewport = FILL_VIEWPORT_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: true }, pathname),
  );

  return { bare, fullWidth, fillViewport };
}

export default function AuthenticatedAppShell() {
  const { bare, fullWidth, fillViewport } = useAppShellLayoutOptions();

  const outlet = (
    <Suspense fallback={<AppStateCard title="Loading..." />}>
      <Outlet />
    </Suspense>
  );

  return bare ? outlet : (
    <Layout fullWidth={fullWidth} fillViewport={fillViewport}>
      {outlet}
    </Layout>
  );
}
