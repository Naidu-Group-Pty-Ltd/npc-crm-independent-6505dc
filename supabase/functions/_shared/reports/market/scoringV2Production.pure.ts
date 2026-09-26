/**
 * ME-8 — Scoring V2 as the production grade engine.
 *
 * ## The decision this records
 *
 * On 15 September 2026 the platform owner instructed that the grading system
 * be rectified: every new report was reading "Grade withheld — no scoring
 * system is currently authorised to issue an overall grade", because
 * `PRODUCTION_SCORING_AUTHORITY` was `unavailable` (V1 is not trusted to
 * grade) and Scoring V2 was frozen but never wired. This module is the
 * activation: the frozen engine (`shadowScorer.pure.ts`) is the one that
 * scores a new property report, and its result is projected onto the record
 * every reader already understands.
 *
 * `SCORING_V2_ACTIVATION` is the record of that decision. It is a constant
 * rather than configuration because activating an engine is a decision with a
 * review behind it — the same reason `PRODUCTION_SCORING_AUTHORITY` was — and
 * an environment variable is not that decision.
 *
 * ## What activation does NOT change
 *
 * **Nothing about the methodology.** Weights, anchors, eligibility ceilings
 * and the missing-data contract are the frozen engine's, untouched and still
 * pinned by `scoringMethodology.spec.ts`. Activation wires the engine; it
 * does not tune it.
 *
 * **Nothing about what may count.** The forward-only input policy still rules
 * on Location: its three inputs are `requires_repair` and count only when
 * declared verified for the run. Since IPV 1.1.0 (16 Sep 2026) that
 * declaration is DERIVED by the scoring service from the enrichment's own
 * RF-7.2B acquisition stamp — subject-matched, stage-proven readings verify
 * (`locationInputVerification.pure.ts`); a stampless legacy enrichment
 * verifies nothing, and Location then stays null and disclosed exactly as
 * before, with regeneration (which re-acquires with a stamp) as the remedy.
 *
 * **Nothing stored.** No historical row is recomputed. A score issued under V1
 * keeps its stamp; a withholding keeps its stamp; the next run of a report is
 * the first to carry `authority: 'v2'`.
 *
 * ## Publication: three valid dimensions, proportionally weighted
 *
 * Two rules used to stand between a measured assessment and a published
 * grade, and S5/S6 §4 and §8 removed both.
 *
 * **Growth was required**, over and above the engine's floor. The reasoning
 * was sound on its own terms: without Growth's 40 points the DELIVERED-points
 * ceiling capped the letter at a B and typically a C, so the grade read as a
 * statement about missing data wearing the shape of a statement about the
 * property. But the premise was that ceiling, and the ceiling itself was the
 * defect — `gradeEligibility` 3.0.0 removed it, because it lowered a grade
 * solely because a dimension was unavailable, which contradicts proportional
 * scoring. With the ceiling gone the premise goes with it: a three-dimension
 * assessment is scored across the dimensions it HAS, and 70% of the matrix
 * assessed is a real finding rather than a 60-point cap.
 *
 * **The five-dimension completion gate** (18 September 2026) withheld the
 * letter until all five scored. That is the right answer to "is this
 * assessment complete" and the wrong answer to "may a client be told what we
 * measured". It is superseded by the same sections.
 *
 * What rules now is `scorePublicationPolicy.pure.ts`: five of five issues a
 * score and grade; four and three issue a QUALIFIED score and grade computed
 * proportionally over the valid dimensions' original weights; two or fewer
 * publish no score, no grade, no gauge and no score-derived verdict, and say
 * briefly why. A dimension counts only where it produced a finite 0–100
 * score — a genuine zero counts, a `scored: true` flag alone never does.
 *
 * Every remaining safeguard is about the EVIDENCE rather than the count: the
 * A/A+ growth-confidence and evidence-quality tests stand, because they
 * answer "can this evidence carry this claim", which is a different question
 * from "how many dimensions answered".
 *
 * ## The letter is the band of the number (eligibility 5.0.0, 24 Sep 2026)
 *
 * Those tests used to CAP the letter, and on 24 September 2026 the owner's
 * list showed why that could not stand: 60 Lawley Street at **B+ · 89** beside
 * 9 Hollow Street at **A · 77**. Lawley's growth came from the ABS state
 * series for Western Australia, whose confidence cannot exceed 44 of 100, one
 * point under the A test — so every property graded on a state series was
 * held at B+ whatever it scored, and the number beside the letter said
 * something else. The owner's decision: the letter follows the score, and A+
 * starts at 80. The tests now decide whether `evidenceCaution` travels with
 * the grade — the engine's own sentence saying what the evidence is — and
 * every surface that prints the grade prints it beside it.
 *
 * ## Absence is named, never hidden
 *
 * A withheld grade used to say only "insufficient verified evidence". Here it
 * carries `gradeGaps`: one entry per unmeasured dimension, with the client
 * sentence (`NOT_ASSESSED_REASON`, no codebase vocabulary), the operator
 * detail (the provider's refusal, the missing postcode, the unrepaired
 * inputs) and the remedy. The Generated Reports card and the report page
 * render the same list, so an operator asking "why is there no grade" is
 * told what would change it.
 *
 * Pure: no HTTP, no clock beyond the injected `now`, Deno-parseable. The only
 * production entrypoint that may import it is `investment-scoring-service`,
 * asserted by the pin spec.
 */

import {
  connectRiskEvidence,
  readStoredRiskReadings,
  type RiskEvidenceConnection,
} from '../risk/riskEvidenceConnection.pure.ts';
import {
  type EvidenceKey,
  type EvidencePoint,
  type EvidenceProvider,
  type EvidenceSubject,
  type MarketEvidence,
  emptyEvidence,
  mayReachClientReport,
} from './marketEvidence.pure.ts';
import {
  MIN_DIMENSIONS_FOR_GRADE,
  SHADOW_METHODOLOGY_VERSION,
  scoreInvestmentV2,
  type DimensionKey,
  type ShadowScoreInput,
  type ShadowScoreResult,
} from './shadowScorer.pure.ts';
import { buildScoreOutput, type ScoreOutput } from './scoreOutputContract.pure.ts';
import { buildEvidenceStatement, type EvidenceStatement } from './evidenceStatement.pure.ts';
import { applyEligibility, growthEvidenceGrain } from './gradeEligibility.pure.ts';
import {
  admissibleInputs,
  claimPermits,
  LOCATION_MEASURED_AT_AREA_CENTRE,
  LOCATION_PRESENTED_UNVERIFIED,
  NOT_ASSESSED_REASON,
  OVERALL_GRADE_UNAVAILABLE,
  SCORING_INPUT_POLICY_VERSION,
  type ScoredDimension,
} from './scoringInputPolicy.pure.ts';
import { dwellingTypeFor } from './domainEvidence.pure.ts';
import { riskRemedyFor } from '../risk/propertyRiskSchema.pure.ts';
import { measuredVolumeNote, volumeRemedyClause } from './openData/salesVolumePublishers.pure.ts';
import {
  MIN_VALID_DIMENSIONS_TO_PUBLISH,
  PUBLICATION_DIMENSIONS,
  SCORE_PUBLICATION_POLICY_VERSION,
  decidePublication,
  type PublicationDecision,
} from './scorePublicationPolicy.pure.ts';

