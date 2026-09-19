/**
 * Whether Stage 6 — Funding & transaction — is owed on this case.
 *
 * ── What was wrong ────────────────────────────────────────────────────
 * Stage 6 was never *decided*. It was simply not spoken for.
 *
 * `fundingStage` in the journey model reads zero recorded source-of-funds
 * items as `not_started`, with a blocker and an owner. But the next-action
 * ranking had only one funding candidate, and it was gated on
 *
 *     facts.funding.sources.length > 0 && unverified.length > 0
 *
 * — it fired only once somebody had ALREADY started. A case with nothing
 * recorded, which is every case at the moment Stage 5 finishes, produced no
 * candidate at all. So the ranking, which orders by journey position, went
 * straight from Stage 5 to Stage 7, and the operator was told "Stages 2–6
 * have nothing outstanding on this reading" while Stage 6's own reading
 * carried an unmet blocker.
 *
 * Measured on `AML-2026-00005`: 0 `source_of_funds` rows, 0 transactions,
 * `case_stage = client_submitted`, and the next action pointing at Stage 7.
 *
 * ── The rule, and why it is the perimeter ─────────────────────────────
 * Source-of-funds evidence is customer due diligence, and this platform
 * already takes that position in its own data: `seed_default_requirements`
 * writes `source_of_funds` with `required: true` (and `source_of_wealth`
 * with `required: false`). So the default is OWED.
 *
 * The single lever that can stand it down is the **perimeter** — whether a
 * designated service is being provided at all. That is the same lever, and
 * the only lever, that reaches sanctions; `SCREENING_SCOPE.md` records why
 * risk may never be one. A case recorded as an enquiry that never became a
 * deal has no customer to conduct due diligence on. Nothing else stands it
 * down: not the risk rating, not the absence of a transaction, and not the
 * fact that nobody has got round to it.
 *
 * Two rules follow, both borrowed from the screening scope because the same
 * reasoning applies:
 *
 *   - **An unclassified case is not an exempt one.** With no perimeter
 *     recorded, the default is INSIDE, so funding evidence is required.
 *     Silence is not an exemption.
 *   - **Enhanced due diligence is checked first and cannot be reached.** A
 *     case in EDD — rated high or prohibited, flagged `edd_required`, or
 *     carrying a PEP finding — owes source of funds under the enhanced
 *     measures, and this returns `nonWaivable` so no later reading can
 *     quietly relax it.
 */

export type FundingObligationReading = "required" | "not_required";

export interface FundingObligation {
  reading: FundingObligationReading;
  /**
   * Why, in the operator's words. Always present — including when the answer
   * is "required", because a stage that appears without explanation is the
   * other half of the defect this module exists for.
   */
  reason: string;
  /** True when enhanced due diligence makes it mandatory. */
  nonWaivable: boolean;
  /** The recorded facts it was decided from, for the audit trail. */
  sourceFacts: string[];
}

export interface FundingObligationInput {
  /**
   * The recorded perimeter classification, from `sync_screening_stage`.
   * Absent or unclassified means INSIDE — the safe default, and the same one
   * `deriveScreeningScope` takes.
   */
  perimeter?: {
    classified?: boolean | null;
    classification?: string | null;
    reason_code?: string | null;
  } | null;
  riskRating?: string | null;
  /** `case.status === "edd_required"`. */
  enhancedDueDiligence?: boolean;
  /** Some party on this case is determined to be a PEP. */
  pepFinding?: boolean;
}

const EDD_RISK = new Set(["high", "prohibited"]);

export function deriveFundingObligation(input: FundingObligationInput): FundingObligation {
  const risk = String(input.riskRating ?? "").toLowerCase();
  const classified = input.perimeter?.classified === true;
  const classification = classified ? input.perimeter?.classification ?? null : null;
  const reasonCode = input.perimeter?.reason_code ?? null;

  const sourceFacts = [
    `perimeter = ${classification ?? "unclassified"}`,
    `risk_rating = ${risk || "unrated"}`,
    `enhanced_due_diligence = ${input.enhancedDueDiligence === true}`,
    `pep_finding = ${input.pepFinding === true}`,
  ];

  /*
   * Enhanced due diligence first, and deliberately before the perimeter.
   * A case that has reached EDD is one this business is serving; ordering it
   * after the lever would let a mis-recorded classification stand down the
   * strictest funding obligation there is.
   */
  const eddReasons: string[] = [];
  if (EDD_RISK.has(risk)) eddReasons.push(`the case is rated ${risk} risk`);
  if (input.enhancedDueDiligence === true) eddReasons.push("the case is in enhanced due diligence");
  if (input.pepFinding === true) {
    eddReasons.push("a party to this case is a politically exposed person");
  }
  if (eddReasons.length > 0) {
    return {
      reading: "required",
      nonWaivable: true,
      reason: `Source of funds is required under enhanced due diligence — `
        + `${eddReasons.join(", and ")}. Nothing stands this down.`,
      sourceFacts,
    };
  }

  if (classification === "outside_perimeter") {
    return {
      reading: "not_required",
      nonWaivable: false,
      reason: "This case is recorded as outside the perimeter"
        + (reasonCode ? ` — ${String(reasonCode).replace(/_/g, " ")}` : "")
        + ", so no designated service is being provided and there is no customer "
        + "to gather funding evidence about. Nobody was assessed and nothing was "
        + "cleared.",
      sourceFacts,
    };
  }

  return {
    reading: "required",
    nonWaivable: false,
    reason: classified
      ? "A designated service is being provided, so source-of-funds evidence is "
        + "part of the customer due diligence owed on this case."
      : "Nobody has recorded whether a designated service is being provided. An "
        + "unclassified case counts as inside the perimeter, so source-of-funds "
        + "evidence is required.",
    sourceFacts,
  };
}
