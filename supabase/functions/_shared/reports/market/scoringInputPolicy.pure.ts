/**
 * The forward-only scoring policy — what may reach a client's overall grade.
 *
 * ## What this closes
 *
 * Two measured findings sit behind this module, both on the live corpus of
 * 1,006 scored reports:
 *
 * **The grade was never evidenced** (`SCORING_ACCURACY_ZERO_COST_CLOSEOUT.md`).
 * Growth scored exactly 50 on 1,005 of 1,006 reports and Demand likewise, with
 * `hasData: false` on all 1,006 — so 55% of every grade issued was a constant.
 *
 * **The inputs that did report data cannot be trusted**
 * (`SCORING_INPUT_INTEGRITY_CLOSEOUT.md`). Location's three inputs are a
 * per-state template, a fabricated commute (mean 10,125 minutes, non-NSW
 * reports routed to Sydney) and a school count at its ceiling on 851 of 1,114.
 * Trusted Location coverage is **0 of 1,006**.
 *
 * The scoring service already knew how to withhold a headline —
 * `dataInsufficient` suppresses `totalScore` below three measured dimensions —
 * and the path had simply never fired, because a dimension computed from
 * defaults still reported `hasData: true`. **This module makes `hasData`
 * honest.** Nothing else in the scorer changes.
 *
 * ## Two independent rules, and why both are needed
 *
 * **Trust** asks whether the number is believable. **Ownership** asks whether
 * it belongs to the dimension reading it. They are different questions and an
 * input can fail either:
 *
 *   * a walk score is the right input for Location and is not believable;
 *   * a buyer's LVR is perfectly believable and is not a fact about the
 *     property at all.
 *
 * Ownership mirrors `dimensionOwnership.pure.ts` — the matrix Risk Model D is
 * built on — in this service's own input vocabulary. Buyer leverage and buyer
 * cash flow are owned by `finance` and forbidden to every dimension, which is
 * why V1's Risk (40% leverage, 30% serviceability) has no admissible input
 * left and stops scoring.
 *
 * ## Forward-only by construction
 *
 * This decides what a NEW scoring run may count. It reads no stored row and
 * writes none, so no historical report is touched, nothing is migrated and
 * nothing is recomputed. A stored score stays exactly as it was issued.
 *
 * ## Trusted evidence leads to V2, never back to V1
 *
 * `verifiedInputs` lets a caller mark an input as verified, and it is worth
 * being exact about what that does and does not mean, because an earlier draft
 * of this module overstated it.
 *
 * It affects **admissibility only** — whether a dimension may count an input.
 * It has no bearing on {@link ScoringAuthority}, so no amount of verification
 * makes V1 authoritative for a new report. Evidence and authority are answered
 * separately and deliberately: gating inputs alone would have left a trapdoor
 * where verifying three inputs later quietly reinstates the legacy methodology
 * as the production grade engine, which is a decision nobody would have taken.
 *
 * The intended path for genuinely trusted evidence is:
 *
 *     trusted evidence → Scoring V2 engine → score output contract
 *                      → report fact contract → reporting
 *
 * after an explicit V2 production activation that WIRES THAT ENGINE. It is
 * **not**:
 *
 *     trusted evidence → legacy V1 reactivation
 *
 * and it is not a label change inside this service either — see
 * {@link LegacyScoringAuthority}.
 *
 * **The field is wired to exactly one live path, and it is derived, never
 * read.** Until 16 September 2026 nothing set it: `transformInputData` (V1)
 * does not carry it and `productionInputFrom` (V2) passed `[]`, with this
 * header recording that wiring it needed "the repair of the location service,
 * with a decision behind it". Both arrived. The repair is the measured
 * location chain — granularity-gated geocoding
 * (`GEOCODING_WITHOUT_GOOGLE.md`), coordinate-true amenities from the OSM
 * register or Places, a real commute route (OSRM or the Distance Matrix) —
 * with every acquisition stamped by RF-7.2B with its subject and stage
 * outcomes. The decision is the platform owner's instruction of 16 September
 * 2026 that a measured run stop scoring as partial. So
 * `productionInputFrom` now DERIVES `verifiedInputs` from that acquisition
 * stamp (`locationInputVerification.pure.ts`): subject-matched, stage-proven
 * readings verify; a stampless enrichment — every row persisted before
 * RF-7.2B — verifies nothing and scores exactly as before. The request
 * field itself is still never trusted: a caller cannot assert verification,
 * because the evidence travels with the enrichment object, not the request.
 * V1's path is untouched and still cannot grade.
 */