export { dwellingTypeFor };

/** Bumped whenever the projection or the activation conditions change. */
export const SCORING_V2_PRODUCTION_VERSION = '1.2.0';

/**
 * The activation record. Editing it is the decision; nothing reads an
 * environment variable for any of this.
 */
export const SCORING_V2_ACTIVATION = {
  approved: true,
  approvedOn: '2026-09-15',
  reference: 'ME-8',
  decidedBy: 'platform owner instruction, 15 September 2026 — "rectify the grading system … execute accordingly"',
  methodologyVersion: SHADOW_METHODOLOGY_VERSION,
  /** The engine's own floor, restated so the record is self-describing. */
  minDimensions: MIN_DIMENSIONS_FOR_GRADE,
  /**
   * Dimensions that must be measured before a grade is issued, over and above
   * the floor.
   *
   * **Empty, and deliberately kept rather than deleted** (S5/S6 §8: "do not
   * retain a blanket Growth-required publication rule"). It named Growth
   * until 18 September 2026, for a reason that rested entirely on the
   * delivered-points ceiling `gradeEligibility` 3.0.0 removed — see the
   * header. The field stays so the supersession is legible and so an
   * evidence-based requirement, if one is ever justified, has somewhere to go
   * that is not a second gate: `describeGaps` and the publication decision
   * both still read it.
   */
  requiredDimensions: [] as ReadonlyArray<DimensionKey>,
} as const;

/**
 * The publication rule, as a record of the decision that set it.
 *
 * A constant rather than configuration, for the reason `SCORING_V2_ACTIVATION`
 * is: deciding when a client may be shown a grade is a decision with a review
 * behind it, and an environment variable is not that decision.
 */
export const SCORE_PUBLICATION_GATE = {
  effectiveFrom: '2026-09-18',
  reference: 'S5/S6 §4, §7 and §8',
  decidedBy: 'platform owner instruction, 18 September 2026 — issue a qualified score and grade '
    + 'on four or three validly assessed dimensions, calculated proportionally over their '
    + 'original weights; publish no score below three',
  policyVersion: SCORE_PUBLICATION_POLICY_VERSION,
  minValidDimensions: MIN_VALID_DIMENSIONS_TO_PUBLISH,
  supersedes: 'the five-dimension completion gate (18 September 2026) and the Growth-required '
    + 'publication rule (ME-8, 15 September 2026)',
  changes: 'WHEN a score and grade are published, and how the score is weighted when fewer than '
    + 'five dimensions were assessed. No weight, anchor, threshold or measurement changes.',
} as const;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ProductionPropertyInput {
  /** Purchase price, dollars. The yield basis. */
  price: number | null;
  /** Weekly rent actually established for this property, or null. Never a guess. */
  weeklyRent: number | null;
  /** Annual outgoings where known; null otherwise. */
  annualOutgoings?: number | null;
  /** The stored property type. Selects the Risk schema; never scored. */
  propertyType: string | null;
}

export interface ProductionFinanceInput {
  lvr: number | null;
  weeklyCashFlow: number | null;
}

/**
 * Location inputs as the record presents them. They are admitted only when
 * named in `verifiedInputs` — the forward-only policy's rule, unchanged.
 */
export interface ProductionLocationInput {
  walkScore?: number | null;
  commuteTimeCBD?: number | null;
  schoolsNearby?: number | null;
  /**
   * Per-category amenity readings (`locationIntelligence.amenities`): the
   * count and the distance to the nearest of each kind.
   *
   * Preferred over `walkScore` by `scoreLocation`, because the composite
   * saturates and distance does not. Admitted on the SAME declaration as
   * `walkScore` — it is the same enrichment, acquired in the same pass under
   * the same RF-7.2B stamp, so admitting one and refusing the other would
   * score a repaired reading beside an unrepaired one.
   */
  amenities?: ReadonlyArray<{
    category: string;
    count?: number | null;
    distance?: number | null;
  }> | null;
  /**
   * Where the commute was measured TO, as the enrichment recorded it.
   *
   * Carried on the SAME admission as the commute itself — it describes that
   * reading and nothing else, so admitting the minutes while refusing the
   * destination would score a number whose basis had been withheld.
   *
   * An enrichment written before the destination was recorded carries none,
   * and `scoreLocation` then behaves exactly as it did. See
   * `urbanCentre.pure.ts` for why a commute to somewhere that is not this
   * property's urban centre is not scored.
   */
  commuteDestination?: {
    label?: string | null;
    ownCentre?: 'yes' | 'no' | 'unknown' | null;
  } | null;
}

/** The market evidence a caller assembled from its adapters. */
export interface ProductionMarketEvidence {
  points: Partial<Pick<MarketEvidence, EvidenceKey>>;
  providersConsulted: ReadonlyArray<EvidenceProvider>;
  providersUnavailable: ReadonlyArray<{ provider: EvidenceProvider; reason: string }>;
}

export interface ProductionScoringInput {
  subject: EvidenceSubject;
  market: ProductionMarketEvidence;
  property: ProductionPropertyInput;
  finance: ProductionFinanceInput;
  location?: ProductionLocationInput;
  /** Inputs declared verified for this run, in the policy's vocabulary. */
  verifiedInputs?: ReadonlyArray<string>;
  /**
   * Why the location readings verified nothing because of the POINT they
   * were measured from (`locationInputVerification` rule 4) — so the gap says
   * "measured from the centre of the suburb" rather than blaming a stamp.
   */
  locationPointRefusal?: 'measured_at_area_centre' | 'point_precision_unrecorded' | null;
  /**
   * Why no market evidence could be sought at all — no trusted geography, no
   * postcode. Named so the gap can say so rather than "provider unavailable".
   */
  evidenceWithheldReason?: string | null;
  /**
   * What the planning and hazard registers answered FOR THIS ASSESSMENT, as
   * stored on the record. Absent means no register was queried for this run,
   * which is a different state from every register answering and finding
   * nothing — `connectRiskEvidence` keeps the two apart.
   */
  riskEvidence?: unknown;
  /** The questions the subject's asset class actually asks, from the schema. */
  riskQuestionIds?: readonly string[];
  now: Date;
}

// ---------------------------------------------------------------------------
// Output — the record every reader already understands
// ---------------------------------------------------------------------------

