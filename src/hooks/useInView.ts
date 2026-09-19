import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether an element has entered the viewport — once true, stays true.
 *
 * Exists for imagery that costs something to load: forty-eight cards mount per
 * gallery page, most of them below the fold, and each photo-less one would
 * otherwise spend two metered Street View calls the reader may never scroll
 * to. Latching keeps loaded imagery loaded; a card that scrolls back out does
 * not throw its panorama away just to fetch it again three seconds later.
 *
 * The margin starts the fetch a little before the card scrolls in, so the
 * image is usually decoded by the time it is visible.
 *
 * Falls back to `true` where IntersectionObserver does not exist (jsdom, very
 * old browsers): eager loading is a cost, an invisible page is a bug.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '240px'): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin, inView]);

  return inView;
}

export default useInView;
