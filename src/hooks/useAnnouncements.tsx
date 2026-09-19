import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAnnouncements } from "@/lib/announcements/client";
import {
  announcementDismissalKey,
  visibleAnnouncements,
  type PlatformAnnouncement,
  type VisibleAnnouncements,
} from "@/lib/announcements/state";

/**
 * Platform announcements from Mission Control.
 *
 * ## The initial value is EMPTY
 *
 * The dashboard renders normally and notices appear when the answer arrives
 * — never a placeholder, never a loading state. A channel that is quiet and
 * a channel that failed look the same here on purpose: both cost the reader
 * nothing.
 *
 * ## It polls, because notices move without the user
 *
 * The operator publishes, re-raises and archives from Mission Control, and
 * this browser is not party to any of it. Five minutes matches the payment
 * gate's cadence, plus a re-read on tab focus so a morning's first glance is
 * current.
 *
 * ## Dismissals are local, per (id, revision)
 *
 * A dismissal is a personal "seen it", not fleet state — it lives in this
 * browser's localStorage and is never reported anywhere. Re-raising from
 * Mission Control bumps the revision, which mints a new key, which is what
 * brings a dismissed banner back. Storage is wrapped in try/catch and its
 * absence only means notices reappear next visit — the harmless direction.
 */
const POLL_MS = 5 * 60 * 1000;

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* private windows forget; the banner returns next visit */
  }
}

export function useAnnouncements(): {
  visible: VisibleAnnouncements;
  dismiss: (a: PlatformAnnouncement) => void;
} {
  const [list, setList] = useState<PlatformAnnouncement[]>([]);
  // Bumped on every dismissal so `visible` recomputes without re-fetching.
  const [dismissedTick, setDismissedTick] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setList(await fetchAnnouncements());
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const dismiss = useCallback((a: PlatformAnnouncement) => {
    writeDismissed(announcementDismissalKey(a));
    setDismissedTick((t) => t + 1);
  }, []);

  const visible = useMemo(
    () => visibleAnnouncements(list, readDismissed),
    // dismissedTick is the invalidation signal for the localStorage reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, dismissedTick],
  );

  return { visible, dismiss };
}
