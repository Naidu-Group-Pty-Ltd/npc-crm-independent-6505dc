/**
 * ME-5.1 items 1, 3 and 4 — Model D, and what to do with overheating.
 *
 * Model D's rules, taken from the brief and enforced here rather than promised:
 *
 *   * property type selects the applicable checks and contributes **zero** points;
 *   * buyer LVR contributes **zero** property-risk points;
 *   * buyer cash flow contributes **zero** property-risk points;
 *   * buyer finance is reported separately as Finance Suitability;
 *   * Risk is **null** when insufficient genuine property-level evidence exists.
 *
 * ## The renormalisation trap, and why it is the whole of item 4
 *
 * Strip asset type out and twelve-month overheating is the only property-scoped
 * input left. Renormalising it to 100 would take a signal the live model gives
 * **0.10** of one dimension and make it **the entire** Risk score — replacing a
 * property-type bias with a single-indicator one. It would also be a second
 * opinion on Growth wearing a different hat, since the input IS Growth's own
 * twelve-month figure, read under ME-4's one declared cross-dimension exception.
 *
 * Three candidates, compared on independence rather than on what they do to the
 * grade distribution:
 *
 * **D1 — overheating is a disclosed flag and creates no Risk dimension.**
 * Risk is null until a genuine property-risk category is measurable. The
 * caution still reaches the reader; it simply is not a score.
 *
 * **D2 — overheating may contribute only alongside at least one independent
 * property-risk category.** It is never alone, so it can never become 100% by
 * renormalisation. Today no such category is measurable, so D2 behaves exactly
 * like D1 — and that identity is the point: D2 is D1 plus a door that opens by
 * itself the moment hazard or strata evidence lands.
 *
 * **D3 — overheating stays inside Growth as a trajectory caution** and Risk
 * carries no market input at all. Cleanest on independence, because the signal
 * lives once, in the dimension that owns it. Its cost is that a reader looking
 * for risk finds nothing about an overheated market under the Risk heading.
 *
 * `compareOverheatingVariants` runs the comparison; the recommendation is
 * argued in the audit document, not asserted here. **D2 is provisional and
 * uncalibrated** — no property-risk evidence exists to calibrate it against,
 * so the methodology is not final and `RISK_METHODOLOGY_STATUS` says so.
 *
 * ## The SECOND renormalisation problem (ME-5.1 item 1)
 *
 * Removing asset type left a subtler version of the same fault. If exactly one
 * property-risk question is answered, averaging over "the questions that were
 * answered" makes that single observation **100% of the Risk dimension** — one
 * hazard reading standing in for hazard, planning, condition, supply and
 * completion together. That is renormalisation by another route.
 *
 * So **an observation is not a score**. The two are separated:
 *
 *   * `observations` — every property-specific measurement actually available,
 *     always reported, however few;
 *   * `eligibility` — whether enough INDEPENDENT property-risk evidence exists
 *     to support a composite Risk score at all.
 *
 * A single hazard reading is shown as evidence and does not become the
 * dimension. The minimum is deliberately **not** a number invented now:
 * `MINIMUM_INDEPENDENT_CATEGORIES` is declared uncalibrated, and the honest
 * position while no property-risk evidence exists is `Risk = null` regardless
 * of what the threshold would be.
 */

import {
  answerableCount,
  resolveAssetClass,
  scoreableQuestions,
  type AssetClass,
  type RiskQuestion,
} from './propertyRiskSchema.pure.ts';

export const RISK_MODEL_D_VERSION = '1.0.0';

export type OverheatingVariant = 'D1_flag_only' | 'D2_requires_a_peer' | 'D3_inside_growth';

/** The methodology is not final while nothing exists to calibrate it against. */
export const RISK_METHODOLOGY_STATUS = 'provisional / uncalibrated' as const;

/**
 * Independent categories required before observations may compose a score.
 *
 * Deliberately uncalibrated. Two is the smallest number at which "composite"
 * means anything at all, but it is a placeholder for a figure that can only be
 * set against real property-risk data — which this deployment holds none of.
 * `RISK_METHODOLOGY_STATUS` is the honest label until then.
 */
export const MINIMUM_INDEPENDENT_CATEGORIES = 2;

/**
 * Risk questions grouped by the independent thing they measure.
 *
 * Two answers from the same category are one category, not two: hazard and
 * planning both describe the site, and counting them as independent evidence
 * would re-admit the renormalisation this prevents.
 */
export const QUESTION_CATEGORY: Readonly<Record<string, string>> = {
  site_hazard_exposure: 'site',
  planning_constraints: 'site',
  condition_and_maintenance: 'building',
  strata_health: 'building',
  local_unit_supply_concentration: 'local_market',
  construction_and_completion: 'delivery',
  title_and_registration_timing: 'delivery',
};

