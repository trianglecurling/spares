import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Below this distance (px) from pointer down to up, a tap (not a pan) — background clear or bracket card select. */
export const BRACKET_CANVAS_TAP_MOVE_THRESHOLD_PX = 8;

export const BRACKET_CANVAS_MIN_ZOOM = 0.25;
export const BRACKET_CANVAS_MAX_ZOOM = 4;

export type BracketCanvasPoint = { x: number; y: number };

export type BracketShortPressHit =
  | { type: 'game'; gameId: string }
  | { type: 'virtualFeeder'; sourceGameId: string }
  | { type: 'text'; textNodeId: string };

export type UseBracketCanvasViewOptions = {
  /** When false, wheel and pan handlers are not attached. */
  enabled: boolean;
  /** Admin: clear selection when the user taps the canvas background without panning. */
  onCanvasBackgroundTap?: () => void;
  /** Admin: short press on a game card, virtual feeder, or text note (after pan layer captures the pointer). */
  onBracketShortPress?: (hit: BracketShortPressHit) => void;
  /**
   * When this value changes, wheel listeners are rebound (e.g. `layout.width` once the canvas shell mounts).
   * Fixes missed attachment when `enabled` was already true before the ref node existed.
   */
  attachToken?: unknown;
};

export function clampBracketCanvasZoom(z: number): number {
  return Math.min(BRACKET_CANVAS_MAX_ZOOM, Math.max(BRACKET_CANVAS_MIN_ZOOM, z));
}

/** Map a shell-local point through pan/zoom to content coordinates. */
export function bracketContentPointFromShell(args: {
  shellX: number;
  shellY: number;
  panX: number;
  panY: number;
  zoom: number;
}): BracketCanvasPoint {
  return {
    x: (args.shellX - args.panX) / args.zoom,
    y: (args.shellY - args.panY) / args.zoom,
  };
}

/** Pan that keeps a content point under a shell-local point at the given zoom. */
export function bracketPanForContentPoint(args: {
  shellX: number;
  shellY: number;
  contentX: number;
  contentY: number;
  zoom: number;
}): BracketCanvasPoint {
  return {
    x: args.shellX - args.contentX * args.zoom,
    y: args.shellY - args.contentY * args.zoom,
  };
}

export function bracketPinchZoomFromDistance(
  startZoom: number,
  startDist: number,
  currentDist: number,
): number {
  return clampBracketCanvasZoom(startZoom * (currentDist / Math.max(startDist, 1)));
}

function pointerDistance(a: BracketCanvasPoint, b: BracketCanvasPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a: BracketCanvasPoint, b: BracketCanvasPoint): BracketCanvasPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointsFromTouchList(touches: TouchList): BracketCanvasPoint[] {
  const pts: BracketCanvasPoint[] = [];
  for (let i = 0; i < touches.length; i++) {
    const t = touches.item(i);
    if (t) pts.push({ x: t.clientX, y: t.clientY });
  }
  return pts;
}

type PinchSession = {
  startDist: number;
  startZoom: number;
  contentX: number;
  contentY: number;
};

/**
 * Local pan/zoom for tournament bracket canvases. Does not read or write `draw.canvas`.
 */
