/**
 * ME-5 items 11–13 — three candidate Risk models, and the evidence between them.
 *
 * ## The finding that generates the question
 *
 * Risk's current components are leverage (0.40), serviceability (0.30), asset
 * type (0.20) and market overheating (0.10). Seventy per cent of that weight is
 * the BUYER'S financing, not the property — and the corpus proves it rather
 * than merely suggesting it.
 *
 * 55 addresses appear in more than one report. Across them:
 *
 * | what differs for the same address | addresses |
 * | --- | ---: |
 * | purchase price | 7 of 55 |
 * | LVR | **16 of 55** |
 * | weekly cash flow | **21 of 55** |
 *
 * The property is stable and the financing is not. Concretely: **1 Boxer Drive,
 * Wyndham Vale — two reports, the same day, the same $635,000, the same −$562
 * weekly net — one at 80% LVR and one at 90%.** Three more Truganina addresses
 * carry the identical pair. Under the current model that is 62 → 30 on the
 * leverage anchors, weighted 0.40: **12.8 points of Risk for a number an
 * operator typed into a calculator.**
 *
 * ## The three models
 *
 * **Model A — asset only.** Risk scores what the property is: asset type and
 * market overheating. Leverage and serviceability are dropped.
 *
 * **Model B — asset scored, finance disclosed.** Risk scores the same asset
 * attributes, and the buyer's leverage and serviceability are published beside
 * the grade as a separate *finance suitability* reading that never enters it.
 *
 * **Model C — blended.** The current model: one dimension over all four.
 *
 * ## How they are told apart, and why it is not by taste
 *
 * The test is an invariant, not a preference: **the same property, on the same
 * day, at the same price must receive the same property Risk score.** A and B
 * satisfy it by construction; C fails it on 16 of 55 repeated addresses.
 *
 * The fair counter-argument, stated because it is the strong one: a report IS
 * about a specific purchase at a specific LVR, so the buyer's leverage really
 * does bear on that investment's risk, and Model A throws it away. That is
 * exactly why B is preferred over A — it discards nothing, it moves the
 * information out of a score that is presented as a property grade and reports
 * it as what it is.
 *
 * This module makes the comparison runnable. It does not switch production:
 * `scoreRisk` in `riskScoring.pure.ts` is untouched, and nothing here is wired
 * into a live path.
 */

import {
  ASSET_TYPE_SCORES,
  LVR_ANCHORS,
  OVERHEATING_ANCHORS,
  resolveAssetType,
  SERVICEABILITY_ANCHORS,
  type RiskInputs,
} from './riskScoring.pure.ts';

export const RISK_MODELS_VERSION = '1.0.0';

export type RiskModelId = 'A_asset_only' | 'B_asset_scored_finance_disclosed' | 'C_blended';

/** Weightings per model. Every model's weights sum to 1 over what it scores. */
export const RISK_MODEL_WEIGHTS: Readonly<Record<RiskModelId, Readonly<Record<string, number>>>> = {
  A_asset_only: { assetType: 0.67, marketOverheating: 0.33 },
  B_asset_scored_finance_disclosed: { assetType: 0.67, marketOverheating: 0.33 },
  C_blended: { leverage: 0.40, serviceability: 0.30, assetType: 0.20, marketOverheating: 0.10 },
};

/** Which inputs each model treats as a property fact rather than a buyer's choice. */
export const PROPERTY_SCOPED_INPUTS: readonly string[] = ['assetType', 'marketOverheating'];
export const BUYER_SCOPED_INPUTS: readonly string[] = ['leverage', 'serviceability'];

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

export interface ScoredComponent {
  key: string;
  score: number;
  weight: number;
}

export interface RiskModelResult {
  model: RiskModelId;
  /** Null when nothing the model scores was available. Absent, not zero. */
  score: number | null;
  components: ScoredComponent[];
  missing: string[];
  /**
   * Model B only: the buyer's position, reported and never scored into `score`.
   * Null for A (dropped) and for C (folded into the score instead).
   */
  financeSuitability: { score: number; components: ScoredComponent[] } | null;
  /** What a report may say about this reading. */
  statement: string;
}

function componentScores(input: RiskInputs) {
  const out: Record<string, number | null> = {
    leverage: typeof input.lvr === 'number' ? interpolate(LVR_ANCHORS, input.lvr) : null,
    serviceability: typeof input.weeklyCashFlow === 'number'
      ? interpolate(SERVICEABILITY_ANCHORS, input.weeklyCashFlow) : null,
    marketOverheating: typeof input.growth1Year === 'number'
      ? interpolate(OVERHEATING_ANCHORS, input.growth1Year) : null,
    assetType: null,
  };
  const asset = resolveAssetType(input.propertyType);
  out.assetType = asset ? (ASSET_TYPE_SCORES[asset] ?? null) : null;
  return out;
}

