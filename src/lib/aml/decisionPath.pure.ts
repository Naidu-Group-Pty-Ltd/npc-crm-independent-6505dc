/**
 * Stage 8 — the order of the Risk & MLRO decision, and why its buttons are
 * ever disabled.
 *
 * ── The defect class this replaces ────────────────────────────────────
 * The risk section was five disconnected cards — assessment, conditions,
 * recommendation, decision, gate — with every fact on screen and no ORDER,
 * the same shape Stage 5 had before its guided path. And its buttons
 * disabled silently: "Apply gate change" sat greyed under an empty reason
 * box with nothing saying the reason is what enables it, which reads as a
 * broken control ("the user needs to be able to choose the option and
 * apply the gate change" — they could; nothing said how).
 *
 * ── What this module is, and is not ───────────────────────────────────
 * It ARRANGES facts the server owns; it decides nothing new. Every rule
 * that refuses a gate change lives in `aml-risk`'s `set_service_gate` and
 * still refuses — `gateChangeHint` mirrors those preconditions so the
 * operator reads the requirement BEFORE the 409 instead of from it, and a
 * source test pins the mirror to the server's own checks. A disabled
 * button must name its blocker; a blocked step must name what unblocks it.
 */

export interface DecisionPathFacts {
  /** Latest risk assessment, if any. */
  assessment: { created_at: string; risk_rating: string | null } | null;
  /** The recalc reading: material change since the assessment. */
  recalcStale: boolean;
  recalcReasons: string[];
  openConditions: number;
  pendingRecommendation: boolean;
  decision: { outcome: string; decided_at: string } | null;
  gate: { status: string; effective_at: string | null } | null;
  canWrite: boolean;
  canReview: boolean;
  isMlro: boolean;
}

export type DecisionStepState =
  /** Recorded, and nothing since has unsettled it. */
  | "done"
  /** The next thing to do. */
  | "current"
  /** Later in the order; not yet actionable. */
  | "outstanding"
  /** Current, but this operator cannot perform it — blockedBy names why. */
  | "blocked"
  /** Nobody owes it: renders as —, never as a tick. */
  | "settled";

export interface DecisionStep {
  key: "assessment" | "recommendation" | "decision" | "gate";
  label: string;
  state: DecisionStepState;
  detail: string;
  /** What stands in the way, named — null unless state is "blocked". */
  blockedBy: string | null;
}

const REVIEWER_NEEDED = "Requires a reviewer or the MLRO";

/**
 * The decision path, in the order the work is done. Exactly one step is
 * `current`/`blocked` until the path completes.
 *
 * A recommendation is deliberately OPTIONAL: the analyst's step, not a
 * gate on the reviewer's. When a decision was recorded without one, the
 * step settles ("—") rather than ticking — it says nobody recorded one,
 * not that somebody did.
 */
