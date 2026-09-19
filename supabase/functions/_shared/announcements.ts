/**
 * Mission Control's announcements API — this clone's client for it.
 *
 * A sibling of `paymentGate.ts` rather than part of it, the same way that
 * module is a sibling of `missionControl.ts`: one client per API family,
 * each naming its own failure policy. This one FAILS SILENT — the thing it
 * would otherwise withhold is a notice, and a notice must never be the
 * reason a dashboard breaks, waits, or logs a customer-visible error. Every
 * failure (unconfigured, unreachable, timed out, 4xx, 5xx, unparseable)
 * answers an empty list.
 *
 * The credentials are the SAME two the gate client reads — the clone's one
 * Mission Control identity — so a fleet where the gate works is a fleet
 * where announcements work, with nothing new to configure.
 *
 * Parses under Deno: no `@/` aliases, explicit `.ts` extensions.
 */

const BASE_URL = (Deno.env.get("MISSION_CONTROL_URL") ?? "").replace(
  /\/+$/,
  "",
);
const API_KEY = Deno.env.get("MISSION_CONTROL_CLONE_API_KEY") ?? "";

/** Short on purpose, like the gate's: this sits behind a dashboard poll, so
 *  a slow Mission Control must cost a moment and then be ignored. */
const TIMEOUT_MS = (() => {
  const raw = Number(Deno.env.get("MC_ANNOUNCEMENTS_TIMEOUT_MS") ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 6_000;
})();

export function announcementsConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY);
}

export type AnnouncementsPayload = { announcements: unknown[] };

const EMPTY: AnnouncementsPayload = { announcements: [] };

/**
 * Ask Mission Control what this workspace's dashboard should be showing.
 *
 * The body is passed through as-is: the frontend's parser is the one
 * defensive reader (`src/lib/announcements/state.ts`), so validation lives
 * once rather than twice-and-drifting. This function only guarantees the
 * envelope — `{ announcements: [] }` on every failure, an array whenever
 * Mission Control sent one.
 */
export async function fetchAnnouncementsFromMissionControl(): Promise<AnnouncementsPayload> {
  if (!announcementsConfigured()) {
    // A clone with no Mission Control credentials receives no notices. This
    // is also the local-development shape.
    return EMPTY;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/public/clones/announcements`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-clone-api-key": API_KEY,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[announcements] read not ok", res.status);
      return EMPTY;
    }
    const body = (await res.json().catch(() => null)) as {
      announcements?: unknown;
    } | null;
    if (!body || !Array.isArray(body.announcements)) return EMPTY;
    return { announcements: body.announcements };
  } catch (err) {
    console.warn("[announcements] read failed", err);
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}
