import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFlyoutList, type FlyoutListApi } from '../hooks/useFlyoutList';

export interface NavMenuItemNode {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: NavMenuItemNode[];
}

export interface DesktopFlyoutNavClasses {
  navLink: string;
  dropdownItem: string;
  dropdownPanel: string;
  submenuPanel: string;
}

export const publicFlyoutNavClasses: DesktopFlyoutNavClasses = {
  navLink:
    'inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40',
  dropdownItem:
    'block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40',
  dropdownPanel:
    'absolute left-0 top-full z-50 min-w-[13rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg transition-opacity duration-150 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800',
  submenuPanel:
    'absolute left-full top-0 z-50 min-w-[12rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg transition-opacity duration-150 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800',
};

const TOP_CLOSE_DELAY_MS = 120;
const flyoutBridgeClass =
  'pointer-events-auto absolute top-0 bottom-0 z-40 w-[12rem] max-w-[50vw]';

function linkForItem(item: NavMenuItemNode): { kind: 'internal' | 'external' | 'none'; href: string | null } {
  if (item.linkType === 'internal' && item.url) return { kind: 'internal', href: item.url };
  if (item.linkType === 'external' && item.url) return { kind: 'external', href: item.url };
  return { kind: 'none', href: null };
}

function externalTargetProps(item: NavMenuItemNode): { target?: '_blank'; rel?: 'noopener noreferrer' } {
  return item.openInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

const FlyoutList = forwardRef<
  HTMLUListElement,
  {
    items: NavMenuItemNode[];
    visible: boolean;
    className: string;
    classes: DesktopFlyoutNavClasses;
    onFlyoutApi?: (api: FlyoutListApi<number> | null) => void;
    onPointerActivity?: (e: React.MouseEvent) => void;
  }
>(function FlyoutList(
  { items, visible, className, classes, onFlyoutApi, onPointerActivity },
  ref,
) {
  const list = useFlyoutList<number>(visible, 'right');

  useEffect(() => {
    onFlyoutApi?.(list);
    return () => onFlyoutApi?.(null);
  }, [list, onFlyoutApi]);

  const handleMouseEnter = useCallback(() => {
    list.cancelLeaveClose();
  }, [list]);

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLUListElement>) => {
      const next = e.relatedTarget;
      if (next instanceof Node && e.currentTarget.contains(next)) return;
      if (list.isPointerInOpenSubmenu(next)) return;
      list.recordPoint(e.clientX, e.clientY);
      list.scheduleLeaveClose();
    },
    [list],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLUListElement>) => {
      list.recordMove(e);
      onPointerActivity?.(e);
    },
    [list, onPointerActivity],
  );

  return (
    <ul
      ref={ref}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {items.map((child) => (
        <FlyoutItem key={child.id} item={child} list={list} classes={classes} />
      ))}
    </ul>
  );
});

function FlyoutItem({
  item,
  list,
  classes,
}: {
  item: NavMenuItemNode;
  list: FlyoutListApi<number>;
  classes: DesktopFlyoutNavClasses;
}) {
  const hasChildren = item.children.length > 0;
  const link = linkForItem(item);
  const isOpen = list.openId === item.id;
  const submenuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!hasChildren) return;
    list.registerSubmenu(item.id, submenuRef.current);
    return () => list.registerSubmenu(item.id, null);
  }, [hasChildren, item.id, isOpen, list]);

  const rowHandlers = hasChildren
    ? {
        onMouseEnter: (e: React.MouseEvent) => list.onItemEnter(item.id, e),
        onFocus: () => list.onItemFocus(item.id),
      }
    : {
        onMouseEnter: (e: React.MouseEvent) => {
          list.recordMove(e);
          list.closeOpen();
        },
        onFocus: () => list.closeOpen(),
      };

  if (!hasChildren) {
    const itemClass =
      link.kind === 'none'
        ? `${classes.dropdownItem} text-gray-500 dark:text-gray-400`
        : classes.dropdownItem;
    return (
      <li className="list-none" {...rowHandlers}>
        {link.kind === 'external' && link.href ? (
          <a href={link.href} className={itemClass} {...externalTargetProps(item)}>
            {item.label}
          </a>
        ) : link.kind === 'internal' && link.href ? (
          <Link to={link.href} className={itemClass}>
            {item.label}
          </Link>
        ) : (
          <span className={itemClass}>{item.label}</span>
        )}
      </li>
    );
  }

  const childTrigger = `${classes.dropdownItem} flex items-center justify-between gap-2`;
  const submenuVisibility = isOpen ? 'visible opacity-100' : 'invisible opacity-0';

  return (
    <li className="relative list-none" {...rowHandlers}>
      {link.kind === 'external' && link.href ? (
        <a
          href={link.href}
          className={childTrigger}
          aria-haspopup="true"
          aria-expanded={isOpen}
          {...externalTargetProps(item)}
        >
          {item.label}
          <span aria-hidden>›</span>
        </a>
      ) : link.kind === 'internal' && link.href ? (
        <Link to={link.href} className={childTrigger} aria-haspopup="true" aria-expanded={isOpen}>
          {item.label}
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <button
          type="button"
          className={`${childTrigger} w-full text-left`}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          {item.label}
          <span aria-hidden>›</span>
        </button>
      )}
      {isOpen ? <span aria-hidden className={`${flyoutBridgeClass} left-full`} /> : null}
      <FlyoutList
        ref={submenuRef}
        items={item.children}
        visible={isOpen}
        classes={classes}
        onPointerActivity={list.recordMove}
        className={`${classes.submenuPanel} ${submenuVisibility}`}
      />
    </li>
  );
}

