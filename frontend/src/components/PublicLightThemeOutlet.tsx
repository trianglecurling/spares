import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Public marketing pages are always light-styled. This keeps native UI (scrollbars, form
 * controls) aligned by setting `color-scheme` / `.dark` on the document root.
 */
export default function PublicLightThemeOutlet() {
  const { setForcedResolvedTheme } = useTheme();
  useEffect(() => {
    setForcedResolvedTheme('light');
    return () => setForcedResolvedTheme(null);
  }, [setForcedResolvedTheme]);
  return <Outlet />;
}
