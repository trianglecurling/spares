import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useFlyoutList, type FlyoutDirection, type FlyoutListApi } from '../hooks/useFlyoutList';

/** Flush with the parent row — gaps break pointer paths toward side-opening submenus. */
export function flyoutPanelPositionClass(direction: FlyoutDirection): string {
  return direction === 'left' ? 'right-full' : 'left-full';
}

const FlyoutListContext = createContext<FlyoutListApi<string | number> | null>(null);

export function useFlyoutMenuList(): FlyoutListApi<string> {
  const ctx = useContext(FlyoutListContext);
  if (!ctx) {
    throw new Error('useFlyoutMenuList must be used within FlyoutMenuList');
  }
  return ctx as FlyoutListApi<string>;
}

interface FlyoutMenuListProps {
  visible: boolean;
  direction?: FlyoutDirection;
  className?: string;
  children: ReactNode;
}

export function FlyoutMenuList({
  visible,
  direction = 'right',
  className,
  children,
}: FlyoutMenuListProps) {
  const list = useFlyoutList<string | number>(visible, direction);

  const handleMouseEnter = useCallback(() => {
    list.cancelLeaveClose();
  }, [list]);

  const handleMouseLeave = useCallback(
    (e: MouseEvent<HTMLUListElement>) => {
      const next = e.relatedTarget;
      if (next instanceof Node && e.currentTarget.contains(next)) return;
      if (list.isPointerInOpenSubmenu(next)) return;
      list.scheduleLeaveClose();
    },
    [list],
  );

  return (
    <FlyoutListContext.Provider value={list}>
      <ul
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseMove={list.recordMove}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </ul>
    </FlyoutListContext.Provider>
  );
}

interface FlyoutMenuLeafProps {
  className?: string;
  children: ReactNode;
}

/** Row with no submenu — closes any open sibling flyout on hover. */
export function FlyoutMenuLeaf({ className = 'list-none', children }: FlyoutMenuLeafProps) {
  const list = useFlyoutMenuList();

  return (
    <li
      className={className}
      onMouseEnter={(e) => {
        list.recordMove(e);
        list.closeOpen();
      }}
    >
      {children}
    </li>
  );
}

const flyoutPanelBaseClass =
  'absolute top-0 z-50 min-w-[12rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg transition-opacity duration-150 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800';

/** Keeps pointer inside the row while crossing the DOM gap to a side submenu (not the aim wedge). */
const flyoutBridgeClass =
  'pointer-events-auto absolute top-0 bottom-0 z-40 w-[12rem] max-w-[50vw]';

interface FlyoutMenuItemProps {
  id: string;
  label: string;
  direction: FlyoutDirection;
  triggerClassName: string;
  children: ReactNode;
}

export function FlyoutMenuItem({
  id,
  label,
  direction,
  triggerClassName,
  children,
}: FlyoutMenuItemProps) {
  const list = useFlyoutMenuList();
  const isOpen = list.openId === id;
  const submenuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    list.registerSubmenu(id, submenuRef.current);
    return () => list.registerSubmenu(id, null);
  }, [id, list, isOpen]);

  const submenuVisibility = isOpen ? 'visible opacity-100' : 'invisible opacity-0';
  const bridgePositionClass = direction === 'left' ? 'right-full' : 'left-full';

  return (
    <li
      className="relative list-none"
      onMouseEnter={(e) => list.onItemEnter(id, e)}
      onFocus={() => list.onItemFocus(id)}
    >
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {label}
        <span aria-hidden>›</span>
      </button>
      {isOpen ? (
        <span aria-hidden className={`${flyoutBridgeClass} ${bridgePositionClass}`} />
      ) : null}
      <ul
        ref={submenuRef}
        className={`${flyoutPanelBaseClass} ${flyoutPanelPositionClass(direction)} ${submenuVisibility}`}
      >
        {children}
      </ul>
    </li>
  );
}