export interface RiskEligibility {
  eligible: boolean;
  /** Distinct independent categories with at least one answer. */
  categoriesRepresented: string[];
  minimumRequired: number;
  status: typeof RISK_METHODOLOGY_STATUS;
  /** Why a score is or is not available, in words a report can print. */
  reason: string;
}

/** What Model D was given. Buyer facts are deliberately absent from this type. */
export interface PropertyRiskInputs {
  /** The stored property type. Used to SELECT questions; never scored. */
  propertyType?: string | null;
  /**
   * Answers to the class's own property-level risk questions, by question id.
   * A score of 0-100 where higher is safer. Absent means unanswered.
   */
  answers?: Readonly<Record<string, number>>;
  /** Twelve-month capital growth, per cent. Growth's input, read under exception. */
  growth1Year?: number | null;
}

export interface PropertyRiskResult {
  version: string;
  variant: OverheatingVariant;
  /** The class the type selected, or null where the type is a placeholder. */
  assetClass: AssetClass | null;
  /** Null unless genuine property-level evidence supports a score. */
  score: number | null;
  /** Every question the class makes applicable, with its standing. */
  questions: ReadonlyArray<RiskQuestion & { answered: boolean; value: number | null }>;
  /** Property-level questions answered, over those that could be. */
  coverage: { answered: number; scoreable: number };
  /**
   * Every property-specific measurement available, reported whether or not it
   * is enough to score. An observation is evidence; it is not a dimension.
   */
  observations: Array<{ questionId: string; category: string; value: number }>;
  /** Whether the observations may compose a Risk score at all. */
  eligibility: RiskEligibility;
  /** The overheating reading, whether or not it scored. */
  overheating: { value: number | null; scored: boolean; statement: string } | null;
  statement: string;
}

/** Flat below 12%: ordinary appreciation is not a risk, and charging for it is Growth's job twice. */
export const OVERHEATING_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 100], [12, 100], [16, 85], [20, 68], [25, 48], [35, 25],
];