/** Weighted mean over the components a model scores and that are present. */
function weighted(
  scores: Record<string, number | null>,
  weights: Readonly<Record<string, number>>,
): { score: number | null; components: ScoredComponent[]; missing: string[] } {
  const components: ScoredComponent[] = [];
  const missing: string[] = [];
  let totalWeight = 0;
  let acc = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const s = scores[key];
    if (s === null || s === undefined) { missing.push(key); continue; }
    components.push({ key, score: s, weight });
    acc += s * weight;
    totalWeight += weight;
  }
  return {
    score: totalWeight > 0 ? acc / totalWeight : null,
    components,
    missing,
  };
}

/** Run one model over one report's inputs. */
export function scoreRiskModel(model: RiskModelId, input: RiskInputs): RiskModelResult {
  const scores = componentScores(input);
  const { score, components, missing } = weighted(scores, RISK_MODEL_WEIGHTS[model]);

  let financeSuitability: RiskModelResult['financeSuitability'] = null;
  if (model === 'B_asset_scored_finance_disclosed') {
    const fin = weighted(scores, { leverage: 0.57, serviceability: 0.43 });
    if (fin.score !== null) {
      financeSuitability = { score: fin.score, components: fin.components };
    }
  }

  const statement = model === 'C_blended'
    ? 'Risk blends the property’s attributes with the buyer’s stated financing, so two reports '
      + 'on the same property at different loan-to-value ratios receive different Risk scores.'
    : model === 'A_asset_only'
      ? 'Risk describes the property alone. The buyer’s financing is not scored and is not '
        + 'reported here.'
      : 'Risk describes the property alone. The buyer’s stated financing is reported separately '
        + 'as a suitability reading and never enters the grade.';

  return { model, score, components, missing, financeSuitability, statement };
}

/**
 * The invariant that separates the models.
 *
 * Two readings of the SAME property differing only in the buyer's financing
 * must produce the same property Risk score. Returns the models that hold it.
 */
export function modelsHoldingPropertyInvariance(
  a: RiskInputs,
  b: RiskInputs,
): RiskModelId[] {
  const models: RiskModelId[] = ['A_asset_only', 'B_asset_scored_finance_disclosed', 'C_blended'];
  return models.filter((m) => {
    const x = scoreRiskModel(m, a).score;
    const y = scoreRiskModel(m, b).score;
    if (x === null && y === null) return true;
    if (x === null || y === null) return false;
    return Math.abs(x - y) < 1e-9;
  });
}

/**
 * ME-5 item 12 — what the asset-type component is actually worth.
 *
 * `ASSET_TYPE_SCORES` asserts house 82, duplex 74, townhouse 66, unit 55,
 * apartment 55, land 45. Measured against the corpus, four things are true and
 * none of them is comfortable:
 *
 * **The numbers are unevidenced.** Nothing in this repository justifies why a
 * duplex is eight points safer than a townhouse. They are a plausible ordering
 * somebody wrote down, and the programme's own rule — a point must come from a
 * real observation or a deterministic calculation — does not admit them as
 * they stand.
 *
 * **It barely discriminates.** Of the 896 reports carrying a real dwelling
 * type, 631 are `house`: **70.4% receive the identical 82**, so for seven in
 * ten reports this component is a constant.
 *
 * **Two real types resolve to nothing.** `house_and_land` (9 reports) and
 * `villa` (8) are genuine stored values that `resolveAssetType` returns null
 * for, because they are absent from the table. Under Model C that costs 0.20 of
 * the weight; under A and B, where asset type carries 0.67, losing it costs
 * most of the dimension. `UNMAPPED_STORED_TYPES` names them so the gap is a
 * fact rather than a surprise.
 *
 * **Vacant land is a category error, not a low score.** Land has no dwelling,
 * no rent, no depreciation and different financing, so its risk is not a point
 * on the same scale as a house's — scoring it 45 says "a somewhat worse house",
 * which is not what it is.
 *
 * The honest conclusion is that asset type is a *classifier*, not a score.
 * Nothing here changes it; this records what it is worth before anybody weights
 * it more heavily, which is exactly what Models A and B would do.
 */
export const UNMAPPED_STORED_TYPES: readonly string[] = ['house_and_land', 'villa'];

/** Measured share of resolvable reports receiving the modal asset score. */
export const ASSET_TYPE_MODAL_SHARE = 631 / 896;

/** Asset types whose risk is a different kind of thing, not a lower score. */
export const ASSET_TYPES_OFF_SCALE: readonly string[] = ['land'];

