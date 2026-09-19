/**
 * useDraggablePosition — pointer-driven, persisted free positioning for floating
 * surfaces (message docks, minimised chat chips).
 *
 * • Position is stored as viewport pixels (top-left) under a localStorage key so
 *   it survives reloads and re-logins.
 * • `null` position means "use the default CSS placement" (nothing persisted).
 * • Positions are clamped back into the viewport on drag end and on resize, so a
 *   surface can never be dragged off-screen and lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DragPoint {
  x: number;
  y: number;
}

const MARGIN = 8;

function read(key: string): DragPoint | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function write(key: string, value: DragPoint | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function useDraggablePosition(key: string) {
  const [position, setPosition] = useState<DragPoint | null>(() =>
    typeof window === 'undefined' ? null : read(key),
  );
  const [dragging, setDragging] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef<DragPoint>({ x: 0, y: 0 });

  const clamp = useCallback((point: DragPoint): DragPoint => {
    const el = nodeRef.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 120;
    const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    return {
      x: Math.min(Math.max(MARGIN, point.x), maxX),
      y: Math.min(Math.max(MARGIN, point.y), maxY),
    };
  }, []);

  const commit = useCallback(
    (point: DragPoint | null) => {
      const next = point ? clamp(point) : null;
      setPosition(next);
      write(key, next);
    },
    [clamp, key],
  );

  /** Attach to the drag handle: `{...handleProps}`. */
  const handleProps = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const el = nodeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      offsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // Seed from the current rendered box so the first move doesn't jump.
      setPosition({ x: rect.left, y: rect.top });
      setDragging(true);
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    style: { touchAction: 'none' as const, cursor: 'grab' },
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      setPosition({
        x: event.clientX - offsetRef.current.x,
        y: event.clientY - offsetRef.current.y,
      });
    };
    const up = () => {
      setDragging(false);
      setPosition((current) => {
        const next = current ? clamp(current) : null;
        write(key, next);
        return next;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, clamp, key]);

  // Keep the surface reachable when the window shrinks.
  useEffect(() => {
    const onResize = () => {
      setPosition((current) => (current ? clamp(current) : current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  /** Style to spread onto the draggable surface. */
  const positionStyle: React.CSSProperties = position
    ? { position: 'fixed', left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : {};

  return {
    position,
    dragging,
    /** Ref for the surface being moved. */
    nodeRef: nodeRef as React.MutableRefObject<any>,
    handleProps,
    positionStyle,
    /** Snap back to the default corner. */
    reset: () => commit(null),
    setPosition: commit,
  };
}

export default useDraggablePosition;
