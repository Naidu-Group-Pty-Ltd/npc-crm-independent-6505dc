/**
 * One screening status, spoken the same way everywhere.
 *
 * ── What went wrong ───────────────────────────────────────────────────
 * Three surfaces described Stage 5 and none of them agreed. The stage card
 * said "Screening has not started" (correct — the queue was dead). The live
 * rail said "Screening is running · Go there" (false, and the button landed
 * on a stage that offered nothing to do). The journey rail said "Not started".
 *
 * An MLRO reading three answers to one question cannot tell whether screening
 * happened, and has no way to find out. That is the dead end.
 *
 * So the status vocabulary is derived ONCE, here, from the canonical subject
 * rows, and every surface renders the same five values the compliance team
 * actually uses:
 *
 *   required          nobody has run it yet
 *   in_progress       genuinely with the engine, inside the stall window
 *   manual_review     a candidate or a failure needs a person
 *   completed         every required subject resolved
 *   not_required      no subject requires screening (never "everyone is clear")
 *
 * ── The rule that stops the lie ───────────────────────────────────────
 * `queued` only means "in progress" if something is consuming the queue.
 * Past the stall window it means nothing picked it up, and saying "running"
 * there is how an operator waits for ever. Measured in production: a request
 * sat `queued` with `attempts = 0` indefinitely while the screen reported the
 * engine was working.
 */

export type ScreeningStatus =
  | "required"
  | "in_progress"
  | "manual_review"
  | "completed"
  | "not_required";

/**
 * How long a subject may sit queued before "in progress" stops being true.
 * Mirrors `SCREENING_STALL_SECONDS` on the server.
 */
export const SCREENING_STALL_MS = 5 * 60 * 1000;

export interface ScreeningSubjectFact {
  required?: boolean;
  state: string;
  error_category?: string | null;
  /** When the row last changed — how a stalled queue is recognised. */
  updated_at?: string | null;
  matches?: Array<{ status: string }>;
}

export interface ScreeningStatusReading {
  status: ScreeningStatus;
  /** The badge an operator reads. */
  label: string;
  /** One sentence of why. */
  detail: string;
  /** Whose move it is. */
  owner: "system" | "analyst" | "reviewer" | "administrator" | "none";
  /** True when this stage is holding the journey. */
  blocking: boolean;
}

const LABELS: Record<ScreeningStatus, string> = {
  required: "Screening required",
  in_progress: "Screening in progress",
  manual_review: "Manual review required",
  completed: "Screening completed",
  not_required: "Screening not required",
};

const RESOLVED = new Set(["completed", "false_positive", "confirmed_match"]);
const IN_FLIGHT = new Set(["queued", "processing"]);

/** A queued subject that nothing has touched for the stall window is stuck. */
function stalled(s: ScreeningSubjectFact, nowMs: number): boolean {
  if (!IN_FLIGHT.has(s.state)) return false;
  if (!s.updated_at) return false;
  const at = Date.parse(s.updated_at);
  return Number.isFinite(at) && nowMs - at >= SCREENING_STALL_MS;
}

export function deriveScreeningStatus(
  subjects: ScreeningSubjectFact[] | null | undefined,
  nowMs: number = Date.now(),
): ScreeningStatusReading {
  const make = (
    status: ScreeningStatus, detail: string,
    owner: ScreeningStatusReading["owner"], blocking: boolean,
  ): ScreeningStatusReading => ({ status, label: LABELS[status], detail, owner, blocking });

  // An unread subject list is not an empty one, and an empty one is never
  // "everyone is clear".
  if (!subjects) {
    return make("required", "The screening position could not be read.", "analyst", true);
  }
  const required = subjects.filter((s) => s.required !== false && s.state !== "not_required");
  if (required.length === 0) {
    return make(
      "not_required",
      "No party on this case requires screening. This is a scoping outcome, not a clearance.",
      "none", false,
    );
  }

  // A person is needed: candidates first, then failures.
  const openCandidates = required.filter((s) =>
    s.state === "possible_match" || (s.matches ?? []).some((m) => m.status === "open"));
  if (openCandidates.length > 0) {
    return make(
      "manual_review",
      `${openCandidates.length} subject${openCandidates.length === 1 ? "" : "s"} returned a candidate that needs adjudication.`,
      "reviewer", true,
    );
  }
  const failed = required.filter((s) => s.state === "error");
  if (failed.length > 0) {
    return make(
      "manual_review",
      "A check could not complete. A technical failure never reads as clear, so the "
      + "subject stays outstanding.",
      "administrator", true,
    );
  }

  const stuck = required.filter((s) => stalled(s, nowMs));
  if (stuck.length > 0) {
    // Deliberately NOT "in progress". Nothing picked it up.
    return make(
      "required",
      `${stuck.length} request${stuck.length === 1 ? " has" : "s have"} been queued with `
      + "nothing picking them up. Retrying is safe — a request already in flight is "
      + "refused rather than sent twice.",
      "administrator", true,
    );
  }

  const running = required.filter((s) => IN_FLIGHT.has(s.state));
  if (running.length > 0) {
    return make(
      "in_progress",
      `${running.length} subject${running.length === 1 ? " is" : "s are"} with the screening `
      + "engine. Any candidates come back for adjudication.",
      "system", true,
    );
  }

  const outstanding = required.filter((s) => !RESOLVED.has(s.state));
  if (outstanding.length > 0) {
    return make(
      "required",
      `${outstanding.length} required subject${outstanding.length === 1 ? " has" : "s have"} `
      + "not been screened yet.",
      "analyst", true,
    );
  }

  return make(
    "completed",
    "Every required subject has a resolved screening outcome. A completed stage is "
    + "evidence, not a service-gate clearance.",
    "none", false,
  );
}
