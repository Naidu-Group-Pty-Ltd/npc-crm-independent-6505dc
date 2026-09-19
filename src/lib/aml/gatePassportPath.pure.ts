/**
 * Stage 9 — the road from the recorded decision to an issued Passport, in
 * order, with the previous stage's outcome PULLED THROUGH.
 *
 * ── The defects this replaces ─────────────────────────────────────────
 * Stage 9 was three disconnected panels. Nothing on it said the case had
 * been CLEARED at Stage 8 — the reader saw "Under review — not yet
 * decided" about the gate and read it as the decision not pulling
 * through. Nothing ordered gate → preview → issue, so how the Aurixa
 * Passport actually gets issued was a hunt. And the stage's primary
 * button carried no actionType, so it fell to the workspace switch's
 * default — a scroll to a screening anchor that does not exist here —
 * the same broken-button class as Stages 6, 7 and 8 before it.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Arrangement only. The decision comes from the case row, the gate from
 * the gate column, the credential state from the SERVER-derived passport
 * projection (this module never derives a passport state of its own —
 * that is the one rule the passport facts carry). Issuance stays where it
 * belongs: the MLRO controls in the reliance panel; preview is the
 * digital passport page, exactly as the client and partners will see it.
 */

import { refreshRemedy } from "@/lib/aml/passport";

export type GatePassportStepState =
  | "done"
  | "current"
  | "outstanding"
  | "blocked"
  /** Available at any moment and gates nothing — a look, not a step owed. */
  | "anytime";

export interface GatePassportStep {
  key: "decision" | "gate" | "preview" | "issue" | "share";
  label: string;
  state: GatePassportStepState;
  detail: string;
  blockedBy: string | null;
}

export interface GatePassportFacts {
  /** The Stage 8 outcome as the case row carries it: "cleared", "blocked",
   *  or null when no decision has been recorded. */
  decisionOutcome: "cleared" | "blocked" | null;
  gateStatus: string;
  /** SERVER-derived passport state code; null when the reading was
   *  unavailable — which is never treated as "not issued". */
  passportState: string | null;
  /**
   * The server's own reason codes for that state.
   *
   * `refresh_required` is one code covering two different owed acts, and
   * only the reasons tell them apart. Absent (an older deployment) the step
   * falls back to the previous wording, which is why this is optional.
   */
  passportReasons?: readonly string[] | null;
  passportVersion: number | null;
  canReview: boolean;
}

const GATE_APPROVED = new Set(["approved", "approved_with_controls"]);
const REVIEWER_NEEDED = "Requires a reviewer or the MLRO";

