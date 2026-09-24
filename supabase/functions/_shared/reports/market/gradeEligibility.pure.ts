/**
 * What a grade requires of the evidence behind it.
 *
 * ## The case this exists for
 *
 * The methodology fixtures produce one result that is correct and must not be
 * allowed to become an A+: a suburb with a single strong twelve-month figure,
 * measured at regional level, on six transactions and two periods, with the
 * dwelling type unmatched. Growth scores **93**. Coverage is **10%**.
 * Confidence is **low**.
 *
 * Nothing is wrong with that 93 — it is what the evidence says. What would be
 * wrong is printing "A+" on it, because the honest sentence underneath would
 * read *"this property is exceptional, on the strength of one year of regional
 * data covering six sales of a different dwelling type."* No client should be
 * shown that, and Aurixa could not defend it.
 *
 * ## The rule
 *
 * A grade is a claim about a property. The score says how strong the claim is;
 * eligibility says whether the evidence can carry it. They are checked
 * separately, and **eligibility never changes the score** — it caps the grade
 * and states why, so the number and the reason stay legible side by side.
 *
 * Deliberately **not** "4 of 5 dimensions". Counting dimensions treats a
 * missing vacancy rate as equivalent to a missing five-year growth series, and
 * they are nothing alike: one is a nice-to-have, the other is the single most
 * important input to a property investment grade. The rule below is about
 * Growth specifically, plus a floor on how well evidenced the assessed
 * dimensions are — so a strongly evidenced property is not blocked by one
 * absent minor metric, and a property with no credible suburb growth evidence
 * cannot reach A+ on Yield and Location alone.
 *
 * ## The second ceiling (2.0.0) and why 3.0.0 removed it
 *
 * 2.0.0 added a second cap: the printed grade also answered to the
 * NOMINAL-weight sum of what was measured, so a strong property missing a
 * mediocre Demand could not cross an A+ line it would not have crossed with
 * Demand measured. The arithmetic concern was real — renormalising over the
 * measured dimensions does lift the composite when the weakest one drops out.
 *
 * It was the wrong instrument. It lowered the grade **solely because a
 * dimension was unavailable**, which contradicts proportional scoring: a
 * three-dimension assessment covering 70% of the matrix could not exceed the
 * grade its 70 delivered points allowed, however strong those three were, so
 * a qualified score and a qualified grade disagreed with each other by
 * construction. S5/S6 §8 removes it.
 *
 * What replaces it is a rule about SELECTION rather than a cap on the result:
 * every dimension that produces a valid score is included, and none may be
 * omitted to improve the outcome (`scorePublicationPolicy.pure.ts`, pinned by
 * test). The engine filters on validity alone and has no path that chooses
 * dimensions by their value, so the 2.0.0 scenario — dropping the weak one —
 * cannot arise from the engine; it could only arise from evidence genuinely
 * being absent, which is disclosed rather than punished.
 *
 * ## Coverage: quality, not count (3.0.0)
 *
 * The A and A+ gates below used `overallCoverage`, the share of the FULL
 * matrix weight that was measured — which mixes two different things: how
 * many dimensions were assessed, and how well each assessed one was
 * evidenced. Gating on the mixture is another missing-dimension penalty: a
 * perfectly evidenced three-dimension assessment could not reach A because
 * two dimensions were unavailable.
 *
 * 3.0.0 gates on `evidenceQualityCoverage` — the share of the MEASURED
 * dimensions' weight that their evidence actually covered. It answers "how
 * well evidenced is what we assessed", which is the question an over-claim
 * guard should ask, and it is unaffected by how many dimensions were
 * available. The dimension count and the original weight coverage are still
 * recorded and disclosed; they simply no longer cap the badge.
 *
 * ## 4.0.0 — the third place the same penalty was hiding
 *
 * 3.0.0 removed the delivered-points ceiling and believed the remaining cap
 * was about evidence quality. It was not, quite. Both gates below opened with
 * `hasGrowth &&`, so a property with **no** growth evidence failed both
 * however strong and however well evidenced its other dimensions were, and
 * `ceiling` fell to **B+**. That is the missing-dimension penalty again,
 * reintroduced through this module after being removed from the other two:
 * the grade was lowered *because a dimension was unavailable*, which is
 * exactly what proportional weighting already accounts for by renormalising.
 *
 * The distinction 4.0.0 draws is between a fact about the EVIDENCE and a fact
 * about its ABSENCE:
 *
 * - **Growth present but weak or thin** — `confidence` under the threshold,
 *   or `weightCovered` under it. That is a statement about evidence this
 *   report actually has, and it still caps. The opening case of this module
 *   is untouched: Growth 93 on 10% coverage at low confidence cannot print
 *   A+, because the growth evidence is present and cannot carry the claim.
 * - **Growth absent** — nothing was measured, the dimension carries no score,
 *   no weight and no contribution, and the composite is built from what WAS
 *   measured. There is no over-claim to guard against, because no growth
 *   claim is being made. `evidenceQualityCoverage` still gates, over the
 *   dimensions that did answer.
 *
 * So the growth thresholds bind **only when growth is present**, and the
 * quality floor binds always. The consequence is real and intended: a
 * three-dimension assessment whose three dimensions are strongly evidenced
 * can now reach A. What tells the reader its scope is the QUALIFICATION —
 * "based on 3 of the 5 assessment dimensions" — carried by
 * `scorePublicationPolicy.pure.ts` on every surface, which is disclosure
 * rather than a silent deduction.
 *
 * ## 5.0.0 — the letter is the band of the number (owner decision, 24 Sep 2026)
 *
 * The list the owner reads showed **60 Lawley Street, Spalding WA at B+ · 89**
 * beside **9 Hollow Street, Golden Square VIC at A · 77**. Both came from this
 * module working as designed, and together they read as a fault: a higher
 * score printed a lower letter. The owner's decision: the letter follows the
 * score, and anything from 80 carries the A+.
 *
 * What held Lawley at B+ was not the property. Its growth came from the one
 * reading Western Australia publishes openly — the ABS mean dwelling price for
 * the whole state, all dwelling types, no sales count — and that shape scores
 * **44 of 100 on growth confidence at best** (geography 10, dwelling type 0,
 * sample 30, history 100, one provider 55, freshness 100). The A gate is 45.
 * So every property whose growth rests on a state series — all of WA, TAS,
 * NT and the ACT, and anywhere a finer register is missing — could never
 * print above B+ however high it scored. The gate was written before the
 * state series existed as a source, and nobody noticed it had become a
 * jurisdiction rule.
 *
 * The concern the gate answered is real and survives: a growth figure for a
 * whole state is not a finding about one suburb. What 5.0.0 changes is WHERE
 * that is said. A cap lowered the letter and left the number standing, so the
 * reader was handed two claims that disagree and no way to reconcile them —
 * the same objection 4.0.0 made of the missing-dimension penalty, one step
 * further. So:
 *
 * - **The letter is `gradeFor(composite)`, always.** A higher score never
 *   prints a lower letter. `grade === scoreGrade` and `capped` is `false` on
 *   every record graded from 5.0.0; the fields stay so every stored row keeps
 *   its shape and its own explanation.
 * - **The evidence test still runs, and its finding is DISCLOSED.** Where the
 *   evidence alone would not carry the letter the score gives, `cautions`
 *   says why in the operator's words and `caution` says it in one sentence a
 *   client may read — "Capital growth is measured for Western Australia as a
 *   whole and across all dwelling types, not for this property's suburb and
 *   dwelling type." — beside the grade on every surface that prints one.
 * - **A stored grade is read by the line it was issued against.** A record
 *   graded before 5.0.0 was graded with A+ at 85; `gradeThresholdsFor` reads
 *   its version, so an 82 issued as an A is never re-labelled an A+ that was
 *   "held down", and a capped 4.0.0 record keeps the explanation of the rule
 *   that capped it.
 */

