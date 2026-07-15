import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useMemberNavigation } from '../hooks/useMemberNavigation';
import { memberDisplayInitials } from '../utils/memberDisplayCache';
import { FlyoutMenuItem, FlyoutMenuLeaf, FlyoutMenuList } from './FlyoutMenuList';
import {
  MobileNavAccordionGroup,
  MobileNavAccordionItem,
  mobileNavItemClass,
} from './MobileNavAccordion';

const flyoutTriggerClass =
  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-300 dark:hover:bg-gray-700';
const flyoutItemClass =
  'block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:text-gray-300 dark:hover:bg-gray-700';

/** Matches `min-w-[12rem]` on flyout panels. */
const FLYOUT_PANEL_MIN_WIDTH = 192;
const VIEWPORT_PADDING = 8;

interface MemberNavigationPanelProps {
  onNavigate?: () => void;
  /** Desktop profile menu uses side flyouts; mobile uses expandable sections. */
  variant?: 'flyout' | 'accordion';
  /** Side nested panels open toward. `auto` prefers right and flips left when clipped. */
  flyoutDirection?: 'left' | 'right' | 'auto';
  showAccountFooter?: boolean;
  /** When false, only account actions (profile, switch account, logout) are shown. */
  showMainNav?: boolean;
  /** When false, accordion items render without an outer `MobileNavAccordionGroup` (parent supplies the group). */
  wrapAccordionGroup?: boolean;
}

function resolveFlyoutDirection(
  anchorRect: DOMRect,
  preferred: 'left' | 'right',
): 'left' | 'right' {
  const spaceRight = window.innerWidth - anchorRect.right - VIEWPORT_PADDING;
  const spaceLeft = anchorRect.left - VIEWPORT_PADDING;
  const fitsRight = spaceRight >= FLYOUT_PANEL_MIN_WIDTH;
  const fitsLeft = spaceLeft >= FLYOUT_PANEL_MIN_WIDTH;

  if (preferred === 'right') {
    if (fitsRight) return 'right';
    if (fitsLeft) return 'left';
    return spaceRight >= spaceLeft ? 'right' : 'left';
  }

  if (fitsLeft) return 'left';
  if (fitsRight) return 'right';
  return spaceLeft >= spaceRight ? 'left' : 'right';
}

function useAdaptiveFlyoutDirection(
  enabled: boolean,
  flyoutDirection: 'left' | 'right' | 'auto',
): { panelRef: RefObject<HTMLDivElement | null>; resolvedDirection: 'left' | 'right' } {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [resolvedDirection, setResolvedDirection] = useState<'left' | 'right'>(() => {
    if (flyoutDirection === 'left') return 'left';
    if (flyoutDirection === 'right') return 'right';
    return 'right';
  });

  const updateDirection = useCallback(() => {
    if (!enabled || flyoutDirection !== 'auto') return;
    const anchor = panelRef.current;
    if (!anchor) return;
    setResolvedDirection(resolveFlyoutDirection(anchor.getBoundingClientRect(), 'right'));
  }, [enabled, flyoutDirection]);

  useLayoutEffect(() => {
    if (!enabled) return;

    if (flyoutDirection === 'left' || flyoutDirection === 'right') {
      setResolvedDirection(flyoutDirection);
      return;
    }

    updateDirection();

    window.addEventListener('resize', updateDirection);
    window.addEventListener('scroll', updateDirection, true);

    const anchor = panelRef.current;
    if (!anchor) return;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateDirection();
          })
        : null;
    resizeObserver?.observe(anchor);

    return () => {
      window.removeEventListener('resize', updateDirection);
      window.removeEventListener('scroll', updateDirection, true);
      resizeObserver?.disconnect();
    };
  }, [enabled, flyoutDirection, updateDirection]);

  const effectiveDirection =
    flyoutDirection === 'left' || flyoutDirection === 'right' ? flyoutDirection : resolvedDirection;

  return { panelRef, resolvedDirection: effectiveDirection };
}

function NavLink({
  to,
  children,
  className,
  onNavigate,
}: {
  to: string;
  children: React.ReactNode;
  className: string;
  onNavigate?: () => void;
}) {
  return (
    <Link to={to} className={className} onClick={onNavigate}>
      {children}
    </Link>
  );
}