/** The stamp a V2 run writes. Shape-compatible with the legacy stamp, authority `v2`. */
export interface ScoringV2PolicyStamp {
  scoringSystem: 'scoring-v2';
  inputPolicyVersion: string;
  methodologyVersion: string;
  /**
   * Which publication methodology graded this record.
   *
   * Version-aware by construction: a record stamped with this was graded
   * PROPORTIONALLY, over the original weights of the dimensions that were
   * validly scored, with no delivered-points ceiling. A record WITHOUT it
   * predates the policy and was graded under the superseded rule, where the
   * delivered points at the original weights capped the letter.
   *
   * `scoreAssessmentReading` reads its presence to decide which explanation to
   * give, so a historical grade is explained by the method that produced it
   * rather than silently recomputed under a newer one.
   */
  publicationPolicyVersion: string;
  authority: 'v2';
  dimensionScoresAuthoritative: true;
  gradeIssued: boolean;
  eligibility: 'issued' | 'insufficient_verified_evidence';
  measuredDimensions: ScoredDimension[];
  evaluatedAt: string;
  activation: { reference: string; approvedOn: string; productionVersion: string };
}

/**
 * One named reason the grade was withheld, or a dimension was not assessed.
 *
 * **Every field here declares its audience, and `remedy` did not.** `reason`
 * was documented "the client sentence, no codebase vocabulary" and `detail`
 * "the operator detail" from the day this was written; `remedy` said only
 * "what would close the gap", and the Compass's *What each dimension rested
 * on* bullets read it through `exclusionRemedy`.
 *
 * Executed against a stored score on 21 Sep 2026, that printed to a client:
 *
 *     Regenerate the report: the location service re-acquires the enrichment
 *     with its acquisition stamp (RF-7.2B) … locationInputVerification.pure.ts
 *
 *     … the open sales register's own transaction counts for this market
 *     (market-sales-ingest; NSW and QLD carry one on every row, VIC and SA
 *     one per load) …
 *
 *     Evidence this deployment does not hold: condition and maintenance.
 *
 * and growth's carried `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` and
 * `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` — repository paths, in a
 * customer's investment report. It is W4.7's rule (database vocabulary never
 * reaches the reader) at a far larger scale than the `osm_amenity_register`
 * that opened it, and it survived because `remedy` is CORRECT for the
 * audience it was written for: an operator reading the grade-gap card needs
 * the function name, the doc and the release code.
 *
 * So the operator field is untouched and a reader field is added beside it.
 */
export interface GradeGap {
  dimension: ScoredDimension;
  /** The client sentence. No codebase vocabulary. */
  reason: string;
  /** The operator detail: which provider, which refusal, which input. */
  detail: string;
  /**
   * The OPERATOR remedy: function names, documentation paths, release codes.
   * Never rendered to a customer — `READER_REMEDY` is that field.
   */
  remedy: string;
  /**
   * What is outstanding, in the reader's terms — what evidence is missing,
   * never how this platform would obtain it. Null on a legacy row, where the
   * client bullet renders its reason alone rather than falling back to
   * `remedy`, because falling back to `remedy` IS the defect.
   */
  readerRemedy: string | null;
  /** True when this gap alone withholds the grade. */
  withholdsGrade: boolean;
}

/**
 * The reader's half of each gap.
 *
 * Two rules. **Say what is missing, never how we would get it.** A customer
 * cannot act on "load market-sales-ingest", and a report that asks them to is
 * describing its own maintenance. What they can act on, or at least
 * understand, is which evidence the assessment did not have.
 *
 * And **each is a whole sentence, and says nothing its reason already said.**
 * These render immediately after `reason` in one bullet, so a noun phrase
 * lands as a fragment — "Not recorded. A recorded weekly rent and purchase
 * price for this property." — and a restated qualification lands as a
 * stammer: location's first draft closed "not a finding about the area"
 * three words after the reason closed "It is not a reading about the area".
 *
 * Kept as a keyed record rather than inline literals so the gate over it is
 * total: a dimension added without a reader sentence fails the type, and one
 * written with a repository path fails `gradeGapAudience.spec.ts`.
 */
export const READER_REMEDY: Readonly<Record<ScoredDimension, string>> = {
  growth: 'What is missing is a published price history for this suburb or council area \u2014 the '
    + 'market\u2019s own record of past sales, not anything about this property.',
  demand: 'What is missing is a published measure of how actively this market trades: sale '
    + 'volumes, days on market, vendor discounting or auction results. Population change is a '
    + 'supporting indicator and cannot stand in for one.',
  yield: 'What is missing is a recorded weekly rent and purchase price for this property.',
  location: 'What is missing is a verifiable record of those readings, which can be taken again.',
  risk: 'What is missing is property-specific risk measurement covering at least two independent '
    + 'subjects \u2014 for example a building condition assessment alongside hazard or planning '
    + 'controls checked against the parcel itself rather than a single map point.',
};

export interface ProductionDimensionScore {
  score: number;
  weight: number;
  details: string;
  hasData: boolean;
  dataPoints: string[];
  excluded: boolean;
}

export type ProductionBreakdownKey =
  | 'yieldScore' | 'growthScore' | 'locationScore' | 'demandScore' | 'riskScore';

export interface ProductionScoreRecord {
  totalScore: number | null;
  grade: string | null;
  recommendation: string;
  breakdown: Record<ProductionBreakdownKey, ProductionDimensionScore>;
  /**
   * The publication decision (S5/S6 §4 and §7): which dimensions were validly
   * assessed, their original and effective weights, whether a score may be
   * published, and the qualification that must travel with it.
   *
   * Carried on the record so every surface draws the RUN's own decision
   * rather than re-deriving it — one canonical assessment result across
   * generation, persistence, comparison and all five reports.
   */
  publication: PublicationDecision;
  coverage: {
    dimensionsScored: number;
    totalDimensions: number;
    coverageRatio: number;
    weightCovered: number;
    dataInsufficient: boolean;
    partialLabel: string;
    cotalityReady: true;
  };
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
  policy: ScoringV2PolicyStamp;
  /** The client-facing statement where no grade is issued; null when one is. */
  evidenceStatement: { heading: string; value: string; explanation: string } | null;
  /**
   * What the evidence behind an ISSUED grade can carry, where it would not
   * carry the letter on its own (eligibility 5.0.0) — or null.
   *
   * The letter is the band of the score; this is the finding that used to
   * lower it, now stated beside it. `statement` is one sentence a client may
   * read ("Capital growth is measured for Western Australia as a whole and
   * across all dwelling types, not for this property's suburb and dwelling
   * type."), `cautions` the operator's detail, `supports` the highest letter
   * the evidence carries on its own. Every surface that prints the grade
   * prints the statement beside it.
   */
  evidenceCaution: { statement: string; cautions: string[]; supports: string } | null;
  /** Per-dimension reason, in the client's words, for each dimension not assessed. */
  notAssessed: Record<string, string>;
  /** What the record offered before the engine ruled, for the audit trail. */
  dataPointsPresented: Record<string, string[]>;
  /** Every gap, named. Empty when every dimension measured. */
  gradeGaps: GradeGap[];
  /** The engine's own canonical output, for the audit trail and the assessment page. */
  v2: ScoreOutput & {
    productionVersion: string;
    activation: typeof SCORING_V2_ACTIVATION;
    /** The statement with every source named, for an internal reader. */
    internalEvidenceStatement: EvidenceStatement;
    /** Dimensions whose figures may not be printed to a client under their licence. */
    renderRestricted: { growth: boolean; demand: boolean };
    /**
     * Why no score was published, or null.
     *
     * `engine_floor` is the only value a run writes now: fewer than
     * {@link MIN_VALID_DIMENSIONS_TO_PUBLISH} dimensions produced a valid
     * score. `required_dimension` is retained in the union because rows
     * written before 18 September 2026 carry it — a stored value must stay
     * readable — and nothing writes it any more.
     */
    withheldBy: 'engine_floor' | 'required_dimension' | null;
  };
}