export function decisionPath(f: DecisionPathFacts): DecisionStep[] {
  const assessmentDone = f.assessment !== null && !f.recalcStale;
  /*
   * An ESCALATED decision is a handover, not an outcome: the case now waits
   * on the MLRO's cleared or blocked decision, so the step stays open —
   * current for the MLRO, blocked-with-the-blocker-named for everyone else.
   */
  const escalated = f.decision?.outcome === "escalated";
  const decisionDone = f.decision !== null && !escalated;
  /* The gate step is done when a gate decision has been recorded SINCE the
   * case decision — an older gate state is context, not the outcome of
   * this decision. */
  const gateDone = decisionDone && f.gate?.effective_at != null
    && f.decision!.decided_at <= f.gate.effective_at;

  const steps: DecisionStep[] = [];

  steps.push({
    key: "assessment",
    label: "Risk assessment computed and current",
    state: assessmentDone ? "done" : "current",
    detail: f.assessment === null
      ? "No assessment has been computed yet — evaluate the case."
      : f.recalcStale
        ? `Material information changed since the last assessment (${f.recalcReasons
            .map((r) => r.replace(/_changed$/, "").replace(/_/g, " ")).join(", ") || "recompute required"}) — recompute it.`
        : `Rated ${String(f.assessment.risk_rating ?? "—").toUpperCase()}.`,
    blockedBy: null,
  });

  /* The recommendation is the ANALYST's step and the decision the
   * reviewer's: for an operator who cannot decide, recording the
   * recommendation is their current act; for a reviewer the decision is,
   * and the optional recommendation stays open beside it, never ahead of
   * it — two people, one current step each. */
  steps.push({
    key: "recommendation",
    label: "Analyst recommendation",
    state: f.pendingRecommendation
      ? "done"
      : decisionDone
        ? "settled"
        : assessmentDone && !f.canReview
          ? "current"
          : f.canReview
            /* A decision-maker owes no recommendation to themselves — for
             * them the step settles unless an analyst has one waiting. The
             * form itself only renders for operators who cannot decide. */
            ? "settled"
            : "outstanding",
    detail: f.pendingRecommendation
      ? "Recorded — awaiting the reviewer."
      : decisionDone
        ? "None was recorded before the decision — a recommendation is optional."
        : f.canReview
          ? "Nothing waiting. An analyst's recommendation would appear beside the decision; as the decision-maker you may decide directly."
          : "Optional: the analyst's recommended outcome, for the reviewer to weigh.",
    blockedBy: null,
  });

  steps.push({
    key: "decision",
    label: "Decision recorded",
    state: decisionDone
      ? "done"
      : !assessmentDone
        ? "outstanding"
        : escalated
          ? (f.isMlro ? "current" : "blocked")
          : f.canReview
            ? "current"
            : "blocked",
    detail: decisionDone
      ? `${f.decision!.outcome.replace(/_/g, " ")}.`
      : escalated
        ? "Escalated — the final cleared or blocked decision is the MLRO's to record."
        : "Clear, escalate or block — frozen into the decision snapshot.",
    blockedBy: decisionDone || !assessmentDone
      ? null
      : escalated
        ? (f.isMlro ? null : "Waiting on the MLRO")
        : f.canReview
          ? null
          : REVIEWER_NEEDED,
  });

  steps.push({
    key: "gate",
    label: "Service gate applied",
    state: gateDone
      ? "done"
      : !decisionDone
        ? "outstanding"
        : f.canReview
          ? "current"
          : "blocked",
    detail: gateDone
      ? `${(f.gate!.status).replace(/_/g, " ")}.`
      : decisionDone && f.decision!.outcome === "cleared"
        /* The step DIRECTS when it is the open one: what to set, and what
         * each choice means — not merely what the gate abstractly is. */
        ? `The case is cleared — set the gate to Approved to grant the service`
          + ` (or Approved with controls, with an open condition recording them).`
          + (f.gate ? ` Currently ${(f.gate.status).replace(/_/g, " ")}.` : "")
        : f.gate
          ? `Currently ${(f.gate.status).replace(/_/g, " ")} — the gate is the entitlement decision, separate from the case stage.`
          : "The gate is the entitlement decision, separate from the case stage.",
    blockedBy: !gateDone && decisionDone && !f.canReview ? REVIEWER_NEEDED : null,
  });

  return steps;
}

/** True when every owed step is discharged. */
export function decisionPathComplete(steps: DecisionStep[]): boolean {
  return steps.every((s) => s.state === "done" || s.state === "settled");
}

/**
 * Why a "record"/"apply" button is disabled, in words — or null when it is
 * ready. A silent disabled control is indistinguishable from a broken one.
 */
export function reasonHint(text: string, what = "reason"): string | null {
  const remaining = 10 - text.trim().length;
  if (remaining <= 0) return null;
  return `Add a ${what} of at least 10 characters — ${remaining} more to go. It is recorded on the audit trail.`;
}

/**
 * The server's gate preconditions, read BEFORE the request instead of from
 * its 409. Mirrors `set_service_gate` in `aml-risk` — the server still
 * enforces every rule; this only discloses. Returns null when nothing
 * pre-derivable stands in the way.
 */
export function gateChangeHint(
  selected: string,
  facts: { decisionOutcome: string | null; openConditions: number; isMlro: boolean },
): string | null {
  if ((selected === "locked" || selected === "terminated") && !facts.isMlro) {
    return "Locking or terminating the service gate requires the MLRO.";
  }
  if (selected === "approved" || selected === "approved_with_controls") {
    if (facts.decisionOutcome !== "cleared") {
      return "Approving the service gate requires a recorded cleared decision first.";
    }
    if (selected === "approved" && facts.openConditions > 0) {
      return "Open conditions exist — use Approved with controls, or resolve them first.";
    }
    if (selected === "approved_with_controls" && facts.openConditions === 0) {
      return "Approved with controls needs at least one open condition recording those controls.";
    }
  }
  return null;
}