/** Bumped whenever a class or a rule changes. Stamped on every new score. */
export const SCORING_INPUT_POLICY_VERSION = '1.1.0';

/**
 * How an input earns its place in a score.
 *
 * `operator_entered` is admissible as supplied because a person typed it about
 * THIS property for THIS report; it is the only class that needs no external
 * verification. The other two are inadmissible until declared verified, and
 * they are kept apart because the remedy differs: one needs the measurement
 * repaired, the other needs the evidence acquired.
 */
export type InputClass = 'operator_entered' | 'requires_repair' | 'requires_evidence';

/**
 * Every input the property scorer reads, by class.
 *
 * An input absent from this map is unknown to the policy and is refused —
 * failing closed, so adding an input to the scorer without classifying it
 * cannot silently widen what counts.
 */
export const INPUT_CLASSES: Readonly<Record<string, InputClass>> = {
  // Supplied by a person about this property.
  propertyPrice: 'operator_entered',
  weeklyRent: 'operator_entered',
  cashFlow: 'operator_entered',
  lvr: 'operator_entered',
  // Measured wrongly before the location repair (the integrity closeout).
  // The class deliberately stays `requires_repair`: what changed is that a
  // run whose enrichment carries a subject-matched RF-7.2B acquisition stamp
  // is declared verified per run (`locationInputVerification.pure.ts`), so a
  // stamped, stage-proven reading counts and a stampless legacy one still
  // cannot.
  walkScore: 'requires_repair',
  commuteTimeCBD: 'requires_repair',
  schoolsNearby: 'requires_repair',
  // Suburb-level market evidence the deployment does not hold.
  priceGrowth1Year: 'requires_evidence',
  priceGrowth3Year: 'requires_evidence',
  populationGrowth: 'requires_evidence',
  vacancyRate: 'requires_evidence',
  daysOnMarket: 'requires_evidence',
  medianSuburbPrice: 'requires_evidence',
  unemploymentRate: 'requires_evidence',
};

export type ScoredDimension = 'yield' | 'growth' | 'location' | 'demand' | 'risk';

/**
 * Which dimension owns each input.
 *
 * `finance` is not a dimension: it is the buyer's own position, reported
 * beside the score and never inside it (`financeSuitability.pure.ts`). 1 Boxer
 * Drive carries two same-day reports at the same price and different leverage;
 * under the old model that was 12.8 points of Risk for a number an operator
 * typed.
 */
export const INPUT_OWNER: Readonly<Record<string, ScoredDimension | 'finance'>> = {
  propertyPrice: 'yield',
  weeklyRent: 'yield',
  cashFlow: 'finance',
  lvr: 'finance',
  walkScore: 'location',
  commuteTimeCBD: 'location',
  schoolsNearby: 'location',
  priceGrowth1Year: 'growth',
  priceGrowth3Year: 'growth',
  populationGrowth: 'demand',
  vacancyRate: 'demand',
  daysOnMarket: 'demand',
  medianSuburbPrice: 'demand',
  unemploymentRate: 'demand',
};

/** Why one input was refused, in terms an engineer can act on. */
export interface InputRuling {
  input: string;
  admitted: boolean;
  /** Set only when refused. */
  reason: 'unclassified' | 'not_owned_by_dimension' | 'awaiting_repair' | 'awaiting_evidence' | null;
}

/**
 * Rule on one input for one dimension.
 *
 * Ownership is checked first: an input the dimension does not own is refused
 * whatever its trust class, because a believable number in the wrong place is
 * the double-count this programme removed.
 */
