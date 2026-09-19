/**
 * Platform announcements from Mission Control — the pure rules the dashboard
 * renders by. Mission Control decides everything that matters (which notices
 * are active, who they target, what they say); this module only parses
 * defensively, keys dismissals, and splits the list into banners and modals.
 *
 * Two rules bite. **A malformed entry is dropped, never thrown** — an
 * announcement can never break a dashboard, so parsing admits exactly the
 * shapes it knows and discards the rest. And **a dismissal is per revision**:
 * the operator re-raising a notice bumps its revision, which mints a new
 * dismissal key, which is what makes a dismissed banner come back — an edit
 * alone never does.
 */

export type AnnouncementSeverity = "info" | "success" | "warning" | "critical";
export type AnnouncementDisplay = "banner" | "modal";

export interface PlatformAnnouncement {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  severity: AnnouncementSeverity;
  display: AnnouncementDisplay;
  dismissible: boolean;
  revision: number;
  publishedAt: string;
}

const SEVERITIES: readonly string[] = ["info", "success", "warning", "critical"];
const DISPLAYS: readonly string[] = ["banner", "modal"];

const asHttpsLink = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") ? value : null;

/**
 * Parse whatever the broker returned into announcements the UI will draw.
 * Unknown severity/display degrade to the mildest reading; entries missing
 * the essentials are dropped. Never throws.
 */
export function parseAnnouncementsPayload(
  payload: unknown,
): PlatformAnnouncement[] {
  if (typeof payload !== "object" || payload === null) return [];
  const list = (payload as { announcements?: unknown }).announcements;
  if (!Array.isArray(list)) return [];

  const parsed: PlatformAnnouncement[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (typeof e.title !== "string" || e.title.length === 0) continue;
    if (typeof e.body !== "string" || e.body.length === 0) continue;

    const display: AnnouncementDisplay = DISPLAYS.includes(e.display as string)
      ? (e.display as AnnouncementDisplay)
      : "banner";
    const linkUrl = asHttpsLink(e.linkUrl);

    parsed.push({
      id: e.id,
      title: e.title,
      body: e.body,
      linkUrl,
      linkLabel:
        linkUrl && typeof e.linkLabel === "string" && e.linkLabel.length > 0
          ? e.linkLabel
          : linkUrl,
      severity: SEVERITIES.includes(e.severity as string)
        ? (e.severity as AnnouncementSeverity)
        : "info",
      display,
      // A modal that cannot be closed is a lock screen, and locking is the
      // payment gate's job. Mission Control enforces this too — belt and
      // braces, because this is the last line before somebody's screen.
      dismissible: display === "modal" ? true : e.dismissible !== false,
      revision:
        typeof e.revision === "number" &&
        Number.isFinite(e.revision) &&
        e.revision >= 1
          ? Math.floor(e.revision)
          : 1,
      publishedAt: typeof e.publishedAt === "string" ? e.publishedAt : "",
    });
  }
  return parsed;
}

/** One dismissal per (announcement, revision) — re-raising re-pops. */
export function announcementDismissalKey(
  a: Pick<PlatformAnnouncement, "id" | "revision">,
): string {
  return `mc-announcement-dismissed:${a.id}:r${a.revision}`;
}

export interface VisibleAnnouncements {
  banners: PlatformAnnouncement[];
  modal: PlatformAnnouncement | null;
}

/**
 * What actually draws: dismissed entries are dropped, banners keep the
 * server's order, and modals surface ONE at a time (the server's newest
 * first) — a queue of popups is a hostage situation, so the next one waits
 * for the next poll after the first is acknowledged.
 */
export function visibleAnnouncements(
  list: PlatformAnnouncement[],
  isDismissed: (key: string) => boolean,
): VisibleAnnouncements {
  const remaining = list.filter(
    (a) => !isDismissed(announcementDismissalKey(a)),
  );
  return {
    banners: remaining.filter((a) => a.display === "banner"),
    modal: remaining.find((a) => a.display === "modal") ?? null,
  };
}
