/**
 * Height that reaches from an element's top edge to the bottom of the viewport.
 *
 * A full-bleed work surface has to know how much room is left after everything
 * above it. The Workflow Playground canvas used to assert `100vh - 4rem`, which
 * encodes one particular arrangement: a desktop header, no banners, no bottom
 * navigation. Every other arrangement pushed the bottom of the canvas — the
 * zoom controls and the minimap — below the fold:
 *
 *   • below 1024px the shell swaps to a mobile top bar AND a fixed bottom nav,
 *     so the real budget is smaller than `100vh - 4rem` at both ends;
 *   • a billing or plan-change banner moves the surface's top edge down, and
 *     the assertion does not know the banner exists.
 *
 * Measuring the element's own position answers all of those at once, for the
 * cost of one ResizeObserver. `visualViewport` is preferred over
 * `innerHeight` because it excludes the mobile browser's collapsing toolbars,
 * which is the number a fixed layout actually has to live inside.
 *
 * @param bottomInsetSelector Element overlaying the bottom of the viewport
 *   whose height has to be given back — the mobile navigation bar. Absent from
 *   the document on desktop, where the inset is simply zero.
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Never collapse below this, however cramped the viewport claims to be. */
const MIN_HEIGHT = 320;

export function useFillViewportHeight(
  ref: RefObject<HTMLElement>,
  bottomInsetSelector?: string,
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const top = element.getBoundingClientRect().top;

    const inset = bottomInsetSelector
      ? (document.querySelector(bottomInsetSelector)?.getBoundingClientRect().height ?? 0)
      : 0;

    setHeight(Math.max(MIN_HEIGHT, Math.round(viewportHeight - top - inset)));
  }, [bottomInsetSelector, ref]);

  useEffect(() => {
    measure();

    // The element's own top edge moves when a banner mounts above it, which no
    // window event reports — observing the element covers that as well as the
    // resize that a window listener would have caught.
    const element = ref.current;
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    if (document.body) observer.observe(document.body);

    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [measure, ref]);

  return height;
}
