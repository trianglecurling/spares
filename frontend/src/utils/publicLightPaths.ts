/** Paths that always use the public light marketing shell (see index.html + PublicLightThemeOutlet). */
export function isPublicLightPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/feedback' || pathname === '/calendar/public') {
    return true;
  }
  if (pathname === '/help' || pathname.startsWith('/help/')) {
    return true;
  }
  if (pathname === '/contact' || pathname.startsWith('/contact/')) {
    return true;
  }
  if (pathname === '/donate' || pathname.startsWith('/donate/')) {
    return true;
  }
  if (pathname.startsWith('/mailing-list/')) {
    return true;
  }
  if (pathname === '/articles' || pathname.startsWith('/articles/')) {
    return true;
  }
  if (pathname.startsWith('/article/')) {
    return true;
  }
  if (pathname === '/events' || pathname.startsWith('/events/')) {
    return true;
  }
  if (pathname.startsWith('/go/')) {
    return true;
  }
  if (pathname.startsWith('/registration/')) {
    return true;
  }
  if (pathname.startsWith('/payments/')) {
    return true;
  }
  return false;
}
