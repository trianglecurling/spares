import { Suspense } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import Layout from './Layout';
import AppStateCard from './AppStateCard';
import { useMediaQuery } from '../hooks/useMediaQuery';

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

/** Paths that can lock the shell to the viewport (desktop day/week calendar only; month + mobile scroll the page). */
const FILL_VIEWPORT_ROUTE_PATTERNS = ['/calendar'] as const;

function useAppShellLayoutOptions() {
  const { pathname, search } = useLocation();
  const isCompactLayout = useMediaQuery('(max-width: 767px)');

  const bare = BARE_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: true }, pathname),
  );

  const fullWidth = FULL_WIDTH_ROUTE_PATTERNS.some((pattern) =>
    matchPath({ path: pattern, end: pattern !== '/calendar/*' }, pathname),
  );

  const calendarView = new URLSearchParams(search).get('view');
  const calendarLocksViewport =
    !isCompactLayout && (calendarView === 'day' || calendarView === 'week');
  const fillViewport =
    FILL_VIEWPORT_ROUTE_PATTERNS.some((pattern) =>
      matchPath({ path: pattern, end: true }, pathname),
    ) && calendarLocksViewport;

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
