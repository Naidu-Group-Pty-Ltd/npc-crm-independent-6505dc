/**
 * The decision and gate choices, as things a person can read — and which
 * gate statuses the moment actually suggests.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * Both acts were a bare <select> over enum spellings ("Approved with
 * controls") beside a disabled button. Nothing said what a choice MEANS,
 * which ones make sense NOW, or what happened after — the operator picked
 * "Approved" on a cleared case and experienced nothing changing, because
 * the apply needed a typed reason two controls away and no part of the
 * form led them there. On this case the production table showed ZERO gate
 * decisions ever recorded: the act was never completed, not broken.
 *
 * Meanings here are semantics, not persuasion: each line says what the
 * status DOES to the entitlement, in the platform's own vocabulary. The
 * suggestion rule is deliberately narrow — it proposes only what the
 * recorded decision already implies, and everything stays choosable, so
 * this is arrangement, never a second gate policy. The server's
 * `set_service_gate` still enforces every rule.
 */

export interface DecisionChoice {
  value: "cleared" | "escalated" | "blocked";
  label: string;
  meaning: string;
}

export const DECISION_CHOICES: DecisionChoice[] = [
  {
    value: "cleared",
    label: "Clear",
    meaning: "The compliance decision is that the case may proceed. The service itself still needs the gate approved.",
  },
  {
    value: "escalated",
    label: "Escalate to MLRO",
    meaning: "Hands the final decision to the Money Laundering Reporting Officer — the case moves to Decision pending.",
  },
  {
    value: "blocked",
    label: "Block",
    meaning: "Stops the case. Only an explicit later decision reopens it.",
  },
];

export interface RecommendationChoice {
  value: "cleared" | "cleared_with_conditions" | "edd_required" | "escalated" | "blocked";
  label: string;
  meaning: string;
}

/**
 * The analyst's recommended outcomes. A RECOMMENDATION, not a decision:
 * this vocabulary is wider than the decision's (conditions and EDD are
 * things an analyst can propose that a decision cannot spell), which is
 * exactly why the surfaces are two and not one — see the RiskTab note on
 * why the form shows only to operators who cannot decide.
 */
export const RECOMMENDATION_CHOICES: RecommendationChoice[] = [
  {
    value: "cleared",
    label: "Clear",
    meaning: "Recommend the case proceeds as it stands.",
  },
  {
    value: "cleared_with_conditions",
    label: "Clear with conditions",
    meaning: "Recommend proceeding, with named conditions attached to the case.",
  },
  {
    value: "edd_required",
    label: "Enhanced due diligence",
    meaning: "Recommend deeper checks before any decision is made.",
  },
  {
    value: "escalated",
    label: "Escalate to MLRO",
    meaning: "Recommend the MLRO takes this one directly.",
  },
  {
    value: "blocked",
    label: "Block",
    meaning: "Recommend the case is stopped.",
  },
];

export interface GateChoice {
  value: string;
  label: string;
  meaning: string;
  /** Only the MLRO may record these. */
  mlroOnly: boolean;
}

export const GATE_CHOICES: GateChoice[] = [
  { value: "cdd_incomplete", label: "CDD incomplete", mlroOnly: false,
    meaning: "Customer due diligence is not yet complete — the service does not proceed." },
  { value: "information_outstanding", label: "Information outstanding", mlroOnly: false,
    meaning: "Something has been asked of the client and not yet received." },
  { value: "under_review", label: "Under review", mlroOnly: false,
    meaning: "The case is with staff — the service is not yet granted." },
  { value: "conditions_outstanding", label: "Conditions outstanding", mlroOnly: false,
    meaning: "Named conditions must be met before the service proceeds." },
  { value: "approved_with_controls", label: "Approved with controls", mlroOnly: false,
    meaning: "Grants the service under open conditions recording the controls." },
  { value: "approved", label: "Approved", mlroOnly: false,
    meaning: "Grants the designated service — the case becomes service-ready." },
  { value: "locked", label: "Locked", mlroOnly: true,
    meaning: "Stops the service. Recording this requires the MLRO." },
  { value: "terminated", label: "Terminated", mlroOnly: true,
    meaning: "Ends the service entitlement. Recording this requires the MLRO." },
];

export interface GateOptionGroups {
  /** What the recorded decision already implies — offered first. */
  suggested: GateChoice[];
  /** Every other status this operator may record. */
  other: GateChoice[];
}

/**
 * Group the gate choices for this moment. The rule proposes only what the
 * recorded decision implies:
 *  - a CLEARED decision suggests the two approvals (that is the road to
 *    Gate & Passport);
 *  - a BLOCKED decision suggests locking, for the MLRO who can;
 *  - anything else suggests nothing — the change is context the operator
 *    brings, not something this rule should guess.
 * The current status is never suggested (it is already the state), and
 * MLRO-only statuses never reach anyone else's list.
 */
export function gateOptionGroups(args: {
  decisionOutcome: string | null;
  currentGate: string | null;
  isMlro: boolean;
}): GateOptionGroups {
  const allowed = GATE_CHOICES.filter((c) => args.isMlro || !c.mlroOnly);
  const suggestedValues: string[] =
    args.decisionOutcome === "cleared"
      ? ["approved", "approved_with_controls"]
      : args.decisionOutcome === "blocked" && args.isMlro
        ? ["locked"]
        : [];
  // In suggestion order (the plain approval leads), not catalogue order.
  const suggested = suggestedValues
    .map((v) => allowed.find((c) => c.value === v))
    .filter((c): c is GateChoice => Boolean(c) && c!.value !== args.currentGate);
  const suggestedSet = new Set(suggested.map((c) => c.value));
  return {
    suggested,
    other: allowed.filter((c) => !suggestedSet.has(c.value)),
  };
}
