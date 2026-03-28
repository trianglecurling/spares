import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface SiteConfig {
  clubName: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  footerMarkdown: string | null;
  disableSms?: boolean;
}

interface MenuItemNode {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: MenuItemNode[];
}

interface PublicBootstrapResponse {
  siteConfig: SiteConfig | null;
  navbarMenu: MenuItemNode[];
}

interface PublicLayoutProps {
  children: React.ReactNode;
  /** Optional: show "Back to home" instead of logo+club name in header */
  backToHome?: boolean;
  initialSiteConfig?: SiteConfig | null;
  initialMenuItems?: MenuItemNode[];
  deferPublicBootstrapLoad?: boolean;
}

const navLinkClass =
  'inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40';
const dropdownItemClass =
  'block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40';
const memberMenuItemClass =
  'block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100';

let cachedSiteConfig: SiteConfig | null = null;
let cachedMenuItems: MenuItemNode[] = [];

function linkForItem(item: MenuItemNode): { kind: 'internal' | 'external' | 'none'; href: string | null } {
  if (item.linkType === 'internal' && item.url) return { kind: 'internal', href: item.url };
  if (item.linkType === 'external' && item.url) return { kind: 'external', href: item.url };
  return { kind: 'none', href: null };
}

function externalTargetProps(item: MenuItemNode): { target?: '_blank'; rel?: 'noopener noreferrer' } {
  return item.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

function DesktopDropdownItem({ item }: { item: MenuItemNode }) {
  const hasChildren = item.children.length > 0;
  const link = linkForItem(item);

  if (!hasChildren) {
    if (link.kind === 'external' && link.href) {
      return (
        <li className="list-none">
          <a href={link.href} className={dropdownItemClass} {...externalTargetProps(item)}>
            {item.label}
          </a>
        </li>
      );
    }
    if (link.kind === 'internal' && link.href) {
      return (
        <li className="list-none">
          <Link to={link.href} className={dropdownItemClass}>
            {item.label}
          </Link>
        </li>
      );
    }
    return (
      <li className="list-none">
        <span className="block rounded-md px-3 py-2 text-sm text-gray-500">{item.label}</span>
      </li>
    );
  }

  return (
    <li className="group/child relative">
      {link.kind === 'external' && link.href ? (
        <a
          href={link.href}
          className={`${dropdownItemClass} flex items-center justify-between gap-2`}
          {...externalTargetProps(item)}
        >
          {item.label}
          <span aria-hidden>›</span>
        </a>
      ) : link.kind === 'internal' && link.href ? (
        <Link to={link.href} className={`${dropdownItemClass} flex items-center justify-between gap-2`}>
          {item.label}
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <span className="block rounded-md px-3 py-2 text-sm text-gray-700">{item.label}</span>
      )}
      <ul className="invisible absolute left-full top-0 z-50 min-w-[12rem] rounded-xl border border-gray-200 bg-white p-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover/child:visible group-hover/child:opacity-100 group-focus-within/child:visible group-focus-within/child:opacity-100 motion-reduce:transition-none">
        {item.children.map((child) => (
          <DesktopDropdownItem key={child.id} item={child} />
        ))}
      </ul>
    </li>
  );
}

function DesktopNavItem({ item }: { item: MenuItemNode }) {
  const hasChildren = item.children.length > 0;
  const link = linkForItem(item);
  if (!hasChildren) {
    if (link.kind === 'external' && link.href) {
      return (
        <a href={link.href} className={navLinkClass} {...externalTargetProps(item)}>
          {item.label}
        </a>
      );
    }
    if (link.kind === 'internal' && link.href) {
      return (
        <Link to={link.href} className={navLinkClass}>
          {item.label}
        </Link>
      );
    }
    return <span className={`${navLinkClass} cursor-default`}>{item.label}</span>;
  }

  return (
    <li className="group relative list-none">
      {link.kind === 'external' && link.href ? (
        <a href={link.href} className={navLinkClass} {...externalTargetProps(item)}>
          {item.label}
        </a>
      ) : link.kind === 'internal' && link.href ? (
        <Link to={link.href} className={navLinkClass}>
          {item.label}
        </Link>
      ) : (
        <button
          type="button"
          className={navLinkClass}
          aria-haspopup="true"
        >
          {item.label}
        </button>
      )}
      <ul className="invisible absolute left-0 top-full z-50 min-w-[13rem] rounded-xl border border-gray-200 bg-white p-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none">
        {item.children.map((child) => (
          <DesktopDropdownItem key={child.id} item={child} />
        ))}
      </ul>
    </li>
  );
}

function MobileMenuItem({
  item,
  level = 0,
  onNavigate,
}: {
  item: MenuItemNode;
  level?: number;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const link = linkForItem(item);
  const hasChildren = item.children.length > 0;

  return (
    <li className="list-none">
      <div className="flex items-center gap-2">
        {link.kind === 'external' && link.href ? (
          <a
            href={link.href}
            className="flex-1 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            style={{ paddingLeft: `${0.75 + level * 0.8}rem` }}
            onClick={onNavigate}
            {...externalTargetProps(item)}
          >
            {item.label}
          </a>
        ) : link.kind === 'internal' && link.href ? (
          <Link
            to={link.href}
            className="flex-1 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            style={{ paddingLeft: `${0.75 + level * 0.8}rem` }}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        ) : (
          <span className="flex-1 rounded-md px-3 py-2 text-sm text-gray-700" style={{ paddingLeft: `${0.75 + level * 0.8}rem` }}>
            {item.label}
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-expanded={expanded}
            aria-label={`Toggle ${item.label}`}
            onClick={() => setExpanded((v) => !v)}
          >
            <span aria-hidden>{expanded ? '−' : '+'}</span>
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <ul className="mt-1 space-y-1">
          {item.children.map((child) => (
            <MobileMenuItem key={child.id} item={child} level={level + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function PublicLayout({
  children,
  backToHome = false,
  initialSiteConfig,
  initialMenuItems,
  deferPublicBootstrapLoad = false,
}: PublicLayoutProps) {
  const { member, token, isLoading, logout } = useAuth();
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(initialSiteConfig ?? cachedSiteConfig);
  const [menuItems, setMenuItems] = useState<MenuItemNode[]>(initialMenuItems ?? cachedMenuItems);
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

  useEffect(() => {
    if (deferPublicBootstrapLoad) return;
    api.get<PublicBootstrapResponse>('/public/bootstrap')
      .then((r) => {
        const config = r.data?.siteConfig ?? null;
        const menu = Array.isArray(r.data?.navbarMenu) ? r.data.navbarMenu : [];
        cachedSiteConfig = config;
        cachedMenuItems = menu;
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
            footerMarkdown: null,
            disableSms: false,
          };
        }
        setSiteConfig(cachedSiteConfig);
        setMenuItems(cachedMenuItems);
        setPublicDataReady(true);
      });
  }, [deferPublicBootstrapLoad]);

  const clubName = siteConfig?.clubName ?? '';
  const initials = (member?.name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="public-shell min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/90 backdrop-blur">
        <div className="public-container py-4 flex items-center justify-between gap-4">
          {backToHome ? (
            <Link to="/" className="text-sm font-medium text-primary-teal hover:underline">
              ← Back to home
            </Link>
          ) : (
            <Link to="/" className="flex items-center gap-3 min-w-0">
              {siteConfig?.logoUrl ? (
                <img src={siteConfig.logoUrl} alt="" className="h-14 w-14 rounded-md object-contain" />
              ) : null}
              {clubName ? (
                <span className="truncate text-lg sm:text-xl font-semibold tracking-tight text-gray-900">{clubName}</span>
              ) : (
                <span className="h-5 w-40 rounded bg-gray-100" aria-hidden />
              )}
            </Link>
          )}

          <button
            type="button"
            className="md:hidden rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-menu"
          >
            {mobileOpen ? 'Close' : 'Menu'}
          </button>

          <nav className="hidden md:flex items-center gap-2 lg:gap-3">
            {!backToHome && publicDataReady &&
              (menuItems.length > 0 ? (
                menuItems.map((item) => <DesktopNavItem key={item.id} item={item} />)
              ) : (
                <>
                  <Link to="/" className={navLinkClass}>
                    Home
                  </Link>
                </>
              ))}
            {!isLoading && (
              token && member ? (
                <div className="relative ml-2" ref={profileMenuRef}>
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen((v) => !v)}
                    className="rounded-full border border-gray-200 bg-white p-0.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                    aria-expanded={profileMenuOpen}
                    aria-haspopup="true"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-teal text-sm font-semibold text-white">
                      {initials || '?'}
                    </span>
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      <Link to="/leagues" className={memberMenuItemClass} onClick={() => setProfileMenuOpen(false)}>Leagues</Link>
                      <Link to="/my-requests" className={memberMenuItemClass} onClick={() => setProfileMenuOpen(false)}>Spares</Link>
                      <Link to="/members" className={memberMenuItemClass} onClick={() => setProfileMenuOpen(false)}>Club membership</Link>
                      <Link to="/governance" className={memberMenuItemClass} onClick={() => setProfileMenuOpen(false)}>Club governance</Link>
                      <button type="button" onClick={() => { setProfileMenuOpen(false); logout(); }} className={memberMenuItemClass}>
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  className="ml-1 rounded-md bg-primary-teal px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                >
                  Member login
                </Link>
              )
            )}
          </nav>
        </div>

        {mobileOpen && (
          <div id="public-mobile-menu" className="border-t border-gray-200 bg-white md:hidden">
            <div className="public-container py-3">
              {!backToHome && publicDataReady && (
                <ul className="space-y-1">
                  {menuItems.length > 0 ? (
                    menuItems.map((item) => (
                      <MobileMenuItem key={item.id} item={item} onNavigate={() => setMobileOpen(false)} />
                    ))
                  ) : (
                    <>
                      <li>
                        <Link
                          to="/"
                          className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setMobileOpen(false)}
                        >
                          Home
                        </Link>
                      </li>
                    </>
                  )}
                </ul>
              )}
              {!isLoading && (
                token && member ? (
                  <div className="mt-3 rounded-lg border border-gray-200 p-2">
                    <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Member</p>
                    <Link to="/leagues" className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setMobileOpen(false)}>Leagues</Link>
                    <Link to="/my-requests" className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setMobileOpen(false)}>Spares</Link>
                    <Link to="/members" className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setMobileOpen(false)}>Club membership</Link>
                    <Link to="/governance" className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setMobileOpen(false)}>Club governance</Link>
                    <button
                      type="button"
                      className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        setMobileOpen(false);
                        logout();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                ) : (
                  <Link
                    to="/login"
                    className="mt-3 block rounded-md bg-primary-teal px-3 py-2 text-center text-sm font-medium text-white hover:bg-primary-teal/90"
                    onClick={() => setMobileOpen(false)}
                  >
                  Member login
                  </Link>
                )
              )}
            </div>
          </div>
        )}
      </header>

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
              {token && member ? (
                <Link to="/leagues" className="text-gray-600 hover:text-gray-900 hover:underline">Leagues</Link>
              ) : (
                <Link to="/login" className="text-gray-600 hover:text-gray-900 hover:underline">Member login</Link>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Contact and address</h2>
            <div className="text-sm text-gray-600">
              {siteConfig?.contactEmail ? <p>Email: {siteConfig.contactEmail}</p> : <p>Email: info@trianglecurling.com</p>}
              {siteConfig?.contactPhone ? <p>Phone: {siteConfig.contactPhone}</p> : null}
              <p className="mt-2">Triangle Curling Center, 2310 So Hi Drive, Durham, NC 27703</p>
              <p>P.O. Box 14628, Durham, NC 27709</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