export function useBracketCanvasView({
  enabled,
  onCanvasBackgroundTap,
  onBracketShortPress,
  attachToken,
}: UseBracketCanvasViewOptions) {
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const shortPressOriginRef = useRef<Element | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const baselinePanRef = useRef({ x: 0, y: 0 });

  const [committedPan, setCommittedPan] = useState({ x: 0, y: 0 });
  const committedPanRef = useRef(committedPan);
  committedPanRef.current = committedPan;

  const [panLive, setPanLive] = useState<{ x: number; y: number } | null>(null);
  const panLiveRef = useRef<{ x: number; y: number } | null>(null);
  const panDragRef = useRef<null | { sx: number; sy: number; ox: number; oy: number }>(null);
  const detachPanWindowListenersRef = useRef<(() => void) | null>(null);
  const pointerCaptureElRef = useRef<HTMLElement | null>(null);
  const activePanPointerIdRef = useRef<number | null>(null);
  const pointersRef = useRef(new Map<number, BracketCanvasPoint>());
  const pinchRef = useRef<PinchSession | null>(null);
  const didPinchRef = useRef(false);
  const finishSessionRef = useRef<(allowShortPress: boolean) => void>(() => {});

  const startPinchFromPointsRef = useRef<(a: BracketCanvasPoint, b: BracketCanvasPoint) => void>(
    () => {},
  );
  const updatePinchFromPointsRef = useRef<(a: BracketCanvasPoint, b: BracketCanvasPoint) => void>(
    () => {},
  );

  startPinchFromPointsRef.current = (a, b) => {
    const shell = canvasShellRef.current;
    if (!shell) return;
    didPinchRef.current = true;
    const pan = panLiveRef.current ?? committedPanRef.current;
    panDragRef.current = null;
    committedPanRef.current = pan;
    panLiveRef.current = pan;
    const rect = shell.getBoundingClientRect();
    const centroid = pointerMidpoint(a, b);
    const z = zoomRef.current;
    const content = bracketContentPointFromShell({
      shellX: centroid.x - rect.left,
      shellY: centroid.y - rect.top,
      panX: pan.x,
      panY: pan.y,
      zoom: z,
    });
    pinchRef.current = {
      startDist: Math.max(pointerDistance(a, b), 1),
      startZoom: z,
      contentX: content.x,
      contentY: content.y,
    };
    setCommittedPan(pan);
    setPanLive(pan);
  };

  updatePinchFromPointsRef.current = (a, b) => {
    const shell = canvasShellRef.current;
    if (!shell) return;
    if (!pinchRef.current) {
      startPinchFromPointsRef.current(a, b);
    }
    const pinch = pinchRef.current;
    if (!pinch) return;
    const rect = shell.getBoundingClientRect();
    const centroid = pointerMidpoint(a, b);
    const z = bracketPinchZoomFromDistance(pinch.startZoom, pinch.startDist, pointerDistance(a, b));
    const nextPan = bracketPanForContentPoint({
      shellX: centroid.x - rect.left,
      shellY: centroid.y - rect.top,
      contentX: pinch.contentX,
      contentY: pinch.contentY,
      zoom: z,
    });
    zoomRef.current = z;
    committedPanRef.current = nextPan;
    panLiveRef.current = nextPan;
    setZoom(z);
    setCommittedPan(nextPan);
    setPanLive(nextPan);
  };

  const commitPan = useCallback(() => {
    if (!panDragRef.current) {
      panLiveRef.current = null;
      setPanLive(null);
      return;
    }
    panDragRef.current = null;
    const live = panLiveRef.current;
    if (live) {
      committedPanRef.current = { x: live.x, y: live.y };
      setCommittedPan({ x: live.x, y: live.y });
    }
    panLiveRef.current = null;
    setPanLive(null);
  }, []);

  const setBaselinePan = useCallback((p: { x: number; y: number }) => {
    baselinePanRef.current = { x: p.x, y: p.y };
  }, []);

  const snapPanToBaseline = useCallback(() => {
    commitPan();
    const b = baselinePanRef.current;
    committedPanRef.current = { x: b.x, y: b.y };
    setCommittedPan({ x: b.x, y: b.y });
    panLiveRef.current = null;
    setPanLive(null);
  }, [commitPan]);

  const resetView = useCallback(() => {
    commitPan();
    pinchRef.current = null;
    const b = baselinePanRef.current;
    committedPanRef.current = { x: b.x, y: b.y };
    setCommittedPan({ x: b.x, y: b.y });
    zoomRef.current = 1;
    setZoom(1);
    setPanLive(null);
    panLiveRef.current = null;
  }, [commitPan]);

  useEffect(() => {
    return () => {
      detachPanWindowListenersRef.current?.();
      detachPanWindowListenersRef.current = null;
      commitPan();
    };
  }, [commitPan]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = canvasShellRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return;

      const et = e.target;
      if (et instanceof Element) {
        const note = et.closest('[data-text-node]');
        if (note) {
          const scrollable = note.querySelector('.overflow-auto');
          if (scrollable instanceof HTMLElement && scrollable.contains(et)) {
            const dy = e.deltaY;
            const st = scrollable.scrollTop;
            const ch = scrollable.clientHeight;
            const sh = scrollable.scrollHeight;
            if (sh > ch + 1) {
              const atBottom = st >= sh - ch - 1;
              const atTop = st <= 0;
              if ((dy > 0 && !atBottom) || (dy < 0 && !atTop)) {
                return;
              }
            }
          }
        }
      }

      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const oldZ = zoomRef.current;
      const z = clampBracketCanvasZoom(oldZ + delta);
      if (z === oldZ) return;

      const effPx = panLiveRef.current?.x ?? committedPanRef.current.x;
      const effPy = panLiveRef.current?.y ?? committedPanRef.current.y;
      const content = bracketContentPointFromShell({
        shellX: e.clientX - rect.left,
        shellY: e.clientY - rect.top,
        panX: effPx,
        panY: effPy,
        zoom: oldZ,
      });
      const nextPan = bracketPanForContentPoint({
        shellX: e.clientX - rect.left,
        shellY: e.clientY - rect.top,
        contentX: content.x,
        contentY: content.y,
        zoom: z,
      });

      const drag = panDragRef.current;
      if (drag) {
        // Keep sx/sy as the pointer-drag origin. Wheel's clientX/Y is not the same gesture and
        // overwriting them makes pan deltas ~0 (e.g. trackpad or touch generating wheel during drag).
        panDragRef.current = {
          ...drag,
          ox: nextPan.x,
          oy: nextPan.y,
        };
        panLiveRef.current = nextPan;
        setPanLive(nextPan);
      }

      committedPanRef.current = nextPan;
      zoomRef.current = z;
      setCommittedPan(nextPan);
      setZoom(z);
    };

    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [enabled, attachToken]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = canvasShellRef.current;
    if (!el) return;

    const applyTwoTouchPinch = (touches: TouchList) => {
      const pts = pointsFromTouchList(touches);
      if (pts.length < 2) return;
      updatePinchFromPointsRef.current(pts[0]!, pts[1]!);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      const pts = pointsFromTouchList(e.touches);
      if (pts.length < 2) return;
      startPinchFromPointsRef.current(pts[0]!, pts[1]!);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      applyTwoTouchPinch(e.touches);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const pts = pointsFromTouchList(e.touches);
        if (pts.length >= 2) startPinchFromPointsRef.current(pts[0]!, pts[1]!);
        return;
      }
      if (e.touches.length === 1) {
        if (!pinchRef.current) return;
        pinchRef.current = null;
        panDragRef.current = null;
        const pan = panLiveRef.current ?? committedPanRef.current;
        committedPanRef.current = pan;
        panLiveRef.current = pan;
        setCommittedPan(pan);
        setPanLive(pan);
        return;
      }
      pinchRef.current = null;
      if (pointersRef.current.size === 0) {
        finishSessionRef.current(false);
      }
    };

    const preventNativeGestureZoom = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    // Safari still page-zooms on some versions unless gesture events are canceled.
    el.addEventListener('gesturestart', preventNativeGestureZoom);
    el.addEventListener('gesturechange', preventNativeGestureZoom);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('gesturestart', preventNativeGestureZoom);
      el.removeEventListener('gesturechange', preventNativeGestureZoom);
    };
  }, [enabled, attachToken]);

  const beginCanvasPan = useCallback(
    (e: React.PointerEvent) => {
      if (e.defaultPrevented) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const sessionActive = detachPanWindowListenersRef.current != null;
      if (sessionActive) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointersRef.current.size >= 2) {
          const pts = [...pointersRef.current.values()];
          startPinchFromPointsRef.current(pts[0]!, pts[1]!);
          if (e.cancelable) e.preventDefault();
        }
        return;
      }

      const t = e.target;
      shortPressOriginRef.current =
        t instanceof Element ? t : t instanceof Node ? t.parentElement : null;

      if (panDragRef.current) commitPan();
      detachPanWindowListenersRef.current?.();
      detachPanWindowListenersRef.current = null;

      pointersRef.current.clear();
      pinchRef.current = null;
      didPinchRef.current = false;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pointerId = e.pointerId;
      const captureTarget = e.currentTarget as HTMLElement;
      activePanPointerIdRef.current = pointerId;
      pointerCaptureElRef.current = captureTarget;
      // Capturing a touch pointer can prevent iOS from delivering a second finger.
      if (e.pointerType === 'mouse') {
        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          /* already captured or unsupported */
        }
      }

      const ox = panLiveRef.current?.x ?? committedPanRef.current.x;
      const oy = panLiveRef.current?.y ?? committedPanRef.current.y;
      panDragRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        ox,
        oy,
      };
      const start = { x: ox, y: oy };
      panLiveRef.current = start;
      setPanLive(start);

      let sessionFinished = false;

      const releaseCapture = () => {
        const capEl = pointerCaptureElRef.current;
        if (capEl != null && activePanPointerIdRef.current != null) {
          try {
            if (capEl.hasPointerCapture(activePanPointerIdRef.current)) {
              capEl.releasePointerCapture(activePanPointerIdRef.current);
            }
          } catch {
            /* ignore */
          }
        }
        pointerCaptureElRef.current = null;
        activePanPointerIdRef.current = null;
      };

      const finishSession = (allowShortPress: boolean) => {
        if (sessionFinished) return;
        sessionFinished = true;
        releaseCapture();
        pointersRef.current.clear();
        pinchRef.current = null;
        finishSessionRef.current = () => {};
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        captureTarget.removeEventListener('lostpointercapture', onLostCapture);
        detachPanWindowListenersRef.current = null;
        commitPan();
        const origin = shortPressOriginRef.current;
        shortPressOriginRef.current = null;
        if (!allowShortPress) return;

        if (origin instanceof Element && onBracketShortPress) {
          const gameCard = origin.closest('[data-draw-game-card]');
          if (gameCard) {
            const id = gameCard.getAttribute('data-game-node-id');
            if (id) {
              onBracketShortPress({ type: 'game', gameId: id });
              return;
            }
          }
          const vf = origin.closest('[data-virtual-feeder-card]');
          if (vf) {
            const sid = vf.getAttribute('data-virtual-feeder-source-game-id');
            if (sid) {
              onBracketShortPress({ type: 'virtualFeeder', sourceGameId: sid });
              return;
            }
          }
          const tn = origin.closest('[data-text-node]');
          if (tn) {
            const tid = tn.getAttribute('data-text-node-id');
            if (tid) {
              onBracketShortPress({ type: 'text', textNodeId: tid });
              return;
            }
          }
        }
        onCanvasBackgroundTap?.();
      };

      finishSessionRef.current = finishSession;

      const onMove = (ev: PointerEvent) => {
        if (pointersRef.current.has(ev.pointerId)) {
          pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        } else if (pinchRef.current || pointersRef.current.size >= 2) {
          pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        } else if (pointersRef.current.size === 0 && ev.buttons !== 0) {
          // iOS may not pointerdown the second finger; adopt the remaining contact after pinch.
          pointersRef.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        } else {
          return;
        }

        if (pinchRef.current || pointersRef.current.size >= 2) {
          if (ev.cancelable) ev.preventDefault();
          const pts = [...pointersRef.current.values()];
          if (pts.length >= 2) {
            updatePinchFromPointsRef.current(pts[0]!, pts[1]!);
          }
          return;
        }

        if (ev.cancelable) ev.preventDefault();
        let drag = panDragRef.current;
        if (!drag) {
          const pan = panLiveRef.current ?? committedPanRef.current;
          drag = {
            sx: ev.clientX,
            sy: ev.clientY,
            ox: pan.x,
            oy: pan.y,
          };
          panDragRef.current = drag;
          return;
        }
        const next = {
          x: drag.ox + (ev.clientX - drag.sx),
          y: drag.oy + (ev.clientY - drag.sy),
        };
        panLiveRef.current = next;
        setPanLive(next);
      };

      const onLostCapture = () => {
        finishSession(false);
      };

      const onUp = (ev: PointerEvent) => {
        if (!pointersRef.current.has(ev.pointerId)) {
          if (pointersRef.current.size === 0 && !pinchRef.current) {
            finishSession(false);
          }
          return;
        }
        pointersRef.current.delete(ev.pointerId);

        if (pointersRef.current.size >= 2) {
          const pts = [...pointersRef.current.values()];
          startPinchFromPointsRef.current(pts[0]!, pts[1]!);
          return;
        }
        if (pointersRef.current.size === 1) {
          pinchRef.current = null;
          panDragRef.current = null;
          const pan = panLiveRef.current ?? committedPanRef.current;
          committedPanRef.current = pan;
          panLiveRef.current = pan;
          setCommittedPan(pan);
          setPanLive(pan);
          return;
        }

        if (pinchRef.current) {
          panDragRef.current = null;
          return;
        }

        let allowTap = false;
        if (ev.type === 'pointerup' && !didPinchRef.current && panDragRef.current) {
          const drag = panDragRef.current;
          const moved = Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy);
          if (
            moved < BRACKET_CANVAS_TAP_MOVE_THRESHOLD_PX &&
            (ev.pointerType !== 'mouse' || ev.button === 0)
          ) {
            allowTap = true;
          }
        }
        finishSession(allowTap);
      };

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      captureTarget.addEventListener('lostpointercapture', onLostCapture);
      detachPanWindowListenersRef.current = () => finishSession(false);
    },
    [commitPan, onBracketShortPress, onCanvasBackgroundTap],
  );

  const displayPan = panLive ?? committedPan;

  return {
    canvasShellRef,
    zoom,
    displayPan,
    beginCanvasPan,
    resetView,
    setBaselinePan,
    snapPanToBaseline,
  };
}