export function ruleOn(
  dimension: ScoredDimension,
  input: string,
  verifiedInputs: readonly string[],
): InputRuling {
  const cls = INPUT_CLASSES[input];
  if (!cls) return { input, admitted: false, reason: 'unclassified' };
  if (INPUT_OWNER[input] !== dimension) {
    return { input, admitted: false, reason: 'not_owned_by_dimension' };
  }
  if (cls === 'operator_entered' || verifiedInputs.includes(input)) {
    return { input, admitted: true, reason: null };
  }
  return {
    input,
    admitted: false,
    reason: cls === 'requires_repair' ? 'awaiting_repair' : 'awaiting_evidence',
  };
}

/** The inputs a dimension may actually count, from those the record presented. */
export function admissibleInputs(
  dimension: ScoredDimension,
  presented: readonly string[],
  verifiedInputs: readonly string[] = [],
): string[] {
  return presented.filter((i) => ruleOn(dimension, i, verifiedInputs).admitted);
}

// ---------------------------------------------------------------------------
// Who is allowed to publish a grade at all
// ---------------------------------------------------------------------------

/**
 * Which scoring system may speak for a report.
 *
 * The input policy decides what a dimension may COUNT. This decides something
 * prior and more important: **which engine is authoritative at all**. They are
 * separate because conflating them creates a trapdoor — gate V1's inputs and
 * the grade goes away today, but verify three of those inputs later and the
 * legacy methodology silently becomes the production grade engine again,
 * without anyone deciding that it should.
 *
 * `legacy_snapshot` — a score already issued under V1. It is a historical
 * record of what a client was sent on a date, it renders exactly as it always
 * did, and it is never recomputed.
 *
 * `unavailable` — no engine is authorised to publish an overall property grade
 * for a new report. This is today's state: V1 is not trusted to grade, and V2
 * is frozen but not activated.
 *
 * `v2` — the frozen Scoring V2 engine, after an explicit production activation
 * decision (ME-8). Set by `scoringV2Production.pure.ts` alone, since 15 Sep
 * 2026; this legacy service still cannot spell it.
 */
export type ScoringAuthority = 'legacy_snapshot' | 'unavailable' | 'v2';

/**
 * The authorities THIS service can produce — and `v2` is deliberately not one.
 *
 * This module lives inside the legacy V1 scorer. Changing a constant here to
 * `'v2'` would not make V1 execute the frozen Scoring V2 methodology; it would
 * authorise V1's own arithmetic and label it with V2's name, which is worse
 * than the unsupported grade this whole programme removed. So the legacy
 * service is **structurally incapable** of claiming that authority: the
 * constant and the stamp are typed to this narrower union, and `'v2'` there is
 * a compile error rather than a convention somebody has to remember.
 *
 * Real V2 activation is not a label change. It requires wiring the frozen
 * engine (`shadowScorer.pure.ts`) and consuming its own published result
 * (`scoreOutputContract.pure.ts`):
 *
 *     trusted evidence → Scoring V2 engine → score output contract
 *                      → report fact contract → reporting
 *
 * A reader still has to be able to RECOGNISE a v2-stamped score, which is why
 * the wider {@link ScoringAuthority} exists and why the predicates below take
 * it. Reading one is not the same as being able to mint one.
 */
export type LegacyScoringAuthority = Exclude<ScoringAuthority, 'v2'>;

/**
 * The authority a NEW report is scored under.
 *
 * Deliberately a constant rather than a flag read from configuration: making
 * V2 authoritative is a decision with a review behind it, and a value some
 * environment could set is not that decision. Changing this line was never
 * the activation and is not one now: V2 was activated (15 Sep 2026) by
 * WIRING the engine — `scoringV2Production.pure.ts` — and this constant
 * governs only what the legacy path may do, which is never grade.
 */
export const PRODUCTION_SCORING_AUTHORITY: LegacyScoringAuthority = 'unavailable';

/** May an overall score and letter grade be published under this authority? */
export function mayPublishOverallGrade(authority: ScoringAuthority): boolean {
  return authority === 'v2';
}

/**
 * May per-dimension SCORES be presented as assessments under this authority?
 *
 * A legacy snapshot may show its own dimension scores, because that is what the
 * client was sent. A new report may not show V1's, because a dimension score is
 * an assessment produced by a methodology — and presenting a legacy assessment
 * beside the frozen V2 name is the confusion this boundary exists to prevent.
 *
 * **This says nothing about deterministic metrics.** A gross yield of 4.69% is
 * a calculation over a verified price and rent; it is published whenever it is
 * supported, under every authority, and it is not this function's business.
 */
