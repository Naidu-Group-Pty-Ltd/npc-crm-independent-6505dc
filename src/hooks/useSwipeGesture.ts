import { useState, useCallback, useRef } from 'react';

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

interface UseSwipeGestureOptions {
  threshold?: number;
  preventScrollOnSwipe?: boolean;
}

/**
 * Reusable swipe gesture hook for mobile navigation.
 * Returns touch event handlers to spread onto the target element.
 */
export function useSwipeGesture(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void,
  options: UseSwipeGestureOptions = {}
): SwipeHandlers {
  const { threshold = 50 } = options;
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const isHorizontalSwipe = useRef<boolean | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchEndX.current = null;
    isHorizontalSwipe.current = null;
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;

    // Determine if this is a horizontal or vertical gesture (lock after first move)
    if (isHorizontalSwipe.current === null && touchStartX.current !== null && touchStartY.current !== null) {
      const dx = Math.abs(e.targetTouches[0].clientX - touchStartX.current);
      const dy = Math.abs(e.targetTouches[0].clientY - touchStartY.current);
      if (dx > 10 || dy > 10) {
        isHorizontalSwipe.current = dx > dy;
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStartX.current || !touchEndX.current || !isHorizontalSwipe.current) return;

    const distance = touchStartX.current - touchEndX.current;
    const isLeftSwipe = distance > threshold;
    const isRightSwipe = distance < -threshold;

    if (isLeftSwipe && onSwipeLeft) {
      onSwipeLeft();
    }
    if (isRightSwipe && onSwipeRight) {
      onSwipeRight();
    }

    touchStartX.current = null;
    touchEndX.current = null;
    isHorizontalSwipe.current = null;
  }, [onSwipeLeft, onSwipeRight, threshold]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
