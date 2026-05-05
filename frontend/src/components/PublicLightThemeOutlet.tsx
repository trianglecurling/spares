import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Public marketing pages are always light-styled. This keeps native UI (scrollbars, form
 * controls) aligned by setting `color-scheme` / `.dark` on the document root.
 *
 * Initial HTML load: the same path rules are applied in /index.html (inline script) so the
 * first paint does not use OS-dark before this effect runs.
 */
export default function PublicLightThemeOutlet() {
  const { setForcedResolvedTheme } = useTheme();
  useEffect(() => {
    setForcedResolvedTheme('light');
    return () => setForcedResolvedTheme(null);
  }, [setForcedResolvedTheme]);
  return <Outlet />;
}
