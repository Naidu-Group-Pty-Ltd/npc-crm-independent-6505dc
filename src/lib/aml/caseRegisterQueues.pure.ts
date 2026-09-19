/**
 * The register's queues — what is waiting, and how much of it.
 *
 * ── What this replaces ────────────────────────────────────────────────
 * Eleven filter chips in one wall: "All open", "My cases", "Needs
 * attention", "Awaiting client", "Awaiting review", "Information
 * outstanding", "Ready for decision", "High risk", "Blocked", "Cleared",
 * "Closed". Two things were wrong with that row and neither was its size.
 *
 * **Seven of the eleven duplicated a dropdown standing beside them.**
 * "Awaiting client" is `status: kyc_in_progress`; "High risk" is
 * `risk: high`; "Cleared", "Blocked" and "Closed" are statuses too — all of
 * them reachable from the Status and Risk selects two rows down. The same
 * filter offered twice, in two vocabularies, with no hint that picking one
 * changed the other.
 *
 * **And not one of them said how much was in it.** A queue whose count you
 * cannot see is a door you have to open to find out whether it was worth
 * opening. An operator arriving at the register wants to know where the work
 * is before deciding where to click, and eleven identical grey chips answer
 * that with nothing.
 *
 * ── What a QUEUE is, as opposed to a filter ───────────────────────────
 * A queue is a question about the *work*: is anything mine, is anything
 * stuck, is anything ready for me to decide. A filter is a question about an
 * *attribute*: what status, what risk rating. The first belongs on the
 * surface with a number beside it; the second belongs behind a control that
 * says how many are applied. That is the whole reorganisation.
 *
 * Every historical `?view=` key still resolves — Compliance Home deep-links
 * counts to the exact queue they were computed from, and a key that stops
 * resolving is a broken link on somebody else's screen. The status-shaped
 * ones simply arrive as an active Status filter rather than a highlighted
 * chip, which is what they always were underneath.
 */

/** A queue that is about the work rather than about an attribute. */
export interface RegisterQueue {
  key: string;
  label: string;
  /** One line, plain English — read on hover and by a screen reader. */
  hint: string;
}

export const REGISTER_QUEUES: readonly RegisterQueue[] = [
  /*
    The hints are one short line each, and deliberately so: they sit under
    the label on a quarter-width tile, and a sentence that truncates tells a
    reader less than a phrase that fits.
  */
  { key: "all", label: "All open", hint: "Every case on the register" },
  { key: "my_queue", label: "Mine", hint: "Assigned to you" },
  {
    key: "needs_attention",
    label: "Needs attention",
    hint: "Overdue, stalled or unresolved",
  },
  {
    key: "awaiting_decision",
    label: "Ready for decision",
    hint: "Waiting on the MLRO",
  },
] as const;

/** The minimum a row must carry for the counts below. */
export interface QueueCountRow {
  status?: string | null;
  assigned_analyst_id?: string | null;
  assigned_mlro_id?: string | null;
}

export interface QueueCount {
  /** How many rows match. Null when the register could not be counted. */
  count: number | null;
  /**
   * True when the number was taken from a truncated register.
   *
   * The count is then a floor rather than a total, and it is rendered as
   * one. A number presented as complete when it is not is worse than no
   * number: it is the same claim, told wrongly.
   */
  partial: boolean;
}

export interface QueueCountInput {
  /** An UNFILTERED page of the register. */
  rows: QueueCountRow[];
  /** The register's true size, from the server. */
  total: number;
  /** Whether each row is flagged, decided by the caller's own reading. */
  needsAttention: (row: QueueCountRow) => boolean;
  /** The signed-in user, for "Mine". Null when unknown. */
  userId: string | null;
  /** False while the snapshot has not arrived; every count reads null. */
  ready: boolean;
}

/**
 * Count every queue from ONE unfiltered snapshot.
 *
 * Counts are deliberately not derived from the rows currently on screen:
 * those are already filtered, so "Mine" computed while viewing "Ready for
 * decision" would report the intersection and call it the queue. A queue
 * count that changes because of what you are looking at is not a count.
 */
export function countRegisterQueues(input: QueueCountInput): Record<string, QueueCount> {
  const partial = input.total > input.rows.length;
  const out: Record<string, QueueCount> = {};
  const unknown: QueueCount = { count: null, partial: false };

  if (!input.ready) {
    for (const q of REGISTER_QUEUES) out[q.key] = unknown;
    return out;
  }

  const mine = (r: QueueCountRow) =>
    Boolean(input.userId)
    && (r.assigned_analyst_id === input.userId || r.assigned_mlro_id === input.userId);

  const tally = (predicate: (r: QueueCountRow) => boolean): QueueCount => ({
    count: input.rows.filter(predicate).length,
    partial,
  });

  for (const q of REGISTER_QUEUES) {
    switch (q.key) {
      case "all":
        // The one queue the server can answer exactly, truncation or not.
        out[q.key] = { count: input.total, partial: false };
        break;
      case "my_queue":
        out[q.key] = input.userId ? tally(mine) : unknown;
        break;
      case "needs_attention":
        out[q.key] = tally((r) => input.needsAttention(r));
        break;
      case "awaiting_decision":
        out[q.key] = tally((r) => r.status === "escalated_mlro");
        break;
      default:
        out[q.key] = unknown;
    }
  }
  return out;
}

/** "12", "12+" on a truncated register, or nothing at all when unknown. */
export function queueCountLabel(c: QueueCount | undefined): string | null {
  if (!c || c.count === null) return null;
  return c.partial ? `${c.count}+` : String(c.count);
}
