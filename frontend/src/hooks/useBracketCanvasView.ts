import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Below this distance (px) from pointer down to up, a tap (not a pan) — background clear or bracket card select. */
export const BRACKET_CANVAS_TAP_MOVE_THRESHOLD_PX = 8;

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
      const z = Math.min(4, Math.max(0.25, oldZ + delta));
      if (z === oldZ) return;

      const effPx = panLiveRef.current?.x ?? committedPanRef.current.x;
      const effPy = panLiveRef.current?.y ?? committedPanRef.current.y;
      const lx = (e.clientX - rect.left - effPx) / oldZ;
      const ly = (e.clientY - rect.top - effPy) / oldZ;
      const newPanX = e.clientX - rect.left - lx * z;
      const newPanY = e.clientY - rect.top - ly * z;

      const drag = panDragRef.current;
      if (drag) {
        // Keep sx/sy as the pointer-drag origin. Wheel's clientX/Y is not the same gesture and
        // overwriting them makes pan deltas ~0 (e.g. trackpad or touch generating wheel during drag).
        panDragRef.current = {
          ...drag,
          ox: newPanX,
          oy: newPanY,
        };
        panLiveRef.current = { x: newPanX, y: newPanY };
        setPanLive({ x: newPanX, y: newPanY });
      }

      const nextPan = { x: newPanX, y: newPanY };
      committedPanRef.current = nextPan;
      zoomRef.current = z;
      setCommittedPan(nextPan);
      setZoom(z);
    };

    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [enabled, attachToken]);

  const beginCanvasPan = useCallback(
    (e: React.PointerEvent) => {
      if (e.defaultPrevented) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const t = e.target;
      shortPressOriginRef.current =
        t instanceof Element ? t : t instanceof Node ? t.parentElement : null;

      if (panDragRef.current) commitPan();
      detachPanWindowListenersRef.current?.();
      detachPanWindowListenersRef.current = null;

      const pointerId = e.pointerId;
      const captureTarget = e.currentTarget as HTMLElement;
      activePanPointerIdRef.current = pointerId;
      pointerCaptureElRef.current = captureTarget;
      try {
        captureTarget.setPointerCapture(pointerId);
      } catch {
        /* already captured or unsupported */
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

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const drag = panDragRef.current;
        if (!drag) return;
        if (ev.cancelable) ev.preventDefault();
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
        if (ev.pointerId !== pointerId) return;
        let allowTap = false;
        if (ev.type === 'pointerup' && panDragRef.current) {
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
