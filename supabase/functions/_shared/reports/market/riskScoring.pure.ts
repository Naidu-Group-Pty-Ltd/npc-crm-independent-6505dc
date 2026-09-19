/**
 * ME-4 — the Risk dimension, and the finding that it is thin.
 *
 * > **SUPERSEDED IN THE COMPOSITION (shadow 2.1.0).** The composite's Risk
 * > dimension is Model D (`../risk/riskModelD.pure.ts`): property type selects
 * > the schema and scores nothing, buyer LVR and buyer cash flow score
 * > nothing anywhere (they are the separate Finance Suitability reading), and
 * > one observation cannot become the dimension. This module is retained as
 * > the ME-4 record and as the component definitions the A/B/C model
 * > comparison (`riskModels.pure.ts`) is expressed over. Nothing composes it
 * > into a grade any more, and nothing new should.
 *
 * ## What Risk currently double-counts
 *
 * `calculateRiskScore` reads six inputs. Three of them belong to other
 * dimensions and are removed here:
 *
 * | input | deducts | its own reason string | owner |
 * | --- | ---: | --- | --- |
 * | `vacancyRate` | up to 22 | *"signals weak rental **demand**"* | Demand |
 * | `daysOnMarket` | up to 15 | *"indicates weak **demand**"* | Demand |
 * | `cashFlow` | — | serviceability | Risk (kept; it was YIELD that had to give it up) |
 *
 * The first two are the clearest double-count in the engine, because the code
 * names the characteristic it is measuring and the name is another dimension's.
 * Removed: Demand already prices vacancy at 0.35 of its weight and sale
 * pressure at another 0.35.
 *
 * ## What honestly remains, and how thin it is
 *
 * Measured over 1,204 stored reports:
 *
 * | input | present | note |
 * | --- | ---: | --- |
 * | `propertyType` | 930 (77.2%) | at `property_specs.property_type` — **snake_case**, while the scorer reads `propertyType`, so it has never been read; 145 more rows hold the placeholder `"Residential Property"` |
 * | `lvr` | 201 (16.7%) | `financial_calculations.keyMetrics.lvr` |
 * | `weeklyCashFlow` | 185 (15.4%) | the same block; effectively a subset of `lvr` |
 *
 * So the answer to "can the 5% Risk dimension be populated independently and
 * defensibly?" is: **partly, and predominantly on one input.** Property type is
 * reachable on 77% once the key name is corrected; leverage and serviceability
 * exist on about a sixth of the corpus, and they are the same sixth. A Risk
 * score on most reports will therefore rest on property type alone.
 *
 * That is stated rather than papered over, and it is why this module returns
 * `null` freely and reports `weightCovered`. **No input was invented to fill
 * the 5% weight** — the brief forbids it and it would be the placeholder
 * problem again wearing a new name.
 *
 * ## One declared exception
 *
 * `growth1Year` is Growth's, and Risk reads it — deliberately. Growth rewards
 * realised twelve-month performance; Risk prices the chance it reverses. They
 * move the composite in OPPOSITE directions, which is what separates a designed
 * interaction from a double award, and it is on the record in
 * `DECLARED_EXCEPTIONS`. Measured magnitude: at 22% growth, roughly +4.0
 * composite points via Growth against −0.9 via Risk.
 */

import { interpolate } from './growthScoring.pure.ts';

/** Bumped whenever a weight, anchor or rule changes. Persisted with the score. */
export const RISK_METHODOLOGY_VERSION = '1.0.0';

export const RISK_WEIGHTS = {
  leverage: 0.40,
  serviceability: 0.30,
  assetType: 0.20,
  marketOverheating: 0.10,
} as const;

export type RiskComponentKey = keyof typeof RISK_WEIGHTS;

/** LVR. Higher is riskier, so the score falls as leverage rises. */
export const LVR_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [40, 100], [60, 90], [70, 78], [80, 62], [85, 46], [90, 30], [95, 15], [100, 0],
];

/** Weekly cash flow after financing. */
export const SERVICEABILITY_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-700, 0], [-450, 20], [-300, 40], [-150, 60], [-50, 75], [0, 82], [100, 92], [250, 100],
];

/**
 * Twelve-month growth read as overheating risk.
 *
 * Flat until 12% — ordinary growth carries no excess reversal risk, and
 * charging for it would be a second opinion on Growth rather than a risk
 * measure. Only genuinely rapid appreciation moves it.
 */
