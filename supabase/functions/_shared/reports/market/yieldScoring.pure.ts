/**
 * The rental-return dimension, measured once.
 *
 * ## The defect this exists to end
 *
 * `calculateYieldScore` bands the gross yield and then subtracts 20 more points
 * when weekly cash flow is below −$100. Both halves are measuring the same
 * economic fact, and the band's own wording says so — the 6%+ band reads
 * *"Strong positive cash flow"* and the sub-2% band reads *"Negative cash flow
 * likely"*. The penalty then charges for it a second time.
 *
 * Measured across the 993 stored scores on 2026-09-08, the stored subscore and
 * the stored `details` string **contradict each other on every row**, and the
 * gap is exactly the penalty:
 *
 * | stored score | its own `details` | band that text comes from |
 * | ---: | --- | ---: |
 * | 0 | "Poor yield (<2%)" | 10 |
 * | **10** (778 rows, 78.3%) | "Below average yield (2-3%)" | 30 |
 * | 30 | "Average yield (3-4%)" | 50 |
 * | 50 | "Good yield (4-5%)" | 70 |
 * | 65 | "Excellent yield (5-6%)" | 85 |
 *
 * So a document says *"Good yield (4-5%) — Adequate cash flow"* beside a score
 * of 50 that the reader has no way to reconcile with it.
 *
 * The penalty also discriminates nothing. It landed on essentially the whole
 * corpus, because an Australian residential property at current prices is
 * almost always negatively geared before tax. A term that applies to ~99% of
 * cases carries no information — it just shifts the entire dimension down 20
 * points and compresses an already-narrow scale.
 *
 * ## The rule
 *
 * **Yield measures the property's rental return. Nothing else.** Whether the
 * buyer's financing makes the holding cash-flow negative is a fact about the
 * loan, the deposit and the tax position — not about the property — and it
 * belongs to the financial and risk assessment, which is where
 * {@link holdingCashFlowSignal} sends it. The same characteristic is never
 * charged twice.
 *
 * **Absent rent is absent.** No rent means no yield: null, never 0%, never the
 * bottom band. That is the rule the 0.00%-yield work established, and banding
 * an unknown rent as "Poor yield (<2%)" is the same defect wearing a label.
 */

import {
  type BasedMetric,
  type MetricBasis,
  grossYield,
  labelFor,
  netYield,
} from '../metrics/propertyMetrics.pure.ts';

/** Bumped whenever a band or rule changes. Persisted with the score. */
export const YIELD_METHODOLOGY_VERSION = '3.0.0';

export interface YieldInputs {
  /**
   * The basis amount, in dollars — the purchase price, or the current value.
   * Which one is {@link YieldInputs.basis}, and it is never defaulted.
   */
  basisAmount?: number | null;
  /**
   * Which quantity `basisAmount` is. Required, because the same rent over the
   * purchase price and over today's value are two different correct figures,
   * and a document that prints one under the other's name is wrong without
   * looking wrong (`DERIVED_FIGURES.md`).
   */
  basis: MetricBasis;
  /** Weekly rent actually established for this property. Never a guess. */
  weeklyRent?: number | null;
  /** Annual outgoings (rates, management, insurance, strata) where known. */
  annualOutgoings?: number | null;
  /**
   * Weekly cash flow after financing. Read ONLY by
   * {@link holdingCashFlowSignal} — it never touches the yield score.
   */
  weeklyCashFlow?: number | null;
}