// ---------------------------------------------------------------------------
// Vocabulary bridges
// ---------------------------------------------------------------------------

const BREAKDOWN_KEY: Readonly<Record<DimensionKey, ProductionBreakdownKey>> = {
  yield: 'yieldScore',
  growth: 'growthScore',
  location: 'locationScore',
  demand: 'demandScore',
  risk: 'riskScore',
};

/** Evidence keys as the input policy names them, so `claimPermits` can rule on them. */
const POLICY_INPUT_FOR_EVIDENCE: Readonly<Partial<Record<EvidenceKey, string>>> = {
  growth1Year: 'priceGrowth1Year',
  growth3YearCagr: 'priceGrowth3Year',
  populationGrowth: 'populationGrowth',
  vacancyRate: 'vacancyRate',
  daysOnMarket: 'daysOnMarket',
  medianPrice: 'medianSuburbPrice',
};

/**
 * The recommendation a grade carries. The sentences are the ones V1 printed
 * for years, keyed on the LETTER rather than on V1's score bands, so a
 * document's vocabulary does not change with the engine behind it.
 */
export const RECOMMENDATION_BY_GRADE: Readonly<Record<string, string>> = {
  'A+': 'STRONG BUY - Excellent investment opportunity with strong fundamentals across all metrics',
  'A': 'BUY - Very good investment with solid potential for both income and capital growth',
  'B+': 'BUY - Good investment opportunity with favorable metrics in most areas',
  'B': 'HOLD/BUY - Moderate investment potential, consider your personal circumstances',
  'C+': 'HOLD - Above average investment with some positive indicators, monitor closely',
  'C': 'HOLD - Average investment with mixed indicators, monitor market conditions',
  'D': 'CAUTION - Below average investment, significant concerns identified',
  'F': 'AVOID - Poor investment opportunity with multiple red flags',
};

/** Dimension keys in the words a client reads, for the basis sentence. */
const DIMENSION_PROSE: Readonly<Record<string, string>> = {
  growth: 'capital growth',
  yield: 'rental yield',
  demand: 'demand',
  location: 'location',
  risk: 'property risk',
};

/**
 * A verdict never stands unqualified on an incomplete assessment.
 *
 * `RECOMMENDATION_BY_GRADE` is written as though every dimension had been
 * measured — "AVOID - Poor investment opportunity with multiple red flags",
 * "STRONG BUY … across all metrics". Measured 18 September 2026, **9 of 9
 * production runs that issued a grade did so on 3 of 5 dimensions**, location
 * and property risk excluded on every one, and two of those grades are F. So
 * the strongest negative sentence this product can print was reaching clients
 * on an assessment that had not looked at where the property is.
 *
 * It is also not merely a coverage caveat. The engine caps the grade at the
 * points actually DELIVERED, so an unmeasured dimension pushes the letter down
 * by arithmetic: on 18 Annabelle Crescent the uncapped composite is 40 (C) and
 * the delivered figure is 27.8 (F). An F formed that way is partly a statement
 * about missing data, and printing "multiple red flags" beside it is a claim
 * about the property that the run did not make.
 *
 * Two rules. **It says what the assessment RESTS ON, never what it lacks** —
 * the same rule the governed authority's recovery sentence answers to, because
 * a confession reads as a broken product where a basis reads as a scope. And
 * **full coverage is not qualified at all**, so the caveat keeps its meaning
 * rather than becoming a line every verdict wears.
 */
export function qualifyRecommendation(
  grade: string | null,
  measured: readonly string[],
  total: number,
): string {
  if (!grade) return OVERALL_GRADE_UNAVAILABLE.explanation;
  const raw = RECOMMENDATION_BY_GRADE[grade] ?? OVERALL_GRADE_UNAVAILABLE.explanation;
  if (measured.length >= total || measured.length === 0) return raw;
  // Two of the sentences describe a breadth the run did not reach. "Excellent
  // … across all metrics" beside "assessed on 4 of 5" contradicts itself in
  // one line, and the caveat loses to the claim because the claim comes
  // first. The scope is narrowed in the sentence rather than appended to it.
  const base = raw
    .replace(' across all metrics', ' across the metrics assessed')
    .replace(' in most areas', ' in most of the areas assessed');
  const names = measured.map((k) => DIMENSION_PROSE[k] ?? k);
  const list = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0];
  return `${base}. Assessed on ${measured.length} of ${total} dimensions: ${list}.`;
}

/*
 * A note that outlives the completion gate it was written for.
 *
 * `openDataGrowthWiring.spec.ts` scans this module's SOURCE for the first
 * `case 'growth':` and reads the remedy after it, to pin that `describeGaps`
 * sends an operator to the sales-register loader as well as to Domain. A
 * second switch on the same key defeats that guard by being found first, so
 * anything here that needs a per-dimension lookup uses a record rather than a
 * switch. The guard is right; the code avoids the collision instead.
 */

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** The evidence bundle the engine reads, from the caller's adapters. */
export function assembleEvidence(subject: EvidenceSubject, market: ProductionMarketEvidence): MarketEvidence {
  const ev = emptyEvidence(subject) as MarketEvidence & Record<string, unknown>;
  for (const [key, point] of Object.entries(market.points)) {
    if (point && typeof point === 'object' && 'value' in point) ev[key] = point;
  }
  ev.providersConsulted = [...market.providersConsulted];
  ev.providersUnavailable = market.providersUnavailable.map((u) => ({ ...u }));
  return ev as MarketEvidence;
}

/**
 * The risk answer set for this assessment, with its audit.
 *
 * Derived here rather than passed in, for the reason
 * `scoreAssessmentReading` records: a parameter a caller forgets takes a whole
 * dimension off the page with nothing reporting it.
 */
export function riskConnection(input: ProductionScoringInput): RiskEvidenceConnection {
  return connectRiskEvidence(
    input.riskQuestionIds ?? [],
    readStoredRiskReadings(input.riskEvidence),
  );
}