export function gatePassportPath(f: GatePassportFacts): GatePassportStep[] {
  const gateApproved = GATE_APPROVED.has(f.gateStatus);
  const steps: GatePassportStep[] = [];

  /* 1 · The decision, pulled through from Stage 8 — the fact this stage
   *     used to keep silent about. */
  steps.push({
    key: "decision",
    label: "Compliance decision",
    state: f.decisionOutcome === "cleared"
      ? "done"
      : f.decisionOutcome === "blocked"
        ? "blocked"
        : "current",
    detail: f.decisionOutcome === "cleared"
      ? "Cleared — recorded on the Decision stage."
      : f.decisionOutcome === "blocked"
        ? "The case is blocked. Nothing here proceeds until an explicit decision reopens it."
        : "Record the decision on the Decision stage first.",
    blockedBy: f.decisionOutcome === "blocked" ? "The case is blocked" : null,
  });

  /* 2 · The gate — granted BY the cleared decision, not asked for again.
   *
   *     Stage 9 used to carry its own approval card, so a reviewer who had
   *     just cleared the case was asked to decide the same thing a second
   *     time, with a second reason. `decide` records the gate itself now.
   *     A cleared case whose gate is still open is therefore one of two
   *     things — a gate an MLRO deliberately stopped, or a row decided
   *     before that change — and both are recorded on the Decision stage's
   *     full gate card, which is the only place every status has ever
   *     lived. */
  const gateStopped = f.gateStatus === "locked" || f.gateStatus === "terminated";
  steps.push({
    key: "gate",
    label: "Service gate approved",
    state: gateApproved
      ? "done"
      : f.decisionOutcome === "cleared"
        ? (f.canReview ? "current" : "blocked")
        : "outstanding",
    detail: gateApproved
      ? `${f.gateStatus.replace(/_/g, " ")} — the designated service may proceed.`
      : gateStopped
        ? `The gate is ${f.gateStatus.replace(/_/g, " ")} — a standing restriction recorded by the MLRO. Lifting it is a decision on the Decision stage.`
        : f.decisionOutcome === "cleared"
          ? "Recording the cleared decision grants this. This case was decided before that, so record the gate on the Decision stage's gate card."
          : `Currently ${f.gateStatus.replace(/_/g, " ")}. It is granted by the cleared decision on the Decision stage, where every other gate status is recorded too.`,
    blockedBy: !gateApproved && f.decisionOutcome === "cleared" && !f.canReview
      ? REVIEWER_NEEDED
      : null,
  });

  /* 3 · Seeing the credential — before anything is issued, deliberately. */
  steps.push({
    key: "preview",
    label: "Preview the digital passport",
    state: "anytime",
    detail: "Open the Passport exactly as the client and partners will see it — worth a look before any version is issued.",
    blockedBy: null,
  });

  /* 4 · Issuance — by the SERVER's own state code, never re-derived.
   *
   *     ── The trap this branch exists to close ──────────────────────
   *     `refresh_required` is ONE code covering two different owed acts.
   *     On the reported case the attestation was v1, issued, unsuperseded,
   *     with zero open refresh obligations — and the state read "Refresh
   *     required" for exactly one reason: `service_gate_regressed`,
   *     because the gate was still `under_review`.
   *
   *     This step then said "a newer version is needed", the reliance
   *     panel offered "Reissue as v2" as the open act, and following that
   *     advice supersedes a good v1 for nothing — because v2 reads
   *     `refresh_required` too while the gate is unapproved. A remedy that
   *     cannot discharge the reason is a loop with an audit trail.
   *
   *     `refreshRemedy` is the one place that knows which act clears which
   *     reason. Where the gate is the ONLY reason, the issuance debt is
   *     DISCHARGED — a version exists — and this step says so. Leaving it
   *     outstanding would count one fact twice (the gate step already
   *     carries it) and is why "one step left" could never fire, which is
   *     precisely the missing distinction that was reported. The stage still
   *     does not complete: the gate step is still owed, and completion is
   *     every owed step, never this one alone. */
  const code = f.passportState;
  const remedy = refreshRemedy(f.passportReasons);
  const cautionary = code === "refresh_required" || code === "superseded";
  /* Only the GATE is owed: nothing about the document needs reissuing. */
  const gateOnly = cautionary && remedy === "approve_gate";
  const version = f.passportVersion ? `v${f.passportVersion}` : "The issued version";

  steps.push({
    key: "issue",
    label: gateOnly ? "Passport issued" : "Issue the Passport",
    state: code === "issued_current"
      ? "done"
      /* Issued, and waiting on nothing but the gate above. */
      : gateOnly
        ? "done"
        : code === "ready_for_issuance" || cautionary
          ? "current"
          : code === null
            ? "outstanding"
            : gateApproved
              ? "current"
              : "outstanding",
    detail: code === "issued_current"
      ? `Passport${f.passportVersion ? ` v${f.passportVersion}` : ""} is in force — every connected portal reads this version.`
      : gateOnly
        ? `${version} is issued and stays in force. It reads as current the moment the gate above is approved — no new version is needed, and issuing one would not change that.`
        : code === "ready_for_issuance"
          ? "Ready — an authorised decision-maker issues it from the reliance panel below."
          : cautionary
            ? "A newer version is needed — reissue from the reliance panel below."
            : code === null
              ? "The passport state could not be read just now — issuance lives in the reliance panel below."
              : gateApproved
                ? "The gate is approved — issue the attestation from the reliance panel below."
                : "Issued from the reliance panel once the gate approves the service.",
    blockedBy: null,
  });

  /* 5 · Handing it over — the reason the credential exists.
   *
   *     ── Why this step is here and not on the next stage ────────────
   *     The partner roster, and every act on it, has always lived on this
   *     stage; the next one carried a read-only echo of the same
   *     organisations with no act attached, which is what made "am I
   *     doubling up on partners?" the right question to ask. Issuing a
   *     credential and handing it to the partners entitled to rely on it
   *     are one piece of work — you cannot share what has not been issued.
   *
   *     ── Why it is `anytime` and never owed ─────────────────────────
   *     A case may legitimately have no partner at all, and a stage that
   *     will not complete until somebody is given a Passport would invent
   *     an obligation nobody has. It orders the work without counting it,
   *     and it states no numbers: the roster below is the one place that
   *     says who holds this Passport, and two counts of one fact is a
   *     defect this stage has already had once. */
  steps.push({
    key: "share",
    label: "Share it with partners",
    state: "anytime",
    detail: "The organisations entitled to rely on this record receive it from the roster below — one at a time, each under its own written arrangement. Withdrawing access lives there too.",
    blockedBy: null,
  });

  return steps;
}

