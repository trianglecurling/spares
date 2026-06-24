import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  isAimingAtSubmenu,
  isPointInAimTriangle,
  pointInRect,
  type FlyoutDirection,
  type Point,
} from '../utils/flyoutAimGeometry';

/**
 * Desktop flyout menus with a "safe triangle" hover intent model.
 *
 * While a side-opening submenu is open, crossing a sibling row does not switch
 * the open item when the pointer is in the aim wedge. Leaving the list while
 * still inside that wedge keeps menus open until the pointer exits it.
 */

export const FLYOUT_LEAVE_DELAY_MS = 120;
/** Fallback close delay if the pointer is still in the aim wedge when a leave close fires. */
export const FLYOUT_AIM_LEAVE_DELAY_MS = 1000;
const AIM_TOLERANCE_PX = 8;

export type { FlyoutDirection };

export interface FlyoutListApi<TId extends string | number> {
  openId: TId | null;
  onItemEnter: (id: TId, e?: MouseEvent) => void;
  onItemFocus: (id: TId) => void;
  closeOpen: () => void;
  scheduleLeaveClose: () => void;
  /** Defer `onComplete` while the pointer is in the aim safe zone (for ancestor containers). */
  requestDeferredClose: (onComplete: () => void) => void;
  cancelLeaveClose: () => void;
  isPointerInOpenSubmenu: (target: EventTarget | null) => boolean;
  registerSubmenu: (id: TId, el: HTMLElement | null) => void;
  recordMove: (e: MouseEvent) => void;
  recordPoint: (x: number, y: number) => void;
}

