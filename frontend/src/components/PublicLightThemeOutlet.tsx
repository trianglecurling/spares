import { useEffect, Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Public marketing pages are always light-styled. This keeps native UI (scrollbars, form
 * controls) aligned by setting `color-scheme` / `.dark` on the document root.
 *
 * Initial HTML load: the same path rules are applied in /index.html (inline script) so the
 * first paint does not use OS-dark before this effect runs.
 */
function useForcePublicLightTheme() {
  const { setForcedResolvedTheme } = useTheme();
  useEffect(() => {
    setForcedResolvedTheme('light');
    return () => setForcedResolvedTheme(null);
  }, [setForcedResolvedTheme]);
}

/** Use when a public-light page is rendered outside {@link PublicLightThemeOutlet}. */
export function ForcePublicLightTheme({ children }: { children: ReactNode }) {
  useForcePublicLightTheme();
  return <>{children}</>;
}

export default function PublicLightThemeOutlet() {
  useForcePublicLightTheme();
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
}
