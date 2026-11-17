import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * 판 조작 — 한 손가락 탭: 열기 / 길게 누르기: 깃발 / 한 손가락 끌기: 이동 /
 * 두 손가락: 확대·축소. 데스크톱에서는 휠로 확대·축소한다.
 */

export interface GestureOptions {
  /** 확대 1배일 때 판 크기(px) */
  contentWidth: number;
  contentHeight: number;
  /** 처음 보여 줄 배율. 'fitWidth'면 판 너비를 화면에 맞춘다(1배를 넘지 않음) */
  initialScale: number | 'fitWidth';
  minScale: number;
  maxScale: number;
  onTap: (clientX: number, clientY: number) => void;
  onLongPress: (clientX: number, clientY: number) => void;
}

const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 8;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export function useBoardGestures(
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  options: GestureOptions,
) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const t = useRef<Transform>({ scale: 1, x: 0, y: 0 });

  const apply = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const { contentWidth: cw, contentHeight: ch, minScale, maxScale } = opts.current;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const cur = t.current;
    cur.scale = Math.min(maxScale, Math.max(minScale, cur.scale));
    const w = cw * cur.scale;
    const h = ch * cur.scale;
    cur.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, cur.x));
    cur.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, cur.y));
    content.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0) scale(${cur.scale})`;
  }, [contentRef, viewportRef]);

  /** 처음 배율로 되돌리고 판 위쪽 가운데를 보여 준다 */
  const reset = useCallback(() => {
    const viewport = viewportRef.current;
    const { initialScale, contentWidth, minScale } = opts.current;
    const vw = viewport?.clientWidth ?? contentWidth;
    const scale = initialScale === 'fitWidth' ? Math.max(minScale, Math.min(1, vw / contentWidth)) : initialScale;
    t.current = { scale, x: (vw - contentWidth * scale) / 2, y: 0 };
    apply();
  }, [apply, viewportRef]);

  useEffect(() => {
    reset();
  }, [reset, options.contentWidth, options.contentHeight, options.initialScale]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 };
    let moved = false;
    let multi = false;
    let longFired = false;
    let timer: number | undefined;
    let pinch: { dist: number; mid: { x: number; y: number }; from: Transform } | null = null;

    const local = (x: number, y: number) => {
      const rect = viewport.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };
    const twoFinger = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
    };
    const clearTimer = () => window.clearTimeout(timer);

    const onDown = (ev: PointerEvent) => {
      viewport.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        start = { x: ev.clientX, y: ev.clientY };
        moved = false;
        multi = false;
        longFired = false;
        clearTimer();
        timer = window.setTimeout(() => {
          if (!moved && !multi && pointers.size === 1) {
            longFired = true;
            opts.current.onLongPress(start.x, start.y);
          }
        }, LONG_PRESS_MS);
      } else if (pointers.size === 2) {
        multi = true;
        clearTimer();
        const f = twoFinger();
        pinch = { dist: f.dist, mid: f.mid, from: { ...t.current } };
      }
    };

    const onMove = (ev: PointerEvent) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pointers.size >= 2 && pinch) {
        const f = twoFinger();
        const { minScale, maxScale } = opts.current;
        const scale = Math.min(maxScale, Math.max(minScale, (pinch.from.scale * f.dist) / pinch.dist));
        // 처음 집은 지점이 손가락 가운데에 머물도록 이동량을 맞춘다
        const cx = (pinch.mid.x - pinch.from.x) / pinch.from.scale;
        const cy = (pinch.mid.y - pinch.from.y) / pinch.from.scale;
        t.current = { scale, x: f.mid.x - cx * scale, y: f.mid.y - cy * scale };
        apply();
        return;
      }

      if (pointers.size === 1 && !longFired) {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > MOVE_TOLERANCE) {
          moved = true;
          clearTimer();
        }
        if (moved) {
          t.current.x += ev.clientX - prev.x;
          t.current.y += ev.clientY - prev.y;
          apply();
        }
      }
    };

    const onEnd = (ev: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        clearTimer();
        if (!cancelled && !moved && !multi && !longFired) opts.current.onTap(ev.clientX, ev.clientY);
      }
    };
    const onUp = (ev: PointerEvent) => onEnd(ev, false);
    const onCancel = (ev: PointerEvent) => onEnd(ev, true);

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const p = local(ev.clientX, ev.clientY);
      const from = t.current;
      const { minScale, maxScale } = opts.current;
      const scale = Math.min(maxScale, Math.max(minScale, from.scale * Math.exp(-ev.deltaY * 0.002)));
      const cx = (p.x - from.x) / from.scale;
      const cy = (p.y - from.y) / from.scale;
      t.current = { scale, x: p.x - cx * scale, y: p.y - cy * scale };
      apply();
    };
    const onContextMenu = (ev: Event) => ev.preventDefault();

    const observer = new ResizeObserver(apply);
    observer.observe(viewport);

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onCancel);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('contextmenu', onContextMenu);
    return () => {
      clearTimer();
      observer.disconnect();
      viewport.removeEventListener('pointerdown', onDown);
      viewport.removeEventListener('pointermove', onMove);
      viewport.removeEventListener('pointerup', onUp);
      viewport.removeEventListener('pointercancel', onCancel);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('contextmenu', onContextMenu);
    };
  }, [apply, viewportRef]);

  return { reset };
}
