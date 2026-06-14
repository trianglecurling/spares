import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useLeagueOptions } from '../contexts/LeagueOptionsContext';
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
  format: 'teams' | 'doubles' | 'instructional';
  startDate: string;
  endDate: string;
  sessionId: number | null;
  drawTimes: string[];
  exceptions?: string[];
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
  const {
    member,
    logout,
    accountSwitchOptions,
    actorMemberId,
    isImpersonating,
    switchToMemberAccount,
    stopImpersonation,
  } = useAuth();
  const { showAlert } = useAlert();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
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
  const { leagues: sessionLeagues, registrationWindowSessionId } = useLeagueOptions();
  const leagues = sessionLeagues as League[];
  const [myRosterLeagueIds, setMyRosterLeagueIds] = useState<number[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const showAccountSwitcher = accountSwitchOptions.length > 1;

  const handleSelectAccount = async (optionId: number) => {
    if (!member || optionId === member.id) {
      setAccountMenuOpen(false);
      return;
    }
    try {
      if (isImpersonating && actorMemberId !== null && optionId === actorMemberId) {
        await stopImpersonation();
      } else {
        await switchToMemberAccount(optionId);
      }
    } catch {
      showAlert(
        'Unable to switch accounts. Try again or refresh the page.',
        'error'
      );
    } finally {
      setAccountMenuOpen(false);
    }
  };

  const isNavLinkActive = (to: string, matchPrefix?: boolean) =>
    matchPrefix
      ? location.pathname === to || location.pathname.startsWith(`${to}/`)
      : location.pathname === to;

  const isLeaguesActive =
    isNavLinkActive('/leagues', true) || isNavLinkActive('/waitlists', true);
  const isSocialMember = Boolean(member?.socialMember);
  const isSparesActive =
    isNavLinkActive('/availability') ||
    isNavLinkActive('/my-requests') ||
    location.pathname.startsWith('/request-spare');
  const isDirectoryActive = isNavLinkActive('/members') || isNavLinkActive('/governance');
  const isCalendarActive = isNavLinkActive('/calendar') || isNavLinkActive('/book-ice');
  const isAdminActive =
    isNavLinkActive('/admin/members') ||
    isNavLinkActive('/admin/waivers') ||
    isNavLinkActive('/admin/sheets') ||
    isNavLinkActive('/admin/governance') ||
    isNavLinkActive('/admin/sponsorship') ||
    isNavLinkActive('/admin/events') ||
    isNavLinkActive('/admin/payments') ||
    isNavLinkActive('/admin/webhooks') ||
    isNavLinkActive('/admin/config') ||
    isNavLinkActive('/admin/registration', true);

  const canManageLeagues = Boolean(
    member && memberHasScope(member, 'leagues.manage')
  );
  const canManageMembers = Boolean(member && memberHasScope(member, 'members.manage'));
  const canManageContent = Boolean(member && memberHasScope(member, 'content.manage'));
  const canManageGovernance = Boolean(member && memberHasScope(member, 'governance.manage'));
  const canManageSponsorship = Boolean(member && memberHasScope(member, 'sponsorship.manage'));
  const canManageEvents = Boolean(member && memberHasScope(member, 'events.manage'));
  const canManageRegistration = Boolean(member && memberHasScope(member, 'admin.manage'));
  const canManageRegistrations = Boolean(
    member && (memberHasScope(member, 'registrations.manage') || memberHasScope(member, 'admin.manage')),
  );
  const canManageWebhooks = Boolean(member && memberHasScope(member, 'admin.manage'));
  const canReadPayments = Boolean(member && memberHasScope(member, 'payments.read'));
  const canManageServerConfig = Boolean(member?.isServerAdmin);
  const canManageWaivers = Boolean(
    member &&
      (memberHasScope(member, 'members.manage') || memberHasScope(member, 'events.manage'))
  );
  const adminLinks = [
    ...(canManageMembers ? [{ to: '/admin/members', label: 'Manage members' }] : []),
    ...(canManageWaivers ? [{ to: '/admin/waivers', label: 'Manage waivers' }] : []),
    ...(canManageLeagues ? [{ to: '/admin/sheets', label: 'Manage sheets' }] : []),
    ...(canManageContent ? [{ to: '/admin/content', label: 'Manage content' }] : []),
    ...(canManageGovernance ? [{ to: '/admin/governance', label: 'Manage governance' }] : []),
    ...(canManageEvents ? [{ to: '/admin/events', label: 'Manage events' }] : []),
    ...(canManageRegistrations ? [{ to: '/admin/registrations', label: 'Manage registrations' }] : []),
    ...(canManageRegistration ? [{ to: '/admin/registration/seasons', label: 'Registration configuration' }] : []),
    ...(canManageSponsorship ? [{ to: '/admin/sponsorship', label: 'Manage sponsorships' }] : []),
    ...(canReadPayments ? [{ to: '/admin/payments', label: 'Payment activity' }] : []),
    ...(canManageWebhooks ? [{ to: '/admin/webhooks', label: 'Outbound webhooks' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/roles', label: 'Manage roles' }] : []),
    ...(canManageServerConfig ? [{ to: '/admin/config', label: 'Server config' }] : []),
  ];
  const hasAdminLinks = adminLinks.length > 0;

  // Fetch my roster leagues for the Leagues nav submenu.
  useEffect(() => {
    let cancelled = false;
    const memberId = member?.id ?? null;
    if (memberId == null) {
      setMyRosterLeagueIds([]);
      return;
    }

    get('/members/{memberId}/leagues', { relevantSession: 'true' }, { memberId: String(memberId) })
      .then((myLeaguesRows) => {
        if (cancelled) return;
        const rows = Array.isArray(myLeaguesRows) ? myLeaguesRows : [];
        setMyRosterLeagueIds([...new Set(rows.map((r) => r.leagueId))]);
      })
      .catch(() => {
        if (!cancelled) {
          setMyRosterLeagueIds([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

  const navMyLeaguesInCurrentSession = useMemo(() => {
    if (registrationWindowSessionId == null) return [];
    const onRoster = new Set(myRosterLeagueIds);
    return leagues.filter(
      (l) => l.sessionId === registrationWindowSessionId && onRoster.has(l.id)
    );
  }, [leagues, registrationWindowSessionId, myRosterLeagueIds]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
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
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    if (
      mobileMenuOpen ||
      leaguesDropdownOpen ||
      sparesDropdownOpen ||
      directoryDropdownOpen ||
      adminDropdownOpen ||
      calendarDropdownOpen ||
      accountMenuOpen
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
    accountMenuOpen,
  ]);

  const closeDropdowns = () => {
    setLeaguesDropdownOpen(false);
    setSparesDropdownOpen(false);
    setDirectoryDropdownOpen(false);
    setAdminDropdownOpen(false);
    setCalendarDropdownOpen(false);
    setAccountMenuOpen(false);
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
                  Members Area
                </span>
              </Link>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center space-x-1">
                {/* Dashboard */}
                <Link to="/dashboard" className={navLinkClass(location.pathname === '/dashboard')}>
                  Dashboard
                </Link>

                {/* Leagues */}
                <div className="relative">
                  <button
                    type="button"
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
                      <Link
                        to="/waitlists"
                        onClick={closeDropdowns}
                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Waitlists
                      </Link>
                      {navMyLeaguesInCurrentSession.length > 0 ? (
                        <>
                          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                          {navMyLeaguesInCurrentSession.map((league) => (
                            <Link
                              key={league.id}
                              to={`/leagues/${league.id}`}
                              onClick={closeDropdowns}
                              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              {league.name}
                            </Link>
                          ))}
                        </>
                      ) : null}
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
                {showAccountSwitcher ? (
                  <div className="relative flex items-center gap-0.5" ref={accountMenuRef}>
                    <Link
                      to="/profile"
                      className="text-sm text-gray-700 dark:text-gray-300 hover:text-primary-teal font-medium max-w-[10rem] truncate"
                    >
                      {member?.name}
                    </Link>
                    <button
                      type="button"
                      className="p-1 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal"
                      aria-label="Switch account"
                      aria-haspopup="menu"
                      aria-expanded={accountMenuOpen}
                      onClick={() => {
                        setAccountMenuOpen((open) => !open);
                        setLeaguesDropdownOpen(false);
                        setSparesDropdownOpen(false);
                        setDirectoryDropdownOpen(false);
                        setAdminDropdownOpen(false);
                        setCalendarDropdownOpen(false);
                      }}
                    >
                      <HiChevronDown
                        className={`w-4 h-4 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {accountMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 min-w-[12rem] max-w-[20rem] bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700 py-1"
                      >
                        {accountSwitchOptions.map((opt) => {
                          const isActive = opt.id === member?.id;
                          const isLoginSelf =
                            actorMemberId !== null && opt.id === actorMemberId;
                          let suffix = '';
                          if (isActive) suffix = ' (current)';
                          else if (isLoginSelf && isImpersonating) suffix = ' — your login';
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              role="menuitem"
                              disabled={isActive}
                              className={`block w-full text-left px-4 py-2 text-sm ${
                                isActive
                                  ? 'text-gray-500 dark:text-gray-400 cursor-default'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                              onClick={() => {
                                void handleSelectAccount(opt.id);
                              }}
                            >
                              <span className="block truncate">
                                {opt.name}
                                {suffix}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <Link
                    to="/profile"
                    className="text-sm text-gray-700 dark:text-gray-300 hover:text-primary-teal font-medium"
                  >
                    {member?.name}
                  </Link>
                )}
                <button
                  type="button"
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
                  <Link
                    to="/waitlists"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Waitlists
                  </Link>
                  {navMyLeaguesInCurrentSession.length > 0 ? (
                    <>
                      <div className="my-1 border-t border-gray-200 dark:border-gray-600" />
                      {navMyLeaguesInCurrentSession.map((league) => (
                        <Link
                          key={league.id}
                          to={`/leagues/${league.id}`}
                          onClick={() => setMobileMenuOpen(false)}
                          className="block px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {league.name}
                        </Link>
                      ))}
                    </>
                  ) : null}
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
                  {showAccountSwitcher && (
                    <div className="mt-1 space-y-1 pb-2">
                      <div className="px-3 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Switch account
                      </div>
                      {accountSwitchOptions.map((opt) => {
                        const isActive = opt.id === member?.id;
                        const isLoginSelf =
                          actorMemberId !== null && opt.id === actorMemberId;
                        let suffix = '';
                        if (isActive) suffix = ' (current)';
                        else if (isLoginSelf && isImpersonating) suffix = ' — your login';
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={isActive}
                            onClick={() => {
                              void handleSelectAccount(opt.id);
                              setMobileMenuOpen(false);
                            }}
                            className={`block w-full text-left px-3 py-2 rounded-md text-sm ${
                              isActive
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            <span className="block truncate">
                              {opt.name}
                              {suffix}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    type="button"
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