export function useFlyoutList<TId extends string | number>(
  visible: boolean,
  direction: FlyoutDirection = 'right',
): FlyoutListApi<TId> {
  const [openId, setOpenId] = useState<TId | null>(null);
  const openIdRef = useRef<TId | null>(null);
  const submenusRef = useRef<Map<TId, HTMLElement>>(new Map());
  const prevRef = useRef<Point | null>(null);
  const lastRef = useRef<Point | null>(null);
  const aimApexRef = useRef<Point | null>(null);
  const pendingActivateIdRef = useRef<TId | null>(null);
  const pendingLeaveActionsRef = useRef<(() => void)[]>([]);
  const leaveTimerRef = useRef<number | null>(null);
  const aimLeaveListenerRef = useRef<((e: globalThis.MouseEvent) => void) | null>(null);
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const clearAimLeaveListener = useCallback(() => {
    if (aimLeaveListenerRef.current) {
      document.removeEventListener('mousemove', aimLeaveListenerRef.current);
      aimLeaveListenerRef.current = null;
    }
  }, []);

  const setOpen = useCallback((id: TId | null) => {
    openIdRef.current = id;
    setOpenId(id);
    if (id != null && lastRef.current) {
      aimApexRef.current = { ...lastRef.current };
    } else if (id == null) {
      aimApexRef.current = null;
    }
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current != null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    pendingActivateIdRef.current = null;
  }, []);

  const clearPendingLeaveActions = useCallback(() => {
    pendingLeaveActionsRef.current = [];
  }, []);

  useEffect(() => {
    if (!visible) {
      clearLeaveTimer();
      clearAimLeaveListener();
      clearPending();
      clearPendingLeaveActions();
      setOpen(null);
      prevRef.current = null;
      lastRef.current = null;
      aimApexRef.current = null;
    }
  }, [visible, clearAimLeaveListener, clearLeaveTimer, clearPending, clearPendingLeaveActions, setOpen]);

  useEffect(
    () => () => {
      clearLeaveTimer();
      clearAimLeaveListener();
    },
    [clearAimLeaveListener, clearLeaveTimer],
  );

  const recordPoint = useCallback((x: number, y: number) => {
    const last = lastRef.current;
    if (last) prevRef.current = last;
    lastRef.current = { x, y };
  }, []);

  const registerSubmenu = useCallback((id: TId, el: HTMLElement | null) => {
    if (el) submenusRef.current.set(id, el);
    else submenusRef.current.delete(id);
  }, []);

  const openSubmenuRect = useCallback((): DOMRect | null => {
    const current = openIdRef.current;
    if (current == null) return null;
    const submenu = submenusRef.current.get(current);
    if (!submenu) return null;
    const r = submenu.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return r;
  }, []);

  const isPointerInsideOpenSubmenu = useCallback((): boolean => {
    const loc = lastRef.current;
    const r = openSubmenuRect();
    if (loc == null || r == null) return false;
    return pointInRect(loc, r, AIM_TOLERANCE_PX);
  }, [openSubmenuRect]);

  const isPointerInsideAimTriangle = useCallback((): boolean => {
    const apex = aimApexRef.current;
    const loc = lastRef.current;
    const r = openSubmenuRect();
    if (apex == null || loc == null || r == null) return false;
    return isPointInAimTriangle(loc, apex, r, directionRef.current, AIM_TOLERANCE_PX);
  }, [openSubmenuRect]);

  const isAimingAtOpenSubmenu = useCallback((): boolean => {
    const prev = prevRef.current;
    const loc = lastRef.current;
    const r = openSubmenuRect();
    if (prev == null || loc == null || r == null) return false;
    return isAimingAtSubmenu(prev, loc, r, directionRef.current, AIM_TOLERANCE_PX);
  }, [openSubmenuRect]);

  const isInAimSafeZone = useCallback((): boolean => {
    return isPointerInsideOpenSubmenu() || isPointerInsideAimTriangle() || isAimingAtOpenSubmenu();
  }, [isAimingAtOpenSubmenu, isPointerInsideAimTriangle, isPointerInsideOpenSubmenu]);

  const runPendingLeaveActions = useCallback(() => {
    if (isInAimSafeZone()) {
      clearLeaveTimer();
      leaveTimerRef.current = window.setTimeout(() => {
        runPendingLeaveActions();
      }, FLYOUT_AIM_LEAVE_DELAY_MS);
      return;
    }
    const actions = pendingLeaveActionsRef.current;
    pendingLeaveActionsRef.current = [];
    for (const action of actions) action();
  }, [clearLeaveTimer, isInAimSafeZone]);

  const scheduleLeaveAfterDelay = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      runPendingLeaveActions();
    }, FLYOUT_LEAVE_DELAY_MS);
  }, [clearLeaveTimer, runPendingLeaveActions]);

  const ensureAimLeaveWatch = useCallback(() => {
    if (aimLeaveListenerRef.current) return;

    const onDocumentMove = (e: globalThis.MouseEvent) => {
      recordPoint(e.clientX, e.clientY);
      if (!isInAimSafeZone()) {
        clearAimLeaveListener();
        scheduleLeaveAfterDelay();
      }
    };

    aimLeaveListenerRef.current = onDocumentMove;
    document.addEventListener('mousemove', onDocumentMove);
  }, [clearAimLeaveListener, isInAimSafeZone, recordPoint, scheduleLeaveAfterDelay]);

  const requestDeferredClose = useCallback(
    (onComplete: () => void) => {
      pendingLeaveActionsRef.current.push(onComplete);

      if (isInAimSafeZone()) {
        clearLeaveTimer();
        ensureAimLeaveWatch();
        return;
      }

      if (leaveTimerRef.current == null && aimLeaveListenerRef.current == null) {
        scheduleLeaveAfterDelay();
      }
    },
    [clearLeaveTimer, ensureAimLeaveWatch, isInAimSafeZone, scheduleLeaveAfterDelay],
  );

  const activatePendingIfReady = useCallback(() => {
    const pending = pendingActivateIdRef.current;
    if (pending == null || openIdRef.current === pending) return;

    if (isPointerInsideOpenSubmenu()) {
      clearPending();
      return;
    }

    if (!isAimingAtOpenSubmenu() && !isPointerInsideAimTriangle()) {
      clearPending();
      setOpen(pending);
    }
  }, [
    clearPending,
    isAimingAtOpenSubmenu,
    isPointerInsideAimTriangle,
    isPointerInsideOpenSubmenu,
    setOpen,
  ]);

  const possiblyActivate = useCallback(
    (id: TId) => {
      const current = openIdRef.current;
      if (current != null && current !== id) {
        if (isPointerInsideOpenSubmenu()) {
          clearPending();
          return;
        }
        if (isAimingAtOpenSubmenu() || isPointerInsideAimTriangle()) {
          pendingActivateIdRef.current = id;
          return;
        }
      }
      clearPending();
      setOpen(id);
    },
    [
      clearPending,
      isAimingAtOpenSubmenu,
      isPointerInsideAimTriangle,
      isPointerInsideOpenSubmenu,
      setOpen,
    ],
  );

  const recordMove = useCallback(
    (e: MouseEvent) => {
      recordPoint(e.clientX, e.clientY);
      if (isInAimSafeZone()) {
        clearLeaveTimer();
        clearAimLeaveListener();
      }
      if (isPointerInsideOpenSubmenu()) {
        clearPending();
        return;
      }
      activatePendingIfReady();
    },
    [
      activatePendingIfReady,
      clearAimLeaveListener,
      clearLeaveTimer,
      clearPending,
      isInAimSafeZone,
      isPointerInsideOpenSubmenu,
      recordPoint,
    ],
  );

  const onItemEnter = useCallback(
    (id: TId, e?: MouseEvent) => {
      clearLeaveTimer();
      clearAimLeaveListener();
      if (e) recordPoint(e.clientX, e.clientY);
      possiblyActivate(id);
    },
    [clearAimLeaveListener, clearLeaveTimer, possiblyActivate, recordPoint],
  );

  const onItemFocus = useCallback(
    (id: TId) => {
      clearLeaveTimer();
      clearAimLeaveListener();
      clearPending();
      setOpen(id);
    },
    [clearAimLeaveListener, clearLeaveTimer, clearPending, setOpen],
  );

  const closeOpen = useCallback(() => {
    clearLeaveTimer();
    clearAimLeaveListener();
    clearPending();
    clearPendingLeaveActions();
    setOpen(null);
  }, [clearAimLeaveListener, clearLeaveTimer, clearPending, clearPendingLeaveActions, setOpen]);

  const scheduleLeaveClose = useCallback(() => {
    requestDeferredClose(() => {
      clearPending();
      setOpen(null);
    });
  }, [clearPending, requestDeferredClose, setOpen]);

  const cancelLeaveClose = useCallback(() => {
    clearLeaveTimer();
    clearAimLeaveListener();
    clearPendingLeaveActions();
  }, [clearAimLeaveListener, clearLeaveTimer, clearPendingLeaveActions]);

  const isPointerInOpenSubmenu = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    const current = openIdRef.current;
    if (current == null) return false;
    const submenu = submenusRef.current.get(current);
    return submenu ? submenu.contains(target) : false;
  }, []);

  return useMemo(
    () => ({
      openId,
      onItemEnter,
      onItemFocus,
      closeOpen,
      scheduleLeaveClose,
      requestDeferredClose,
      cancelLeaveClose,
      isPointerInOpenSubmenu,
      registerSubmenu,
      recordMove,
      recordPoint,
    }),
    [
      openId,
      onItemEnter,
      onItemFocus,
      closeOpen,
      scheduleLeaveClose,
      requestDeferredClose,
      cancelLeaveClose,
      isPointerInOpenSubmenu,
      registerSubmenu,
      recordMove,
      recordPoint,
    ],
  );
}
