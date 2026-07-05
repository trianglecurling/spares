import type { RefObject, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HiHome } from 'react-icons/hi2';

export interface SiteNavBarProps {
  clubName: string;
  logoUrl: string | null;
  brandingLoading?: boolean;
  /** Shown below the club name in the brand link. */
  subtitle?: 'members-area';
  /** Destination for the logo + club name block. Defaults to `/`. */
  brandTo?: string;
  /** Circular home icon before desktop nav items (logged-in layout; links to `/`). */
  showPublicHomeLink?: boolean;
  /** Replace logo + club name with a back link. */
  backToHome?: boolean;
  /** When true, club name is shown in red to indicate a preview database connection. */
  isPreviewDatabase?: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  mobileMenuId: string;
  desktopNav: ReactNode;
  mobileNav: ReactNode;
  /** Avatar, login link, or other account control shown after desktop nav items. */
  trailingAuth?: ReactNode;
  headerRef?: RefObject<HTMLElement | null>;
}

export default function SiteNavBar({
  clubName,
  logoUrl,
  brandingLoading = false,
  subtitle,
  brandTo = '/',
  showPublicHomeLink = false,
  backToHome = false,
  isPreviewDatabase = false,
  mobileOpen,
  onMobileOpenChange,
  mobileMenuId,
  desktopNav,
  mobileNav,
  trailingAuth,
  headerRef,
}: SiteNavBarProps) {
  const brandText = (
    <span className="flex min-w-0 flex-col">
      {brandingLoading && !clubName ? (
        <span className="h-5 w-40 rounded bg-gray-100 dark:bg-gray-700" aria-hidden />
      ) : (
        <span
          className={`truncate text-lg font-semibold tracking-tight sm:text-xl ${
            isPreviewDatabase
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-900 dark:text-gray-100'
          }`}
          title={isPreviewDatabase ? 'Preview database' : undefined}
        >
          {clubName}
        </span>
      )}
      {subtitle === 'members-area' ? (
        <span className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-400">
          Members area
        </span>
      ) : null}
    </span>
  );

  const publicHomeIconClass =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-100 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40';

  const publicHomeLink = showPublicHomeLink ? (
    <Link to="/" aria-label="Triangle Curling home" className={publicHomeIconClass} title="Public homepage">
      <HiHome className="h-3.5 w-3.5" aria-hidden />
    </Link>
  ) : null;

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/90 backdrop-blur dark:border-gray-700/80 dark:bg-gray-800/90"
    >
      <div className="public-container py-4 flex items-center justify-between gap-4">
        {backToHome ? (
          <Link to="/" className="text-sm font-medium text-primary-teal-link hover:underline">
            ← Back to home
          </Link>
        ) : (
          <Link
            to={brandTo}
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-contain" />
            ) : null}
            {brandText}
          </Link>
        )}

        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 md:hidden"
          onClick={() => onMobileOpenChange(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls={mobileMenuId}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>

        <nav className="hidden items-center gap-2 md:flex lg:gap-3">
          {publicHomeLink}
          {desktopNav}
          {trailingAuth}
        </nav>
      </div>

      {mobileOpen ? (
        <div
          id={mobileMenuId}
          className="max-h-[calc(100dvh-5.75rem)] overflow-y-auto overscroll-y-contain border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 md:hidden"
        >
          <div className="public-container py-3">
            {mobileNav}
          </div>
        </div>
      ) : null}
    </header>
  );
}