export function mayPublishDimensionScores(authority: ScoringAuthority): boolean {
  return authority === 'v2' || authority === 'legacy_snapshot';
}

/**
 * The authority a stored score was produced under.
 *
 * A score with no stamp predates this policy, so it is a legacy snapshot and
 * renders as it always has. Absence means history, never "unknown, so withhold"
 * — withholding there would rewrite what a client was already sent.
 */
export function authorityOf(score: unknown): ScoringAuthority {
  const policy = (score as { policy?: { authority?: unknown } } | null)?.policy;
  const value = policy?.authority;
  return value === 'unavailable' || value === 'v2' || value === 'legacy_snapshot'
    ? value
    : 'legacy_snapshot';
}

// ---------------------------------------------------------------------------
// What a client is told
// ---------------------------------------------------------------------------

/**
 * The client-facing statement when no overall grade may be issued.
 *
 * Factual, neutral and non-alarming on purpose: an absent grade is a statement
 * about OUR evidence, never about the property. Nothing here uses the word
 * "untrusted", "gate", "dimension" or any other term from this codebase.
 */
export const OVERALL_GRADE_UNAVAILABLE = {
  heading: 'Overall Investment Grade',
  value: 'Not available — insufficient verified evidence',
  explanation:
    'An overall investment grade is only issued when sufficient verified property '
    + 'evidence is available. Available measured analysis is shown below.',
} as const;

/**
 * Why one dimension was not assessed, in the client's words.
 *
 * One sentence each, naming what is missing rather than what the system did.
 */
export const NOT_ASSESSED_REASON: Readonly<Record<ScoredDimension, string>> = {
  growth: 'Not assessed — verified suburb-level growth evidence is currently unavailable.',
  demand: 'Not assessed — sufficient verified demand evidence is currently unavailable.',
  /**
   * Neutral about the CAUSE, because this sentence covers two of them and
   * only one is about the information.
   *
   * It used to read "the available location information does not meet the
   * current verification standard", which tells a reader their evidence was
   * inadequate. On the reported case the readings were obtained in full and
   * then not carried into the saved assessment — a defect of this product's
   * own, traced in `docs/reports/S2_LOCATION_EVIDENCE_TRACE.md` — so the
   * sentence blamed the customer's address for our own fault.
   *
   * A run whose location service genuinely failed also presents nothing, so
   * the client sentence may not name either cause. It says what is true of
   * both; the operator `detail` beside it already distinguishes them, and
   * `LOCATION_PRESENTED_UNVERIFIED` is the one case where the standard IS the
   * reason and may be stated.
   */
  location: 'Not assessed — no location readings reached this assessment for the property.',
  risk: 'Not assessed — insufficient verified property-risk evidence is available.',
  yield: 'Not assessed — a verified purchase price and weekly rent are required.',
} as const;

/**
 * Location's other case: readings WERE presented and could not be matched to
 * this property. Here the verification standard really is the reason, and
 * saying so is accurate rather than a deflection.
 */
export const LOCATION_PRESENTED_UNVERIFIED =
  // One string rather than a concatenation with `as const` on it: a const
  // assertion may only be applied to a literal, and `'a' + 'b' as const` is
  // TS1355. The frontend `tsc` never sees this tree — the edge functions are
  // checked by Deno alone — so it read clean locally and failed CI.
  'Not assessed — the location readings recorded for this property could not be matched to it with the evidence stored alongside them.';

/** The label a dimension carries where it did score. */
export const ASSESSED_LABEL = 'Measured' as const;

// ---------------------------------------------------------------------------
// Qualitative claims
// ---------------------------------------------------------------------------

