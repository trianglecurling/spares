import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMemberNavigation } from '../hooks/useMemberNavigation';
import { useSiteBranding } from '../hooks/useSiteBranding';
import { buildMemberNavMenuItems, isMemberNavItemActive } from '../utils/memberNavMenuItems';
import Footer from './Footer';
import { DesktopMenuBar, publicFlyoutNavClasses } from './DesktopFlyoutNav';
import MemberNavigationPanel from './MemberNavigationPanel';
import SiteNavAccountControl from './SiteNavAccountControl';
import SiteNavBar from './SiteNavBar';

interface LayoutProps {
  children: React.ReactNode;
  /** When true, main content uses full width (no max-w constraint) - for Calendar etc. */
  fullWidth?: boolean;
}

const MOBILE_MENU_ID = 'member-mobile-menu';

const memberActiveNavLinkClass =
  'inline-flex items-center rounded-md px-2 py-1 text-sm font-medium bg-primary-teal text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40';

export default function Layout({ children, fullWidth }: LayoutProps) {
  const location = useLocation();
  const { branding, loading: brandingLoading } = useSiteBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const {
    isSocialMember,
    adminLinks,
    hasAdminLinks,
    navMyLeaguesInCurrentSession,
    isNavigationReady,
  } = useMemberNavigation();
  const headerRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const memberNavItems = useMemo(
    () =>
      buildMemberNavMenuItems({
        navMyLeaguesInCurrentSession,
        isSocialMember,
        adminLinks,
        hasAdminLinks,
      }),
    [navMyLeaguesInCurrentSession, isSocialMember, adminLinks, hasAdminLinks],
  );

  const clubName = branding?.clubName ?? '';

  const getMemberNavLinkClass = useCallback(
    (item: (typeof memberNavItems)[number]) =>
      isMemberNavItemActive(item, location.pathname)
        ? memberActiveNavLinkClass
        : publicFlyoutNavClasses.navLink,
    [location.pathname, memberNavItems],
  );

  useEffect(() => {
    setMobileOpen(false);
    setProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileMenuOpen]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SiteNavBar
        headerRef={headerRef}
        clubName={clubName}
        logoUrl={branding?.logoUrl ?? null}
        brandingLoading={brandingLoading}
        subtitle="members-area"
        brandTo="/dashboard"
        showPublicHomeLink
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        mobileMenuId={MOBILE_MENU_ID}
        desktopNav={
          isNavigationReady ? (
            <DesktopMenuBar
              items={memberNavItems}
              getNavLinkClass={getMemberNavLinkClass}
              onHoverMenuDisplayed={() => setProfileMenuOpen(false)}
            />
          ) : null
        }
        trailingAuth={
          <SiteNavAccountControl
            variant="member"
            profileMenuOpen={profileMenuOpen}
            onProfileMenuOpenChange={setProfileMenuOpen}
            profileMenuRef={profileMenuRef}
          />
        }
        mobileNav={
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <MemberNavigationPanel variant="accordion" onNavigate={() => setMobileOpen(false)} />
          </div>
        }
      />

      <main
        className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full min-h-0 ${
          fullWidth ? 'max-w-full flex flex-col overflow-hidden' : 'max-w-6xl'
        }`}
      >
        {children}
      </main>

      <Footer />
    </div>
  );
}