/**
 * How far along the path is, and what finishes it.
 *
 * ── Why the count lives here ──────────────────────────────────────────
 * Stage 9 rendered TWO progress readings beside a four-step path: the
 * header's "0 of 3 items on this stage complete" and the rail's "0 of 3
 * items complete", both counting journey-model notes rather than steps.
 * Both were true and neither matched the list underneath them, which is
 * the same defect Stage 5 already fixed — an operator cannot tell which
 * number is the state of the case.
 *
 * ── Why `remaining` is worth its own field ────────────────────────────
 * "There doesn't seem to be a clear distinction for section 9 to be ticked
 * off as green after the user has already ticked off the Approved
 * function." Approving the gate on a cleared case with an issued
 * attestation completes this stage outright — but nothing on the screen
 * ever said so before the click. When exactly one owed step is left, the
 * card can name it and say it finishes the stage.
 *
 * `anytime` steps are excluded from every number: a look is not a debt.
 */
export interface GatePassportProgress {
  done: number;
  total: number;
  /** Owed steps not yet discharged. */
  remaining: number;
  /** The step to do next — `current` first, else the first not done. */
  next: GatePassportStep | null;
  /** True when discharging `next` alone completes the stage. */
  finishesStage: boolean;
  complete: boolean;
}

export function gatePassportProgress(steps: GatePassportStep[]): GatePassportProgress {
  const owed = steps.filter((s) => s.state !== "anytime");
  const done = owed.filter((s) => s.state === "done").length;
  const outstanding = owed.filter((s) => s.state !== "done");
  const next = outstanding.find((s) => s.state === "current")
    ?? outstanding.find((s) => s.state === "blocked")
    ?? outstanding[0]
    ?? null;
  return {
    done,
    total: owed.length,
    remaining: outstanding.length,
    next,
    /* One owed step left AND it is actionable now. A blocked last step does
       not "finish the stage" — somebody else has to move first, and saying
       otherwise promises a completion the operator cannot deliver. */
    finishesStage: outstanding.length === 1 && next?.state !== "blocked",
    complete: outstanding.length === 0,
  };
}

/** Every owed step discharged — the case's credential is in force. */
export function gatePassportComplete(steps: GatePassportStep[]): boolean {
  return steps
    .filter((s) => s.state !== "anytime")
    .every((s) => s.state === "done");
}