/**
 * Gross-yield anchors, in per cent.
 *
 * Calibrated to the corpus rather than to intuition: the measured median gross
 * yield across the stored reports is **4.36%**, p75 **5.49%**, with a third at
 * or above 5%. So 4.36% must score near the middle — a yield the median
 * Australian investment property achieves is by definition average, and the old
 * bands agreed (4-5% was "Good"). What was wrong was the 20 points taken off
 * afterwards, not where the bands sat.
 *
 * ## Measured against a published benchmark, and retained (18 Sep 2026)
 *
 * `SCORE_CRITERIA_AND_CALIBRATION.md` §3 held this anchor open pending *"a
 * published Australian gross rental yield distribution"*, on the rule that the
 * platform's own sample median must not define "average". One was sourced: the
 * NSW DCJ Rent and Sales Report publishes median rents and median sale prices
 * for the same postcodes, and pairing them over 398 NSW postcodes gives a
 * market median of **3.41%** (p25 2.85%, p75 4.01%) — 0.95 points below this
 * anchor. Every row is in `docs/reports/evidence/`.
 *
 * **The anchor stays, and §5 of that doc records why.** Two reasons, both about
 * what the two numbers are rather than about which is nicer. The benchmark is
 * ONE STATE and this anchor serves every state, so substituting it would move
 * every non-NSW property's score on evidence about New South Wales — a sample
 * standing in for a population, which is the defect the rule exists to prevent,
 * with a citation attached. And the two populations differ by construction: the
 * corpus is stock somebody asked for a report on, the DCJ figure is the whole
 * market including postcodes nobody buys as an investment, so a gap in that
 * direction is what you would expect if both are right.
 *
 * Moving it down would raise every yield score in the book. That is the thing
 * S5/S6 §4 forbids by name, and there is no evidence here for a direction —
 * only for the fact that two different populations have two different medians.
 */
