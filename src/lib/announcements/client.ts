/**
 * Frontend client for platform announcements.
 *
 * Every call goes through the `mission-control-announcements` Edge Function
 * so the clone API key never reaches a browser — the same rule the gate,
 * token and seat clients follow. Every failure answers an empty list,
 * because a notice must never be the reason a dashboard shows an error.
 */
import {
  parseAnnouncementsPayload,
  type PlatformAnnouncement,
} from "./state";

export async function fetchAnnouncements(): Promise<PlatformAnnouncement[]> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<unknown>(
      "mission-control-announcements",
      {},
    );
    if (error) {
      console.warn("[announcements] unavailable", error.message);
      return [];
    }
    return parseAnnouncementsPayload(data);
  } catch (err) {
    console.warn("[announcements] fetch threw", err);
    return [];
  }
}