function interpolate(anchors: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/**
 * Score a property's own risk.
 *
 * The asset class appears in the result and in no arithmetic. A test asserts
 * that: two properties differing only in type receive the same score.
 */
export function scorePropertyRisk(
  input: PropertyRiskInputs,
  variant: OverheatingVariant = 'D2_requires_a_peer',
): PropertyRiskResult {
  const assetClass = resolveAssetClass(input.propertyType);
  const answers = input.answers ?? {};

  if (!assetClass) {
    return {
      version: RISK_MODEL_D_VERSION, variant, assetClass: null, score: null,
      questions: [], coverage: { answered: 0, scoreable: 0 },
      observations: [],
      eligibility: {
        eligible: false, categoriesRepresented: [],
        minimumRequired: MINIMUM_INDEPENDENT_CATEGORIES, status: RISK_METHODOLOGY_STATUS,
        reason: 'No risk schema applies, so no observation is even applicable.',
      },
      overheating: null,
      statement: 'The stored property type is a placeholder, so no risk schema applies and no '
        + 'property risk is assessed. This is a gap in the record, not a finding about the property.',
    };
  }

  const scoreable = scoreableQuestions(assetClass);
  const questions = SCHEMA_WITH_ANSWERS(assetClass, answers);
  const answered = scoreable.filter((q) => typeof answers[q.id] === 'number');

  // --- observations, and whether they may compose a score ----------------
  const observations = answered.map((q) => ({
    questionId: q.id,
    category: QUESTION_CATEGORY[q.id] ?? 'uncategorised',
    value: answers[q.id],
  }));
  const categoriesRepresented = [...new Set(observations.map((o) => o.category))].sort();
  const eligible = categoriesRepresented.length >= MINIMUM_INDEPENDENT_CATEGORIES;

  const eligibility: RiskEligibility = {
    eligible,
    categoriesRepresented,
    minimumRequired: MINIMUM_INDEPENDENT_CATEGORIES,
    status: RISK_METHODOLOGY_STATUS,
    reason: observations.length === 0
      ? 'No property-specific risk measurement is available, so there is nothing to score.'
      : eligible
        ? `Observations span ${categoriesRepresented.length} independent categories `
          + `(${categoriesRepresented.join(', ')}), so they may compose a Risk score.`
        : `Only ${categoriesRepresented.length} independent category `
          + `(${categoriesRepresented.join(', ')}) is measured. A single observation is reported `
          + 'as evidence and does not become the Risk dimension — that would be the same '
          + 'renormalisation, arrived at from the other direction.',
  };

  // --- the property-level component ------------------------------------
  const propertyScore = eligible
    ? observations.reduce((a, o) => a + o.value, 0) / observations.length
    : null;

  // --- overheating, per variant ----------------------------------------
  const g = typeof input.growth1Year === 'number' ? input.growth1Year : null;
  const overheatingScore = g === null ? null : interpolate(OVERHEATING_ANCHORS, g);

  let overheatingScored = false;
  if (overheatingScore !== null) {
    // D2's peer must itself be score-eligible: an ineligible single observation
    // cannot become the doorway through which overheating scores.
    if (variant === 'D2_requires_a_peer') overheatingScored = eligible;
    // D1 never scores it; D3 does not read it here at all.
  }

  const overheating = variant === 'D3_inside_growth'
    ? {
        value: g, scored: false,
        statement: 'Twelve-month growth is read as a trajectory caution inside Growth, where the '
          + 'signal already lives. Risk carries no market input.',
      }
    : overheatingScore === null
      ? null
      : {
          value: g, scored: overheatingScored,
          statement: overheatingScored
            ? 'Rapid twelve-month appreciation is scored alongside a measured property-risk '
              + 'category, so it cannot become the whole of Risk by renormalisation.'
            : 'Rapid twelve-month appreciation is disclosed as a market caution. It does not '
              + 'create a Risk score on its own, because one indicator renormalised to 100 is a '
              + 'single-indicator bias in place of a property-type one.',
        };

  // Overheating can only ever SUBTRACT, and by a bounded amount.
  //
  // Averaging it in was wrong in the first draft of this module: the anchors are
  // a penalty curve that sits at 100 below 12% growth, so blending it as a
  // positive contributor RAISED the risk score of every property in a calm
  // market — a systematic upward shift that is a fact about the market rather
  // than about the property. Taking `min()` instead swings the other way and
  // lets a hot market become the whole score, which is the renormalisation this
  // item exists to prevent. A bounded deduction does neither.
  const OVERHEATING_MAX_DEDUCTION = 25;
  const score = overheatingScored && propertyScore !== null && overheatingScore !== null
    ? Math.max(0, propertyScore - ((100 - overheatingScore) / 100) * OVERHEATING_MAX_DEDUCTION)
    : propertyScore;

  return {
    version: RISK_MODEL_D_VERSION,
    variant,
    assetClass,
    score,
    questions,
    coverage: { answered: answered.length, scoreable: scoreable.length },
    observations,
    eligibility,
    overheating,
    statement: score === null
      ? `Risk is not assessed for this ${assetClass.replace(/_/g, ' ')}. `
        + `${scoreable.length} question(s) apply to this asset class, `
        + `${answerableCount(assetClass)} can be answered by this deployment today, and `
        + `${observations.length} observation(s) are available. ${eligibility.reason}`
      : `Assessed from ${answered.length} of ${scoreable.length} applicable property-risk `
        + 'question(s). The property type selected those questions and contributed no points.',
  };
}

function SCHEMA_WITH_ANSWERS(
  cls: AssetClass,
  answers: Readonly<Record<string, number>>,
): PropertyRiskResult['questions'] {
  return scoreableQuestions(cls).map((q) => ({
    ...q,
    answered: typeof answers[q.id] === 'number',
    value: typeof answers[q.id] === 'number' ? answers[q.id] : null,
  }));
}

export interface VariantComparison {
  variant: OverheatingVariant;
  /** Can this variant ever let overheating be the sole basis of a Risk score? */
  overheatingCanStandAlone: boolean;
  /** Does the signal appear in exactly one dimension? */
  signalLivesOnce: boolean;
  /** Does an overheated market still reach the reader under Risk? */
  cautionVisibleUnderRisk: boolean;
  /** What it produces on this corpus today, where no property evidence exists. */
  scoreToday: number | null;
  note: string;
}

/**
 * Compare the three variants on independence and defensibility.
 *
 * Deliberately reports no grade distribution: the brief forbids choosing on
 * A/A+ count, and offering the number invites exactly that.
 */
export function compareOverheatingVariants(input: PropertyRiskInputs): VariantComparison[] {
  const variants: OverheatingVariant[] = ['D1_flag_only', 'D2_requires_a_peer', 'D3_inside_growth'];
  return variants.map((variant) => {
    const result = scorePropertyRisk(input, variant);
    return {
      variant,
      overheatingCanStandAlone: variant === 'D1_flag_only' || variant === 'D3_inside_growth'
        ? false
        // D2 admits it only beside a measured peer, so it is never alone either.
        : false,
      signalLivesOnce: variant === 'D3_inside_growth',
      cautionVisibleUnderRisk: variant !== 'D3_inside_growth',
      scoreToday: result.score,
      note: variant === 'D1_flag_only'
        ? 'Simplest. Risk stays null until a property-risk category is measurable, and the market '
          + 'caution is disclosed rather than scored.'
        : variant === 'D2_requires_a_peer'
          ? 'Identical to D1 on today’s evidence, and opens by itself when hazard or strata data '
            + 'lands — the gate is the evidence, not a later code change.'
          : 'Cleanest on independence: the signal lives once, in Growth. Costs the reader a risk '
            + 'caution under the Risk heading.',
    };
  });
}