export const GROSS_YIELD_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [1.5, 0], [2.5, 15], [3.5, 33], [4.36, 50], [5.5, 72], [6.5, 87], [7.5, 95], [9, 100],
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function interpolate(value: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

export interface YieldResult {
  methodologyVersion: string;
  /** 0-100, or null when no rent is established. Never a placeholder. */
  score: number | null;
  /**
   * Gross yield with the basis it was measured on, or null.
   *
   * A {@link BasedMetric} rather than a bare number, so the figure cannot be
   * re-labelled downstream — the distinction `DERIVED_FIGURES.md` records as
   * the reason six "gross yield" sites disagreed without any of them being
   * wrong.
   */
  grossYield: BasedMetric | null;
  /** Net yield, or null. Unlevered: outgoings are a property cost, financing is not. */
  netYield: BasedMetric | null;
  /** What a report should call the figure, basis included. */
  label: string;
  /** What the score was computed on, for the evidence trail. */
  basis: 'gross' | 'net_adjusted' | 'unavailable';
  detail: string;
}

/**
 * Score the rental return.
 *
 * The two yields come from `propertyMetrics.pure.ts` — the programme's one
 * definition of each — so this module bands a figure and never derives one.
 * Where outgoings are known the gross score is nudged by how the net compares
 * with it: a property whose strata and rates eat an unusual share of the rent
 * is genuinely a weaker rental proposition. The adjustment is bounded at ±8
 * points so it refines the reading rather than replacing it.
 */
export function scoreYield(input: YieldInputs): YieldResult {
  const label = labelFor('grossYield', input.basis);
  const absent = (detail: string): YieldResult => ({
    methodologyVersion: YIELD_METHODOLOGY_VERSION,
    score: null,
    grossYield: null,
    netYield: null,
    label,
    basis: 'unavailable',
    detail,
  });

  // Narrow once, so nothing below has to re-check and no branch can print a
  // figure derived from a value it also treats as possibly absent.
  const weekly = typeof input.weeklyRent === 'number' && input.weeklyRent > 0
    ? input.weeklyRent
    : null;
  if (weekly === null) {
    return absent('No rent established for this property, so no yield is stated.');
  }
  const base = typeof input.basisAmount === 'number' && input.basisAmount > 0
    ? input.basisAmount
    : null;
  if (base === null) {
    return absent('No price or value recorded, so no yield is stated.');
  }

  const annualRent = weekly * 52;
  const gross = grossYield({ annualRent, basisAmount: base, basis: input.basis });
  // `grossYield` returns null only on a non-finite rent or a non-positive
  // basis, both excluded above; the check is the type narrowing, not a guard.
  if (gross === null) return absent('Yield could not be computed from the figures held.');

  const scoreBase = clamp(interpolate(gross.value, GROSS_YIELD_ANCHORS));
  const basisWord = input.basis === 'value' ? 'current value' : 'purchase price';
  const money = (n: number) => `$${n.toLocaleString('en-AU')}`;

  const outgoings = typeof input.annualOutgoings === 'number' && input.annualOutgoings >= 0
    ? input.annualOutgoings
    : null;
  const net = outgoings === null
    ? null
    : netYield({ annualRent, annualOperatingCosts: outgoings, basisAmount: base, basis: input.basis });

  // No outgoings, or a net that could not be formed: the gross reading stands
  // alone, unadjusted, and says so.
  if (outgoings === null || net === null) {
    return {
      methodologyVersion: YIELD_METHODOLOGY_VERSION,
      score: Math.round(scoreBase),
      grossYield: gross,
      netYield: null,
      label,
      basis: 'gross',
      detail: `${gross.value.toFixed(2)}% gross yield on a ${money(base)} ${basisWord}.`,
    };
  }

  // Typical Australian residential outgoings run ~20-25% of gross rent. A
  // retention materially better or worse than that is the signal; ±8 points
  // keeps it a refinement rather than a second opinion.
  const retention = (annualRent - outgoings) / annualRent;
  const adjustment = clamp(interpolate(retention, [[0.55, 0], [0.7, 4], [0.78, 8], [0.9, 16]])) - 8;

  return {
    methodologyVersion: YIELD_METHODOLOGY_VERSION,
    score: Math.round(clamp(scoreBase + adjustment)),
    grossYield: gross,
    netYield: net,
    label,
    basis: 'net_adjusted',
    detail:
      `${gross.value.toFixed(2)}% gross, ${net.value.toFixed(2)}% net on ${basisWord}, `
      + `after ${money(outgoings)} of annual outgoings `
      + `(${(retention * 100).toFixed(0)}% of rent retained).`,
  };
}

export interface HoldingCashFlowSignal {
  /** Weekly cash flow after financing, or null. */
  weeklyCashFlow: number | null;
  /**
   * How this reads for the FINANCIAL and RISK assessment. Never for Yield.
   *
   * `typical` is the honest label for negative gearing at ordinary levels: it
   * describes almost every Australian residential investment and so tells a
   * reader nothing about this property in particular.
   */
  reading: 'positive' | 'neutral' | 'typical_negative' | 'materially_negative' | 'unknown';
  detail: string;
}

/**
 * Read the holding cash flow, for the dimensions it actually belongs to.
 *
 * Exported separately and named for its destination, so that wiring it back
 * into Yield would be a visible decision rather than an accident.
 */
export function holdingCashFlowSignal(input: YieldInputs): HoldingCashFlowSignal {
  const cf = typeof input.weeklyCashFlow === 'number' ? input.weeklyCashFlow : null;
  if (cf === null) {
    return { weeklyCashFlow: null, reading: 'unknown', detail: 'Holding cash flow not calculated.' };
  }
  const weekly = `$${Math.abs(Math.round(cf)).toLocaleString('en-AU')}/week`;
  if (cf > 20) return { weeklyCashFlow: cf, reading: 'positive', detail: `Positive holding position, ${weekly}.` };
  if (cf >= -20) return { weeklyCashFlow: cf, reading: 'neutral', detail: `Approximately cash-flow neutral, ${weekly}.` };
  if (cf >= -400) {
    return {
      weeklyCashFlow: cf,
      reading: 'typical_negative',
      detail: `Negatively geared at ${weekly}, which is ordinary for residential investment at this price.`,
    };
  }
  return {
    weeklyCashFlow: cf,
    reading: 'materially_negative',
    detail: `Substantial holding cost of ${weekly}; serviceability warrants attention.`,
  };
}
