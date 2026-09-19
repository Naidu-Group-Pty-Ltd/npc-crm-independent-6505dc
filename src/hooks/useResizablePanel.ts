/**
 * useResizablePanel — pointer-driven, persisted resizing for floating surfaces
 * (the internal chat pop-up).
 *
 * • Size is stored in viewport pixels under a localStorage key so it survives
 *   reloads and re-logins.
 * • `null` size means "use the default CSS sizing" (nothing persisted).
 * • Sizes are clamped to sane min/max bounds and re-clamped on window resize so
 *   a panel can never be grown past the viewport or shrunk into nothing.
 * • `invertX` handles right-anchored surfaces: dragging the bottom-LEFT corner
 *   leftwards makes the panel wider.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PanelSize {
  width: number;
  height: number;
}

export interface ResizableBounds {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

const DEFAULT_BOUNDS: Required<ResizableBounds> = {
  minWidth: 288,
  minHeight: 220,
  maxWidth: 900,
  maxHeight: 900,
};

function read(key: string): PanelSize | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function write(key: string, value: PanelSize | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function useResizablePanel(
  key: string,
  options: ResizableBounds & { invertX?: boolean } = {},
) {
  const { invertX = false, ...boundsInput } = options;
  const bounds = { ...DEFAULT_BOUNDS, ...boundsInput };

  const [size, setSize] = useState<PanelSize | null>(() =>
    typeof window === 'undefined' ? null : read(key),
  );
  const [resizing, setResizing] = useState(false);
  const startRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const nodeRef = useRef<HTMLElement | null>(null);

  const clamp = useCallback(
    (next: PanelSize): PanelSize => {
      const maxW = Math.min(bounds.maxWidth, Math.max(bounds.minWidth, window.innerWidth - 16));
      const maxH = Math.min(bounds.maxHeight, Math.max(bounds.minHeight, window.innerHeight - 96));
      return {
        width: Math.round(Math.min(Math.max(bounds.minWidth, next.width), maxW)),
        height: Math.round(Math.min(Math.max(bounds.minHeight, next.height), maxH)),
      };
    },
    [bounds.maxWidth, bounds.maxHeight, bounds.minWidth, bounds.minHeight],
  );

  /** Attach to the resize grip: `{...handleProps}`. */
  const handleProps = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const el = nodeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      startRef.current = {
        x: event.clientX,
        y: event.clientY,
        width: rect.width,
        height: rect.height,
      };
      setSize({ width: rect.width, height: rect.height });
      setResizing(true);
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    style: { touchAction: 'none' as const },
  };

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      const start = startRef.current;
      const dx = (event.clientX - start.x) * (invertX ? -1 : 1);
      const dy = event.clientY - start.y;
      setSize(clamp({ width: start.width + dx, height: start.height + dy }));
    };
    const up = () => {
      setResizing(false);
      setSize((current) => {
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
  }, [resizing, clamp, invertX, key]);

  // Keep the panel inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setSize((current) => (current ? clamp(current) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const reset = useCallback(() => {
    setSize(null);
    write(key, null);
  }, [key]);

  /** Nudge the size from the keyboard (accessible resizing). */
  const nudge = useCallback(
    (dw: number, dh: number) => {
      const el = nodeRef.current;
      const base = size ?? {
        width: el?.offsetWidth ?? bounds.minWidth,
        height: el?.offsetHeight ?? bounds.minHeight,
      };
      const next = clamp({ width: base.width + dw, height: base.height + dh });
      setSize(next);
      write(key, next);
    },
    [size, clamp, key, bounds.minWidth, bounds.minHeight],
  );

  return {
    size,
    resizing,
    nodeRef: nodeRef as React.MutableRefObject<any>,
    handleProps,
    reset,
    nudge,
  };
}

export default useResizablePanel;
