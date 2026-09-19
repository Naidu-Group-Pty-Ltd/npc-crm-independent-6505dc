/**
 * What a FORKED report may say about the property's grade.
 *
 * ## The defect this closes
 *
 * `fork-investment-report` composes the Financial and Due Diligence variants
 * of a Compass report, and it scored each one with `investmentScoreEngine`
 * — the legacy V1 arithmetic (`scoreFinancial`, `scorePropertyFundamentals`)
 * — and wrote the result to the child row's `investment_score` with no policy
 * stamp at all. So on 15 Sep 2026, for 291 Stone Mason Drive, the composite
 * scorer withheld the grade under the forward-only policy (`authority:
 * unavailable`, `gradeIssued: false`, one of five dimensions measured) while
 * the Financial fork of the same parent, run seven minutes later, wrote
 * **D · CAUTION · 39/100** — 40% of it a buyer's LVR band and cash flow,
 * which the same policy says are not facts about the property at all.
 *
 * Every reader then did what its rules said. `authorityOf` treats an
 * unstamped score as a legacy snapshot, so the Financial row's D rendered as
 * an issued grade; the Generated Reports card resolves the property's grade
 * as the newest score with a number, so the package card showed the D above
 * five chips while the Compass page beside it showed the withheld reading.
 * Two surfaces, one property, two answers — and the one WITH a number was
 * the one the platform's own policy forbids.
 *
 * ## The rule
 *
 * **A fork mints no grade.** The property's grade is a decision the parent's
 * scoring run made under a named authority, and the child restates it:
 *
 *  - a parent whose stamp says a grade was ISSUED lends the child that grade
 *    and its breakdown, verbatim;
 *  - a parent whose stamp WITHHELD the grade lends the child the same
 *    withholding — the same stamp, coverage and evidence statement, so every
 *    document on the property answers "was a grade issued?" from one run;
 *  - a parent with no stamp (a report scored before the policy, or one with
 *    no score at all) gets a fresh stamp under the PRODUCTION authority,
 *    which withholds — because the child is a new scoring run today, and a
 *    new run may not publish a legacy grade whatever its parent was sent.
 *
 * The variant's own V1 dimensions are still computed and kept on the row
 * (`variant`, `breakdown`) as measured analysis: `dimensionScoresAuthoritative`
 * on the stamp is what decides whether a renderer may show them, exactly as
 * it does for the composite, and the SWOT lists are carried from the parent
 * where the variant has none, as before.
 *
 * ## Forward-only
 *
 * Nothing here reads or rewrites a stored row. The Financial row that shipped
 * the D stays as it was written; the next fork of that property writes the
 * reading this module composes, and the card and page read the property's
 * grade from the composite in the meantime.
 *
 * Deno-compatible; no clock of its own (`now` is passed in).
 */
import {
  mayPublishOverallGrade,
  OVERALL_GRADE_UNAVAILABLE,
  policyStamp,
  PRODUCTION_SCORING_AUTHORITY,
  type LegacyScoringAuthority,
  type ScoredDimension,
} from './scoringInputPolicy.pure.ts';

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The breakdown keys that are dimensions in the policy's own vocabulary. The
 * variant-only proxies (`cashflowScore`, `serviceabilityScore`,
 * `planningRiskScore`, `liveabilityScore`) are not — two of them are the
 * buyer's position, which the policy admits to no dimension — so they never
 * appear in a stamp's `measuredDimensions`.
 */
const POLICY_DIMENSION: Readonly<Record<string, ScoredDimension>> = {
  yieldScore: 'yield',
  growthScore: 'growth',
  locationScore: 'location',
  demandScore: 'demand',
  riskScore: 'risk',
};

/** Whether one breakdown entry was actually scored (engine `available`, generator `hasData`). */
function entryScored(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry.excluded === true) return false;
  return (entry.hasData ?? entry.available) !== false;
}

/** The variant's scored breakdown keys, in stored order. */
export function scoredBreakdownKeys(breakdown: unknown): string[] {
  if (!isRecord(breakdown)) return [];
  return Object.keys(breakdown).filter((k) => entryScored(breakdown[k]));
}

/** The policy dimensions a variant breakdown measured — the proxies excluded. */
export function measuredPolicyDimensions(breakdown: unknown): ScoredDimension[] {
  return scoredBreakdownKeys(breakdown)
    .map((k) => POLICY_DIMENSION[k])
    .filter((d): d is ScoredDimension => d !== undefined);
}

