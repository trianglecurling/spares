import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineMapPin } from 'react-icons/hi2';
import { PiMailbox } from 'react-icons/pi';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { setCachedDefaultPaymentProvider, type PaymentProvider } from '../utils/paymentProcessorCopy';
import {
  PUBLIC_BOOTSTRAP_INVALIDATED_EVENT,
  publicBootstrapFetchConfig,
} from '../utils/publicBootstrapClient';
import { syncSiteBrandingFromBootstrap, syncSiteBrandingFromConfig, useSiteBranding } from '../hooks/useSiteBranding';
import ObfuscatedEmailLink, { splitEmailAddress } from './ObfuscatedEmailLink';
import MemberNavigationPanel, { MemberMobileNavLabel } from './MemberNavigationPanel';
import SiteNavAccountControl, { SiteNavLoginLink } from './SiteNavAccountControl';
import SiteNavBar from './SiteNavBar';
import {
  DesktopMenuBar,
  MobileMenuItem,
  publicFlyoutNavClasses,
  type NavMenuItemNode,
} from './DesktopFlyoutNav';
import { MobileNavAccordionGroup, MobileNavAccordionItem } from './MobileNavAccordion';

const DEFAULT_CONTACT_EMAIL_LOCAL = 'info';
const DEFAULT_CONTACT_EMAIL_DOMAIN = 'trianglecurling.com';

interface SiteConfig {
  clubName: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  physicalAddressLine1: string | null;
  physicalAddressLine2: string | null;
  mailingAddressLine1: string | null;
  mailingAddressLine2: string | null;
  footerMarkdown: string | null;
  disableSms?: boolean;
  /** `MM-DD`; from governance fiscal year start (public site config). */
  fiscalYearStartMmdd?: string;
}

