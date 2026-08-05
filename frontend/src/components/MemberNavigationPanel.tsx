import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { NavMenuItemNode } from './DesktopFlyoutNav';
import { linkForItem, MobileMenuItem } from './DesktopFlyoutNav';
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

function MemberFlyoutNavNode({
  item,
  direction,
  onNavigate,
}: {
  item: NavMenuItemNode;
  direction: 'left' | 'right';
  onNavigate: () => void;
}) {
  const link = linkForItem(item);
  const itemClass = [flyoutItemClass, item.labelClassName].filter(Boolean).join(' ');

  if (item.children.length > 0) {
    return (
      <FlyoutMenuItem
        id={`nav-${item.id}`}
        label={item.label}
        direction={direction}
        triggerClassName={flyoutTriggerClass}
      >
        {item.children.map((child) => {
          const childLink = linkForItem(child);
          const childClass = [flyoutItemClass, child.labelClassName].filter(Boolean).join(' ');
          if (childLink.kind === 'none') {
            return (
              <li key={child.id} className="list-none">
                <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{child.label}</p>
              </li>
            );
          }
          if (childLink.kind === 'external' && childLink.href) {
            return (
              <li key={child.id} className="list-none">
                <a
                  href={childLink.href}
                  className={childClass}
                  onClick={onNavigate}
                  {...(child.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {child.label}
                </a>
              </li>
            );
          }
          return (
            <li key={child.id} className="list-none">
              <Link to={childLink.href!} className={childClass} onClick={onNavigate}>
                {child.label}
              </Link>
            </li>
          );
        })}
      </FlyoutMenuItem>
    );
  }

  if (link.kind === 'none') {
    return (
      <FlyoutMenuLeaf>
        <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
      </FlyoutMenuLeaf>
    );
  }

  if (link.kind === 'external' && link.href) {
    return (
      <FlyoutMenuLeaf>
        <a
          href={link.href}
          className={itemClass}
          onClick={onNavigate}
          {...(item.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {item.label}
        </a>
      </FlyoutMenuLeaf>
    );
  }

  return (
    <FlyoutMenuLeaf>
      <Link to={link.href!} className={itemClass} onClick={onNavigate}>
        {item.label}
      </Link>
    </FlyoutMenuLeaf>
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
  const { memberNavItems, isNavigationReady } = useMemberNavigation();

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

  const accountFooter = showAccountFooter ? (
    <div className={showMainNav ? 'border-t border-gray-200 pt-2 dark:border-gray-700' : undefined}>
      {variant === 'flyout' ? (
        <FlyoutMenuList visible direction={resolvedDirection} className="space-y-0.5">
          <FlyoutMenuLeaf>
            <Link to="/profile" className={flyoutItemClass} onClick={handleNavigate}>
              My profile
            </Link>
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
          <Link to="/profile" className={mobileNavItemClass} onClick={handleNavigate}>
            My profile
          </Link>
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
        {memberNavItems.map((item) => (
          <MobileMenuItem key={item.id} item={item} onNavigate={handleNavigate} />
        ))}
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
        {memberNavItems.map((item) => (
          <MemberFlyoutNavNode
            key={item.id}
            item={item}
            direction={resolvedDirection}
            onNavigate={handleNavigate}
          />
        ))}
      </FlyoutMenuList>
      {accountFooter}
    </div>
  );
}
