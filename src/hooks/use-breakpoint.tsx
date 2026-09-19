import * as React from "react";

const TABLET_MIN = 768;
const DESKTOP_MIN = 1024;

export type Breakpoint = "mobile" | "tablet" | "desktop";

function resolve(width: number): Breakpoint {
  if (width >= DESKTOP_MIN) return "desktop";
  if (width >= TABLET_MIN) return "tablet";
  return "mobile";
}

/**
 * Three-tier breakpoint hook.
 * - mobile:  < 768px
 * - tablet:  768–1023px (iPad portrait/landscape)
 * - desktop: >= 1024px
 *
 * Desktop sidebar shell only mounts at `desktop`. Tablet and mobile
 * share the mobile chrome (top bar + bottom nav drawer).
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = React.useState<Breakpoint>(() =>
    typeof window === "undefined" ? "desktop" : resolve(window.innerWidth)
  );

  React.useEffect(() => {
    const onResize = () => setBp(resolve(window.innerWidth));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}

export function useIsTabletOrBelow() {
  return useBreakpoint() !== "desktop";
}