export function MemberMobileNavLabel() {
  const { member, memberDisplayName } = useAuth();
  const name = memberDisplayName ?? member?.name ?? 'My account';
  const initials = memberDisplayInitials(name);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-teal-solid text-xs font-semibold text-white"
        aria-hidden
      >
        {initials}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export default function MemberNavigationPanel({
  onNavigate,
  variant = 'flyout',
  flyoutDirection = 'auto',
  showAccountFooter = true,
  showMainNav = true,
  wrapAccordionGroup = true,
}: MemberNavigationPanelProps) {
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
  const {
    isSocialMember,
    adminLinks,
    hasAdminLinks,
    navMyLeaguesInCurrentSession,
    isNavigationReady,
  } = useMemberNavigation();

  const { panelRef, resolvedDirection } = useAdaptiveFlyoutDirection(
    variant === 'flyout' && isNavigationReady,
    flyoutDirection,
  );

  const showAccountSwitcher = accountSwitchOptions.length > 1;

  const handleNavigate = () => {
    onNavigate?.();
  };

  const handleSelectAccount = async (optionId: number) => {
    if (!member || optionId === member.id) {
      handleNavigate();
      return;
    }
    try {
      if (isImpersonating && actorMemberId !== null && optionId === actorMemberId) {
        await stopImpersonation();
      } else {
        await switchToMemberAccount(optionId);
      }
    } catch {
      showAlert('Unable to switch accounts. Try again or refresh the page.', 'error');
    } finally {
      handleNavigate();
    }
  };

  if (!isNavigationReady) {
    return <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Loading menu…</p>;
  }

  const leaguesItems = (
    <>
      <li className="list-none">
        <NavLink to="/leagues" className={flyoutItemClass} onNavigate={handleNavigate}>
          View all
        </NavLink>
      </li>
      <li className="list-none">
        <NavLink to="/waitlists" className={flyoutItemClass} onNavigate={handleNavigate}>
          Waitlists
        </NavLink>
      </li>
      {navMyLeaguesInCurrentSession.length > 0 ? (
        <>
          <li className="my-1 list-none border-t border-gray-200 dark:border-gray-700" aria-hidden />
          {navMyLeaguesInCurrentSession.map((league) => (
            <li key={league.id} className="list-none">
              <NavLink
                to={`/leagues/${league.id}`}
                className={flyoutItemClass}
                onNavigate={handleNavigate}
              >
                {league.name}
              </NavLink>
            </li>
          ))}
        </>
      ) : null}
    </>
  );

  const sparesItems = isSocialMember ? (
    <li className="list-none">
      <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
        Social memberships do not include sparing or spare requests.
      </p>
    </li>
  ) : (
    <>
      <li className="list-none">
        <NavLink to="/availability" className={flyoutItemClass} onNavigate={handleNavigate}>
          My availability
        </NavLink>
      </li>
      <li className="list-none">
        <NavLink to="/my-requests" className={flyoutItemClass} onNavigate={handleNavigate}>
          My requests
        </NavLink>
      </li>
      <li className="list-none">
        <NavLink to="/request-spare" className={flyoutItemClass} onNavigate={handleNavigate}>
          Request a spare
        </NavLink>
      </li>
    </>
  );

  const directoryItems = (
    <>
      <li className="list-none">
        <NavLink to="/members" className={flyoutItemClass} onNavigate={handleNavigate}>
          Club membership
        </NavLink>
      </li>
      <li className="list-none">
        <NavLink to="/governance" className={flyoutItemClass} onNavigate={handleNavigate}>
          Club governance
        </NavLink>
      </li>
    </>
  );

  const calendarItems = (
    <>
      <li className="list-none">
        <NavLink to="/calendar" className={flyoutItemClass} onNavigate={handleNavigate}>
          Full calendar
        </NavLink>
      </li>
      {!isSocialMember && (
        <li className="list-none">
          <NavLink to="/book-ice" className={flyoutItemClass} onNavigate={handleNavigate}>
            Book ice time
          </NavLink>
        </li>
      )}
    </>
  );

  const volunteeringItems = (
    <>
      <li className="list-none">
        <NavLink to="/volunteering" className={flyoutItemClass} onNavigate={handleNavigate}>
          Volunteering hub
        </NavLink>
      </li>
      <li className="list-none">
        <NavLink to="/volunteering?tab=shifts" className={flyoutItemClass} onNavigate={handleNavigate}>
          My shifts
        </NavLink>
      </li>
    </>
  );

  const adminItems = adminLinks.map((link) => (
    <li key={link.to} className="list-none">
      <NavLink to={link.to} className={flyoutItemClass} onNavigate={handleNavigate}>
        {link.label}
      </NavLink>
    </li>
  ));

  const accountFooter = showAccountFooter ? (
    <div className={showMainNav ? 'border-t border-gray-200 pt-2 dark:border-gray-700' : undefined}>
      {variant === 'flyout' ? (
        <FlyoutMenuList visible direction={resolvedDirection} className="space-y-0.5">
          <FlyoutMenuLeaf>
            <NavLink to="/profile" className={flyoutItemClass} onNavigate={handleNavigate}>
              My profile
            </NavLink>
          </FlyoutMenuLeaf>
          {showAccountSwitcher && (
            <FlyoutMenuItem
              id="switch-account"
              label="Switch account"
              direction={resolvedDirection}
              triggerClassName={flyoutTriggerClass}
            >
              {accountSwitchOptions.map((opt) => {
                const isActive = opt.id === member?.id;
                const isLoginSelf = actorMemberId !== null && opt.id === actorMemberId;
                let suffix = '';
                if (isActive) suffix = ' (current)';
                else if (isLoginSelf && isImpersonating) suffix = ' — your login';
                return (
                  <li key={opt.id} className="list-none">
                    <button
                      type="button"
                      disabled={isActive}
                      onClick={() => {
                        void handleSelectAccount(opt.id);
                      }}
                      className={`${flyoutItemClass} w-full text-left disabled:cursor-default disabled:text-gray-500 dark:disabled:text-gray-400`}
                    >
                      <span className="block truncate">
                        {opt.name}
                        {suffix}
                      </span>
                    </button>
                  </li>
                );
              })}
            </FlyoutMenuItem>
          )}
          <FlyoutMenuLeaf>
            <button
              type="button"
              onClick={() => {
                handleNavigate();
                logout();
              }}
              className={`${flyoutItemClass} w-full text-left`}
            >
              Logout
            </button>
          </FlyoutMenuLeaf>
        </FlyoutMenuList>
      ) : (
        <>
          <NavLink to="/profile" className={mobileNavItemClass} onNavigate={handleNavigate}>
            My profile
          </NavLink>
          {showAccountSwitcher && (
            <MobileNavAccordionItem id="switch-account" label="Switch account">
              {accountSwitchOptions.map((opt) => {
                const isActive = opt.id === member?.id;
                const isLoginSelf = actorMemberId !== null && opt.id === actorMemberId;
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
                    }}
                    className={`${mobileNavItemClass} disabled:cursor-default disabled:text-gray-500 dark:disabled:text-gray-400`}
                  >
                    <span className="block truncate">
                      {opt.name}
                      {suffix}
                    </span>
                  </button>
                );
              })}
            </MobileNavAccordionItem>
          )}
          <button
            type="button"
            onClick={() => {
              handleNavigate();
              logout();
            }}
            className={mobileNavItemClass}
          >
            Logout
          </button>
        </>
      )}
    </div>
  ) : null;

  if (variant === 'accordion' && !showMainNav) {
    return <MobileNavAccordionGroup>{accountFooter}</MobileNavAccordionGroup>;
  }

  if (variant === 'accordion') {
    const accordionContent = (
      <>
        <NavLink to="/dashboard" className={mobileNavItemClass} onNavigate={handleNavigate}>
          Dashboard
        </NavLink>

        <MobileNavAccordionItem id="leagues" label="Leagues">
          <NavLink to="/leagues" className={mobileNavItemClass} onNavigate={handleNavigate}>
            View all
          </NavLink>
          <NavLink to="/waitlists" className={mobileNavItemClass} onNavigate={handleNavigate}>
            Waitlists
          </NavLink>
          {navMyLeaguesInCurrentSession.length > 0 ? (
            <>
              <div className="my-1 border-t border-gray-200 dark:border-gray-700" aria-hidden />
              {navMyLeaguesInCurrentSession.map((league) => (
                <NavLink
                  key={league.id}
                  to={`/leagues/${league.id}`}
                  className={mobileNavItemClass}
                  onNavigate={handleNavigate}
                >
                  {league.name}
                </NavLink>
              ))}
            </>
          ) : null}
        </MobileNavAccordionItem>

        <MobileNavAccordionItem id="spares" label="Spares">
          {isSocialMember ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              Social memberships do not include sparing or spare requests.
            </p>
          ) : (
            <>
              <NavLink to="/availability" className={mobileNavItemClass} onNavigate={handleNavigate}>
                My availability
              </NavLink>
              <NavLink to="/my-requests" className={mobileNavItemClass} onNavigate={handleNavigate}>
                My requests
              </NavLink>
              <NavLink to="/request-spare" className={mobileNavItemClass} onNavigate={handleNavigate}>
                Request a spare
              </NavLink>
            </>
          )}
        </MobileNavAccordionItem>

        <MobileNavAccordionItem id="directory" label="Directory">
          <NavLink to="/members" className={mobileNavItemClass} onNavigate={handleNavigate}>
            Club membership
          </NavLink>
          <NavLink to="/governance" className={mobileNavItemClass} onNavigate={handleNavigate}>
            Club governance
          </NavLink>
        </MobileNavAccordionItem>

        <MobileNavAccordionItem id="calendar" label="Calendar">
          <NavLink to="/calendar" className={mobileNavItemClass} onNavigate={handleNavigate}>
            Full calendar
          </NavLink>
          {!isSocialMember && (
            <NavLink to="/book-ice" className={mobileNavItemClass} onNavigate={handleNavigate}>
              Book ice time
            </NavLink>
          )}
        </MobileNavAccordionItem>

        <MobileNavAccordionItem id="volunteering" label="Volunteering">
          <NavLink to="/volunteering" className={mobileNavItemClass} onNavigate={handleNavigate}>
            Volunteering hub
          </NavLink>
          <NavLink to="/volunteering?tab=shifts" className={mobileNavItemClass} onNavigate={handleNavigate}>
            My shifts
          </NavLink>
        </MobileNavAccordionItem>

        {hasAdminLinks && (
          <MobileNavAccordionItem id="admin" label="Admin">
            {adminLinks.map((link) => (
              <NavLink key={link.to} to={link.to} className={mobileNavItemClass} onNavigate={handleNavigate}>
                {link.label}
              </NavLink>
            ))}
          </MobileNavAccordionItem>
        )}

        {accountFooter}
      </>
    );

    return wrapAccordionGroup ? (
      <MobileNavAccordionGroup>{accordionContent}</MobileNavAccordionGroup>
    ) : (
      accordionContent
    );
  }

  if (!showMainNav) {
    return <div ref={panelRef}>{accountFooter}</div>;
  }

  return (
    <div ref={panelRef}>
      <FlyoutMenuList visible direction={resolvedDirection} className="space-y-0.5">
        <FlyoutMenuLeaf>
          <NavLink to="/dashboard" className={flyoutItemClass} onNavigate={handleNavigate}>
            Dashboard
          </NavLink>
        </FlyoutMenuLeaf>
        <FlyoutMenuItem
          id="leagues"
          label="Leagues"
          direction={resolvedDirection}
          triggerClassName={flyoutTriggerClass}
        >
          {leaguesItems}
        </FlyoutMenuItem>
        <FlyoutMenuItem
          id="spares"
          label="Spares"
          direction={resolvedDirection}
          triggerClassName={flyoutTriggerClass}
        >
          {sparesItems}
        </FlyoutMenuItem>
        <FlyoutMenuItem
          id="directory"
          label="Directory"
          direction={resolvedDirection}
          triggerClassName={flyoutTriggerClass}
        >
          {directoryItems}
        </FlyoutMenuItem>
        <FlyoutMenuItem
          id="calendar"
          label="Calendar"
          direction={resolvedDirection}
          triggerClassName={flyoutTriggerClass}
        >
          {calendarItems}
        </FlyoutMenuItem>
        <FlyoutMenuItem
          id="volunteering"
          label="Volunteering"
          direction={resolvedDirection}
          triggerClassName={flyoutTriggerClass}
        >
          {volunteeringItems}
        </FlyoutMenuItem>
        {hasAdminLinks && (
          <FlyoutMenuItem
            id="admin"
            label="Admin"
            direction={resolvedDirection}
            triggerClassName={flyoutTriggerClass}
          >
            {adminItems}
          </FlyoutMenuItem>
        )}
      </FlyoutMenuList>
      {accountFooter}
    </div>
  );
}
