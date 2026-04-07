import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Footer from './Footer';
import { get } from '../api/client';
import { HiBars3, HiChevronDown, HiXMark } from 'react-icons/hi2';
import { memberHasScope } from '../utils/permissions';

interface LayoutProps {
  children: React.ReactNode;
  /** When true, main content uses full width (no max-w constraint) - for Calendar etc. */
  fullWidth?: boolean;
}

interface League {
  id: number;
  name: string;
  dayOfWeek: number;
  format: 'teams' | 'doubles';
  startDate: string;
  endDate: string;
  drawTimes: string[];
  exceptions: string[];
}

const navLinkClass = (active: boolean) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    active
      ? 'bg-primary-teal text-white'
      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`;

const navLinkClassMobile = (active: boolean) =>
  `block px-3 py-2 rounded-md text-base font-medium ${
    active
      ? 'bg-primary-teal text-white'
      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`;

export default function Layout({ children, fullWidth }: LayoutProps) {
  const { member, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [leaguesDropdownOpen, setLeaguesDropdownOpen] = useState(false);
  const [sparesDropdownOpen, setSparesDropdownOpen] = useState(false);
  const [directoryDropdownOpen, setDirectoryDropdownOpen] = useState(false);
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false);
  const [calendarDropdownOpen, setCalendarDropdownOpen] = useState(false);
  const [mobileLeaguesExpanded, setMobileLeaguesExpanded] = useState(false);
  const [mobileSparesExpanded, setMobileSparesExpanded] = useState(false);
  const [mobileDirectoryExpanded, setMobileDirectoryExpanded] = useState(false);
  const [mobileAdminExpanded, setMobileAdminExpanded] = useState(false);
  const [mobileCalendarExpanded, setMobileCalendarExpanded] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const isNavLinkActive = (to: string, matchPrefix?: boolean) =>
    matchPrefix
      ? location.pathname === to || location.pathname.startsWith(`${to}/`)
      : location.pathname === to;

  const isLeaguesActive = isNavLinkActive('/leagues', true);
  const isSocialMember = Boolean(member?.socialMember);
  const isSparesActive =
    isNavLinkActive('/availability') ||
    isNavLinkActive('/my-requests') ||
    location.pathname.startsWith('/request-spare');
  const isDirectoryActive = isNavLinkActive('/members') || isNavLinkActive('/governance');
  const isCalendarActive = isNavLinkActive('/calendar') || isNavLinkActive('/book-ice');
  const isAdminActive =
    isNavLinkActive('/admin/members') ||
    isNavLinkActive('/admin/sheets') ||
    isNavLinkActive('/admin/governance') ||
    isNavLinkActive('/admin/sponsorship') ||
    isNavLinkActive('/admin/events') ||
    isNavLinkActive('/admin/payments') ||
    isNavLinkActive('/admin/config');

  const canManageLeagues = Boolean(
    member && memberHasScope(member, 'leagues.manage')
  );
  const canManageMembers = Boolean(member && memberHasScope(member, 'members.manage'));
  const canManageContent = Boolean(member && memberHasScope(member, 'content.manage'));
  const canManageGovernance = Boolean(member && memberHasScope(member, 'governance.manage'));
  const canManageSponsorship = Boolean(member && memberHasScope(member, 'sponsorship.manage'));
  const canManageEvents = Boolean(member && memberHasScope(member, 'events.manage'));
  const canReadPayments = Boolean(member && memberHasScope(member, 'payments.read'));
  const canManageServerConfig = Boolean(member?.isServerAdmin);
  const adminLinks = [
    ...(canManageMembers ? [{ to: '/admin/members', label: 'Manage members' }] : []),
    ...(canManageLeagues ? [{ to: '/admin/sheets', label: 'Manage sheets' }] : []),
    ...(canManageContent ? [{ to: '/admin/content', label: 'Manage content' }] : []),
    ...(canManageGovernance ? [{ to: '/admin/governance', label: 'Manage governance' }] : []),
    ...(canManageEvents ? [{ to: '/admin/events', label: 'Manage events' }] : []),
    ...(canManageSponsorship ? [{ to: '/admin/sponsorship', label: 'Manage sponsorships' }] : []),
    ...(canReadPayments ? [{ to: '/admin/payments', label: 'Payment activity' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/roles', label: 'Manage roles' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/config', label: 'Server config' }] : []),
  ];
  const hasAdminLinks = adminLinks.length > 0;

  // Fetch leagues for dropdown
  useEffect(() => {
    let cancelled = false;
    setLeaguesLoading(true);
    get('/leagues')
      .then((data) => {
        if (!cancelled) {
          setLeagues(data as League[]);
          setLeaguesLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLeaguesLoading(false);
        // Ignore - leagues dropdown will show "View all" only
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileLeaguesExpanded(false);
    setMobileSparesExpanded(false);
    setMobileDirectoryExpanded(false);
    setMobileAdminExpanded(false);
    setMobileCalendarExpanded(false);
  }, [location.pathname]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
        setLeaguesDropdownOpen(false);
        setSparesDropdownOpen(false);
        setDirectoryDropdownOpen(false);
        setAdminDropdownOpen(false);
        setCalendarDropdownOpen(false);
      }
    };

    if (
      mobileMenuOpen ||
      leaguesDropdownOpen ||
      sparesDropdownOpen ||
      directoryDropdownOpen ||
      adminDropdownOpen ||
      calendarDropdownOpen
    ) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [
    mobileMenuOpen,
    leaguesDropdownOpen,
    sparesDropdownOpen,
    directoryDropdownOpen,
    adminDropdownOpen,
    calendarDropdownOpen,
  ]);

  const closeDropdowns = () => {
    setLeaguesDropdownOpen(false);
    setSparesDropdownOpen(false);
    setDirectoryDropdownOpen(false);
    setAdminDropdownOpen(false);
    setCalendarDropdownOpen(false);
  };

  const MobileDropdownSection = ({
    label,
    expanded,
    onToggle,
    active,
    children,
  }: {
    label: string;
    expanded: boolean;
    onToggle: () => void;
    active: boolean;
    children: React.ReactNode;
  }) => (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-base font-medium ${
          active
            ? 'bg-primary-teal text-white'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        {label}
        <HiChevronDown className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div className="pl-4 mt-1 space-y-1">{children}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <nav
        className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700"
        ref={menuRef}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link
                to="/"
                className="group flex flex-col leading-tight focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 rounded"
              >
                <span className="text-xl font-bold text-[#121033] dark:text-gray-100 group-hover:text-primary-teal transition-colors">
                  Triangle Curling
                </span>
                <span className="text-xs font-medium tracking-wide uppercase text-gray-600 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                  Spare Management
                </span>
              </Link>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center space-x-1">
                {/* Dashboard */}
                <Link to="/dashboard" className={navLinkClass(location.pathname === '/dashboard')}>
                  Dashboard
                </Link>

                {/* Leagues dropdown */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setLeaguesDropdownOpen(!leaguesDropdownOpen);
                      setSparesDropdownOpen(false);
                      setAdminDropdownOpen(false);
                      setCalendarDropdownOpen(false);
                    }}
                    className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium ${navLinkClass(isLeaguesActive)}`}
                  >
                    Leagues
                    <HiChevronDown
                      className={`w-4 h-4 transition-transform ${leaguesDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {leaguesDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1">
                      <Link
                        to="/leagues"
                        onClick={closeDropdowns}
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        View all
                      </Link>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                      {leaguesLoading ? (
                        <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                          Loading leagues…
                        </div>
                      ) : (
                        leagues.map((league) => (
                          <Link
                            key={league.id}
                            to={`/leagues/${league.id}`}
                            onClick={closeDropdowns}
                            className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {league.name}
                          </Link>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Spares dropdown */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setSparesDropdownOpen(!sparesDropdownOpen);
                      setLeaguesDropdownOpen(false);
                      setDirectoryDropdownOpen(false);
                      setAdminDropdownOpen(false);
                      setCalendarDropdownOpen(false);
                    }}
                    className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium ${navLinkClass(isSparesActive)}`}
                  >
                    Spares
                    <HiChevronDown
                      className={`w-4 h-4 transition-transform ${sparesDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {sparesDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1">
                      {isSocialMember ? (
                        <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                          Social memberships do not include sparing or spare requests.
                        </div>
                      ) : (
                        <>
                          <Link
                            to="/availability"
                            onClick={closeDropdowns}
                            className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            My availability
                          </Link>
                          <Link
                            to="/my-requests"
                            onClick={closeDropdowns}
                            className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            My requests
                          </Link>
                          <Link
                            to="/request-spare"
                            onClick={closeDropdowns}
                            className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            Request a spare
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Directory dropdown */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setDirectoryDropdownOpen(!directoryDropdownOpen);
                      setLeaguesDropdownOpen(false);
                      setSparesDropdownOpen(false);
                      setAdminDropdownOpen(false);
                      setCalendarDropdownOpen(false);
                    }}
                    className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium ${navLinkClass(isDirectoryActive)}`}
                  >
                    Directory
                    <HiChevronDown
                      className={`w-4 h-4 transition-transform ${directoryDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {directoryDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1">
                      <Link
                        to="/members"
                        onClick={closeDropdowns}
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Club membership
                      </Link>
                      <Link
                        to="/governance"
                        onClick={closeDropdowns}
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Club governance
                      </Link>
                    </div>
                  )}
                </div>

                {/* Calendar dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarDropdownOpen(!calendarDropdownOpen);
                      setLeaguesDropdownOpen(false);
                      setSparesDropdownOpen(false);
                      setDirectoryDropdownOpen(false);
                      setAdminDropdownOpen(false);
                    }}
                    className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium ${navLinkClass(isCalendarActive)}`}
                  >
                    Calendar
                    <HiChevronDown
                      className={`w-4 h-4 transition-transform ${calendarDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {calendarDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1">
                      <Link
                        to="/calendar"
                        onClick={closeDropdowns}
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Full calendar
                      </Link>
                      {!isSocialMember && (
                        <Link
                          to="/book-ice"
                          onClick={closeDropdowns}
                          className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          Book ice time
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                {/* Admin dropdown - only when user has admin links */}
                {hasAdminLinks && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setAdminDropdownOpen(!adminDropdownOpen);
                        setLeaguesDropdownOpen(false);
                        setSparesDropdownOpen(false);
                        setDirectoryDropdownOpen(false);
                        setCalendarDropdownOpen(false);
                      }}
                      className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium ${navLinkClass(isAdminActive)}`}
                    >
                      Admin
                      <HiChevronDown
                        className={`w-4 h-4 transition-transform ${adminDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {adminDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1">
                        {adminLinks.map((link) => (
                          <Link
                            key={link.to}
                            to={link.to}
                            onClick={closeDropdowns}
                            className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Desktop User Menu */}
              <div className="hidden md:flex items-center space-x-4">
                <Link
                  to="/profile"
                  className="text-sm text-gray-700 dark:text-gray-300 hover:text-primary-teal font-medium"
                >
                  {member?.name}
                </Link>
                <button
                  onClick={logout}
                  className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Logout
                </button>
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-teal"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <HiXMark className="w-6 h-6" /> : <HiBars3 className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-gray-200 dark:border-gray-700 py-4">
              <div className="space-y-1">
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={navLinkClassMobile(location.pathname === '/dashboard')}
                >
                  Dashboard
                </Link>

                <MobileDropdownSection
                  label="Leagues"
                  expanded={mobileLeaguesExpanded}
                  onToggle={() => setMobileLeaguesExpanded(!mobileLeaguesExpanded)}
                  active={isLeaguesActive}
                >
                  <Link
                    to="/leagues"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    View all
                  </Link>
                  {leaguesLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      Loading leagues…
                    </div>
                  ) : (
                    leagues.map((league) => (
                      <Link
                        key={league.id}
                        to={`/leagues/${league.id}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {league.name}
                      </Link>
                    ))
                  )}
                </MobileDropdownSection>

                <MobileDropdownSection
                  label="Spares"
                  expanded={mobileSparesExpanded}
                  onToggle={() => setMobileSparesExpanded(!mobileSparesExpanded)}
                  active={isSparesActive}
                >
                  {isSocialMember ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      Social memberships do not include sparing or spare requests.
                    </div>
                  ) : (
                    <>
                      <Link
                        to="/availability"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        My availability
                      </Link>
                      <Link
                        to="/my-requests"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        My requests
                      </Link>
                      <Link
                        to="/request-spare"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Request a spare
                      </Link>
                    </>
                  )}
                </MobileDropdownSection>

                <MobileDropdownSection
                  label="Directory"
                  expanded={mobileDirectoryExpanded}
                  onToggle={() => setMobileDirectoryExpanded(!mobileDirectoryExpanded)}
                  active={isDirectoryActive}
                >
                  <Link
                    to="/members"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Club membership
                  </Link>
                  <Link
                    to="/governance"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Club governance
                  </Link>
                </MobileDropdownSection>

                <MobileDropdownSection
                  label="Calendar"
                  expanded={mobileCalendarExpanded}
                  onToggle={() => setMobileCalendarExpanded(!mobileCalendarExpanded)}
                  active={isCalendarActive}
                >
                  <Link
                    to="/calendar"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Full calendar
                  </Link>
                  {!isSocialMember && (
                    <Link
                      to="/book-ice"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Book ice time
                    </Link>
                  )}
                </MobileDropdownSection>

                {hasAdminLinks && (
                  <MobileDropdownSection
                    label="Admin"
                    expanded={mobileAdminExpanded}
                    onToggle={() => setMobileAdminExpanded(!mobileAdminExpanded)}
                    active={isAdminActive}
                  >
                    {adminLinks.map((link) => (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => setMobileMenuOpen(false)}
                        className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </MobileDropdownSection>
                )}

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <Link
                    to="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {member?.name}
                  </Link>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      logout();
                    }}
                    className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

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