/** The engine input, with the policy ruling on Location's inputs. */
export function assembleEngineInput(input: ProductionScoringInput): ShadowScoreInput {
  const evidence = assembleEvidence(input.subject, input.market);
  const verified = input.verifiedInputs ?? [];
  const presentedLocation: string[] = [];
  const loc = input.location ?? {};
  if (num(loc.walkScore) !== null) presentedLocation.push('walkScore');
  if (num(loc.commuteTimeCBD) !== null) presentedLocation.push('commuteTimeCBD');
  if (num(loc.schoolsNearby) !== null) presentedLocation.push('schoolsNearby');
  const admittedLocation = new Set(admissibleInputs('location', presentedLocation, verified));

  return {
    evidence,
    yieldInputs: {
      basisAmount: input.property.price,
      basis: 'purchase',
      weeklyRent: input.property.weeklyRent,
      annualOutgoings: input.property.annualOutgoings ?? null,
      weeklyCashFlow: input.finance.weeklyCashFlow,
    },
    locationInputs: {
      walkScore: admittedLocation.has('walkScore') ? loc.walkScore : null,
      commuteTimeCBD: admittedLocation.has('commuteTimeCBD') ? loc.commuteTimeCBD : null,
      // The destination rides its own reading's admission: a commute that was
      // refused has no basis to state, and one that was admitted must state it.
      commuteDestination: admittedLocation.has('commuteTimeCBD')
        ? (loc.commuteDestination ?? null) : null,
      schoolsNearby: admittedLocation.has('schoolsNearby') ? loc.schoolsNearby : null,
      // Same enrichment, same acquisition stamp, same admission as the walk
      // score it replaces. See `ProductionLocationInput.amenities`.
      amenities: admittedLocation.has('walkScore') ? (loc.amenities ?? null) : null,
    },
    propertyRisk: {
      propertyType: input.property.propertyType,
      // Was a hardcoded `{}`, which made Property Risk structurally null on
      // every report this platform has ever produced — an unwired input, not a
      // methodology limit. The connection reads what the registers actually
      // answered for THIS assessment and produces an answer wherever an
      // approved, versioned conversion applies. None is approved yet, so the
      // set is still empty today; the difference is that it is now empty for a
      // recorded reason per question rather than by construction.
      answers: riskConnection(input).answers,
      growth1Year: evidence.growth1Year?.value ?? null,
    },
    finance: {
      lvr: input.finance.lvr,
      weeklyCashFlow: input.finance.weeklyCashFlow,
      purchasePrice: input.property.price,
    },
    audience: 'client',
    now: input.now,
  };
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

function providerClause(market: ProductionMarketEvidence, evidenceWithheldReason: string | null | undefined): string {
  if (evidenceWithheldReason) return evidenceWithheldReason;
  if (market.providersUnavailable.length) {
    return market.providersUnavailable.map((u) => `${u.provider}: ${u.reason}`).join('; ');
  }
  if (!market.providersConsulted.length) return 'no market-evidence provider was consulted';
  return `consulted ${market.providersConsulted.join(', ')}; the series carried no usable reading`;
}

/** The gaps, one per unmeasured dimension, with the operator detail and the remedy. */
export function describeGaps(
  input: ProductionScoringInput,
  result: ShadowScoreResult,
  withheldBy: ProductionScoreRecord['v2']['withheldBy'],
): GradeGap[] {
  const gaps: GradeGap[] = [];
  const required = new Set<DimensionKey>(SCORING_V2_ACTIVATION.requiredDimensions);
  for (const key of result.unavailable) {
    const dimension = key as ScoredDimension;
    let detail: string;
    let remedy: string;
    /** Set where the client sentence differs by cause. See `NOT_ASSESSED_REASON.location`. */
    let reasonOverride: string | undefined;
    switch (key) {
      case 'growth':
        detail = `No suburb capital-growth series for ${subjectLabel(input.subject)} (${providerClause(input.market, input.evidenceWithheldReason)}).`;
        remedy = 'The open-data sales register for the property\'s local government area (QLD) or postcode (NSW), loaded by market-sales-ingest (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md); a Domain suburb-performance series for the trusted suburb and postcode (docs/integrations/DOMAIN_ACTIVATION_REQUEST.md); or a licensed export ingested through evidenceIngestion.';
        break;
      case 'demand':
        detail = `No demand reading for ${subjectLabel(input.subject)} (${providerClause(input.market, input.evidenceWithheldReason)}).`;
        /*
         * A remedy may never name something the platform already reads.
         *
         * This said "…or the ABS population series for the property's SA2",
         * and the 9 Hollow Street Compass of 20 Sep 2026 printed that remedy
         * on a document that cites the very series THREE times — Kangaroo
         * Flat – Golden Square, 20,938 to 21,369 between 2020 and 2025, on
         * pages 7, 8 and 10. It was held, and acquiring it again would have
         * restored nothing: `populationDriver` is a DRIVER, it carries 0.15,
         * and `DEMAND_PRIMARY` exists precisely so a driver cannot carry the
         * dimension alone. The rule is `riskRemedyFor`'s, which derives what
         * is outstanding from the schema so a remedy can never name as
         * missing something the platform already holds.
         *
         * What is actually outstanding is a PRIMARY measure. Three of the
         * four come from vendor feeds this deployment is not entitled to; the
         * fourth is the open sales register's own transaction count, which
         * needs four periods carrying one to be measured against this
         * market's trailing rate.
         */
        /*
         * The jurisdiction clause is COMPOSED, and the first version of it was
         * wrong about two states. It read "NSW and QLD carry one on every row,
         * VIC and SA one per load": South Australia's sheet names two counted
         * quarters per release rather than one, and Victoria's four periods
         * have been recovered from the archived workbooks since 21 Sep 2026.
         * Worse, it could not draw the distinction that matters most to a
         * reader in ACT, NT, TAS or WA — a register that needs more loads and
         * one that has no count publisher at all are different remedies, and
         * telling an operator to run more loads where no loader exists is a
         * remedy that cannot discharge its reason (`refreshRemedy`'s rule).
         *
         * `volumeRemedyClause` reads `VOLUME_COUNT_SOURCE`, which a spec
         * checks against the loaders themselves — so this sentence cannot
         * drift from what the code does.
         */
        /*
         * And the CLIENT-facing sentence, for the four jurisdictions where
         * the register itself was measured. `NOT_ASSESSED_REASON.demand` is
         * true everywhere and says nothing about WHY this area in
         * particular; where a publisher has actually been asked, the reader
         * is told whether no count is published or whether this platform
         * could not establish it. All four read the first as of 23 Sep 2026
         * — the ACT and Tasmania each read the second, correctly, until the
         * probe could reach where they publish.
         *
         * Keeping those two apart is the point. `null` for the other five
         * jurisdictions, so the existing sentence stands everywhere it
         * already did — a reading that narrows a sentence must never widen
         * the set of pages it appears on.
         */
        reasonOverride = measuredVolumeNote(input.subject.state) ?? undefined;
        remedy = ['A PRIMARY demand measure — the population series alone is a driver and cannot carry '
          + 'the dimension. Either four periods of the open sales register\'s own transaction counts '
          + 'for this market (market-sales-ingest), or Domain days-on-market, vendor discount, '
          + 'auction clearance or listing counts for the suburb.',
        volumeRemedyClause(input.subject.state)].filter((p): p is string => p !== null).join(' ');
        break;
      case 'yield':
        detail = input.property.weeklyRent === null || input.property.weeklyRent <= 0
          ? 'No weekly rent is established for this property.'
          : 'No purchase price is established for this property.';
        remedy = 'A recorded rent (rental evidence) and purchase price on the report.';
        break;
      case 'location': {
        const presentedLoc = presentedFor('location', input);
        const verifiedLoc = input.verifiedInputs ?? [];
        // Two causes, two client sentences. Nothing presented says nothing
        // about the standard of the information — see the policy constant.
        if (presentedLoc.length > 0) reasonOverride = LOCATION_PRESENTED_UNVERIFIED;
        detail = presentedLoc.length === 0
          ? 'No location readings (walk score, commute, schools) were presented for this run.'
          : `Location readings were presented (${presentedLoc.join(', ')}) but not verified: the `
            + 'enrichment carries no subject-matched RF-7.2B acquisition stamp for them '
            + `(${verifiedLoc.length ? `only ${verifiedLoc.join(', ')} verified` : 'none verified'}; `
            + 'locationInputVerification.pure.ts).';
        remedy = 'Regenerate the report: the location service re-acquires the enrichment with its '
          + 'acquisition stamp (RF-7.2B), and stamped, stage-proven readings verify automatically.';
        // Rule 4 of the verification: the readings were measured from the
        // centre of the suburb, not the property. A different cause with a
        // different remedy — the stamp is fine, the POINT is not the property.
        if (presentedLoc.length > 0 && input.locationPointRefusal === 'measured_at_area_centre') {
          reasonOverride = LOCATION_MEASURED_AT_AREA_CENTRE;
          detail = `Location readings were presented (${presentedLoc.join(', ')}) but were measured from the `
            + 'centre of the suburb or postal area: the geocoding chain could place the address no finer than '
            + 'its area (locationInputVerification.pure.ts, rule 4).';
          remedy = 'Regenerate the report once the address can be placed on its street: the chain asks its '
            + 'street-level providers again, and an enrichment measured from the property verifies automatically.';
        } else if (presentedLoc.length > 0 && input.locationPointRefusal === 'point_precision_unrecorded') {
          detail = `Location readings were presented (${presentedLoc.join(', ')}) but their acquisition stamp `
            + 'records no geocode precision, so they cannot be shown to have been measured from the property '
            + '(locationInputVerification.pure.ts, rule 4).';
        }
        break;
      }
      case 'risk': {
        detail = result.risk.eligibility.reason;
        // Derived from the schema, so the remedy cannot name as outstanding
        // something the platform already retrieves. See `riskRemedyFor`.
        remedy = riskRemedyFor(result.risk.assetClass);
        break;
      }
      default:
        detail = 'Not measured.';
        remedy = 'Supply the dimension\'s evidence.';
    }
    gaps.push({
      dimension,
      reason: reasonOverride ?? NOT_ASSESSED_REASON[dimension],
      detail,
      remedy,
      readerRemedy: READER_REMEDY[dimension] ?? null,
      // A gap withholds the score only where the score was actually
      // withheld — under proportional publication an unassessed dimension is
      // disclosed and excluded, not a reason to publish nothing. Where a
      // requirement IS declared (the list is empty today), it is named.
      withholdsGrade: withheldBy === null
        ? false
        : required.size > 0 ? required.has(key) : true,
    });
  }
  return gaps;
}

function subjectLabel(subject: EvidenceSubject): string {
  const parts = [subject.suburb, subject.state, subject.postcode].filter((p): p is string => !!p);
  return parts.length ? parts.join(' ') : 'this market';
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function dimensionDetails(key: DimensionKey, r: ShadowScoreResult, out: ScoreOutput): string {
  const reading = out.dimensions.find((d) => d.key === key)!;
  if (!reading.available) return reading.reason;
  switch (key) {
    case 'growth':
      return r.growth.components.map(componentLine).join('. ') || reading.reason;
    case 'demand':
      return r.demand.components.map(componentLine).join('. ') || reading.reason;
    case 'yield':
      return `${r.yieldResult.label}: ${r.yieldResult.detail}`;
    case 'location':
      return r.location.components.map((c) => c.detail).join('. ') || reading.reason;
    case 'risk':
      return reading.reason;
  }
}

/**
 * What a reader calls each scored component.
 *
 * Page 35 of the Investment Compass delivered for 9 Hollow Street on
 * 21 Sep 2026 printed, under *What each dimension rested on*:
 *
 * ```
 *   Demand. transactionVolume: 76 sales in Golden Square, VIC, 37% above the
 *           3-period average of 56. Population growth: 0.4% annual …
 * ```
 *
 * Every other bullet on that page names its measure in words — *Five-year
 * capital growth*, *Gross yield (on purchase price)*, *Population growth* —
 * and Demand alone printed a camelCase key, because `COMPONENT_LABELS[key] ??
 * key` falls back to the identifier and `transactionVolume` was never added.
 * It is the PRIMARY demand measure (`demandScoring.pure.ts`'s own
 * `DEMAND_PRIMARY`), so every report that scores Demand at all has printed it.
 *
 * Same defect, same week, as `PROVIDER_LABEL`'s `?? p` printing
 * `vic_vpsr_suburb` where a publisher belongs. The rule is the one the AML
 * roster already holds: **database vocabulary never reaches the reader.**
 *
 * The fallback therefore **drops the label rather than printing the key**. The
 * detail is a complete sentence on its own — `76 sales in Golden Square, VIC,
 * 37% above the 3-period average of 56` — and Location has always been
 * rendered exactly that way, with no label at all, so an unnamed component
 * reads like a Location one instead of like a leaked field name.
 */
const COMPONENT_LABELS: Readonly<Record<string, string>> = {
  longTerm: 'Five-year capital growth',
  trajectory: 'Three-year against five-year trajectory',
  momentum: 'Twelve-month movement',
  consistency: 'Consistency of growth',
  relative: 'Performance against the wider market',
  rentalTightness: 'Rental vacancy',
  saleUrgency: 'Competition for stock',
  transactionVolume: 'Sales volume',
  absorption: 'Sales against stock advertised',
  populationDriver: 'Population growth',
};

/** `transactionVolume`, `populationDriver` — a field name, not a phrase. */
const IS_AN_IDENTIFIER = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;

/** The reader's name for a component, or null where this build has none. */
export function labelOfComponent(key: string): string | null {
  const named = COMPONENT_LABELS[key];
  if (named) return named;
  const raw = String(key ?? '').trim();
  return raw && !IS_AN_IDENTIFIER.test(raw) ? raw : null;
}

/** `Label: detail`, or the detail alone where the component has no name. */
const componentLine = (c: { key: string; detail: string }): string => {
  const label = labelOfComponent(c.key);
  return label ? `${label}: ${c.detail}` : c.detail;
};

function dataPointsFor(key: DimensionKey, r: ShadowScoreResult, input: ProductionScoringInput): string[] {
  switch (key) {
    case 'growth': return r.growth.components.map((c) => c.key);
    case 'demand': return r.demand.components.map((c) => c.key);
    case 'yield': return r.yieldResult.score === null ? [] : ['propertyPrice', 'weeklyRent'];
    case 'location': return r.location.components.map((c) => c.key);
    case 'risk': return r.risk.observations.map((o) => o.questionId);
  }
  return [];
}

function presentedFor(key: DimensionKey, input: ProductionScoringInput): string[] {
  const ev = input.market.points;
  switch (key) {
    case 'growth':
      return (['growth1Year', 'growth3YearCagr', 'growth5YearCagr', 'growth10YearCagr', 'priceSeries'] as const)
        .filter((k) => ev[k]);
    case 'demand':
      return (['vacancyRate', 'daysOnMarket', 'vendorDiscount', 'auctionClearanceRate', 'salesCount', 'listingActivity', 'populationGrowth'] as const)
        .filter((k) => ev[k]);
    case 'yield': {
      const out: string[] = [];
      if ((input.property.price ?? 0) > 0) out.push('propertyPrice');
      if ((input.property.weeklyRent ?? 0) > 0) out.push('weeklyRent');
      return out;
    }
    case 'location': {
      const out: string[] = [];
      if (num(input.location?.walkScore) !== null) out.push('walkScore');
      if (num(input.location?.commuteTimeCBD) !== null) out.push('commuteTimeCBD');
      if (num(input.location?.schoolsNearby) !== null) out.push('schoolsNearby');
      return out;
    }
    case 'risk':
      return input.property.propertyType ? ['propertyType'] : [];
  }
  return [];
}

/**
 * The qualitative reading, every claim gated by `claimPermits` exactly as the
 * legacy service gates its own — a sentence is an assessment.
 */
function swot(
  r: ShadowScoreResult,
  input: ProductionScoringInput,
  measured: ScoredDimension[],
): Pick<ProductionScoreRecord, 'strengths' | 'weaknesses' | 'opportunities' | 'risks'> {
  const admitted = Object.entries(POLICY_INPUT_FOR_EVIDENCE)
    .filter(([evidenceKey]) => input.market.points[evidenceKey as EvidenceKey])
    .map(([, policyInput]) => policyInput as string);
  const permits = claimPermits({ authority: 'v2', measuredDimensions: measured, admittedInputs: admitted });
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];
  const score = (k: DimensionKey) => r.dimensions.find((d) => d.key === k)?.score ?? null;

  const g = score('growth');
  if (permits.fromDimensionScore('growth') && g !== null) {
    /*
     * The sentence names what was measured. It said "in this suburb" whatever
     * the evidence was, and on the 60 Lawley Street Compass (25 Sep 2026) that
     * put "Measured capital growth in this suburb is strong" on the verdict
     * page over a Western Australia, all-dwelling series. The thresholds are
     * untouched; only the geography and dwelling type the growth describes
     * are stated, in the words the grade caution already uses. Where the
     * evidence IS this suburb's own, the sentence is exactly what it was.
     */
    const grain = growthEvidenceGrain(r.growth);
    const qualifier = [grain.where, grain.what].filter((x): x is string => !!x).join(', ');
    if (g >= 70) {
      strengths.push(qualifier
        ? `Measured capital growth is strong ${qualifier}`
        : 'Measured capital growth in this suburb is strong');
    } else if (g < 45) {
      weaknesses.push(qualifier
        ? `Measured capital growth has been limited ${qualifier}`
        : 'Measured capital growth in this suburb has been limited');
    }
  }
  const y = score('yield');
  if (permits.fromDimensionScore('yield') && y !== null) {
    if (y >= 70) strengths.push('Strong rental yield providing good cash flow');
    else if (y < 40) weaknesses.push('Below average rental yield may require owner contribution');
  }
  const d = score('demand');
  if (permits.fromDimensionScore('demand') && d !== null) {
    if (d >= 70) strengths.push('Measured demand in this market is strong');
    else if (d < 40) weaknesses.push('Measured demand in this market is soft');
  }
  const l = score('location');
  if (permits.fromDimensionScore('location') && l !== null && l >= 70) {
    strengths.push('Excellent location with strong amenities');
  }

  const pop = input.market.points.populationGrowth?.value;
  if (permits.fromInput('populationGrowth') && typeof pop === 'number' && pop > 2) {
    opportunities.push('Strong population growth driving future demand');
  }
  /*
   * NO VALUATION OF THE SUBJECT.
   *
   * This pushed 'Priced below suburb median - potential for value
   * appreciation', and it reached page 4 of the Compass delivered for
   * 9 Hollow Street on 21 Sep 2026, printed under "Opportunities Noted".
   *
   * `MARKET_FIGURES_IN_THE_REPORT.md` rule 6 forbids it by name: "A median
   * describes a market, not this property. The rule forbids 'below the
   * median', 'above market' and 'under-priced' by name, because that
   * comparison is what the report made." The appreciation clause is a second
   * claim on top of the first - an inference about this property's future
   * price drawn from one comparison against a market average.
   *
   * The comparison is not suppressed, it is relocated: the median is drawn as
   * a market figure with its geography, period and publisher beside it, under
   * the rule that a benchmark never borrows the subject's authority. What is
   * gone is the report telling a client their property is cheap.
   */
  const g1 = input.market.points.growth1Year?.value;
  if (permits.fromInput('priceGrowth1Year') && typeof g1 === 'number' && g1 > 15) {
    risks.push('Rapid recent price growth may indicate market cooling ahead');
  }
  const dom = input.market.points.daysOnMarket?.value;
  if (permits.fromInput('daysOnMarket') && typeof dom === 'number' && dom > 80) {
    risks.push('Extended selling times may indicate softer market');
  }
  const vac = input.market.points.vacancyRate?.value;
  if (permits.fromInput('vacancyRate') && typeof vac === 'number' && vac > 4) {
    weaknesses.push('Higher than ideal vacancy rate in the area');
  }
  return { strengths, weaknesses, opportunities, risks };
}

/**
 * Score a property for production.
 *
 * Runs the frozen engine once, decides whether the grade may be ISSUED under
 * the activation record, and projects the result onto the V1-compatible
 * record with a `v2` stamp. Deterministic for a given `now`.
 */
export function scoreForProduction(input: ProductionScoringInput): ProductionScoreRecord {
  const engineInput = assembleEngineInput(input);
  const result = scoreInvestmentV2(engineInput);
  const out = buildScoreOutput(result, engineInput.evidence);

  const measured = result.measured.map((k) => k as ScoredDimension);

  // The publication decision (S5/S6 §4 and §7), from the engine's own
  // per-dimension scores. It rules on VALIDITY — finite, 0-100, a genuine
  // zero counted — never on the value: there is no path here that can choose
  // which dimensions to include by what they would do to the result.
  const publication = decidePublication(Object.fromEntries(
    PUBLICATION_DIMENSIONS.map((key) => {
      const dim = out.dimensions.find((x) => x.key === key);
      return [key, {
        scored: dim?.available === true,
        score: dim?.performance,
        reason: dim?.available ? null : (dim?.reason ?? null),
        // How much of the dimension's own methodology ran. The policy divides
        // by the same evidence weight the engine does, so the two arithmetics
        // are one arithmetic (`proportionalWeighting.pure.ts`).
        coverage: dim?.coverage,
      }];
    }),
  ));

  // The engine still owns the arithmetic. `publication.overallScore` is the
  // same figure by construction — both renormalise the same valid dimensions
  // over the same canonical weights through `proportionalWeighting.pure.ts`
  // — so the record carries ONE number, the engine's, and a spec pins the
  // equality rather than a runtime check papering over a divergence.
  const gradeIssued = publication.publishes
    && result.grade !== null && result.compositeScore !== null;

  const withheldBy: ProductionScoreRecord['v2']['withheldBy'] = gradeIssued ? null : 'engine_floor';

  const preGaps = describeGaps(input, result, withheldBy);

  const stamp: ScoringV2PolicyStamp = {
    scoringSystem: 'scoring-v2',
    inputPolicyVersion: SCORING_INPUT_POLICY_VERSION,
    methodologyVersion: result.methodologyVersion,
    publicationPolicyVersion: SCORE_PUBLICATION_POLICY_VERSION,
    authority: 'v2',
    dimensionScoresAuthoritative: true,
    gradeIssued,
    eligibility: gradeIssued ? 'issued' : 'insufficient_verified_evidence',
    measuredDimensions: measured,
    evaluatedAt: input.now.toISOString(),
    activation: {
      reference: SCORING_V2_ACTIVATION.reference,
      approvedOn: SCORING_V2_ACTIVATION.approvedOn,
      productionVersion: SCORING_V2_PRODUCTION_VERSION,
    },
  };

  const breakdown = {} as Record<ProductionBreakdownKey, ProductionDimensionScore>;
  for (const d of out.dimensions) {
    breakdown[BREAKDOWN_KEY[d.key]] = {
      score: d.performance ?? 0,
      // The adjusted weight, whichever way the grade went.
      //
      // This used to be `gradeIssued ? … : 0`, and that wrote a contradiction
      // into every withheld run: growth, yield and demand stored as
      // `hasData: true, excluded: false, weight: 0` — measured, and claiming to
      // have contributed nothing. `dimensionWasScored` reads the weight, so a
      // withheld report's dimension table came out EMPTY, telling the reader
      // nothing about what had been measured at the one moment that matters.
      // An unavailable dimension still lands on 0 because `effectiveWeight` is
      // already 0 for it, so the conditional only ever destroyed information.
      weight: Math.round(d.effectiveWeight * 100),
      details: dimensionDetails(d.key, result, out),
      hasData: d.available,
      dataPoints: dataPointsFor(d.key, result, input),
      excluded: !d.available,
    };
  }

  const gaps = preGaps;
  const notAssessed: Record<string, string> = {};
  for (const gap of gaps) notAssessed[gap.dimension] = gap.reason;

  const dataPointsPresented: Record<string, string[]> = {};
  for (const key of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
    dataPointsPresented[BREAKDOWN_KEY[key]] = presentedFor(key, input);
  }

  const weightCovered = Number(out.dimensions
    .filter((d) => d.available)
    .reduce((s, d) => s + d.nominalWeight, 0).toFixed(2));
  const total = out.dimensions.length;
  // The one text field every surface already reads for this, so the
  // qualification reaches the report page, the library card and the hero
  // without a new frontend component (S5/S6 §8). It is the policy's own
  // wording, not a second phrasing of it.
  const partialLabel = !gradeIssued
    ? `Insufficient evidence — qualitative review only (${publication.validCount} of ${total} dimensions assessed)`
    : publication.qualified
      ? `Qualified score — based on ${publication.validCount} of ${total} assessed dimensions `
        + `(${Math.round(publication.nominalWeightCovered * 100)}% of the scoring matrix by its `
        + 'original weights)'
      : `Full coverage (${total} of ${total} dimensions)`;

  const internalEvidenceStatement = buildEvidenceStatement({
    growth: result.growth,
    demand: result.demand,
    yieldResult: result.yieldResult,
    eligibility: result.eligibility ?? applyEligibility({
      compositeScore: 0,
      growth: result.growth,
      evidenceQualityCoverage: result.evidenceQualityCoverage,
    }),
    evidence: engineInput.evidence,
    audience: 'internal',
  });

  const grade = gradeIssued ? result.grade : null;
  return {
    totalScore: gradeIssued ? result.compositeScore : null,
    grade,
    recommendation: qualifyRecommendation(grade, measured, total),
    breakdown,
    publication,
    coverage: {
      dimensionsScored: measured.length,
      totalDimensions: total,
      coverageRatio: Number((measured.length / total).toFixed(2)),
      weightCovered,
      dataInsufficient: !gradeIssued,
      partialLabel,
      cotalityReady: true,
    },
    ...swot(result, input, measured),
    policy: stamp,
    // §4: below the floor the report is produced without a score, a grade, a
    // gauge or a score-derived verdict, and says BRIEFLY why — the policy's
    // own sentence, which names how many dimensions were assessed and which,
    // rather than the generic "insufficient verified evidence" that sent an
    // operator looking for a fault.
    evidenceStatement: gradeIssued
      ? null
      : {
          heading: OVERALL_GRADE_UNAVAILABLE.heading,
          value: OVERALL_GRADE_UNAVAILABLE.value,
          explanation: publication.withheldReason ?? OVERALL_GRADE_UNAVAILABLE.explanation,
        },
    // Only beside a grade that was ISSUED: a caution about a letter nobody
    // prints is a sentence with nothing to qualify.
    evidenceCaution: gradeIssued && result.gradeCaution && result.eligibility
      ? {
          statement: result.gradeCaution,
          cautions: [...result.gradeCautions],
          supports: result.eligibility.ceiling,
        }
      : null,
    notAssessed,
    dataPointsPresented,
    gradeGaps: gaps,
    v2: {
      ...out,
      productionVersion: SCORING_V2_PRODUCTION_VERSION,
      activation: SCORING_V2_ACTIVATION,
      internalEvidenceStatement,
      renderRestricted: {
        growth: result.growth.renderRestricted,
        demand: result.demand.renderRestricted,
      },
      withheldBy,
    },
  };
}

/** Points on a bundle a client document may print, for a renderer that lists figures. */
export function clientPrintablePoints(ev: MarketEvidence): EvidenceKey[] {
  const out: EvidenceKey[] = [];
  for (const [key, v] of Object.entries(ev)) {
    if (v && typeof v === 'object' && 'value' in (v as object) && mayReachClientReport(v as EvidencePoint<unknown>)) {
      out.push(key as EvidenceKey);
    }
  }
  return out;
}