import type { GrowthResult } from './growthScoring.pure.ts';
import { type EvidencePoint, levelRank } from './marketEvidence.pure.ts';

/** Bumped whenever a threshold changes. Persisted beside the grade. */
export const ELIGIBILITY_VERSION = '5.0.0';

export type GradeThresholds = ReadonlyArray<readonly [number, string]>;

/**
 * The grade thresholds, from 5.0.0: **A+ from 80**.
 *
 * Moved by the platform owner on 24 September 2026 ("anything above 80 should
 * reflect an A+"), the one threshold moved, and moved by a decision rather
 * than by calibration — no calibration may target a grade distribution, and
 * this is not one. Every other line is unchanged, so A now spans 75–79.
 */
export const GRADE_THRESHOLDS: GradeThresholds = [
  [80, 'A+'], [75, 'A'], [65, 'B+'], [55, 'B'], [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F'],
];

/**
 * The table every grade issued before 5.0.0 was issued against — A+ from 85,
 * the V1 line Scoring V2 kept. Retained so a stored grade is READ by the line
 * it was issued against: re-reading an 82 issued as an A under today's table
 * would report a cap that never happened.
 */
export const GRADE_THRESHOLDS_BEFORE_5_0_0: GradeThresholds = [
  [85, 'A+'], [75, 'A'], [65, 'B+'], [55, 'B'], [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F'],
];

/**
 * The table a record was graded under, from the eligibility version it carries.
 *
 * Absent or unreadable means graded before 5.0.0 — every V1 row and every V2
 * row written before this version — which is the conservative reading: the
 * older table is what those rows were issued against.
 */
export function gradeThresholdsFor(eligibilityVersion: unknown): GradeThresholds {
  if (typeof eligibilityVersion !== 'string') return GRADE_THRESHOLDS_BEFORE_5_0_0;
  const major = /^(\d+)\./.exec(eligibilityVersion.trim());
  return major && Number(major[1]) >= 5 ? GRADE_THRESHOLDS : GRADE_THRESHOLDS_BEFORE_5_0_0;
}

/** The letter a score carries under a given table. */
export function gradeUnder(score: number, thresholds: GradeThresholds): string {
  for (const [floor, grade] of thresholds) if (score >= floor) return grade;
  return 'F';
}

/** The letter a score carries today. */
export function gradeFor(score: number): string {
  return gradeUnder(score, GRADE_THRESHOLDS);
}

/**
 * What the evidence has to show before it carries an A or an A+ ON ITS OWN.
 *
 * From 5.0.0 these lower nothing — the letter is the band of the score. They
 * decide whether a CAUTION travels with the letter: where the evidence falls
 * short of what the letter claims, the shortfall is stated beside the grade
 * rather than deducted from it. The values are unchanged from 4.0.0, so the
 * same records are cautioned that used to be capped.
 */
export const ELIGIBILITY_RULES = {
  /**
   * A needs Growth evidence that is at least credible — **where growth
   * evidence exists**. Absence is not weakness (4.0.0): a dimension nobody
   * measured makes no claim to over-state, and the composite is already
   * renormalised over what was measured.
   */
  aMinGrowthConfidence: 45,
  /** …and enough of the Growth weight actually measured. */
  aMinGrowthCoverage: 0.45,
  /** A+ needs Growth evidence that is strong. */
  aPlusMinGrowthConfidence: 70,
  aPlusMinGrowthCoverage: 0.70,
  /**
   * A+ also needs the dimensions it DID assess to be well evidenced. This is
   * a quality measure over the measured weight, never a count of how many
   * dimensions were available.
   */
  aPlusMinEvidenceQuality: 0.70,
  /** A needs the assessed dimensions to be more than half evidenced. */
  aMinEvidenceQuality: 0.55,
} as const;

export interface EligibilityInput {
  /** The composite score, 0-100. */
  compositeScore: number;
  growth: GrowthResult;
  /**
   * How well evidenced the MEASURED dimensions are, 0-1: the share of their
   * own weight that their evidence covered. Not a dimension count, and not
   * the share of the full matrix — see the 3.0.0 note above.
   */
  evidenceQualityCoverage: number;
}

export interface EligibilityResult {
  version: string;
  /** The grade the score alone gives. */
  scoreGrade: string;
  /**
   * The grade printed. From 5.0.0 it is always `scoreGrade`: the letter is the
   * band of the number, and a higher score never prints a lower letter.
   */
  grade: string;
  /**
   * True when evidence held the printed grade below `scoreGrade`. Always false
   * from 5.0.0. A record graded under 4.0.0 or earlier may carry `true`, and is
   * explained by the rule that capped it.
   */
  capped: boolean;
  /** The highest grade the evidence carries ON ITS OWN. */
  ceiling: string;
  /** Why the grade was held down. Always empty from 5.0.0 — nothing is held down. */
  reasons: ReadonlyArray<string>;
  /**
   * Where the evidence alone would not carry the letter the score gives, in
   * the operator's words. Empty when it would.
   */
  cautions: ReadonlyArray<string>;
  /**
   * The same finding as ONE sentence a client may be shown, printed beside the
   * grade — or null when the evidence carries the letter. It says what the
   * evidence IS (the geography and dwelling type the growth figures describe,
   * how much of a method ran), never a score.
   */
  caution: string | null;
}

const pct = (v: number): number => Math.round(v * 100);

/** The growth figures' own evidence points. */
function growthPoints(growth: GrowthResult): EvidencePoint<unknown>[] {
  return growth.components
    .map((c) => c.evidence)
    .filter((p): p is EvidencePoint<unknown> => p !== null);
}

/**
 * Where the growth figures are measured, when that is coarser than the
 * property's own area — "for Western Australia as a whole" — or null.
 *
 * A postal area and an SA2 are the property's own neighbourhood for this
 * purpose; a council area is the wider area; a capital city, a state or the
 * nation is the market as a whole.
 */
function coarseGeography(points: ReadonlyArray<EvidencePoint<unknown>>): string | null {
  if (!points.length) return null;
  const finest = points.reduce((best, p) => (levelRank(p.level) < levelRank(best.level) ? p : best));
  switch (finest.level) {
    case 'property':
    case 'suburb':
    case 'postcode':
    case 'sa2':
      return null;
    case 'lga':
    case 'sa3':
      return `for the wider ${finest.areaName} area`;
    default:
      return `for ${finest.areaName} as a whole`;
  }
}

/** Which dwellings the growth figures describe, when NONE of them is this property's type — or null. */
function unmatchedDwelling(points: ReadonlyArray<EvidencePoint<unknown>>): string | null {
  if (!points.length || points.some((p) => p.dwellingTypeMatched)) return null;
  const types = new Set(points.map((p) => p.dwellingType));
  if (types.size !== 1) return 'across other dwelling types';
  switch ([...types][0]) {
    case 'any': return 'across all dwelling types';
    case 'house': return 'for houses';
    case 'attached': return 'for units and other attached dwellings';
    case 'land': return 'for vacant land';
    default: return 'across other dwelling types';
  }
}

/** A thin-evidence clause from one confidence factor's own detail, or null. */
function thinEvidenceClause(key: string, detail: string): string | null {
  if (key === 'sample') {
    if (/not published/i.test(detail)) return 'the source publishes no count of the sales behind it';
    const n = /^(\d+)/.exec(detail);
    return n ? `it rests on ${n[1]} sales` : null;
  }
  if (key === 'history') {
    const n = /^(\d+) periods?/.exec(detail);
    return n ? `it has ${n[1]} periods of price history` : null;
  }
  if (key === 'freshness') {
    const n = /(\d+) quarter/.exec(detail);
    return n ? `its newest reading is ${n[1]} quarters old` : null;
  }
  return null;
}

/**
 * The client's sentence: what the evidence behind the letter IS.
 *
 * Read from the evidence's own facts — the geography and dwelling type the
 * growth figures describe, the confidence factors' own details, how much of
 * each method ran — and never from a score, so it cannot disagree with the
 * record it sits beside.
 */
function cautionSentence(input: {
  growth: GrowthResult;
  growthShort: boolean;
  growthCoverageShort: boolean;
  qualityShort: boolean;
  evidenceQualityCoverage: number;
}): string | null {
  const sentences: string[] = [];
  if (input.growthShort) {
    const points = growthPoints(input.growth);
    const where = coarseGeography(points);
    const what = unmatchedDwelling(points);
    if (where && what) {
      sentences.push(`Capital growth is measured ${where} and ${what}, not for this property's suburb and dwelling type.`);
    } else if (where) {
      sentences.push(`Capital growth is measured ${where}, not for this property's suburb.`);
    } else if (what) {
      sentences.push(`Capital growth is measured ${what} in this area, not for this property's own dwelling type.`);
    } else {
      const weak = input.growth.confidence.factors
        .filter((f) => f.score < 50)
        .map((f) => thinEvidenceClause(f.key, f.detail))
        .filter((c): c is string => c !== null);
      sentences.push(weak.length
        ? `The capital-growth evidence behind this grade is limited: ${weak.join('; ')}.`
        : 'The capital-growth evidence behind this grade is limited.');
    }
  }
  if (input.growthCoverageShort) {
    sentences.push(`Only ${pct(input.growth.weightCovered)}% of the capital-growth method could be measured.`);
  }
  if (input.qualityShort) {
    sentences.push(
      `The dimensions assessed could be evidenced only in part: ${pct(input.evidenceQualityCoverage)}% of their `
        + 'methods ran.',
    );
  }
  return sentences.length ? sentences.join(' ') : null;
}

/**
 * Grade a composite score, and say what its evidence can carry.
 *
 * The letter is the band of the score (5.0.0). The evidence test that used to
 * lower it now decides whether a caution travels with it: `ceiling` is the
 * highest letter the evidence carries on its own, and where the score's letter
 * is above it, `cautions` and `caution` say why.
 */
export function applyEligibility(input: EligibilityInput): EligibilityResult {
  const { compositeScore, growth, evidenceQualityCoverage } = input;
  const scoreGrade = gradeFor(compositeScore);
  const cautions: string[] = [];
  const r = ELIGIBILITY_RULES;

  const gConf = growth.confidence.score;
  const gCover = growth.weightCovered;
  const hasGrowth = growth.score !== null;

  /*
   * The growth tests judge growth evidence that EXISTS (4.0.0). Where growth
   * was not measured they do not apply — there is no growth claim to
   * over-state — and the quality floor over the measured dimensions stands on
   * its own.
   */
  const growthCarriesAPlus = !hasGrowth
    || (gConf >= r.aPlusMinGrowthConfidence && gCover >= r.aPlusMinGrowthCoverage);
  const growthCarriesA = !hasGrowth
    || (gConf >= r.aMinGrowthConfidence && gCover >= r.aMinGrowthCoverage);

  // Can the evidence carry an A+ on its own?
  const aPlusOk = growthCarriesAPlus && evidenceQualityCoverage >= r.aPlusMinEvidenceQuality;

  // Can it carry an A?
  const aOk = growthCarriesA && evidenceQualityCoverage >= r.aMinEvidenceQuality;

  const ceiling = aPlusOk ? 'A+' : aOk ? 'A' : 'B+';

  // Only the letter actually printed is explained, against its own tests.
  const wanted = scoreGrade === 'A+' ? 'A+' : scoreGrade === 'A' ? 'A' : null;
  let growthShort = false;
  let growthCoverageShort = false;
  let qualityShort = false;
  if (wanted && !(wanted === 'A+' ? aPlusOk : aOk)) {
    const minQuality = wanted === 'A+' ? r.aPlusMinEvidenceQuality : r.aMinEvidenceQuality;
    const minConfidence = wanted === 'A+' ? r.aPlusMinGrowthConfidence : r.aMinGrowthConfidence;
    const minCoverage = wanted === 'A+' ? r.aPlusMinGrowthCoverage : r.aMinGrowthCoverage;
    // The quality floor explains itself whether or not growth was measured:
    // it is a statement about the dimensions that DID answer (4.0.0).
    if (evidenceQualityCoverage < minQuality) {
      qualityShort = true;
      cautions.push(
        `The assessed dimensions are ${pct(evidenceQualityCoverage)}% evidenced; the evidence alone carries `
          + `an ${wanted} from ${pct(minQuality)}%.`,
      );
    }
    // Absence is not a reason, because it is not a cause (4.0.0).
    if (hasGrowth) {
      if (gConf < minConfidence) {
        growthShort = true;
        cautions.push(
          `Growth evidence confidence is ${gConf} (${growth.confidence.band}); the evidence alone carries `
            + `an ${wanted} from ${minConfidence}.`,
        );
      }
      if (gCover < minCoverage) {
        growthCoverageShort = true;
        cautions.push(
          `Only ${pct(gCover)}% of the growth methodology could be measured; the evidence alone carries `
            + `an ${wanted} from ${pct(minCoverage)}%.`,
        );
      }
    }
  }

  return {
    version: ELIGIBILITY_VERSION,
    scoreGrade,
    grade: scoreGrade,
    capped: false,
    ceiling,
    reasons: [],
    cautions,
    caution: cautions.length
      ? cautionSentence({ growth, growthShort, growthCoverageShort, qualityShort, evidenceQualityCoverage })
      : null,
  };
}