function DesktopNavItem({
  item,
  open,
  navLinkClass,
  classes,
  onOpen,
  onScheduleClose,
  onCloseNow,
}: {
  item: NavMenuItemNode;
  open: boolean;
  navLinkClass: string;
  classes: DesktopFlyoutNavClasses;
  onOpen: () => void;
  onScheduleClose: () => void;
  onCloseNow: () => void;
}) {
  const hasChildren = item.children.length > 0;
  const link = linkForItem(item);

  if (!hasChildren) {
    if (link.kind === 'external' && link.href) {
      return (
        <a
          href={link.href}
          className={navLinkClass}
          onMouseEnter={onOpen}
          onFocus={onCloseNow}
          {...externalTargetProps(item)}
        >
          {item.label}
        </a>
      );
    }
    if (link.kind === 'internal' && link.href) {
      return (
        <Link to={link.href} className={navLinkClass} onMouseEnter={onOpen} onFocus={onCloseNow}>
          {item.label}
        </Link>
      );
    }
    return (
      <span className={`${navLinkClass} cursor-default`} onMouseEnter={onOpen}>
        {item.label}
      </span>
    );
  }

  const handleBlur = (e: React.FocusEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCloseNow();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCloseNow();
  };
  const visibility = open ? 'visible opacity-100' : 'invisible opacity-0';
  const flyoutApiRef = useRef<FlyoutListApi<number> | null>(null);

  const handleMouseEnter = useCallback(() => {
    flyoutApiRef.current?.cancelLeaveClose();
    onOpen();
  }, [onOpen]);

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLLIElement>) => {
      const next = e.relatedTarget;
      if (next instanceof Node && e.currentTarget.contains(next)) return;
      const api = flyoutApiRef.current;
      if (api) {
        api.recordPoint(e.clientX, e.clientY);
        api.requestDeferredClose(onScheduleClose);
        return;
      }
      onScheduleClose();
    },
    [onScheduleClose],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLLIElement>) => {
    flyoutApiRef.current?.recordMove(e);
  }, []);

  const handleFlyoutApi = useCallback((api: FlyoutListApi<number> | null) => {
    flyoutApiRef.current = api;
  }, []);

  return (
    <li
      className="relative list-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onFocus={onOpen}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {link.kind === 'external' && link.href ? (
        <a
          href={link.href}
          className={navLinkClass}
          aria-haspopup="true"
          aria-expanded={open}
          {...externalTargetProps(item)}
        >
          {item.label}
        </a>
      ) : link.kind === 'internal' && link.href ? (
        <Link to={link.href} className={navLinkClass} aria-haspopup="true" aria-expanded={open}>
          {item.label}
        </Link>
      ) : (
        <button type="button" className={navLinkClass} aria-haspopup="true" aria-expanded={open}>
          {item.label}
        </button>
      )}
      <FlyoutList
        items={item.children}
        visible={open}
        classes={classes}
        onFlyoutApi={handleFlyoutApi}
        className={`${classes.dropdownPanel} ${visibility}`}
      />
    </li>
  );
}

export function DesktopMenuBar({
  items,
  classes = publicFlyoutNavClasses,
  getNavLinkClass,
  onHoverMenuDisplayed,
}: {
  items: NavMenuItemNode[];
  classes?: DesktopFlyoutNavClasses;
  getNavLinkClass?: (item: NavMenuItemNode) => string;
  onHoverMenuDisplayed?: () => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const openTop = useCallback(
    (id: number) => {
      clearCloseTimer();
      const item = items.find((entry) => entry.id === id);
      if (item && item.children.length > 0) {
        onHoverMenuDisplayed?.();
      }
      setOpenId(id);
    },
    [clearCloseTimer, items, onHoverMenuDisplayed],
  );
  const closeTopNow = useCallback(() => {
    clearCloseTimer();
    setOpenId(null);
  }, [clearCloseTimer]);
  const scheduleCloseTop = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpenId(null), TOP_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const resolveNavLinkClass = getNavLinkClass ?? (() => classes.navLink);

  return (
    <>
      {items.map((item) => (
        <DesktopNavItem
          key={item.id}
          item={item}
          open={openId === item.id}
          navLinkClass={resolveNavLinkClass(item)}
          classes={classes}
          onOpen={() => openTop(item.id)}
          onScheduleClose={scheduleCloseTop}
          onCloseNow={closeTopNow}
        />
      ))}
    </>
  );
}

export function MobileMenuItem({
  item,
  level = 0,
  onNavigate,
}: {
  item: NavMenuItemNode;
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
          <span
            className="flex-1 rounded-md px-3 py-2 text-sm text-gray-700"
            style={{ paddingLeft: `${0.75 + level * 0.8}rem` }}
          >
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