/**
 * What a report may SAY, as opposed to what it may score.
 *
 * The authority boundary is not about numbers, it is about assessments — and a
 * sentence is an assessment. "Excellent location with strong amenities" makes
 * exactly the claim a Location dimension score makes, in words, and suppressing
 * the number while publishing the sentence would close the front door and leave
 * the back one open.
 *
 * Two kinds of claim, two different rules:
 *
 * **From a dimension SCORE** — "solid capital growth track record", read off a
 * growth score. Permitted only where that dimension was genuinely measured AND
 * an authorised methodology produced it. Under `unavailable` there is none, so
 * none of these may be made.
 *
 * **From an INPUT's value** — "higher than ideal vacancy rate", read off the
 * vacancy figure itself. Permitted only where the policy admitted that input,
 * which is what stops a per-state walk-score template becoming "high
 * walkability" in prose.
 *
 * What survives either way is a **fact**: a gross yield of 4.69%, a rent of
 * $650, a purchase price. Those are calculations over verified inputs and are
 * described freely — an unauthorised methodology simply may not convert them
 * into a verdict about the property.
 *
 * **Buyer facts are a separate case and do not appear here at all.** Leverage
 * and holding cash flow are owned by `finance` and admitted to no dimension,
 * so `fromInput` refuses them for every property claim. That is deliberate
 * rather than incidental: a borrowing position is not a property weakness. The
 * figures stay fully available in Finance Suitability and the financial
 * analysis, which is where a reader can act on them.
 */
export interface ClaimPermits {
  /** May a claim be made from this dimension's score? */
  fromDimensionScore(dimension: ScoredDimension): boolean;
  /** May a claim be made from this input's own value? */
  fromInput(input: string): boolean;
}

export function claimPermits(opts: {
  authority: ScoringAuthority;
  measuredDimensions: readonly ScoredDimension[];
  admittedInputs: readonly string[];
}): ClaimPermits {
  const scoresSpeak = mayPublishDimensionScores(opts.authority);
  const measured = new Set(opts.measuredDimensions);
  const admitted = new Set(opts.admittedInputs);
  return {
    fromDimensionScore: (dimension) => scoresSpeak && measured.has(dimension),
    fromInput: (input) => admitted.has(input),
  };
}

// ---------------------------------------------------------------------------
// The stamp a new score carries
// ---------------------------------------------------------------------------

/**
 * What a new score records about how it was decided.
 *
 * Deliberately small — five fields the Reporting Fact Contract can adopt
 * unchanged. `gradeIssued` is stored rather than re-derived because "was a
 * grade published" is a question about this run, and answering it later by
 * re-reading a score is how two surfaces come to disagree.
 */
export interface ScoringPolicyStamp {
  scoringSystem: 'investment-scoring-service';
  inputPolicyVersion: string;
  /**
   * Which engine was authorised to publish a grade for this run.
   *
   * Narrowed to {@link LegacyScoringAuthority}: a stamp written by this service
   * can never say `v2`, because this service is not V2.
   */
  authority: LegacyScoringAuthority;
  /** May this run's per-dimension scores be shown as assessments? */
  dimensionScoresAuthoritative: boolean;
  /** True only when the run published an overall grade. */
  gradeIssued: boolean;
  eligibility: 'issued' | 'insufficient_verified_evidence' | 'no_authorised_scoring_system';
  /** Dimensions that counted, after the policy. */
  measuredDimensions: ScoredDimension[];
  evaluatedAt: string;
}

export function policyStamp(
  measuredDimensions: ScoredDimension[],
  evidenceSufficient: boolean,
  now: Date,
  authority: LegacyScoringAuthority = PRODUCTION_SCORING_AUTHORITY,
): ScoringPolicyStamp {
  // Both must hold. Evidence alone never publishes a grade — that is the
  // trapdoor this boundary closes — and authority alone never invents one.
  const gradeIssued = evidenceSufficient && mayPublishOverallGrade(authority);
  return {
    scoringSystem: 'investment-scoring-service',
    inputPolicyVersion: SCORING_INPUT_POLICY_VERSION,
    authority,
    dimensionScoresAuthoritative: mayPublishDimensionScores(authority),
    gradeIssued,
    eligibility: gradeIssued
      ? 'issued'
      : mayPublishOverallGrade(authority)
        ? 'insufficient_verified_evidence'
        : 'no_authorised_scoring_system',
    measuredDimensions,
    evaluatedAt: now.toISOString(),
  };
}