function mapsSearchUrl(...parts: Array<string | null | undefined>): string | null {
  const query = parts.map((part) => part?.trim()).filter(Boolean).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

interface PublicBootstrapResponse {
  siteConfig: SiteConfig | null;
  navbarMenu: NavMenuItemNode[];
  defaultPaymentProvider?: PaymentProvider;
  isPreviewDatabase?: boolean;
}

interface PublicLayoutProps {
  children: React.ReactNode;
  /** Optional: show "Back to home" instead of logo+club name in header */
  backToHome?: boolean;
  initialSiteConfig?: SiteConfig | null;
  initialMenuItems?: NavMenuItemNode[];
  deferPublicBootstrapLoad?: boolean;
}

let cachedMenuItems: NavMenuItemNode[] = [];

let cachedSiteConfig: SiteConfig | null = null;

function clearPublicLayoutModuleCache(): void {
  cachedSiteConfig = null;
  cachedMenuItems = [];
}


const MOBILE_MENU_ID = 'public-mobile-menu';

export default function PublicLayout({
  children,
  backToHome = false,
  initialSiteConfig,
  initialMenuItems,
  deferPublicBootstrapLoad = false,
}: PublicLayoutProps) {
  const { isLoading, isLikelyAuthenticated } = useAuth();
  const { branding } = useSiteBranding();
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(initialSiteConfig ?? cachedSiteConfig);
  const [menuItems, setMenuItems] = useState<NavMenuItemNode[]>(initialMenuItems ?? cachedMenuItems);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [publicDataReady, setPublicDataReady] = useState<boolean>(
    deferPublicBootstrapLoad
      || Boolean(initialSiteConfig || (initialMenuItems?.length ?? 0) > 0 || cachedSiteConfig || cachedMenuItems.length > 0)
  );

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (initialSiteConfig !== undefined) {
      cachedSiteConfig = initialSiteConfig;
      syncSiteBrandingFromConfig(initialSiteConfig);
      setSiteConfig(initialSiteConfig);
    }
    if (initialMenuItems !== undefined) {
      cachedMenuItems = Array.isArray(initialMenuItems) ? initialMenuItems : [];
      setMenuItems(cachedMenuItems);
    }
    if (initialSiteConfig !== undefined || initialMenuItems !== undefined || deferPublicBootstrapLoad) {
      setPublicDataReady(true);
    }
  }, [initialSiteConfig, initialMenuItems, deferPublicBootstrapLoad]);

  const loadPublicBootstrap = useCallback(() => {
    return api
      .get<PublicBootstrapResponse>('/public/bootstrap', publicBootstrapFetchConfig)
      .then((r) => {
        const config = r.data?.siteConfig ?? null;
        const menu = Array.isArray(r.data?.navbarMenu) ? r.data.navbarMenu : [];
        cachedSiteConfig = config;
        cachedMenuItems = menu;
        syncSiteBrandingFromBootstrap(r.data);
        setCachedDefaultPaymentProvider(r.data?.defaultPaymentProvider);
        setSiteConfig(config);
        setMenuItems(menu);
        setPublicDataReady(true);
      })
      .catch(() => {
        if (!cachedSiteConfig) {
          cachedSiteConfig = {
            clubName: null,
            logoUrl: null,
            contactEmail: null,
            contactPhone: null,
            physicalAddressLine1: null,
            physicalAddressLine2: null,
            mailingAddressLine1: null,
            mailingAddressLine2: null,
            footerMarkdown: null,
            disableSms: false,
          };
        }
        setSiteConfig(cachedSiteConfig);
        setMenuItems(cachedMenuItems);
        setPublicDataReady(true);
      });
  }, []);

  useEffect(() => {
    if (deferPublicBootstrapLoad) return;
    void loadPublicBootstrap();
  }, [deferPublicBootstrapLoad, loadPublicBootstrap]);

  useEffect(() => {
    const onInvalidated = () => {
      clearPublicLayoutModuleCache();
      void loadPublicBootstrap();
    };
    window.addEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
  }, [loadPublicBootstrap]);

  const clubName = siteConfig?.clubName ?? '';
  const physicalAddressLine1 = siteConfig?.physicalAddressLine1?.trim() || null;
  const physicalAddressLine2 = siteConfig?.physicalAddressLine2?.trim() || null;
  const mailingAddressLine1 = siteConfig?.mailingAddressLine1?.trim() || null;
  const mailingAddressLine2 = siteConfig?.mailingAddressLine2?.trim() || null;
  const facilityDirectionsUrl = mapsSearchUrl(physicalAddressLine1, physicalAddressLine2);
  const contactEmailParts =
    splitEmailAddress(siteConfig?.contactEmail ?? '') ?? {
      local: DEFAULT_CONTACT_EMAIL_LOCAL,
      domain: DEFAULT_CONTACT_EMAIL_DOMAIN,
    };

  return (
    <div className="public-shell min-h-screen flex flex-col">
      <SiteNavBar
        clubName={clubName}
        logoUrl={siteConfig?.logoUrl ?? null}
        brandingLoading={!publicDataReady}
        isPreviewDatabase={branding?.isPreviewDatabase}
        backToHome={backToHome}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        mobileMenuId={MOBILE_MENU_ID}
        desktopNav={
          !backToHome && publicDataReady ? (
            menuItems.length > 0 ? (
              <DesktopMenuBar
                items={menuItems}
                onHoverMenuDisplayed={() => setProfileMenuOpen(false)}
              />
            ) : (
              <Link to="/" className={publicFlyoutNavClasses.navLink}>
                Home
              </Link>
            )
          ) : null
        }
        trailingAuth={
          <SiteNavAccountControl
            profileMenuOpen={profileMenuOpen}
            onProfileMenuOpenChange={setProfileMenuOpen}
            profileMenuRef={profileMenuRef}
          />
        }
        mobileNav={
          <>
            {!backToHome && publicDataReady ? (
              <MobileNavAccordionGroup>
                {menuItems.length > 0 ? (
                  menuItems.map((item) => (
                    <MobileMenuItem key={item.id} item={item} onNavigate={() => setMobileOpen(false)} />
                  ))
                ) : (
                  <Link
                    to="/"
                    className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    onClick={() => setMobileOpen(false)}
                  >
                    Home
                  </Link>
                )}
                {!isLoading && isLikelyAuthenticated ? (
                  <MobileNavAccordionItem id="member-nav" label={<MemberMobileNavLabel />}>
                    <MemberNavigationPanel
                      variant="accordion"
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </MobileNavAccordionItem>
                ) : null}
              </MobileNavAccordionGroup>
            ) : !isLoading && isLikelyAuthenticated ? (
              <MobileNavAccordionGroup>
                <MobileNavAccordionItem id="member-nav" label={<MemberMobileNavLabel />}>
                  <MemberNavigationPanel
                    variant="accordion"
                    onNavigate={() => setMobileOpen(false)}
                  />
                </MobileNavAccordionItem>
              </MobileNavAccordionGroup>
            ) : null}
            {!isLoading && !isLikelyAuthenticated ? (
              <SiteNavLoginLink
                className="mt-3 block text-center"
                onClick={() => setMobileOpen(false)}
              />
            ) : null}
          </>
        }
      />

      <main className="flex-1 min-h-0 flex flex-col">{children}</main>

      <footer className="border-t border-gray-200 bg-gradient-to-b from-gray-50 to-white py-10">
        <div className="public-container grid gap-8 md:grid-cols-3">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-gray-900">{clubName}</h2>
            <p className="text-sm text-gray-600">
              Bringing curling to the Triangle with welcoming learn-to-curl programs, league play, bonspiels, and community events.
            </p>
            <p className="text-sm text-gray-600">
              Triangle Curling Club is a 501(c)(3) nonprofit organization and is 100% volunteer-run.
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Quick links</h2>
            <div className="flex flex-col gap-1 text-sm">
              <Link to="/" className="text-gray-600 hover:text-gray-900 hover:underline">Home</Link>
              <Link to="/contact" className="text-gray-600 hover:text-gray-900 hover:underline">Contact</Link>
              <Link to="/donate" className="text-gray-600 hover:text-gray-900 hover:underline">Donate</Link>
              <Link to="/articles/try-curling" className="text-gray-600 hover:text-gray-900 hover:underline">Learn</Link>
              {isLikelyAuthenticated ? (
                <Link to="/leagues" className="text-gray-600 hover:text-gray-900 hover:underline">Leagues</Link>
              ) : (
                <Link to="/login" className="text-gray-600 hover:text-gray-900 hover:underline">Member login</Link>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Contact and address</h2>
            <div className="text-sm text-gray-600">
              <p>
                Email:{' '}
                <ObfuscatedEmailLink
                  localPart={contactEmailParts.local}
                  domain={contactEmailParts.domain}
                  className="hover:text-gray-900 hover:underline"
                />
              </p>
              {siteConfig?.contactPhone ? (
                <p>
                  Phone:{' '}
                  <a href={`tel:${siteConfig.contactPhone}`} className="hover:text-gray-900 hover:underline">
                    {siteConfig.contactPhone}
                  </a>
                </p>
              ) : null}
              {(physicalAddressLine1 || physicalAddressLine2 || mailingAddressLine1 || mailingAddressLine2) ? (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {(physicalAddressLine1 || physicalAddressLine2) ? (
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <HiOutlineMapPin className="h-4 w-4 shrink-0" aria-hidden />
                        Facility address
                      </h3>
                      {physicalAddressLine1 ? <p className="mt-2">{physicalAddressLine1}</p> : null}
                      {physicalAddressLine2 ? <p>{physicalAddressLine2}</p> : null}
                      {facilityDirectionsUrl ? (
                        <p className="mt-2">
                          <a
                            href={facilityDirectionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary-teal-link hover:underline"
                          >
                            Get directions
                          </a>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {(mailingAddressLine1 || mailingAddressLine2) ? (
                    <div>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <PiMailbox className="h-4 w-4 shrink-0" aria-hidden />
                        Mailing address
                      </h3>
                      {mailingAddressLine1 ? <p className="mt-2">{mailingAddressLine1}</p> : null}
                      {mailingAddressLine2 ? <p>{mailingAddressLine2}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <p className="public-container mt-8 border-t border-gray-200 pt-6 text-center text-xs text-gray-500">
          Website powered by The Broom Stack
        </p>
      </footer>
    </div>
  );
}
