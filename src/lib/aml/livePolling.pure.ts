/**
 * When a watched case should refetch itself.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * Every AML surface fetched once, on mount. A client uploading a document,
 * a screening result landing, a stage completing — none of it reached a tab
 * that was already open, so the operator's picture of the case was however
 * stale as the last time they reloaded. That is the same defect the
 * Agreement Centre measured on the partner portals, and the same shape of
 * fix: poll a cheap read, refetch when something moved.
 *
 * Realtime is not available here for the same structural reason it is not
 * available to the Finance Portal — these tables are service-role-only
 * behind a bespoke session, so a browser subscription cannot see them.
 *
 * ── The rules that keep it cheap ──────────────────────────────────────
 * A hidden tab polls nothing. Nobody is looking at it, and a background tab
 * that keeps a case warm for eight hours is the reason interval polling gets
 * a bad name.
 *
 * A tab that becomes visible refetches IMMEDIATELY rather than waiting out
 * the remaining interval — that is the case that actually feels broken: you
 * switch back, you know something happened, and the screen sits there.
 *
 * A case with work in flight polls faster than a settled one, because the
 * only thing worth watching closely is something that is about to change.
 */

export type LivePollActivity = "in_flight" | "waiting_on_others" | "settled";

/** Visible and something is happening: the operator is watching it land. */
export const POLL_MS_IN_FLIGHT = 10_000;
/** Visible, waiting on a client or a colleague: it will not land this second. */
export const POLL_MS_WAITING = 30_000;
/** Visible and nothing outstanding: still refetch, but rarely. */
export const POLL_MS_SETTLED = 120_000;

export interface LivePollInput {
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  activity: LivePollActivity;
  /** A refetch already running must not queue another behind it. */
  busy: boolean;
}

export interface LivePollDecision {
  /** Milliseconds until the next poll, or `null` for "do not poll". */
  intervalMs: number | null;
  reason: string;
}

export function decideLivePoll(input: LivePollInput): LivePollDecision {
  if (!input.visible) {
    return { intervalMs: null, reason: "the tab is hidden — nobody is looking at it" };
  }
  if (input.busy) {
    return { intervalMs: null, reason: "a refetch is already in flight" };
  }
  switch (input.activity) {
    case "in_flight":
      return { intervalMs: POLL_MS_IN_FLIGHT, reason: "work is in flight on this case" };
    case "waiting_on_others":
      return { intervalMs: POLL_MS_WAITING, reason: "waiting on a client or a colleague" };
    default:
      return { intervalMs: POLL_MS_SETTLED, reason: "nothing is outstanding" };
  }
}

/**
 * How busy a case is, from state it already holds.
 *
 * `in_flight` means the system itself is due to change something — a
 * screening request being consumed, a verification being processed. Those
 * land without anybody pressing anything, which is exactly when a stale
 * screen is most misleading.
 */
export function livePollActivity(facts: {
  screeningInFlight: boolean;
  awaitingClient: boolean;
  outstandingWork: boolean;
}): LivePollActivity {
  if (facts.screeningInFlight) return "in_flight";
  if (facts.awaitingClient || facts.outstandingWork) return "waiting_on_others";
  return "settled";
}