export interface VariantScoreInput {
  /**
   * What the V1 variant scorer produced — null when it could not score. Typed
   * as `object` rather than a record because the engine's `ScoreOutput` is an
   * interface, and an interface has no index signature to satisfy one.
   */
  variantScore: object | null;
  /** The parent's stored `investment_score`, or null when it has none. */
  parentScore: object | null;
  now: Date;
  /** The authority a new run is scored under. Production's, unless a test says otherwise. */
  authority?: LegacyScoringAuthority;
}

const carryList = (own: unknown, parents: unknown): unknown[] =>
  (Array.isArray(own) && own.length ? own : (Array.isArray(parents) ? parents : []));

function carriedSwot(variantScore: Rec | null, parentScore: Rec | null): Rec {
  const v = variantScore ?? {};
  const p = parentScore ?? {};
  return {
    strengths: carryList(v.strengths, p.strengths),
    weaknesses: carryList(v.weaknesses, p.weaknesses),
    opportunities: carryList(v.opportunities, p.opportunities),
    risks: carryList(v.risks, p.risks),
  };
}

/**
 * The score object a forked report stores. See the module header for the
 * rule; this is its one implementation.
 */
export function variantScoreUnderPolicy(input: VariantScoreInput): Rec | null {
  const variantScore = isRecord(input.variantScore) ? input.variantScore : null;
  const parentScore = isRecord(input.parentScore) ? input.parentScore : null;
  const authority = input.authority ?? PRODUCTION_SCORING_AUTHORITY;
  if (!variantScore && !parentScore) return null;

  const swot = carriedSwot(variantScore, parentScore);
  const parentPolicy = parentScore && isRecord(parentScore.policy) ? parentScore.policy : null;

  // The parent's run ISSUED a grade under a named authority: the property has
  // a grade, and the child restates it whole — grade, total, breakdown and
  // stamp — so the "weighted across …" sentence describes the dimensions
  // that produced the number. The variant's own analysis rides beside it.
  if (parentPolicy && parentPolicy.gradeIssued === true) {
    return {
      ...parentScore,
      ...(variantScore
        ? { variant: variantScore.variant, variantBreakdown: variantScore.breakdown }
        : {}),
      ...swot,
    };
  }

  // An authority that may publish would let the variant grade stand. This
  // service's authorities never do — `LegacyScoringAuthority` cannot spell
  // `v2` — so the branch is the documented shape of the legacy behaviour,
  // kept where the decision is made rather than left implicit.
  if (mayPublishOverallGrade(authority) && !parentPolicy) {
    if (!variantScore) return { ...parentScore, ...swot };
    return { ...variantScore, ...swot };
  }

  // No grade may be published for this run. The stamp is the parent's own
  // withholding where it has one (one decision, every surface), and a fresh
  // one under the production authority otherwise.
  const measured = variantScore ? measuredPolicyDimensions(variantScore.breakdown) : [];
  const evidenceSufficient = variantScore !== null;
  const stamp = parentPolicy && parentPolicy.gradeIssued === false
    ? parentPolicy
    : policyStamp(measured, evidenceSufficient, input.now, authority);

  const scoredKeys = variantScore ? scoredBreakdownKeys(variantScore.breakdown) : [];
  const totalKeys = variantScore && isRecord(variantScore.breakdown)
    ? Object.keys(variantScore.breakdown).length
    : 0;
  const coverage = parentPolicy && parentPolicy.gradeIssued === false && isRecord(parentScore?.coverage)
    ? parentScore!.coverage
    : {
        dimensionsScored: scoredKeys.length,
        totalDimensions: totalKeys,
        coverageRatio: totalKeys ? scoredKeys.length / totalKeys : 0,
        dataInsufficient: !evidenceSufficient,
        partialLabel: `${scoredKeys.length} of ${totalKeys} dimensions measured`,
      };

  return {
    ...(variantScore ?? {}),
    grade: 'N/A',
    totalScore: null,
    recommendation: OVERALL_GRADE_UNAVAILABLE.explanation,
    policy: stamp,
    coverage,
    evidenceStatement: {
      heading: OVERALL_GRADE_UNAVAILABLE.heading,
      value: OVERALL_GRADE_UNAVAILABLE.value,
      explanation: OVERALL_GRADE_UNAVAILABLE.explanation,
    },
    ...(parentScore && isRecord(parentScore.notAssessed) ? { notAssessed: parentScore.notAssessed } : {}),
    ...swot,
  };
}