export const OVERHEATING_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 100], [12, 100], [16, 85], [20, 68], [25, 48], [35, 25],
];

/**
 * Asset-type risk, by resolved type.
 *
 * Only a type the engine RECOGNISES contributes. The live engine read
 * `propertyType || 'house'`, so an unclassified property collected the house
 * reading — and the placeholder `"Residential Property"` sits on 145 rows,
 * which must resolve to nothing rather than to a default.
 */
export const ASSET_TYPE_SCORES: Readonly<Record<string, number>> = {
  house: 82,
  duplex: 74,
  townhouse: 66,
  unit: 55,
  apartment: 55,
  land: 45,
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Resolve a stored property type to the engine's vocabulary, or null.
 *
 * Case-folds, because the corpus holds `house` (419) and `House` (208) as
 * separate strings. Returns null for `"Residential Property"`, `"Other"` and
 * anything unrecognised — an unresolved type is absent, never a default.
 */
export function resolveAssetType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return key in ASSET_TYPE_SCORES ? key : null;
}

export interface RiskInputs {
  /** Loan-to-value ratio, per cent. */
  lvr?: number | null;
  /** Weekly cash flow after financing. Risk's, never Yield's. */
  weeklyCashFlow?: number | null;
  /** Stored property type, in whatever case the record holds it. */
  propertyType?: string | null;
  /** Twelve-month capital growth, per cent. Growth's input, read under a declared exception. */
  growth1Year?: number | null;
}

export interface RiskComponent {
  key: RiskComponentKey;
  score: number;
  detail: string;
  weight: number;
}

export interface RiskResult {
  methodologyVersion: string;
  /** 0-100 where HIGHER IS SAFER, or null when nothing could be measured. */
  score: number | null;
  components: ReadonlyArray<RiskComponent>;
  missing: ReadonlyArray<RiskComponentKey>;
  weightCovered: number;
  /** True when the only thing measured was the asset type — the common case. */
  assetTypeOnly: boolean;
}

/**
 * Score the risks nothing else has counted.
 *
 * Higher is safer, consistent with the live engine's orientation. Returns
 * `null` rather than a number when no input resolved: on this corpus that will
 * be common, and a fabricated 50 is exactly what this programme removes.
 */
export function scoreRisk(input: RiskInputs): RiskResult {
  const built: RiskComponent[] = [];

  const lvr = num(input.lvr);
  if (lvr !== null && lvr > 0) {
    built.push({
      key: 'leverage',
      score: clamp(interpolate(lvr, LVR_ANCHORS)),
      detail: `${Math.round(lvr)}% loan-to-value ratio`,
      weight: RISK_WEIGHTS.leverage,
    });
  }

  const cash = num(input.weeklyCashFlow);
  if (cash !== null) {
    built.push({
      key: 'serviceability',
      score: clamp(interpolate(cash, SERVICEABILITY_ANCHORS)),
      detail: `$${Math.round(cash).toLocaleString('en-AU')}/week after financing`,
      weight: RISK_WEIGHTS.serviceability,
    });
  }

  const type = resolveAssetType(input.propertyType);
  if (type !== null) {
    built.push({
      key: 'assetType',
      score: ASSET_TYPE_SCORES[type],
      detail: `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
      weight: RISK_WEIGHTS.assetType,
    });
  }

  const g1 = num(input.growth1Year);
  if (g1 !== null) {
    built.push({
      key: 'marketOverheating',
      score: clamp(interpolate(g1, OVERHEATING_ANCHORS)),
      detail: g1 >= 12
        ? `${g1.toFixed(1)}% growth in twelve months carries reversal risk`
        : `${g1.toFixed(1)}% twelve-month growth is within ordinary range`,
      weight: RISK_WEIGHTS.marketOverheating,
    });
  }

  const present = new Set(built.map((c) => c.key));
  const missing = (Object.keys(RISK_WEIGHTS) as RiskComponentKey[]).filter((k) => !present.has(k));
  const weightCovered = built.reduce((s, c) => s + c.weight, 0);
  const score = weightCovered > 0
    ? Math.round(built.reduce((s, c) => s + c.score * (c.weight / weightCovered), 0))
    : null;

  return {
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    score,
    components: built,
    missing,
    weightCovered: Number(weightCovered.toFixed(3)),
    assetTypeOnly: built.length === 1 && built[0].key === 'assetType',
  };
}
